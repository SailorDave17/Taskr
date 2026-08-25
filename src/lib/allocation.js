// The allocation module - stories #40 and #41.
//
// #40 built `allocate`: the number the whole product rests on. #41 added
// `reallocate`, which is the same placement rule asked a different question -
// not "can we be level" but "what does staying stable cost". They share one
// implementation on purpose; see `allocationOf` below.
//
// This is the number the whole product rests on. The charter's thesis is that
// chores are minutes of work and people are budgets of minutes, so "fair" means
// every person carries the same share OF THEIR OWN capacity — not the same
// number of chores, and not the same number of minutes. A parent with 300
// minutes and a kid with 60 are level when both are at 50%, which is five
// chores against one.
//
// Deliberately pure, and AC 1 makes that a test rather than a habit: nothing
// here imports react, @supabase/supabase-js or household.js, and capacity
// arrives as an ARGUMENT. That last part is the constraint that keeps the
// charter's point-of-no-return open — an allocator that can read
// members.weekly_minutes has baked capacity-as-constant into its inputs, and
// capacity-as-constant is the exact thing the charter says every competitor
// gets wrong. #44 makes capacity a per-week fact; this module must not need
// changing when it does.
//
// The honesty half is not deferrable. The prototype measured (charter, "Three
// findings") that when a member's capacity approaches the size of one
// indivisible chore, level is ARITHMETICALLY IMPOSSIBLE — greedy was ragged in
// 3 of 5 scenarios and a local-search pass could not fix one of them. An
// allocator that reports "level" over a visibly ragged set spends the trust the
// product is made of. So the verdict carries a reason, and the reason names the
// person and the two numbers that explain it.

/**
 * How far apart two people's shares may sit before level is unreachable,
 * expressed as a fraction of each person's own capacity.
 *
 * 10 percentage points, owner-set at pickup of #40. The bound that constrains
 * it: the charter records the prototype as ragged at 15% spread, so a tolerance
 * at or above 0.15 would call that measured-ragged set level — which is the one
 * failure this module exists to prevent. Below that, the charter's other
 * constraint pushes the other way: "a notice that fires on healthy households
 * is an absent notice", so it is not set so tight that ordinary indivisibility
 * trips it.
 */
export const LEVEL_TOLERANCE = 0.1

// Float comparison slack. Shares are ratios of integers, so exact equality is
// nearly always right — but 190/275 and its arithmetic are not exact in binary,
// and a tie decided by the last bit of a mantissa is a tie decided at random.
const EPSILON = 1e-9

/**
 * How many minutes of work a single re-balance may move off the people
 * currently holding it - #41 AC 4, and the tunable the whole story is named
 * for.
 *
 * 120 minutes, owner-set at the gate of #41 from the measured table in
 * docs/rebalance-churn.md rather than from intuition, which is what AC 5's
 * table exists for. What the measurement actually said:
 *
 * - Levelness barely responds to this number. Across every setting from 0 to
 *   unbounded, between 1 and 2 of the corpus's 10 contested shapes reach level,
 *   against 3 for an allocator with no stability rule at all. Almost every
 *   shape that cannot be level is held there by the granularity floor #40
 *   measured, which no amount of movement fixes. So this constant is NOT a
 *   fairness dial, and choosing it by maximising levelness would be reading
 *   noise.
 * - Exactly one shape in the corpus is a real tradeoff: "roomy", where the
 *   household CAN return to level and needs 80 minutes of movement to do it.
 *   120 clears that with room; 60 does not, and refuses it.
 *
 * Bounded on both sides, like LEVEL_TOLERANCE:
 *
 * - ABOVE 80, the measured cost of the one repair in the corpus that a budget
 *   can actually buy. A budget under that spends churn and gets nothing for it,
 *   which is the worst of both.
 * - Not so high that it stops binding. At 120 the budget still bounds 2 of the
 *   13 shapes and holds total churn to 355 minutes against the unstabilised
 *   allocator's 1240 - and a budget that never binds is an absent budget.
 *
 * Infinity is a legal value and means "tie-break stability only". It is what
 * `allocate` runs with, because a first allocation has nothing to keep stable.
 */
export const CHANGE_BUDGET_MINUTES = 120

