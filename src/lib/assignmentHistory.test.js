// #481 — the fold from history rows to the allocator's steer. What the
// allocator does with a steer is allocation.test.js; this is which steers
// exist for which rows.
//
// Names are synthetic — see #19. Ids are lowercase on purpose.

import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_HISTORY_COLUMNS,
  HISTORY_WINDOW_WEEKS,
  MOVED_OFF_MOVES,
  MOVED_OFF_WINDOW_WEEKS,
  REPEAT_HOLDER_WEEKS,
  historyKeyOf,
  steeringFor,
} from './assignmentHistory.js'
import { SUGGESTION_WINDOW_WEEKS } from './capacity.js'

// 2026-09-14 is a Monday; the three prior Mondays are the window.
const THIS_WEEK = '2026-09-14'
const [W3, W2, W1] = ['2026-08-24', '2026-08-31', '2026-09-07']
const OLDER = '2026-08-17'

let seq = 0
/** One history row, the way `listAssignmentHistory` returns it. */
function change({ key = 'p-dishes', chore = 'c-dishes', from = null, to, fromSource = null, source, week }) {
  seq += 1
  return {
    id: `h${String(seq).padStart(3, '0')}`,
    household_id: 'hh-1',
    chore_id: chore,
    repeat_parent_id: key === chore ? null : key,
    from_member_id: from,
    to_member_id: to,
    from_source: fromSource,
    source,
    actor_member_id: 'm-alex',
    period_start: week,
    recorded_at: `${week}T${String(10 + (seq % 10)).padStart(2, '0')}:00:00Z`,
  }
}

const dealt = (to, week, extra = {}) => change({ to, source: 'auto', week, ...extra })
const movedOff = (from, to, week, extra = {}) =>
  change({ from, to, fromSource: 'auto', source: 'manual', week, ...extra })

const thisWeeksOccurrence = [{ id: 'c-dishes-w', key: 'p-dishes' }]
const steer = (history, chores = thisWeeksOccurrence, periodStart = THIS_WEEK) =>
  steeringFor({ history, chores, periodStart })

describe('the windows, as constants the docs record', () => {
  it('three weeks on one person, and two hand moves in three weeks', () => {
    expect(REPEAT_HOLDER_WEEKS).toBe(3)
    expect(MOVED_OFF_WINDOW_WEEKS).toBe(3)
    expect(MOVED_OFF_MOVES).toBe(2)
  })

  it('reads no further back than the wider window, and less far than the capacity suggestion', () => {
    expect(HISTORY_WINDOW_WEEKS).toBe(Math.max(REPEAT_HOLDER_WEEKS, MOVED_OFF_WINDOW_WEEKS))
    expect(HISTORY_WINDOW_WEEKS).toBeLessThan(SUGGESTION_WINDOW_WEEKS)
  })

  it('the column list names every column 0049 grants, household_id included', () => {
    expect(ASSIGNMENT_HISTORY_COLUMNS.split(', ')).toEqual([
      'id',
      'household_id',
      'chore_id',
      'repeat_parent_id',
      'from_member_id',
      'to_member_id',
      'from_source',
      'source',
      'actor_member_id',
      'period_start',
      'recorded_at',
    ])
  })
})

describe('the key "the same chore across weeks" is read by', () => {
  it('is the repeat parent for an occurrence and the row id for a one-off', () => {
    expect(historyKeyOf({ id: 'c-1', generated_from: 'p-1' })).toBe('p-1')
    expect(historyKeyOf({ id: 'c-1', generated_from: null })).toBe('c-1')
    expect(historyKeyOf({ id: 'c-1' })).toBe('c-1')
  })

  it('reads a history row the same way', () => {
    expect(historyKeyOf({ chore_id: 'c-1', id: 'h-1', repeat_parent_id: 'p-1' })).toBe('p-1')
  })
})

