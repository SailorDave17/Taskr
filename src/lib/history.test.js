// #480 — the fold from chores and busy rows to one row per member per
// completed prior week. What `suggestCapacity` does with the rows is
// capacity.suggest.test.js; this is which rows exist and what they carry.
//
// Names are synthetic — see #19.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completedMinutesOf, weeklyHistory } from './history.js'
import { SUGGESTION_WINDOW_WEEKS } from './capacity.js'

const TZ = 'UTC'
// 2026-09-14 is a Monday; the four prior Mondays are the window.
const THIS_WEEK = '2026-09-14'
const [W1, W2, W3, W4] = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']

const members = [
  { id: 'm1', display_name: 'Placeholder One', created_at: '2026-01-05T10:00:00Z' },
  { id: 'm2', display_name: 'Placeholder Two', created_at: '2026-01-05T10:00:00Z' },
]

/** A completed chore, done on `at` by `holder`. */
const done = (id, holder, at, expected, actual = null) => ({
  id,
  title: 'Placeholder Chore',
  expected_minutes: expected,
  actual_minutes: actual,
  completed_at: at,
  completed_by_member_id: holder,
  assigned_member_id: holder,
  missed_at: null,
})

const chores = [
  done('c1', 'm1', `${W1}T12:00:00Z`, 60),
  done('c2', 'm1', `${W1}T18:00:00Z`, 30, 45), // actual recorded: 45 counts, not 30
  done('c3', 'm1', `${W3}T09:00:00Z`, 120),
  done('c4', 'm1', `${W4}T09:00:00Z`, 20),
  done('c5', 'm2', `${W4}T09:00:00Z`, 200),
  // THIS week — not history.
  done('c6', 'm1', `${THIS_WEEK}T09:00:00Z`, 999),
  // Five weeks ago — outside the window.
  done('c7', 'm1', '2026-08-10T09:00:00Z', 999),
  // Outstanding — not done.
  { id: 'c8', title: 'Placeholder Chore', expected_minutes: 999, completed_at: null, missed_at: null, assigned_member_id: 'm1' },
  // Missed — nobody did it (#305).
  { id: 'c9', title: 'Placeholder Chore', expected_minutes: 999, completed_at: null, missed_at: `${W2}T09:00:00Z`, assigned_member_id: 'm1' },
  // Completed and credited to nobody.
  done('c10', null, `${W2}T09:00:00Z`, 999),
]

const busyWeeks = [
  { id: 'b1', member_id: 'm1', period_start: W1, busy_minutes: 90 },
  { id: 'b2', member_id: 'm1', period_start: W4, busy_minutes: 150 },
  { id: 'b3', member_id: 'm2', period_start: W4, busy_minutes: 0 },
  // A row for THIS week and one from before the window: both ignored here.
  { id: 'b4', member_id: 'm1', period_start: THIS_WEEK, busy_minutes: 500 },
  { id: 'b5', member_id: 'm1', period_start: '2026-08-10', busy_minutes: 500 },
]

const rowsFor = (rows, id) => rows.filter((r) => r.memberId === id)

