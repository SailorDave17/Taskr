import { describe, expect, it } from 'vitest'
import { planReassignment } from './reassign.js'

// #431 — the re-deal that runs just BEFORE a member leaves, with them left out
// (owner decision: once they have left, their app can no longer run it).
//
// Its own file rather than a block in reassign.test.js, which is long already;
// the helpers are that file's, restated. Expected values are HAND-COMPUTED from
// the placement rule, the house rule reassign.test.js states. Ids are lowercase
// on purpose (#19).

function row(id, minutes, { holder = null, source = null, done = false } = {}) {
  return {
    id,
    expected_minutes: minutes,
    assigned_member_id: holder,
    assigned_source: source,
    completed_at: done ? '2026-08-26T12:00:00Z' : null,
    missed_at: null,
    actual_minutes: null,
  }
}

const monday = '2026-08-24'
const members = [
  { id: 'm-alex', weekly_minutes: 100 },
  { id: 'm-robin', weekly_minutes: 100 },
  { id: 'm-sam', weekly_minutes: 100 },
]

function plan(chores, leavingMemberId) {
  return planReassignment({ members, chores, exclusions: [], overrides: [], periodStart: monday, leavingMemberId })
}

const holders = (placements) => new Map(placements.map((p) => [p.chore_id, p.member_id]))

describe('planReassignment — a member leaving (#431)', () => {
  it('deals the leaver’s open auto chores to the others and nothing to the leaver', () => {
    // sam holds both; with sam leaving, alex and robin share 100 min of capacity
    // each. c1 (60) → the tie between two empty members goes to the lowest id,
    // m-alex; c2 (40) → robin, who is at 0 against alex's 0.6.
    const chores = [row('c1', 60, { holder: 'm-sam', source: 'auto' }), row('c2', 40, { holder: 'm-sam', source: 'auto' })]
    const { placements } = plan(chores, 'm-sam')
    expect(holders(placements)).toEqual(new Map([['c1', 'm-alex'], ['c2', 'm-robin']]))
  })

  it('gives the leaver no incumbency: a stable run would have kept their chore on them', () => {
    // POSITIVE CONTROL for the no-incumbent half. Without anybody leaving, sam
    // keeps c1 on the stability rule — so the test above is not passing because
    // the planner ignores incumbents anyway.
    const chores = [row('c1', 30, { holder: 'm-sam', source: 'auto' })]
    expect(holders(plan(chores, null).placements).get('c1')).toBe('m-sam')
    expect(holders(plan(chores, 'm-sam').placements).get('c1')).not.toBe('m-sam')
  })

  it('drops the leaver’s finished and hand-placed work instead of pinning it, so the allocator does not throw', () => {
    // A pin to a member the allocator was not given throws "assigned to unknown
    // member" (allocation.js). The hand-placed chore is released by the leave
    // itself — the member row's foreign key sets its holder to null — so it is
    // not in the placements here, and the finished one is history.
    const chores = [
      row('c1', 30, { holder: 'm-sam', source: 'manual' }),
      row('c2', 20, { holder: 'm-sam', source: 'auto', done: true }),
      row('c3', 10, { holder: 'm-sam', source: 'auto' }),
    ]
    const { placements } = plan(chores, 'm-sam')
    expect(placements.map((p) => p.chore_id)).toEqual(['c3'])
  })

  it('POSITIVE CONTROL: the same hand-placed chore with nobody leaving is pinned, not dealt', () => {
    const chores = [row('c1', 30, { holder: 'm-sam', source: 'manual' }), row('c3', 10)]
    expect(plan(chores, null).placements.map((p) => p.chore_id)).toEqual(['c3'])
  })

  it('changes nothing about anybody else’s chores that a plain re-deal would not', () => {
    const chores = [row('c1', 30, { holder: 'm-alex', source: 'manual' }), row('c2', 20, { holder: 'm-robin', source: 'auto' })]
    expect(plan(chores, 'm-sam').placements).toEqual(plan(chores, null).placements)
  })
})
