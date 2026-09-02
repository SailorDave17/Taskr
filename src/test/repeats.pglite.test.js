// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #53 — a chore that comes back on its own schedule, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — `npm run check:live` is the authority on live state, and it is red on
// `catch_up_repeats` by design until `0012` is pasted.
//
// HOW TIME IS HELD. The pass's client surface reads `now()`, which no test can
// set — so the suite drives `catch_up_repeats_at(as_of)`, the internal form
// that takes the instant as a parameter and is granted to no client role, with
// FIXED instants. History ("this repeat was set two weeks ago") is simulated by
// backdating `due_on` and `repeat_since` as the owner, because the alternative
// — waiting — is not a test. The one test of the client wrapper itself uses the
// real clock and says so.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'
import {
  CATCH_UP_BOUND_DAYS,
  CATCH_UP_BOUND_MONTHS,
  outstandingMinutes,
  toAllocatorChores,
  upcomingOccurrenceDates,
} from '../lib/chores.js'
import { assess } from '../lib/allocation.js'

// 2026-08-24 is a Monday; every date below is derived from that anchor, and
// getting one wrong fails loudly because the assertions name exact dates.
const MONDAY = '2026-08-24'
const MONDAY_BEFORE = '2026-08-17'
// 15:00 EDT on Monday the 24th — mid-afternoon, nowhere near a date boundary
// in any zone a fixture uses.
const MONDAY_AFTERNOON = '2026-08-24 19:00:00+00'
// The #54 fixtures need days AROUND that Monday: the Friday before it, the
// Sunday afternoon before it, and the Tuesday and Thursday after it — all at
// the same mid-afternoon instant, for the same date-boundary reason.
const FRIDAY_BEFORE = '2026-08-21'
const SUNDAY_AFTERNOON = '2026-08-23 19:00:00+00'
const TUESDAY_AFTERNOON = '2026-08-25 19:00:00+00'
const THURSDAY_AFTERNOON = '2026-08-27 19:00:00+00'

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
// hookTimeout is NOT set here. It is set once, for every pglite suite, in
// src/test/support/pgliteSupabase.js — which this file imports — and the
// measurement behind the value is in that file's comment. #145.
//
// It used to be seven copies of a paragraph explaining why the 10s default was
// deliberate. Two suites then timed out on it, the correction reached one copy,
// and six went on asserting the opposite of what the code did. A value with one
// home has no copy-set to keep in step.
vi.setConfig({ testTimeout: 30_000 })

