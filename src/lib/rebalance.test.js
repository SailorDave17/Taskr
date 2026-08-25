import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocate, reallocate, movedBetween, CHANGE_BUDGET_MINUTES } from './allocation.js'
import { SCENARIOS } from './allocation.corpus.js'
import { BUDGETS, busyWeek } from './rebalance.corpus.js'

// #41 - bounding the minutes a re-balance moves.
//
// #40 asked whether the household can be level. This file asks what staying
// stable costs, which is the question the charter says is "the biggest risk to
// the moment": the prototype churned 8-10 of 14 jobs on the first re-balance,
// and fairness that arrives as a shuffled week nobody recognises is not
// fairness anybody accepts.
//
// The corpus arithmetic below is deliberately re-derived here rather than
// imported from scripts/rebalance-churn-report.mjs. A doc-agreement test that
// shares its implementation with the thing it is checking asserts only that one
// function is self-consistent.

/** Re-allocate one corpus scenario after the stated capacity change. */
function rebalanced(scenario, changeBudgetMinutes) {
  const before = allocate({
    members: scenario.members,
    chores: scenario.chores,
    isEligible: scenario.isEligible,
  })
  return {
    before,
    after: reallocate({
      members: busyWeek(scenario.members),
      chores: scenario.chores,
      isEligible: scenario.isEligible,
      previous: before.assignments,
      changeBudgetMinutes,
    }),
  }
}

/** The same scenario re-allocated with NO stability rule - AC 2's baseline. */
function unstabilised(scenario) {
  const before = allocate({
    members: scenario.members,
    chores: scenario.chores,
    isEligible: scenario.isEligible,
  })
  // `allocate` IS the unstabilised allocator - it shipped in #40, before any
  // stability rule existed. Running `reallocate` with the stability switched
  // off would make the control a mode of the thing under test.
  const after = allocate({
    members: busyWeek(scenario.members),
    chores: scenario.chores,
    isEligible: scenario.isEligible,
  })
  const minutes = new Map(scenario.chores.map((chore) => [chore.id, chore.expectedMinutes]))
  const moved = movedBetween(before.assignments, after.assignments)
  return {
    before,
    after,
    moved,
    jobsMoved: moved.length,
    minutesMoved: moved.reduce((sum, id) => sum + minutes.get(id), 0),
  }
}

/** The label the recorded table uses for one budget setting. */
function budgetLabel(changeBudgetMinutes) {
  return changeBudgetMinutes === Infinity ? 'unbounded' : `${changeBudgetMinutes} minutes`
}

/** Totals for one arm over the whole corpus. */
function corpusTotals(run) {
  let jobsMoved = 0
  let minutesMoved = 0
  let movableJobs = 0
  let level = 0
  let contested = 0
  let bound = 0
  for (const scenario of SCENARIOS) {
    const result = run(scenario)
    jobsMoved += result.jobsMoved
    minutesMoved += result.minutesMoved
    movableJobs += result.before.assignments.length
    if (scenario.workingMembers >= 2) {
      contested += 1
      if (result.after.level) level += 1
    }
    if (result.after.boundByBudget) bound += 1
  }
  return { jobsMoved, minutesMoved, movableJobs, level, contested, bound }
}


