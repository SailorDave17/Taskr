// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #106 — an automatic calendar write as a capacity source, against a real
// Postgres: the fourth `source` word and the `previous_minutes` column `0039`
// adds, with the grants and the two constraints that go with them.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies. `check:live` sees the
// COLUMN (it is in `CAPACITY_COLUMNS`) and nothing of the constraint or the
// grants; `probe:live-grants` sees the grants and nothing of the constraint;
// the read-only catalog query in docs/access-model.md's `0039` entry is the
// instrument for the widening, and none of that is this file.
//
// The migration test runs in BOTH directions, `0031`'s shape and for `0031`'s
// reason: the arm built through `0038` is the failure a phone would hit on a
// project where the apply has not happened, and it is what proves the second
// arm's green is the widening and not a constraint that never bit.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPACITY_COLUMNS, CAPACITY_SOURCES, effectiveCapacity } from '../lib/capacity.js'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

/** Matches `src/lib/capacity.js`'s CAPACITY_COLUMNS — asserted, not copied. */
const READABLE = 'id, member_id, period_start, minutes, note, source, previous_minutes, created_at'

/** A Monday, which is the only weekday `0005` will accept. */
const WEEK = '2026-09-07'

const BEFORE = '0038_calendar_event_import.sql'
const AFTER = '0039_calendar_auto_apply.sql'
const NARROWER = '0031_calendar_capacity_source.sql'

vi.setConfig({ testTimeout: 30_000 })

/** What the constraint admits, per Postgres itself — the sorted list of words. */
async function admittedSources(database) {
  const { rows } = await database.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'member_capacity_source_known'`,
  )
  expect(rows, 'the constraint must exist exactly once').toHaveLength(1)
  return [...rows[0].def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
}

/** Does the column exist, per the catalog. */
async function hasPreviousColumn(database) {
  const { rows } = await database.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'member_capacity'
        and column_name = 'previous_minutes'`,
  )
  return rows.length === 1
}

