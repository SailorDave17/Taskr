// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #306 — a missed occurrence of a repeating chore does not stack up, against a
// real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Everything here is the
// half only the database can prove: the supersede step lives inside
// `catch_up_repeats_at` (0028), so every claim is about what one pass leaves
// behind — which rows are missed, with what stamp, and which are untouched.
// The client-side arithmetic over the result (`outstandingMinutes`,
// `toAllocatorChores`, `assess`) is imported and run over rows read AS THE
// CLIENT with the client's own column list, so the totals asserted are the
// totals a phone would render, not a reading of the owner's view.
//
// HOW TIME IS HELD: as repeats.pglite.test.js — the suite drives
// `catch_up_repeats_at(as_of)` at fixed instants as the owner (it is granted
// to no client role; the caller identity still scopes it), and history is
// simulated by backdating `repeat_since` as the owner. The one real-clock test
// drives the client surface and says so.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MIGRATIONS,
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'
import { CHORE_COLUMNS, outstandingMinutes, toAllocatorChores } from '../lib/chores.js'
import { assess } from '../lib/allocation.js'

// The pglite boot dominates and the default would straddle CI's worst case —
// the measurement is in completion.pglite.test.js's comment. hookTimeout is
// set once for every pglite suite in support/pgliteSupabase.js (#145).
vi.setConfig({ testTimeout: 30_000 })

// 2026-08-10 is a Monday (repeats.pglite.test.js anchors on the 24th, two
// weeks later). Every instant below is NOON in America/New_York — 16:00Z in
// August — nowhere near a date boundary in the household's zone.
const MONDAY = '2026-08-10'
const noonOn = (date) => `${date}T16:00:00Z`
const TUESDAY_NOON = noonOn('2026-08-11')
const WEDNESDAY_NOON = noonOn('2026-08-12')
const THURSDAY_NOON = noonOn('2026-08-13')
const SUNDAY_NOON = noonOn('2026-08-16')