describe('AC 1 - the churn figures are a DIFF of two allocations', () => {
  const members = [
    { id: 'a', capacityMinutes: 100 },
    { id: 'b', capacityMinutes: 100 },
  ]
  const chores = [
    { id: 'j1', expectedMinutes: 40 },
    { id: 'j2', expectedMinutes: 40 },
  ]

  it('returns the new allocation together with the minutes and the jobs moved', () => {
    const result = reallocate({
      members,
      chores,
      previous: [
        { choreId: 'j1', memberId: 'a' },
        { choreId: 'j2', memberId: 'a' },
      ],
      changeBudgetMinutes: 120,
    })

    expect(result.assignments).toHaveLength(2)
    expect(result.jobsMoved).toBe(1)
    expect(result.minutesMoved).toBe(40)
    expect(result.moved).toEqual(['j2'])
    // The allocation itself is a whole allocation, not a delta - everything
    // #40's verdict carries is still here.
    expect(result.level).toBe(true)
    expect(result.load).toHaveLength(2)
    expect(result.contested).toBe(true)
  })

  it('reports NOTHING moved when nothing changed hands', () => {
    const previous = [
      { choreId: 'j1', memberId: 'a' },
      { choreId: 'j2', memberId: 'b' },
    ]
    const result = reallocate({ members, chores, previous, changeBudgetMinutes: 120 })
    expect(result.jobsMoved).toBe(0)
    expect(result.minutesMoved).toBe(0)
    expect(result.moved).toEqual([])
  })

  // The discriminating fixture. A counter that charges the budget and a diff of
  // the two allocations are not the same number, and this is a case where they
  // disagree: c leaves the household, so c's chore MUST be redistributed. That
  // movement is not discretionary, the budget is never consulted for it, and
  // the internal counter therefore reads ZERO - while the household watches a
  // job change hands. Reporting the counter here would tell them nothing moved
  // on the week their list moved most.
  it('counts a FORCED move, which the budget counter cannot see', () => {
    const result = reallocate({
      members: [
        { id: 'a', capacityMinutes: 100 },
        { id: 'b', capacityMinutes: 100 },
      ],
      chores: [
        { id: 'j1', expectedMinutes: 30 },
        { id: 'j2', expectedMinutes: 30 },
        { id: 'j3', expectedMinutes: 30 },
      ],
      previous: [
        { choreId: 'j1', memberId: 'a' },
        { choreId: 'j2', memberId: 'b' },
        { choreId: 'j3', memberId: 'c' },
      ],
      // ZERO. Nothing discretionary may move, so anything the diff reports is
      // movement the counter did not authorise and could not have counted.
      changeBudgetMinutes: 0,
    })

    expect(result.jobsMoved).toBe(1)
    expect(result.minutesMoved).toBe(30)
    expect(result.moved).toEqual(['j3'])
    // And it was NOT charged, so the budget did not bind: a forced move is not
    // a move the budget is entitled to refuse.
    expect(result.boundByBudget).toBe(false)
  })

  it('POSITIVE CONTROL: with c still in the household that job does not move', () => {
    // Without this, the case above passes for a re-allocator that moves things
    // at random - the assertion would be about churn existing, not about a
    // departure causing it.
    const result = reallocate({
      members: [
        { id: 'a', capacityMinutes: 100 },
        { id: 'b', capacityMinutes: 100 },
        { id: 'c', capacityMinutes: 100 },
      ],
      chores: [
        { id: 'j1', expectedMinutes: 30 },
        { id: 'j2', expectedMinutes: 30 },
        { id: 'j3', expectedMinutes: 30 },
      ],
      previous: [
        { choreId: 'j1', memberId: 'a' },
        { choreId: 'j2', memberId: 'b' },
        { choreId: 'j3', memberId: 'c' },
      ],
      changeBudgetMinutes: 0,
    })
    expect(result.jobsMoved).toBe(0)
  })
})

describe('movedBetween - what counts as a job having moved', () => {
  it('is a chore held in BOTH allocations by different people', () => {
    expect(
      movedBetween(
        [{ choreId: 'x', memberId: 'a' }],
        [{ choreId: 'x', memberId: 'b' }],
      ),
    ).toEqual(['x'])
  })

  it('is not new work, which had no previous holder to be taken from', () => {
    expect(movedBetween([], [{ choreId: 'x', memberId: 'b' }])).toEqual([])
  })

  it('is not work that became impossible, which moved nowhere', () => {
    expect(movedBetween([{ choreId: 'x', memberId: 'a' }], [])).toEqual([])
  })

  it('is stable in order, so two runs produce the same list', () => {
    const moved = movedBetween(
      [
        { choreId: 'z', memberId: 'a' },
        { choreId: 'y', memberId: 'a' },
      ],
      [
        { choreId: 'z', memberId: 'b' },
        { choreId: 'y', memberId: 'b' },
      ],
    )
    expect(moved).toEqual(['y', 'z'])
  })
})