/** `authenticated`'s column privileges on the table, sorted. */
async function columnGrants(database) {
  return (
    await database.query(
      `select privilege_type, column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'member_capacity'
          and grantee = 'authenticated'
        order by privilege_type, column_name`,
    )
  ).rows
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

/** The client's write, as PostgREST issues `setCapacity`'s upsert since 0039. */
const upsert = (database, { household, member, minutes, source, previous = null, note = null }) =>
  database.query(
    `insert into public.member_capacity
       (household_id, member_id, period_start, minutes, note, source, previous_minutes)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (member_id, period_start)
       do update set minutes = excluded.minutes, note = excluded.note,
                     source = excluded.source, previous_minutes = excluded.previous_minutes
     returning ${READABLE}`,
    [household, member, WEEK, minutes, note, source, previous],
  )

describe('an automatic calendar write, run against a real Postgres', () => {
  let db, device, household, memberTwo

  beforeEach(async () => {
    db = await freshDatabase()
    ;({ device, household, memberTwo } = await seedHousehold(db))
  })

  it('READABLE is the module’s column list, so a widening there reaches this file', () => {
    expect(READABLE).toBe(CAPACITY_COLUMNS)
  })

  // -------------------------------------------------------------------------
  // The migration, in both directions
  // -------------------------------------------------------------------------

  describe('the constraint and the column, before and after 0039', () => {
    it('BEFORE: a database built through 0038 REFUSES the fourth word, naming the constraint', async () => {
      const at0038 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0038)
      expect(await admittedSources(at0038)).toEqual(['calendar', 'extraction', 'manual'])
      expect(await hasPreviousColumn(at0038)).toBe(false)

      // Without the column, on 0038's own column list — the word alone.
      const refused = await asDevice(at0038, seeded.device, () =>
        attempt(() =>
          at0038.query(
            `insert into public.member_capacity
               (household_id, member_id, period_start, minutes, note, source)
             values ($1, $2, $3, 40, null, 'calendar_auto')`,
            [seeded.household.id, seeded.memberTwo, WEEK],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_source_known/)
      await at0038.close()
    })

    it('BEFORE — POSITIVE CONTROL: the same database accepts a calendar row, so the red is the word', async () => {
      const at0038 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0038)
      const accepted = await asDevice(at0038, seeded.device, () =>
        attempt(() =>
          at0038.query(
            `insert into public.member_capacity
               (household_id, member_id, period_start, minutes, note, source)
             values ($1, $2, $3, 40, null, 'calendar')`,
            [seeded.household.id, seeded.memberTwo, WEEK],
          ),
        ),
      )
      expect(accepted.error).toBeNull()
      await at0038.close()
    })

    it('AFTER: a database built through 0039 accepts the automatic row with its previous figure', async () => {
      expect(await admittedSources(db)).toEqual(['calendar', 'calendar_auto', 'extraction', 'manual'])
      expect(await hasPreviousColumn(db)).toBe(true)
      const row = await asDevice(db, device, async () => {
        const { rows } = await upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 40,
          source: 'calendar_auto',
          previous: 300,
        })
        return rows[0]
      })
      expect(row).toMatchObject({ minutes: 40, source: 'calendar_auto', previous_minutes: 300 })
    })

    it('AFTER: still refuses a word nobody defined — the widening admits one value, not any', async () => {
      const refused = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, { household: household.id, member: memberTwo, minutes: 40, source: 'guess' }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_source_known/)
    })

    it('the module’s list and the constraint’s list are the same list', async () => {
      expect(await admittedSources(db)).toEqual([...CAPACITY_SOURCES].sort())
    })

    it('and both columns carry a comment naming the story', async () => {
      const { rows } = await db.query(
        `select attname, col_description('public.member_capacity'::regclass, attnum) as note
           from pg_attribute
          where attrelid = 'public.member_capacity'::regclass
            and attname in ('source', 'previous_minutes')`,
      )
      const byName = Object.fromEntries(rows.map((r) => [r.attname, r.note]))
      expect(byName.source).toMatch(/calendar_auto/)
      expect(byName.source).toMatch(/#106/)
      expect(byName.previous_minutes).toMatch(/#106/)
    })
  })

  // -------------------------------------------------------------------------
  // The two constraints on the new column
  // -------------------------------------------------------------------------

  describe('previous_minutes is legal only on an automatic row, and only in range', () => {
    it('refuses a previous figure on a CONFIRMED row — a confirm must clear it', async () => {
      // The client's confirm of an automatic week upserts `calendar` with the
      // column null. A client that forgot the column would leave 300 standing
      // under the new word; the constraint refuses that rather than storing a
      // confirmed week wearing an automatic row's history.
      const refused = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 40,
            source: 'calendar',
            previous: 300,
          }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_previous_only_when_auto/)
    })

    it('refuses it on a manual and an extraction row for the same reason', async () => {
      for (const source of ['manual', 'extraction']) {
        const refused = await asDevice(db, device, () =>
          attempt(() =>
            upsert(db, { household: household.id, member: memberTwo, minutes: 40, source, previous: 300 }),
          ),
        )
        expect(refused.ok, source).toBe(false)
        expect(refused.error).toMatch(/member_capacity_previous_only_when_auto/)
      }
    })

    it('POSITIVE CONTROL: null is fine on every word, including calendar_auto', async () => {
      for (const source of CAPACITY_SOURCES) {
        const accepted = await asDevice(db, device, () =>
          attempt(() =>
            upsert(db, { household: household.id, member: memberTwo, minutes: 40, source, previous: null }),
          ),
        )
        expect(accepted.error, source).toBeNull()
      }
    })

    it('refuses a previous figure outside the week — the same range as minutes', async () => {
      for (const previous of [-1, 10081]) {
        const refused = await asDevice(db, device, () =>
          attempt(() =>
            upsert(db, {
              household: household.id,
              member: memberTwo,
              minutes: 40,
              source: 'calendar_auto',
              previous,
            }),
          ),
        )
        expect(refused.ok, String(previous)).toBe(false)
        expect(refused.error).toMatch(/member_capacity_previous_minutes_range/)
      }
    })

    it('a person’s confirm of an automatic week replaces the row, word and history together', async () => {
      // The roster's Save on an automatic week: `calendar`, previous null,
      // same figure. One row, not two; the automatic history is gone with the
      // word, which is what "confirmed" means.
      await asDevice(db, device, () =>
        upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 40,
          source: 'calendar_auto',
          previous: 300,
        }),
      )
      const { rows } = await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 40, source: 'calendar' }),
      )
      expect(rows[0]).toMatchObject({ minutes: 40, source: 'calendar', previous_minutes: null })
      const { rows: all } = await db.query(
        `select minutes, source, previous_minutes from public.member_capacity where member_id = $1`,
        [memberTwo],
      )
      expect(all).toEqual([{ minutes: 40, source: 'calendar', previous_minutes: null }])
    })
  })

  // -------------------------------------------------------------------------
  // The manual floor, server-side — the trigger the review asked for
  //
  // The client's check is a read followed by a write; a person's figure
  // landing in that one round trip is what this catches. Each arm is one
  // upsert against a standing row, as the caller (`authenticated`) issues it.
  // -------------------------------------------------------------------------

  describe('an automatic write never replaces a figure a person set', () => {
    const standing = (source, minutes = 100) =>
      asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes, source }),
      )
    const automatic = (minutes = 40, previous = 100) =>
      asDevice(db, device, () =>
        attempt(() =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes,
            source: 'calendar_auto',
            previous,
          }),
        ),
      )

    it('refuses calendar_auto over a MANUAL row, with the errcode the client recognises', async () => {
      await standing('manual')
      const refused = await automatic()
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/cannot replace a figure a person set \(manual\)/)
      // The row is untouched — the refusal is the whole write.
      const { rows } = await db.query(
        `select minutes, source, previous_minutes from public.member_capacity where member_id = $1`,
        [memberTwo],
      )
      expect(rows).toEqual([{ minutes: 100, source: 'manual', previous_minutes: null }])
    })

    it('surfaces the refusal as errcode TA106, so the client can tell a lost race from a fault', async () => {
      await standing('manual')
      // `attempt` flattens to a message; read the SQLSTATE off the raw error.
      let code = null
      try {
        await asDevice(db, device, () =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 40,
            source: 'calendar_auto',
            previous: 100,
          }),
        )
      } catch (err) {
        code = err?.code ?? err?.cause?.code ?? null
      }
      expect(code).toBe('TA106')
    })

    it('refuses it over an EXTRACTION row for the same reason', async () => {
      await standing('extraction')
      const refused = await automatic()
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/\(extraction\)/)
    })

    it('POSITIVE CONTROL: accepts calendar_auto over a CONFIRMED calendar row', async () => {
      await standing('calendar')
      const accepted = await automatic()
      expect(accepted.error).toBeNull()
    })

    it('POSITIVE CONTROL: accepts calendar_auto over an AUTOMATIC row — the chain the anchor bounds', async () => {
      await asDevice(db, device, () =>
        upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 220,
          source: 'calendar_auto',
          previous: 300,
        }),
      )
      const accepted = await automatic(260, 300)
      expect(accepted.error).toBeNull()
    })

    it('POSITIVE CONTROL: an INSERT (no standing row) is never refused — there is nobody to protect', async () => {
      const accepted = await automatic(210, 300)
      expect(accepted.error).toBeNull()
    })

    it('never refuses a PERSON over an automatic row — the latest write wins for a person', async () => {
      await asDevice(db, device, () =>
        upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 40,
          source: 'calendar_auto',
          previous: 100,
        }),
      )
      for (const source of ['manual', 'extraction', 'calendar']) {
        const accepted = await asDevice(db, device, () =>
          attempt(() => upsert(db, { household: household.id, member: memberTwo, minutes: 90, source })),
        )
        expect(accepted.error, source).toBeNull()
      }
    })

    it('the trigger function is executable by nobody — 0017’s rule, 0022’s shape', async () => {
      const { rows } = await db.query(
        `select r.rolname,
                has_function_privilege(r.rolname, 'public.member_capacity_automatic_never_overtypes()', 'execute') as can
           from pg_roles r where r.rolname in ('anon', 'authenticated')`,
      )
      expect(rows.length, 'POSITIVE CONTROL: both roles exist').toBe(2)
      expect(rows.every((r) => r.can === false)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — resolves like any override, and another device reads the history
  // -------------------------------------------------------------------------

  describe('AC 4 — the automatic figure is what the week resolves to, and the pre-change figure is readable', () => {
    const memberRow = async (id) =>
      (await db.query('select id, weekly_minutes from public.members where id = $1', [id])).rows[0]

    it('another device reads the automatic figure AND what it replaced; the baseline is intact', async () => {
      await asDevice(db, device, () =>
        upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 40,
          source: 'calendar_auto',
          previous: 300,
        }),
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
      expect(seen).toMatchObject({ source: 'calendar_auto', previous_minutes: 300 })
      expect(effectiveCapacity(await memberRow(memberTwo), seen)).toBe(40)
      expect((await memberRow(memberTwo)).weekly_minutes).toBe(300)
    })
  })

  // -------------------------------------------------------------------------
  // The grants — exactly three, per column, and only the new column's
  // -------------------------------------------------------------------------

  describe('0039’s grants are the three on previous_minutes and nothing else', () => {
    it('the difference between the 0038 and 0039 column sets is previous_minutes × {SELECT, INSERT, UPDATE}', async () => {
      // Two databases built to each side of the file, compared — 0031's test
      // showed that a snapshot of HEAD around a re-run is inert for any
      // content of the file. This form reddens when a grant is dropped from
      // 0039 (predicted 1 here, plus capacity.pglite.test.js's HEAD sets) or
      // when one is added to another column.
      const at0038 = await databaseThrough(BEFORE)
      const at0039 = await databaseThrough(AFTER)
      const before = await columnGrants(at0038)
      const after = await columnGrants(at0039)
      expect(before.length, 'POSITIVE CONTROL: 0005/0022 granted columns to compare').toBeGreaterThan(0)
      const added = after.filter(
        (row) => !before.some((b) => b.privilege_type === row.privilege_type && b.column_name === row.column_name),
      )
      expect(added).toEqual([
        { privilege_type: 'INSERT', column_name: 'previous_minutes' },
        { privilege_type: 'SELECT', column_name: 'previous_minutes' },
        { privilege_type: 'UPDATE', column_name: 'previous_minutes' },
      ])
      const removed = before.filter(
        (row) => !after.some((a) => a.privilege_type === row.privilege_type && a.column_name === row.column_name),
      )
      expect(removed).toEqual([])
      await at0038.close()
      await at0039.close()
    })

    it('anon holds nothing on the new column — 0017’s revoke still stands', async () => {
      const { rows } = await db.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'member_capacity'
            and column_name = 'previous_minutes' and grantee = 'anon'`,
      )
      expect(rows).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability, and the hazard a LATER paste of 0031 carries
  // -------------------------------------------------------------------------

  describe('0039 is re-runnable; re-pasting 0031 on top of it is not harmless', () => {
    it('applies a second time without error, and the row it admits survives the re-validation', async () => {
      await asDevice(db, device, () =>
        upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 40,
          source: 'calendar_auto',
          previous: 300,
        }),
      )
      const second = await attempt(() => db.exec(migrationSql(AFTER)))
      expect(second.error).toBeNull()
      expect(await admittedSources(db)).toEqual(['calendar', 'calendar_auto', 'extraction', 'manual'])
      expect(await columnGrants(db)).toEqual(await columnGrants(await databaseThrough(AFTER)))
      const { rows } = await db.query(
        `select source, previous_minutes from public.member_capacity where member_id = $1`,
        [memberTwo],
      )
      expect(rows).toEqual([{ source: 'calendar_auto', previous_minutes: 300 }])
    })

    it('re-pasting 0031 on an EMPTY table NARROWS the constraint back to three words — silently', async () => {
      // The 0012/0025/0026-on-0028 hazard, on a constraint for the first
      // time: 0031 drops the constraint by name and re-adds its own list.
      // Nothing errors. The column, its grants and its own constraints stay.
      // Recorded in 0039's header; re-pasting 0039 restores the word.
      const paste = await attempt(() => db.exec(migrationSql(NARROWER)))
      expect(paste.error).toBeNull()
      expect(await admittedSources(db)).toEqual(['calendar', 'extraction', 'manual'])
      expect(await hasPreviousColumn(db)).toBe(true)
      const restore = await attempt(() => db.exec(migrationSql(AFTER)))
      expect(restore.error).toBeNull()
      expect(await admittedSources(db)).toEqual(['calendar', 'calendar_auto', 'extraction', 'manual'])
    })

    it('but while an automatic row EXISTS the re-paste of 0031 fails validation — loudly', async () => {
      await asDevice(db, device, () =>
        upsert(db, {
          household: household.id,
          member: memberTwo,
          minutes: 40,
          source: 'calendar_auto',
          previous: 300,
        }),
      )
      const paste = await attempt(() => db.exec(migrationSql(NARROWER)))
      expect(paste.ok).toBe(false)
      expect(paste.error).toMatch(/member_capacity_source_known/)
      // PGlite's single exec rolls the batch back, so the four words stand.
      expect(await admittedSources(db)).toEqual(['calendar', 'calendar_auto', 'extraction', 'manual'])
    })

    it('re-pasting 0005’s create-table on top leaves everything in place — the inline constraint is skipped with its table', async () => {
      const sql = migrationSql('0005_weekly_capacity.sql')
      const matches = sql.match(/create table if not exists public\.member_capacity \([\s\S]*?\n\);/g)
      expect(matches, 'expected the create-table statement exactly once').toHaveLength(1)
      const paste = await attempt(() => db.exec(matches[0]))
      expect(paste.error).toBeNull()
      expect(await admittedSources(db)).toEqual(['calendar', 'calendar_auto', 'extraction', 'manual'])
      expect(await hasPreviousColumn(db)).toBe(true)
    })
  })
})
