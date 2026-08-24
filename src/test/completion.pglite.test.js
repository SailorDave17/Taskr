// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other two pglite files.
//
// #35 — marking a chore done, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — that is #38, externally gated on an owner-only dashboard action.

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
  databaseThrough,
} from './support/pgliteSupabase.js'

const READABLE =
  'id, title, expected_minutes, due_on, created_at, completed_at, completed_by_member_id'

// A pglite test builds a real Postgres in WebAssembly, so vitest's 5000ms
// default testTimeout is a number nobody chose for this suite - it is what you
// get for not setting one. Raised deliberately, and the measurement is why.
//
// Measured 2026-08-24 on repeats.pglite.test.js's heaviest case, which runs its
// whole scenario twice under two pinned session zones and must therefore build
// TWO more databases inside the test body, on top of the one beforeEach already
// built: 3460ms on the dev machine, 7800ms and 8107ms on ubuntu-latest, where it
// timed out. The same test passed in a third CI run, so the runner straddles the
// default - which is the worst place for a limit to sit, because the suite then
// fails about two pushes in three and reads as a real defect each time.
//
// 30s is ~3.7x the worst time actually observed. A genuine hang still fails; it
// fails later, and that is the whole cost of this line.
//
// hookTimeout is deliberately NOT raised. beforeEach builds exactly one database
// in all eight pglite files, none has ever timed out, and leaving it at 10s keeps
// a real signal: a hook over the line means setup got slower, which is a
// different fact from a test doing more work. If one ever fires, raise it on its
// own evidence rather than by symmetry with this.
vi.setConfig({ testTimeout: 30_000 })