describe('AC 3 - a tie goes to whoever holds it, and to a stable key otherwise', () => {
  // The fixture the criterion asks for: one where incumbency and the
  // unstabilised result DIFFER. Two equal budgets and one job, so both members
  // would end on exactly the same share - the tie is real, not an artefact of
  // rounding, and the unstabilised allocator resolves it by member id.
  const members = [
    { id: 'a', capacityMinutes: 100 },
    { id: 'b', capacityMinutes: 100 },
  ]
  const chores = [{ id: 'job', expectedMinutes: 50 }]

  it('POSITIVE CONTROL: unstabilised, this tie goes to `a` - so the fixture discriminates', () => {
    const holder = allocate({ members, chores }).assignments[0].memberId
    expect(holder).toBe('a')
  })

  it('leaves the chore with its current holder when the two are tied', () => {
    const result = reallocate({
      members,
      chores,
      previous: [{ choreId: 'job', memberId: 'b' }],
      changeBudgetMinutes: 120,
    })
    expect(result.assignments[0].memberId).toBe('b')
    expect(result.jobsMoved).toBe(0)
    expect(result.minutesMoved).toBe(0)
  })

  it('costs nothing in levelness - a tie is a tie, whoever wins it', () => {
    const stabilised = reallocate({
      members,
      chores,
      previous: [{ choreId: 'job', memberId: 'b' }],
      changeBudgetMinutes: 120,
    })
    const plain = allocate({ members, chores })
    expect(stabilised.spread).toBe(plain.spread)
    expect(stabilised.level).toBe(plain.level)
  })

  it('falls to a stable deterministic key when nobody holds it', () => {
    const result = reallocate({ members, chores, previous: [], changeBudgetMinutes: 120 })
    expect(result.assignments[0].memberId).toBe('a')
  })

  it('and that key is not the order the members arrived in', () => {
    const forwards = reallocate({ members, chores, previous: [], changeBudgetMinutes: 120 })
    const backwards = reallocate({
      members: [...members].reverse(),
      chores,
      previous: [],
      changeBudgetMinutes: 120,
    })
    expect(backwards.assignments).toEqual(forwards.assignments)
  })

  it('breaks ONLY ties - incumbency never buys a worse split', () => {
    // `b` holds the job and is now the more loaded of the two, so keeping it
    // there is strictly worse. Incumbency is looked up among the TIED, so it
    // has no say here and the chore moves.
    const result = reallocate({
      members: [
        { id: 'a', capacityMinutes: 100 },
        { id: 'b', capacityMinutes: 50 },
      ],
      chores,
      previous: [{ choreId: 'job', memberId: 'b' }],
      changeBudgetMinutes: 120,
    })
    expect(result.assignments[0].memberId).toBe('a')
    expect(result.jobsMoved).toBe(1)
  })
})