/**
 * The minutes this person would carry if the work divided perfectly.
 *
 * THE single definition — AC 9. Every fair-share figure in the product comes
 * from here, including the one inside the unreachable message, so a screen and
 * a verdict can never quote two different numbers for the same household.
 *
 * Zero total capacity yields zero rather than NaN: a household where nobody has
 * any minutes has no fair share to state, and NaN would propagate into a
 * sentence a person reads.
 */
export function fairShare(capacityMinutes, totalWorkMinutes, totalCapacityMinutes) {
  if (totalCapacityMinutes <= 0) return 0
  return capacityMinutes * (totalWorkMinutes / totalCapacityMinutes)
}

/** max − min over a set of shares — the quantity `isLevel` thresholds. */
export function spreadOf(shares) {
  if (shares.length === 0) return 0
  return Math.max(...shares) - Math.min(...shares)
}

/**
 * Is this set of shares level? THE single definition — AC 9.
 *
 * Takes the shares rather than the household so that it cannot quietly consult
 * anything else, which is what makes "the verdict's levelness comes from this
 * function" a property a test can check by calling it with the verdict's own
 * numbers.
 *
 * Fewer than two shares is level by definition — one person cannot be uneven
 * with themselves, and an empty household has nothing to be uneven about. That
 * is not a special case being waved through: the spread of a one-element set is
 * zero, so this returns exactly what the general rule would.
 */
export function isLevel(shares) {
  if (shares.length < 2) return true
  return spreadOf(shares) <= LEVEL_TOLERANCE + EPSILON
}

/**
 * How far past their fair share the most over-committed person is, in minutes.
 *
 * THE single definition of "off level" — #47 criterion 5, and the third member
 * of the family `fairShare` and `isLevel` already belong to. The surface states
 * this number and the allocator's own corpus report could; two implementations
 * would let a screen say "30 minutes off" while the verdict beside it disagreed,
 * which is the charter's named trust-killer.
 *
 * MINUTES, never a count of chores — the prototype's third finding, and the one
 * that read as broken when it was violated.
 *
 * The member named is the one furthest ABOVE their share rather than the one
 * furthest from it in either direction, and that is a product decision rather
 * than an arithmetic one: "carrying 30 minutes more than their share" is the
 * sentence the household is arguing about, and its mirror ("carrying 30 minutes
 * less") points at a person as the problem. Red is for work, never for people.
 *
 * Null when there is nobody to be uneven with, and null when nobody is over —
 * a household that is exactly on its shares has no number to state, and
 * fabricating a zero would put "0 minutes off level" on a screen.
 */
export function offLevelOf(load) {
  if (load.length < 2) return null
  let worst = null
  for (const entry of load) {
    const over = entry.assignedMinutes - entry.fairShareMinutes
    if (worst === null || over > worst.over + EPSILON) {
      worst = { memberId: entry.memberId, over }
    }
  }
  if (worst === null || worst.over <= EPSILON) return null
  return { memberId: worst.memberId, minutes: Math.round(worst.over) }
}

/**
 * The minutes one chore contributes to the person holding it.
 *
 * OPEN work contributes its ESTIMATE and DONE work contributes what it actually
 * took — #47 criterion 7, which supersedes #12's AC 6 and settles the open
 * decision that AC carried (its option (a), recommended there and taken here).
 *
 * `actualMinutes` is the field #12 will fill; nothing writes it yet, so the
 * fallback is what runs today and the preference is what runs the moment that
 * column exists. That ordering is deliberate: the alternative is a change to
 * this line inside #12, which is a coupling nobody would be looking for.
 *
 * The fallback is on ABSENCE, not on falsiness. A chore genuinely recorded at
 * zero actual minutes must contribute zero, and `actual || expected` would
 * silently substitute the estimate for exactly the completion that most
 * contradicts it.
 */
export function minutesOf(chore) {
  if (!chore.done) return chore.expectedMinutes
  return chore.actualMinutes == null ? chore.expectedMinutes : chore.actualMinutes
}

