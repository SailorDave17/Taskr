// @vitest-environment node
//
// Node, not the repo-wide jsdom: PGlite loads its WASM and its pgcrypto bundle
// through fetch/Response, and jsdom's Response has no arrayBuffer() here — every
// test in the file would die at PGlite.create() with a TypeError that says
// nothing about environments. Same docblock as the other pglite suites, for the
// same reason.
//
// #44 — capacity as a fact about a particular week, run against a real Postgres.
//
// What a pass here means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". It does NOT mean "Supabase
// will accept this". Proving that against the live project is #45, which is
// externally gated on an owner-only dashboard paste.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationFilesOnDisk,
  migrationSql,
  newDevice,
  provisionMember,
  databaseThrough,
  MIGRATIONS,
} from './support/pgliteSupabase.js'
// The pure resolvers, imported rather than reimplemented: #44 AC 7 asserts there
// is exactly one implementation of effective capacity across all of src/, and a
// second one written here to avoid an import would break that and be wrong in a
// different way from the first.
import { capacitiesFor, effectiveCapacity } from '../lib/capacity.js'

/** The columns a client may read, matching 0005's select grant. */
const READABLE = 'id, member_id, period_start, minutes, note, source, created_at'

/**
 * A `date` column's value as YYYY-MM-DD, whatever the driver handed back.
 *
 * PGlite returns a `date` as a JS Date at UTC midnight, so `String(value)`
 * renders it in the RUNNER's local zone and reads as the previous day anywhere
 * behind UTC. MEASURED while writing this file: the assertion read 'Sun Aug 09'
 * for a period correctly stored as 2026-08-10. Same idiom as
 * chores.pglite.test.js, and the same fault periodStartFor exists to prevent —
 * arriving in the test rather than the code.
 */
function isoDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

/** A Monday, so the period constraint is satisfied by everything that should be. */
const MONDAY = '2026-08-10'
const LAST_MONDAY = '2026-08-03'

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

