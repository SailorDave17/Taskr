// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #97 — a confirmed calendar suggestion as a capacity source, against a real
// Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies, so a green run says
// nothing about the hosted project. `0031` widens a check constraint and adds a
// column comment, and `npm run check:live` is structurally blind to both (it
// probes tables, columns and signatures; this file changes none), so the
// authority on whether the live project has it is the read-only catalog query
// recorded in docs/access-model.md's `0031` entry, not this file and not that
// check.
//
// ===========================================================================
// AC 3 IS A MIGRATION TEST IN BOTH DIRECTIONS
// ===========================================================================
//
// "a 'calendar' write is refused before the migration and accepted after it".
// The two arms build DIFFERENT databases: one through `0030` (the schema a
// project has until somebody pastes `0031`), one through `0031`. The first arm
// is the one worth having — it is the failure a phone would hit on a project
// where the paste has not happened, and it proves the constraint was actually
// narrower before, so the second arm's green is the widening and not a
// constraint that never bit.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPACITY_SOURCES, effectiveCapacity } from '../lib/capacity.js'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

/** Matches `src/lib/capacity.js`'s CAPACITY_COLUMNS. */
const READABLE = 'id, member_id, period_start, minutes, note, source, created_at'

/** A Monday, which is the only weekday `0005` will accept. */
const WEEK = '2026-09-07'

const BEFORE = '0030_calendar_busy_minutes.sql'
const AFTER = '0031_calendar_capacity_source.sql'

vi.setConfig({ testTimeout: 30_000 })

