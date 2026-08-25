import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATCH_UP_BOUND_DAYS,
  CHORE_COLUMNS,
  commitmentByMember,
  committedMinutes,
  describeRepeat,
  formatSkippedNotice,
  isOutstanding,
  outstandingMinutes,
  MAX_EXPECTED_MINUTES,
  MIN_EXPECTED_MINUTES,
  normalizeDueDate,
  normalizeExpectedMinutes,
  normalizeRepeat,
  normalizeTitle,
} from './chores.js'

// #34 — the validators the form and the data layer share.
//
// These are not the security boundary and none of them can be: the rules that
// hold are the check constraints and column grants in 0003, exercised in
// src/test/chores.pglite.test.js against a real Postgres. What is tested here is
// that a person gets a sentence instead of a constraint violation, and that the
// bounds this file states match the ones the database enforces.

describe('expected minutes — the unit the fairness split divides', () => {
  it('accepts a whole number inside the bounds', () => {
    expect(normalizeExpectedMinutes(20)).toBe(20)
    expect(normalizeExpectedMinutes('45')).toBe(45)
  })

  it('accepts both ends, matching the check constraint exactly', () => {
    expect(normalizeExpectedMinutes(MIN_EXPECTED_MINUTES)).toBe(1)
    expect(normalizeExpectedMinutes(MAX_EXPECTED_MINUTES)).toBe(1440)
  })

  it('states the bounds 0003 actually enforces, read out of the migration itself', () => {
    // This test previously asserted `MIN).toBe(1)` and `MAX).toBe(1440)` and
    // carried a comment claiming it would catch the constants drifting from the
    // constraint. It could not: it never opened the SQL, and it was fully
    // subsumed by the test three lines above — every mutation that reddened it
    // reddened that one too, so it carried no independent signal. Reading the
    // migration is what the name always promised. Same idiom as
    // src/test/gate.test.js, which readFileSyncs vite.config.js and App.jsx.
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0003_chores.sql'), 'utf8')
    expect(sql).toMatch(
      new RegExp(`between\\s+${MIN_EXPECTED_MINUTES}\\s+and\\s+${MAX_EXPECTED_MINUTES}`),
    )
  })

  for (const [label, value] of [
    ['blank', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
  ]) {
    it(`refuses ${label} by asking the question rather than reporting a type error`, () => {
      expect(() => normalizeExpectedMinutes(value)).toThrow(/how many minutes/i)
    })
  }

  it('refuses zero rather than rounding it up to one', () => {
    // A chore costing no time cannot be allocated against a budget of minutes.
    // Clamping it to 1 would put a meaningless row into the calculation the
    // fairness claim rests on.
    expect(() => normalizeExpectedMinutes(0)).toThrow(/at least a minute/i)
  })

  it('refuses a negative', () => {
    expect(() => normalizeExpectedMinutes(-30)).toThrow(/at least a minute/i)
  })

  it('refuses a fraction, because the column is an integer', () => {
    expect(() => normalizeExpectedMinutes(20.5)).toThrow(/whole number/i)
  })

  it('refuses more than a day of work, and says what to do instead', () => {
    expect(() => normalizeExpectedMinutes(1441)).toThrow(/split it into smaller chores/i)
  })

  it('refuses text that is not a number at all', () => {
    expect(() => normalizeExpectedMinutes('a while')).toThrow(/must be a number/i)
  })
})

describe('the due date is a calendar date, all the way down', () => {
  it('passes a well-formed date through unchanged', () => {
    expect(normalizeDueDate('2026-08-10')).toBe('2026-08-10')
  })

  it('does NOT shift the day for anyone west of UTC', () => {
    // The bug this guards: parsing '2026-08-10' with `new Date()` gives UTC
    // midnight, and formatting it back with local getters returns the 9th for
    // every timezone behind UTC. A chore due Monday would be stored as Sunday
    // for half the world. Asserting identity is what proves no Date round-trip
    // was introduced.
    for (const date of ['2026-01-01', '2026-08-10', '2026-12-31']) {
      expect(normalizeDueDate(date)).toBe(date)
    }
  })

  it('asks for a date when one is missing', () => {
    expect(() => normalizeDueDate('')).toThrow(/when is this chore due/i)
    expect(() => normalizeDueDate(null)).toThrow(/when is this chore due/i)
  })

  it('refuses a shape the date column would not take', () => {
    expect(() => normalizeDueDate('Monday')).toThrow(/look like/i)
    expect(() => normalizeDueDate('10/08/2026')).toThrow(/look like/i)
    expect(() => normalizeDueDate('2026-8-10')).toThrow(/look like/i)
  })

  it('refuses a date that is well-shaped and not real', () => {
    // The regex is happy with all of these; only the round-trip catches them.
    expect(() => normalizeDueDate('2026-02-31')).toThrow(/not a real date/i)
    expect(() => normalizeDueDate('2026-13-01')).toThrow(/not a real month/i)
    expect(() => normalizeDueDate('2026-04-31')).toThrow(/not a real date/i)
  })

  it('accepts a real leap day and refuses one that is not', () => {
    expect(normalizeDueDate('2028-02-29')).toBe('2028-02-29')
    expect(() => normalizeDueDate('2026-02-29')).toThrow(/not a real date/i)
  })
})

describe('the title', () => {
  it('trims, because a trailing space is not part of a chore name', () => {
    expect(normalizeTitle('  Dishes  ')).toBe('Dishes')
  })

  it('refuses an empty or whitespace-only name', () => {
    expect(() => normalizeTitle('')).toThrow(/needs a name/i)
    expect(() => normalizeTitle('   ')).toThrow(/needs a name/i)
  })

  it('refuses a name longer than the column takes', () => {
    expect(normalizeTitle('x'.repeat(80))).toHaveLength(80)
    expect(() => normalizeTitle('x'.repeat(81))).toThrow(/too long/i)
  })
})

describe('the readable column list', () => {
  it('matches the select grant exactly, so select(*) is never needed', () => {
    // A column grant makes `select('*')` fail outright rather than quietly
    // returning a narrower row, so this list is load-bearing rather than tidy.
    // 0004 added the two completion columns as readable, 0006 added
    // assigned_member_id, and 0012 the three repeat columns a screen renders;
    // if this list and the grant ever disagree, every read fails with a
    // permission error.
    expect(CHORE_COLUMNS.split(',').map((c) => c.trim()).sort()).toEqual([
      'assigned_member_id',
      'completed_at',
      'completed_by_member_id',
      'created_at',
      'due_on',
      'expected_minutes',
      'generated_from',
      'id',
      'repeat_kind',
      'repeat_weekdays',
      'title',
    ])
  })

  it('does not ask for household_id, which 0003 withholds', () => {
    // Asking for it would make every read fail with a permission error. The
    // column is written on insert and never read back — see 0003.
    expect(CHORE_COLUMNS).not.toContain('household_id')
  })

  it('does not contain a wildcard', () => {
    expect(CHORE_COLUMNS).not.toContain('*')
  })
})

describe('outstanding — #35 AC 5', () => {
  const out = (id, minutes) => ({ id, expected_minutes: minutes, completed_at: null })
  const done = (id, minutes) => ({ id, expected_minutes: minutes, completed_at: '2026-08-08T10:00:00Z' })

  it('counts only work that is not finished', () => {
    // The two totals DIFFER on this fixture — 30 outstanding against 130 for
    // every row — so a sum over all rows fails. That difference is the test.
    const chores = [out('a', 20), done('b', 100), out('c', 10)]
    expect(outstandingMinutes(chores)).toBe(30)
    expect(outstandingMinutes(chores)).not.toBe(130)
  })

  it('is zero when everything is done, rather than the all-rows total', () => {
    expect(outstandingMinutes([done('a', 20), done('b', 100)])).toBe(0)
  })

  it('is zero for an empty household', () => {
    expect(outstandingMinutes([])).toBe(0)
  })

  it('treats a missing completed_at as outstanding, not as a crash', () => {
    // A row read before 0004 shipped, or a fixture that omits the column.
    expect(isOutstanding({ id: 'a' })).toBe(true)
    expect(isOutstanding({ id: 'a', completed_at: null })).toBe(true)
    expect(isOutstanding({ id: 'a', completed_at: '2026-08-08T10:00:00Z' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// #36 — the derivation. What each person is carrying, computed at read time.
//
// Nothing here touches a database or a client. The access rules that make the
// underlying column trustworthy are in src/test/assignment.pglite.test.js; what
// is tested here is the arithmetic and, more importantly, the two shapes it
// would be natural to get wrong: counting finished work, and clamping an
// over-commitment to zero.
// ---------------------------------------------------------------------------

describe('committedMinutes — #36 AC 5, 8', () => {
  const held = (id, minutes, member) => ({
    id,
    expected_minutes: minutes,
    completed_at: null,
    assigned_member_id: member,
  })
  const finished = (id, minutes, member) => ({
    id,
    expected_minutes: minutes,
    completed_at: '2026-08-08T10:00:00Z',
    assigned_member_id: member,
  })

  it("sums the expected minutes of that person's OUTSTANDING chores only", () => {
    // AC 8 exactly: differing minutes and some completions, in one fixture, so
    // a sum over every row and a sum over the right rows give different answers.
    const chores = [held('a', 20, 'm1'), finished('b', 100, 'm1'), held('c', 15, 'm1')]
    expect(committedMinutes(chores, 'm1')).toBe(35)
    expect(committedMinutes(chores, 'm1')).not.toBe(135)
  })

  it('counts nothing belonging to somebody else', () => {
    const chores = [held('a', 20, 'm1'), held('b', 45, 'm2')]
    expect(committedMinutes(chores, 'm1')).toBe(20)
    expect(committedMinutes(chores, 'm2')).toBe(45)
  })

  it("counts nothing that is unassigned — a chore nobody holds is nobody's load", () => {
    const chores = [held('a', 20, null), held('b', 30, 'm1')]
    expect(committedMinutes(chores, 'm1')).toBe(30)
    // And the reverse: asking for the null "member" must not scoop up the
    // unassigned pile, which a bare equality would do.
    expect(committedMinutes(chores, null)).toBe(0)
  })

  it('is zero for a person holding nothing, rather than undefined or NaN', () => {
    expect(committedMinutes([held('a', 20, 'm1')], 'm2')).toBe(0)
    expect(committedMinutes([], 'm1')).toBe(0)
  })
})

describe('commitmentByMember — #36 AC 5, 6, 9', () => {
  const members = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120 },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
  ]
  const capacities = [
    { id: 'm1', capacityMinutes: 120 },
    { id: 'm2', capacityMinutes: 60 },
  ]
  const held = (id, minutes, member) => ({
    id,
    expected_minutes: minutes,
    completed_at: null,
    assigned_member_id: member,
  })

  it('reports committed and remaining for each person', () => {
    const rows = commitmentByMember(members, [held('a', 45, 'm1')], capacities)
    expect(rows[0]).toMatchObject({ committedMinutes: 45, remainingMinutes: 75 })
    expect(rows[1]).toMatchObject({ committedMinutes: 0, remainingMinutes: 60 })
  })

  it('AC 6: reports an over-commitment in minutes rather than clamping at zero', () => {
    // The kid with 60 minutes holding 100. A clamp would print "0 min left" and
    // the household would read the fairness claim as satisfied at the exact
    // moment it is failing — which is the one thing this screen exists to show.
    const rows = commitmentByMember(members, [held('a', 100, 'm2')], capacities)
    expect(rows[1].remainingMinutes).toBe(-40)
    expect(rows[1].remainingMinutes).not.toBe(0)
  })

  it('AC 6: a person with no chores is present with committed 0, not absent', () => {
    const rows = commitmentByMember(members, [], capacities)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.committedMinutes)).toEqual([0, 0])
  })

  it('AC 9: comes back in ROSTER order, whatever the load — any other order is a ranking', () => {
    // m2 carries far more than m1. A sort-by-load would put Placeholder Two
    // first, and a leaderboard would have reached the screen through a function
    // whose name says nothing about order.
    const rows = commitmentByMember(members, [held('a', 5, 'm1'), held('b', 55, 'm2')], capacities)
    expect(rows.map((r) => r.member.id)).toEqual(['m1', 'm2'])

    const reversed = commitmentByMember([members[1], members[0]], [], capacities)
    expect(reversed.map((r) => r.member.id)).toEqual(['m2', 'm1'])
  })

  it('takes capacity as an ARGUMENT, so an override changes the answer without touching this module', () => {
    // #44 AC 7's rule, made observable: the same members and the same chores,
    // with a capacity that is not the baseline, must produce a different
    // remainder. If this module read members.weekly_minutes it could not.
    const thisWeek = [
      { id: 'm1', capacityMinutes: 30 },
      { id: 'm2', capacityMinutes: 60 },
    ]
    const rows = commitmentByMember(members, [held('a', 45, 'm1')], thisWeek)
    expect(rows[0].capacityMinutes).toBe(30)
    expect(rows[0].remainingMinutes).toBe(-15)
  })

  it('treats a member missing from the capacity list as zero rather than crashing a render', () => {
    const rows = commitmentByMember(members, [held('a', 10, 'm1')], [{ id: 'm1', capacityMinutes: 120 }])
    expect(rows[1]).toMatchObject({ capacityMinutes: 0, committedMinutes: 0, remainingMinutes: 0 })
  })
})

describe('#53 — a schedule the columns will accept', () => {
  it('accepts the three kinds, defaulting an unstated one to none', () => {
    expect(normalizeRepeat({})).toEqual({ repeat_kind: 'none', repeat_weekdays: null })
    expect(normalizeRepeat(undefined)).toEqual({ repeat_kind: 'none', repeat_weekdays: null })
    expect(normalizeRepeat({ repeatKind: 'daily' })).toEqual({
      repeat_kind: 'daily',
      repeat_weekdays: null,
    })
    expect(normalizeRepeat({ repeatKind: 'weekly', repeatWeekdays: [3] })).toEqual({
      repeat_kind: 'weekly',
      repeat_weekdays: [3],
    })
  })

  it('refuses anything outside the structured kinds — AC 6, worded for a person', () => {
    for (const repeatKind of ['monthly', 'every other thursday', 'WEEKLY', 42]) {
      expect(() => normalizeRepeat({ repeatKind })).toThrow(/daily or weekly/i)
    }
  })

  it('requires at least one weekday for weekly, and refuses days elsewhere', () => {
    expect(() => normalizeRepeat({ repeatKind: 'weekly' })).toThrow(/at least one weekday/i)
    expect(() => normalizeRepeat({ repeatKind: 'weekly', repeatWeekdays: [] })).toThrow(
      /at least one weekday/i,
    )
    expect(() => normalizeRepeat({ repeatKind: 'daily', repeatWeekdays: [1] })).toThrow(
      /only make sense on a weekly repeat/i,
    )
    expect(() => normalizeRepeat({ repeatKind: 'none', repeatWeekdays: [1] })).toThrow(
      /only make sense on a weekly repeat/i,
    )
  })

  it('holds weekdays to ISO 1..7', () => {
    for (const day of [0, 8, 1.5, 'Tuesday', NaN]) {
      expect(() => normalizeRepeat({ repeatKind: 'weekly', repeatWeekdays: [day] })).toThrow(
        /1 \(Monday\) through 7 \(Sunday\)/,
      )
    }
  })

  it('sorts and deduplicates the days, so what renders back is what was meant', () => {
    expect(normalizeRepeat({ repeatKind: 'weekly', repeatWeekdays: [5, 1, 5, 3] })).toEqual({
      repeat_kind: 'weekly',
      repeat_weekdays: [1, 3, 5],
    })
  })
})

describe("#53 — the row's account of its schedule", () => {
  it('says nothing for a chore that does not repeat, whatever shape it arrives in', () => {
    expect(describeRepeat({ repeat_kind: 'none' })).toBeNull()
    // Rows read before 0012 is pasted carry no repeat columns at all; the
    // screen must not invent a schedule for them.
    expect(describeRepeat({})).toBeNull()
    expect(describeRepeat(null)).toBeNull()
  })

  it('names the days for weekly and the cadence for daily', () => {
    expect(describeRepeat({ repeat_kind: 'daily' })).toBe('repeats daily')
    expect(describeRepeat({ repeat_kind: 'weekly', repeat_weekdays: [1, 4] })).toBe(
      'repeats weekly on Mon, Thu',
    )
    expect(describeRepeat({ repeat_kind: 'weekly', repeat_weekdays: [7] })).toBe(
      'repeats weekly on Sun',
    )
  })
})

describe('#53 AC 4 — the skipped-occurrences sentence', () => {
  it('is null when nothing was skipped, so no surface renders an empty notice', () => {
    expect(formatSkippedNotice(0)).toBeNull()
    expect(formatSkippedNotice(undefined)).toBeNull()
    expect(formatSkippedNotice(-1)).toBeNull()
  })

  it('names the count and the bound, in days a person can check', () => {
    expect(formatSkippedNotice(1)).toBe(
      `1 repeat occurrence more than ${CATCH_UP_BOUND_DAYS} days old was skipped rather than piled onto this week.`,
    )
    expect(formatSkippedNotice(3)).toBe(
      `3 repeat occurrences more than ${CATCH_UP_BOUND_DAYS} days old were skipped rather than piled onto this week.`,
    )
  })

  it('the bound the sentence names is the owner-decided seven days', () => {
    // The migration's copy is the authority; repeats.pglite.test.js holds the
    // two equal. This pins the JS copy to the DECISION, so a drive-by edit
    // here reddens something even with the pglite suite filtered out.
    expect(CATCH_UP_BOUND_DAYS).toBe(7)
  })
})
