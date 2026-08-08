// @vitest-environment node
//
// Node, not the repo-wide jsdom: PGlite loads its WASM and its pgcrypto bundle
// through fetch/Response, and jsdom's Response has no arrayBuffer() here — every
// test in the file would die at PGlite.create() with a TypeError that says
// nothing about environments. Same reason migrations.pglite.test.js carries the
// same docblock.
//
// #34 — the chore schema and its write rules, run against a real Postgres.
//
// A separate file from migrations.pglite.test.js rather than more describes
// inside it. That file is 485 lines about households, members and credentials,
// and its beforeEach builds an organizer, a child and a stranger for questions
// about identity. Chores need the same household and none of the PIN
// machinery, and one shared fixture serving both would grow a parameter for
// every story that lands on it.
//
// What a pass here means, and it is worth restating because the sentence is
// load-bearing: "consistent with Postgres, given the Supabase-shaped environment
// stubbed in support/pgliteSupabase.js". It does NOT mean "Supabase will accept
// this". Proving that against the live project is #38, which is externally
// gated on an owner-only dashboard action.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  MIGRATIONS,
  asDevice,
  attempt,
  freshDatabase,
  migrationFilesOnDisk,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

/** The columns a client may read, matching 0003's select grant. */
const READABLE = 'id, title, expected_minutes, due_on, created_at'

/**
 * A `date` column's value as YYYY-MM-DD, whatever the driver handed back.
 *
 * PGlite returns a `date` as a JS Date at UTC midnight, so `String(value)`
 * renders it in the RUNNER's local zone and reads as the previous day anywhere
 * behind UTC. Measured while writing this file: the assertion read
 * 'Sun Aug 09 2026 20:00:00 GMT-0400' for a chore due the 10th. That is the same
 * fault normalizeDueDate exists to prevent, arriving in the test rather than the
 * code — and a test that reads a date in local time would pass in CI (UTC) and
 * fail on this machine, or worse, the other way round.
 */
const asIsoDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

const HOUSEHOLD_PIN = '4821'

