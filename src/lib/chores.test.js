import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATCH_UP_BOUND_DAYS,
  CHORE_COLUMNS,
  ESTIMATE_DEVIATION_THRESHOLD,
  MIN_COMPLETIONS_FOR_ESTIMATE_UPDATE,
  actualsSummary,
  completedInstances,
  describeRepeat,
  estimateSuggestion,
  formatSkippedNotice,
  isOutstanding,
  outstandingMinutes,
  MAX_EXPECTED_MINUTES,
  MIN_EXPECTED_MINUTES,
  normalizeActualMinutes,
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
    // assigned_member_id, 0012 the three repeat columns a screen renders,
    // 0015 the actual (#12), and 0018 assigned_source (#49); if this list and
    // the grant ever disagree, every read fails with a permission error.
    expect(CHORE_COLUMNS.split(',').map((c) => c.trim()).sort()).toEqual([
      'actual_minutes',
      'assigned_member_id',
      'assigned_source',
      'completed_at',
      'completed_by_member_id',
      'created_at',
      'due_on',
      'expected_minutes',
      'generated_from',
      'household_id',
      'id',
      'repeat_kind',
      'repeat_weekdays',
      'title',
    ])
  })

  // #159 — rewritten, not deleted, and the subject is reversed on purpose.
  // 0003 withheld `household_id` and this asserted the client never asked for
  // it; 0014 grants it, because a client that cannot NAME a household cannot
  // filter by one and #157 measured that no mechanism reaches around that.
  //
  // The property that survives, and the one that made the original worth having:
  // `select('*')` STILL FAILS on this table. 0012 withholds `repeat_since` and
  // `repeat_caught_up_through`, so the wildcard refusal is untouched here — which
  // is exactly why #157 priced 0014 as free on `chores` and costly on `members`.
  it('asks for household_id, and still cannot use a wildcard', () => {
    expect(CHORE_COLUMNS).toContain('household_id')
    expect(CHORE_COLUMNS).not.toContain('repeat_since')
    expect(CHORE_COLUMNS).not.toContain('repeat_caught_up_through')
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

// The `committedMinutes` and `commitmentByMember` describes lived here until
// #47 deleted both functions. Their claims did not go with them — the split
// surface makes the same statements about the same people, and
// src/components/Split.test.jsx carries them under "inherited from #36":
// minutes carried and minutes left, "over" rather than a clamped zero, roster
// order, a person holding nothing still appearing, and nothing that ranks.

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

// ---------------------------------------------------------------------------
// #12 — expected-vs-actual capture and feedback, the pure half.
//
// The write paths (seeding at completion, the update grant, the constraint)
// are exercised against a real Postgres in src/test/actuals.pglite.test.js.
// What is tested here is the arithmetic the screen renders and the boundary
// the estimate-update offer sits on. Boundary fixtures spell 3 and 25%
// LITERALLY rather than deriving from the constants, and the constants are
// pinned beside them — so changing a constant reddens a test instead of
// silently moving every fixture with it (the derive-from-the-same-source
// vacuity prove-tests names as shape 4).
// ---------------------------------------------------------------------------

describe('#12 AC 1 — minutes the work actually took', () => {
  it('accepts a whole number inside the bounds', () => {
    expect(normalizeActualMinutes(35)).toBe(35)
    expect(normalizeActualMinutes('45')).toBe(45)
  })

  it('refuses blank, non-numeric and fractional values with a sentence', () => {
    expect(() => normalizeActualMinutes('')).toThrow(/how many minutes did it actually take/i)
    expect(() => normalizeActualMinutes('soon')).toThrow(/must be a number/i)
    expect(() => normalizeActualMinutes(12.5)).toThrow(/whole number/i)
  })

  it('accepts ZERO — "it was already done" is a real fact, and #47 pins that it contributes zero', () => {
    expect(normalizeActualMinutes(0)).toBe(0)
    expect(normalizeActualMinutes('0')).toBe(0)
  })

  it('refuses negative time and more-than-a-day, matching chores_actual_minutes_range', () => {
    expect(() => normalizeActualMinutes(-5)).toThrow(/negative/i)
    expect(() => normalizeActualMinutes(1441)).toThrow(/more than a day/i)
  })
})

describe('#12 AC 2 — the family feedback is computed over', () => {
  const anchor = {
    id: 'r1',
    title: 'trash run',
    expected_minutes: 20,
    repeat_kind: 'weekly',
    completed_at: '2026-08-10T10:00:00Z',
    actual_minutes: 25,
  }
  const occurrenceDone = {
    id: 'o1',
    generated_from: 'r1',
    expected_minutes: 20,
    completed_at: '2026-08-17T10:00:00Z',
    actual_minutes: 31,
  }
  const occurrenceOpen = { id: 'o2', generated_from: 'r1', expected_minutes: 20, completed_at: null }
  const unrelatedDone = {
    id: 'c9',
    expected_minutes: 60,
    completed_at: '2026-08-11T10:00:00Z',
    actual_minutes: 90,
  }

  it('an anchor gathers itself and its completed occurrences, and nothing else', () => {
    const all = [anchor, occurrenceDone, occurrenceOpen, unrelatedDone]
    const ids = completedInstances(anchor, all).map((c) => c.id)
    expect(ids.sort()).toEqual(['o1', 'r1'])
  })

  it("an occurrence's own family is itself alone — its history belongs to the anchor", () => {
    const all = [anchor, occurrenceDone, occurrenceOpen, unrelatedDone]
    expect(completedInstances(occurrenceDone, all).map((c) => c.id)).toEqual(['o1'])
  })

  it('a one-off is its own family, so feedback is not template-only', () => {
    const all = [anchor, occurrenceDone, unrelatedDone]
    const summary = actualsSummary(unrelatedDone, all)
    expect(summary).toEqual({ count: 1, averageMinutes: 90 })
  })

  it('averages the recorded actuals', () => {
    const all = [anchor, occurrenceDone, occurrenceOpen]
    expect(actualsSummary(anchor, all)).toEqual({ count: 2, averageMinutes: 28 })
  })

  it('a completed instance from before 0015 counts at its own estimate — minutesOf\'s exact fallback', () => {
    const old = { id: 'o3', generated_from: 'r1', expected_minutes: 40, completed_at: '2026-08-03T10:00:00Z' }
    const all = [anchor, old]
    // (25 + 40) / 2 — the null actual stands in as that instance's estimate.
    expect(actualsSummary(anchor, all)).toEqual({ count: 2, averageMinutes: 32.5 })
  })
})

describe('#12 AC 3 — no completed instances means no fabricated average', () => {
  it('returns null on the zero-instance fixture, and the screen renders "no data yet"', () => {
    const fresh = { id: 'r2', expected_minutes: 20, repeat_kind: 'weekly', completed_at: null }
    expect(actualsSummary(fresh, [fresh])).toBeNull()
    expect(estimateSuggestion(fresh, [fresh])).toBeNull()
  })
})

describe('#12 AC 4 — the estimate-update boundary, at exactly 3 and exactly 25%', () => {
  // Build an anchor plus (n - 1) completed occurrences, n completions in all,
  // each with the actual asked for. Literal values throughout.
  const family = (expected, actuals) => {
    const anchor = {
      id: 'r1',
      expected_minutes: expected,
      repeat_kind: 'weekly',
      completed_at: '2026-08-10T10:00:00Z',
      actual_minutes: actuals[0],
    }
    const rest = actuals.slice(1).map((a, i) => ({
      id: `o${i}`,
      generated_from: 'r1',
      expected_minutes: expected,
      completed_at: '2026-08-17T10:00:00Z',
      actual_minutes: a,
    }))
    return { anchor, all: [anchor, ...rest] }
  }

  it('the tunable defaults are the ratified values', () => {
    // Pinned literally, so a drive-by constant edit reddens here even though
    // every fixture below spells its own numbers.
    expect(MIN_COMPLETIONS_FOR_ESTIMATE_UPDATE).toBe(3)
    expect(ESTIMATE_DEVIATION_THRESHOLD).toBe(0.25)
  })

  it('offers at EXACTLY 3 completions and EXACTLY 25% deviation — both boundaries inclusive', () => {
    const { anchor, all } = family(20, [25, 25, 25])
    expect(estimateSuggestion(anchor, all)).toBe(25)
  })

  it('withholds at 2 completions, whatever the deviation', () => {
    const { anchor, all } = family(20, [120, 120])
    expect(estimateSuggestion(anchor, all)).toBeNull()
  })

  it('withholds below 25% — an average of 24 against 20 is only 20% out', () => {
    const { anchor, all } = family(20, [24, 24, 24])
    expect(estimateSuggestion(anchor, all)).toBeNull()
  })

  it('offers downward too — an estimate can be too generous', () => {
    const { anchor, all } = family(20, [15, 15, 15])
    expect(estimateSuggestion(anchor, all)).toBe(15)
  })

  it('suggests the rounded average', () => {
    // (31 + 25 + 28) / 3 = 28, deviation 40% against 20.
    const { anchor, all } = family(20, [31, 25, 28])
    expect(estimateSuggestion(anchor, all)).toBe(28)
  })

  it('withholds a suggestion that rounds back to the current estimate', () => {
    // Average 1.33, deviation 33% — over the threshold, and still a button
    // offering to change 1 minute to 1 minute, so it is withheld.
    const { anchor, all } = family(1, [1, 1, 2])
    expect(estimateSuggestion(anchor, all)).toBeNull()
  })

  it('a run of zero-actuals suggests the floor — an estimate can never be zero', () => {
    // Three "it was already done" completions: average 0, deviation 100%. The
    // suggestion is a future ESTIMATE, and a zero estimate cannot be allocated
    // (0003's bound), so the offer floors at one minute rather than proposing
    // a value the column would refuse.
    const { anchor, all } = family(20, [0, 0, 0])
    expect(estimateSuggestion(anchor, all)).toBe(1)
  })

  it('SYNTHETIC CONTROL: the upper clamp is held to the column bounds', () => {
    // chores_actual_minutes_range keeps stored actuals inside 1..1440, so this
    // state cannot arrive from the database — the clamp is a defence at the
    // pure layer, and an unexercised defence is indistinguishable from dead
    // code, so this fixture manufactures the state the corpus cannot contain.
    const { anchor, all } = family(1000, [2000, 2000, 2000])
    expect(estimateSuggestion(anchor, all)).toBe(1440)
  })

  it('a one-off can never reach the floor, so the offer stays on anchors by arithmetic', () => {
    const one = {
      id: 'c1',
      expected_minutes: 20,
      completed_at: '2026-08-10T10:00:00Z',
      actual_minutes: 120,
    }
    expect(estimateSuggestion(one, [one])).toBeNull()
  })
})
