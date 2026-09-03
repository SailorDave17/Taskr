// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #307 — completing an unassigned chore assigns it to whoever completed it.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — the live half is AC 9, discharged by `npm run migrate:live` and a
// read-back in the story's own session.
//
// WHY THIS IS ITS OWN FILE rather than a describe in completion.pglite.test.js
//
// That file is #35's, and its AC 7 records the decision this story REVERSES —
// "allow it, attribute it, surface nothing". Those tests still pass, because
// what they assert (`completed_by_member_id`) is untouched here. Keeping the
// reversal in a file of its own means the old story's evidence stays readable
// as the old story's evidence, and the two sets cannot be mistaken for one
// argument. The pointer runs both ways: #35's AC 7 block carries a note back.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import {
  MIGRATIONS,
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

// See completion.pglite.test.js for the measurement behind 30s. hookTimeout is
// set once for every pglite suite in support/pgliteSupabase.js, not here.
vi.setConfig({ testTimeout: 30_000 })

describe('completion sets the holder, run against a real Postgres', () => {
  let db, deviceA, deviceB, household, memberA, memberB, choreId

  const seedChore = async (householdId, title = 'Dishes', minutes = 20) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-10') returning id`,
      [householdId, title, minutes],
    )
    return rows[0].id
  }

  const readChore = async (id) => {
    const { rows } = await db.query(
      `select assigned_member_id, assigned_source, completed_at, completed_by_member_id,
              missed_at, actual_minutes
         from public.chores where id = $1`,
      [id],
    )
    return rows[0]
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db, 'a@example.invalid')
    deviceB = await newDevice(db, 'b@example.invalid')

    household = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    memberA = household.organizer_member_id

    // A second real member of the SAME household, claimed by device B — so
    // "somebody else completes it" is a member of the house rather than a
    // stranger, which is the case AC 2 is about. A stranger is refused by the
    // household scoping rule and would prove something else.
    const { rows: added } = await db.query(
      `insert into public.members (household_id, display_name, claimed_by, email)
       values ($1, 'Housemate', $2, 'b@example.invalid') returning id`,
      [household.id, deviceB],
    )
    memberB = added[0].id

    choreId = await seedChore(household.id)
  })

  // -------------------------------------------------------------------------
  // AC 1 — an unassigned chore becomes the completer's
  // -------------------------------------------------------------------------

  describe('AC 1 — completing work nobody held', () => {
    it('records the completer as the holder, with the completed source', async () => {
      const before = await readChore(choreId)
      // The precondition is asserted rather than assumed: a fixture that
      // arrived already assigned would make every assertion below pass for the
      // wrong reason.
      expect(before.assigned_member_id).toBeNull()
      expect(before.assigned_source).toBeNull()

      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })

      expect(done.assigned_member_id).toBe(memberA)
      expect(done.assigned_source).toBe('completed')
      expect(done.completed_by_member_id).toBe(memberA)
    })

    it('writes ONE person to both columns, not two values that happen to agree', async () => {
      // The function resolves `acting_member` once into a variable and uses it
      // for both columns. Two separate calls would agree today and could not be
      // shown to agree tomorrow; this asserts the identity rather than the
      // coincidence.
      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })
      expect(done.assigned_member_id).toBe(done.completed_by_member_id)
    })

    it('the client sends nothing new — the same one-argument call does it', async () => {
      // `complete_chore(chore_id)` is the whole signature, unchanged since 0004.
      // A story that needed a client change would show up here as a second
      // argument, and PostgREST resolves overloads by argument NAME SET, so a
      // widened signature is a live-project incident rather than a local one.
      const { rows } = await db.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'complete_chore'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].args).toBe('chore_id uuid')
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — an assignment somebody made survives somebody else finishing it
  // -------------------------------------------------------------------------

  describe('AC 2 — completing work that is already held', () => {
    it('leaves a manual holder alone when another member completes it', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberB]),
      )
      const assigned = await readChore(choreId)
      expect(assigned.assigned_member_id).toBe(memberB)
      expect(assigned.assigned_source).toBe('manual')

      // A completes work assigned to B.
      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })

      expect(done.assigned_member_id).toBe(memberB)
      expect(done.assigned_source).toBe('manual')
      // And the record of who actually did it is still honest.
      expect(done.completed_by_member_id).toBe(memberA)
    })

    it('leaves an ALLOCATOR-placed holder alone too, source and all', async () => {
      // The `auto` arm matters on its own: a rule keyed on "is the source
      // manual" rather than "is the holder null" would pass the test above and
      // fail this one, silently converting an incumbent into a completion-set
      // holder and changing what the next re-balance may move.
      await db.query(
        `update public.chores set assigned_member_id = $1, assigned_source = 'auto' where id = $2`,
        [memberB, choreId],
      )

      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })

      expect(done.assigned_member_id).toBe(memberB)
      expect(done.assigned_source).toBe('auto')
      expect(done.completed_by_member_id).toBe(memberA)
    })

    it('the holder keeps the chore even when they complete it themselves', async () => {
      // The uninteresting case, asserted because it is the common one: a rule
      // that rewrote the source on every completion would show up here as
      // `completed` where `manual` belongs, and no other test would catch it.
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )
      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })
      expect(done.assigned_member_id).toBe(memberA)
      expect(done.assigned_source).toBe('manual')
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — un-completion gives back exactly what completion took
  // -------------------------------------------------------------------------

  describe('AC 4 — putting it back', () => {
    it('clears the holder AND the source on a completion-set assignment', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.complete_chore($1)', [choreId]),
      )
      expect((await readChore(choreId)).assigned_source).toBe('completed')

      const undone = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.uncomplete_chore($1)', [choreId])
        return rows[0]
      })

      // The pre-completion state, exactly: nobody holds it and nothing claims
      // to know how it came to be held.
      expect(undone.assigned_member_id).toBeNull()
      expect(undone.assigned_source).toBeNull()
      expect(undone.completed_at).toBeNull()
      expect(undone.completed_by_member_id).toBeNull()
    })

    it('leaves a MANUAL assignment untouched through complete and un-complete', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberB]),
      )
      await asDevice(db, deviceA, () =>
        db.query('select * from public.complete_chore($1)', [choreId]),
      )

      const undone = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.uncomplete_chore($1)', [choreId])
        return rows[0]
      })

      // B committed to this chore before anybody finished it, and taking the
      // completion back does not take the commitment back.
      expect(undone.assigned_member_id).toBe(memberB)
      expect(undone.assigned_source).toBe('manual')
      expect(undone.completed_at).toBeNull()
    })

    it('leaves an AUTO assignment untouched through complete and un-complete', async () => {
      await db.query(
        `update public.chores set assigned_member_id = $1, assigned_source = 'auto' where id = $2`,
        [memberB, choreId],
      )
      await asDevice(db, deviceA, () =>
        db.query('select * from public.complete_chore($1)', [choreId]),
      )

      const undone = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.uncomplete_chore($1)', [choreId])
        return rows[0]
      })

      expect(undone.assigned_member_id).toBe(memberB)
      expect(undone.assigned_source).toBe('auto')
    })

    it('a second completion after an undo re-claims it for whoever does it THEN', async () => {
      // The round trip, because the two functions are only correct as a pair:
      // A completes and holds it, A undoes it, B completes it and holds it.
      // A rule that cleared only the member and kept the source would leave B
      // holding a chore whose source says `completed` from A's tap, which reads
      // right and is a different fact.
      await asDevice(db, deviceA, () =>
        db.query('select * from public.complete_chore($1)', [choreId]),
      )
      await asDevice(db, deviceA, () =>
        db.query('select * from public.uncomplete_chore($1)', [choreId]),
      )
      const done = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })
      expect(done.assigned_member_id).toBe(memberB)
      expect(done.assigned_source).toBe('completed')
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — MUTATION EVIDENCE: the widening is what admits the third value
  // -------------------------------------------------------------------------

  describe('AC 5 — the constraint really is what allows this', () => {
    it('accepts a direct insert carrying the new value', async () => {
      const written = await attempt(() =>
        db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, assigned_member_id, assigned_source)
           values ($1, 'Laundry', 15, '2026-08-11', $2, 'completed')`,
          [household.id, memberA],
        ),
      )
      expect(written.error).toBeNull()
    })

    it('with the widening removed from the migration text, the same insert is REFUSED', async () => {
      const sql = migrationSql('0029_completion_assigns_the_completer.sql')
      const WIDENED = "check (assigned_source is null or assigned_source in ('manual', 'auto', 'completed'));"
      const NARROW = "check (assigned_source is null or assigned_source in ('manual', 'auto'));"

      // Assert the anchor is unique before mutating. A pattern that matched
      // twice — or not at all — would produce a result that reads as evidence
      // while testing something else, which is the failure this AC names.
      const hits = sql.split(WIDENED).length - 1
      expect(hits, `expected the widened check exactly once, found ${hits}`).toBe(1)

      const mutated = await PGlite.create({ extensions: { pgcrypto } })
      await mutated.exec(`
        create schema if not exists auth;
        create schema if not exists extensions;
        create extension if not exists pgcrypto with schema extensions;
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin;
        grant usage on schema public, extensions to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        create table auth.users (id uuid primary key default gen_random_uuid(), email text);
        create or replace function auth.uid() returns uuid language sql stable as $stub$
          select nullif(current_setting('test.uid', true), '')::uuid
        $stub$;
      `)
      for (const name of MIGRATIONS) {
        const body = name === '0029_completion_assigns_the_completer.sql'
          ? sql.replace(WIDENED, NARROW)
          : migrationSql(name)
        await mutated.exec(body)
      }

      const uid = (await mutated.query('insert into auth.users (email) values (null) returning id'))
        .rows[0].id
      // `set_config(..., false)` rather than `set local`: these statements are
      // not inside a transaction, and `set local` outside one is silently
      // scoped to nothing — the signed-in user would read as absent. Same call
      // `asDevice` makes, for the same reason.
      await mutated.exec('set role authenticated')
      await mutated.query(`select set_config('test.uid', $1, false)`, [uid])
      const made = await mutated.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      await mutated.exec('reset role')
      const householdId = made.rows[0].id
      const holder = made.rows[0].organizer_member_id

      const refused = await attempt(() =>
        mutated.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, assigned_member_id, assigned_source)
           values ($1, 'Laundry', 15, '2026-08-11', $2, 'completed')`,
          [householdId, holder],
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/chores_assigned_source_known/)

      // POSITIVE CONTROL: the mutated database is otherwise intact — it refuses
      // the third value and still accepts the two it always knew, so the red
      // above is the widening's absence rather than a database that failed to
      // build.
      const accepted = await attempt(() =>
        mutated.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, assigned_member_id, assigned_source)
           values ($1, 'Laundry', 15, '2026-08-11', $2, 'manual')`,
          [householdId, holder],
        ),
      )
      expect(accepted.error).toBeNull()
      await mutated.close()
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 — the allocator never moves a completed chore
  // -------------------------------------------------------------------------

  describe('AC 6 — apply_assignments leaves a completed row where it is', () => {
    it('refuses to place a completed chore, whatever its source says', async () => {
      // Already true before this story: `apply_assignments` filters on
      // `completed_at is null`. It is pinned HERE because #307 is what makes a
      // completed row carry a holder at all — before it, a done chore with a
      // source was a state the allocator never met. The test reddens if the
      // done-row guard is removed.
      await asDevice(db, deviceA, () =>
        db.query('select * from public.complete_chore($1)', [choreId]),
      )
      expect((await readChore(choreId)).assigned_source).toBe('completed')

      const version = (
        await db.query('select assignments_version from public.households where id = $1', [
          household.id,
        ])
      ).rows[0].assignments_version

      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb)', [
            household.id,
            version,
            JSON.stringify([{ chore_id: choreId, member_id: memberB }]),
            JSON.stringify({ level: true }),
          ]),
        ),
      )

      // The RPC refuses the whole call rather than skipping the row — a
      // placement naming a chore it may not move is a computation made from a
      // household state that no longer holds.
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/does not name an open, non-manual chore/)

      // And the row really is untouched. A refusal that had already written
      // would pass the assertion above.
      const after = await readChore(choreId)
      expect(after.assigned_member_id).toBe(memberA)
      expect(after.assigned_source).toBe('completed')
    })

    it('POSITIVE CONTROL: the same call places an OPEN chore in the same household', async () => {
      // Without this, the refusal above is equally consistent with
      // `apply_assignments` being broken for every input.
      const open = await seedChore(household.id, 'Laundry', 15)
      const version = (
        await db.query('select assignments_version from public.households where id = $1', [
          household.id,
        ])
      ).rows[0].assignments_version

      const applied = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          'select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb) as result',
          [
            household.id,
            version,
            JSON.stringify([{ chore_id: open, member_id: memberB }]),
            JSON.stringify({ level: true }),
          ],
        )
        return rows[0].result
      })
      expect(applied.applied).toBe(1)
      const placed = await readChore(open)
      expect(placed.assigned_member_id).toBe(memberB)
      expect(placed.assigned_source).toBe('auto')
    })
  })

  // -------------------------------------------------------------------------
  // A missed chore earns nobody anything
  // -------------------------------------------------------------------------

  describe('the rule never fires on work that was NOT done', () => {
    it('marking a chore missed assigns it to nobody', async () => {
      // #305's state. The rule is about credit for work done, and a miss is the
      // honest record that it was not — so it must not hand the chore to
      // whoever pressed the button.
      const missed = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.miss_chore($1)', [choreId])
        return rows[0]
      })
      expect(missed.missed_at).not.toBeNull()
      expect(missed.assigned_member_id).toBeNull()
      expect(missed.assigned_source).toBeNull()
    })

    it('but "did it after all" on a missed chore DOES claim it, because that is a completion', async () => {
      // Done wins over missed (0027), and once it is done the #307 rule applies
      // to it exactly as it would to any other unassigned completion.
      await asDevice(db, deviceA, () =>
        db.query('select * from public.miss_chore($1)', [choreId]),
      )
      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })
      expect(done.missed_at).toBeNull()
      expect(done.assigned_member_id).toBe(memberA)
      expect(done.assigned_source).toBe('completed')
    })
  })

  // -------------------------------------------------------------------------
  // 0029 is re-runnable, because a human may paste it
  // -------------------------------------------------------------------------

  describe('0029 is re-runnable', () => {
    it('applies a second time on top of the full stack without error', async () => {
      // The constraint is DROPPED and re-added rather than guarded by a
      // pg_constraint lookup — a guard would read the OLD narrow constraint as
      // present and leave the widening unapplied, which is the failure that
      // looks like success. So the re-paste has to be shown safe.
      const second = await attempt(() =>
        db.exec(migrationSql('0029_completion_assigns_the_completer.sql')),
      )
      expect(second.error).toBeNull()
    })

    it('and the constraint still admits exactly the three values afterwards', async () => {
      await db.exec(migrationSql('0029_completion_assigns_the_completer.sql'))
      const { rows } = await db.query(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conname = 'chores_assigned_source_known'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].def).toMatch(/'manual'/)
      expect(rows[0].def).toMatch(/'auto'/)
      expect(rows[0].def).toMatch(/'completed'/)
    })

    it('and a re-run does not widen the update grant', async () => {
      await db.exec(migrationSql('0029_completion_assigns_the_completer.sql'))
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      // Unchanged by this story: the assignment columns move through the RPCs,
      // never through a client update.
      expect(rows.map((r) => r.column_name)).not.toContain('assigned_member_id')
      expect(rows.map((r) => r.column_name)).not.toContain('assigned_source')
    })

    it('the replace preserved the ACLs 0004 set on both functions', async () => {
      // `create or replace` keeps a function's privileges, which is why this
      // file issues no grant. Asserted rather than assumed: a replace that had
      // silently dropped them would leave the client unable to complete
      // anything, and no other test here signs in as a role that would notice.
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.complete_chore(uuid)', 'execute') as complete_auth,
                has_function_privilege('anon', 'public.complete_chore(uuid)', 'execute') as complete_anon,
                has_function_privilege('authenticated', 'public.uncomplete_chore(uuid)', 'execute') as uncomplete_auth,
                has_function_privilege('anon', 'public.uncomplete_chore(uuid)', 'execute') as uncomplete_anon`,
      )
      expect(rows[0]).toEqual({
        complete_auth: true,
        complete_anon: false,
        uncomplete_auth: true,
        uncomplete_anon: false,
      })
    })
  })

  // -------------------------------------------------------------------------
  // The reversion hazard this file ADDS to the set docs/access-model.md keeps
  // -------------------------------------------------------------------------

  describe('re-pasting an older file alone reverts this rule, silently', () => {
    // `docs/access-model.md` keeps a list of files that carry their own body of
    // a function a later file replaced: re-pasted ALONE onto today's schema
    // they succeed, report success, and revert that function. This story adds
    // two members to that set — `0027` (its own `complete_chore`) and `0007`
    // (its own `uncomplete_chore`) — so the claim is measured here rather than
    // asserted in prose, with a before/after control in one run.
    //
    // What IS re-runnable is the whole list in order, which
    // migrations.pglite.test.js asserts and CI runs on every push. The hazard
    // is the single-file re-paste, which is the thing a person reaches for when
    // they are not sure a migration landed.

    const claim = async (database) => {
      const dev = await newDevice(database, 'r@example.invalid')
      const made = await asDevice(database, dev, async () => {
        const { rows } = await database.query('select * from public.create_household($1, $2)', [
          'Placeholder Household',
          'Placeholder Organizer',
        ])
        return rows[0]
      })
      const { rows: c } = await database.query(
        `insert into public.chores (household_id, title, expected_minutes, due_on)
         values ($1, 'Dishes', 20, '2026-08-10') returning id`,
        [made.id],
      )
      const done = await asDevice(database, dev, async () => {
        const { rows } = await database.query('select * from public.complete_chore($1)', [c[0].id])
        return rows[0]
      })
      return { holder: done.assigned_member_id, source: done.assigned_source, member: made.organizer_member_id }
    }

    it('re-pasting 0027 alone succeeds and takes the rule away — before/after in one run', async () => {
      const before = await claim(db)
      expect(before.holder).toBe(before.member)
      expect(before.source).toBe('completed')

      const second = await attempt(() => db.exec(migrationSql('0027_missed_chores.sql')))
      // It SUCCEEDS. That is the whole hazard: a failure would be safe.
      expect(second.error).toBeNull()

      const after = await claim(db)
      expect(after.holder).toBeNull()
      expect(after.source).toBeNull()

      // And the repair is re-pasting the newest file, not hunting for what broke.
      await db.exec(migrationSql('0029_completion_assigns_the_completer.sql'))
      const repaired = await claim(db)
      expect(repaired.holder).toBe(repaired.member)
      expect(repaired.source).toBe('completed')
    })

    it('re-pasting 0007 alone takes BOTH halves away, and the constraint stands either way', async () => {
      // 0007 carries its own copy of BOTH functions — `complete_chore` at line
      // 384 and `uncomplete_chore` at 418 — so re-pasting it alone reverts the
      // whole rule rather than half of it.
      //
      // *This test asserted the half-reverted state until it was run.* The
      // prediction was that only `uncomplete_chore` would go, leaving a chore
      // claimed with no way to give it back — a worse state, and the reason for
      // writing the test. Measuring it says otherwise, and the measured answer
      // is the milder one: with completion reverted too, nothing writes a
      // holder, so there is nothing for the undo to fail to clear. The wrong
      // prediction is left recorded rather than quietly replaced, because the
      // reason it was worth testing was exactly that nobody knew.
      const dev = await newDevice(db, 's@example.invalid')
      const made = await asDevice(db, dev, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Placeholder Household',
          'Placeholder Organizer',
        ])
        return rows[0]
      })
      const { rows: c } = await db.query(
        `insert into public.chores (household_id, title, expected_minutes, due_on)
         values ($1, 'Dishes', 20, '2026-08-10') returning id`,
        [made.id],
      )

      await db.exec(migrationSql('0007_per_member_auth.sql'))

      await asDevice(db, dev, () => db.query('select * from public.complete_chore($1)', [c[0].id]))
      const undone = await asDevice(db, dev, async () => {
        const { rows } = await db.query('select * from public.uncomplete_chore($1)', [c[0].id])
        return rows[0]
      })

      // Both halves are gone: nothing was claimed, so nothing is left held.
      expect(undone.assigned_member_id).toBeNull()
      expect(undone.assigned_source).toBeNull()

      // The discriminating half — this is a REVERSION rather than the rule
      // simply not firing. Completion no longer claims the chore at all, which
      // is what a fresh completion under the reverted body proves.
      const { rows: c2 } = await db.query(
        `insert into public.chores (household_id, title, expected_minutes, due_on)
         values ($1, 'Laundry', 15, '2026-08-11') returning id`,
        [made.id],
      )
      const reverted = await asDevice(db, dev, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [c2[0].id])
        return rows[0]
      })
      expect(reverted.completed_at).not.toBeNull()
      expect(reverted.assigned_member_id).toBeNull()

      // The constraint is untouched by 0007, so the third value stays legal —
      // which is why this reversion is silent rather than raising.
      const { rows } = await db.query(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conname = 'chores_assigned_source_known'`,
      )
      expect(rows[0].def).toMatch(/'completed'/)
    })
  })
})
