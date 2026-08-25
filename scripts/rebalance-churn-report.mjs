// Re-derive the churn figures - #41 AC 2 and AC 5.
//
// AC 5 asks for "a table of change budget against minutes moved against
// levelness reached ... recorded in the repo, so the tradeoff is a measurement
// rather than an assertion". This is the command that measures it;
// docs/rebalance-churn.md holds the recorded numbers, and a test in
// src/lib/rebalance.test.js fails when the document and this command disagree.
//
// AC 2 asks for the BASELINE - the same corpus re-allocated with no stability
// rule at all - and sets a bar: a baseline that does not reproduce churn
// comparable to the prototype's 8-10 of 14 jobs FAILS the story, because it
// means the corpus is not exercising the problem. The baseline row below is
// that measurement, and the proportion is printed beside it so the bar can be
// read rather than argued.

import { allocate, reallocate } from '../src/lib/allocation.js'
import { SCENARIOS } from '../src/lib/allocation.corpus.js'
import { BUDGETS, busyWeek } from '../src/lib/rebalance.corpus.js'

/**
 * One arm over the whole corpus.
 *
 * `run` is handed the scenario, the changed members and the previous
 * assignments, and returns a re-allocation result. That is the seam between
 * the baseline arm (plain `allocate`, which has no previous allocation to be
 * stable against) and the budgeted arm.
 */
function arm(run) {
  let jobsMoved = 0
  let minutesMoved = 0
  let movableJobs = 0
  let level = 0
  let contested = 0
  let boundByBudget = 0

  for (const scenario of SCENARIOS) {
    const before = allocate({
      members: scenario.members,
      chores: scenario.chores,
      isEligible: scenario.isEligible,
    })
    const members = busyWeek(scenario.members)
    const after = run(scenario, members, before.assignments)

    jobsMoved += after.jobsMoved
    minutesMoved += after.minutesMoved
    // The denominator is the jobs that COULD have moved: the ones somebody
    // held before. Work nobody was holding cannot churn, and counting it would
    // deflate the proportion with shapes that have nothing to move.
    movableJobs += before.assignments.length

    if (scenario.workingMembers >= 2) {
      contested += 1
      if (after.level) level += 1
    }
    if (after.boundByBudget) boundByBudget += 1
  }

  return { jobsMoved, minutesMoved, movableJobs, level, contested, boundByBudget }
}

/**
 * The churn figures for an arm that has no previous allocation to consult.
 *
 * `allocate` is the unstabilised allocator - it is what shipped in #40, before
 * any stability rule existed - so the baseline is that function, diffed against
 * the previous allocation. It is deliberately NOT `reallocate` with the
 * stability switched off: an arm that runs the code under test cannot be a
 * control for it.
 */
function baselineArm() {
  return arm((scenario, members, previous) => {
    const after = allocate({ members, chores: scenario.chores, isEligible: scenario.isEligible })
    const held = new Map(previous.map((entry) => [entry.choreId, entry.memberId]))
    const minutes = new Map(scenario.chores.map((chore) => [chore.id, chore.expectedMinutes]))
    const moved = after.assignments.filter(
      (a) => held.has(a.choreId) && held.get(a.choreId) !== a.memberId,
    )
    return {
      ...after,
      jobsMoved: moved.length,
      minutesMoved: moved.reduce((sum, a) => sum + minutes.get(a.choreId), 0),
      boundByBudget: false,
    }
  })
}

const baseline = baselineArm()
const rows = BUDGETS.map((changeBudgetMinutes) => ({
  changeBudgetMinutes,
  ...arm((scenario, members, previous) =>
    reallocate({
      members,
      chores: scenario.chores,
      isEligible: scenario.isEligible,
      previous,
      changeBudgetMinutes,
    }),
  ),
}))

const pct = (n, d) => (d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`)
const budgetLabel = (m) => (m === Infinity ? 'unbounded' : `${m} min`)

console.log('Re-balance churn - #41 AC 2 and AC 5')
console.log(`Corpus: ${SCENARIOS.length} shapes, each with the largest capacity halved`)
console.log('='.repeat(78))
console.log('  change budget    jobs moved      minutes moved   level      bound')
console.log('-'.repeat(78))
console.log(
  `  ${'BASELINE'.padEnd(15)}${`${baseline.jobsMoved} of ${baseline.movableJobs}`.padEnd(16)}` +
    `${String(baseline.minutesMoved).padEnd(16)}` +
    `${`${baseline.level} of ${baseline.contested}`.padEnd(11)}-`,
)
console.log(`  ${'(no stability)'.padEnd(15)}${pct(baseline.jobsMoved, baseline.movableJobs).padEnd(16)}`)
console.log('-'.repeat(78))
for (const row of rows) {
  console.log(
    `  ${budgetLabel(row.changeBudgetMinutes).padEnd(15)}` +
      `${`${row.jobsMoved} of ${row.movableJobs}`.padEnd(16)}` +
      `${String(row.minutesMoved).padEnd(16)}` +
      `${`${row.level} of ${row.contested}`.padEnd(11)}${row.boundByBudget}`,
  )
}
console.log('='.repeat(78))
console.log(
  `Baseline churn: ${baseline.jobsMoved} of ${baseline.movableJobs} jobs ` +
    `(${pct(baseline.jobsMoved, baseline.movableJobs)}), ${baseline.minutesMoved} minutes.`,
)
console.log(
  "The prototype measured 8-10 of 14 (57.1%-71.4%). A baseline far below that means the corpus is",
)
console.log('not exercising the problem - #41 AC 2 fails on that, not on the allocator.')

export const FIGURES = { baseline, rows }