describe('a chore that repeats, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, householdB, memberTwoA

  /**
   * Insert through the CLIENT path — grants and trigger included. RETURNING
   * only granted columns: `repeat_since` is deliberately unreadable by a
   * client (RETURNING needs select privilege), which is itself asserted below.
   */
  const addChore = (
    uid,
    household,
    { title, minutes = 10, due, kind = 'none', weekdays = null, monthday = null },
  ) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query(
        `insert into public.chores
           (household_id, title, expected_minutes, due_on, repeat_kind, repeat_weekdays, repeat_monthday)
         values ($1, $2, $3, $4, $5, $6::smallint[], $7::smallint)
         returning id, repeat_kind`,
        [household, title, minutes, due, kind, weekdays, monthday],
      )
      return rows[0]
    })

  /** `repeat_since`, read as the OWNER — no client grant covers it. */
  const repeatSinceOf = async (choreId) => {
    const { rows } = await db.query(
      `select to_char(repeat_since, 'YYYY-MM-DD') as since from public.chores where id = $1`,
      [choreId],
    )
    return rows[0].since
  }

  /**
   * Move a repeat into the past, as the OWNER. This is the suite's stand-in
   * for elapsed time: no client can write either column (`due_on` it can, but
   * `repeat_since` has no grant), and nothing else here bypasses the grants.
   */
  const backdate = (choreId, { due = null, since = null }) =>
    db.query(
      `update public.chores
         set due_on = coalesce($2, due_on), repeat_since = coalesce($3, repeat_since)
       where id = $1`,
      [choreId, due, since],
    )

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

  const occurrenceDates = async (parentId) => {
    const { rows } = await db.query(
      `select to_char(due_on, 'YYYY-MM-DD') as due_on
       from public.chores where generated_from = $1 order by due_on`,
      [parentId],
    )
    return rows.map((r) => r.due_on)
  }

  const occurrenceRows = async (parentId) => {
    const { rows } = await db.query(
      `select id, to_char(due_on, 'YYYY-MM-DD') as due_on, expected_minutes,
              assigned_member_id, completed_at, repeat_kind, repeat_since
       from public.chores where generated_from = $1 order by due_on`,
      [parentId],
    )
    return rows
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)
    deviceB = await newDevice(db)

    // America/New_York, NOT UTC, so every "which date is it" assertion below
    // is exercised against a household whose calendar disagrees with UTC for
    // four hours a night — the AC 5 tests depend on that gap existing.
    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
        'Placeholder Household',
        'Placeholder Organizer',
        'America/New_York',
      ])
      return rows[0]
    })
    householdB = await asDevice(db, deviceB, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
        'UTC',
      ])
      return rows[0]
    })

    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, 'Placeholder Second', 300) returning id`,
      [householdA.id],
    )
    memberTwoA = rows[0].id
  })

  // -------------------------------------------------------------------------
  // AC 6 — a schedule is structured, never free text
  // -------------------------------------------------------------------------

  describe('AC 6 — the schedule is structured', () => {
    it('free text is refused, by the named constraint', async () => {
      const result = await attempt(() =>
        addChore(deviceA, householdA.id, { title: 'Vague', due: MONDAY, kind: 'every other thursday' }),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/chores_repeat_kind_known/)
    })

    it('monthly is structured too — a day-of-month choice, never free text (#103 AC 2)', async () => {
      // This test refused the KIND until #103 landed it — the rule changed, so
      // the test was REWRITTEN rather than deleted: what survives is #53 AC 6's
      // contract, which monthly now has to honour. The kind is admitted; a
      // monthly schedule missing its day, carrying a day on the wrong kind, or
      // carrying a day no month has, is refused by the named constraint.
      const accepted = await addChore(deviceA, householdA.id, {
        title: 'Rent',
        due: MONDAY,
        kind: 'monthly',
        monthday: 31,
      })
      expect(accepted.repeat_kind).toBe('monthly')

      const cases = [
        { kind: 'monthly', monthday: null }, // monthly with no day: never fires
        { kind: 'monthly', monthday: 0 }, // no zeroth day
        { kind: 'monthly', monthday: 32 }, // no 32nd day of any month
        { kind: 'daily', monthday: 12 }, // a day on a kind that ignores it
        { kind: 'none', monthday: 12 },
      ]
      for (const { kind, monthday } of cases) {
        const result = await attempt(() =>
          addChore(deviceA, householdA.id, { title: 'Shaped', due: MONDAY, kind, monthday }),
        )
        expect(result.ok, `${kind} with monthday ${monthday} should be refused`).toBe(false)
        expect(result.error).toMatch(/chores_repeat_monthday_shape/)
      }

      // And weekdays still travel with weekly alone — a monthly repeat
      // carrying a weekday set is refused by the OTHER shape constraint.
      const crossed = await attempt(() =>
        addChore(deviceA, householdA.id, {
          title: 'Shaped',
          due: MONDAY,
          kind: 'monthly',
          weekdays: '{1}',
          monthday: 12,
        }),
      )
      expect(crossed.ok).toBe(false)
      expect(crossed.error).toMatch(/chores_repeat_weekdays_shape/)
    })

    it('weekdays travel with weekly and only with weekly, and the set must be real', async () => {
      const cases = [
        { kind: 'weekly', weekdays: null }, // weekly with no days: never comes back
        { kind: 'weekly', weekdays: '{}' }, // empty array: array_length is null, the coalesce case
        { kind: 'weekly', weekdays: '{8}' }, // no eighth day
        { kind: 'daily', weekdays: '{1}' }, // days on a kind that ignores them
        { kind: 'none', weekdays: '{1}' },
      ]
      for (const { kind, weekdays } of cases) {
        const result = await attempt(() =>
          addChore(deviceA, householdA.id, { title: 'Shaped', due: MONDAY, kind, weekdays }),
        )
        expect(result.ok, `${kind} with ${weekdays} should be refused`).toBe(false)
        expect(result.error).toMatch(/chores_repeat_weekdays_shape/)
      }
    })

    it('repeat_since is the DATABASE\'s date in the household\'s zone, and no client wrote it', async () => {
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Trash',
        due: MONDAY,
        kind: 'weekly',
        weekdays: '{1}',
      })
      const { rows } = await db.query(
        `select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as today`,
      )
      expect(await repeatSinceOf(chore.id)).toBe(rows[0].today)

      const plain = await addChore(deviceA, householdA.id, { title: 'Once', due: MONDAY })
      expect(await repeatSinceOf(plain.id)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — the Monday arrives and exactly one dated chore exists for it
  // -------------------------------------------------------------------------

  /**
   * The issue's own scenario: a 10-minute chore, repeating weekly on Monday,
   * with one member excluded — set up as though it were created LAST Monday.
   */
  const trashSinceLastMonday = async () => {
    const chore = await addChore(deviceA, householdA.id, {
      title: 'Trash',
      minutes: 10,
      due: MONDAY_BEFORE,
      kind: 'weekly',
      weekdays: '{1}',
    })
    await backdate(chore.id, { since: MONDAY_BEFORE })
    await db.query(
      `insert into public.chore_exclusions (household_id, chore_id, member_id)
       values ($1, $2, $3)`,
      [householdA.id, chore.id, memberTwoA],
    )
    return chore
  }

  describe('AC 1 — a weekly Monday chore comes back on Monday', () => {
    it('creates exactly one occurrence, carrying the minutes and the exclusions', async () => {
      const parent = await trashSinceLastMonday()
      const pass = await runAt(deviceA, MONDAY_AFTERNOON)

      expect(pass.created_count).toBe(1)
      const made = await occurrenceRows(parent.id)
      expect(made.map((r) => r.due_on)).toEqual([MONDAY])
      expect(made[0].expected_minutes).toBe(10)
      // Unassigned, uncompleted work like any other chore — AC 7's premise.
      expect(made[0].assigned_member_id).toBeNull()
      expect(made[0].completed_at).toBeNull()
      // An occurrence does not itself repeat; the constraint below pins it.
      expect(made[0].repeat_kind).toBe('none')

      const { rows: copied } = await db.query(
        `select member_id from public.chore_exclusions where chore_id = $1`,
        [made[0].id],
      )
      expect(copied.map((r) => r.member_id)).toEqual([memberTwoA])
    })

    it('AC 7 — re-assignment picks the occurrence up with no special case', async () => {
      const parent = await trashSinceLastMonday()
      await runAt(deviceA, MONDAY_AFTERNOON)
      const [made] = await occurrenceRows(parent.id)

      const assigned = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          'select assigned_member_id from public.assign_chore($1, $2)',
          [made.id, memberTwoA],
        )
        return rows[0]
      })
      expect(assigned.assigned_member_id).toBe(memberTwoA)
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — exactly once, and the INDEX is what enforces it
  // -------------------------------------------------------------------------

  describe('AC 2 — one chore per occurrence, held by the unique index', () => {
    it('the pass twice in succession leaves one row', async () => {
      const parent = await trashSinceLastMonday()
      const first = await runAt(deviceA, MONDAY_AFTERNOON)
      const second = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(first.created_count).toBe(1)
      expect(second.created_count).toBe(0)
      expect(await occurrenceDates(parent.id)).toEqual([MONDAY])
    })

    it('a simulated double-fire — the watermark wiped, the pass re-run — creates nothing, because the INDEX refuses it', async () => {
      // Two devices in the same second both pass the watermark check; wiping it
      // reproduces that state exactly. If this test reddens while the one above
      // stays green, somebody has made the watermark load-bearing — the AC says
      // the constraint, not application logic, holds the invariant.
      const parent = await trashSinceLastMonday()
      await runAt(deviceA, MONDAY_AFTERNOON)
      await db.query('update public.chores set repeat_caught_up_through = null where id = $1', [
        parent.id,
      ])
      const rerun = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(rerun.created_count).toBe(0)
      expect(await occurrenceDates(parent.id)).toEqual([MONDAY])
    })

    it('the index itself refuses a duplicate, by name', async () => {
      const parent = await trashSinceLastMonday()
      await runAt(deviceA, MONDAY_AFTERNOON)
      const dup = await attempt(() =>
        db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on, generated_from)
           values ($1, 'Trash', 10, $2, $3)`,
          [householdA.id, MONDAY, parent.id],
        ),
      )
      expect(dup.ok).toBe(false)
      expect(dup.error).toMatch(/chores_one_occurrence_per_date/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — catch-up creates every missed occurrence once, none before the
  // repeat was set
  // -------------------------------------------------------------------------

  describe('AC 3 — missed occurrences inside the bound', () => {
    it('a daily repeat switched on three days ago fills exactly those days', async () => {
      // The chore is OLD (due 08-10) but the repeat was set on the 21st: the
      // days between due date and switch-on must NOT appear, even though every
      // one of them is inside the bound window.
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Dishes',
        due: '2026-08-10',
        kind: 'daily',
      })
      await backdate(chore.id, { since: '2026-08-21' })

      const pass = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(pass.created_count).toBe(3)
      expect(pass.skipped_count).toBe(0)
      expect(await occurrenceDates(chore.id)).toEqual(['2026-08-22', '2026-08-23', '2026-08-24'])
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — the bound, and the household being told
  // -------------------------------------------------------------------------

  describe('AC 4 — a gap longer than the bound is skipped and said', () => {
    it('creates only the last seven days and counts the older ones as skipped', async () => {
      // Five weeks of nobody opening the app: 2026-07-20 (a Monday) to Monday
      // the 24th of August. 36 daily occurrences fall in (07-20, 08-24];
      // exactly 7 are inside the bound and 28 are older than it. The pile a
      // household walks into is bounded; the fact that older work was skipped
      // is returned rather than swallowed.
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Dishes',
        due: '2026-07-20',
        kind: 'daily',
      })
      await backdate(chore.id, { since: '2026-07-20' })

      const pass = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(pass.created_count).toBe(7)
      expect(pass.skipped_count).toBe(28)
      expect(await occurrenceDates(chore.id)).toEqual([
        '2026-08-18',
        '2026-08-19',
        '2026-08-20',
        '2026-08-21',
        '2026-08-22',
        '2026-08-23',
        '2026-08-24',
      ])
    })

    it('announces a skipped gap once, not on every open forever', async () => {
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Dishes',
        due: '2026-07-20',
        kind: 'daily',
      })
      await backdate(chore.id, { since: '2026-07-20' })

      const first = await runAt(deviceA, MONDAY_AFTERNOON)
      const second = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(first.skipped_count).toBe(28)
      expect(second.skipped_count).toBe(0)
    })

    it('the bounds are ONE pair of constants: the migration and the client copies agree', async () => {
      // RE-POINTED FROM 0012 TO 0026 by #103, AND FROM 0026 TO 0028 by #306,
      // for the same reason each time — the guard's own subject moving rather
      // than a tidy-up: each of those files replaces `catch_up_repeats_at`,
      // so the earlier declaration is historical text in a body that no
      // longer runs. A test reading it would go on passing while asserting
      // against a number the database does not use — which is the shape where
      // a guard stays where the hazard was.
      //
      // Both bounds are asserted, because #103 made the bound kind-dependent:
      // seven days for daily/weekly, one month for monthly.
      const source = migrationSql('0028_a_superseded_occurrence_is_missed.sql')
      const days = source.match(/catch_up_bound_days constant integer := (\d+);/)
      const months = source.match(/catch_up_bound_months constant integer := (\d+);/)
      // Positive control first: if either regex stops matching, that is a
      // finding, not a pass — an absent match must never read as agreement.
      expect(days).not.toBeNull()
      expect(months).not.toBeNull()
      expect(Number(days[1])).toBe(CATCH_UP_BOUND_DAYS)
      expect(Number(months[1])).toBe(CATCH_UP_BOUND_MONTHS)
      expect(CATCH_UP_BOUND_DAYS).toBe(7)
      expect(CATCH_UP_BOUND_MONTHS).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — the household's calendar decides, whatever the session's zone says
  // -------------------------------------------------------------------------

  describe("AC 5 — the occurrence date is the household's local date", () => {
    // Sunday 23:30 in America/New_York (EDT, UTC-4) is already Monday 03:30 in
    // UTC. A pass that reads the server's calendar instead of the household's
    // creates Monday's chore half an hour early — which is the exact fault the
    // fixture zone exists to expose.
    const SUNDAY_2330_EASTERN = '2026-08-24 03:30:00+00'
    const MONDAY_0030_EASTERN = '2026-08-24 04:30:00+00'

    it('at 23:30 Sunday household time, Monday has not arrived — at 00:30 Monday it has', async () => {
      const parent = await trashSinceLastMonday()

      const sunday = await runAt(deviceA, SUNDAY_2330_EASTERN)
      expect(sunday.created_count).toBe(0)
      expect(await occurrenceDates(parent.id)).toEqual([])

      const monday = await runAt(deviceA, MONDAY_0030_EASTERN)
      expect(monday.created_count).toBe(1)
      expect(await occurrenceDates(parent.id)).toEqual([MONDAY])
    })

    it('the SAME instant is already Monday for a UTC household — the zone decides, not the clock', async () => {
      // Household B is UTC. Without this arm, the test above would also pass if
      // the pass created nothing ever; a household for which the identical
      // instant IS Monday is what proves the zone is the discriminating input.
      const chore = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, repeat_kind, repeat_weekdays)
           values ($1, 'Trash', 10, $2, 'weekly', '{1}'::smallint[])
           returning id`,
          [householdB.id, MONDAY_BEFORE],
        )
        return rows[0]
      })
      await backdate(chore.id, { since: MONDAY_BEFORE })

      const pass = await runAt(deviceB, SUNDAY_2330_EASTERN)
      expect(pass.created_count).toBe(1)
      expect(await occurrenceDates(chore.id)).toEqual([MONDAY])
    })

    it('a weekly Monday repeat lands on the local Monday across the spring-forward boundary', async () => {
      // US DST begins 02:00 on Sunday 2026-03-08; Monday the 9th is the first
      // day the household's offset is -4 instead of -5. 23:30 Sunday local is
      // 03:30Z Monday; the occurrence must wait for local midnight (04:00Z).
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Trash',
        due: '2026-03-02',
        kind: 'weekly',
        weekdays: '{1}',
      })
      await backdate(chore.id, { since: '2026-03-02' })

      const lateSunday = await runAt(deviceA, '2026-03-09 03:30:00+00')
      expect(lateSunday.created_count).toBe(0)

      const monday = await runAt(deviceA, '2026-03-09 05:00:00+00')
      expect(monday.created_count).toBe(1)
      expect(await occurrenceDates(chore.id)).toEqual(['2026-03-09'])
    })

    describe('identical outcomes under a UTC and a non-UTC session zone', () => {
      // The pass must read the HOUSEHOLD's zone, never the session's. Postgres
      // defaults the session to UTC, which is exactly the setting under which
      // a `now()::date` shortcut looks correct — so the scenario runs twice,
      // pinned to UTC and pinned well behind it, and the outcomes must match.
      const runPinnedTo = async (sessionZone) => {
        const pinned = await freshDatabase()
        await pinned.exec(`set timezone = '${sessionZone}'`)
        const uid = await newDevice(pinned)
        const household = await asDevice(pinned, uid, async () => {
          const { rows } = await pinned.query('select * from public.create_household($1, $2, $3)', [
            'Placeholder Household',
            'Placeholder Organizer',
            'America/New_York',
          ])
          return rows[0]
        })
        const { rows: choreRows } = await asDevice(pinned, uid, () =>
          pinned.query(
            `insert into public.chores
               (household_id, title, expected_minutes, due_on, repeat_kind, repeat_weekdays)
             values ($1, 'Trash', 10, $2, 'weekly', '{1}'::smallint[]) returning id`,
            [household.id, MONDAY_BEFORE],
          ),
        )
        const chore = choreRows[0]
        await pinned.query('update public.chores set repeat_since = $2 where id = $1', [
          chore.id,
          MONDAY_BEFORE,
        ])

        await pinned.query(`select set_config('test.uid', $1, false)`, [uid])
        const sundayPass = (
          await pinned.query('select * from public.catch_up_repeats_at($1::timestamptz)', [
            SUNDAY_2330_EASTERN,
          ])
        ).rows[0]
        const mondayPass = (
          await pinned.query('select * from public.catch_up_repeats_at($1::timestamptz)', [
            MONDAY_0030_EASTERN,
          ])
        ).rows[0]
        const { rows: made } = await pinned.query(
          `select to_char(due_on, 'YYYY-MM-DD') as due_on from public.chores
           where generated_from = $1 order by due_on`,
          [chore.id],
        )
        const { rows: zone } = await pinned.query('select current_setting(\'TimeZone\') as tz')
        return {
          sessionZone: zone[0].tz,
          sundayCreated: sundayPass.created_count,
          mondayCreated: mondayPass.created_count,
          dates: made.map((r) => r.due_on),
        }
      }

      it('the pinned zones are in force, and the outcomes are identical AND correct', async () => {
        const utc = await runPinnedTo('UTC')
        const marquesas = await runPinnedTo('Pacific/Marquesas')

        // POSITIVE CONTROL — the pin itself. Delete either `set timezone` and
        // this is the named test that reddens: two runs in the same zone
        // asserting "identical" would prove nothing.
        expect(utc.sessionZone).toBe('UTC')
        expect(marquesas.sessionZone).toBe('Pacific/Marquesas')

        // Identical — the session zone is not an input to the schedule…
        expect(marquesas.sundayCreated).toBe(utc.sundayCreated)
        expect(marquesas.mondayCreated).toBe(utc.mondayCreated)
        expect(marquesas.dates).toEqual(utc.dates)

        // …and correct, so "identically wrong" cannot pass either.
        expect(utc.sundayCreated).toBe(0)
        expect(utc.mondayCreated).toBe(1)
        expect(utc.dates).toEqual([MONDAY])
      })
    })
  })

  // -------------------------------------------------------------------------
  // The watermark: deletion stays deleted, and it never retreats
  // -------------------------------------------------------------------------

  describe('the watermark', () => {
    it('a deleted occurrence stays deleted on the next open', async () => {
      const parent = await trashSinceLastMonday()
      await runAt(deviceA, MONDAY_AFTERNOON)
      const [made] = await occurrenceRows(parent.id)

      await asDevice(db, deviceA, () =>
        db.query('delete from public.chores where id = $1', [made.id]),
      )
      const rerun = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(rerun.created_count).toBe(0)
      expect(await occurrenceDates(parent.id)).toEqual([])
    })

    it('never moves backward, so a timezone change cannot re-announce a gap', async () => {
      const parent = await trashSinceLastMonday()
      await db.query(`update public.chores set repeat_caught_up_through = '2026-09-01' where id = $1`, [
        parent.id,
      ])
      const pass = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(pass.created_count).toBe(0)
      const { rows } = await db.query(
        `select to_char(repeat_caught_up_through, 'YYYY-MM-DD') as mark
         from public.chores where id = $1`,
        [parent.id],
      )
      expect(rows[0].mark).toBe('2026-09-01')
    })
  })

  // -------------------------------------------------------------------------
  // Access — who may write what, and how far the pass reaches
  // -------------------------------------------------------------------------

  describe('grants and scope', () => {
    it('a client cannot write generated_from — the exactly-once key cannot be forged', async () => {
      const result = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, generated_from)
             values ($1, 'Forged', 10, $2, $3)`,
            [householdA.id, MONDAY, '00000000-0000-0000-0000-000000000000'],
          ),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied/)
    })

    it('a client cannot write repeat_since or the watermark', async () => {
      for (const column of ['repeat_since', 'repeat_caught_up_through']) {
        const result = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query(
              `insert into public.chores (household_id, title, expected_minutes, due_on, ${column})
               values ($1, 'Stamped', 10, $2, $3)`,
              [householdA.id, MONDAY, MONDAY],
            ),
          ),
        )
        expect(result.ok, `${column} must not be client-writable`).toBe(false)
        expect(result.error).toMatch(/permission denied/)
      }
    })

    it('a client may UPDATE the repeat pair (0024) and still cannot touch the bookkeeping columns', async () => {
      // This test asserted the whole UPDATE was refused until #54 landed the
      // grant — the rule changed, so the test was REWRITTEN rather than
      // deleted: what survives is the boundary, which is now inside the row.
      // The pair is editable; the pass's and trigger's own columns are not.
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Trash',
        due: MONDAY,
        kind: 'weekly',
        weekdays: '{1}',
      })
      const edited = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `update public.chores set repeat_kind = 'none', repeat_weekdays = null where id = $1`,
            [chore.id],
          ),
        ),
      )
      expect(edited.ok).toBe(true)

      for (const [column, value] of [
        ['repeat_since', `'${MONDAY}'`],
        ['repeat_caught_up_through', `'${MONDAY}'`],
        ['generated_from', 'null'],
      ]) {
        const result = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query(`update public.chores set ${column} = ${value} where id = $1`, [chore.id]),
          ),
        )
        expect(result.ok, `${column} must stay out of the client's update grant`).toBe(false)
        expect(result.error).toMatch(/permission denied/)
      }
    })

    it('an occurrence cannot itself repeat, by the named constraint', async () => {
      const parent = await trashSinceLastMonday()
      const result = await attempt(() =>
        db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, generated_from, repeat_kind)
           values ($1, 'Trash', 10, $2, $3, 'daily')`,
          [householdA.id, MONDAY, parent.id],
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/chores_occurrence_does_not_repeat/)
    })

    it("an occurrence cannot name another household's parent", async () => {
      const parent = await trashSinceLastMonday()
      const result = await attempt(() =>
        db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, generated_from)
           values ($1, 'Crossed', 10, $2, $3)`,
          [householdB.id, MONDAY, parent.id],
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/chores_generated_from_in_household/)
    })

    it('deleting the parent ends the schedule and ORPHANS the occurrences — completed history survives', async () => {
      const parent = await trashSinceLastMonday()
      await runAt(deviceA, MONDAY_AFTERNOON)
      const [made] = await occurrenceRows(parent.id)

      await asDevice(db, deviceA, () =>
        db.query('delete from public.chores where id = $1', [parent.id]),
      )
      const { rows } = await db.query(
        'select generated_from from public.chores where id = $1',
        [made.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].generated_from).toBeNull()
    })

    it('the pass is refused unauthenticated', async () => {
      const result = await attempt(() => runAt(null, MONDAY_AFTERNOON))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not authenticated/)
    })

    it("the pass reaches the caller's households and nobody else's", async () => {
      const mine = await trashSinceLastMonday()
      const theirs = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, repeat_kind, repeat_weekdays)
           values ($1, 'Theirs', 10, $2, 'weekly', '{1}'::smallint[]) returning id`,
          [householdB.id, MONDAY_BEFORE],
        )
        return rows[0]
      })
      await backdate(theirs.id, { since: MONDAY_BEFORE })

      const pass = await runAt(deviceA, MONDAY_AFTERNOON)
      expect(pass.created_count).toBe(1)
      expect(await occurrenceDates(mine.id)).toEqual([MONDAY])
      expect(await occurrenceDates(theirs.id)).toEqual([])

      const theirPass = await runAt(deviceB, MONDAY_AFTERNOON)
      expect(theirPass.created_count).toBe(1)
      expect(await occurrenceDates(theirs.id)).toEqual([MONDAY])
    })

    it('the client surface, catch_up_repeats(), is granted and runs on the database clock', async () => {
      // The one real-clock test, and the fixture is derived from the DATABASE's
      // own idea of today so it cannot drift from the clock the pass reads. If
      // UTC midnight rolls in the milliseconds between the two statements the
      // guard assertion fails loudly rather than the counts flaking.
      const { rows: before } = await db.query(
        `select to_char((now() at time zone 'UTC')::date - 3, 'YYYY-MM-DD') as due,
                to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today`,
      )
      const chore = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query(
          `insert into public.chores
             (household_id, title, expected_minutes, due_on, repeat_kind)
           values ($1, 'Daily', 10, $2, 'daily') returning id`,
          [householdB.id, before[0].due],
        )
        return rows[0]
      })
      await backdate(chore.id, { since: before[0].due })

      const pass = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query('select * from public.catch_up_repeats()')
        return rows[0]
      })

      const { rows: after } = await db.query(
        `select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today`,
      )
      expect(after[0].today).toBe(before[0].today)
      expect(pass.created_count).toBe(3)
      expect(pass.skipped_count).toBe(0)
    })

    it('the internal, clock-taking form is granted to NO client role', async () => {
      const result = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(`select * from public.catch_up_repeats_at(now())`),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied/)
    })
  })

  // -------------------------------------------------------------------------
  // #54 — editing a repeat changes only what has not been dated yet
  // -------------------------------------------------------------------------

  describe('#54 — editing a repeat', () => {
    /**
     * The client's own edit paths, mirrored as PostgREST issues them: the
     * estimate accept sends `expected_minutes` alone, and a schedule edit or
     * switch-off sends the PAIR — `normalizeRepeat` always produces both
     * columns, because `chores_repeat_weekdays_shape` ties them.
     */
    const setMinutesAsClient = (uid, choreId, minutes) =>
      asDevice(db, uid, () =>
        db.query(`update public.chores set expected_minutes = $2 where id = $1`, [choreId, minutes]),
      )
    const setRepeatAsClient = (uid, choreId, kind, weekdays = null) =>
      asDevice(db, uid, () =>
        db.query(
          `update public.chores set repeat_kind = $2, repeat_weekdays = $3::smallint[] where id = $1`,
          [choreId, kind, weekdays],
        ),
      )

    /** A daily 10-minute repeat running since Friday, caught up through Sunday. */
    const dailySinceFriday = async () => {
      const anchor = await addChore(deviceA, householdA.id, {
        title: 'Dishes',
        minutes: 10,
        due: FRIDAY_BEFORE,
        kind: 'daily',
      })
      await backdate(anchor.id, { since: FRIDAY_BEFORE })
      const pass = await runAt(deviceA, SUNDAY_AFTERNOON)
      // Two occurrences exist when the edits below happen: Saturday (past) and
      // Sunday (the fixture's present). Monday's does not exist yet — it is
      // the future occurrence the pass creates AFTER the edit.
      expect(pass.created_count).toBe(2)
      return anchor
    }

    describe('AC 1 — an estimate edit reaches only what is not yet dated', () => {
      it('past and present occurrences keep their minutes; the future one carries the new value', async () => {
        const anchor = await dailySinceFriday()

        await setMinutesAsClient(deviceA, anchor.id, 25)

        const after = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(after.created_count).toBe(1)

        const rows = await occurrenceRows(anchor.id)
        expect(rows.map((r) => [r.due_on, r.expected_minutes])).toEqual([
          ['2026-08-22', 10], // past — created before the edit
          ['2026-08-23', 10], // present — the date the edit happened
          ['2026-08-24', 25], // future — created after it, from the anchor's new value
        ])
      })
    })

    describe('AC 2 — a schedule edit', () => {
      it('leaves created occurrences alone; the next one is computed from the new schedule', async () => {
        const anchor = await trashSinceLastMonday()
        await runAt(deviceA, MONDAY_AFTERNOON)
        expect(await occurrenceDates(anchor.id)).toEqual([MONDAY])

        // Monday → Thursday. The Monday occurrence already on the list is not
        // this edit's to move.
        await setRepeatAsClient(deviceA, anchor.id, 'weekly', '{4}')

        const pass = await runAt(deviceA, THURSDAY_AFTERNOON)
        expect(pass.created_count).toBe(1)
        const rows = await occurrenceRows(anchor.id)
        expect(rows.map((r) => r.due_on)).toEqual([MONDAY, '2026-08-27'])
        expect(rows[0].expected_minutes).toBe(10)
      })

      it('the kind itself can change, and the watermark keeps the new schedule from back-filling', async () => {
        const anchor = await trashSinceLastMonday()
        await runAt(deviceA, MONDAY_AFTERNOON)

        // Weekly-on-Monday → daily. Tuesday's pass creates Tuesday and nothing
        // behind the watermark — a daily schedule read from scratch would owe
        // every day since the 17th, and the watermark is what says those days
        // were already decided under the old schedule.
        await setRepeatAsClient(deviceA, anchor.id, 'daily', null)

        const pass = await runAt(deviceA, TUESDAY_AFTERNOON)
        expect(pass.created_count).toBe(1)
        expect(pass.skipped_count).toBe(0)
        expect(await occurrenceDates(anchor.id)).toEqual([MONDAY, '2026-08-25'])
      })
    })

    describe('AC 3 — switching a repeat off', () => {
      it('creates nothing further and keeps every dated occurrence', async () => {
        const anchor = await dailySinceFriday()

        await setRepeatAsClient(deviceA, anchor.id, 'none', null)
        // The 0012 trigger nulled repeat_since — the constraint requires it,
        // and the trigger rather than the client is its author.
        expect(await repeatSinceOf(anchor.id)).toBeNull()

        const pass = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(pass.created_count).toBe(0)
        expect(pass.skipped_count).toBe(0)
        // Switching off a repeat is not a way to delete this week's chores.
        expect(await occurrenceDates(anchor.id)).toEqual(['2026-08-22', '2026-08-23'])
      })

      it('re-enabling later cannot back-fill the off window — repeat_since is re-stamped, not restored', async () => {
        const anchor = await dailySinceFriday()
        await setRepeatAsClient(deviceA, anchor.id, 'none', null)

        // Back on. The trigger stamps repeat_since with the DATABASE's real
        // today — a held instant cannot reach a trigger — so assert it was
        // stamped at all, then backdate it to Wednesday to bring the fixture
        // back onto held time.
        await setRepeatAsClient(deviceA, anchor.id, 'daily', null)
        expect(await repeatSinceOf(anchor.id)).not.toBeNull()
        await backdate(anchor.id, { since: '2026-08-26' })

        const pass = await runAt(deviceA, THURSDAY_AFTERNOON)
        expect(pass.created_count).toBe(1)
        expect(pass.skipped_count).toBe(0)
        // Thursday arrives; Monday through Wednesday — the off window — never
        // materialises, because nothing may be dated at or before repeat_since.
        expect(await occurrenceDates(anchor.id)).toEqual([
          '2026-08-22',
          '2026-08-23',
          '2026-08-27',
        ])
      })
    })

    describe('AC 5 — committed load does not move underneath somebody', () => {
      /**
       * Saturday's occurrence assigned (outstanding — exactly the row the
       * allocator counts against capacity), Sunday's completed (history).
       * Every arm below is a client-path change to the ANCHOR.
       */
      const committedFixture = async () => {
        const anchor = await dailySinceFriday()
        const [saturday, sunday] = await occurrenceRows(anchor.id)
        await asDevice(db, deviceA, () =>
          db.query('select * from public.assign_chore($1, $2)', [saturday.id, memberTwoA]),
        )
        await asDevice(db, deviceA, () =>
          db.query('select * from public.complete_chore($1)', [sunday.id]),
        )
        return { anchor, saturday, sunday }
      }

      const committed = async (id) => {
        const { rows } = await db.query(
          `select expected_minutes, assigned_member_id from public.chores where id = $1`,
          [id],
        )
        return rows[0]
      }

      it('neither an estimate edit, a schedule edit nor a switch-off moves an assigned occurrence', async () => {
        const { anchor, saturday } = await committedFixture()

        await setMinutesAsClient(deviceA, anchor.id, 25)
        expect(await committed(saturday.id)).toEqual({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
        })

        await setRepeatAsClient(deviceA, anchor.id, 'weekly', '{1}')
        expect(await committed(saturday.id)).toEqual({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
        })

        await setRepeatAsClient(deviceA, anchor.id, 'none', null)
        expect(await committed(saturday.id)).toEqual({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
        })
      })

      it('AC 4 — deleting the repeat outright applies the recorded choice: occurrences stay, history intact', async () => {
        const { anchor, saturday, sunday } = await committedFixture()

        await asDevice(db, deviceA, () =>
          db.query('delete from public.chores where id = $1', [anchor.id]),
        )

        // Never silently removing: both rows survive, orphaned rather than
        // destroyed — the assigned work is still somebody's, the completed
        // work is still history. Never silently keeping: this test and the
        // remove-confirm's own sentence are where the choice is said.
        const { rows } = await db.query(
          `select id, expected_minutes, assigned_member_id,
                  completed_at is not null as done, generated_from
           from public.chores where id = any($1::uuid[]) order by due_on`,
          [[saturday.id, sunday.id]],
        )
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
          generated_from: null,
        })
        expect(rows[1].done).toBe(true)
        expect(rows[1].generated_from).toBeNull()

        // And the schedule really is over.
        const pass = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(pass.created_count).toBe(0)
      })
    })

    describe('what the grant cannot be used for', () => {
      it('an occurrence cannot be promoted into a repeat through the new grant', async () => {
        const anchor = await trashSinceLastMonday()
        await runAt(deviceA, MONDAY_AFTERNOON)
        const [made] = await occurrenceRows(anchor.id)

        const result = await attempt(() =>
          setRepeatAsClient(deviceA, made.id, 'daily', null),
        )
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/chores_occurrence_does_not_repeat/)
      })

      it('half a schedule is refused by the shape constraint for a caller that skips normalizeRepeat', async () => {
        const anchor = await trashSinceLastMonday()
        const result = await attempt(() =>
          setRepeatAsClient(deviceA, anchor.id, 'weekly', null),
        )
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/chores_repeat_weekdays_shape/)
      })
    })
  })

  // -------------------------------------------------------------------------
  // #105 — skipping a single occurrence
  // -------------------------------------------------------------------------

  describe('#105 — skipping a single occurrence', () => {
    /**
     * The skip through the CLIENT path: `skip_repeat_occurrence` is granted to
     * `authenticated`, so unlike `catch_up_repeats_at` it runs under the role
     * with the caller identity coming from auth.uid() — exactly what PostgREST
     * does with the app's `.rpc()` call.
     */
    const skipAsClient = (uid, choreId, date) =>
      asDevice(db, uid, async () => {
        const { rows } = await db.query(
          'select public.skip_repeat_occurrence($1, $2::date) as removed',
          [choreId, date],
        )
        return rows[0].removed
      })

    /** The exception dates the CLIENT can read back — the granted columns. */
    const skippedDatesAsClient = (uid, choreId) =>
      asDevice(db, uid, async () => {
        const { rows } = await db.query(
          `select to_char(excluded_on, 'YYYY-MM-DD') as excluded_on
           from public.chore_repeat_exceptions where chore_id = $1 order by excluded_on`,
          [choreId],
        )
        return rows.map((r) => r.excluded_on)
      })

    /** The household's chores in the client's column shapes, as the owner. */
    const weekRows = async (householdId) => {
      const { rows } = await db.query(
        `select id, expected_minutes, actual_minutes, assigned_member_id, completed_at
         from public.chores where household_id = $1`,
        [householdId],
      )
      return rows
    }

    const versionOf = async (householdId) => {
      const { rows } = await db.query(
        'select assignments_version from public.households where id = $1',
        [householdId],
      )
      return Number(rows[0].assignments_version)
    }

    describe('AC 2 — an upcoming occurrence is skipped', () => {
      it('stores the exception structurally, and that household-local date generates no instance', async () => {
        const parent = await trashSinceLastMonday()

        const removed = await skipAsClient(deviceA, parent.id, MONDAY)
        expect(removed).toBe(0)
        expect(await skippedDatesAsClient(deviceA, parent.id)).toEqual([MONDAY])

        const pass = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(pass.created_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual([])
      })

      it('an exception for a FUTURE date leaves the assignments version alone — nothing allocatable moved', async () => {
        const parent = await trashSinceLastMonday()
        const before = await versionOf(householdA.id)
        await skipAsClient(deviceA, parent.id, '2026-08-31')
        expect(await versionOf(householdA.id)).toBe(before)
      })
    })

    describe('AC 3 — catch-up runs past a stored exception', () => {
      it('the date stays empty, the neighbours generate, and the double-fire proof still holds', async () => {
        // The #53 AC 3 fixture: a daily repeat switched on the 21st owes the
        // 22nd, 23rd and 24th. Sunday the 23rd is skipped before any of them
        // exist.
        const chore = await addChore(deviceA, householdA.id, {
          title: 'Dishes',
          due: '2026-08-10',
          kind: 'daily',
        })
        await backdate(chore.id, { since: '2026-08-21' })
        await skipAsClient(deviceA, chore.id, '2026-08-23')

        const pass = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(pass.created_count).toBe(2)
        expect(await occurrenceDates(chore.id)).toEqual(['2026-08-22', '2026-08-24'])

        // Run again, then simulate the double-fire exactly as the #53 proof
        // does — watermark wiped, pass re-run. The skipped date must not
        // resurrect under either, and the unique index still owns exactly-once
        // for the dates that DO exist.
        const rerun = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(rerun.created_count).toBe(0)
        await db.query('update public.chores set repeat_caught_up_through = null where id = $1', [
          chore.id,
        ])
        const doubleFire = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(doubleFire.created_count).toBe(0)
        expect(await occurrenceDates(chore.id)).toEqual(['2026-08-22', '2026-08-24'])
      })

      it('a deliberately skipped date is not announced as a missed occurrence', async () => {
        // The #53 AC 4 fixture: five weeks of silence owes 28 skipped
        // announcements. One of the beyond-bound dates was skipped on purpose,
        // so the household is told about 27 — their own choice is not a gap.
        const chore = await addChore(deviceA, householdA.id, {
          title: 'Dishes',
          due: '2026-07-20',
          kind: 'daily',
        })
        await backdate(chore.id, { since: '2026-07-20' })
        await skipAsClient(deviceA, chore.id, '2026-08-10')

        const pass = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(pass.created_count).toBe(7)
        expect(pass.skipped_count).toBe(27)
      })
    })

    describe('AC 1 — the ratified retroactivity rule, both sides of its boundary', () => {
      it('an uncompleted generated instance is removed, and its minutes leave the week', async () => {
        const parent = await trashSinceLastMonday()
        await runAt(deviceA, MONDAY_AFTERNOON)
        const [made] = await occurrenceRows(parent.id)
        await asDevice(db, deviceA, () =>
          db.query('select * from public.assign_chore($1, $2)', [made.id, memberTwoA]),
        )

        // The committed-minutes derivations the app actually renders: the
        // week total (outstandingMinutes) and the member's open load
        // (allocation.assess over toAllocatorChores). Both must move.
        const before = await weekRows(householdA.id)
        const members = [{ id: memberTwoA, capacityMinutes: 300 }]
        const beforeTotal = outstandingMinutes(before)
        const beforeOpen = assess({ members, chores: toAllocatorChores(before) }).load[0].openMinutes
        expect(beforeOpen).toBe(10)
        const versionBefore = await versionOf(householdA.id)

        const removed = await skipAsClient(deviceA, parent.id, MONDAY)
        expect(removed).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual([])

        const after = await weekRows(householdA.id)
        expect(outstandingMinutes(after)).toBe(beforeTotal - 10)
        expect(assess({ members, chores: toAllocatorChores(after) }).load[0].openMinutes).toBe(0)
        // The removal is an allocator-input change, and the chores delete
        // trigger from 0018 says so — no trigger on the exception table needed.
        expect(await versionOf(householdA.id)).toBeGreaterThan(versionBefore)
      })

      it('a completed instance stays as history — the skip removes nothing and the week is unmoved', async () => {
        const parent = await trashSinceLastMonday()
        await runAt(deviceA, MONDAY_AFTERNOON)
        const [made] = await occurrenceRows(parent.id)
        await asDevice(db, deviceA, () =>
          db.query('select * from public.complete_chore($1)', [made.id]),
        )

        const beforeTotal = outstandingMinutes(await weekRows(householdA.id))
        const removed = await skipAsClient(deviceA, parent.id, MONDAY)
        expect(removed).toBe(0)

        const { rows } = await db.query(
          'select completed_at is not null as done from public.chores where id = $1',
          [made.id],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].done).toBe(true)
        expect(outstandingMinutes(await weekRows(householdA.id))).toBe(beforeTotal)
        // The exception is still stored: the date is done AND skipped, which
        // costs nothing and keeps the fact a member stated.
        expect(await skippedDatesAsClient(deviceA, parent.id)).toEqual([MONDAY])
      })
    })

    describe('AC 5 — one date, not a stop', () => {
      it('after the skipped date passes, the next occurrence generates normally', async () => {
        const anchor = await addChore(deviceA, householdA.id, {
          title: 'Dishes',
          due: FRIDAY_BEFORE,
          kind: 'daily',
        })
        await backdate(anchor.id, { since: FRIDAY_BEFORE })
        await skipAsClient(deviceA, anchor.id, '2026-08-23')

        const sunday = await runAt(deviceA, SUNDAY_AFTERNOON)
        expect(sunday.created_count).toBe(1)
        expect(await occurrenceDates(anchor.id)).toEqual(['2026-08-22'])

        const monday = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(monday.created_count).toBe(1)
        expect(await occurrenceDates(anchor.id)).toEqual(['2026-08-22', '2026-08-24'])
      })

      it("#54's stop path is untouched: switching off after a skip still deletes nothing", async () => {
        const anchor = await addChore(deviceA, householdA.id, {
          title: 'Dishes',
          due: FRIDAY_BEFORE,
          kind: 'daily',
        })
        await backdate(anchor.id, { since: FRIDAY_BEFORE })
        await runAt(deviceA, SUNDAY_AFTERNOON)
        await skipAsClient(deviceA, anchor.id, '2026-08-24')

        await asDevice(db, deviceA, () =>
          db.query(
            `update public.chores set repeat_kind = 'none', repeat_weekdays = null where id = $1`,
            [anchor.id],
          ),
        )
        const pass = await runAt(deviceA, MONDAY_AFTERNOON)
        expect(pass.created_count).toBe(0)
        expect(await occurrenceDates(anchor.id)).toEqual(['2026-08-22', '2026-08-23'])
      })
    })

    describe('what may be skipped, and by whom', () => {
      it('skipping the same date twice is the same fact — both calls succeed, one row stands', async () => {
        const parent = await trashSinceLastMonday()
        await skipAsClient(deviceA, parent.id, MONDAY)
        await skipAsClient(deviceA, parent.id, MONDAY)
        expect(await skippedDatesAsClient(deviceA, parent.id)).toEqual([MONDAY])
      })

      it('the constraint itself refuses a duplicate row, by name', async () => {
        const parent = await trashSinceLastMonday()
        await skipAsClient(deviceA, parent.id, MONDAY)
        const dup = await attempt(() =>
          db.query(
            `insert into public.chore_repeat_exceptions (household_id, chore_id, excluded_on)
             values ($1, $2, $3)`,
            [householdA.id, parent.id, MONDAY],
          ),
        )
        expect(dup.ok).toBe(false)
        expect(dup.error).toMatch(/chore_repeat_exceptions_one_per_date/)
      })

      it('the skip is refused unauthenticated', async () => {
        const parent = await trashSinceLastMonday()
        const result = await attempt(() => skipAsClient(null, parent.id, MONDAY))
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/not authenticated/)
      })

      it("a member cannot skip another household's chore", async () => {
        const parent = await trashSinceLastMonday()
        const result = await attempt(() => skipAsClient(deviceB, parent.id, MONDAY))
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/No such chore in this household/)
      })

      it('a chore that does not repeat is refused with a sentence', async () => {
        const plain = await addChore(deviceA, householdA.id, { title: 'Once', due: MONDAY })
        const result = await attempt(() => skipAsClient(deviceA, plain.id, MONDAY))
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/does not repeat/)
      })

      it('a generated occurrence is refused too — its dates are skipped from the anchor', async () => {
        const parent = await trashSinceLastMonday()
        await runAt(deviceA, MONDAY_AFTERNOON)
        const [made] = await occurrenceRows(parent.id)
        const result = await attempt(() => skipAsClient(deviceA, made.id, MONDAY))
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/does not repeat/)
      })
    })

    describe('grants and scope — the single-writer model', () => {
      it('the client holds no write privilege of any kind on the exception table', async () => {
        const parent = await trashSinceLastMonday()
        const writes = [
          [
            'insert',
            `insert into public.chore_repeat_exceptions (household_id, chore_id, excluded_on)
             values ('${householdA.id}', '${parent.id}', '${MONDAY}')`,
          ],
          ['update', `update public.chore_repeat_exceptions set excluded_on = '${MONDAY}'`],
          ['delete', 'delete from public.chore_repeat_exceptions'],
        ]
        for (const [verb, sql] of writes) {
          const result = await attempt(() => asDevice(db, deviceA, () => db.query(sql)))
          expect(result.ok, `${verb} must be refused for the client role`).toBe(false)
          expect(result.error).toMatch(/permission denied/)
        }
      })

      it('the client reads exactly the granted columns — household_id is not one', async () => {
        const parent = await trashSinceLastMonday()
        await skipAsClient(deviceA, parent.id, MONDAY)

        const granted = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query(
              'select id, chore_id, excluded_on, created_at from public.chore_repeat_exceptions',
            ),
          ),
        )
        expect(granted.ok).toBe(true)

        const withheld = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query('select household_id from public.chore_repeat_exceptions'),
          ),
        )
        expect(withheld.ok).toBe(false)
        expect(withheld.error).toMatch(/permission denied/)
      })

      it("row-level security keeps one household's skips off another household's screen", async () => {
        const parent = await trashSinceLastMonday()
        await skipAsClient(deviceA, parent.id, MONDAY)
        expect(await skippedDatesAsClient(deviceA, parent.id)).toEqual([MONDAY])
        expect(await skippedDatesAsClient(deviceB, parent.id)).toEqual([])
      })

      it('anon may not execute the skip — the by-name revoke is load-bearing', async () => {
        const parent = await trashSinceLastMonday()
        await db.exec('set role anon')
        try {
          const result = await attempt(() =>
            db.query('select public.skip_repeat_occurrence($1, $2::date)', [parent.id, MONDAY]),
          )
          expect(result.ok).toBe(false)
          expect(result.error).toMatch(/permission denied/)
        } finally {
          await db.exec('reset role')
        }
      })
    })

    describe('the offer-list mirror', () => {
      it('upcomingOccurrenceDates agrees with the SQL schedule function it mirrors', async () => {
        // The SQL is the authority on what the pass creates; the JS copy only
        // decides what the picker offers. This is the binding that keeps the
        // two from drifting apart silently — same interval convention, same
        // ISO weekdays, same monthly clamp (#103), exercised on a weekly set,
        // a daily run, and a monthly schedule ACROSS the clamp: day 31 over a
        // window containing February, where the two implementations disagree
        // the moment either one drops the short-month rule.
        const until = '2026-09-21' // MONDAY + 28 days
        const { rows: weekly } = await db.query(
          `select to_char(d, 'YYYY-MM-DD') as d
           from public.repeat_occurrence_dates('weekly', '{1,4}'::smallint[], null, $1, $2) as s(d)`,
          [MONDAY, until],
        )
        expect(upcomingOccurrenceDates('weekly', [1, 4], null, MONDAY, 28)).toEqual(
          weekly.map((r) => r.d),
        )

        const { rows: daily } = await db.query(
          `select to_char(d, 'YYYY-MM-DD') as d
           from public.repeat_occurrence_dates('daily', null, null, $1, $2) as s(d)`,
          [MONDAY, until],
        )
        expect(upcomingOccurrenceDates('daily', null, null, MONDAY, 28)).toEqual(
          daily.map((r) => r.d),
        )

        const { rows: monthly } = await db.query(
          `select to_char(d, 'YYYY-MM-DD') as d
           from public.repeat_occurrence_dates('monthly', null::smallint[], 31::smallint, $1, $2) as s(d)`,
          ['2027-01-15', '2027-05-05'],
        )
        expect(monthly.map((r) => r.d)).toEqual([
          '2027-01-31',
          '2027-02-28',
          '2027-03-31',
          '2027-04-30',
        ])
        expect(upcomingOccurrenceDates('monthly', null, 31, '2027-01-15', 110)).toEqual(
          monthly.map((r) => r.d),
        )
      })
    })
  })

  // -------------------------------------------------------------------------
  // #103 — a chore that repeats monthly on a chosen day of the month
  // -------------------------------------------------------------------------

  describe('#103 — a monthly repeat', () => {
    /**
     * The client's schedule edit for a monthly repeat, as PostgREST issues it:
     * `normalizeRepeat` always produces all three columns, because the shape
     * constraints tie them.
     */
    const setScheduleAsClient = (uid, choreId, kind, weekdays = null, monthday = null) =>
      asDevice(db, uid, () =>
        db.query(
          `update public.chores
             set repeat_kind = $2, repeat_weekdays = $3::smallint[], repeat_monthday = $4::smallint
           where id = $1`,
          [choreId, kind, weekdays, monthday],
        ),
      )

    /** A day-31 monthly rent chore anchored on 2027-01-31, through the client path. */
    const rentOnThe31st = async (due = '2027-01-31') => {
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Rent',
        minutes: 10,
        due,
        kind: 'monthly',
        monthday: 31,
      })
      await backdate(chore.id, { since: due })
      return chore
    }

    describe('AC 1 — the clamp: a short month fires on its last day, never skips', () => {
      it('day 31 lands on February 28 in a non-leap year', async () => {
        // (Jan 31, Feb 28] contains exactly one matching date under the
        // ratified rule — min(31, 28) = 28 — and NONE under the rejected
        // skip-the-month alternative, which is what makes this fixture the
        // discriminating one: the mutation to `monthday` alone reddens it by
        // name.
        const parent = await rentOnThe31st()
        const pass = await runAt(deviceA, '2027-02-28 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(pass.skipped_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-02-28'])
      })

      // RENAMED after #103's review, and the rename is the finding: this test
      // was called "the clamp reads the actual month" and carries no unique
      // discriminating power for the clamp. Its whole reachable window is
      // (2028-01-29, 2028-02-29], and every month in it has a last day >= 29,
      // so `least(29, last_day)` is a no-op on every date the function is
      // asked about — mutate the clamp down to a bare `monthday` and this stays
      // green. It is kept rather than replaced because it is the only pglite
      // assertion that a February 29 occurrence is created at all; what changed
      // is that its name now claims only what it proves, and the arm below
      // carries the claim the old name made.
      it('a day-29 monthly fires on February 29 when the month has one', async () => {
        const parent = await addChore(deviceA, householdA.id, {
          title: 'Rent',
          due: '2028-01-29',
          kind: 'monthly',
          monthday: 29,
        })
        await backdate(parent.id, { since: '2028-01-29' })
        const pass = await runAt(deviceA, '2028-02-29 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual(['2028-02-29'])
      })

      it('day 29 clamps to February 28 in a NON-leap year — the arm that isolates the clamp', async () => {
        // The discriminating twin of the test above, one day over the edge
        // rather than three: 2027 is not a leap year, so `least(29, 28)` is the
        // only thing that puts an occurrence in February at all. With the clamp
        // mutated to a bare `monthday` this creates nothing, where its leap-year
        // sibling goes on passing.
        const parent = await addChore(deviceA, householdA.id, {
          title: 'Rent',
          due: '2027-01-29',
          kind: 'monthly',
          monthday: 29,
        })
        await backdate(parent.id, { since: '2027-01-29' })
        const pass = await runAt(deviceA, '2027-02-28 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-02-28'])
      })

      it('day 31 lands on the 30th of a 30-day month', async () => {
        const parent = await rentOnThe31st('2027-03-31')
        const pass = await runAt(deviceA, '2027-04-30 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-04-30'])
      })

      it('after a clamped February the schedule fires on the true 31st again — the clamp does not stick', async () => {
        const parent = await rentOnThe31st()
        await runAt(deviceA, '2027-02-28 19:00:00+00')
        const march = await runAt(deviceA, '2027-03-31 19:00:00+00')
        expect(march.created_count).toBe(1)
        expect(march.skipped_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-02-28', '2027-03-31'])
      })
    })

    describe('AC 3 — a month boundary across a DST change lands on the household-local date', () => {
      // US DST ends 02:00 on Sunday 2026-11-01 — the month boundary IS the
      // DST day. 23:30 Saturday the 31st in America/New_York (EDT, UTC-4) is
      // already 03:30Z on November 1st; the occurrence must wait for the
      // household's own midnight, and 07:00Z is 02:00 EST — Sunday the 1st by
      // any reading of the repeated hour.
      it('at 23:30 Oct 31 household time, November has not arrived — after local midnight it has', async () => {
        const parent = await addChore(deviceA, householdA.id, {
          title: 'Rent',
          due: '2026-10-01',
          kind: 'monthly',
          monthday: 1,
        })
        await backdate(parent.id, { since: '2026-10-01' })

        const lateSaturday = await runAt(deviceA, '2026-11-01 03:30:00+00')
        expect(lateSaturday.created_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual([])

        const sunday = await runAt(deviceA, '2026-11-01 07:00:00+00')
        expect(sunday.created_count).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual(['2026-11-01'])
      })
    })

    describe('AC 4 — the catch-up bound and the double-fire proof, unchanged for monthly', () => {
      it("a month-old occurrence IS caught up — monthly's bound is one interval, not seven days", async () => {
        // THE ESCALATION'S OWN SCENARIO, and this test asserted the opposite
        // until 2026-08-31. Nobody opens the app between January and mid-March.
        // Under the flat seven-day bound February's clamped occurrence (the
        // 28th) was 15 days old, so the pass counted it skipped and created
        // NOTHING — a rent chore vanishing for a month, in silence, with the
        // household reading a notice worded for a week. The owner made the
        // bound kind-dependent at #103's commit gate; one month is the window
        // for monthly, so the occurrence is created.
        const parent = await rentOnThe31st()
        const pass = await runAt(deviceA, '2027-03-15 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(pass.skipped_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-02-28'])
      })

      it('an occurrence older than a WHOLE month is still skipped and said', async () => {
        // The bound did not go away, it changed units — so the far side of it
        // still behaves as #53 AC 4 requires. Nobody opens the app from January
        // to mid-April: March's occurrence is inside the one-month window and
        // is created, February's is outside it and is counted rather than
        // piled on.
        const parent = await rentOnThe31st()
        const pass = await runAt(deviceA, '2027-04-15 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(pass.skipped_count).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-03-31'])
      })

      it('a simulated double-fire creates nothing — the INDEX holds, exactly as #53 proved', async () => {
        const parent = await rentOnThe31st()
        await runAt(deviceA, '2027-02-28 19:00:00+00')
        await db.query('update public.chores set repeat_caught_up_through = null where id = $1', [
          parent.id,
        ])
        const rerun = await runAt(deviceA, '2027-02-28 19:00:00+00')
        expect(rerun.created_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-02-28'])
      })

      it('the index itself refuses a duplicate monthly occurrence, by name', async () => {
        const parent = await rentOnThe31st()
        await runAt(deviceA, '2027-02-28 19:00:00+00')
        const dup = await attempt(() =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, generated_from)
             values ($1, 'Rent', 10, '2027-02-28', $2)`,
            [householdA.id, parent.id],
          ),
        )
        expect(dup.ok).toBe(false)
        expect(dup.error).toMatch(/chores_one_occurrence_per_date/)
      })

      it("#105's exception mechanism reaches a monthly date with no special case", async () => {
        const parent = await rentOnThe31st()
        await asDevice(db, deviceA, () =>
          db.query('select public.skip_repeat_occurrence($1, $2::date)', [
            parent.id,
            '2027-02-28',
          ]),
        )
        const pass = await runAt(deviceA, '2027-02-28 19:00:00+00')
        expect(pass.created_count).toBe(0)
        expect(await occurrenceDates(parent.id)).toEqual([])
      })
    })

    describe("AC 5 — a monthly occurrence's minutes are in the committed derivation", () => {
      it('the generated instance is ordinary work: assignable, and its minutes count', async () => {
        const parent = await rentOnThe31st()
        await runAt(deviceA, '2027-02-28 19:00:00+00')
        const [made] = await occurrenceRows(parent.id)
        expect(made.expected_minutes).toBe(10)

        await asDevice(db, deviceA, () =>
          db.query('select * from public.assign_chore($1, $2)', [made.id, memberTwoA]),
        )

        // The derivations the app actually renders — the same instruments the
        // #105 AC 1 test reads: the household's outstanding total and the
        // member's open load through allocation.assess.
        const { rows } = await db.query(
          `select id, expected_minutes, actual_minutes, assigned_member_id, completed_at
           from public.chores where household_id = $1`,
          [householdA.id],
        )
        const members = [{ id: memberTwoA, capacityMinutes: 300 }]
        expect(outstandingMinutes(rows)).toBeGreaterThanOrEqual(10)
        expect(assess({ members, chores: toAllocatorChores(rows) }).load[0].openMinutes).toBe(10)
      })
    })

    describe('AC 6 — #54 holds for monthly: committed load does not move', () => {
      /** February's occurrence generated and assigned — committed work. */
      const committedMonthlyFixture = async () => {
        const parent = await rentOnThe31st()
        await runAt(deviceA, '2027-02-28 19:00:00+00')
        const [february] = await occurrenceRows(parent.id)
        await asDevice(db, deviceA, () =>
          db.query('select * from public.assign_chore($1, $2)', [february.id, memberTwoA]),
        )
        return { parent, february }
      }

      const committed = async (id) => {
        const { rows } = await db.query(
          `select expected_minutes, assigned_member_id from public.chores where id = $1`,
          [id],
        )
        return rows[0]
      }

      it('neither an estimate edit, a monthday edit nor a switch-off moves the assigned occurrence', async () => {
        const { parent, february } = await committedMonthlyFixture()

        await asDevice(db, deviceA, () =>
          db.query(`update public.chores set expected_minutes = 25 where id = $1`, [parent.id]),
        )
        expect(await committed(february.id)).toEqual({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
        })

        await setScheduleAsClient(deviceA, parent.id, 'monthly', null, 15)
        expect(await committed(february.id)).toEqual({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
        })

        await setScheduleAsClient(deviceA, parent.id, 'none', null, null)
        expect(await committed(february.id)).toEqual({
          expected_minutes: 10,
          assigned_member_id: memberTwoA,
        })

        // And the schedule really is off: nothing further generates.
        //
        // This assertion was VACUOUS until #103's review and the bound change
        // that followed it. Under the old flat seven-day bound the counter-
        // factual — delete the switch-off above, leaving a monthly-on-the-15th
        // schedule — produced created_count 0 as well, because 2027-03-15 sat
        // outside a window opening 2027-03-25: the catch-up bound was doing the
        // work the switch-off was being credited for. With the monthly bound at
        // one month the window opens 2027-03-01, so the counterfactual creates
        // 2027-03-15 and this line discriminates. Proven by mutation, not by
        // this paragraph.
        const pass = await runAt(deviceA, '2027-03-31 19:00:00+00')
        expect(pass.created_count).toBe(0)
      })

      it('a monthday edit reaches only what the pass creates AFTER it', async () => {
        const { parent } = await committedMonthlyFixture()

        // 31st → 15th. February's clamped occurrence already on the list is
        // not this edit's to move; March generates on the new day.
        await setScheduleAsClient(deviceA, parent.id, 'monthly', null, 15)

        const pass = await runAt(deviceA, '2027-03-15 19:00:00+00')
        expect(pass.created_count).toBe(1)
        expect(await occurrenceDates(parent.id)).toEqual(['2027-02-28', '2027-03-15'])
      })

      it('the client may edit the monthday, and still cannot touch the bookkeeping columns', async () => {
        // 0026 widens the editable schedule set the way 0024 did for the pair;
        // the boundary inside the row is unchanged, and the #54 test above
        // already re-proves it — this pins the monthly spelling of the edit.
        const parent = await rentOnThe31st()
        const edited = await attempt(() => setScheduleAsClient(deviceA, parent.id, 'monthly', null, 12))
        expect(edited.ok).toBe(true)

        const forged = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query(`update public.chores set repeat_caught_up_through = '2027-02-01' where id = $1`, [
              parent.id,
            ]),
          ),
        )
        expect(forged.ok).toBe(false)
        expect(forged.error).toMatch(/permission denied/)
      })
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability — a re-paste is the normal path
  // -------------------------------------------------------------------------

  describe('re-runnability', () => {
    it('re-pasting 0012 onto a database that already has it is a no-op', async () => {
      const through = await databaseThrough('0012_repeating_chores.sql')
      await through.exec(migrationSql('0012_repeating_chores.sql'))
      const { rows } = await through.query(
        `select count(*)::int as n from pg_constraint where conname = 'chores_repeat_kind_known'`,
      )
      expect(rows[0].n).toBe(1)
    })

    it('re-pasting 0025 onto a database that already has it is a no-op', async () => {
      const through = await databaseThrough('0025_skip_a_single_occurrence.sql')
      await through.exec(migrationSql('0025_skip_a_single_occurrence.sql'))
      const { rows } = await through.query(
        `select count(*)::int as n from pg_constraint
          where conname = 'chore_repeat_exceptions_one_per_date'`,
      )
      expect(rows[0].n).toBe(1)
    })

    it('re-pasting 0024 is a no-op — a grant is idempotent, and the UPDATE set is exactly what it says', async () => {
      // Through 0024, deliberately: this asserts what THAT file's paste leaves
      // behind, so 0026's later widening does not belong in this list — the
      // full-schema set is asserted in the 0026 test below.
      const through = await databaseThrough('0024_edit_or_stop_a_repeat.sql')
      await through.exec(migrationSql('0024_edit_or_stop_a_repeat.sql'))
      const { rows } = await through.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual([
        'actual_minutes',
        'due_on',
        'expected_minutes',
        'repeat_kind',
        'repeat_weekdays',
        'title',
      ])
    })

    it('re-pasting 0026 is a no-op: one constraint set, one schedule function, the exact UPDATE set — #103', async () => {
      const through = await databaseThrough('0026_repeat_monthly.sql')
      await through.exec(migrationSql('0026_repeat_monthly.sql'))

      // The drop-and-recreate leaves exactly one of each constraint standing,
      // and the widened kind list really is the widened one.
      const { rows: constraints } = await through.query(
        `select conname, count(*)::int as n from pg_constraint
          where conname in ('chores_repeat_kind_known', 'chores_repeat_monthday_shape')
          group by conname order by conname`,
      )
      expect(constraints).toEqual([
        { conname: 'chores_repeat_kind_known', n: 1 },
        { conname: 'chores_repeat_monthday_shape', n: 1 },
      ])

      // The four-parameter schedule function is GONE and the five-parameter one
      // stands alone — a `create or replace` with a changed signature adds an
      // overload rather than replacing, which is exactly what the drop in 0026
      // exists to prevent, so the count is the assertion.
      const { rows: fns } = await through.query(
        `select count(*)::int as n, min(pronargs)::int as args from pg_proc
          where proname = 'repeat_occurrence_dates'`,
      )
      expect(fns).toEqual([{ n: 1, args: 5 }])

      const { rows: updatable } = await through.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(updatable.map((r) => r.column_name)).toEqual([
        'actual_minutes',
        'due_on',
        'expected_minutes',
        'repeat_kind',
        'repeat_monthday',
        'repeat_weekdays',
        'title',
      ])
    })
  })
})