describe('weeklyHistory', () => {
  const rows = weeklyHistory({ members, chores, busyWeeks, timeZone: TZ, periodStart: THIS_WEEK })

  it('one row per member per prior week in the window, oldest first', () => {
    expect(rows).toHaveLength(2 * SUGGESTION_WINDOW_WEEKS)
    expect(rowsFor(rows, 'm1').map((r) => r.periodStart)).toEqual([W1, W2, W3, W4])
    expect(rowsFor(rows, 'm2').map((r) => r.periodStart)).toEqual([W1, W2, W3, W4])
  })

  it('sums the holder’s completions per week, actual minutes where recorded', () => {
    const mine = rowsFor(rows, 'm1')
    // W1: 60 + 45 (the actual, not the 30 estimate) = 105.
    expect(mine[0]).toMatchObject({ periodStart: W1, doneMinutes: 105 })
    expect(mine[2]).toMatchObject({ periodStart: W3, doneMinutes: 120 })
    expect(mine[3]).toMatchObject({ periodStart: W4, doneMinutes: 20 })
    expect(rowsFor(rows, 'm2')[3]).toMatchObject({ periodStart: W4, doneMinutes: 200 })
  })

  it('a week with nothing done is a row with zero, not a missing row', () => {
    // W2 for m1 carries a missed chore and a completion credited to nobody:
    // neither is this person's done work, and the week still exists.
    expect(rowsFor(rows, 'm1')[1]).toMatchObject({ periodStart: W2, doneMinutes: 0 })
    expect(rowsFor(rows, 'm2').slice(0, 3).map((r) => r.doneMinutes)).toEqual([0, 0, 0])
  })

  it('credits a COVERED chore to the person who completed it, not to its holder', () => {
    // Owner decision at review-fanout's gate, 2026-09-16. m1 holds the chore;
    // m2 finishes it. 0029 keeps the holder, so `assigned_member_id` stays m1
    // while `completed_by_member_id` is m2 — and the history is about what
    // m2 got done. The split's done bars credit m1; the two differ here on
    // purpose, and the docs say so.
    const covered = [{ ...done('cov', 'm1', `${W3}T09:00:00Z`, 80), completed_by_member_id: 'm2' }]
    const rows = weeklyHistory({ members, chores: covered, busyWeeks: [], timeZone: TZ, periodStart: THIS_WEEK })
    expect(rowsFor(rows, 'm2').find((r) => r.periodStart === W3).doneMinutes).toBe(80)
    expect(rowsFor(rows, 'm1').find((r) => r.periodStart === W3).doneMinutes).toBe(0)
  })

  it('falls back to the holder for a completion with no completer stamped (pre-0004 rows)', () => {
    const old = [{ ...done('old', 'm1', `${W3}T09:00:00Z`, 50), completed_by_member_id: null }]
    const rows = weeklyHistory({ members, chores: old, busyWeeks: [], timeZone: TZ, periodStart: THIS_WEEK })
    expect(rowsFor(rows, 'm1').find((r) => r.periodStart === W3).doneMinutes).toBe(50)
  })

  it('this week, weeks before the window, outstanding and missed chores contribute nothing', () => {
    // Every excluded fixture carries 999 minutes, so any leak is visible.
    for (const row of rows) expect(row.doneMinutes).toBeLessThan(999)
  })

  it('carries the calendar figure where a week was read, and null where it was not', () => {
    const mine = rowsFor(rows, 'm1')
    expect(mine.map((r) => r.busyMinutes)).toEqual([90, null, null, 150])
    // Zero busy is a READ week with an empty calendar — a figure, not an absence.
    expect(rowsFor(rows, 'm2')[3].busyMinutes).toBe(0)
  })

  it('carries no work term — the slot was retired with #479 (#518)', () => {
    for (const row of rows) expect(row).not.toHaveProperty('workMinutes')
  })

  it('a member is in a week from the week they joined — the join week counts, earlier ones do not', () => {
    // Joined on the Friday of W3: W3 and W4 exist, W1 and W2 do not.
    const late = [{ id: 'm3', display_name: 'Placeholder Two', created_at: '2026-09-04T15:00:00Z' }]
    const late3 = weeklyHistory({ members: late, chores: [], busyWeeks: [], timeZone: TZ, periodStart: THIS_WEEK })
    expect(late3.map((r) => r.periodStart)).toEqual([W3, W4])
  })

  it('a member row with no created_at has no history — nothing says when they arrived', () => {
    // The alternative (in every week) would hand a person who may have joined
    // yesterday four blank weeks and a confident zero.
    const undated = [{ id: 'm4', display_name: 'Placeholder Two' }]
    const rows4 = weeklyHistory({ members: undated, chores, busyWeeks, timeZone: TZ, periodStart: THIS_WEEK })
    expect(rows4).toEqual([])
  })

  it('files a completion under the HOUSEHOLD’s week, not UTC’s — the Done tab’s rule', () => {
    // 2026-09-07T03:30Z is 23:30 on Sunday the 6th in New York: last week
    // there (W3), this week's Monday in UTC (W4).
    const lateSunday = [done('z', 'm1', '2026-09-07T03:30:00Z', 70)]
    const ny = weeklyHistory({ members: members.slice(0, 1), chores: lateSunday, busyWeeks: [], timeZone: 'America/New_York', periodStart: THIS_WEEK })
    expect(ny.find((r) => r.periodStart === W3).doneMinutes).toBe(70)
    expect(ny.find((r) => r.periodStart === W4).doneMinutes).toBe(0)
    const utc = weeklyHistory({ members: members.slice(0, 1), chores: lateSunday, busyWeeks: [], timeZone: 'UTC', periodStart: THIS_WEEK })
    expect(utc.find((r) => r.periodStart === W4).doneMinutes).toBe(70)
  })

  it('refuses to run without a zone or a period rather than folding the wrong weeks', () => {
    expect(() => weeklyHistory({ members, chores, busyWeeks, periodStart: THIS_WEEK })).toThrow(/timezone/)
    expect(() => weeklyHistory({ members, chores, busyWeeks, timeZone: TZ })).toThrow(/particular week/)
  })

  it('an empty household is an empty history', () => {
    expect(weeklyHistory({ members: [], chores, busyWeeks, timeZone: TZ, periodStart: THIS_WEEK })).toEqual([])
  })
})

describe('completedMinutesOf', () => {
  it('prefers the recorded actual, falls back to the estimate, and reads a missing estimate as zero', () => {
    expect(completedMinutesOf({ expected_minutes: 30, actual_minutes: 45 })).toBe(45)
    expect(completedMinutesOf({ expected_minutes: 30, actual_minutes: null })).toBe(30)
    expect(completedMinutesOf({ expected_minutes: 30, actual_minutes: 0 })).toBe(0)
    expect(completedMinutesOf({})).toBe(0)
  })

  it('is the same fallback the split’s done bars make', () => {
    // Read out of allocation.js rather than restated: the two must agree
    // about what an old completion cost, or the history and the bars diverge.
    const allocation = readFileSync(resolve(process.cwd(), 'src/lib/allocation.js'), 'utf8')
    expect(allocation).toMatch(/actualMinutes == null \? chore\.expectedMinutes : chore\.actualMinutes/)
  })
})

describe('the module never resolves capacity', () => {
  it('does not read members.weekly_minutes — the history is what happened, not what was typed', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/history.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(source).not.toMatch(/weekly_minutes/)
  })
})
