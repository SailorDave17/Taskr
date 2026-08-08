// The scenario corpus — #40 AC 2.
//
// Thirteen household shapes, and EVERY expected outcome below was worked out by
// hand before the module was run against it. That is the criterion, and it is
// not ceremony: a corpus whose expectations were produced by calling the code
// under test asserts only that the code still does what it did, which is the
// one thing a regression suite gets for free and the one thing a fairness
// claim cannot rest on. The same goes for deriving the expected column by
// filtering the fixture's own expected column — that is the same circle with a
// longer radius.
//
// What is asserted per scenario is minutes and chore-count per member, the
// levelness verdict, and the reason. Deliberately NOT the chore-to-member map:
// which of two identical 30-minute chores lands on which person is tie-break
// trivia, not a product property, and pinning it here would make every future
// tie-break change look like a fairness regression. The property that DOES
// matter about ordering — that the same household in a different input order
// gives a byte-identical answer — is AC 6, and it is tested by comparing two
// runs rather than by writing a map down.
//
// `level` counts are reported by `npm run allocation:corpus`. Read
// docs/allocation-corpus.md for the recorded figure; the command re-derives it.

/**
 * Every scenario. `expect.load` is keyed by member id: `[minutes, choreCount]`.
 *
 * `workingMembers` is stated per scenario rather than counted from `load`,
 * because whether levelness was a real question in this shape is exactly what
 * the report must not infer from the answer it is reporting on.
 */
