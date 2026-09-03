// Re-assign the household's open chores from current capacity — story #49.
//
// The charter's grooming decision (2026-08-06) fixed the shape: allocation is
// STORED, with an automatic re-derive on capacity change — no button, because a
// button someone has to press is the negotiation moved rather than removed. The
// owner extended the trigger at pickup of #49: a baseline `weekly_minutes` edit
// on the roster counts as a capacity change too, since it moves a member's
// effective capacity whenever no override stands for the week.
//
// THE WIRING ADDS PERSISTENCE, NEVER LOGIC (#49 AC 1). `planReassignment` below
// contains no placement rule: it maps rows to the allocator's input shape,
// calls `reallocate` — the same single implementation `allocate` is — and maps
// the result to the RPC's payload. A test asserts the plan IS the allocator's
// answer on the same inputs, and the pglite suite asserts the same of what the
// database ends up holding.
//
// CONCURRENCY (#49 AC 6) is the version compare-and-set 0018 defines, and the
// division of labour is deliberate: this module computes with the real
// allocator on rows it read moments ago, and `apply_assignments` refuses the
// result unless those rows are still the household's state. On refusal
// (errcode TA049) the loser re-reads — now seeing both writes — recomputes and
// re-applies, so convergence comes from the allocator being deterministic
// rather than from timing. The version is read FIRST, before any other read:
// a write landing after it makes the apply refuse a fresh computation (one
// wasted retry), where the reverse order would accept a stale one.

import { reallocate, minutesOf } from './allocation.js'
import { capacitiesFor, listCapacity, periodStartFor } from './capacity.js'
import { isMissed, isOutstanding, listChores } from './chores.js'
import { isExcluded, listExclusions } from './exclusions.js'
import { listMembers } from './household.js'
import { getSupabase } from './supabase.js'

function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

/**
 * How many times `reassignHousehold` will recompute after a version refusal
 * before giving up. Two devices racing costs one retry; three writes landing in
 * a tight loop is not a race any more, and an unbounded loop against a
 * household that keeps moving would hold `busy` forever.
 */
export const REASSIGN_MAX_ATTEMPTS = 3

/**
 * The allocator's answer for this household, as the apply RPC wants it.
 *
 * Pure, and deliberately so: everything it needs arrives as rows already read,
 * so the pglite suite can drive the REAL planner against a real database and
 * the unit suite can drive it against fixtures — same function, no fork.
 *
 * The input mapping is the whole job, and each line is a contract with a story:
 *
 * - A DONE chore with a holder is pinned where it is, contributing `minutesOf`
 *   (the actual when recorded, #12) — finished work cannot move, and its
 *   minutes are why someone who already did 200 min gets less open work. Same
 *   mapping as the split's reachability probe (#47).
 * - A done chore nobody holds is history and is dropped, as `assess` drops it.
 * - A MISSED chore (#305's state) is dropped whoever holds it — #306. It is not
 *   finished work (nobody did it) and not open work (it is not going to
 *   happen), so it is neither pinned nor freed; `toAllocatorChores` drops it
 *   for the Split the same way. This is the one allocator-input builder that
 *   does not go through that function, and until #306 a missed row fell into
 *   the done branch below — `!isOutstanding` is true of it — and was pinned to
 *   its holder at the estimate: phantom credit in every future re-assignment,
 *   permanently, since nothing ever removes a missed row. Reachable by hand
 *   through `miss_chore` since #305; `0028` fires it on every superseded
 *   occurrence that had a holder, which is why it is fixed here rather than
 *   filed.
 * - An open chore a person placed by hand (`assigned_source = 'manual'`) is
 *   pinned — #49 AC 4, the allocator's own pass-1 rule (#40 AC 8).
 * - Every other open chore is FREED, and its current holder (if any) enters
 *   `previous` — the incumbent the stability rule prefers on ties and charges
 *   the change budget to move (#41, #49 AC 3).
 *
 * `placements` covers exactly the freed set: whom each chore landed on, or null
 * where nobody is eligible (#49 AC 5) — the flagged unassigned state the
 * household surface already renders. Pins are absent on purpose; the RPC
 * refuses to touch a manual chore, so not naming them is what keeps the apply
 * strict.
 *
 * `verdict` carries the run's own facts (#49 AC 7): whether the result is
 * level, the reason when it is not, whether the change budget bound it, and
 * the churn in minutes. None of that is recomputable from the stored rows —
 * the budget verdict depends on the state the run replaced — which is exactly
 * why it travels with the result instead of being derived again elsewhere.
 */
