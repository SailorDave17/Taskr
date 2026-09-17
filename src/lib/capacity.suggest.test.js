// #480 — a week's budget suggested from the last weeks' completions and the
// calendar. Pure functions only: the fold that builds the history is
// history.test.js, what the roster does with the figure is Roster.test.jsx,
// what the constraint and the trigger admit is suggestedCapacity.pglite.test.js,
// and what App reads and does not wait for is App.test.jsx. This file is the
// arithmetic, its constants, and the corpus.

import { describe, expect, it } from 'vitest'
import {
  MAX_CAPACITY_MINUTES,
  MIN_CAPACITY_MINUTES,
  SUGGESTION_MIN_WEEKS,
  SUGGESTION_WINDOW_WEEKS,
  median,
  priorPeriodStarts,
  suggestCapacity,
} from './capacity.js'
import { PRIOR_MONDAYS, REQUIRED_SHAPES, SCENARIOS, THIS_WEEK, weeks } from './capacity.suggest.corpus.js'

describe('the constants are named, and their values are the story’s', () => {
  it('reads four weeks and speaks from two', () => {
    // Pinned as values: docs/capacity-model.md records why four and why two,
    // and a change here is a decision to re-take there first.
    expect(SUGGESTION_WINDOW_WEEKS).toBe(4)
    expect(SUGGESTION_MIN_WEEKS).toBe(2)
    expect(SUGGESTION_MIN_WEEKS).toBeLessThanOrEqual(SUGGESTION_WINDOW_WEEKS)
  })
})

describe('median', () => {
  it('is the middle value of an odd count, not the mean', () => {
    // 1, 2, 10: the mean is 4.33 and the median is 2. This is the whole reason
    // the rule is a median — the 10 is the heroic week.
    expect(median([10, 1, 2])).toBe(2)
  })

  it('is the mean of the two middle values of an even count', () => {
    expect(median([220, 200, 0, 240])).toBe(210)
    expect(median([1, 2])).toBe(1.5)
  })

  it('does not sort its argument in place', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })

  it('is null for nothing, rather than NaN', () => {
    expect(median([])).toBeNull()
    expect(median(undefined)).toBeNull()
  })
})

describe('priorPeriodStarts', () => {
  it('names the Mondays before the week, oldest first, exactly the window long', () => {
    expect(priorPeriodStarts(THIS_WEEK, 4)).toEqual(PRIOR_MONDAYS)
    expect(priorPeriodStarts(THIS_WEEK, 1)).toEqual(['2026-09-07'])
    expect(priorPeriodStarts(THIS_WEEK, 0)).toEqual([])
  })

  it('is pure date arithmetic — a month boundary does not move it', () => {
    // Deliberately NOT a daylight-saving claim: the suite pins the process
    // zone to a fixed-offset one (vite.config.js, asserted by gate.test.js),
    // so a local-getter mutation would stay green here and a DST clause in
    // this name would promise a proof the suite cannot deliver (review-fanout,
    // 2026-09-16). The zone-independence of the arithmetic is the mechanism
    // asserted below: the answer equals UTC calendar arithmetic on the key.
    expect(priorPeriodStarts('2026-11-02', 1)).toEqual(['2026-10-26'])
    expect(priorPeriodStarts('2026-03-02', 1)).toEqual(['2026-02-23'])
    const viaUtc = new Date(Date.UTC(2026, 10, 2 - 7)).toISOString().slice(0, 10)
    expect(priorPeriodStarts('2026-11-02', 1)[0]).toBe(viaUtc)
  })

  it('refuses anything that is not a period start', () => {
    expect(() => priorPeriodStarts('soon', 4)).toThrow(/not a period start/)
    expect(() => priorPeriodStarts(null, 4)).toThrow(/not a period start/)
  })
})

describe('AC 1 — the corpus, every expectation written by hand', () => {
  it('POSITIVE CONTROL: the corpus carries every shape the story names, and at least six cases', () => {
    // A corpus that lost its blank-week case would still be a corpus. The
    // story asks for six named shapes; each is tagged and each must be here.
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(6)
    const shapes = new Set(SCENARIOS.map((s) => s.shape))
    for (const shape of REQUIRED_SHAPES) expect(shapes, `missing the ${shape} case`).toContain(shape)
  })

  it('POSITIVE CONTROL: the corpus is not vacuously one answer', () => {
    // If every case expected the same figure, a function returning a constant
    // would pass the whole corpus.
    expect(new Set(SCENARIOS.map((s) => s.expect.minutes)).size).toBeGreaterThan(3)
  })

  it.each(SCENARIOS.map((s) => [s.name, s]))('%s', (_name, scenario) => {
    const result = suggestCapacity({
      member: scenario.member,
      history: scenario.history,
      busyWeek: scenario.busyWeek,
      workMinutes: scenario.workMinutes,
    })
    expect(result).toEqual(scenario.expect)
  })

  it('reads the rows in any order — the window is the most recent by period, not by position', () => {
    // The window case carries six weeks; reversing them must not make the
    // heroic July weeks the "recent" four.
    const windowed = SCENARIOS.find((s) => s.name.startsWith('the window'))
    const reversed = [...windowed.history].reverse()
    expect(
      suggestCapacity({ ...windowed, history: reversed, workMinutes: windowed.workMinutes }),
    ).toEqual(windowed.expect)
  })

  it('AC 1 — a median, not a mean: the corpus as a whole discriminates the two', () => {
    // Stated as a property of the CORPUS rather than left to the mutation
    // pass alone: for most cases the mean of the done minutes is not the
    // median, so a mean-based rule cannot pass them. Two cases (work-only
    // and the floor) have equal mean and median on purpose and say so.
    const discriminating = SCENARIOS.filter((s) => {
      const recent = s.history.slice(-SUGGESTION_WINDOW_WEEKS).map((w) => w.doneMinutes)
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length
      return Math.round(mean) !== Math.round(median(recent))
    })
    expect(discriminating.length).toBeGreaterThanOrEqual(6)
  })
})