export const SCENARIOS = [
  {
    name: 'flagship: one kid, one parent, six identical chores',
    why:
      'AC 3. 60 and 300 minutes of capacity, 180 minutes of work — exactly half of ' +
      'the household total, so both land on 50% of their own capacity. Five chores ' +
      'against one, which is the whole thesis: equal shares are not equal counts.',
    workingMembers: 2,
    members: [
      { id: 'kid', capacityMinutes: 60 },
      { id: 'parent', capacityMinutes: 300 },
    ],
    chores: [30, 30, 30, 30, 30, 30].map((m, i) => ({ id: `c${i + 1}`, expectedMinutes: m })),
    expect: {
      load: { kid: [30, 1], parent: [150, 5] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'granularity floor: a 25-minute budget against a 10-minute smallest job',
    why:
      'AC 4, and the case the flagship cannot discriminate. 190 minutes over 275 of ' +
      'capacity puts the household at ~69%; Ava should carry 17 minutes and the ' +
      'smallest job on the list is 10, so she lands on 40% or 80% and neither is ' +
      'near 69%. No arrangement fixes it — this is the irreducible floor the ' +
      'prototype measured, and an allocator reporting level here is lying.',
    workingMembers: 3,
    members: [
      { id: 'ava', capacityMinutes: 25 },
      { id: 'nora', capacityMinutes: 100 },
      { id: 'sam', capacityMinutes: 150 },
    ],
    chores: [40, 35, 30, 30, 25, 20, 10].map((m, i) => ({ id: `j${i + 1}`, expectedMinutes: m })),
    expect: {
      load: { ava: [10, 1], nora: [65, 2], sam: [115, 4] },
      level: false,
      reason: { memberId: 'ava', fairShareMinutes: 17, smallestJobMinutes: 10 },
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'roomy: every capacity comfortably exceeds the largest chore',
    why:
      'AC 5. 150 minutes of work over 900 of capacity, largest job 30 against ' +
      'budgets of 300 — nothing is indivisible at this scale, so the split is exact ' +
      'and NO unreachable message may appear. A notice that fires on a healthy ' +
      'household is an absent notice.',
    workingMembers: 3,
    members: [
      { id: 'm1', capacityMinutes: 300 },
      { id: 'm2', capacityMinutes: 300 },
      { id: 'm3', capacityMinutes: 300 },
    ],
    chores: [30, 30, 30, 20, 20, 20].map((m, i) => ({ id: `r${i + 1}`, expectedMinutes: m })),
    expect: {
      load: { m1: [50, 2], m2: [50, 2], m3: [50, 2] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'a household of one',
    why:
      'One person cannot be uneven with themselves. Level is true because the ' +
      'spread of a one-element set is zero, not because a special case waves it ' +
      'through — and no reason may be attached to it.',
    workingMembers: 1,
    members: [{ id: 'solo', capacityMinutes: 120 }],
    chores: [
      { id: 's1', expectedMinutes: 30 },
      { id: 's2', expectedMinutes: 45 },
    ],
    expect: {
      load: { solo: [75, 2] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'nothing to do',
    why:
      'A week with no chores. Everyone at zero is level, and the fair share is ' +
      'zero rather than NaN — the figure ends up in a sentence a person reads.',
    workingMembers: 2,
    members: [
      { id: 'a', capacityMinutes: 100 },
      { id: 'b', capacityMinutes: 50 },
    ],
    chores: [],
    expect: {
      load: { a: [0, 0], b: [0, 0] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'nobody in the household yet',
    why:
      'Chores exist and no member does. Every chore comes back flagged rather than ' +
      'thrown away or thrown over — this is the state between creating a household ' +
      'and adding anyone to it, and it must not be an error.',
    workingMembers: 0,
    members: [],
    chores: [
      { id: 'x1', expectedMinutes: 30 },
      { id: 'x2', expectedMinutes: 20 },
    ],
    expect: {
      load: {},
      level: true,
      reason: null,
      unassignable: ['x1', 'x2'],
      noCapacity: [],
    },
  },

  {
    name: 'a member with no minutes this week',
    why:
      'AC 7. Zero capacity is not a small capacity: a share is minutes over ' +
      'capacity, so work given here divides by zero and renders as the most ' +
      'loaded person in the house. They are held out of the split and named.',
    workingMembers: 1,
    members: [
      { id: 'away', capacityMinutes: 0 },
      { id: 'home', capacityMinutes: 100 },
    ],
    chores: [
      { id: 'z1', expectedMinutes: 30 },
      { id: 'z2', expectedMinutes: 20 },
    ],
    expect: {
      load: { home: [50, 2] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: ['away'],
    },
  },

  {
    name: 'a chore one person may not do',
    why:
      'AC 7. Eligibility arrives as a predicate, so the capability model can change ' +
      '— or arrive from #37 — without this module changing. The kid holds the LARGER ' +
      'budget on purpose: MEASURED while proving these tests, the reverse shape ' +
      'passed with the eligibility check deleted, because the parent won the knife ' +
      'on the share rule anyway. The excluded member has to be the one the allocator ' +
      'would otherwise choose. 60 against 40 on budgets of 200 and 120 is 30% and ' +
      '33%, inside tolerance.',
    workingMembers: 2,
    members: [
      { id: 'kid', capacityMinutes: 200 },
      { id: 'parent', capacityMinutes: 120 },
    ],
    chores: [
      { id: 'knife', expectedMinutes: 40 },
      { id: 'a', expectedMinutes: 30 },
      { id: 'b', expectedMinutes: 30 },
    ],
    isEligible: (chore, member) => chore.id !== 'knife' || member.id === 'parent',
    expect: {
      load: { kid: [60, 2], parent: [40, 1] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'a chore nobody may do',
    why:
      'AC 7. The ladder is excluded for everyone. The run completes, the ladder is ' +
      'flagged in its own state rather than dropped, and it is left OUT of the ' +
      'fairness arithmetic — counting work no split can carry would report the ' +
      'whole household underloaded against it.',
    workingMembers: 2,
    members: [
      { id: 'a', capacityMinutes: 100 },
      { id: 'b', capacityMinutes: 100 },
    ],
    chores: [
      { id: 'ladder', expectedMinutes: 30 },
      { id: 'cups', expectedMinutes: 10 },
      { id: 'dishes', expectedMinutes: 10 },
    ],
    isEligible: (chore) => chore.id !== 'ladder',
    expect: {
      load: { a: [10, 1], b: [10, 1] },
      level: true,
      reason: null,
      unassignable: ['ladder'],
      noCapacity: [],
    },
  },

  {
    name: 'a chore a human already placed, and the split absorbs it',
    why:
      'AC 8. The pinned chore stays with the kid and its 30 minutes count against ' +
      'the kid’s 60, so the allocator divides what is LEFT. Same end state as the ' +
      'flagship, reached with a human in the loop.',
    workingMembers: 2,
    members: [
      { id: 'kid', capacityMinutes: 60 },
      { id: 'parent', capacityMinutes: 300 },
    ],
    chores: [
      { id: 'pinned', expectedMinutes: 30, assignedMemberId: 'kid' },
      ...[30, 30, 30, 30, 30].map((m, i) => ({ id: `p${i + 1}`, expectedMinutes: m })),
    ],
    expect: {
      load: { kid: [30, 1], parent: [150, 5] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'a human placement the allocator will not undo, even to reach level',
    why:
      'AC 8 with teeth. Sixty minutes pinned to a sixty-minute budget puts the kid ' +
      'at 100% while the parent sits at 30%, and moving it is the one repair ' +
      'available. The allocator does not take it: a human overrode the model on ' +
      'purpose, and silently reopening that is the negotiation the charter says the ' +
      'product exists to remove.',
    workingMembers: 2,
    members: [
      { id: 'kid', capacityMinutes: 60 },
      { id: 'parent', capacityMinutes: 300 },
    ],
    chores: [
      { id: 'pinned', expectedMinutes: 60, assignedMemberId: 'kid' },
      ...[30, 30, 30].map((m, i) => ({ id: `q${i + 1}`, expectedMinutes: m })),
    ],
    expect: {
      load: { kid: [60, 1], parent: [90, 3] },
      level: false,
      reason: { memberId: 'kid', fairShareMinutes: 25, smallestJobMinutes: 30 },
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'equal budgets, one indivisible job each',
    why:
      'Three identical people and three identical jobs. Level at 70% apiece — the ' +
      'check that a large share is not itself a fairness problem. Level means ' +
      'evenly loaded, not lightly loaded.',
    workingMembers: 3,
    members: [
      { id: 'a', capacityMinutes: 100 },
      { id: 'b', capacityMinutes: 100 },
      { id: 'c', capacityMinutes: 100 },
    ],
    chores: [
      { id: 'j1', expectedMinutes: 70 },
      { id: 'j2', expectedMinutes: 70 },
      { id: 'j3', expectedMinutes: 70 },
    ],
    expect: {
      load: { a: [70, 1], b: [70, 1], c: [70, 1] },
      level: true,
      reason: null,
      unassignable: [],
      noCapacity: [],
    },
  },

  {
    name: 'one job larger than the whole household',
    why:
      'A 500-minute job against 300 minutes of total capacity. It is assignable — ' +
      'somebody has to do it — so it is placed on the largest budget and the verdict ' +
      'is honest about the result rather than refusing to answer. Shares above 100% ' +
      'are meaningful and must not be clamped: 250% is the household being told the ' +
      'truth about its week.',
    workingMembers: 2,
    members: [
      { id: 'a', capacityMinutes: 100 },
      { id: 'b', capacityMinutes: 200 },
    ],
    chores: [
      { id: 'big', expectedMinutes: 500 },
      { id: 'small', expectedMinutes: 20 },
    ],
    expect: {
      load: { a: [20, 1], b: [500, 1] },
      level: false,
      reason: { memberId: 'a', fairShareMinutes: 173, smallestJobMinutes: 20 },
      unassignable: [],
      noCapacity: [],
    },
  },
]
