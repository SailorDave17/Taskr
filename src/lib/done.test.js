import { describe, expect, it } from 'vitest'
import { countDoneInWeek, doneWeekOf, groupDoneByWeek, settledAt, weekRangeLabel } from './done.js'

// #302 — completed chores by capacity week. Chore names are synthetic (#19).
//
// The zone matters and the fixtures are chosen so that it shows: the household
// is in America/New_York, and one completion sits in the hour where UTC has
// already started the next week and New York has not.

const tz = 'America/New_York'

const done = (id, completedAt, extra = {}) => ({
  id,
  household_id: 'h1',
  title: 'Placeholder Done Chore',
  expected_minutes: 30,
  due_on: '2026-08-10',
  completed_at: completedAt,
  completed_by_member_id: 'm1',
  ...extra,
})

const outstanding = {
  id: 'o1',
  household_id: 'h1',
  title: 'Placeholder Chore',
  expected_minutes: 20,
  due_on: '2026-08-10',
  completed_at: null,
  completed_by_member_id: null,
}

describe('doneWeekOf — the capacity week a completion belongs to', () => {
  it('is null for outstanding work, which has no week yet', () => {
    expect(doneWeekOf(outstanding, tz)).toBeNull()
    expect(doneWeekOf({ ...outstanding, completed_at: undefined }, tz)).toBeNull()
  })

  it('keys on completed_at, never due_on', () => {
    // Due in the week of Aug 10, finished in the week of Aug 24.
    expect(doneWeekOf(done('d1', '2026-08-25T14:00:00Z'), tz)).toBe('2026-08-24')
  })

  it('decides the week in the HOUSEHOLD zone: Sunday 23:30 in New York is still Sunday', () => {
    // 2026-08-31T03:30Z is Monday in UTC and Sunday 23:30 in New York (EDT),
    // so the completion belongs to the week of Aug 24, not Aug 31. A UTC
    // grouping fails this.
    expect(doneWeekOf(done('d1', '2026-08-31T03:30:00Z'), tz)).toBe('2026-08-24')
    expect(doneWeekOf(done('d1', '2026-08-31T03:30:00Z'), 'UTC')).toBe('2026-08-31')
  })
})

describe('groupDoneByWeek — AC 2', () => {
  it('puts completions from two capacity weeks in two groups, newest week first', () => {
    const groups = groupDoneByWeek(
      [done('old', '2026-08-12T10:00:00Z'), outstanding, done('new', '2026-08-25T10:00:00Z')],
      tz,
    )
    expect(groups.map((g) => g.periodStart)).toEqual(['2026-08-24', '2026-08-10'])
    expect(groups[0].chores.map((c) => c.id)).toEqual(['new'])
    expect(groups[1].chores.map((c) => c.id)).toEqual(['old'])
  })

  it('keeps two completions from ONE week in one group, latest first', () => {
    const groups = groupDoneByWeek(
      [done('mon', '2026-08-24T10:00:00Z'), done('wed', '2026-08-26T10:00:00Z')],
      tz,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].chores.map((c) => c.id)).toEqual(['wed', 'mon'])
  })

  it('drops outstanding chores rather than grouping them', () => {
    expect(groupDoneByWeek([outstanding], tz)).toEqual([])
  })

  it('does not mutate the list it was handed', () => {
    const rows = [done('b', '2026-08-26T10:00:00Z'), done('a', '2026-08-24T10:00:00Z')]
    groupDoneByWeek(rows, tz)
    expect(rows.map((c) => c.id)).toEqual(['b', 'a'])
  })
})

describe('countDoneInWeek — the one line the Chores tab keeps (AC 1)', () => {
  const rows = [
    outstanding,
    done('this1', '2026-08-25T10:00:00Z'),
    done('this2', '2026-08-30T22:00:00Z'),
    done('last', '2026-08-20T10:00:00Z'),
  ]

  it('counts only the completions in the week App derived', () => {
    expect(countDoneInWeek(rows, tz, '2026-08-24')).toBe(2)
    expect(countDoneInWeek(rows, tz, '2026-08-17')).toBe(1)
  })

  it('is zero with no period yet, rather than a crash before the household is read', () => {
    expect(countDoneInWeek(rows, tz, null)).toBe(0)
  })
})

describe('weekRangeLabel — a capacity week as people read it', () => {
  it('spells Monday to Sunday with the year once', () => {
    expect(weekRangeLabel('2026-08-24')).toBe('Aug 24 – Aug 30, 2026')
  })

  it('spells the year on both ends when the week straddles one', () => {
    expect(weekRangeLabel('2025-12-29')).toBe('Dec 29, 2025 – Jan 4, 2026')
  })

  it('formats the pure date without shifting it into a zone', () => {
    // The label is built in UTC on purpose: a Monday formatted in New York
    // would read as the Sunday before it.
    expect(weekRangeLabel('2026-03-30')).toBe('Mar 30 – Apr 5, 2026')
  })

  it('refuses something that is not a date', () => {
    expect(() => weekRangeLabel('not-a-week')).toThrow(/period start/)
  })
})

// ---------------------------------------------------------------------------
// #305 — a chore nobody did belongs to the week it was given up on, sits in
// that week's group beside the completions, and is NOT counted as done.
// ---------------------------------------------------------------------------

describe('#305 — a missed chore on the Done surface', () => {
  const missed = (id, missedAt) => ({
    id,
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
    completed_at: null,
    completed_by_member_id: null,
    missed_at: missedAt,
  })

  it('settledAt is the completion or the miss, and null while outstanding', () => {
    expect(settledAt(outstanding)).toBeNull()
    expect(settledAt(done('d1', '2026-08-25T14:00:00Z'))).toBe('2026-08-25T14:00:00Z')
    expect(settledAt(missed('m1', '2026-08-26T09:00:00Z'))).toBe('2026-08-26T09:00:00Z')
  })

  it('doneWeekOf keys a missed chore on missed_at, in the household zone', () => {
    expect(doneWeekOf(missed('m1', '2026-08-26T09:00:00Z'), tz)).toBe('2026-08-24')
    // Sunday 23:30 in New York: still the week of Aug 24, as it is for a completion.
    expect(doneWeekOf(missed('m1', '2026-08-31T03:30:00Z'), tz)).toBe('2026-08-24')
    expect(doneWeekOf(missed('m1', '2026-08-31T03:30:00Z'), 'UTC')).toBe('2026-08-31')
  })

  it('groupDoneByWeek files it in its week, ordered with the completions by the settled instant', () => {
    const groups = groupDoneByWeek(
      [done('d', '2026-08-25T10:00:00Z'), missed('m', '2026-08-26T09:00:00Z'), outstanding],
      tz,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].periodStart).toBe('2026-08-24')
    expect(groups[0].chores.map((c) => c.id)).toEqual(['m', 'd'])
  })

  it('countDoneInWeek does NOT count it — a chore nobody did is not done', () => {
    const rows = [missed('m', '2026-08-25T09:00:00Z'), done('d', '2026-08-25T10:00:00Z'), outstanding]
    expect(countDoneInWeek(rows, tz, '2026-08-24')).toBe(1)
    expect(countDoneInWeek(rows, tz, '2026-08-24')).not.toBe(2)
  })
})