/**
 * The fairness verdict over a set of loads people are ALREADY carrying.
 *
 * THE single implementation — #47 criterion 5. `allocate` below ends by calling
 * this on the assignments it just made, and the household surface calls it on
 * the assignments a human made, so the screen and the allocator cannot reach two
 * different answers about one household. A test asserts they agree on a scenario
 * a plausible re-implementation would get wrong.
 *
 * @param {object} input
 * @param {Array<{id: string, capacityMinutes: number}>} input.members
 *   Capacity is an ARGUMENT here for the same reason it is an argument to
 *   `allocate`: this module must never learn to read `members.weekly_minutes`.
 * @param {Array<{id, expectedMinutes, actualMinutes?, assignedMemberId?, done?}>} input.chores
 *
 * Work nobody holds is EXCLUDED from the arithmetic and returned separately.
 * Counting it would inflate every fair share against work no member has taken
 * on, and then report the whole household underloaded for it — the same
 * reasoning `allocate` gives for excluding what nobody is eligible for, and the
 * same rule, because after allocation those are the same chores.
 */
export function assess({ members, chores }) {
  assertMembers(members)
  assertChores(chores)

  // Sorted, so input order cannot reach the result — the property `allocate`
  // states as AC 6 and which this inherits by construction rather than by a
  // second copy of the sort.
  const roster = [...members].sort(byId)
  const byMemberId = new Map(roster.map((m) => [m.id, m]))

  // Zero capacity is not a small capacity. A share is minutes over capacity, so
  // dividing here is a division by zero and reporting the result reads as the
  // most overloaded person in the house. They are held out of the split and
  // named separately — #47 criterion 8, and #40 AC 7 before it.
  const working = roster.filter((m) => m.capacityMinutes > 0)
  const noCapacity = roster.filter((m) => m.capacityMinutes <= 0)

  const doneMinutes = new Map(roster.map((m) => [m.id, 0]))
  const openMinutes = new Map(roster.map((m) => [m.id, 0]))
  const unassigned = []
  let totalWorkMinutes = 0

  for (const chore of chores) {
    const holder = chore.assignedMemberId
    if (holder == null || !byMemberId.has(holder)) {
      // Only OUTSTANDING work is unassigned work. A finished chore nobody was
      // ever given is history, not something the household has to act on, and
      // putting it in a needs-attention area would make that area permanent.
      if (!chore.done) unassigned.push(chore.id)
      continue
    }
    const minutes = minutesOf(chore)
    totalWorkMinutes += minutes
    const bucket = chore.done ? doneMinutes : openMinutes
    bucket.set(holder, bucket.get(holder) + minutes)
  }

  const totalCapacityMinutes = working.reduce((sum, m) => sum + m.capacityMinutes, 0)

  const carrying = (member) => {
    const done = doneMinutes.get(member.id)
    const open = openMinutes.get(member.id)
    return { memberId: member.id, assignedMinutes: done + open, doneMinutes: done, openMinutes: open }
  }

  const load = working.map((member) => {
    const entry = carrying(member)
    return {
      ...entry,
      // Carried on the entry rather than left for a caller to look up again.
      // A screen that re-resolved capacity from its own props could divide by a
      // number this function never saw — and the failure would be a NaN width
      // rather than an error, which is the shape that reaches a household.
      capacityMinutes: member.capacityMinutes,
      share: entry.assignedMinutes / member.capacityMinutes,
      fairShareMinutes: fairShare(member.capacityMinutes, totalWorkMinutes, totalCapacityMinutes),
    }
  })

  const shares = load.map((entry) => entry.share)

  return {
    load,
    // Named, never given a share.
    noCapacity: noCapacity.map(carrying),
    unassigned: [...unassigned].sort(),
    // Whether level was a REAL question. Fewer than two people with capacity is
    // level because a set that small has no spread, not because anything was
    // achieved — and `scripts/allocation-corpus-report.mjs` already refuses to
    // fold those into one headline for exactly that reason. A surface that
    // announced "the split is level" over an empty household would be the same
    // vacuous claim with a person reading it.
    contested: shares.length >= 2,
    level: isLevel(shares),
    spread: spreadOf(shares),
    // Reported whether or not the household is level, because a household
    // inside the tolerance can still have somebody a few minutes over and the
    // surface, not this function, decides which sentence to say.
    offLevel: offLevelOf(load),
    totalWorkMinutes,
    totalCapacityMinutes,
  }
}

