// The allocation module — story #40.
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
  assertMembers(members)
  assertChores(chores)

  // Sorted copies, so input order cannot reach the result (AC 6). Nothing in
  // this module shuffles and nothing calls Math.random: the same household in a
  // different order must produce a byte-identical answer, or a plain re-render
  // looks to a person like a re-balance.
  const roster = [...members].sort(byId)
  const byMemberId = new Map(roster.map((m) => [m.id, m]))

  // Zero capacity is not a small capacity — AC 7. A share is minutes over
  // capacity, so giving work to someone with no minutes is a division by zero,
  // and reporting them at Infinity% reads as the most overloaded person in the
  // house. They are held out of the split and named separately.
  const working = roster.filter((m) => m.capacityMinutes > 0)
  const noCapacity = roster.filter((m) => m.capacityMinutes <= 0)

  const minutesByMember = new Map(roster.map((m) => [m.id, 0]))
  const assignments = []
  const unassignable = []

  // Pass 1 — the chores a human already placed (AC 8). They stay, and their
  // minutes count against that person's capacity, because the allocator's job
  // is to divide what is LEFT. Held even when the member is ineligible or has
  // no capacity: a human overrode the model on purpose, and silently undoing
  // that is the negotiation the charter says the product must not reopen.
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

  // Pass 2 — everything else, largest job first.
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
      // anyway — AC 7. It comes back in its own flagged state, because a chore
      // quietly dropped from the list is work the household thinks is handled.
      unassignable.push(chore.id)
      continue
    }

    // The member who would END UP with the lowest share — not the one lowest
    // now, and emphatically not the one with the most absolute minutes left.
    // Absolute-minutes-remaining is the legacy allocator's rule and it hands
    // every chore to the parent, because a big budget is always "the most free"
    // in minutes however loaded it already is.
    let best = null
    let bestShare = Infinity
    for (const member of candidates) {
      const share = (minutesByMember.get(member.id) + chore.expectedMinutes) / member.capacityMinutes
      // Strictly-less keeps the first candidate on a tie, and `candidates` is
      // in roster order, so ties resolve by member id — deterministic, and
      // independent of the order members or chores arrived in.
      if (share < bestShare - EPSILON) {
        best = member
        bestShare = share
      }
    }

    assignments.push({ choreId: chore.id, memberId: best.id, manual: false })
    minutesByMember.set(best.id, minutesByMember.get(best.id) + chore.expectedMinutes)
  }

  // The fairness arithmetic runs over the work that actually landed on someone.
  // A chore nobody is eligible for is excluded on purpose: counting it would
  // inflate every person's fair share against work no split of this household
  // can carry, and then report everybody underloaded for it.
  const unassignableIds = new Set(unassignable)
  const allocatable = chores.filter((c) => !unassignableIds.has(c.id))
  const totalWorkMinutes = allocatable.reduce((sum, c) => sum + c.expectedMinutes, 0)
  const totalCapacityMinutes = working.reduce((sum, m) => sum + m.capacityMinutes, 0)

  const load = working.map((member) => ({
    memberId: member.id,
    assignedMinutes: minutesByMember.get(member.id),
    share: minutesByMember.get(member.id) / member.capacityMinutes,
    fairShareMinutes: fairShare(member.capacityMinutes, totalWorkMinutes, totalCapacityMinutes),
  }))

  const shares = load.map((entry) => entry.share)
  const level = isLevel(shares)

  return {
    assignments: [...assignments].sort(byChoreId),
    unassignable: [...unassignable].sort(),
    load,
    // Named, never given a share. AC 7: "reported as having no capacity rather
    // than as infinitely loaded".
    noCapacity: noCapacity.map((member) => ({
      memberId: member.id,
      assignedMinutes: minutesByMember.get(member.id),
    })),
    level,
    spread: spreadOf(shares),
    // Present only when level is unreachable — AC 5. A notice that fires on a
    // healthy household is an absent notice, and it takes the real one with it.
    reason: level
      ? null
      : unreachableReason(load, allocatable, totalWorkMinutes, totalCapacityMinutes),
  }
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
