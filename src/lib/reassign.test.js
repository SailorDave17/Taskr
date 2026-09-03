import { describe, expect, it } from 'vitest'
import { allocate, CHANGE_BUDGET_MINUTES } from './allocation.js'
import { planReassignment } from './reassign.js'

// The PURE half of #49 — the planner that maps rows to the allocator and the
// allocator's answer to the apply payload. Everything here is fixtures; the
// database half (the RPC, the version CAS, the grants) is
// src/test/reassignment.pglite.test.js, and the read/apply/retry orchestration
// is reassign.io.test.js. Same three-level division every data module has.
//
// The expected values are HAND-COMPUTED from the placement rule, not derived by
// calling the allocator in the test — a test that re-derives its expectation
// from the module under test agrees with it by construction. Where a test's
// whole point IS agreement (the wiring-adds-no-logic identity), it says so.
//
// Ids are lowercase on purpose (#19): the fixture vocabulary scan treats any
// capital-first word as a name candidate.

/** A raw chores row as the client reads it, with only what matters varied. */
function row(
  id,
  minutes,
  { holder = null, source = null, done = false, missed = false, actual = null } = {},
) {
  return {
    id,
    expected_minutes: minutes,
    assigned_member_id: holder,
    assigned_source: source,
    completed_at: done ? '2026-08-26T12:00:00Z' : null,
    // #305's third state; 0027's constraint forbids both stamps, so a fixture
    // never sets both either.
    missed_at: missed ? '2026-08-27T09:00:00Z' : null,
    actual_minutes: actual,
  }
}

const monday = '2026-08-24'

function plan({ members, chores, exclusions = [], overrides = [] }) {
  return planReassignment({ members, chores, exclusions, overrides, periodStart: monday })
}

function placementMap(placements) {
  return new Map(placements.map((p) => [p.chore_id, p.member_id]))
}

