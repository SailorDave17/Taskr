// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #480 — a suggested week as a capacity source, against a real Postgres: the
// fifth `source` word `0046` admits, and the trigger it widens so the
// automatic calendar path never writes over one.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". `check:live` and
// `probe:live-grants` see NOTHING of this file (no table, column, signature
// or grant moves), so the read-only catalog query in docs/access-model.md's
// #480 section is the live instrument, and this file is the one that runs
// on every push.
//
// Both directions, `0031`'s and `0039`'s shape: the arm built through `0045`
// is the failure a phone hits on a project where the apply has not happened,
// and it is what proves the second arm's green is the widening and not a
// constraint that never bit. The trigger is proven the same way, because a
// re-paste of `0039` narrows it SILENTLY — the constraint would refuse loudly
// while any `suggested` row exists, the trigger would not.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_APPLY_REFUSED_CODE, CAPACITY_COLUMNS, CAPACITY_SOURCES } from '../lib/capacity.js'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  newDevice,
} from './support/pgliteSupabase.js'

/** Matches `src/lib/capacity.js`'s CAPACITY_COLUMNS — asserted, not copied. */
const READABLE = 'id, member_id, period_start, minutes, note, source, previous_minutes, created_at'

/** A Monday, which is the only weekday `0005` will accept. */
const WEEK = '2026-09-14'

const BEFORE = '0045_member_sign_in_state.sql'
const AFTER = '0046_suggested_capacity_source.sql'

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

