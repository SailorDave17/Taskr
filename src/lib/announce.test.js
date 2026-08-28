import { describe, expect, it } from 'vitest'
import { assess } from './allocation.js'
import { announcementFrom, splitSnapshot } from './announce.js'
import { toAllocatorChores } from './chores.js'

// #50 — the announcement's arithmetic, tested where it is pure.
//
// Names are synthetic — see #19. The fixtures build BOTH sides of a diff from
// full row shapes, because the one claim this file exists to hold is AC 4: the
// minutes the statement carries are diffs of the figures `assess` hands the
// bars, produced by the same call, so the sentence and the picture cannot
// disagree. Several tests below therefore derive their expectations from
// `assess` directly rather than from hand-written numbers — a hand-written
// expectation could agree with a broken snapshot by being broken the same way.

/** A chore row as the client reads it — the DB shape, not the allocator's. */
function chore(id, minutes, memberId, { done = false, actual = null } = {}) {
  return {
    id,
    expected_minutes: minutes,
    actual_minutes: actual,
    assigned_member_id: memberId,
    completed_at: done ? '2026-08-27T10:00:00Z' : null,
  }
}

const capacities = (entries) => entries.map(([id, capacityMinutes]) => ({ id, capacityMinutes }))

const REBALANCE = {
  applied_at: '2026-08-27T18:00:00+00:00',
  contested: true,
  level: true,
  reason: null,
  boundByBudget: false,
  jobsMoved: 1,
  minutesMoved: 30,
  changeBudgetMinutes: 120,
}

describe('splitSnapshot — what a member is shown, in the storable shape', () => {
  it('carries one entry per member, zero-capacity members included', () => {
    const snap = splitSnapshot({
      capacities: capacities([
        ['m1', 300],
        ['m2', 0],
      ]),
      chores: [chore('c1', 60, 'm1'), chore('c2', 45, 'm2')],
    })
    expect(snap.members).toEqual([
      { id: 'm1', minutes: 60, capacityMinutes: 300 },
      // Held out of the split, still holding work — exactly the person a
      // re-balance moves work OFF, so leaving them out of the snapshot would
      // blind the statement to the most important move.
      { id: 'm2', minutes: 45, capacityMinutes: 0 },
    ])
  })

  it('AC 4: the minutes are the figures assess hands the bars — same call, same numbers', () => {
    const caps = capacities([
      ['m1', 300],
      ['m2', 60],
    ])
    const rows = [
      chore('c1', 60, 'm1'),
      chore('c2', 20, 'm1', { done: true, actual: 35 }),
      chore('c3', 45, 'm2'),
    ]
    const snap = splitSnapshot({ capacities: caps, chores: rows })

    // Derived independently through the bars' own arithmetic, not hand-written:
    // done work at its ACTUAL minutes, open work at its estimate.
    const picture = assess({ members: caps, chores: toAllocatorChores(rows) })
    for (const entry of picture.load) {
      expect(snap.members.find((m) => m.id === entry.memberId).minutes).toBe(
        entry.assignedMinutes,
      )
    }
    expect(snap.members.find((m) => m.id === 'm1').minutes).toBe(95)
  })
})

