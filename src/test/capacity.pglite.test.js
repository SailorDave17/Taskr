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

import { beforeEach, describe, expect, it } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationFilesOnDisk,
  migrationSql,
  newDevice,
  MIGRATIONS,
} from './support/pgliteSupabase.js'

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
        `select * from public.create_household('Ours', 'Alex', '4821', 'America/New_York')`,
      )
      household = rows[0]
      const members = await db.query(
        `select id, display_name from public.members where household_id = $1`,
        [household.id],
      )
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
      await db.query(`select * from public.create_household('Theirs', 'Robin', '1234', 'UTC')`)
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

    it('REGRESSION: a member cannot rewrite the join code or reassign the organizer', async () => {
      // 0005 gives `households` its first UPDATE policy. Without the matching
      // column grant that policy would let any member invite strangers or make
      // themselves organizer — 0002's measured hole, reopened.
      const code = await asDevice(db, organizerDevice, () =>
        attempt(() =>
          db.query(`update public.households set join_code = 'AAAAAAAA' where id = $1`, [
            household.id,
          ]),
        ),
      )
      expect(code.ok).toBe(false)
      expect(code.error).toMatch(/permission denied|column/i)

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
    it('applies a second time without error', async () => {
      await expect(db.exec(migrationSql('0005_weekly_capacity.sql'))).resolves.toBeDefined()
    })

    it('and a re-run does not widen the grants', async () => {
      const grantsBefore = await db.query(
        `select privilege_type, column_name from information_schema.column_privileges
         where table_name = 'member_capacity' order by privilege_type, column_name`,
      )
      await db.exec(migrationSql('0005_weekly_capacity.sql'))
      const grantsAfter = await db.query(
        `select privilege_type, column_name from information_schema.column_privileges
         where table_name = 'member_capacity' order by privilege_type, column_name`,
      )
      expect(grantsAfter.rows).toEqual(grantsBefore.rows)
    })

    it('and the data survives it', async () => {
      await asDevice(db, organizerDevice, async () => {
        await db.query(
          `insert into public.member_capacity (household_id, member_id, period_start, minutes)
           values ($1, $2, $3, 90)`,
          [household.id, child.id, MONDAY],
        )
      })
      await db.exec(migrationSql('0005_weekly_capacity.sql'))
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
})