describe('a superseded occurrence is missed, run against a real Postgres', () => {
  let db, organizer, household, memberTwo

  /** Insert through the CLIENT path — grants and trigger included. */
  const addChore = (
    uid,
    householdId,
    { title, minutes = 10, due, kind = 'none', weekdays = null, monthday = null },
  ) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query(
        `insert into public.chores
           (household_id, title, expected_minutes, due_on, repeat_kind, repeat_weekdays, repeat_monthday)
         values ($1, $2, $3, $4, $5, $6::smallint[], $7::smallint)
         returning id`,
        [householdId, title, minutes, due, kind, weekdays, monthday],
      )
      return rows[0].id
    })

  /**
   * Move a repeat into the past, as the OWNER — the suite's stand-in for
   * elapsed time. `set_repeat_since` stamped today's date on insert; no client
   * can write the column, so this is the only way to give the pass a past.
   */
  const backdateSince = (choreId, since) =>
    db.query('update public.chores set repeat_since = $2 where id = $1', [choreId, since])

  /** A repeat anchored on `due`, switched on that same day. */
  const repeatSince = async (spec) => {
    const id = await addChore(organizer, household.id, spec)
    await backdateSince(id, spec.due)
    return id
  }

  /**
   * The catch-up pass at a HELD instant, as `uid`. Runs as the owner because
   * `catch_up_repeats_at` is deliberately granted to no client role; the
   * caller identity still comes from auth.uid(), which is what scopes it.
   */
  const runAt = async (uid, instant) => {
    await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
    try {
      const { rows } = await db.query(
        'select * from public.catch_up_repeats_at($1::timestamptz)',
        [instant],
      )
      return rows[0]
    } finally {
      await db.query(`select set_config('test.uid', '', false)`)
    }
  }

  /** The anchor and everything generated from it, oldest first, as the owner. */
  const family = async (anchorId) =>
    (
      await db.query(
        `select id, to_char(due_on, 'YYYY-MM-DD') as due_on, completed_at, missed_at,
                assigned_member_id, generated_from
           from public.chores where id = $1 or generated_from = $1 order by due_on`,
        [anchorId],
      )
    ).rows

  const outstandingOf = (rows) => rows.filter((r) => r.completed_at === null && r.missed_at === null)
  const stampOf = (row) => new Date(row.missed_at).getTime()
  const instant = (iso) => Date.parse(iso)

  /** Every chore in the household AS THE CLIENT reads it — the app's own column list. */
  const clientRows = (uid, householdId) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query(
        `select ${CHORE_COLUMNS} from public.chores where household_id = $1`,
        [householdId],
      )
      return rows
    })

  const call = (uid, fn, ...args) =>
    asDevice(db, uid, async () => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
      const { rows } = await db.query(`select * from public.${fn}(${placeholders})`, args)
      return rows[0]
    })

  beforeEach(async () => {
    db = await freshDatabase()
    organizer = await newDevice(db)

    // America/New_York, NOT UTC, so every "which date is it" reading below is
    // taken against a household whose calendar disagrees with UTC for four
    // hours a night — the same discipline repeats.pglite.test.js keeps.
    household = await asDevice(db, organizer, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
        'Placeholder Household',
        'Placeholder Organizer',
        'America/New_York',
      ])
      return rows[0]
    })

    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, 'Placeholder Second', 300) returning id`,
      [household.id],
    )
    memberTwo = rows[0].id
  })

  // -------------------------------------------------------------------------
  // AC 1 — today's occurrence supersedes yesterday's, with the pass's clock
  // -------------------------------------------------------------------------

  describe("AC 1 — when today's occurrence generates, yesterday's is marked missed", () => {
    it("marks Tuesday's occurrence missed when Wednesday's generates, stamped with the instant the pass ran for", async () => {
      const anchor = await repeatSince({ title: 'Dishes', due: MONDAY, kind: 'daily' })

      const tuesday = await runAt(organizer, TUESDAY_NOON)
      expect(tuesday.created_count).toBe(1)
      // The anchor's own due_on is the FIRST occurrence (0012), and nobody
      // ticked it — so Tuesday's occurrence supersedes it, exactly as
      // Wednesday's will supersede Tuesday's. Asserted here so the family's
      // shape below is read as designed rather than as a surprise.
      const [mondayRow] = await family(anchor)
      expect(mondayRow.id).toBe(anchor)
      expect(stampOf(mondayRow)).toBe(instant(TUESDAY_NOON))

      const wednesday = await runAt(organizer, WEDNESDAY_NOON)
      expect(wednesday.created_count).toBe(1)
      expect(wednesday.skipped_count).toBe(0)

      const rows = await family(anchor)
      expect(rows.map((r) => r.due_on)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
      const [monday, tuesdayRow, wednesdayRow] = rows
      // Tuesday's stamp is the WEDNESDAY pass's instant — the clock the pass
      // was asked about, which for the client surface is now(). A stamp read
      // from the wall clock would be 2026-09-02 or later here, not August.
      expect(stampOf(tuesdayRow)).toBe(instant(WEDNESDAY_NOON))
      expect(tuesdayRow.completed_at).toBeNull()
      expect(stampOf(monday)).toBe(instant(TUESDAY_NOON))
      // And Wednesday's is the ONLY outstanding member of the family.
      expect(wednesdayRow.missed_at).toBeNull()
      expect(wednesdayRow.completed_at).toBeNull()
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-12'])
    })

    it('a later pass keeps the FIRST stamp, so a superseded row never moves between weeks on Done', async () => {
      const anchor = await repeatSince({ title: 'Dishes', due: MONDAY, kind: 'daily' })
      await runAt(organizer, TUESDAY_NOON)
      await runAt(organizer, WEDNESDAY_NOON)
      await runAt(organizer, THURSDAY_NOON)

      const rows = await family(anchor)
      expect(rows.map((r) => r.due_on)).toEqual([
        '2026-08-10',
        '2026-08-11',
        '2026-08-12',
        '2026-08-13',
      ])
      // Tuesday was superseded on Wednesday and Thursday's pass leaves that
      // stamp alone — the same reason miss_chore coalesces (0027): the Done
      // surface files the row under the week of the stamp.
      expect(stampOf(rows[1])).toBe(instant(WEDNESDAY_NOON))
      expect(stampOf(rows[2])).toBe(instant(THURSDAY_NOON))
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-13'])
    })

    it("the client surface, catch_up_repeats(), stamps with the DATABASE's clock — the one real-clock test", async () => {
      // Derived from the database's own idea of today so the fixture cannot
      // drift from the clock the pass reads (repeats.pglite.test.js's shape).
      // A UTC household, so today_local and the UTC date agree.
      const other = await newDevice(db)
      const utcHousehold = await asDevice(db, other, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
          'Placeholder Other Household',
          'Placeholder Other Organizer',
          'UTC',
        ])
        return rows[0]
      })
      const { rows: before } = await db.query(
        `select to_char((now() at time zone 'UTC')::date - 3, 'YYYY-MM-DD') as due,
                to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today`,
      )
      const anchor = await addChore(other, utcHousehold.id, {
        title: 'Dishes',
        due: before[0].due,
        kind: 'daily',
      })
      await backdateSince(anchor, before[0].due)

      const dbNow = async () => new Date((await db.query('select now() as t')).rows[0].t).getTime()
      const started = await dbNow()
      const pass = await asDevice(db, other, async () => {
        const { rows } = await db.query('select * from public.catch_up_repeats()')
        return rows[0]
      })
      const finished = await dbNow()

      const { rows: after } = await db.query(
        `select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today`,
      )
      expect(after[0].today).toBe(before[0].today)
      expect(pass.created_count).toBe(3)

      // Three days ago (the anchor), two days ago and yesterday are superseded
      // by today's; each stamp sits between two readings of the server's own
      // clock, which no client value could produce even by coincidence.
      const rows = await family(anchor)
      expect(rows).toHaveLength(4)
      for (const row of rows.slice(0, 3)) {
        expect(stampOf(row)).toBeGreaterThanOrEqual(started)
        expect(stampOf(row)).toBeLessThanOrEqual(finished)
      }
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual([before[0].today])
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — five days away: the bounded pile collapses to one row, counted once
  // -------------------------------------------------------------------------

  describe('AC 2 — a member returns after five days away', () => {
    it('the pass creates the bounded occurrences, marks all but the newest missed, and the total counts the minutes ONCE', async () => {
      // A 20-minute daily, switched on Monday; the app was opened Tuesday and
      // then not until Sunday. The stacked reading would be seven outstanding
      // rows at 20 minutes: 140 minutes of overdue dishes that can no longer
      // be done, counted in the fairness figure. The fact is one row: 20.
      const anchor = await repeatSince({ title: 'Dishes', minutes: 20, due: MONDAY, kind: 'daily' })
      await runAt(organizer, TUESDAY_NOON)

      const sunday = await runAt(organizer, SUNDAY_NOON)
      // Wednesday through Sunday, all inside the seven-day bound — and the
      // supersede is NOT a skip: skipped_count stays what #53 AC 4 defined,
      // which is the AC 7 decision made visible in the pass's own return.
      expect(sunday.created_count).toBe(5)
      expect(sunday.skipped_count).toBe(0)

      const rows = await family(anchor)
      expect(rows.map((r) => r.due_on)).toEqual([
        '2026-08-10',
        '2026-08-11',
        '2026-08-12',
        '2026-08-13',
        '2026-08-14',
        '2026-08-15',
        '2026-08-16',
      ])
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-16'])
      // Everything Sunday's pass created supersedes carries Sunday's stamp;
      // the anchor keeps Tuesday's, from the pass that superseded IT.
      for (const row of rows.slice(1, 6)) expect(stampOf(row)).toBe(instant(SUNDAY_NOON))
      expect(stampOf(rows[0])).toBe(instant(TUESDAY_NOON))

      // As the CLIENT reads it, with the app's own arithmetic: 20, not 140.
      const seen = await clientRows(organizer, household.id)
      expect(seen).toHaveLength(7)
      expect(outstandingMinutes(seen)).toBe(20)
      expect(seen.length * 20).toBe(140)
      expect(outstandingMinutes(seen)).not.toBe(140)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — the same rule per anchor, whatever the kind
  // -------------------------------------------------------------------------

  describe('AC 3 — weekly and monthly behave alike, per anchor', () => {
    it("a weekly's window is its week: nothing happens mid-week, and Monday's occurrence supersedes last Monday's", async () => {
      const anchor = await repeatSince({
        title: 'Trash',
        due: MONDAY,
        kind: 'weekly',
        weekdays: [1],
      })

      // Thursday: no occurrence is due, so nothing generates and nothing is
      // superseded — the overdue Monday row sits on the list until its
      // successor arrives. That is the stated cost of the rule, measured.
      const thursday = await runAt(organizer, THURSDAY_NOON)
      expect(thursday.created_count).toBe(0)
      expect(outstandingOf(await family(anchor)).map((r) => r.due_on)).toEqual(['2026-08-10'])

      const nextMonday = await runAt(organizer, noonOn('2026-08-17'))
      expect(nextMonday.created_count).toBe(1)
      let rows = await family(anchor)
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-17'])
      expect(stampOf(rows[0])).toBe(instant(noonOn('2026-08-17')))

      const mondayAfter = await runAt(organizer, noonOn('2026-08-24'))
      expect(mondayAfter.created_count).toBe(1)
      rows = await family(anchor)
      expect(rows.map((r) => r.due_on)).toEqual(['2026-08-10', '2026-08-17', '2026-08-24'])
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-24'])
      expect(stampOf(rows[1])).toBe(instant(noonOn('2026-08-24')))
    })

    it("a monthly's window is its month, across a month boundary and the February clamp", async () => {
      // Rent on the 31st, anchored on 2027-01-31. February's occurrence is the
      // clamped 28th (#103); March's is the 31st again. Each supersedes the
      // one before it, across two month boundaries.
      const anchor = await repeatSince({
        title: 'Rent',
        due: '2027-01-31',
        kind: 'monthly',
        monthday: 31,
      })

      const february = await runAt(organizer, '2027-02-28T19:00:00Z')
      expect(february.created_count).toBe(1)
      let rows = await family(anchor)
      expect(rows.map((r) => r.due_on)).toEqual(['2027-01-31', '2027-02-28'])
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2027-02-28'])
      expect(stampOf(rows[0])).toBe(instant('2027-02-28T19:00:00Z'))

      const march = await runAt(organizer, '2027-03-31T19:00:00Z')
      expect(march.created_count).toBe(1)
      expect(march.skipped_count).toBe(0)
      rows = await family(anchor)
      expect(rows.map((r) => r.due_on)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2027-03-31'])
      expect(stampOf(rows[1])).toBe(instant('2027-03-31T19:00:00Z'))
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — completed work is history
  // -------------------------------------------------------------------------

  describe('AC 4 — a superseded occurrence that was already completed is untouched', () => {
    it("leaves Tuesday's completion standing when Wednesday's occurrence generates", async () => {
      const anchor = await repeatSince({ title: 'Dishes', due: MONDAY, kind: 'daily' })
      await runAt(organizer, TUESDAY_NOON)
      const [, tuesdayRow] = await family(anchor)
      await call(organizer, 'complete_chore', tuesdayRow.id)

      // The pass must not merely leave the row alone: with the completed guard
      // gone, 0027's CHECK refuses both stamps and the whole pass RAISES — so
      // this asserts the pass succeeded as well as what it left.
      const wednesday = await attempt(() => runAt(organizer, WEDNESDAY_NOON))
      expect(wednesday.error).toBeNull()
      expect(wednesday.value.created_count).toBe(1)

      const rows = await family(anchor)
      const [, tuesday, wednesdayRow] = rows
      expect(tuesday.completed_at).not.toBeNull()
      expect(tuesday.missed_at).toBeNull()
      expect(wednesdayRow.completed_at).toBeNull()
      expect(wednesdayRow.missed_at).toBeNull()
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-12'])
    })

    it('POSITIVE CONTROL: the identical fixture with Tuesday NOT completed marks it missed', async () => {
      // So the assertion above is about completion protecting the row, not
      // about the pass failing to reach Tuesday for some other reason.
      const anchor = await repeatSince({ title: 'Dishes', due: MONDAY, kind: 'daily' })
      await runAt(organizer, TUESDAY_NOON)
      await runAt(organizer, WEDNESDAY_NOON)
      const [, tuesday] = await family(anchor)
      expect(tuesday.completed_at).toBeNull()
      expect(stampOf(tuesday)).toBe(instant(WEDNESDAY_NOON))
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — an assigned occurrence keeps its assignment and weighs nothing
  // -------------------------------------------------------------------------

  describe('AC 5 — a superseded occurrence that was assigned', () => {
    it('keeps the assignment as a record, contributes nothing to the Split, and the new occurrence generates unassigned', async () => {
      const anchor = await repeatSince({ title: 'Dishes', minutes: 10, due: MONDAY, kind: 'daily' })
      await runAt(organizer, TUESDAY_NOON)
      const [, tuesdayRow] = await family(anchor)
      await call(organizer, 'assign_chore', tuesdayRow.id, memberTwo)

      await runAt(organizer, WEDNESDAY_NOON)
      const rows = await family(anchor)
      const [, tuesday, wednesday] = rows
      expect(stampOf(tuesday)).toBe(instant(WEDNESDAY_NOON))
      expect(tuesday.assigned_member_id).toBe(memberTwo)
      expect(wednesday.assigned_member_id).toBeNull()
      expect(wednesday.missed_at).toBeNull()

      // The Split's arithmetic over what the CLIENT reads. Two separate
      // claims, and the review fan-out caught the first draft crediting one
      // to the other: `openMinutes` 0 is the SUPERSEDE's doing (a row that was
      // never marked missed would be open work at 10 — line 431's stamp check
      // discriminates that axis); the FILTER in `toAllocatorChores` is what
      // keeps the row out of `doneMinutes` and `assignedMinutes`, since a
      // missed row that reached the allocator would arrive as done:true, not
      // open. So the filter's evidence is the id list and the done/assigned
      // figures, never the open one.
      const seen = await clientRows(organizer, household.id)
      const normalized = toAllocatorChores(seen)
      expect(normalized.map((c) => c.id)).toEqual([wednesday.id])
      const picture = assess({
        members: [
          { id: household.organizer_member_id, capacityMinutes: 300 },
          { id: memberTwo, capacityMinutes: 300 },
        ],
        chores: normalized,
      })
      const theirs = picture.load.find((entry) => entry.memberId === memberTwo)
      expect(theirs.openMinutes).toBe(0)
      expect(theirs.doneMinutes).toBe(0)
      expect(theirs.assignedMinutes).toBe(0)
      expect(theirs.doneMinutes).not.toBe(10)
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 — a one-off has no anchor, so nothing supersedes it
  // -------------------------------------------------------------------------

  describe('AC 6 — a one-off chore past its due date is untouched', () => {
    it('stays outstanding through a pass that superseded a repeat in the same household', async () => {
      // Older than anything the pass creates, in the SAME household, so a rule
      // that reached past the anchor's family would mark it.
      const oneOff = await addChore(organizer, household.id, {
        title: 'Placeholder Chore',
        due: '2026-08-01',
      })
      const anchor = await repeatSince({ title: 'Dishes', due: MONDAY, kind: 'daily' })

      const tuesday = await runAt(organizer, TUESDAY_NOON)
      expect(tuesday.created_count).toBe(1)

      const { rows } = await db.query(
        'select completed_at, missed_at from public.chores where id = $1',
        [oneOff],
      )
      expect(rows[0].completed_at).toBeNull()
      expect(rows[0].missed_at).toBeNull()

      // POSITIVE CONTROL, in the same pass: the repeat's own anchor WAS
      // superseded, so the step demonstrably ran in this household and simply
      // did not reach the one-off.
      const [mondayRow] = await family(anchor)
      expect(stampOf(mondayRow)).toBe(instant(TUESDAY_NOON))
    })
  })

  // -------------------------------------------------------------------------
  // "Put it back" holds until the next occurrence really arrives
  // -------------------------------------------------------------------------

  describe('a superseded row a member put back', () => {
    it('stays on the list through a pass that creates nothing, and is superseded again by the next real occurrence', async () => {
      const anchor = await repeatSince({ title: 'Dishes', due: MONDAY, kind: 'daily' })
      await runAt(organizer, TUESDAY_NOON)
      await runAt(organizer, WEDNESDAY_NOON)
      const [, tuesdayRow] = await family(anchor)
      expect(tuesdayRow.missed_at).not.toBeNull()

      // "Put it back" (0027): the household says Tuesday's still needs doing.
      await call(organizer, 'unmiss_chore', tuesdayRow.id)

      // A second open the same day creates nothing, so it changes nothing —
      // two outstanding rows, because the household chose that.
      const again = await runAt(organizer, WEDNESDAY_NOON)
      expect(again.created_count).toBe(0)
      expect(outstandingOf(await family(anchor)).map((r) => r.due_on)).toEqual([
        '2026-08-11',
        '2026-08-12',
      ])

      // Thursday's occurrence is a real successor, and it supersedes both.
      const thursday = await runAt(organizer, THURSDAY_NOON)
      expect(thursday.created_count).toBe(1)
      const rows = await family(anchor)
      expect(outstandingOf(rows).map((r) => r.due_on)).toEqual(['2026-08-13'])
      expect(stampOf(rows[1])).toBe(instant(THURSDAY_NOON))
      expect(stampOf(rows[2])).toBe(instant(THURSDAY_NOON))
    })
  })

  // -------------------------------------------------------------------------
  // The pass's shape and privileges — unchanged by decision, read back
  // -------------------------------------------------------------------------

  describe("the pass's return shape and privileges are what 0012 left", () => {
    it('returns the two counts and no third — the AC 7 decision, pinned', async () => {
      // A `create or replace` cannot change a return type, so a third count
      // would have been a DROP of both functions. The decision was to say
      // nothing; this is what makes that a fact rather than an intention.
      const { rows } = await db.query(
        `select pg_get_function_result('public.catch_up_repeats_at(timestamptz)'::regprocedure) as held,
                pg_get_function_result('public.catch_up_repeats()'::regprocedure) as client`,
      )
      expect(rows[0]).toEqual({
        held: 'TABLE(created_count integer, skipped_count integer)',
        client: 'TABLE(created_count integer, skipped_count integer)',
      })
    })

    it('the replace preserved the ACLs: the held form is granted to no client role, the client surface to authenticated', async () => {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.catch_up_repeats_at(timestamptz)', 'execute') as held_auth,
                has_function_privilege('anon', 'public.catch_up_repeats_at(timestamptz)', 'execute') as held_anon,
                has_function_privilege('authenticated', 'public.catch_up_repeats()', 'execute') as client_auth,
                has_function_privilege('anon', 'public.catch_up_repeats()', 'execute') as client_anon`,
      )
      expect(rows[0]).toEqual({
        held_auth: false,
        held_anon: false,
        client_auth: true,
        client_anon: false,
      })
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability, and the reversion hazard the header names
  // -------------------------------------------------------------------------

  describe('0028 is re-runnable, because a human pastes it', () => {
    const stepPresent = async (database) => {
      const { rows } = await database.query(
        `select pg_get_functiondef('public.catch_up_repeats_at(timestamptz)'::regprocedure) as def`,
      )
      return /set missed_at = as_of/.test(rows[0].def)
    }

    it('applies a second time without error, leaves one function, and the step is in it', async () => {
      const through = await databaseThrough('0028_a_superseded_occurrence_is_missed.sql')
      const second = await attempt(() =>
        through.exec(migrationSql('0028_a_superseded_occurrence_is_missed.sql')),
      )
      expect(second.error).toBeNull()
      const { rows } = await through.query(
        `select count(*)::int as n from pg_proc where proname = 'catch_up_repeats_at'`,
      )
      expect(rows).toEqual([{ n: 1 }])
      expect(await stepPresent(through)).toBe(true)
    })

    it('the whole list re-applied in order keeps the step — the sanctioned re-run path', async () => {
      // 0012, 0025 and 0026 each replace the pass; run in ORDER they are all
      // superseded by this file again, which is why the whole-list re-run is
      // safe and a single older re-paste is not (the header says which).
      for (const name of MIGRATIONS) await db.exec(migrationSql(name))
      expect(await stepPresent(db)).toBe(true)
    })

    it('POSITIVE CONTROL: the step reads as absent on a database built only through 0026', async () => {
      // So `stepPresent` can say no — a probe that only ever answers yes is
      // not a probe.
      const through = await databaseThrough('0026_repeat_monthly.sql')
      expect(await stepPresent(through)).toBe(false)
    })

    // The hazard the header names, MEASURED rather than reasoned from the
    // headers (the review fan-out found the first draft of this file's
    // access-model entry calling it measured when no arm existed): each older
    // file carrying its own `catch_up_repeats_at`, re-pasted ON TOP of 0028,
    // succeeds silently and takes the step with it. Not a guard — it asserts
    // the hazard EXISTS, so it goes red the day one of those files stops
    // carrying the pass (which is the day the header's list needs editing).
    it.each([
      '0012_repeating_chores.sql',
      '0025_skip_a_single_occurrence.sql',
      '0026_repeat_monthly.sql',
    ])('re-pasting %s on top of 0028 succeeds and silently reverts the step', async (older) => {
      const through = await databaseThrough('0028_a_superseded_occurrence_is_missed.sql')
      expect(await stepPresent(through)).toBe(true)
      const paste = await attempt(() => through.exec(migrationSql(older)))
      expect(paste.error).toBeNull()
      const { rows } = await through.query(
        `select count(*)::int as n from pg_proc where proname = 'catch_up_repeats_at'`,
      )
      expect(rows).toEqual([{ n: 1 }])
      expect(await stepPresent(through)).toBe(false)
    })
  })
})