describe('planReassignment — input mapping', () => {
  it('assigns every open chore with an eligible member, and only those (AC 1)', () => {
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 100 },
    ]
    const chores = [row('c1', 120), row('c2', 60), row('c3', 30)]

    const { placements } = plan({ members, chores })

    // Largest first: c1 (120) → alex ((0+120)/300=0.4 vs (0+120)/100=1.2);
    // c2 (60) → alex would sit at 0.6, robin at 0.6 — a tie, no incumbent, so
    // the lowest member id among the tied takes it: m-alex. c3 (30) → robin
    // ((180+30)/300=0.7 vs (0+30)/100=0.3).
    expect(placementMap(placements)).toEqual(
      new Map([
        ['c1', 'm-alex'],
        ['c2', 'm-alex'],
        ['c3', 'm-robin'],
      ]),
    )
  })

  it('pins a manual chore where it is and counts its minutes (AC 4)', () => {
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 300 },
    ]
    const chores = [
      row('c-manual', 200, { holder: 'm-alex', source: 'manual' }),
      row('c-f1', 100),
      row('c-f2', 100),
    ]

    const { placements } = plan({ members, chores })

    // The manual chore is NOT in the payload — the RPC refuses to touch a
    // manual row, and not naming it is what keeps the apply strict.
    expect(placementMap(placements).has('c-manual')).toBe(false)
    // Its 200 minutes count against alex, so both free chores land on robin —
    // an allocator that dropped the pin would have split them one each.
    expect(placementMap(placements)).toEqual(
      new Map([
        ['c-f1', 'm-robin'],
        ['c-f2', 'm-robin'],
      ]),
    )
  })

  it('counts a done chore against its holder at what it actually took', () => {
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 300 },
    ]
    const chores = [
      // Estimated at 50, actually took 200 — the actual is what loads alex.
      row('c-done', 50, { holder: 'm-alex', source: 'auto', done: true, actual: 200 }),
      // Done work nobody holds is history: it must not inflate anybody's share.
      row('c-orphan', 500, { done: true }),
      row('c-f1', 100),
      row('c-f2', 100),
    ]

    const { placements } = plan({ members, chores })

    // Done rows never appear in the payload (they are pins), and both open
    // chores go to robin because alex already carries 200 real minutes.
    expect(placementMap(placements)).toEqual(
      new Map([
        ['c-f1', 'm-robin'],
        ['c-f2', 'm-robin'],
      ]),
    )
  })

  it('drops a MISSED chore whoever holds it — neither pinned as done nor freed as open (#306)', () => {
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 300 },
    ]
    const chores = [
      // A superseded occurrence that kept its holder (0028 leaves the
      // assignment on the row as a record). Until #306 this fell into the done
      // branch and pinned 200 phantom minutes on alex, so both open chores
      // went to robin; the fact is that alex carries nothing.
      row('c-missed', 200, { holder: 'm-alex', source: 'auto', missed: true }),
      row('c-f1', 100),
      row('c-f2', 100),
    ]

    const placed = placementMap(plan({ members, chores }).placements)

    // The missed row is in no payload — not a pin, not a placement.
    expect(placed.has('c-missed')).toBe(false)
    // And nobody was charged for it: the two open chores split one each,
    // where the phantom pin sent both to robin.
    expect(placed.size).toBe(2)
    expect(new Set(placed.values())).toEqual(new Set(['m-alex', 'm-robin']))
  })

  it('treats an open assigned row without a manual mark as an incumbent, not a pin', () => {
    const members = [{ id: 'm-alex', weekly_minutes: 300 }]
    // Source null with a holder — the pre-0018 shape. It must be FREED (it
    // appears in the payload), not pinned (absent from it): pinning it would
    // fossilise every pre-backfill assignment forever.
    const chores = [row('c1', 60, { holder: 'm-alex', source: null })]

    const { placements } = plan({ members, chores })
    expect(placementMap(placements)).toEqual(new Map([['c1', 'm-alex']]))
  })

  it('leaves a chore nobody is eligible for unassigned without erroring (AC 5)', () => {
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 100 },
    ]
    const chores = [row('c-blocked', 60, { holder: 'm-alex', source: 'auto' }), row('c-ok', 30)]
    const exclusions = [
      { chore_id: 'c-blocked', member_id: 'm-alex' },
      { chore_id: 'c-blocked', member_id: 'm-robin' },
    ]

    const { placements } = plan({ members, chores, exclusions })

    // Explicitly null — the flagged unassigned state — and the eligible chore
    // is still placed, so one impossible chore does not sink the run. It lands
    // on alex: 30/300 = 0.1 against robin's 30/100 = 0.3.
    expect(placementMap(placements).get('c-blocked')).toBe(null)
    expect(placementMap(placements).get('c-ok')).toBe('m-alex')
  })

  it('resolves capacity through this week’s override, and only this week’s', () => {
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 300 },
    ]
    const chores = [row('c1', 100)]
    // Alex has no time THIS week; the stale row for another week must not win.
    const overrides = [
      { member_id: 'm-alex', period_start: monday, minutes: 0 },
      { member_id: 'm-alex', period_start: '2026-08-17', minutes: 300 },
    ]

    const { placements } = plan({ members, chores, overrides })
    expect(placementMap(placements)).toEqual(new Map([['c1', 'm-robin']]))
  })
})

describe('planReassignment — stability (AC 3)', () => {
  // Two members with identical capacity, two identical chores, each held by
  // the OPPOSITE member from what the deterministic tie-break would pick.
  // An unstabilised run swaps both; the stability rule keeps both.
  const members = [
    { id: 'm-alex', weekly_minutes: 100 },
    { id: 'm-robin', weekly_minutes: 100 },
  ]
  const chores = [
    row('c1', 30, { holder: 'm-robin', source: 'auto' }),
    row('c2', 30, { holder: 'm-alex', source: 'auto' }),
  ]

  it('keeps the incumbent on a tie, where an unstabilised run would reshuffle', () => {
    const { placements, verdict } = plan({ members, chores })

    expect(placementMap(placements)).toEqual(
      new Map([
        ['c1', 'm-robin'],
        ['c2', 'm-alex'],
      ]),
    )
    expect(verdict.jobsMoved).toBe(0)
    expect(verdict.minutesMoved).toBe(0)

    // The fixture's own control: the unstabilised allocator really would have
    // produced something different, or this test would pass against a planner
    // that ignored `previous` entirely.
    const unstabilised = allocate({
      members: members.map((m) => ({ id: m.id, capacityMinutes: m.weekly_minutes })),
      chores: chores.map((c) => ({ id: c.id, expectedMinutes: c.expected_minutes })),
    })
    const freely = new Map(unstabilised.assignments.map((a) => [a.choreId, a.memberId]))
    expect(freely).toEqual(
      new Map([
        ['c1', 'm-alex'],
        ['c2', 'm-robin'],
      ]),
    )
  })

  it('lets the change budget refuse an expensive move and says so (AC 7)', () => {
    // Robin's week collapses to 30 minutes, so levelness wants their 130-minute
    // chore moved to alex — but 130 > CHANGE_BUDGET_MINUTES, so it stays and
    // the verdict carries the reason.
    const budgetMembers = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 300 },
    ]
    const budgetChores = [row('c-big', 130, { holder: 'm-robin', source: 'auto' })]
    const overrides = [{ member_id: 'm-robin', period_start: monday, minutes: 30 }]

    const { placements, verdict } = plan({ members: budgetMembers, chores: budgetChores, overrides })

    expect(placementMap(placements)).toEqual(new Map([['c-big', 'm-robin']]))
    expect(verdict.boundByBudget).toBe(true)
    expect(verdict.changeBudgetMinutes).toBe(CHANGE_BUDGET_MINUTES)

    // Control for the control: with no budget concern (chore under the budget)
    // the same shape moves, so the refusal above really was the budget.
    const smallChores = [row('c-small', 100, { holder: 'm-robin', source: 'auto' })]
    const moved = plan({ members: budgetMembers, chores: smallChores, overrides })
    expect(placementMap(moved.placements)).toEqual(new Map([['c-small', 'm-alex']]))
    expect(moved.verdict.boundByBudget).toBe(false)
    expect(moved.verdict.jobsMoved).toBe(1)
    expect(moved.verdict.minutesMoved).toBe(100)
  })
})