/** What the constraint admits, per Postgres itself — the sorted list of words. */
async function admittedSources(database) {
  const { rows } = await database.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'member_capacity_source_known'`,
  )
  expect(rows, 'the constraint must exist exactly once').toHaveLength(1)
  // `[a-z_]`: 0039's fourth word carries an underscore, and `[a-z]+` stopped
  // at it and reported three words on a four-word constraint (#106, measured).
  return [...rows[0].def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
}

/** A household with an organizer and a second member, on any database. */
async function seedHousehold(database) {
  const device = await newDevice(database, 'placeholder.organizer@example.test')
  const household = await asDevice(database, device, async () => {
    const { rows } = await database.query('select * from public.create_household($1, $2)', [
      'Placeholder Household',
      'Placeholder Organizer',
    ])
    return rows[0]
  })
  const { rows } = await database.query(
    `insert into public.members (household_id, display_name, weekly_minutes)
     values ($1, 'Placeholder Two', 300) returning id`,
    [household.id],
  )
  return { device, household, organizer: household.organizer_member_id, memberTwo: rows[0].id }
}

/** The client's write, as PostgREST issues an upsert on the 0005 key. */
const upsert = (database, { household, member, minutes, source, note = null }) =>
  database.query(
    `insert into public.member_capacity
       (household_id, member_id, period_start, minutes, note, source)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (member_id, period_start)
       do update set minutes = excluded.minutes, note = excluded.note, source = excluded.source
     returning ${READABLE}`,
    [household, member, WEEK, minutes, note, source],
  )

describe('a confirmed calendar figure, run against a real Postgres', () => {
  let db, device, household, memberTwo

  beforeEach(async () => {
    db = await freshDatabase()
    ;({ device, household, memberTwo } = await seedHousehold(db))
  })

  // -------------------------------------------------------------------------
  // AC 3 — refused before the migration, accepted after it
  // -------------------------------------------------------------------------

  describe('AC 3 — the constraint before and after 0031', () => {
    it('BEFORE: a database built through 0030 REFUSES a calendar row, naming the constraint', async () => {
      const at0030 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0030)
      expect(await admittedSources(at0030)).toEqual(['extraction', 'manual'])

      const refused = await asDevice(at0030, seeded.device, () =>
        attempt(() =>
          upsert(at0030, {
            household: seeded.household.id,
            member: seeded.memberTwo,
            minutes: 240,
            source: 'calendar',
          }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_source_known/)
      await at0030.close()
    })

    it('BEFORE — POSITIVE CONTROL: the same database accepts a manual row, so the red is the word', async () => {
      const at0030 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0030)
      const accepted = await asDevice(at0030, seeded.device, () =>
        attempt(() =>
          upsert(at0030, {
            household: seeded.household.id,
            member: seeded.memberTwo,
            minutes: 240,
            source: 'manual',
          }),
        ),
      )
      expect(accepted.error).toBeNull()
      await at0030.close()
    })

    it('AFTER: a database built through 0031 accepts the calendar row, and the row says so', async () => {
      const at0031 = await databaseThrough(AFTER)
      const seeded = await seedHousehold(at0031)
      expect(await admittedSources(at0031)).toEqual(['calendar', 'extraction', 'manual'])

      const row = await asDevice(at0031, seeded.device, async () => {
        const { rows } = await upsert(at0031, {
          household: seeded.household.id,
          member: seeded.memberTwo,
          minutes: 240,
          source: 'calendar',
        })
        return rows[0]
      })
      expect(row.source).toBe('calendar')
      expect(row.minutes).toBe(240)
      await at0031.close()
    })

    it('AFTER: still refuses a word nobody defined — the widening admits one value, not any', async () => {
      const refused = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, { household: household.id, member: memberTwo, minutes: 240, source: 'guess' }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_source_known/)
    })

    it('the module’s list and the constraint’s list are the same list', async () => {
      expect(await admittedSources(db)).toEqual([...CAPACITY_SOURCES].sort())
    })

    it('and the column carries the comment, so the catalog says what the three words mean', async () => {
      const { rows } = await db.query(
        `select col_description('public.member_capacity'::regclass, attnum) as note
           from pg_attribute
          where attrelid = 'public.member_capacity'::regclass and attname = 'source'`,
      )
      expect(rows[0].note).toMatch(/calendar/)
      expect(rows[0].note).toMatch(/#97/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — resolves like any override, read back by another device
  // -------------------------------------------------------------------------

  describe('AC 4 — a confirmed figure is what the week resolves to', () => {
    const memberRow = async (id) =>
      (await db.query('select id, weekly_minutes from public.members where id = $1', [id])).rows[0]

    it('override wins: another device reads the calendar figure, and the baseline is intact', async () => {
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 240, source: 'calendar' }),
      )
      const other = await newDevice(db, 'placeholder.other@example.test')
      await db.query(`update public.members set claimed_by = $1 where id = $2`, [other, memberTwo])
      const seen = await asDevice(db, other, async () => {
        const { rows } = await db.query(
          `select ${READABLE} from public.member_capacity where member_id = $1 and period_start = $2`,
          [memberTwo, WEEK],
        )
        return rows[0]
      })
      expect(seen.source).toBe('calendar')
      expect(effectiveCapacity(await memberRow(memberTwo), seen)).toBe(240)
      expect((await memberRow(memberTwo)).weekly_minutes).toBe(300)
    })

    it('zero wins: a calendar that fills the week stores 0 and resolves to 0', async () => {
      const { rows } = await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 0, source: 'calendar' }),
      )
      expect(rows[0].minutes).toBe(0)
      expect(effectiveCapacity(await memberRow(memberTwo), rows[0])).toBe(0)
    })

    it('baseline otherwise: with no row the member resolves to their usual minutes', async () => {
      expect(effectiveCapacity(await memberRow(memberTwo), undefined)).toBe(300)
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — a manual figure after a calendar confirm wins, by the existing upsert
  // -------------------------------------------------------------------------

  describe('AC 5 — the manual floor: a person can always overtype a calendar figure', () => {
    it('a later manual upsert on the same (member, week) replaces the calendar row, source and all', async () => {
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 240, source: 'calendar' }),
      )
      const { rows } = await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 90, source: 'manual' }),
      )
      expect(rows[0]).toMatchObject({ minutes: 90, source: 'manual' })

      // One row, not two: the unique constraint made the second write a
      // correction rather than a second fact, which is the whole mechanism.
      const { rows: all } = await db.query(
        `select minutes, source from public.member_capacity where member_id = $1`,
        [memberTwo],
      )
      expect(all).toEqual([{ minutes: 90, source: 'manual' }])
    })

    it('and the other way round — a calendar confirm can replace a typed figure too', async () => {
      // The rule is "the latest write wins", not "manual is sticky": a member
      // who typed on Monday and connects a calendar on Tuesday can take it.
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 90, source: 'manual' }),
      )
      const { rows } = await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 240, source: 'calendar' }),
      )
      expect(rows[0]).toMatchObject({ minutes: 240, source: 'calendar' })
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability — a re-paste is the normal path
  // -------------------------------------------------------------------------

  describe('0031 is re-runnable, and 0005 re-pasted on top of it does not undo it', () => {
    it('applies a second time without error, and the constraint still admits three words', async () => {
      // On a database built THROUGH 0031, not on `db`: `db` is HEAD, which
      // since 0039 (#106) admits a fourth word, and re-running 0031 there
      // NARROWS the constraint back — the 0012/0025/0026-on-0028 hazard, on a
      // constraint. That case is calendarAutoApply.pglite.test.js's to assert;
      // this one is 0031's own idempotency, which is only true of 0031's own
      // schema (cairn: a migration is re-runnable only against its own schema).
      const at0031 = await databaseThrough(AFTER)
      const seeded = await seedHousehold(at0031)
      await asDevice(at0031, seeded.device, () =>
        upsert(at0031, {
          household: seeded.household.id,
          member: seeded.memberTwo,
          minutes: 240,
          source: 'calendar',
        }),
      )
      const second = await attempt(() => at0031.exec(migrationSql(AFTER)))
      expect(second.error).toBeNull()
      expect(await admittedSources(at0031)).toEqual(['calendar', 'extraction', 'manual'])
      // The drop-and-add validated the existing rows on the way through, and
      // a calendar row is one the new definition admits — so it survived.
      const { rows } = await at0031.query(
        `select source from public.member_capacity where member_id = $1`,
        [seeded.memberTwo],
      )
      expect(rows).toEqual([{ source: 'calendar' }])
      await at0031.close()
    })

    it('issues no privilege statement — the grants through 0030 and through 0031 are the same grants', async () => {
      // Two databases, one built to each side of the file, compared. The first
      // draft snapshotted `db` (already built THROUGH 0031) before and after a
      // re-run, which the review pass showed is inert for ANY content of the
      // file: whatever 0031 grants is already in the baseline, and a re-run
      // re-grants it identically. This form reddens when a grant is appended
      // to 0031 — predicted 1 here, plus capacity.pglite.test.js's HEAD
      // snapshot of the 0005 column sets.
      const grants = async (database) =>
        (
          await database.query(
            `select grantee, privilege_type, column_name
               from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'member_capacity'
              order by grantee, privilege_type, column_name`,
          )
        ).rows
      const tableGrants = async (database) =>
        (
          await database.query(
            `select grantee, privilege_type from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'member_capacity'
              order by grantee, privilege_type`,
          )
        ).rows
      const at0030 = await databaseThrough(BEFORE)
      const at0031 = await databaseThrough(AFTER)
      const columnsBefore = await grants(at0030)
      expect(columnsBefore.length, 'POSITIVE CONTROL: 0005 granted columns to compare').toBeGreaterThan(0)
      expect(await grants(at0031)).toEqual(columnsBefore)
      expect(await tableGrants(at0031)).toEqual(await tableGrants(at0030))
      await at0030.close()
      await at0031.close()
    })

    it('re-pasting 0005’s create-table on top leaves the widening in place — the inline constraint is skipped with its table', async () => {
      // The OPPOSITE of what re-pasting 0012/0025/0026 does to 0028, and worth
      // asserting for that reason: a reader who has learned that hazard would
      // expect it here. `create table if not exists` skips the whole statement
      // on a re-run, inline constraints included, so 0005 cannot put the
      // narrower definition back.
      //
      // ONLY the create-table statement is pasted, and its success is asserted.
      // The first draft pasted the whole of 0005 and discarded the result — and
      // the review pass RAN it: at HEAD the whole paste fails (its policies
      // resolve through `household_devices`, dropped in 0007), PGlite's single
      // exec rolls the batch back, and the constraint stayed widened because
      // NOTHING applied, not because the skip worked. A green that proved the
      // wrong mechanism.
      const sql = migrationSql('0005_weekly_capacity.sql')
      const matches = sql.match(/create table if not exists public\.member_capacity \([\s\S]*?\n\);/g)
      expect(matches, 'expected the create-table statement exactly once').toHaveLength(1)

      const at0031 = await databaseThrough(AFTER)
      const paste = await attempt(() => at0031.exec(matches[0]))
      expect(paste.error).toBeNull()
      expect(await admittedSources(at0031)).toEqual(['calendar', 'extraction', 'manual'])
      await at0031.close()
    })
  })
})