/**
 * Divide the household's chores by capacity.
 *
 * @param {object} input
 * @param {Array<{id: string, capacityMinutes: number}>} input.members
 *   Capacity is an ARGUMENT (AC 1). There is no default and no fallback to a
 *   stored baseline: a member without a capacity is a programming error here,
 *   not a member with zero minutes, and the two must not be confused.
 * @param {Array<{id: string, expectedMinutes: number, assignedMemberId?: string|null}>} input.chores
 *   `assignedMemberId` is a chore a human already placed. It is never moved.
 * @param {(chore: object, member: object) => boolean} [input.isEligible]
 *   Eligibility as an input predicate (AC 7), so the capability model can
 *   change — or arrive from #37 — without this module changing.
 */
export function allocate({ members, chores, isEligible = () => true }) {
  return allocationOf({
    members,
    chores,
    isEligible,
    // No previous allocation, so there is nothing to be stable ABOUT: the
    // incumbency branch inside `place` is unreachable and every tie falls to
    // the deterministic key. That is deliberate, and it is what makes this
    // function the honest baseline arm for #41 AC 2 — "re-allocation with no
    // stability rule at all" is not a flag on the thing under test, it is this
    // function, which existed and was proven before the stability rule did.
    held: new Map(),
    changeBudgetMinutes: Infinity,
  }).allocation
}

/**
 * Re-divide the household's chores after something changed — story #41.
 *
 * `allocate` above asks whether we can be level. This asks what staying stable
 * costs, and the charter is why: the prototype churned 8-10 of 14 jobs on the
 * first re-balance, "the biggest risk to the moment". Fairness that arrives as
 * a shuffled week nobody recognises is not fairness anybody accepts, so this
 * function moves the FEWEST MINUTES it can rather than the most level it can.
 *
 * Two mechanisms, deliberately different in kind:
 *
 * 1. Incumbency breaks ties, and only ties (AC 3). Where two members would end
 *    on the same share, the chore stays where it is. This costs nothing - the
 *    allocation is exactly as level either way - so it is free stability, and
 *    it is applied always.
 * 2. A change budget bounds the rest (AC 4). Moving a chore off its current
 *    holder for a genuine levelness gain spends its minutes. When the budget
 *    runs out the chore stays put and the verdict says the budget bound it.
 *
 * Never at the expense of a rule that is not about churn: a manual placement
 * still does not move (AC 6), and a chore whose holder is no longer eligible
 * for it still moves (AC 7). Stability never outranks the capability
 * constraint - incumbency is a preference between members who could all take
 * the chore, so a member who could not take it is not a candidate to prefer.
 *
 * @param {object} input
 * @param {Array<{id: string, capacityMinutes: number}>} input.members
 *   The capacities AFTER the change. Capacity is an argument here for the same
 *   reason it is one to `allocate` (#40 AC 1).
 * @param {Array<{id: string, expectedMinutes: number, assignedMemberId?: string|null}>} input.chores
 * @param {(chore: object, member: object) => boolean} [input.isEligible]
 * @param {Array<{choreId: string, memberId: string}>} [input.previous]
 *   The previous allocation's assignments - who held what before. Assignments
 *   rather than a whole result, because that is the shape a stored allocation
 *   comes back as, and because it is the only part of the previous result this
 *   function is entitled to consult.
 * @param {number} [input.changeBudgetMinutes]
 */
export function reallocate({
  members,
  chores,
  isEligible = () => true,
  previous = [],
  changeBudgetMinutes = CHANGE_BUDGET_MINUTES,
}) {
  const { allocation, boundByBudget } = allocationOf({
    members,
    chores,
    isEligible,
    held: new Map(previous.map((entry) => [entry.choreId, entry.memberId])),
    changeBudgetMinutes,
  })

  // AC 1 - the churn figures come from DIFFING the two allocations, not from
  // the counter `place` keeps to spend the budget. They are not the same
  // number and must not be: the counter charges only DISCRETIONARY moves,
  // because movement nobody chose is not movement a budget should refuse. When
  // a member leaves the household their chores are redistributed, the household
  // sees every one of those jobs change hands, and the budget was never
  // consulted. Reporting the counter there would tell a household that nothing
  // moved on the week it moved most.
  const moved = movedBetween(previous, allocation.assignments)
  const minutesByChore = new Map(chores.map((chore) => [chore.id, chore.expectedMinutes]))

  return {
    ...allocation,
    moved,
    jobsMoved: moved.length,
    // MINUTES is the reported unit - the prototype's third finding, and #41
    // AC 8. "Ten chores moved" beside "Nora -1 Ava +1" were both true and read
    // as broken; net counts barely move while minutes move a lot.
    minutesMoved: moved.reduce((sum, id) => sum + (minutesByChore.get(id) ?? 0), 0),
    changeBudgetMinutes,
    boundByBudget,
  }
}