describe('AC 2 — below the floor there is nothing to offer', () => {
  const member = { id: 'm1' }

  it('one completed week is an anecdote: null, not a figure', () => {
    expect(suggestCapacity({ member, history: weeks([210]), busyWeek: null })).toBeNull()
  })

  it('no history at all: null', () => {
    expect(suggestCapacity({ member, history: [], busyWeek: null })).toBeNull()
    expect(suggestCapacity({ member, history: undefined, busyWeek: null })).toBeNull()
  })

  it('a window with NO completion in it is not a history of zero — nothing is offered', () => {
    // design-bar, owner verdict 2026-09-16: the prototype's four-blank-weeks
    // case read "Suggested: 0 min · typically 0 min done over 4 weeks" with a
    // live tap, which is the counter-moment. A blank week AMONG others still
    // counts (the blank-week corpus case); every week blank is no history.
    expect(suggestCapacity({ member, history: weeks([0, 0, 0, 0]), busyWeek: null })).toBeNull()
    expect(suggestCapacity({ member, history: weeks([0, 0]), busyWeek: null })).toBeNull()
    // POSITIVE CONTROL: one non-blank week among blanks IS a history.
    expect(suggestCapacity({ member, history: weeks([0, 0, 0, 40]), busyWeek: null })?.minutes).toBe(0)
  })

  it('exactly the floor speaks', () => {
    const result = suggestCapacity({ member, history: weeks([200, 220]), busyWeek: null })
    expect(result?.minutes).toBe(210)
    expect(result?.reason[0]).toBe('typically 210 min done over 2 weeks')
  })

  it('counts only THIS member’s weeks toward the floor — a housemate’s history is not theirs', () => {
    const housemates = weeks([200, 220, 240, 260]).map((w) => ({ ...w, memberId: 'm2' }))
    expect(suggestCapacity({ member, history: housemates, busyWeek: null })).toBeNull()
    // And the housemate's own row reads their own weeks.
    expect(suggestCapacity({ member: { id: 'm2' }, history: housemates, busyWeek: null })?.minutes).toBe(230)
  })
})

describe('the clamp and the shape of the result', () => {
  const member = { id: 'm1' }

  it('never exceeds the week — MAX_CAPACITY_MINUTES', () => {
    // 10080 done in every week (a week has no more), minus a calendar 500
    // quieter than usual: 10580 → the ceiling.
    const history = weeks([10080, 10080, 10080, 10080], [500, 500, 500, 500])
    const result = suggestCapacity({
      member,
      history,
      busyWeek: { member_id: 'm1', period_start: THIS_WEEK, busy_minutes: 0 },
    })
    expect(result.minutes).toBe(MAX_CAPACITY_MINUTES)
    expect(result.calendarDelta).toBe(-500)
  })

  it('the floor is the constraint’s floor', () => {
    expect(MIN_CAPACITY_MINUTES).toBe(0)
  })

  it('a busy row with no figure is an unread calendar, not an empty one', () => {
    // `Number(null)` is 0: without the guard this week would read as empty
    // and the suggestion would add the whole usual busyness back.
    const history = weeks([180, 210, 210, 260], [90, 90, 90, 90])
    const result = suggestCapacity({
      member,
      history,
      busyWeek: { member_id: 'm1', period_start: THIS_WEEK, busy_minutes: null },
    })
    expect(result.minutes).toBe(210)
    expect(result.reason[1]).toBe('no calendar read this week')
  })

  it('a prior week with no busy figure is left out of the comparison, not read as zero', () => {
    // Two weeks read at 90 and TWO unread: the usual is 90, so this week at
    // 90 is "as usual". Reading the unread weeks as 0 would sort to
    // [0, 0, 90, 90], make the usual 45, and call this week 45 busier. Two
    // nulls, not one — review-fanout (2026-09-16) measured that with one null
    // among three 90s the median is 90 either way and this test could not
    // fail on the mutation it names.
    const history = weeks([180, 210, 210, 260], [90, null, null, 90])
    const result = suggestCapacity({
      member,
      history,
      busyWeek: { member_id: 'm1', period_start: THIS_WEEK, busy_minutes: 90 },
    })
    expect(result.calendarDelta).toBe(0)
    expect(result.minutes).toBe(210)
  })

  it('the reason is exactly two lines, both sentences a person can read', () => {
    const result = suggestCapacity({ member, history: weeks([200, 220]), busyWeek: null })
    expect(result.reason).toHaveLength(2)
    for (const line of result.reason) expect(line).toMatch(/^[a-z0-9]/)
  })
})