describe('AC 4 - the change budget, asserted at exactly the boundary', () => {
  // One discretionary move of exactly 40 minutes is available: `a` holds both
  // jobs, and moving the second to `b` is what reaches level. So 40 is the
  // boundary, and it is a boundary the fixture makes exact rather than
  // approximate.
  const members = [
    { id: 'a', capacityMinutes: 100 },
    { id: 'b', capacityMinutes: 100 },
  ]
  const chores = [
    { id: 'j1', expectedMinutes: 40 },
    { id: 'j2', expectedMinutes: 40 },
  ]
  const previous = [
    { choreId: 'j1', memberId: 'a' },
    { choreId: 'j2', memberId: 'a' },
  ]

  const at = (changeBudgetMinutes) =>
    reallocate({ members, chores, previous, changeBudgetMinutes })

  it('AT the boundary the move happens, and the budget did not bind', () => {
    const result = at(40)
    expect(result.minutesMoved).toBe(40)
    expect(result.jobsMoved).toBe(1)
    expect(result.boundByBudget).toBe(false)
    expect(result.level).toBe(true)
  })

  it('ONE MINUTE BELOW it the move is refused, and the budget bound the result', () => {
    const result = at(39)
    expect(result.minutesMoved).toBe(0)
    expect(result.jobsMoved).toBe(0)
    expect(result.boundByBudget).toBe(true)
  })

  it('and when the budget bound it, the verdict does NOT report level', () => {
    // The criterion in as many words: "never reporting level". Level was
    // reachable and the budget is what stopped it, so a verdict of level here
    // would be the allocator claiming an outcome it declined to produce.
    const result = at(39)
    expect(result.level).toBe(false)
  })

  it('reports the levelness REACHED alongside the fact that the budget bound it', () => {
    const result = at(39)
    // Both halves, on the same object: how level it got, and why it stopped.
    expect(result.spread).toBeCloseTo(0.8, 10)
    expect(result.boundByBudget).toBe(true)
    expect(result.reason).not.toBeNull()
  })

  it('a budget of zero moves nothing discretionary at all', () => {
    const result = at(0)
    expect(result.minutesMoved).toBe(0)
    expect(result.boundByBudget).toBe(true)
  })

  it('an unbounded budget never binds', () => {
    const result = at(Infinity)
    expect(result.minutesMoved).toBe(40)
    expect(result.boundByBudget).toBe(false)
  })

  it('is a named tunable constant, and the default is the one that was measured', () => {
    expect(CHANGE_BUDGET_MINUTES).toBe(120)
    // The default is what a caller gets without asking, so it has to be the
    // constant rather than a literal buried in the signature.
    const bare = reallocate({ members, chores, previous })
    expect(bare.changeBudgetMinutes).toBe(CHANGE_BUDGET_MINUTES)
  })
})


describe('AC 6 - a manual placement does not move, at any size of change', () => {
  // Sixty minutes pinned to a sixty-minute budget. Moving it is the only repair
  // available, which is exactly why it is the fixture: an allocator that would
  // ever undo a pin would undo this one.
  const chores = [
    { id: 'pinned', expectedMinutes: 60, assignedMemberId: 'kid' },
    { id: 'q1', expectedMinutes: 30 },
    { id: 'q2', expectedMinutes: 30 },
    { id: 'q3', expectedMinutes: 30 },
  ]
  const original = [
    { id: 'kid', capacityMinutes: 60 },
    { id: 'parent', capacityMinutes: 300 },
  ]
  const previous = allocate({ members: original, chores }).assignments

  for (const parentMinutes of [300, 240, 150, 90, 60, 30, 1]) {
    it(`holds the pin when the parent's week drops to ${parentMinutes} minutes`, () => {
      const result = reallocate({
        members: [
          { id: 'kid', capacityMinutes: 60 },
          { id: 'parent', capacityMinutes: parentMinutes },
        ],
        chores,
        previous,
        changeBudgetMinutes: Infinity,
      })
      const pin = result.assignments.find((a) => a.choreId === 'pinned')
      expect(pin.memberId).toBe('kid')
      expect(pin.manual).toBe(true)
      expect(result.moved).not.toContain('pinned')
    })
  }

  it('holds it even when the kid loses every minute of capacity', () => {
    // A human overrode the model on purpose. Zero capacity does not reopen that.
    const result = reallocate({
      members: [
        { id: 'kid', capacityMinutes: 0 },
        { id: 'parent', capacityMinutes: 300 },
      ],
      chores,
      previous,
      changeBudgetMinutes: Infinity,
    })
    expect(result.assignments.find((a) => a.choreId === 'pinned').memberId).toBe('kid')
  })

  it('reports the off-level minutes the pin causes rather than hiding them', () => {
    // The honest half. The pin puts the kid over their share and the verdict
    // says so, in minutes, naming them - it does not quietly report level and
    // it does not quietly override the pin to make the number look better.
    const result = reallocate({
      members: original,
      chores,
      previous,
      changeBudgetMinutes: Infinity,
    })
    expect(result.level).toBe(false)
    expect(result.offLevel).not.toBeNull()
    expect(result.offLevel.memberId).toBe('kid')
    expect(result.offLevel.minutes).toBeGreaterThan(0)
    expect(result.reason.memberId).toBe('kid')
  })

  it('POSITIVE CONTROL: without the pin the same household IS level', () => {
    // Otherwise "not level" above could be a property of the numbers rather
    // than of the pin, and the criterion would be asserting nothing about pins.
    const unpinned = chores.map((chore) => ({
      id: chore.id,
      expectedMinutes: chore.expectedMinutes,
    }))
    expect(allocate({ members: original, chores: unpinned }).level).toBe(true)
  })
})