/**
 * The chores that changed hands between two allocations - #41 AC 1.
 *
 * A job has MOVED when it had a holder in both allocations and the holder is
 * not the same person. Deliberately not "appears in one and not the other": a
 * chore that became impossible for everybody left somebody's list, but it moved
 * nowhere, and counting it as churn would charge a re-balance for work that
 * stopped existing. The same reasoning excludes newly-created work, which has
 * no previous holder to have been taken from.
 */
export function movedBetween(previous, next) {
  const before = new Map(previous.map((entry) => [entry.choreId, entry.memberId]))
  const moved = []
  for (const assignment of next) {
    const was = before.get(assignment.choreId)
    if (was !== undefined && was !== assignment.memberId) moved.push(assignment.choreId)
  }
  return moved.sort((a, b) => String(a).localeCompare(String(b)))
}

/**
 * The one allocation implementation. `allocate` and `reallocate` are both this
 * function with different arguments, so there is no second copy of the
 * placement rule to drift - the same reason #40 AC 9 permits exactly one
 * `fairShare` and one `isLevel` in the repo.
 *
 * Returns the allocation and the budget verdict separately so `allocate` can
 * hand back exactly the shape it always has. A `boundByBudget: false` on a
 * function that has no budget would be an answer to a question nobody asked.
 */
function allocationOf({ members, chores, isEligible, held, changeBudgetMinutes }) {
  assertMembers(members)
  assertChores(chores)

  // Sorted copies, so input order cannot reach the result (#40 AC 6). Nothing
  // in this module shuffles and nothing calls Math.random: the same household
  // in a different order must produce a byte-identical answer, or a plain
  // re-render looks to a person like a re-balance - which is the very thing
  // #41 exists to stop.
  const roster = [...members].sort(byId)
  const byMemberId = new Map(roster.map((m) => [m.id, m]))

  // Zero capacity is not a small capacity - #40 AC 7. A share is minutes over
  // capacity, so giving work to someone with no minutes is a division by zero,
  // and reporting them at Infinity% reads as the most overloaded person in the
  // house. They are held out of the split and named separately.
  //
  // Only the working half is needed HERE, to decide who may be given a chore.
  // Naming the other half is `assess`'s job, and there is deliberately no
  // second `capacityMinutes <= 0` filter in this function: two copies of the
  // zero-capacity rule are two places for it to be relaxed by one character.
  const working = roster.filter((m) => m.capacityMinutes > 0)

  const { assignments, unassignable, boundByBudget } = place({
    roster,
    byMemberId,
    working,
    chores,
    isEligible,
    held,
    changeBudgetMinutes,
  })

  // The fairness arithmetic runs over the work that actually landed on someone,
  // and it is `assess` above that runs it - #47 criterion 5. There is exactly
  // one implementation of fair share, levelness and off-level in this repo, and
  // the household surface reaches it through the same door.
  //
  // A chore nobody is eligible for is excluded on purpose: counting it would
  // inflate every person's fair share against work no split of this household
  // can carry, and then report everybody underloaded for it. That exclusion is
  // not restated here - `assess` drops work nobody holds, and after allocation
  // the work nobody holds is exactly the work nobody was eligible for. Handing
  // it the placed assignments rather than the raw input is what makes those the
  // same set instead of two rules that happen to agree today.
  const placedBy = new Map(assignments.map((a) => [a.choreId, a.memberId]))
  const placed = chores.map((chore) => ({
    id: chore.id,
    expectedMinutes: chore.expectedMinutes,
    assignedMemberId: placedBy.get(chore.id) ?? null,
  }))
  const verdict = assess({ members: roster, chores: placed })
  const allocatable = chores.filter((c) => placedBy.has(c.id))

  return {
    allocation: {
      assignments: [...assignments].sort(byChoreId),
      unassignable: [...unassignable].sort(),
      load: verdict.load,
      // Named, never given a share. #40 AC 7: "reported as having no capacity
      // rather than as infinitely loaded".
      noCapacity: verdict.noCapacity,
      contested: verdict.contested,
      level: verdict.level,
      spread: verdict.spread,
      offLevel: verdict.offLevel,
      // Present only when level is unreachable - #40 AC 5. A notice that fires
      // on a healthy household is an absent notice, and it takes the real one
      // with it.
      reason: verdict.level
        ? null
        : unreachableReason(
            verdict.load,
            allocatable,
            verdict.totalWorkMinutes,
            verdict.totalCapacityMinutes,
          ),
    },
    boundByBudget,
  }
}