describe('announcementFrom — when a member is owed a statement', () => {
  const before = splitSnapshot({
    capacities: capacities([
      ['m1', 300],
      ['m2', 300],
    ]),
    chores: [chore('c1', 30, 'm1'), chore('c2', 50, 'm2')],
  })
  // c1 moved m1 → m2; nothing else changed.
  const after = splitSnapshot({
    capacities: capacities([
      ['m1', 150],
      ['m2', 300],
    ]),
    chores: [chore('c1', 30, 'm2'), chore('c2', 50, 'm2')],
  })
  const seenBefore = { snapshot: before, seen_rebalance_at: '2026-08-27T09:00:00+00:00' }

  it('announces a move this member has not seen, as per-member minute deltas', () => {
    const news = announcementFrom({ seen: seenBefore, current: after, lastRebalance: REBALANCE })
    expect(news).not.toBeNull()
    expect(news.moves).toEqual([
      { memberId: 'm1', minutes: -30 },
      { memberId: 'm2', minutes: 30 },
    ])
    expect(news.capacityChanges).toEqual([{ memberId: 'm1', minutes: -150 }])
  })

  it('AC 6: the verdict travels from the stored run, never recomputed', () => {
    const news = announcementFrom({ seen: seenBefore, current: after, lastRebalance: REBALANCE })
    // The exact object — reference equality, so there is no second copy that
    // could be edited into disagreeing with what the run recorded.
    expect(news.verdict).toBe(REBALANCE)
  })

  it('announces nothing when no re-balance has ever run', () => {
    expect(announcementFrom({ seen: seenBefore, current: after, lastRebalance: null })).toBeNull()
  })

  it('announces nothing on a first look — a diff against nothing is not an event', () => {
    expect(announcementFrom({ seen: null, current: after, lastRebalance: REBALANCE })).toBeNull()
  })

  it('AC 7: announces nothing when the member has seen this re-balance already', () => {
    const seenAfter = { snapshot: after, seen_rebalance_at: REBALANCE.applied_at }
    expect(
      announcementFrom({ seen: seenAfter, current: after, lastRebalance: REBALANCE }),
    ).toBeNull()
  })

  it('AC 7: ordinary churn since the member saw the last re-balance is not an event', () => {
    // The discriminating case for the marker, deliberately: snapshot and
    // current DIFFER here (chores were added and completed since they looked),
    // so the empty-diff branch cannot be what answers null — only the marker
    // saying "you have seen the latest re-balance" can. The test above, where
    // the snapshots match, is the natural post-show state and is answered by
    // either mechanism; this one is answered by exactly one.
    const churned = splitSnapshot({
      capacities: capacities([
        ['m1', 150],
        ['m2', 300],
      ]),
      chores: [chore('c1', 30, 'm2'), chore('c2', 50, 'm2'), chore('c3', 25, 'm1')],
    })
    expect(
      announcementFrom({
        seen: { snapshot: after, seen_rebalance_at: REBALANCE.applied_at },
        current: churned,
        lastRebalance: REBALANCE,
      }),
    ).toBeNull()
  })

  it('AC 7: two spellings of one instant read as seen, not as a new event', () => {
    // The marker comes back from a timestamptz column and `applied_at` from
    // jsonb text — one moment, two renderings. A string comparison would
    // re-announce the same event forever. The snapshots differ here for the
    // same reason as the test above: only the marker can be what answers null.
    const churned = splitSnapshot({
      capacities: capacities([
        ['m1', 150],
        ['m2', 300],
      ]),
      chores: [chore('c1', 30, 'm2'), chore('c2', 50, 'm2'), chore('c3', 25, 'm1')],
    })
    expect(
      announcementFrom({
        seen: { snapshot: churned, seen_rebalance_at: '2026-08-27T18:00:00Z' },
        current: after,
        lastRebalance: REBALANCE,
      }),
    ).toBeNull()
  })

  it('AC 8: a capacity change that moves no minutes announces nothing', () => {
    // The week shrank, the re-balance ran, and every chore stayed where it
    // was: the bars' minutes are unchanged, so there is no event to
    // manufacture — however new the marker is.
    const capacityOnly = splitSnapshot({
      capacities: capacities([
        ['m1', 150],
        ['m2', 300],
      ]),
      chores: [chore('c1', 30, 'm1'), chore('c2', 50, 'm2')],
    })
    expect(
      announcementFrom({ seen: seenBefore, current: capacityOnly, lastRebalance: REBALANCE }),
    ).toBeNull()
  })

  it('AC 5: a change arriving in two steps is reported as one net move', () => {
    // Step one moved c1 from m1 to m2; step two moved it on to m3. This member
    // saw neither. The statement diffs against what THEY were shown, so m2 —
    // who held the chore for a while and holds nothing of it now — appears
    // nowhere, and the report is one move, m1 to m3.
    const threeBefore = splitSnapshot({
      capacities: capacities([
        ['m1', 300],
        ['m2', 300],
        ['m3', 300],
      ]),
      chores: [chore('c1', 30, 'm1')],
    })
    const threeAfter = splitSnapshot({
      capacities: capacities([
        ['m1', 300],
        ['m2', 300],
        ['m3', 300],
      ]),
      chores: [chore('c1', 30, 'm3')],
    })
    const news = announcementFrom({
      seen: { snapshot: threeBefore, seen_rebalance_at: '2026-08-27T09:00:00Z' },
      current: threeAfter,
      lastRebalance: REBALANCE,
    })
    expect(news.moves).toEqual([
      { memberId: 'm1', minutes: -30 },
      { memberId: 'm3', minutes: 30 },
    ])
  })

  it('AC 5 carried to its endpoint: a move that moved back nets to silence', () => {
    const news = announcementFrom({
      seen: seenBefore,
      current: splitSnapshot({
        capacities: capacities([
          ['m1', 300],
          ['m2', 300],
        ]),
        chores: [chore('c1', 30, 'm1'), chore('c2', 50, 'm2')],
      }),
      lastRebalance: REBALANCE,
    })
    expect(news).toBeNull()
  })

  it('AC 2: two members who last looked at different times receive different statements', () => {
    // The record behind this is per member — `member_split_seen`, one row per
    // member — which is the criterion's point: nothing household-wide could
    // answer for both of these people at once.
    const mid = splitSnapshot({
      capacities: capacities([
        ['m1', 150],
        ['m2', 300],
      ]),
      chores: [chore('c1', 30, 'm2'), chore('c2', 50, 'm2')],
    })
    const laterStill = splitSnapshot({
      capacities: capacities([
        ['m1', 150],
        ['m2', 300],
      ]),
      chores: [chore('c1', 30, 'm2'), chore('c2', 50, 'm1')],
    })

    const forEarlyLooker = announcementFrom({
      seen: { snapshot: before, seen_rebalance_at: '2026-08-27T09:00:00Z' },
      current: laterStill,
      lastRebalance: REBALANCE,
    })
    const forLateLooker = announcementFrom({
      seen: { snapshot: mid, seen_rebalance_at: '2026-08-27T12:00:00Z' },
      current: laterStill,
      lastRebalance: REBALANCE,
    })

    // The early looker is told the net of both steps; the late looker only
    // what happened after their look — different baselines, different facts.
    expect(forEarlyLooker.moves).toEqual([
      { memberId: 'm1', minutes: 20 },
      { memberId: 'm2', minutes: -20 },
    ])
    expect(forLateLooker.moves).toEqual([
      { memberId: 'm1', minutes: 50 },
      { memberId: 'm2', minutes: -50 },
    ])
    expect(forEarlyLooker.moves).not.toEqual(forLateLooker.moves)
  })

  it('a member the roster no longer names still has their minutes accounted for', () => {
    const withThree = splitSnapshot({
      capacities: capacities([
        ['m1', 300],
        ['m2', 300],
        ['m3', 120],
      ]),
      chores: [chore('c1', 40, 'm3')],
    })
    const withTwo = splitSnapshot({
      capacities: capacities([
        ['m1', 300],
        ['m2', 300],
      ]),
      chores: [chore('c1', 40, 'm1')],
    })
    const news = announcementFrom({
      seen: { snapshot: withThree, seen_rebalance_at: '2026-08-27T09:00:00Z' },
      current: withTwo,
      lastRebalance: REBALANCE,
    })
    expect(news.moves).toEqual([
      { memberId: 'm1', minutes: 40 },
      { memberId: 'm3', minutes: -40 },
    ])
  })
})