describe('AC 7 - incumbency never outranks the capability constraint', () => {
  const members = [
    { id: 'a', capacityMinutes: 100 },
    { id: 'b', capacityMinutes: 100 },
  ]
  const chores = [{ id: 'knife', expectedMinutes: 40 }]

  it('moves a chore off a holder who may no longer do it', () => {
    const result = reallocate({
      members,
      chores,
      isEligible: (chore, member) => member.id === 'b',
      previous: [{ choreId: 'knife', memberId: 'a' }],
      // ZERO budget, so nothing discretionary may move. It moves anyway: this
      // is not a preference the budget is entitled to refuse.
      changeBudgetMinutes: 0,
    })
    expect(result.assignments[0].memberId).toBe('b')
    expect(result.jobsMoved).toBe(1)
    expect(result.minutesMoved).toBe(40)
    expect(result.boundByBudget).toBe(false)
  })

  it('POSITIVE CONTROL: with the same holder still eligible, a zero budget keeps it', () => {
    // The pair is what makes the case above about ELIGIBILITY. Without it, the
    // move is equally explained by a budget that does not work.
    const result = reallocate({
      members,
      chores,
      previous: [{ choreId: 'knife', memberId: 'a' }],
      changeBudgetMinutes: 0,
    })
    expect(result.assignments[0].memberId).toBe('a')
    expect(result.jobsMoved).toBe(0)
  })

  it('does not resurrect an ineligible incumbent when the budget refuses a move', () => {
    // The budget's refusal path puts a chore back with its previous holder, and
    // that path must never be reachable for a holder who may not do the chore.
    // `a` holds both jobs and may not do j2 any more.
    const result = reallocate({
      members,
      chores: [
        { id: 'j1', expectedMinutes: 40 },
        { id: 'j2', expectedMinutes: 40 },
      ],
      isEligible: (chore, member) => chore.id !== 'j2' || member.id === 'b',
      previous: [
        { choreId: 'j1', memberId: 'a' },
        { choreId: 'j2', memberId: 'a' },
      ],
      changeBudgetMinutes: 0,
    })
    expect(result.assignments.find((a) => a.choreId === 'j2').memberId).toBe('b')
  })
})