/**
 * Place every chore, honouring manual placements, incumbency and the budget.
 *
 * `held` is who held each chore before, and it is EMPTY for a first allocation
 * - which is what makes the two stability mechanisms below inert rather than
 * special-cased when there is no previous allocation to be stable against.
 */
function place({ roster, byMemberId, working, chores, isEligible, held, changeBudgetMinutes }) {
  const minutesByMember = new Map(roster.map((m) => [m.id, 0]))
  const assignments = []
  const unassignable = []

  // Minutes of DISCRETIONARY movement spent so far. NOT the reported churn
  // figure - see `reallocate`, which diffs the two allocations for that.
  let minutesSpent = 0
  let boundByBudget = false

  // Pass 1 - the chores a human already placed (#40 AC 8, and #41 AC 6). They
  // stay, their minutes count against that person's capacity, and no capacity
  // change of any size moves them. Held even when the member is ineligible or
  // has no capacity: a human overrode the model on purpose, and silently
  // undoing that is the negotiation the charter says the product must not
  // reopen. The off-level minutes a pin causes are reported by `assess` rather
  // than hidden - the honest half of #41 AC 6.
  for (const chore of sortedForAllocation(chores)) {
    if (chore.assignedMemberId == null) continue
    if (!byMemberId.has(chore.assignedMemberId)) {
      throw new Error(`Chore ${chore.id} is assigned to unknown member ${chore.assignedMemberId}.`)
    }
    assignments.push({ choreId: chore.id, memberId: chore.assignedMemberId, manual: true })
    minutesByMember.set(
      chore.assignedMemberId,
      minutesByMember.get(chore.assignedMemberId) + chore.expectedMinutes,
    )
  }

  // Pass 2 - everything else, largest job first.
  //
  // Largest-first matters: the big indivisible jobs are the ones that cannot be
  // corrected later, so they are placed while there is still room to absorb
  // them. Smallest-first leaves the largest chore for whoever is left, which is
  // how a greedy allocator makes a ragged set out of a divisible one.
  for (const chore of sortedForAllocation(chores)) {
    if (chore.assignedMemberId != null) continue

    const candidates = working.filter((m) => isEligible(chore, m))
    if (candidates.length === 0) {
      // A chore nobody can do is not an error, and it is not given to someone
      // anyway - #40 AC 7. It comes back in its own flagged state, because a
      // chore quietly dropped from the list is work the household thinks is
      // handled.
      unassignable.push(chore.id)
      continue
    }

    // The member who would END UP with the lowest share - not the one lowest
    // now, and emphatically not the one with the most absolute minutes left.
    // Absolute-minutes-remaining is the legacy allocator's rule and it hands
    // every chore to the parent, because a big budget is always "the most free"
    // in minutes however loaded it already is.
    const scored = candidates.map((member) => ({
      member,
      share: (minutesByMember.get(member.id) + chore.expectedMinutes) / member.capacityMinutes,
    }))
    let lowest = Infinity
    for (const entry of scored) if (entry.share < lowest) lowest = entry.share
    const tied = scored.filter((entry) => entry.share <= lowest + EPSILON)

    // #41 AC 3 - a tie goes to whoever holds it now, and to a stable
    // deterministic key when nobody does. `candidates` is in roster order, so
    // `tied[0]` is the lowest member id among those tied: deterministic, and
    // independent of the order members or chores arrived in.
    //
    // The incumbent is looked up among the TIED, which is what confines
    // incumbency to ties - it never buys a worse split, only an identical one.
    // It is looked up among the ELIGIBLE, which is #41 AC 7: a member who may
    // not do this chore is not a candidate, so there is nothing to prefer and
    // the chore moves.
    const heldBy = held.get(chore.id)
    const incumbent = tied.find((entry) => entry.member.id === heldBy)?.member ?? null
    let chosen = incumbent ?? tied[0].member

    // #41 AC 4 - the change budget, in minutes.
    //
    // Only a DISCRETIONARY move is charged: the chore has a previous holder,
    // that holder is still an eligible candidate, and the allocator wants to
    // move it anyway for a genuine levelness gain. Movement forced by a member
    // leaving or losing eligibility is not a choice this budget is entitled to
    // refuse, and charging it would let forced churn crowd out the moves that
    // actually make the household level.
    //
    // Largest job first is inherited from the loop rather than chosen here, and
    // it is the right spend: the big jobs are the ones a budget cannot afford
    // later, and they are the ones that move the spread most.
    const stillACandidate = heldBy !== undefined && candidates.some((m) => m.id === heldBy)
    if (stillACandidate && heldBy !== chosen.id) {
      if (minutesSpent + chore.expectedMinutes <= changeBudgetMinutes + EPSILON) {
        minutesSpent += chore.expectedMinutes
      } else {
        chosen = byMemberId.get(heldBy)
        boundByBudget = true
      }
    }

    assignments.push({ choreId: chore.id, memberId: chosen.id, manual: false })
    minutesByMember.set(chosen.id, minutesByMember.get(chosen.id) + chore.expectedMinutes)
  }

  return { assignments, unassignable, boundByBudget }
}