describe('weekly capacity, run against a real Postgres', () => {
  let db
  let organizerDevice
  let strangerDevice
  let household
  let organizer
  let child

  beforeEach(async () => {
    db = await freshDatabase()

    organizerDevice = await newDevice(db)
    strangerDevice = await newDevice(db)

    await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query(
        `select * from public.create_household('Ours', 'Alex', 'America/New_York')`,
      )
      household = rows[0]
      // No `where household_id = $1`: #62 withholds that column from the members
      // SELECT grant, so naming it in a WHERE is `permission denied for table
      // members`. RLS already scopes this read to the caller's own household,
      // which is what made the filter redundant even before it became illegal.
      const members = await db.query(`select id, display_name from public.members`)
      organizer = members.rows[0]
      const added = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, 'Sam', 300) returning id, display_name, weekly_minutes`,
        [household.id],
      )
      child = added.rows[0]
    })

    // A stranger with a household of their own, so "cannot see" is tested
    // against a real other family rather than against having no household.
    await asDevice(db, strangerDevice, async () => {
      await db.query(`select * from public.create_household('Theirs', 'Robin', 'UTC')`)
    })
  })

  describe('AC 1 — the override records the week, the minutes, and where it came from', () => {
    it('stores member, period, minutes, an optional note and how it was entered', async () => {
      const row = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `insert into public.member_capacity
             (household_id, member_id, period_start, minutes, note, source)
           values ($1, $2, $3, 90, 'away Thursday', 'manual')
           returning ${READABLE}`,
          [household.id, child.id, MONDAY],
        )
        return rows[0]
      })
      expect(row.member_id).toBe(child.id)
      expect(isoDate(row.period_start)).toBe(MONDAY)
      expect(row.minutes).toBe(90)
      expect(row.note).toBe('away Thursday')
      expect(row.source).toBe('manual')
    })

    it('leaves members.weekly_minutes untouched — the baseline is still the baseline', async () => {
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 30)`,
          [household.id, child.id, MONDAY],
        )
      })
      const { rows } = await db.query(`select weekly_minutes from public.members where id = $1`, [
        child.id,
      ])
      expect(rows[0].weekly_minutes).toBe(300)
    })

    it('REFUSES a period that is not a Monday, so the constant cannot be worked around', async () => {
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.member_capacity (household_id, member_id, period_start, minutes)
             values ($1, $2, '2026-08-11', 30)`,
            [household.id, child.id],
          ),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/period_is_monday/)
    })

    it('allows only one override per person per week — a second is a correction', async () => {
      const result = await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 30)`,
          [household.id, child.id, MONDAY],
        )
        return attempt(() =>
          db.query(
            `insert into public.member_capacity (household_id, member_id, period_start, minutes)
             values ($1, $2, $3, 60)`,
            [household.id, child.id, MONDAY],
          ),
        )
      })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/one_per_period/)
    })

    it('refuses an override naming a member of another household', async () => {
      const otherMember = await db.query(
        `select m.id from public.members m
         join public.households h on h.id = m.household_id
         where h.name = 'Theirs' limit 1`,
      )
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.member_capacity (household_id, member_id, period_start, minutes)
             values ($1, $2, $3, 30)`,
            [household.id, otherMember.rows[0].id, MONDAY],
          ),
        ),
      )
      // Without the composite key this row would be visible to the wrong family
      // while pointing at a member they cannot see.
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/member_in_household/)
    })
  })

  describe('AC 3 — a device that has not joined can neither read nor write', () => {
    beforeEach(async () => {
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 90)`,
          [household.id, child.id, MONDAY],
        )
      })
    })

    it('sees nothing at all — not an empty row, nothing', async () => {
      const rows = await asDevice(db, strangerDevice, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.member_capacity`)
        return rows
      })
      expect(rows).toEqual([])
    })

    it('POSITIVE CONTROL: a device that HAS joined sees it, so the empty result means something', async () => {
      const rows = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.member_capacity`)
        return rows
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].minutes).toBe(90)
    })

    it('cannot file an override into a household it has not joined', async () => {
      const result = await asDevice(db, strangerDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.member_capacity (household_id, member_id, period_start, minutes)
             values ($1, $2, $3, 5)`,
            [household.id, child.id, LAST_MONDAY],
          ),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/row-level security|policy/i)
    })

    it('cannot change or delete one either — a write it cannot see is still a write', async () => {
      // Unqualified on purpose. A stranger cannot even NAME the other family's
      // household_id in a WHERE clause — reading a column in a predicate needs
      // SELECT on it, and 0005 withholds household_id from the read grant. So
      // the honest test of "cannot write" is the widest write available, which
      // is the one a client could actually issue: row-level security is the
      // only thing standing between it and every row in the table.
      const changed = await asDevice(db, strangerDevice, async () => {
        const update = await db.query(`update public.member_capacity set minutes = 1`)
        const del = await db.query(`delete from public.member_capacity`)
        return { updated: update.affectedRows ?? 0, deleted: del.affectedRows ?? 0 }
      })
      expect(changed).toEqual({ updated: 0, deleted: 0 })

      const survived = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(`select minutes from public.member_capacity`)
        return rows
      })
      expect(survived).toEqual([{ minutes: 90 }])
    })

    it('`anon` holds nothing on this table — checked at TABLE level, not column level', async () => {
      const { rows } = await db.query(
        `select privilege_type from information_schema.table_privileges
         where table_name = 'member_capacity' and grantee = 'anon'`,
      )
      expect(rows).toEqual([])
    })

    it('POSITIVE CONTROL: table_privileges CAN see a grant, so the empty result above means something', async () => {
      const { rows } = await db.query(
        `select privilege_type from information_schema.table_privileges
         where table_name = 'member_capacity' and grantee = 'authenticated'
           and privilege_type = 'DELETE'`,
      )
      expect(rows).toHaveLength(1)
    })
  })

  describe('AC 4 — the grants are per column, because RLS is row-level', () => {
    beforeEach(async () => {
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 90)`,
          [household.id, child.id, MONDAY],
        )
      })
    })

    it('a member of the household may correct the minutes and the note', async () => {
      const row = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `update public.member_capacity set minutes = 45, note = 'exam week'
           where member_id = $1 returning minutes, note`,
          [child.id],
        )
        return rows[0]
      })
      expect(row).toEqual({ minutes: 45, note: 'exam week' })
    })

    it('REGRESSION: cannot move an override to another person by UPDATE', async () => {
      // member_id is not in the update grant. Without that, a household member
      // could hand their own thin week to somebody else and the split would
      // rebalance around a fact nobody stated.
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(`update public.member_capacity set member_id = $1`, [organizer.id]),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied|column/i)
    })

    it('REGRESSION: cannot move an override to another week by UPDATE', async () => {
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(`update public.member_capacity set period_start = $1`, [LAST_MONDAY]),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied|column/i)
    })

    it('REGRESSION: cannot backdate a row by writing created_at at INSERT time', async () => {
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.member_capacity
               (household_id, member_id, period_start, minutes, created_at)
             values ($1, $2, $3, 10, '2020-01-01')`,
            [household.id, organizer.id, MONDAY],
          ),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied|column/i)
    })

    it('the granted column sets are exactly what 0005 says, so a widening is visible here', async () => {
      const { rows } = await db.query(
        `select privilege_type, column_name from information_schema.column_privileges
         where table_name = 'member_capacity' and grantee = 'authenticated'
         order by privilege_type, column_name`,
      )
      const byPrivilege = {}
      for (const row of rows) {
        ;(byPrivilege[row.privilege_type] ??= []).push(row.column_name)
      }
      expect(byPrivilege.SELECT.sort()).toEqual([
        'created_at',
        'id',
        'member_id',
        'minutes',
        'note',
        'period_start',
        'source',
      ])
      expect(byPrivilege.INSERT.sort()).toEqual([
        'household_id',
        'member_id',
        'minutes',
        'note',
        'period_start',
        'source',
      ])
      expect(byPrivilege.UPDATE.sort()).toEqual(['minutes', 'note', 'source'])
    })

    it('and `select(*)` fails outright rather than quietly omitting a column', async () => {
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() => db.query(`select * from public.member_capacity`)),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied/i)
    })
  })

  describe('AC 5 — a deleted member takes their overrides with them', () => {
    it('removes the overrides when the member goes', async () => {
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 90), ($1, $2, $4, 30)`,
          [household.id, child.id, MONDAY, LAST_MONDAY],
        )
      })

      const before = await db.query(`select count(*)::int as n from public.member_capacity`)
      expect(before.rows[0].n).toBe(2)

      await asDevice(db, organizerDevice, async () => {
        await db.query(`delete from public.members where id = $1`, [child.id])
      })

      const after = await db.query(`select count(*)::int as n from public.member_capacity`)
      expect(after.rows[0].n).toBe(0)
    })

    it('and a deleted HOUSEHOLD takes them too', async () => {
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 90)`,
          [household.id, child.id, MONDAY],
        )
      })
      await db.query(`delete from public.households where id = $1`, [household.id])
      const { rows } = await db.query(`select count(*)::int as n from public.member_capacity`)
      expect(rows[0].n).toBe(0)
    })
  })

  describe('AC 6 — the household carries its own timezone', () => {
    it('takes the zone from the creating device', async () => {
      const { rows } = await db.query(`select timezone from public.households where id = $1`, [
        household.id,
      ])
      expect(rows[0].timezone).toBe('America/New_York')
    })

    it('lets a member of the household correct it', async () => {
      const row = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `update public.households set timezone = 'Europe/London' where id = $1
           returning timezone`,
          [household.id],
        )
        return rows[0]
      })
      expect(row.timezone).toBe('Europe/London')
    })

    it('REFUSES a zone Postgres does not know, at write time rather than at read time', async () => {
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(`update public.households set timezone = 'Mars/Olympus' where id = $1`, [
            household.id,
          ]),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not a known timezone/)
    })

    it('REGRESSION: a member cannot reassign the organizer', async () => {
      // 0005 gives `households` its first UPDATE policy. Without the matching
      // column grant that policy would let any member make themselves organizer
      // — 0002's measured hole, reopened.
      //
      // This test also asserted that `join_code` could not be rewritten, until
      // 0007 dropped the column. That half was REMOVED rather than left to pass:
      // its assertion was `/permission denied|column/i`, and "column join_code
      // does not exist" matches it. It would have gone on passing while testing
      // that the column is absent instead of that the grant refuses — green, and
      // proving nothing. The absence is asserted on its own terms below.
      const boss = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(`update public.households set organizer_member_id = $1 where id = $2`, [
            child.id,
            household.id,
          ]),
        ),
      )
      expect(boss.ok).toBe(false)
      expect(boss.error).toMatch(/permission denied|column/i)
    })

    it('and the join code is gone from the table, not merely ungranted', async () => {
      // The admission route 0007 retires. A dropped column and an ungranted one
      // fail a write identically from the client, so this asks the catalog
      // rather than inferring it from a refusal.
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'households'
          order by column_name`,
      )
      const columns = rows.map((r) => r.column_name)
      expect(columns).not.toContain('join_code')
      // POSITIVE CONTROL: the same read does find the columns that survived, so
      // an empty or misspelled query cannot produce the assertion above.
      expect(columns).toEqual(expect.arrayContaining(['id', 'name', 'timezone', 'organizer_member_id']))
    })

    it('and a stranger cannot touch another household at all', async () => {
      const changed = await asDevice(db, strangerDevice, async () => {
        const { affectedRows } = await db.query(
          `update public.households set name = 'Mine now' where id = $1`,
          [household.id],
        )
        return affectedRows ?? 0
      })
      expect(changed).toBe(0)
    })

    it('POSITIVE CONTROL: currentHousehold’s select(*) still works — the read grant was left alone', async () => {
      // src/lib/household.js issues `select('*')` on households. A column grant
      // there would make it fail OUTRIGHT, breaking the shipped app; 0005
      // deliberately narrows UPDATE only. This is what keeps that decision true.
      const result = await asDevice(db, organizerDevice, () =>
        attempt(() => db.query(`select * from public.households where id = $1`, [household.id])),
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('AC 2 — 0005 is re-runnable, because a re-paste is the normal path', () => {
    // These build their own database THROUGH 0005 rather than reusing the
    // full-stack `db`. Re-pasting a superseded file on top of a newer one is not
    // the path a human takes, and after 0007 it is destructive: it restores the
    // four-argument `create_household` and the policies that resolve through the
    // dropped `household_devices`. All three of these went red on exactly that,
    // which is the only reason it was noticed at all.

    it('applies a second time without error', async () => {
      const at0005 = await databaseThrough('0005_weekly_capacity.sql')
      await expect(at0005.exec(migrationSql('0005_weekly_capacity.sql'))).resolves.toBeDefined()
    })

    it('and a re-run does not widen the grants', async () => {
      const at0005 = await databaseThrough('0005_weekly_capacity.sql')
      const grantsBefore = await at0005.query(
        `select privilege_type, column_name from information_schema.column_privileges
         where table_name = 'member_capacity' order by privilege_type, column_name`,
      )
      await at0005.exec(migrationSql('0005_weekly_capacity.sql'))
      const grantsAfter = await at0005.query(
        `select privilege_type, column_name from information_schema.column_privileges
         where table_name = 'member_capacity' order by privilege_type, column_name`,
      )
      expect(grantsAfter.rows).toEqual(grantsBefore.rows)
    })

    it('and the data survives it', async () => {
      // Seeded and re-pasted at HEAD. The question is whether a re-paste keeps
      // rows, and the file a human re-pastes today is 0007.
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 90)`,
          [household.id, child.id, MONDAY],
        )
      })
      await db.exec(migrationSql('0007_per_member_auth.sql'))
      const { rows } = await db.query(`select minutes from public.member_capacity`)
      expect(rows).toEqual([{ minutes: 90 }])
    })
  })

  describe('the migration list has not fallen behind the directory', () => {
    it('every .sql file in supabase/migrations is in the MIGRATIONS array', () => {
      const missing = migrationFilesOnDisk().filter((name) => !MIGRATIONS.includes(name))
      expect(
        missing,
        `not applied by any pglite suite, so untested while everything stays green: ${missing.join(', ')}`,
      ).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // #46 AC 3 — "a client-side check is not a check"
  //
  // src/lib/capacity.js refuses a bad value with a sentence before any request
  // is sent, and capacity.io.test.js proves that. This is the other half, and
  // the AC insists on it by name: the DATABASE must refuse the same values, so
  // a client that skips the normalizer — a future caller, the extraction path in
  // #57, a curl — cannot file minutes the fairness arithmetic could not survive.
  // ---------------------------------------------------------------------------

  describe('#46 AC 3 — the database refuses what the normalizer refuses', () => {
    const MONDAY = '2026-08-10'

    const fileMinutes = (minutes) =>
      attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query(
            `insert into public.member_capacity (household_id, member_id, period_start, minutes)
             values ($1, $2, $3, $4)`,
            [household.id, child.id, MONDAY, minutes],
          ),
        ),
      )

    it('refuses a negative value, naming the constraint rather than a message', async () => {
      const refused = await fileMinutes(-1)
      expect(refused.ok).toBe(false)
      // Asserted against the constraint NAME, not against Postgres's prose. The
      // message text is a Postgres version detail and is not a contract; the
      // name is ours. Same rule 0003 states for chores_expected_minutes_range.
      expect(refused.error).toMatch(/member_capacity_minutes_range/)
    })

    it('refuses more minutes than a week contains', async () => {
      const refused = await fileMinutes(10081)
      expect(refused.error).toMatch(/member_capacity_minutes_range/)
    })

    it('POSITIVE CONTROL: both ends of the legal range are accepted', async () => {
      // Without this the two refusals above are equally consistent with the
      // insert being broken for every value, which would make the guard look
      // perfect while the feature did not work at all.
      const zero = await fileMinutes(0)
      expect(zero.ok, 'zero means "no time this week" and must be storable').toBe(true)

      await asDevice(db, organizerDevice, () =>
        db.query(`delete from public.member_capacity where member_id = $1`, [child.id]),
      )
      const full = await fileMinutes(10080)
      expect(full.ok, 'a full week is the documented upper bound').toBe(true)
    })

    it('and the bounds the module states are the bounds the migration enforces', async () => {
      // The two numbers live in two languages and would drift silently. Read out
      // of the migration text rather than retyped, so this fails if either side
      // moves. capacity.test.js asserts the JS constants against the same text;
      // this asserts the running database agrees with both.
      const sql = migrationSql('0005_weekly_capacity.sql')
      const bound = sql.match(/minutes >= (\d+) and minutes <= (\d+)/)
      expect(bound, 'the range constraint is no longer where this test looks').not.toBeNull()
      expect(Number(bound[1])).toBe(0)
      expect(Number(bound[2])).toBe(10080)
    })
  })

  // ---------------------------------------------------------------------------
  // #46 AC 1 — "a second client constructed against the same backend reads 120
  // as effective capacity".
  //
  // capacity.io.test.js asserts the same round trip against a fake client, which
  // proves the module sends and unpacks the right things. It does not prove a
  // SECOND reader sees it, because a fake returns whatever the test told it to.
  // This does: one device writes, a different device reads, and the number is
  // resolved through the one implementation of effectiveCapacity rather than by
  // inspecting the row.
  // ---------------------------------------------------------------------------

  describe('#46 AC 1 — a second device reads back the effective capacity', () => {
    const MONDAY = '2026-08-10'

    it('one device sets 120 against a 300 baseline; another reads 120, and the baseline is intact', async () => {
      // `child` is seeded with weekly_minutes 300 in this file's beforeEach.
      // The second phone is the CHILD's own, which after 0007 is the only thing
      // a second phone can be: membership is a claimed member row, so there is
      // no longer a phone that is in the household while being nobody. It is
      // provisioned the way the Edge Function does it, as service_role —
      // `claimed_by` is deliberately absent from the client update grant, and a
      // signed-in caller attempting this write is refused.
      const secondDevice = await newDevice(db)
      await provisionMember(db, child.id, secondDevice)

      await asDevice(db, organizerDevice, () =>
        db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 120)`,
          [household.id, child.id, MONDAY],
        ),
      )

      // PGlite returns a `date` column as a JS **Date**; PostgREST returns it as
      // the string "2026-08-10", and `capacitiesFor` compares period keys with
      // `===`. So a row handed straight from this harness into client code is
      // not the shape the client ever receives, and the comparison silently
      // misses — measured here, where effectiveCapacity passed and capacitiesFor
      // returned the baseline.
      //
      // Normalised rather than loosened: the production path really does deal in
      // strings, and widening the comparison in capacity.js would be changing
      // shipped code to accommodate a harness artefact. Worth knowing before
      // writing any other pglite test that feeds rows into the JS layer.
      const asClientRow = (r) => ({
        ...r,
        period_start:
          r.period_start instanceof Date
            ? r.period_start.toISOString().slice(0, 10)
            : r.period_start,
      })

      // The second device reads through the same column list the client uses.
      const seen = await asDevice(db, secondDevice, async () => {
        const { rows } = await db.query(
          `select id, member_id, period_start, minutes, note, source, created_at
             from public.member_capacity where period_start = $1`,
          [MONDAY],
        )
        return rows.map(asClientRow)
      })
      expect(seen, 'the second device must see the override at all').toHaveLength(1)
      expect(typeof seen[0].period_start, 'normalised to the shape PostgREST sends').toBe('string')

      const member = { id: child.id, weekly_minutes: 300 }
      expect(effectiveCapacity(member, seen.find((o) => o.member_id === child.id))).toBe(120)
      expect(capacitiesFor([member], seen, MONDAY)).toEqual([
        { id: child.id, capacityMinutes: 120 },
      ])

      // And the baseline row is untouched — the override is a delta, not a
      // rewrite. Read from the database rather than from the object above, which
      // this test constructed and could not have changed.
      const { rows: baseline } = await db.query(
        `select weekly_minutes from public.members where id = $1`,
        [child.id],
      )
      expect(baseline[0].weekly_minutes).toBe(300)
    })

    it('POSITIVE CONTROL: with no override the same read resolves the baseline', async () => {
      // Without this, the assertion above is equally consistent with
      // effectiveCapacity returning 120 for reasons unrelated to the row.
      const member = { id: child.id, weekly_minutes: 300 }
      const seen = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `select member_id, period_start, minutes from public.member_capacity
             where period_start = $1`,
          [MONDAY],
        )
        return rows
      })
      expect(seen).toHaveLength(0)
      expect(capacitiesFor([member], seen, MONDAY)).toEqual([
        { id: child.id, capacityMinutes: 300 },
      ])
    })
  })
})