describe('planReassignment — the verdict travels (AC 7)', () => {
  it('carries the unreachable reason the allocator produced, not a recomputation', () => {
    // One indivisible 90-minute chore against a 100-minute and a 20-minute
    // budget: robin's fair share is small and the smallest job dwarfs it, so
    // level is unreachable and the reason names the numbers.
    const members = [
      { id: 'm-alex', weekly_minutes: 100 },
      { id: 'm-robin', weekly_minutes: 20 },
    ]
    const chores = [row('c1', 90)]

    const { verdict } = plan({ members, chores })

    expect(verdict.level).toBe(false)
    expect(verdict.contested).toBe(true)
    expect(verdict.reason).toMatchObject({
      memberId: expect.any(String),
      fairShareMinutes: expect.any(Number),
      smallestJobMinutes: 90,
    })
  })

  it('is the allocator’s own answer — the wiring adds persistence, never logic (AC 1)', () => {
    // The one test whose point IS agreement: the stored shape must be exactly
    // what a direct `reallocate` call returns for the same inputs. The fixture
    // exercises pins, incumbents, exclusions and an unassignable chore at
    // once, so a planner that quietly re-decided anything would disagree
    // somewhere.
    const members = [
      { id: 'm-alex', weekly_minutes: 300 },
      { id: 'm-robin', weekly_minutes: 100 },
      { id: 'm-sam', weekly_minutes: 0 },
    ]
    const chores = [
      row('c-manual', 60, { holder: 'm-robin', source: 'manual' }),
      row('c-auto', 90, { holder: 'm-robin', source: 'auto' }),
      row('c-new', 45),
      row('c-impossible', 30),
      row('c-done', 40, { holder: 'm-alex', source: 'auto', done: true, actual: 70 }),
    ]
    const exclusions = [
      { chore_id: 'c-impossible', member_id: 'm-alex' },
      { chore_id: 'c-impossible', member_id: 'm-robin' },
      { chore_id: 'c-impossible', member_id: 'm-sam' },
    ]

    const { placements, verdict, result } = plan({ members, chores, exclusions })

    const byChore = new Map(result.assignments.map((a) => [a.choreId, a]))
    for (const p of placements) {
      if (p.member_id === null) {
        expect(result.unassignable).toContain(p.chore_id)
      } else {
        expect(byChore.get(p.chore_id)?.memberId).toBe(p.member_id)
        expect(byChore.get(p.chore_id)?.manual).toBe(false)
      }
    }
    // Every non-manual assignment the allocator made is in the payload —
    // nothing dropped on the way to persistence.
    const paid = new Set(placements.map((p) => p.chore_id))
    for (const a of result.assignments) {
      if (!a.manual) expect(paid.has(a.choreId)).toBe(true)
    }
    for (const id of result.unassignable) expect(paid.has(id)).toBe(true)

    // The verdict is the run's own fields, verbatim.
    expect(verdict.level).toBe(result.level)
    expect(verdict.reason).toEqual(result.reason)
    expect(verdict.boundByBudget).toBe(result.boundByBudget)
    expect(verdict.jobsMoved).toBe(result.jobsMoved)
    expect(verdict.minutesMoved).toBe(result.minutesMoved)
  })
})