describe('repeat — the last three weeks all dealt it to one person (AC 2)', () => {
  it('names the member when every deal-out in each of the three prior weeks went to them', () => {
    const history = [dealt('m-alex', W3), dealt('m-alex', W2), dealt('m-alex', W1)]
    expect(steer(history)).toEqual([
      { choreId: 'c-dishes-w', avoid: ['m-alex'], kind: 'repeat', weeks: 3 },
    ])
  })

  it('a week whose deal-outs were split between two people breaks the run, whatever order the rows carry', () => {
    // A Mon+Thu repeat dealt Mon→alex, Thu→robin: both rows share one
    // deal-out's `recorded_at`, so "which came last" is uuid luck
    // (review-fanout, 2026-09-18). The week is read as a SET and it is not
    // one person's week — in either row order.
    const split = [
      dealt('m-alex', W3),
      dealt('m-alex', W2),
      { ...dealt('m-alex', W1), recorded_at: `${W1}T10:00:00Z`, id: 'h-zz' },
      { ...dealt('m-robin', W1), recorded_at: `${W1}T10:00:00Z`, id: 'h-aa' },
    ]
    expect(steer(split)).toEqual([])
    expect(steer([...split].reverse())).toEqual([])
  })

  it('POSITIVE CONTROL: two occurrences in one week that BOTH went to alex still count as alex’s week', () => {
    const history = [
      dealt('m-alex', W3),
      dealt('m-alex', W2),
      { ...dealt('m-alex', W1), recorded_at: `${W1}T10:00:00Z`, chore: 'c-dishes-mon' },
      { ...dealt('m-alex', W1), recorded_at: `${W1}T10:00:00Z`, chore: 'c-dishes-thu' },
    ]
    expect(steer(history)).toHaveLength(1)
    expect(steer(history)[0].avoid).toEqual(['m-alex'])
  })

  it('is broken by a week with no deal-out at all — two of three is not a habit', () => {
    const history = [dealt('m-alex', W3), dealt('m-alex', W1)]
    expect(steer(history)).toEqual([])
  })

  it('is broken by a week on somebody else', () => {
    const history = [dealt('m-alex', W3), dealt('m-robin', W2), dealt('m-alex', W1)]
    expect(steer(history)).toEqual([])
  })

  it('ignores THIS week — a re-run must not steer on its own earlier placement', () => {
    const history = [dealt('m-alex', W2), dealt('m-alex', W1), dealt('m-alex', THIS_WEEK)]
    expect(steer(history)).toEqual([])
  })

  it('ignores a week older than the window', () => {
    const history = [dealt('m-alex', OLDER), dealt('m-alex', W2), dealt('m-alex', W1)]
    expect(steer(history)).toEqual([])
  })

  it('counts only auto placements — a hand placement on the same person is not a deal-out', () => {
    const history = [
      dealt('m-alex', W3),
      dealt('m-alex', W2),
      change({ from: null, to: 'm-alex', source: 'manual', week: W1 }),
    ]
    expect(steer(history)).toEqual([])
  })
})

describe('movedOff — dealt to them and then hand-moved off, twice in three weeks (AC 3)', () => {
  it('names the member moved off in two of the three prior weeks', () => {
    const history = [
      dealt('m-alex', W3),
      movedOff('m-alex', 'm-robin', W3),
      dealt('m-alex', W1),
      movedOff('m-alex', 'm-robin', W1),
    ]
    expect(steer(history)).toEqual([
      { choreId: 'c-dishes-w', avoid: ['m-alex'], kind: 'movedOff', weeks: 2 },
    ])
  })

  it('once is a circumstance, not a pattern', () => {
    const history = [dealt('m-alex', W1), movedOff('m-alex', 'm-robin', W1)]
    expect(steer(history)).toEqual([])
  })

  it('counts weeks, not rows — two moves in one week are one week of evidence', () => {
    const history = [
      dealt('m-alex', W1),
      movedOff('m-alex', 'm-robin', W1),
      movedOff('m-alex', 'm-sam', W1),
    ]
    expect(steer(history)).toEqual([])
  })

  it('requires a move onto SOMEBODY ELSE — an unassign is not a move, a pin is not a disagreement', () => {
    const unassigned = change({ from: 'm-alex', to: null, fromSource: 'auto', source: null, week: W3 })
    const pinned = movedOff('m-alex', 'm-alex', W1)
    expect(steer([dealt('m-alex', W3), unassigned, dealt('m-alex', W1), pinned])).toEqual([])
  })

  it('requires the move to be off an AUTO placement — undoing a hand placement is not the signal', () => {
    const offManual = change({ from: 'm-alex', to: 'm-robin', fromSource: 'manual', source: 'manual', week: W3 })
    expect(steer([offManual, movedOff('m-alex', 'm-robin', W1)])).toEqual([])
  })

  it('ignores this week and weeks outside the window', () => {
    const history = [
      movedOff('m-alex', 'm-robin', OLDER),
      movedOff('m-alex', 'm-robin', THIS_WEEK),
      movedOff('m-alex', 'm-robin', W1),
    ]
    expect(steer(history)).toEqual([])
  })

  it('wins over the repeat signal for the same chore, and carries its own count', () => {
    const history = [
      dealt('m-alex', W3),
      movedOff('m-alex', 'm-robin', W3),
      dealt('m-alex', W2),
      movedOff('m-alex', 'm-robin', W2),
      dealt('m-alex', W1),
      movedOff('m-alex', 'm-robin', W1),
    ]
    expect(steer(history)).toEqual([
      { choreId: 'c-dishes-w', avoid: ['m-alex'], kind: 'movedOff', weeks: 3 },
    ])
  })

  it('names EVERY member moved off often enough, most weeks first, ties to the lower id', () => {
    // alex's rows come FIRST and alex has the lower id, so a fold that kept
    // the first qualifying member, or broke ties by id before counting,
    // would name alex ahead of robin — the fixture the tie-break note asks
    // for (a-fixture-cannot-tell-a-sort-from-its-tie-break, 2026-09-06).
    const history = [
      movedOff('m-alex', 'm-robin', W2),
      movedOff('m-alex', 'm-robin', W1),
      movedOff('m-robin', 'm-alex', W3),
      movedOff('m-robin', 'm-alex', W2),
      movedOff('m-robin', 'm-alex', W1),
    ]
    expect(steer(history)[0]).toEqual({
      choreId: 'c-dishes-w',
      avoid: ['m-robin', 'm-alex'],
      kind: 'movedOff',
      weeks: 3,
    })
    // And a member moved off once is not on the list at all.
    const withSam = [...history, movedOff('m-sam', 'm-alex', W1)]
    expect(steer(withSam)[0].avoid).toEqual(['m-robin', 'm-alex'])
  })
})