describe('completing a chore, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, memberA, choreId

  const seedChore = async (household, title = 'Dishes', minutes = 20) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-10') returning id`,
      [household, title, minutes],
    )
    return rows[0].id
  }

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
    memberA = householdA.organizer_member_id
    choreId = await seedChore(householdA.id)
  })

  // -------------------------------------------------------------------------
  // AC 1 — the timestamp is the DATABASE's, and the client supplies none
  // -------------------------------------------------------------------------

  describe('AC 1 — completed_at comes from the database clock', () => {
    it('is set from now() inside the function, matching the database clock', async () => {
      const before = (await db.query('select now() as t')).rows[0].t

      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })

      const after = (await db.query('select now() as t')).rows[0].t

      expect(done.completed_at).not.toBeNull()
      // Bracketed by two readings of the DATABASE's own clock, so a client
      // clock could not produce this value even by coincidence.
      expect(new Date(done.completed_at).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime())
      expect(new Date(done.completed_at).getTime()).toBeLessThanOrEqual(new Date(after).getTime())
    })

    it('takes no timestamp argument at all, so a phone cannot offer one', async () => {
      // The signature is the guarantee. If an overload taking a timestamp is
      // ever added, this fails and the AC has to be revisited deliberately.
      const { rows } = await db.query(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'complete_chore'`,
      )
      expect(rows.map((r) => r.args)).toEqual(['chore_id uuid'])
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the column is not writable by a client
  // -------------------------------------------------------------------------

  describe('AC 2 — a client cannot write completed_at directly', () => {
    it('refuses a direct update for want of a column grant', async () => {
      const direct = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set completed_at = now() where id = $1', [choreId]),
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

    it('refuses a direct write of completed_by_member_id too, so attribution cannot be forged', async () => {
      const forged = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set completed_by_member_id = $1 where id = $2', [
            memberA,
            choreId,
          ]),
        ),
      )
      expect(forged.ok).toBe(false)
      expect(forged.error).toMatch(/permission denied/i)
    })

    it('and neither column is in the update grant, read from the catalog', async () => {
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      // 0003's set, unchanged. The convention is additive by column: this
      // migration adds two READABLE columns and no writable one.
      expect(rows.map((r) => r.column_name)).toEqual(['due_on', 'expected_minutes', 'title'])
    })

    it('but both are readable, because the list has to render them', async () => {
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'SELECT'
          order by column_name`,
      )
      // `assigned_member_id` is in this list because 0006 landed after this file
      // was written and the harness applies every migration in order — the set is
      // the schema's, not this story's. What #35 actually claims is the two
      // completion columns being present, which is asserted by name below so the
      // point survives the next migration widening the list again.
      const readable = rows.map((r) => r.column_name)
      expect(readable).toContain('completed_at')
      expect(readable).toContain('completed_by_member_id')
      expect(readable).toEqual([
        'assigned_member_id',
        'completed_at',
        'completed_by_member_id',
        'created_at',
        'due_on',
        'expected_minutes',
        'generated_from',
        'id',
        'repeat_kind',
        'repeat_weekdays',
        'title',
      ])
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — mutation evidence, in the style of 0002's own
  // -------------------------------------------------------------------------

  describe('AC 3 — MUTATION EVIDENCE: the withholding is what refuses the write', () => {
    it('with the revoke removed from the migration text, the identical direct update SUCCEEDS', async () => {
      // The AC says "the grant statement for completed_at is removed". There is
      // no such grant — that is the point of the design — so the statement that
      // does the withholding is 0003's table-level REVOKE. Removing it lets
      // Supabase's `grant all` default privileges reach the whole table again,
      // including every column added afterwards by this migration. Same
      // mechanism 0002 records, one migration later.
      const sql0003 = migrationSql('0003_chores.sql')
      const REVOKE = 'revoke select, insert, update on public.chores from authenticated;'

      // Assert the mutation was actually made. A silently-missed pattern would
      // report a mutation that never happened, and the result would read as
      // evidence — which is the exact failure this AC names.
      const hits = sql0003.split(REVOKE).length - 1
      expect(hits, `expected the revoke exactly once, found ${hits}`).toBe(1)

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
        -- email, because 0007 copies the organizer's address off this table.
        -- The stub in support/pgliteSupabase.js carries it too; this one is a
        -- deliberate second copy because the point of these mutated databases is
        -- to apply migrations the shared helper would not.
        create table auth.users (id uuid primary key default gen_random_uuid(), email text);
        create or replace function auth.uid() returns uuid language sql stable as $stub$
          select nullif(current_setting('test.uid', true), '')::uuid
        $stub$;
      `)
      await mutated.exec(migrationSql(MIGRATIONS[0]))
      await mutated.exec(migrationSql(MIGRATIONS[1]))
      await mutated.exec(sql0003.replace(REVOKE, ''))
      await mutated.exec(migrationSql('0004_chore_completion.sql'))

      const device = (await mutated.query('insert into auth.users default values returning id'))
        .rows[0].id
      const as = async (uid, fn) => {
        await mutated.exec('set role authenticated')
        await mutated.query(`select set_config('test.uid', $1, false)`, [uid])
        try {
          return await fn()
        } finally {
          await mutated.exec('reset role')
        }
      }
      const hh = await as(device, async () => {
        // Three arguments, not two: this mutated database stops at 0004, where
        // `create_household` is still 0002's `(name, organizer, pin)`. The
        // signature is a fact about the VINTAGE being mutated, so it does not
        // follow the head migration — a global rename to the new arity broke
        // exactly this call and nothing else.
        const { rows } = await mutated.query(
          'select * from public.create_household($1, $2, $3)',
          ['Mutant Household', 'Mutant Organizer', '4821'],
        )
        return rows[0]
      })
      const { rows: seeded } = await mutated.query(
        `insert into public.chores (household_id, title, expected_minutes, due_on)
         values ($1, 'Dishes', 20, '2026-08-10') returning id`,
        [hh.id],
      )

      const direct = await attempt(() =>
        as(device, () =>
          mutated.query('update public.chores set completed_at = now() where id = $1', [
            seeded[0].id,
          ]),
        ),
      )
      expect(direct.ok, 'without the revoke the direct write must succeed').toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — undo
  // -------------------------------------------------------------------------

  describe('AC 4 — a chore marked done in error goes back', () => {
    it('returns completed_at to null and re-appears in the outstanding list', async () => {
      await asDevice(db, deviceA, () => db.query('select public.complete_chore($1)', [choreId]))

      const back = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.uncomplete_chore($1)', [choreId])
        return rows[0]
      })
      expect(back.completed_at).toBeNull()

      const outstanding = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          `select count(*)::int as n from public.chores where completed_at is null`,
        )
        return rows[0].n
      })
      expect(outstanding).toBe(1)
    })

    it('clears the attribution too, so nobody is recorded as finishing unfinished work', async () => {
      await asDevice(db, deviceA, () => db.query('select public.complete_chore($1)', [choreId]))
      const back = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.uncomplete_chore($1)', [choreId])
        return rows[0]
      })
      expect(back.completed_by_member_id).toBeNull()
    })

    it('refuses an undo from another household, and the completion stands', async () => {
      // `uncomplete_chore` carries its own access rule, the same one
      // `complete_chore` carries, and until #62 nothing tested it: both existing
      // tests above call it from inside the household. Measured 2026-08-11 —
      // neutralising the predicate in uncomplete_chore reddened NOTHING while the
      // same mutation to complete_chore reddened two, which is the whole tell.
      //
      // It matters more than an undo sounds: this is the one function that can
      // erase a record of who did the work, so an outsider reaching it removes
      // evidence rather than adding a row.
      await asDevice(db, deviceA, () => db.query('select public.complete_chore($1)', [choreId]))
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2)', ['Other', 'Other Org']),
      )

      const refused = await attempt(() =>
        asDevice(db, deviceB, () => db.query('select public.uncomplete_chore($1)', [choreId])),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/i)

      // Read as the owner, bypassing RLS: a refusal that still wrote would
      // satisfy the assertion above and lose the attribution anyway.
      const { rows } = await db.query(
        'select completed_at, completed_by_member_id from public.chores where id = $1',
        [choreId],
      )
      expect(rows[0].completed_at).not.toBeNull()
      expect(rows[0].completed_by_member_id).toBe(memberA)
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 — another household's chore
  // -------------------------------------------------------------------------

  describe('AC 6 — completion is scoped to the household', () => {
    it('refuses a chore in another household, and the row re-reads unchanged', async () => {
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2)', ['Other', 'Other Org']),
      )

      const refused = await attempt(() =>
        asDevice(db, deviceB, () => db.query('select public.complete_chore($1)', [choreId])),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/i)

      const { rows } = await db.query('select completed_at from public.chores where id = $1', [
        choreId,
      ])
      expect(rows[0].completed_at).toBeNull()
    })

    it('POSITIVE CONTROL: the owning household succeeds on the same chore', async () => {
      const ok = await attempt(() =>
        asDevice(db, deviceA, () => db.query('select public.complete_chore($1)', [choreId])),
      )
      expect(ok.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 7 — the noticing signal: unassigned completion is allowed and attributed
  // -------------------------------------------------------------------------

  describe('AC 7 — completing a chore nobody was assigned', () => {
    it('is ACCEPTED, and records who did it', async () => {
      // Owner decision, 2026-08-08, option (a): allow it, attribute it, surface
      // nothing. Refusing would make the app argue with someone who has just
      // done the dishes.
      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.complete_chore($1)`, [
          choreId,
        ])
        return rows[0]
      })
      expect(done.completed_at).not.toBeNull()
      expect(done.completed_by_member_id).toBe(memberA)
    })

    it('attributes to the MEMBER row, never to the auth id', async () => {
      // members.id is the durable person; an idle anonymous session returns
      // after 30 days with a new auth id, so attribution keyed to auth.uid()
      // would detach a member from their own history.
      const done = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.complete_chore($1)', [choreId])
        return rows[0]
      })
      expect(done.completed_by_member_id).not.toBe(deviceA)
      const { rows } = await db.query('select id from public.members where id = $1', [
        done.completed_by_member_id,
      ])
      expect(rows).toHaveLength(1)
    })

    it('REFUSES a signed-in caller who has claimed no member — the state 0007 removed', async () => {
      // This test asserted the OPPOSITE until #62, and the reversal is the
      // behaviour change rather than a corrected mistake. Under device auth a
      // phone could join a household and claim nobody, so `complete_chore`
      // accepted the work and left attribution null — refusing it would have
      // been the same argument as refusing an unassigned completion, which AC 7
      // decided to allow.
      //
      // After 0007 that state cannot be reached. Membership IS a claimed member
      // row, so a caller who has claimed nobody is in no household, and the
      // chore is not found. The refusal is deliberately the same one a
      // nonexistent id gets: which of the two you hit is free information.
      const refused = await attempt(() =>
        asDevice(db, deviceB, () =>
          db.query('select * from public.complete_chore($1)', [choreId]),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/)

      // And the chore really is untouched — a refusal that still wrote would
      // pass the assertion above.
      const { rows } = await db.query(
        'select completed_at, completed_by_member_id from public.chores where id = $1',
        [choreId],
      )
      expect(rows[0].completed_at).toBeNull()
      expect(rows[0].completed_by_member_id).toBeNull()
    })
  })

  describe('0004 is re-runnable, because a human pastes it', () => {
    // Each test here builds its own database THROUGH this migration rather than
    // reusing the full-stack `db`. Re-pasting a superseded file on top of a
    // newer one is not the path a human takes, and after 0007 it is destructive:
    // it restores the four-argument `create_household` and the policies that
    // resolve through the dropped `household_devices`. Two of these assertions
    // went on passing while doing exactly that — a green test that had already
    // undone the migration under review.

    it('applies a second time without error', async () => {
      const at0004 = await databaseThrough('0004_chore_completion.sql')
      const second = await attempt(() => at0004.exec(migrationSql('0004_chore_completion.sql')))
      expect(second.error).toBeNull()
    })

    it('and a re-run does not widen the update grant', async () => {
      const db = await databaseThrough('0004_chore_completion.sql')
      await db.exec(migrationSql('0004_chore_completion.sql'))
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual(['due_on', 'expected_minutes', 'title'])
    })
  })
})