describe('chores, run against a real Postgres', () => {
  let db
  let deviceA
  let deviceB
  let householdA

  /** Insert a chore as a device, returning `{ ok, value, error }`. */
  async function insertChore(uid, { householdId, title = 'Dishes', minutes = 20, due = '2026-08-10' }) {
    return attempt(() =>
      asDevice(db, uid, async () => {
        const { rows } = await db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on)
           values ($1, $2, $3, $4) returning ${READABLE}`,
          [householdId, title, minutes, due],
        )
        return rows[0]
      }),
    )
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)
    deviceB = await newDevice(db)

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
        'Placeholder Household',
        'Placeholder Organizer',
        HOUSEHOLD_PIN,
      ])
      return rows[0]
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — a chore is a titled unit of expected minutes, due on a DATE
  // -------------------------------------------------------------------------

  describe('AC 1 — a chore is minutes of work with a due date', () => {
    it('stores the household, title, minutes and due date that were submitted', async () => {
      const added = await insertChore(deviceA, {
        householdId: householdA.id,
        title: 'Dishes',
        minutes: 20,
        due: '2026-08-10',
      })

      expect(added.error).toBeNull()
      expect(added.value.title).toBe('Dishes')
      expect(added.value.expected_minutes).toBe(20)
      expect(asIsoDate(added.value.due_on)).toBe('2026-08-10')

      // AC 1 asks that the row carry the household_id, and a client cannot read
      // that column — 0003 withholds it, which is what makes `select *` fail.
      // Read it as the table owner instead, which is exactly the situation the
      // withheld column creates and therefore the honest way to check it.
      const { rows } = await db.query('select household_id from public.chores where id = $1', [
        added.value.id,
      ])
      expect(rows[0].household_id).toBe(householdA.id)
    })

    it('due_on is a DATE column, not text — the recurrence stories cannot schedule against "Monday"', async () => {
      const { rows } = await db.query(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'due_on'`,
      )
      expect(rows[0].data_type).toBe('date')
    })

    it('POSITIVE CONTROL: the same assertion would catch a text column, so it is not vacuous', async () => {
      // If information_schema simply answered `date` for everything, the test
      // above would pass on any schema at all. `title` is text and must read as
      // text — one query away from proving the instrument discriminates.
      const { rows } = await db.query(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'title'`,
      )
      expect(rows[0].data_type).toBe('text')
    })

    it('expected_minutes is an integer column, so 20.5 minutes cannot be stored at all', async () => {
      const { rows } = await db.query(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'expected_minutes'`,
      )
      expect(rows[0].data_type).toBe('integer')
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the minutes bound is a NAMED check constraint
  // -------------------------------------------------------------------------

  describe('AC 2 — the database refuses minutes the form would also refuse', () => {
    it('POSITIVE CONTROL: a valid chore inserts, so a refusal below is the constraint and not a broken path', async () => {
      const ok = await insertChore(deviceA, { householdId: householdA.id, minutes: 20 })
      expect(ok.error).toBeNull()
      expect(ok.value.expected_minutes).toBe(20)
    })

    // Asserted against the constraint NAME chosen in 0003, never against
    // Postgres's generated message text — that text is not a contract, and a
    // test asserting on it passes or fails on a Postgres version rather than on
    // the rule.
    for (const [label, minutes] of [
      ['zero', 0],
      ['negative', -30],
      ['above a day of work', 1441],
    ]) {
      it(`refuses ${label} minutes, by the named constraint chores_expected_minutes_range`, async () => {
        const refused = await insertChore(deviceA, { householdId: householdA.id, minutes })
        expect(refused.ok).toBe(false)
        expect(refused.error).toMatch(/chores_expected_minutes_range/)
      })
    }

    it('refuses a non-integer, which the column type catches before the constraint does', async () => {
      const refused = await insertChore(deviceA, { householdId: householdA.id, minutes: 20.5 })
      expect(refused.ok).toBe(false)
    })

    it('refuses a blank title, by the named constraint chores_title_length', async () => {
      const refused = await insertChore(deviceA, { householdId: householdA.id, title: '   ' })
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/chores_title_length/)
    })

    it('accepts both ends of the range, so the bound is inclusive as written', async () => {
      const low = await insertChore(deviceA, { householdId: householdA.id, minutes: 1 })
      const high = await insertChore(deviceA, { householdId: householdA.id, minutes: 1440 })
      expect(low.error).toBeNull()
      expect(high.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — a household sees its own chores and nobody else's
  // -------------------------------------------------------------------------

  describe('AC 3 — chores are scoped to the household', () => {
    it('device B sees none of household A rows, and device A sees them — so the empty result is a refusal', async () => {
      await insertChore(deviceA, { householdId: householdA.id, title: 'Dishes' })

      // B is in a household of its own, not merely unjoined.
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2, $3)', [
          'Other Household',
          'Other Organizer',
          '9999',
        ]),
      )

      // Deliberately NOT filtered by household_id. A client cannot name that
      // column in a WHERE either — withholding the select grant removes it from
      // every clause, not just the projection — and it does not need to: RLS is
      // the filter. This is the query the app actually issues.
      const query = 'select count(*)::int as n from public.chores'

      const seenByB = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query(query)
        return rows[0].n
      })
      // The identical query, as the household that owns the row. If these two
      // ever agree, the fixture is broken rather than the rule being proven.
      const seenByA = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(query)
        return rows[0].n
      })

      expect(seenByB).toBe(0)
      expect(seenByA).toBe(1)
    })

    it('a device that has joined nothing sees no chores at all', async () => {
      await insertChore(deviceA, { householdId: householdA.id })
      const stranger = await newDevice(db)

      const seen = await asDevice(db, stranger, async () => {
        const { rows } = await db.query('select count(*)::int as n from public.chores')
        return rows[0].n
      })
      expect(seen).toBe(0)
    })

    it('a device in another household cannot edit or delete a chore it cannot see', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2, $3)', ['Other', 'Other Org', '9999']),
      )

      await asDevice(db, deviceB, () =>
        db.query('update public.chores set title = $1 where id = $2', ['Hijacked', chore.value.id]),
      )
      await asDevice(db, deviceB, () =>
        db.query('delete from public.chores where id = $1', [chore.value.id]),
      )

      // Both statements affect zero rows rather than erroring — that is how RLS
      // refuses an UPDATE or DELETE — so the proof is that the row is untouched.
      const after = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select title from public.chores where id = $1', [
          chore.value.id,
        ])
        return rows
      })
      expect(after).toHaveLength(1)
      expect(after[0].title).toBe('Dishes')
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — the with-check policy on insert
  // -------------------------------------------------------------------------

  describe('AC 4 — a device cannot file a chore into a household it has not joined', () => {
    it('refuses an insert naming another household', async () => {
      const otherHousehold = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
          'Other Household',
          'Other Organizer',
          '9999',
        ])
        return rows[0]
      })

      const refused = await insertChore(deviceA, { householdId: otherHousehold.id })
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/row-level security/i)
    })

    it('POSITIVE CONTROL: the same insert into its own household succeeds', async () => {
      const allowed = await insertChore(deviceA, { householdId: householdA.id })
      expect(allowed.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — column grants, the shape 0002 established
  // -------------------------------------------------------------------------

  describe('AC 5 — the grants are per column, because RLS is row-level', () => {
    it('an explicit column list reads, and select(*) fails outright rather than omitting a column', async () => {
      await insertChore(deviceA, { householdId: householdA.id })

      const explicit = await attempt(() =>
        asDevice(db, deviceA, () => db.query(`select ${READABLE} from public.chores`)),
      )
      expect(explicit.error).toBeNull()

      const star = await attempt(() =>
        asDevice(db, deviceA, () => db.query('select * from public.chores')),
      )
      // `select *` expands to every column including `household_id`, which is
      // not granted, so it is refused as a whole. That is the behaviour we want:
      // it fails loudly at the client instead of quietly returning a narrower
      // row. MEASURED: with every column granted this assertion FAILS — the
      // wildcard succeeds — which is why 0003 withholds one.
      expect(star.ok, 'select * must fail, not silently omit a column').toBe(false)
      expect(star.error).toMatch(/permission denied/i)
    })

    it('a client may edit a chore description', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })

      const edited = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set title = $1, expected_minutes = $2 where id = $3', [
            'Dishes and counters',
            30,
            chore.value.id,
          ]),
        ),
      )
      expect(edited.error).toBeNull()
    })

    it('REGRESSION: a client cannot move a chore into another household by writing household_id', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      const otherHousehold = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
          'Other Household',
          'Other Organizer',
          '9999',
        ])
        return rows[0]
      })

      const moved = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set household_id = $1 where id = $2', [
            otherHousehold.id,
            chore.value.id,
          ]),
        ),
      )
      // Refused by the column grant, not by the policy — `household_id` is
      // simply not in 0003's update grant, so there is no value it could be set
      // to. This is the convention #35, #36 and #37 inherit.
      expect(moved.ok).toBe(false)
      expect(moved.error).toMatch(/permission denied/i)
    })

    it('`anon` holds NOTHING on this table — checked at TABLE level, not column level', async () => {
      // The catalog matters more than the assertion here. An earlier version of
      // this test queried `column_privileges` and was named as though it proved
      // anon could not write; MEASURED, that catalog reports only the four
      // column-grantable privileges (SELECT/INSERT/UPDATE/REFERENCES) and is
      // structurally incapable of reporting DELETE, TRUNCATE or TRIGGER — which
      // is exactly what anon still held. A test that cannot observe the thing
      // its name claims is worse than absent, because it reads as coverage.
      const tableLevel = await db.query(
        `select privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'chores' and grantee = 'anon'`,
      )
      expect(tableLevel.rows.map((r) => r.privilege_type)).toEqual([])

      const columnLevel = await db.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores' and grantee = 'anon'`,
      )
      expect(columnLevel.rows.map((r) => r.privilege_type)).toEqual([])
    })

    it('POSITIVE CONTROL: table_privileges CAN see a delete grant, so the empty result above means something', async () => {
      // Without this, the assertion above passes if the query is simply wrong —
      // a misspelled table name returns zero rows just as convincingly.
      // `authenticated` must still hold DELETE, because
      // chores_delete_same_household needs it.
      const { rows } = await db.query(
        `select privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'DELETE'`,
      )
      expect(rows).toHaveLength(1)
    })

    it('and a joined device can still delete its own household chore, so the revoke did not overreach', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      await asDevice(db, deviceA, () =>
        db.query('delete from public.chores where id = $1', [chore.value.id]),
      )
      const { rows } = await db.query('select count(*)::int as n from public.chores where id = $1', [
        chore.value.id,
      ])
      expect(rows[0].n).toBe(0)
    })

    it('the granted column sets are exactly what 0003 says, so a widening is visible here', async () => {
      const granted = async (privilege) => {
        const { rows } = await db.query(
          `select column_name from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'chores'
              and grantee = 'authenticated' and privilege_type = $1
            order by column_name`,
          [privilege],
        )
        return rows.map((r) => r.column_name)
      }

      // Widened by 0004, which made completion READABLE and neither column
      // writable. The update set below is unchanged, which is the convention
      // working: additive by column, and no later story revokes a shipped grant.
      expect(await granted('SELECT')).toEqual([
        'completed_at',
        'completed_by_member_id',
        'created_at',
        'due_on',
        'expected_minutes',
        'id',
        'title',
      ])
      expect(await granted('INSERT')).toEqual(['due_on', 'expected_minutes', 'household_id', 'title'])
      expect(await granted('UPDATE')).toEqual(['due_on', 'expected_minutes', 'title'])
    })

    it('the columns later stories add are absent, so their write guards land with them', async () => {
      // #35 arrived and brought completed_at with its own write guard, which is
      // the convention working rather than an exception to it. #36's
      // assigned_member_id is still absent, and declaring it here would put the
      // test proving a client cannot write it in a story with no reason to try.
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'chores'
          order by column_name`,
      )
      const columns = rows.map((r) => r.column_name)
      expect(columns).toContain('completed_at')
      expect(columns).not.toContain('assigned_member_id')
    })
  })

  // -------------------------------------------------------------------------
  // AC 7 — the file is applied by a human pasting it, twice
  // -------------------------------------------------------------------------

  describe('AC 7 — 0003 is re-runnable', () => {
    it('applies a second time without error, because a re-paste is the normal path', async () => {
      const second = await attempt(() => db.exec(migrationSql('0003_chores.sql')))
      expect(second.error).toBeNull()
    })

    it('and a re-run does not widen the grants — the revoke/grant pair is idempotent too', async () => {
      await db.exec(migrationSql('0003_chores.sql'))
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

// ---------------------------------------------------------------------------
// AC 8 — a migration on disk that nothing applies is a migration nothing tests
// ---------------------------------------------------------------------------

describe('AC 8 — the migration list cannot silently fall behind the directory', () => {
  it('every .sql file in supabase/migrations is in the MIGRATIONS array', () => {
    const onDisk = migrationFilesOnDisk()
    const missing = onDisk.filter((name) => !MIGRATIONS.includes(name))

    expect(
      missing,
      `supabase/migrations contains ${missing.join(', ')}, which src/test/support/pgliteSupabase.js ` +
        'never applies — so that migration is untested while this suite stays green. Add it to MIGRATIONS.',
    ).toEqual([])
  })

  it('and every entry in MIGRATIONS is a file that exists — the other direction', () => {
    const onDisk = migrationFilesOnDisk()
    const phantom = MIGRATIONS.filter((name) => !onDisk.includes(name))
    expect(phantom, `MIGRATIONS names ${phantom.join(', ')}, which is not on disk`).toEqual([])
  })

  it('POSITIVE CONTROL: the check reads the real directory, so it can see a file at all', () => {
    // Without this, both assertions above pass vacuously if migrationFilesOnDisk
    // ever returns an empty list — a wrong path, a changed layout — and an empty
    // list satisfies "nothing is missing" perfectly.
    expect(migrationFilesOnDisk().length).toBeGreaterThanOrEqual(3)
    expect(migrationFilesOnDisk()).toContain('0003_chores.sql')
  })
})