describe('AC 8 - the figure reported is MINUTES', () => {
  // A straight swap: `a` had the light job and `b` the heavy one, and after
  // b's week halves they trade. Every member holds exactly as many jobs as
  // before, so a re-balance described in COUNTS reports that nothing happened,
  // while a hundred minutes of work changed hands. This is the prototype's
  // third finding reproduced as a fixture - the first narration read "10 chores
  // moved" beside "Nora -1 Ava +1", both true, and it read as broken.
  const chores = [
    { id: 'heavy', expectedMinutes: 80 },
    { id: 'light', expectedMinutes: 20 },
  ]
  const previous = [
    { choreId: 'heavy', memberId: 'b' },
    { choreId: 'light', memberId: 'a' },
  ]
  const result = reallocate({
    members: [
      { id: 'a', capacityMinutes: 100 },
      { id: 'b', capacityMinutes: 40 },
    ],
    chores,
    previous,
    changeBudgetMinutes: Infinity,
  })

  const countsPerMember = (assignments) => {
    const counts = {}
    for (const a of assignments) counts[a.memberId] = (counts[a.memberId] ?? 0) + 1
    return counts
  }

  it('moves a hundred minutes', () => {
    expect(result.minutesMoved).toBe(100)
  })

  it('while every member holds exactly as many jobs as before', () => {
    expect(countsPerMember(result.assignments)).toEqual(countsPerMember(previous))
  })

  it('so a count-only description of this re-balance reports NOTHING moved', () => {
    // The assertion the criterion asks for, stated as the thing that fails: a
    // household told "your job count is unchanged" has been told the truth and
    // learned nothing, because their week changed by an hour and twenty.
    const before = countsPerMember(previous)
    const after = countsPerMember(result.assignments)
    const netCountChange = Object.keys(after).reduce(
      (worst, id) => Math.max(worst, Math.abs((after[id] ?? 0) - (before[id] ?? 0))),
      0,
    )
    expect(netCountChange).toBe(0)
    expect(result.minutesMoved).toBeGreaterThan(0)
  })

  it('and the minutes each person carries moved by sixty', () => {
    const carrying = (id) => result.load.find((entry) => entry.memberId === id).assignedMinutes
    expect(carrying('a')).toBe(80)
    expect(carrying('b')).toBe(20)
  })

  it('records minutes, not only a count, for every row of the table', () => {
    // A recorded output phrased in counts alone would fail the criterion, so
    // the document is checked for a minutes figure on every budget row rather
    // than for the word "minutes" appearing somewhere on the page.
    const doc = readFileSync(resolve(process.cwd(), 'docs/rebalance-churn.md'), 'utf8')
    const totals = BUDGETS.map((changeBudgetMinutes) => ({
      label: budgetLabel(changeBudgetMinutes),
      ...corpusTotals((scenario) => {
        const { before, after } = rebalanced(scenario, changeBudgetMinutes)
        return { before, after, jobsMoved: after.jobsMoved, minutesMoved: after.minutesMoved }
      }),
    }))
    for (const total of totals) {
      expect(
        doc,
        `no row records ${total.minutesMoved} minutes beside ${total.jobsMoved} of ${total.movableJobs} jobs`,
      ).toContain(`| ${total.label} | ${total.jobsMoved} of ${total.movableJobs} | ${total.minutesMoved} |`)
    }
  })
})


describe('AC 2 - the baseline, and whether the corpus exercises the problem at all', () => {
  // The criterion sets a bar and points it at the FIXTURE rather than at the
  // allocator: "a baseline that does not reproduce churn comparable to the
  // prototype's measured 8 to 10 jobs of 14 fails this story - because it means
  // the corpus is not exercising the problem the story exists to solve".
  //
  // So this is the guard against a triumphant zero. A corpus of households that
  // barely churn would let any stability rule look like a success.
  const PROTOTYPE_FLOOR = 8 / 14

  const baseline = corpusTotals((scenario) => {
    const run = unstabilised(scenario)
    return { ...run, after: run.after }
  })

  it('churns a proportion of jobs comparable to the prototype', () => {
    const proportion = baseline.jobsMoved / baseline.movableJobs
    expect(
      proportion,
      `baseline churn is ${baseline.jobsMoved} of ${baseline.movableJobs} ` +
        `(${(proportion * 100).toFixed(1)}%) - below the prototype's 8 of 14, so the corpus is ` +
        'not exercising the problem this story exists to solve',
    ).toBeGreaterThanOrEqual(PROTOTYPE_FLOOR)
  })

  it('and at least one shape churns most of its own list, not just the corpus in aggregate', () => {
    // An aggregate can clear the bar while no individual household ever
    // experiences the shuffled week the charter describes. The prototype's
    // finding was about ONE household seeing 8 of its 14 jobs move.
    const worst = SCENARIOS.map((scenario) => {
      const run = unstabilised(scenario)
      const movable = run.before.assignments.length
      return movable === 0 ? 0 : run.jobsMoved / movable
    })
    expect(Math.max(...worst)).toBeGreaterThanOrEqual(PROTOTYPE_FLOOR)
  })

  it('POSITIVE CONTROL: the stabilised allocator scores MATERIALLY lower on the same metric', () => {
    // Without this the bar above is not evidence about anything: a churn metric
    // that reported 58% for every possible allocator would clear it whatever
    // the code did. The two arms are measured the same way over the same
    // corpus, and they have to disagree.
    const stabilised = corpusTotals((scenario) => {
      const { before, after } = rebalanced(scenario, Infinity)
      return { before, after, jobsMoved: after.jobsMoved, minutesMoved: after.minutesMoved }
    })
    expect(stabilised.jobsMoved).toBeLessThan(baseline.jobsMoved)
    expect(stabilised.minutesMoved).toBeLessThan(baseline.minutesMoved / 2)
  })

  it('records the baseline in docs/rebalance-churn.md', () => {
    const doc = readFileSync(resolve(process.cwd(), 'docs/rebalance-churn.md'), 'utf8')
    expect(doc).toContain(
      `| no stability rule | ${baseline.jobsMoved} of ${baseline.movableJobs} | ${baseline.minutesMoved} | ${baseline.level} of ${baseline.contested} |`,
    )
  })
})