export function planReassignment({ members, chores, exclusions, overrides, periodStart }) {
  const capacities = capacitiesFor(members, overrides, periodStart)

  const allocatorChores = []
  const previous = []
  const freed = new Set()

  for (const chore of chores) {
    // #306 — before the done branch, because a missed row is not outstanding
    // and would otherwise be pinned as finished work. See the docblock.
    if (isMissed(chore)) continue

    const holder = chore.assigned_member_id ?? null
    const done = !isOutstanding(chore)

    if (done) {
      if (holder == null) continue
      allocatorChores.push({
        id: chore.id,
        expectedMinutes: minutesOf({
          done: true,
          expectedMinutes: chore.expected_minutes || 0,
          actualMinutes: chore.actual_minutes ?? null,
        }),
        assignedMemberId: holder,
      })
      continue
    }

    if (holder != null && chore.assigned_source === 'manual') {
      allocatorChores.push({
        id: chore.id,
        expectedMinutes: chore.expected_minutes || 0,
        assignedMemberId: holder,
      })
      continue
    }

    freed.add(chore.id)
    allocatorChores.push({
      id: chore.id,
      expectedMinutes: chore.expected_minutes || 0,
      assignedMemberId: null,
    })
    if (holder != null) previous.push({ choreId: chore.id, memberId: holder })
  }

  const result = reallocate({
    members: capacities,
    chores: allocatorChores,
    isEligible: (chore, member) => !isExcluded(exclusions, chore.id, member.id),
    previous,
  })

  const placements = [
    ...result.assignments
      .filter((a) => freed.has(a.choreId))
      .map((a) => ({ chore_id: a.choreId, member_id: a.memberId })),
    ...result.unassignable
      .filter((id) => freed.has(id))
      .map((id) => ({ chore_id: id, member_id: null })),
  ].sort((a, b) => String(a.chore_id).localeCompare(String(b.chore_id)))

  return {
    placements,
    verdict: {
      contested: result.contested,
      level: result.level,
      reason: result.reason,
      boundByBudget: result.boundByBudget,
      jobsMoved: result.jobsMoved,
      minutesMoved: result.minutesMoved,
      changeBudgetMinutes: result.changeBudgetMinutes,
    },
    result,
  }
}

/**
 * The household row, read by id rather than through `currentHousehold()`:
 * the caller is re-balancing the household a write just landed in, which is the
 * one on screen — not whichever household a fresh resolution would pick first.
 */
async function readHousehold(householdId) {
  return unwrap(
    await getSupabase().from('households').select('*').eq('id', householdId).single(),
    'reading the household for re-assignment',
  )
}

/**
 * Recompute the household's open-chore assignments and store the result.
 *
 * Called after a capacity write lands (weekly override set or cleared, baseline
 * edited) — the automatic half of the grooming decision, with nobody pressing
 * an assign button and nobody asked to approve (#49 AC 2).
 *
 * Each attempt is a full fresh cycle: version first (see the header), then
 * every input the allocator reads, then compute, then apply. A TA049 from the
 * RPC means the household moved underneath the computation — retry from the
 * top, where the re-read now includes whatever moved it. Any other error is
 * real and surfaces to the caller, whose `mutate()` already puts it on screen.
 */
export async function reassignHousehold({ householdId }) {
  if (!householdId) throw new Error('Which household? Re-assignment must name one.')

  let refused = null
  for (let attempt = 0; attempt < REASSIGN_MAX_ATTEMPTS; attempt += 1) {
    const household = await readHousehold(householdId)
    const members = await listMembers(householdId)
    const memberIds = members.map((m) => m.id)
    const chores = await listChores(householdId)
    const periodStart = periodStartFor(new Date(), household.timezone)
    const overrides = await listCapacity(periodStart, memberIds)
    const exclusions = await listExclusions(memberIds)

    const { placements, verdict } = planReassignment({
      members,
      chores,
      exclusions,
      overrides,
      periodStart,
    })

    // Every key explicit — no shorthand — because liveSchema.test.js derives
    // LIVE_RPCS' argument sets from these call sites by matching `name:`, and
    // an argument the scan cannot see is an argument the live check never
    // probes for.
    const { data, error } = await getSupabase().rpc('apply_assignments', {
      household_id: householdId,
      expected_version: household.assignments_version,
      placements: placements,
      verdict: verdict,
    })

    if (!error) return data
    if (error.code !== 'TA049') {
      return unwrap({ data: null, error }, 'applying the re-assignment')
    }
    refused = error
  }

  return unwrap({ data: null, error: refused }, 'applying the re-assignment')
}