/**
 * Why level could not be reached, in the three facts that explain it.
 *
 * The person named is the one furthest from where the split should have put
 * them — usually the smallest budget in the house, because the granularity
 * floor bites first where a single chore is a large fraction of someone's week.
 * Their fair share and the smallest job available are the two numbers that make
 * it self-evident: when the smallest job on the list is a big step relative to
 * what this person should carry, no arrangement lands them on it.
 */
function unreachableReason(load, allocatable, totalWorkMinutes, totalCapacityMinutes) {
  const target = totalCapacityMinutes > 0 ? totalWorkMinutes / totalCapacityMinutes : 0
  let furthest = load[0]
  for (const entry of load) {
    if (Math.abs(entry.share - target) > Math.abs(furthest.share - target) + EPSILON) {
      furthest = entry
    }
  }
  const smallest = allocatable.reduce(
    (min, chore) => (chore.expectedMinutes < min ? chore.expectedMinutes : min),
    Infinity,
  )
  return {
    memberId: furthest.memberId,
    // Rounded because this number is read by a person, not compared by a
    // machine. The unrounded value stays on the load entry for anything that
    // needs to compute with it.
    fairShareMinutes: Math.round(furthest.fairShareMinutes),
    smallestJobMinutes: Number.isFinite(smallest) ? smallest : 0,
  }
}

/** Largest job first, ties by chore id — a total order, so it is stable. */
function sortedForAllocation(chores) {
  return [...chores].sort(
    (a, b) => b.expectedMinutes - a.expectedMinutes || String(a.id).localeCompare(String(b.id)),
  )
}

function byId(a, b) {
  return String(a.id).localeCompare(String(b.id))
}

function byChoreId(a, b) {
  return String(a.choreId).localeCompare(String(b.choreId))
}

function assertMembers(members) {
  if (!Array.isArray(members)) throw new Error('allocate needs a members array.')
  for (const member of members) {
    if (member == null || member.id === undefined) throw new Error('Every member needs an id.')
    // The signature constraint of AC 1, enforced rather than documented. A
    // member arriving without `capacityMinutes` is a caller that still thinks
    // capacity is a property of the member row — the shape #44 exists to end.
    // Defaulting it here would let that caller work and hide the fact.
    if (typeof member.capacityMinutes !== 'number' || Number.isNaN(member.capacityMinutes)) {
      throw new Error(
        `Member ${member.id} needs capacityMinutes — the allocator is given capacity, it does not read it.`,
      )
    }
  }
}

function assertChores(chores) {
  if (!Array.isArray(chores)) throw new Error('allocate needs a chores array.')
  for (const chore of chores) {
    if (chore == null || chore.id === undefined) throw new Error('Every chore needs an id.')
    if (typeof chore.expectedMinutes !== 'number' || !Number.isFinite(chore.expectedMinutes)) {
      throw new Error(`Chore ${chore.id} needs expectedMinutes.`)
    }
  }
}