describe('AC 5 - the recorded table is a measurement, not an assertion', () => {
  const doc = readFileSync(resolve(process.cwd(), 'docs/rebalance-churn.md'), 'utf8')

  it('reports at least three settings of the change budget', () => {
    expect(BUDGETS.length).toBeGreaterThanOrEqual(3)
  })

  it('spans the whole tradeoff rather than bracketing the shipped value', () => {
    // A table whose settings all sat near the value being proposed would show a
    // flat line and prove nothing about the shape of the curve.
    expect(Math.min(...BUDGETS)).toBe(0)
    expect(Math.max(...BUDGETS)).toBe(Infinity)
    expect(BUDGETS).toContain(CHANGE_BUDGET_MINUTES)
  })

  for (const changeBudgetMinutes of BUDGETS) {
    const label = budgetLabel(changeBudgetMinutes)
    it(`records change budget against minutes moved against levelness: ${label}`, () => {
      const total = corpusTotals((scenario) => {
        const { before, after } = rebalanced(scenario, changeBudgetMinutes)
        return { before, after, jobsMoved: after.jobsMoved, minutesMoved: after.minutesMoved }
      })
      // The row is asserted WHOLE and it starts with its LABEL. MEASURED
      // while proving these tests: without the label, removing the change
      // budget entirely reddened none of these - every arm collapsed onto
      // the same figures, and the unbounded row really was in the table, so
      // each budget found somebody else's row and was satisfied. A row is a
      // claim about the setting that names it.
      const row =
        `| ${label} | ${total.jobsMoved} of ${total.movableJobs} | ${total.minutesMoved} | ` +
        `${total.level} of ${total.contested} | ${total.bound} of ${SCENARIOS.length} |`
      expect(doc, `no row for ${label}: ${row}`).toContain(row)
    })
  }

  it('POSITIVE CONTROL: the arms are not all the same, so the table has a shape', () => {
    // A doc-agreement test over rows that were all identical would pass on a
    // re-allocator that ignored the budget entirely.
    const minutes = BUDGETS.map(
      (changeBudgetMinutes) =>
        corpusTotals((scenario) => {
          const { before, after } = rebalanced(scenario, changeBudgetMinutes)
          return { before, after, jobsMoved: after.jobsMoved, minutesMoved: after.minutesMoved }
        }).minutesMoved,
    )
    expect(new Set(minutes).size).toBe(BUDGETS.length)
    // And monotone in the budget: a bigger allowance can never move less.
    for (let i = 1; i < minutes.length; i += 1) {
      expect(minutes[i]).toBeGreaterThan(minutes[i - 1])
    }
  })
})