/** The trigger function's body, per the catalog. */
async function triggerBody(database) {
  const { rows } = await database.query(
    `select pg_get_functiondef('public.member_capacity_automatic_never_overtypes()'::regprocedure) as def`,
  )
  return rows[0].def
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

describe('a suggested week, run against a real Postgres', () => {
  let db, device, household, memberTwo

  beforeEach(async () => {
    db = await freshDatabase()
    ;({ device, household, memberTwo } = await seedHousehold(db))
  })

  it('READABLE is the module’s column list, so a widening there reaches this file', () => {
    expect(READABLE).toBe(CAPACITY_COLUMNS)
  })

  // -------------------------------------------------------------------------
  // The constraint, in both directions
  // -------------------------------------------------------------------------

  describe('AC 3 — the constraint before and after 0046', () => {
    it('BEFORE: a database built through 0045 REFUSES the fifth word, naming the constraint', async () => {
      const at0045 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0045)
      expect(await admittedSources(at0045)).toEqual(['calendar', 'calendar_auto', 'extraction', 'manual'])

      const refused = await asDevice(at0045, seeded.device, () =>
        attempt(() =>
          upsert(at0045, {
            household: seeded.household.id,
            member: seeded.memberTwo,
            minutes: 210,
            source: 'suggested',
          }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_source_known/)
      await at0045.close()
    })

    it('BEFORE — POSITIVE CONTROL: the same database accepts a calendar row, so the red is the word', async () => {
      const at0045 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0045)
      const accepted = await asDevice(at0045, seeded.device, () =>
        attempt(() =>
          upsert(at0045, {
            household: seeded.household.id,
            member: seeded.memberTwo,
            minutes: 210,
            source: 'calendar',
          }),
        ),
      )
      expect(accepted.error).toBeNull()
      await at0045.close()
    })

    it('AFTER: a database built through 0046 accepts the suggested row, and the row says so', async () => {
      const at0046 = await databaseThrough(AFTER)
      const seeded = await seedHousehold(at0046)
      expect(await admittedSources(at0046)).toEqual([
        'calendar',
        'calendar_auto',
        'extraction',
        'manual',
        'suggested',
      ])
      const row = await asDevice(at0046, seeded.device, async () => {
        const { rows } = await upsert(at0046, {
          household: seeded.household.id,
          member: seeded.memberTwo,
          minutes: 210,
          source: 'suggested',
        })
        return rows[0]
      })
      expect(row).toMatchObject({ minutes: 210, source: 'suggested', previous_minutes: null })
      await at0046.close()
    })

    it('AFTER: still refuses a word nobody defined — the widening admits one value, not any', async () => {
      const refused = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, { household: household.id, member: memberTwo, minutes: 210, source: 'guess' }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_source_known/)
    })

    it('the module’s list and the constraint’s list are the same list', async () => {
      expect(await admittedSources(db)).toEqual([...CAPACITY_SOURCES].sort())
    })

    it('a suggested row may not carry a previous figure — that column is the automatic row’s', async () => {
      const refused = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 210,
            source: 'suggested',
            previous: 300,
          }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/member_capacity_previous_only_when_auto/)
    })

    it('and the column comment names the fifth word and the story', async () => {
      const { rows } = await db.query(
        `select col_description('public.member_capacity'::regclass, attnum) as note
           from pg_attribute
          where attrelid = 'public.member_capacity'::regclass and attname = 'source'`,
      )
      expect(rows[0].note).toMatch(/suggested/)
      expect(rows[0].note).toMatch(/#480/)
      // The earlier stories' words survive the replace — the comment is one
      // sentence about five words, not the last story's about one.
      expect(rows[0].note).toMatch(/calendar_auto/)
      expect(rows[0].note).toMatch(/#106/)
      expect(rows[0].note).toMatch(/#97/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — the manual floor: an automatic write never replaces a suggested week
  // -------------------------------------------------------------------------

  describe('AC 4 — the trigger, before and after 0046', () => {
    it('BEFORE: 0045’s trigger does not know the word — the widening is real, not inherited', async () => {
      const at0045 = await databaseThrough(BEFORE)
      const body = await triggerBody(at0045)
      expect(body).toMatch(/'manual', 'extraction'/)
      expect(body).not.toMatch(/suggested/)
      await at0045.close()
    })

    it('AFTER: the trigger names the word', async () => {
      expect(await triggerBody(db)).toMatch(/'manual', 'extraction', 'suggested'/)
    })

    it('refuses calendar_auto over a suggested row with the code the client recognises', async () => {
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 210, source: 'suggested' }),
      )
      const refused = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 240,
            source: 'calendar_auto',
            previous: 210,
          }),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/cannot replace a figure a person set \(suggested\)/)
      // The stored row is untouched — the person's figure won.
      const { rows } = await db.query(
        `select minutes, source from public.member_capacity where member_id = $1 and period_start = $2`,
        [memberTwo, WEEK],
      )
      expect(rows[0]).toEqual({ minutes: 210, source: 'suggested' })
    })

    it('the refusal carries TA106 — the same code as over a manual row, so the App needs no new branch', async () => {
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 210, source: 'suggested' }),
      )
      // `attempt` flattens the error to its message; the code is read off the
      // thrown object itself, calendarAutoApply.pglite.test.js's idiom.
      let code = null
      await asDevice(db, device, async () => {
        try {
          await upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 240,
            source: 'calendar_auto',
            previous: 210,
          })
        } catch (err) {
          code = err?.code ?? err?.cause?.code ?? null
        }
      })
      expect(code).toBe(AUTO_APPLY_REFUSED_CODE)
    })

    it('POSITIVE CONTROL: calendar_auto over a CALENDAR row is still accepted — the floor did not widen past the word', async () => {
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 210, source: 'calendar' }),
      )
      const accepted = await asDevice(db, device, () =>
        attempt(() =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 240,
            source: 'calendar_auto',
            previous: 210,
          }),
        ),
      )
      expect(accepted.error).toBeNull()
    })

    it('a person’s suggested figure replaces an automatic row and a typed one — a person’s word wins', async () => {
      for (const standing of ['calendar_auto', 'manual']) {
        await db.query('delete from public.member_capacity where member_id = $1', [memberTwo])
        await asDevice(db, device, () =>
          upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 100,
            source: standing,
            previous: standing === 'calendar_auto' ? 300 : null,
          }),
        )
        const row = await asDevice(db, device, async () => {
          const { rows } = await upsert(db, {
            household: household.id,
            member: memberTwo,
            minutes: 210,
            source: 'suggested',
          })
          return rows[0]
        })
        expect(row, standing).toMatchObject({ minutes: 210, source: 'suggested', previous_minutes: null })
      }
    })

    it('and the function comment names both stories', async () => {
      const { rows } = await db.query(
        `select obj_description('public.member_capacity_automatic_never_overtypes()'::regprocedure, 'pg_proc') as note`,
      )
      expect(rows[0].note).toMatch(/#106/)
      expect(rows[0].note).toMatch(/#480/)
      expect(rows[0].note).toMatch(/suggested/)
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability
  // -------------------------------------------------------------------------

  describe('re-runnability', () => {
    it('applies twice without error, and the word and the trigger are still there', async () => {
      const { migrationSql } = await import('./support/pgliteSupabase.js')
      await db.exec(migrationSql(AFTER))
      expect(await admittedSources(db)).toEqual([...CAPACITY_SOURCES].sort())
      expect(await triggerBody(db)).toMatch(/suggested/)
    })

    it('re-pasting 0039 on top narrows the constraint while no suggested row exists, and REFUSES once one does', async () => {
      // The hazard the file's header records. Both halves measured: with no
      // suggested row the re-paste succeeds and the word is gone (the trigger
      // narrows with it, silently); with one, the constraint re-add fails
      // validation and the paste errors out whole.
      const { migrationSql } = await import('./support/pgliteSupabase.js')
      await db.exec(migrationSql('0039_calendar_auto_apply.sql'))
      expect(await admittedSources(db)).not.toContain('suggested')
      expect(await triggerBody(db)).not.toMatch(/suggested/)
      // Restore, write a row, try again.
      await db.exec(migrationSql(AFTER))
      await asDevice(db, device, () =>
        upsert(db, { household: household.id, member: memberTwo, minutes: 210, source: 'suggested' }),
      )
      const repaste = await attempt(() => db.exec(migrationSql('0039_calendar_auto_apply.sql')))
      expect(repaste.ok).toBe(false)
      expect(repaste.error).toMatch(/member_capacity_source_known/)
      expect(await admittedSources(db)).toContain('suggested')
    })
  })
})
