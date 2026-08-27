// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #12 — expected-vs-actual capture, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". The pure arithmetic the
// screen renders is in src/lib/chores.test.js; what lives here is the half
// only the database can prove — the seed at completion, the reopen clause,
// the constraint, and the grants.

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

describe('actual minutes, run against a real Postgres', () => {
  let db, deviceA, householdA, choreId

  const seedChore = async (household, title = 'Dishes', minutes = 20) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-10') returning id`,
      [household, title, minutes],
    )
    return rows[0].id
  }

  const complete = (id) =>
    asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.complete_chore($1)', [id])
      return rows[0]
    })

  const uncomplete = (id) =>
    asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.uncomplete_chore($1)', [id])
      return rows[0]
    })

  const readRow = async (id) =>
    (await db.query('select expected_minutes, actual_minutes, completed_at from public.chores where id = $1', [id]))
      .rows[0]

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    choreId = await seedChore(householdA.id)
  })

  describe('AC 1 — the zero-tap default is the honest-data path', () => {
    it('completing seeds actual_minutes to expected_minutes, stored as its own field', async () => {
      const done = await complete(choreId)
      expect(done.actual_minutes).toBe(20)
      expect(done.expected_minutes).toBe(20)
    })

    it('an adjusted actual never touches the estimate, and an estimate edit never touches the actual', async () => {
      await complete(choreId)
      await asDevice(db, deviceA, () =>
        db.query('update public.chores set actual_minutes = 35 where id = $1', [choreId]),
      )
      expect(await readRow(choreId)).toMatchObject({ expected_minutes: 20, actual_minutes: 35 })

      await asDevice(db, deviceA, () =>
        db.query('update public.chores set expected_minutes = 25 where id = $1', [choreId]),
      )
      expect(await readRow(choreId)).toMatchObject({ expected_minutes: 25, actual_minutes: 35 })
    })

    it('a reopened chore RETAINS its actual', async () => {
      await complete(choreId)
      await asDevice(db, deviceA, () =>
        db.query('update public.chores set actual_minutes = 35 where id = $1', [choreId]),
      )
      const back = await uncomplete(choreId)
      expect(back.completed_at).toBeNull()
      expect(back.actual_minutes).toBe(35)
    })

    it('re-completing keeps the retained actual rather than stamping the estimate back over it', async () => {
      // The coalesce in complete_chore is what this proves: a plain overwrite
      // would pass the seeding test above and still erase a person's entry on
      // every done → not-done-after-all → done round trip.
      await complete(choreId)
      await asDevice(db, deviceA, () =>
        db.query('update public.chores set actual_minutes = 35 where id = $1', [choreId]),
      )
      await uncomplete(choreId)
      const again = await complete(choreId)
      expect(again.actual_minutes).toBe(35)
    })
  })

  describe('the constraint — chores_actual_minutes_range', () => {
    it('accepts ZERO: "it took no time" is a fact, not an error', async () => {
      await complete(choreId)
      const zero = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set actual_minutes = 0 where id = $1', [choreId]),
        ),
      )
      expect(zero.error).toBeNull()
      expect((await readRow(choreId)).actual_minutes).toBe(0)
    })

    it('refuses negative time and more than a day, by name', async () => {
      await complete(choreId)
      for (const bad of [-5, 1441]) {
        const refused = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query(`update public.chores set actual_minutes = ${bad} where id = $1`, [choreId]),
          ),
        )
        expect(refused.ok).toBe(false)
        expect(refused.error).toMatch(/chores_actual_minutes_range/)
      }
    })
  })

  describe('the grants — adjustable after the fact, never claimable in advance', () => {
    it('a household member may update actual_minutes directly', async () => {
      await complete(choreId)
      const allowed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set actual_minutes = 45 where id = $1', [choreId]),
        ),
      )
      expect(allowed.error).toBeNull()
    })

    it('a client cannot INSERT an actual — work that has not happened has no duration', async () => {
      const claimed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, actual_minutes)
             values ($1, 'Dishes again', 20, '2026-08-11', 5)`,
            [householdA.id],
          ),
        ),
      )
      expect(claimed.ok).toBe(false)
      expect(claimed.error).toMatch(/permission denied/i)
    })

    it('POSITIVE CONTROL: the same insert without actual_minutes is ALLOWED', async () => {
      // Without this, the refusal above is satisfied by a broken session or an
      // empty grant set — neither of which is the rule under test.
      const plain = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on)
             values ($1, 'Dishes again', 20, '2026-08-11')`,
            [householdA.id],
          ),
        ),
      )
      expect(plain.error).toBeNull()
    })

    it('actual_minutes is readable, because the done row renders it', async () => {
      await complete(choreId)
      const read = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('select actual_minutes from public.chores where id = $1', [choreId]),
        ),
      )
      expect(read.error).toBeNull()
    })
  })

  describe('0015 is re-runnable, because a human pastes it', () => {
    it('applies a second time without error, and does not widen the grants', async () => {
      const again = await attempt(() => db.exec(migrationSql('0015_actual_minutes.sql')))
      expect(again.error).toBeNull()

      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'INSERT'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).not.toContain('actual_minutes')
    })
  })
})
