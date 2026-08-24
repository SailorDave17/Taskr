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
import { CATCH_UP_BOUND_DAYS } from '../lib/chores.js'

// 2026-08-24 is a Monday; every date below is derived from that anchor, and
// getting one wrong fails loudly because the assertions name exact dates.
const MONDAY = '2026-08-24'
const MONDAY_BEFORE = '2026-08-17'
// 15:00 EDT on Monday the 24th — mid-afternoon, nowhere near a date boundary
// in any zone a fixture uses.
const MONDAY_AFTERNOON = '2026-08-24 19:00:00+00'

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

describe('a chore that repeats, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, householdB, memberTwoA

  /**
   * Insert through the CLIENT path — grants and trigger included. RETURNING
   * only granted columns: `repeat_since` is deliberately unreadable by a
   * client (RETURNING needs select privilege), which is itself asserted below.
   */
  const addChore = (uid, household, { title, minutes = 10, due, kind = 'none', weekdays = null }) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query(
        `insert into public.chores
           (household_id, title, expected_minutes, due_on, repeat_kind, repeat_weekdays)
         values ($1, $2, $3, $4, $5, $6::smallint[])
         returning id, repeat_kind`,
        [household, title, minutes, due, kind, weekdays],
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

    it('monthly is refused — #103 is a named follow-up, not a silent inclusion', async () => {
      const result = await attempt(() =>
        addChore(deviceA, householdA.id, { title: 'Rent', due: MONDAY, kind: 'monthly' }),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/chores_repeat_kind_known/)
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

    it('the bound is ONE constant: the migration and the UI copy agree', async () => {
      // The value lives in catch_up_repeats_at; src/lib/chores.js carries the
      // copy the notice sentence renders. Two copies of one number is exactly
      // the drift ci-shaped checks exist for, so the suite holds them equal.
      const source = migrationSql('0012_repeating_chores.sql')
      const declared = source.match(/catch_up_bound_days constant integer := (\d+);/)
      // Positive control first: if the regex stops matching, that is a finding,
      // not a pass — an absent match must never read as agreement.
      expect(declared).not.toBeNull()
      expect(Number(declared[1])).toBe(CATCH_UP_BOUND_DAYS)
      expect(CATCH_UP_BOUND_DAYS).toBe(7)
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

    it('a client cannot UPDATE the repeat columns — editing a repeat is #54', async () => {
      const chore = await addChore(deviceA, householdA.id, {
        title: 'Trash',
        due: MONDAY,
        kind: 'weekly',
        weekdays: '{1}',
      })
      const result = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(`update public.chores set repeat_kind = 'none' where id = $1`, [chore.id]),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied/)
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
  })
})
