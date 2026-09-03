// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #305 — a chore that did not get done, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". The pure arithmetic the
// screens render (what a missed chore contributes, which is nothing) is in
// src/lib/chores.test.js; what lives here is the half only the database can
// prove — the clock, the withholding, the refusal, the constraint, and that
// the catch-up pass does not care.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

// The pglite boot dominates and the default would straddle CI's worst case —
// the measurement is in completion.pglite.test.js's comment. hookTimeout is
// set once for every pglite suite in support/pgliteSupabase.js (#145).
vi.setConfig({ testTimeout: 30_000 })

describe('a chore nobody did, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, choreId

  const seedChore = async (household, title = 'Dishes', minutes = 20) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-10') returning id`,
      [household, title, minutes],
    )
    return rows[0].id
  }

  const call = (uid, fn, id) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query(`select * from public.${fn}($1)`, [id])
      return rows[0]
    })

  const miss = (id) => call(deviceA, 'miss_chore', id)
  const unmiss = (id) => call(deviceA, 'unmiss_chore', id)
  const complete = (id) => call(deviceA, 'complete_chore', id)

  const readRow = async (id) =>
    (
      await db.query(
        `select completed_at, completed_by_member_id, missed_at, actual_minutes
           from public.chores where id = $1`,
        [id],
      )
    ).rows[0]

  const dbNow = async () => new Date((await db.query('select now() as t')).rows[0].t).getTime()

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)
    deviceB = await newDevice(db)

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    choreId = await seedChore(householdA.id)
  })

  // -------------------------------------------------------------------------
  // AC 1 — the stamp is the DATABASE's, and the client supplies none
  // -------------------------------------------------------------------------

  describe('AC 1 — missed_at comes from the database clock', () => {
    it('is set from now() inside the function, bracketed by two readings of the database clock', async () => {
      const before = await dbNow()
      const missed = await miss(choreId)
      const after = await dbNow()

      expect(missed.missed_at).not.toBeNull()
      // A client clock could not produce this value even by coincidence: it
      // sits between two readings of the server's own.
      expect(new Date(missed.missed_at).getTime()).toBeGreaterThanOrEqual(before)
      expect(new Date(missed.missed_at).getTime()).toBeLessThanOrEqual(after)
      // And nothing else moved — a miss is not a completion wearing a flag.
      expect(missed.completed_at).toBeNull()
      expect(missed.completed_by_member_id).toBeNull()
      expect(missed.actual_minutes).toBeNull()
    })

    it('takes no timestamp argument at all, so a phone cannot offer one', async () => {
      // The signature is the guarantee, as completion.pglite asserts for
      // complete_chore. An overload taking a timestamp would fail this.
      const { rows } = await db.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('miss_chore', 'unmiss_chore')
          order by p.proname`,
      )
      expect(rows.map((r) => `${r.proname}(${r.args})`)).toEqual([
        'miss_chore(chore_id uuid)',
        'unmiss_chore(chore_id uuid)',
      ])
    })

    it('a second tap keeps the FIRST stamp, so two phones cannot move the row between weeks', async () => {
      const first = await miss(choreId)
      // Push the stored stamp back as the owner, so a second call that
      // re-stamped would be visibly different from one that kept it.
      await db.query(`update public.chores set missed_at = missed_at - interval '2 days' where id = $1`, [
        choreId,
      ])
      const backdated = (await readRow(choreId)).missed_at
      expect(new Date(backdated).getTime()).toBeLessThan(new Date(first.missed_at).getTime())

      const again = await miss(choreId)
      expect(new Date(again.missed_at).getTime()).toBe(new Date(backdated).getTime())
    })

    it('the way back clears the stamp and touches nothing else', async () => {
      await miss(choreId)
      const back = await unmiss(choreId)
      expect(back.missed_at).toBeNull()
      expect(back.completed_at).toBeNull()
      expect(back.completed_by_member_id).toBeNull()

      const outstanding = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          `select count(*)::int as n from public.chores
            where completed_at is null and missed_at is null`,
        )
        return rows[0].n
      })
      expect(outstanding).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the column is not writable by a client
  // -------------------------------------------------------------------------

  describe('AC 2 — a client cannot write missed_at directly', () => {
    it('refuses a direct update for want of a column grant', async () => {
      const direct = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set missed_at = now() where id = $1', [choreId]),
        ),
      )
      expect(direct.ok).toBe(false)
      expect(direct.error).toMatch(/permission denied/i)
    })

    it('POSITIVE CONTROL: an ordinary title update in the same session is ALLOWED', async () => {
      // Without this the refusal above is satisfied by a grant set that is
      // simply empty, or by a broken session — neither of which is the rule.
      const allowed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set title = $1 where id = $2', ['Dishes twice', choreId]),
        ),
      )
      expect(allowed.error).toBeNull()
    })

    it('and the column is readable but in neither write grant, read from the catalog', async () => {
      const granted = async (privilege) =>
        (
          await db.query(
            `select column_name from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'chores'
                and grantee = 'authenticated' and privilege_type = $1
              order by column_name`,
            [privilege],
          )
        ).rows.map((r) => r.column_name)
      expect(await granted('SELECT')).toContain('missed_at')
      expect(await granted('UPDATE')).not.toContain('missed_at')
      expect(await granted('INSERT')).not.toContain('missed_at')
    })

    it('MUTATION EVIDENCE: with the withholding removed from the migration, the identical direct update SUCCEEDS', async () => {
      // 0002's style, with one difference worth stating. There is no revoke to
      // delete: under 0003's additive-by-column convention the withholding IS
      // the absence of a `grant update (missed_at)` statement, so "the
      // migration text with the withholding removed" is that text plus the one
      // statement whose absence does the withholding. Asserted first that the
      // real file carries no such statement outside its comments — otherwise
      // the mutation below would be adding a second copy of a grant already
      // there, and the success would be evidence of nothing.
      const sql0027 = migrationSql('0027_missed_chores.sql')
      const statements = sql0027
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
      expect(statements).not.toMatch(/grant\s+update\s*\(\s*missed_at/i)
      expect(statements).not.toMatch(/grant\s+insert\s*\(\s*missed_at/i)

      // 0027 is idempotent by construction (its header says so, and this is
      // the second application of it on this database), so the mutant is the
      // real file re-applied with the withholding removed.
      const mutant = `${sql0027}\ngrant update (missed_at) on public.chores to authenticated;\n`
      await db.exec(mutant)

      const direct = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set missed_at = now() where id = $1', [choreId]),
        ),
      )
      expect(direct.ok, 'without the withholding the direct write must succeed').toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — done wins, and the two stamps never coexist
  // -------------------------------------------------------------------------

  describe('AC 3 — a completed chore cannot be marked missed; a missed one can be done', () => {
    it('refuses miss_chore on a completed chore, with a sentence, and the completion stands', async () => {
      await complete(choreId)
      const refused = await attempt(() => miss(choreId))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/marked done/i)
      expect(refused.error).toMatch(/put it back on the list first/i)

      const row = await readRow(choreId)
      expect(row.completed_at).not.toBeNull()
      expect(row.missed_at).toBeNull()
    })

    it('completing a missed chore clears missed_at and completes it exactly as today', async () => {
      await miss(choreId)
      const before = await dbNow()
      const done = await complete(choreId)
      const after = await dbNow()

      expect(done.missed_at).toBeNull()
      expect(new Date(done.completed_at).getTime()).toBeGreaterThanOrEqual(before)
      expect(new Date(done.completed_at).getTime()).toBeLessThanOrEqual(after)
      // 0004's attribution and 0015's zero-tap seed both still happen: "did it
      // after all" is a completion, not a lesser one.
      expect(done.completed_by_member_id).toBe(householdA.organizer_member_id)
      expect(done.actual_minutes).toBe(20)
    })

    it('POSITIVE CONTROL: completing an ordinary outstanding chore gives the same row shape', async () => {
      // So the assertions above are about the transition and not about the
      // fixture: an unmissed chore completes to the identical facts.
      const done = await complete(choreId)
      expect(done.missed_at).toBeNull()
      expect(done.completed_by_member_id).toBe(householdA.organizer_member_id)
      expect(done.actual_minutes).toBe(20)
    })

    it('the constraint refuses both stamps at once, by name, on a direct insert as the owner', async () => {
      // As the owner, bypassing every grant: the CHECK is what refuses, not a
      // privilege. A function could be rewritten to set both; the row could not.
      const both = await attempt(() =>
        db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, completed_at, missed_at)
           values ($1, 'Dishes', 20, '2026-08-10', now(), now())`,
          [householdA.id],
        ),
      )
      expect(both.ok).toBe(false)
      expect(both.error).toMatch(/chores_not_both_done_and_missed/)
    })

    it('POSITIVE CONTROL: the same insert with either stamp alone is accepted', async () => {
      for (const column of ['completed_at', 'missed_at']) {
        const one = await attempt(() =>
          db.query(
            `insert into public.chores
               (household_id, title, expected_minutes, due_on, ${column})
             values ($1, 'Dishes', 20, '2026-08-10', now())`,
            [householdA.id],
          ),
        )
        expect(one.error, column).toBeNull()
      }
    })
  })

  // -------------------------------------------------------------------------
  // Scope — the same rule completion carries
  // -------------------------------------------------------------------------

  describe('a miss is scoped to the household, exactly as completion is', () => {
    it('refuses a chore in another household, and the row re-reads unchanged', async () => {
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2)', ['Other', 'Other Org']),
      )
      const refused = await attempt(() => call(deviceB, 'miss_chore', choreId))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/i)
      expect((await readRow(choreId)).missed_at).toBeNull()
    })

    it('and the way back is scoped the same way — an outsider cannot un-miss it either', async () => {
      // completion.pglite records why this matters for uncomplete_chore: the
      // undo's access rule went untested until #62 and neutralising it
      // reddened nothing. Tested from day one here.
      await miss(choreId)
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2)', ['Other', 'Other Org']),
      )
      const refused = await attempt(() => call(deviceB, 'unmiss_chore', choreId))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/i)
      expect((await readRow(choreId)).missed_at).not.toBeNull()
    })

    it('both functions are executable by authenticated and by nobody else', async () => {
      const { rows } = await db.query(
        `select p.proname,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('miss_chore', 'unmiss_chore')
          order by p.proname`,
      )
      expect(rows).toEqual([
        { proname: 'miss_chore', authenticated: true, anon: false },
        { proname: 'unmiss_chore', authenticated: true, anon: false },
      ])
    })
  })

  // -------------------------------------------------------------------------
  // AC 7 — a missed occurrence does not disturb its repeat
  // -------------------------------------------------------------------------

  describe('AC 7 — the next occurrence generates as normal after a miss', () => {
    // The repeats suite's own helpers, reduced to what this needs: a daily
    // anchor in a New York household, the pass run at a held instant as the
    // owner (`catch_up_repeats_at` is granted to no client role; the caller
    // identity still scopes it).
    let tzHousehold, organizer, anchorId

    const runAt = async (uid, instant) => {
      await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
      try {
        const { rows } = await db.query(
          'select * from public.catch_up_repeats_at($1::timestamptz)',
          [instant],
        )
        return rows[0]
      } finally {
        await db.query(`select set_config('test.uid', '', false)`)
      }
    }

    const occurrences = async (parentId) =>
      (
        await db.query(
          `select id, to_char(due_on, 'YYYY-MM-DD') as due_on, missed_at, completed_at
             from public.chores where generated_from = $1 order by due_on`,
          [parentId],
        )
      ).rows

    const anchorRow = async (id) =>
      (
        await db.query(
          `select title, expected_minutes, to_char(due_on, 'YYYY-MM-DD') as due_on, repeat_kind,
                  repeat_weekdays, repeat_monthday, to_char(repeat_since, 'YYYY-MM-DD') as since,
                  missed_at, completed_at
             from public.chores where id = $1`,
          [id],
        )
      ).rows[0]

    beforeEach(async () => {
      organizer = await newDevice(db)
      tzHousehold = await asDevice(db, organizer, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
          'Placeholder Other Household',
          'Placeholder Other Organizer',
          'America/New_York',
        ])
        return rows[0]
      })
      // A daily chore switched on Monday 2026-08-10, through the client path.
      anchorId = await asDevice(db, organizer, async () => {
        const { rows } = await db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on, repeat_kind)
           values ($1, 'Daily', 10, '2026-08-10', 'daily') returning id`,
          [tzHousehold.id],
        )
        return rows[0].id
      })
      // Backdate `repeat_since` as the owner so the pass has a past to walk.
      await db.query(`update public.chores set repeat_since = '2026-08-10' where id = $1`, [anchorId])
      // Monday's own occurrence (the anchor row — 0012 makes its due_on the
      // first occurrence) was DONE. Since #306 the pass supersedes an
      // outstanding anchor the moment Tuesday's occurrence generates, which
      // would stamp the parent for a reason unrelated to this test's claim.
      // Completed work is untouched by that rule (#306 AC 4), so completing it
      // keeps the anchor a row a miss on an occurrence could only reach by
      // writing to its parent — which is exactly what is asserted below.
      await call(organizer, 'complete_chore', anchorId)
    })

    it("marking Tuesday's occurrence missed leaves Wednesday's to generate, and the anchor untouched", async () => {
      // Tuesday noon New York: the pass creates Tuesday's occurrence.
      const tuesday = await runAt(organizer, '2026-08-11T16:00:00Z')
      expect(tuesday.created_count).toBe(1)
      const [tuesdayRow] = await occurrences(anchorId)
      expect(tuesdayRow.due_on).toBe('2026-08-11')

      const anchorBefore = await anchorRow(anchorId)
      await call(organizer, 'miss_chore', tuesdayRow.id)

      // Wednesday noon: exactly one more occurrence, dated Wednesday.
      const wednesday = await runAt(organizer, '2026-08-12T16:00:00Z')
      expect(wednesday.created_count).toBe(1)
      expect(wednesday.skipped_count).toBe(0)
      const rows = await occurrences(anchorId)
      expect(rows.map((r) => r.due_on)).toEqual(['2026-08-11', '2026-08-12'])
      // The missed one is still missed, the new one is outstanding.
      expect(rows[0].missed_at).not.toBeNull()
      expect(rows[1].missed_at).toBeNull()
      expect(rows[1].completed_at).toBeNull()

      // And the anchor's schedule is byte-for-byte what it was: a miss on an
      // occurrence writes nothing to its parent.
      expect(await anchorRow(anchorId)).toEqual(anchorBefore)
      expect(anchorBefore.missed_at).toBeNull()
    })

    it('POSITIVE CONTROL: the same two passes with nothing missed produce the same two dates', async () => {
      // So the assertion above is about the miss not interfering, rather than
      // about the pass happening to produce two rows whatever is done to them.
      await runAt(organizer, '2026-08-11T16:00:00Z')
      await runAt(organizer, '2026-08-12T16:00:00Z')
      expect((await occurrences(anchorId)).map((r) => r.due_on)).toEqual(['2026-08-11', '2026-08-12'])
    })
  })

  describe('0027 is re-runnable, because a human pastes it', () => {
    it('applies a second time without error, and the grant set is unchanged', async () => {
      const granted = async () =>
        (
          await db.query(
            `select privilege_type from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'chores'
                and grantee = 'authenticated' and column_name = 'missed_at'
              order by privilege_type`,
          )
        ).rows.map((r) => r.privilege_type)
      expect(await granted()).toEqual(['SELECT'])
      const second = await attempt(() => db.exec(migrationSql('0027_missed_chores.sql')))
      expect(second.error).toBeNull()
      expect(await granted()).toEqual(['SELECT'])
    })
  })
})
