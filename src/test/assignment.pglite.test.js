// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #36 — giving a chore to a person, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — that is #38, externally gated on an owner-only dashboard action.
//
// Every access claim in this story lives HERE rather than in a component test,
// which is AC 10 stated as a place rather than as a rule: a fake Supabase client
// returns whatever the test tells it to, so it cannot refuse, so a refusal
// asserted against one proves nothing about the database.

import { beforeEach, describe, expect, it } from 'vitest'
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


describe('assigning a chore, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, householdB, memberA, memberB, outsiderMember, choreId

  const seedChore = async (household, title = 'Dishes', minutes = 20) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-10') returning id`,
      [household, title, minutes],
    )
    return rows[0].id
  }

  const seedMember = async (household, name, minutes) => {
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, $2, $3) returning id`,
      [household, name, minutes],
    )
    return rows[0].id
  }

  /** Read the row as the OWNER, bypassing every grant — the ground truth. */
  const assigneeOf = async (id) => {
    const { rows } = await db.query('select assigned_member_id from public.chores where id = $1', [
      id,
    ])
    return rows[0]?.assigned_member_id ?? null
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
    householdB = await asDevice(db, deviceB, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })

    memberA = householdA.organizer_member_id
    memberB = await seedMember(householdA.id, 'Placeholder Two', 60)
    outsiderMember = householdB.organizer_member_id
    choreId = await seedChore(householdA.id)
  })

  // -------------------------------------------------------------------------
  // AC 1 — the column holds a MEMBER, and only for a person in this household
  // -------------------------------------------------------------------------

  describe('AC 1 — assign_chore', () => {
    it('puts the members.id in the column, never an auth user id', async () => {
      const assigned = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.assign_chore($1, $2)', [
          choreId,
          memberA,
        ])
        return rows[0]
      })

      expect(assigned.assigned_member_id).toBe(memberA)
      // The distinction the AC actually names. `deviceA` is the auth uid that
      // owns memberA, so a function that wrote auth.uid() would produce a
      // plausible uuid and every other assertion here would still pass.
      expect(assigned.assigned_member_id).not.toBe(deviceA)
      expect(await assigneeOf(choreId)).toBe(memberA)
    })

    it('refuses a member of a DIFFERENT household, in this story\'s words, and changes nothing', async () => {
      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('select * from public.assign_chore($1, $2)', [choreId, outsiderMember]),
        ),
      )

      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/that person is not in this household/)
      expect(await assigneeOf(choreId)).toBeNull()
    })

    it('refuses a caller who has not joined the chore\'s household, and changes nothing', async () => {
      // Device B is a real, authenticated device in a real household — just not
      // this one. The refusal is the same one a nonexistent chore id gets, so
      // which of the two you hit is free information.
      const refused = await attempt(() =>
        asDevice(db, deviceB, () =>
          db.query('select * from public.assign_chore($1, $2)', [choreId, outsiderMember]),
        ),
      )

      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/)
      expect(await assigneeOf(choreId)).toBeNull()
    })

    it('refuses a null person rather than treating it as an unassign', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )

      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('select * from public.assign_chore($1, $2)', [choreId, null]),
        ),
      )

      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/use unassign_chore to clear it/)
      // The part that matters: a dropped variable did NOT silently take the
      // chore off the person holding it.
      expect(await assigneeOf(choreId)).toBe(memberA)
    })

    it('moves a chore from one person to another without needing an unassign first', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberB]),
      )
      expect(await assigneeOf(choreId)).toBe(memberB)
    })

    it('BACKSTOP: the composite foreign key refuses a cross-household member even as the owner', async () => {
      // The function's check produces the sentence; this constraint is what keeps
      // the rule true if the function is later edited wrongly. Run as the table
      // OWNER, which bypasses RLS and every column grant — so the only thing that
      // can refuse this write is the constraint itself.
      const forced = await attempt(() =>
        db.query('update public.chores set assigned_member_id = $1 where id = $2', [
          outsiderMember,
          choreId,
        ]),
      )
      expect(forced.ok, 'the composite FK is the rule that survives a bad function').toBe(false)
      expect(forced.error).toMatch(/chores_assigned_member_in_household/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the column is not client-writable, and the grant set is not empty
  // -------------------------------------------------------------------------

  describe('AC 2 — a client cannot write assigned_member_id directly', () => {
    it('refuses the direct update for want of a column grant, while an allowed column still writes', async () => {
      const direct = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set assigned_member_id = $1 where id = $2', [
            memberA,
            choreId,
          ]),
        ),
      )

      expect(direct.ok).toBe(false)
      // The privilege error specifically. A row-level refusal would report zero
      // rows changed rather than throwing, and an RLS-shaped failure here would
      // mean the column grant was not what refused it.
      expect(direct.error).toMatch(/permission denied/i)
      expect(await assigneeOf(choreId)).toBeNull()

      // POSITIVE CONTROL, which the AC asks for by name: the same role, the same
      // row, a column that IS granted. Without this the refusal above is equally
      // consistent with the client having no update grant at all.
      const allowed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set title = $1 where id = $2', ['Dishes twice', choreId]),
        ),
      )
      expect(allowed.ok, 'the grant set must not be simply empty').toBe(true)
    })

    it('but it is readable, because the assignee has to render', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )
      const read = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('select assigned_member_id from public.chores where id = $1', [choreId]),
        ),
      )
      expect(read.ok).toBe(true)
      expect(read.value.rows[0].assigned_member_id).toBe(memberA)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — mutation evidence, in the style of 0002's and #35's own
  // -------------------------------------------------------------------------

  describe('AC 3 — MUTATION EVIDENCE: the withholding is what refuses the write', () => {
    it('with the revoke removed from the migration text, the identical direct update SUCCEEDS', async () => {
      // The AC says "the grant statement for assigned_member_id is removed".
      // There is no such grant — that is the design — so the statement doing the
      // withholding is 0003's table-level REVOKE. Removing it lets Supabase's
      // `grant all` default privileges reach the whole table again, including
      // every column added afterwards. Same mechanism 0002 records and #35
      // reproduced one migration later.
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
        grant usage on schema public, extensions to anon, authenticated;
        alter default privileges in schema public grant all on tables to anon, authenticated;
        -- email, because 0007 copies the organizer's address off this table.
        -- The stub in support/pgliteSupabase.js carries it too; this one is a
        -- deliberate second copy because the point of these mutated databases is
        -- to apply migrations the shared helper would not.
        create table auth.users (id uuid primary key default gen_random_uuid(), email text);
        create or replace function auth.uid() returns uuid language sql stable as $stub$
          select nullif(current_setting('test.uid', true), '')::uuid
        $stub$;
      `)
      for (const name of MIGRATIONS) {
        await mutated.exec(name === '0003_chores.sql' ? sql0003.replace(REVOKE, '') : migrationSql(name))
      }

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
        const { rows } = await mutated.query('select * from public.create_household($1, $2)', [
          'Mutant Household',
          'Mutant Organizer',
        ])
        return rows[0]
      })
      const { rows: seeded } = await mutated.query(
        `insert into public.chores (household_id, title, expected_minutes, due_on)
         values ($1, 'Dishes', 20, '2026-08-10') returning id`,
        [hh.id],
      )

      const direct = await attempt(() =>
        as(device, () =>
          mutated.query('update public.chores set assigned_member_id = $1 where id = $2', [
            hh.organizer_member_id,
            seeded[0].id,
          ]),
        ),
      )
      expect(direct.ok, 'without the revoke the direct write must succeed').toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — unassigning
  // -------------------------------------------------------------------------

  describe('AC 4 — unassign_chore', () => {
    it('returns the chore to the unassigned group', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )
      const back = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.unassign_chore($1)', [choreId])
        return rows[0]
      })

      expect(back.assigned_member_id).toBeNull()
      expect(await assigneeOf(choreId)).toBeNull()
    })

    it('and the member\'s outstanding minutes fall by exactly that chore\'s expected minutes', async () => {
      // The end-to-end form of the derivation, asserted in SQL rather than only
      // in the JS unit test. "It is derived, so it must follow" is the reasoning
      // that stops anybody checking.
      const other = await seedChore(householdA.id, 'Placeholder Other Chore', 35)
      const committed = async () => {
        const { rows } = await db.query(
          `select coalesce(sum(expected_minutes), 0)::int as total from public.chores
            where assigned_member_id = $1 and completed_at is null`,
          [memberA],
        )
        return rows[0].total
      }

      await asDevice(db, deviceA, async () => {
        await db.query('select * from public.assign_chore($1, $2)', [choreId, memberA])
        await db.query('select * from public.assign_chore($1, $2)', [other, memberA])
      })
      expect(await committed()).toBe(55)

      await asDevice(db, deviceA, () => db.query('select * from public.unassign_chore($1)', [other]))
      expect(await committed()).toBe(20)
    })

    it('refuses a caller outside the household, so it is not a way around assign', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )
      const refused = await attempt(() =>
        asDevice(db, deviceB, () => db.query('select * from public.unassign_chore($1)', [choreId])),
      )

      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such chore in your household/)
      expect(await assigneeOf(choreId)).toBe(memberA)
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — derived, and nothing stored
  // -------------------------------------------------------------------------

  describe('AC 5 — no stored counter anywhere in public', () => {
    it('no table carries a committed, remaining or done minutes column', async () => {
      // The failure this guards is not a bug in today's code — it is somebody
      // adding `members.committed_minutes` later "for speed", which every test
      // that checks only the SUM stays green through. Scanned across the whole
      // schema rather than `members` alone, because the shortcut is just as
      // tempting on `chores` or on a new summary table.
      const { rows } = await db.query(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public'
          order by table_name, column_name`,
      )
      const offenders = rows
        .map((r) => `${r.table_name}.${r.column_name}`)
        .filter((qualified) =>
          /(committed|remaining|done)_minutes$|_minutes_(committed|remaining|done)$/.test(qualified),
        )
      expect(offenders, `stored aggregate columns: ${offenders.join(', ')}`).toEqual([])
    })

    it('POSITIVE CONTROL: the scan reads real columns, so an empty result is not a blind query', async () => {
      // Without this, the assertion above passes identically when the query is
      // wrong, the schema is empty, or the regex never matches anything.
      const { rows } = await db.query(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public'`,
      )
      const qualified = rows.map((r) => `${r.table_name}.${r.column_name}`)
      expect(qualified).toContain('members.weekly_minutes')
      expect(qualified).toContain('chores.expected_minutes')
      // And the regex itself can fire — proving the empty result above is
      // "nothing matched" rather than "nothing could match".
      expect(['members.committed_minutes'].filter((q) => /(committed|remaining|done)_minutes$/.test(q))).toEqual([
        'members.committed_minutes',
      ])
    })
  })

  // -------------------------------------------------------------------------
  // AC 7 — removing a person releases their work, it does not destroy it
  // -------------------------------------------------------------------------

  describe('AC 7 — a removed member leaves their chores behind', () => {
    it('unassigns the chore rather than deleting it', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberB]),
      )
      expect(await assigneeOf(choreId)).toBe(memberB)

      await asDevice(db, deviceA, () =>
        db.query('delete from public.members where id = $1', [memberB]),
      )

      const { rows } = await db.query(
        'select id, household_id, assigned_member_id from public.chores where id = $1',
        [choreId],
      )
      expect(rows, 'the chore must survive the person').toHaveLength(1)
      expect(rows[0].assigned_member_id).toBeNull()
      // The half the column-list SET NULL clause exists for: a bare
      // `on delete set null` on this composite key would try to null
      // household_id too, which is `not null` — so the delete would fail rather
      // than release the chore.
      expect(rows[0].household_id).toBe(householdA.id)
    })
  })

  // -------------------------------------------------------------------------
  // 0006 is applied by a human pasting it, twice
  // -------------------------------------------------------------------------

  describe('0006 is re-runnable, because a re-paste is the normal path', () => {
    // Each test here builds its own database THROUGH this migration rather than
    // reusing the full-stack `db`. Re-pasting a superseded file on top of a
    // newer one is not the path a human takes, and after 0007 it is destructive:
    // it restores the four-argument `create_household` and the policies that
    // resolve through the dropped `household_devices`. Two of these assertions
    // went on passing while doing exactly that — a green test that had already
    // undone the migration under review.

    it('applies a second time without error', async () => {
      const at0006 = await databaseThrough('0006_chore_assignment.sql')
      const second = await attempt(() => at0006.exec(migrationSql('0006_chore_assignment.sql')))
      expect(second.error).toBeNull()
    })

    it('and a re-run does not widen the grants', async () => {
      const db = await databaseThrough('0006_chore_assignment.sql')
      await db.exec(migrationSql('0006_chore_assignment.sql'))
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual(['due_on', 'expected_minutes', 'title'])
    })

    it('and an assignment made before the re-paste survives it', async () => {
      // Re-pastes the HEAD migration, not 0006. The data question is the same —
      // does a re-paste preserve rows — but the file a human re-pastes today is
      // 0007, and running 0006 here would re-point `assign_chore` back at the
      // dropped device table and leave the suite asserting against a schema
      // nobody has.
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [choreId, memberA]),
      )
      await db.exec(migrationSql('0007_per_member_auth.sql'))
      expect(await assigneeOf(choreId)).toBe(memberA)
    })
  })
})