describe('keys, chores and shape', () => {
  it('reads an occurrence under its repeat parent, so a new row every week is still the same chore', () => {
    const history = [
      dealt('m-alex', W3, { chore: 'c-dishes-3' }),
      dealt('m-alex', W2, { chore: 'c-dishes-2' }),
      dealt('m-alex', W1, { chore: 'c-dishes-1' }),
    ]
    expect(steer(history, [{ id: 'c-dishes-0', key: 'p-dishes' }])).toEqual([
      { choreId: 'c-dishes-0', avoid: ['m-alex'], kind: 'repeat', weeks: 3 },
    ])
  })

  it('reads a one-off under its own id', () => {
    const history = [
      dealt('m-alex', W3, { key: 'c-bins', chore: 'c-bins' }),
      dealt('m-alex', W2, { key: 'c-bins', chore: 'c-bins' }),
      dealt('m-alex', W1, { key: 'c-bins', chore: 'c-bins' }),
    ]
    expect(steer(history, [{ id: 'c-bins', key: 'c-bins' }])).toHaveLength(1)
  })

  it('says nothing about a chore with no history, and nothing about a chore not being dealt', () => {
    const history = [dealt('m-alex', W3), dealt('m-alex', W2), dealt('m-alex', W1)]
    expect(steer(history, [{ id: 'c-other', key: 'p-other' }])).toEqual([])
    expect(steer(history, [])).toEqual([])
    expect(steer([], thisWeeksOccurrence)).toEqual([])
    expect(steer(null, thisWeeksOccurrence)).toEqual([])
  })

  it('is sorted by chore id and independent of row order', () => {
    const history = [
      dealt('m-alex', W1, { key: 'p-b', chore: 'c-b1' }),
      dealt('m-alex', W1, { key: 'p-a', chore: 'c-a1' }),
      dealt('m-alex', W3, { key: 'p-b', chore: 'c-b3' }),
      dealt('m-alex', W2, { key: 'p-a', chore: 'c-a2' }),
      dealt('m-alex', W2, { key: 'p-b', chore: 'c-b2' }),
      dealt('m-alex', W3, { key: 'p-a', chore: 'c-a3' }),
    ]
    const chores = [
      { id: 'c-b0', key: 'p-b' },
      { id: 'c-a0', key: 'p-a' },
    ]
    const forward = steer(history, chores)
    const backward = steer([...history].reverse(), chores)
    expect(forward.map((s) => s.choreId)).toEqual(['c-a0', 'c-b0'])
    expect(backward).toEqual(forward)
  })

  it('refuses to run without a week', () => {
    expect(() => steeringFor({ history: [], chores: [], periodStart: null })).toThrow(/particular week/)
  })
})
