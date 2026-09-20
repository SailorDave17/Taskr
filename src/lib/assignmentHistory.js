// Who has held each chore in recent weeks, and who moved it — story #481.
//
// `0049` records one row per assignment change (`chore_assignment_history`).
// This module reads the last weeks of it and folds them into the two signals
// the owner named, so the allocator can steer a chore that keeps landing on
// one person, or keeps being moved off them after a deal-out:
//
//   `repeat`   — in each of the last REPEAT_HOLDER_WEEKS weeks, every auto
//                placement of the chore went to the same one member.
//   `movedOff` — in MOVED_OFF_MOVES of the last MOVED_OFF_WINDOW_WEEKS weeks
//                the chore was dealt to a member by the allocator and then
//                hand-moved off them onto somebody else.
//
// ROW ORDER IS NOT EVIDENCE EITHER. Every row one deal-out writes carries the
// same `recorded_at` (`now()` is transaction time) and a random id, so "the
// last placement of the week" is undefined for a repeat with two occurrences
// in a week — a Mon+Thu chore dealt Mon→A, Thu→B would read as A or B by
// uuid luck, and steer on it (found by review-fanout, 2026-09-18, reproduced
// in pglite). Both signals therefore reduce a week as a SET: a week counts
// for the repeat signal only when every placement in it went to one member,
// and for the moved-off signal by which weeks carried a move, never by which
// row came last.
//
// WHAT AC 2 ASKS THAT THE RECORD CANNOT ANSWER. The criterion's Given is
// "while another eligible member had spare capacity IN THAT WEEK". Prior
// weeks' capacity is readable (`member_capacity` is keyed by week) but prior
// weeks' eligibility is not — `chore_exclusions` has no history — so the
// spare-capacity half is evaluated for THIS week, at placement time, where
// `allocate` checks it exactly (another eligible member within the
// tolerance). The cost, stated: a chore that went to A three weeks running
// because nobody else could take it counts as a run, and is then steered off
// A only if somebody else has room now. Recorded in docs/allocation-corpus.md.
//
// The fold is PURE and the allocator takes its output as an ARGUMENT
// (`steer`), the same discipline `allocate` keeps for capacity: nothing in
// allocation.js reads a table, so a corpus case can carry a steer the way it
// carries an eligibility predicate, and the rule can be argued about in
// `docs/allocation-corpus.md` rather than on a phone.
//
// "The same chore" across weeks is the repeat PARENT for an occurrence
// (`chores.generated_from`, `0012`) and the row id for a one-off — the same
// key the history row carries as `repeat_parent_id`. A one-off hand-moved off
// A is pinned on its new holder from then on and never dealt again, so in
// practice the signal reaches the allocator through repeats.
//
// THE CURRENT WEEK IS NOT EVIDENCE. Both windows are the weeks BEFORE the one
// being dealt: a deal-out re-runs on every capacity change, and a fold that
// counted this week's own placement would flip a chore off its holder on the
// Tuesday re-run for having landed on them on Monday — churn the owner did
// not ask for. Reading prior weeks only keeps the signal the same all week,
// which is the determinism `allocate` promises (#40 AC 6) carried one level
// up.

import { getSupabase } from './supabase.js'
import { priorPeriodStarts } from './capacity.js'

function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

/**
 * Every column `0049` grants, and the exact list the read asks for —
 * `LIVE_SCHEMA` imports it, so the live check asks what the app asks.
 */
export const ASSIGNMENT_HISTORY_COLUMNS =
  'id, household_id, chore_id, repeat_parent_id, from_member_id, to_member_id, from_source, source, actor_member_id, period_start, recorded_at'

/**
 * How many consecutive prior weeks a chore must have been dealt to the same
 * member before the allocator prefers somebody else for it — AC 2's "last
 * three auto allocations".
 *
 * Three, and bounded on both sides:
 *
 * - Not two. The allocator's tie-break is deterministic on purpose, so two
 *   weeks on the same person is what a tie LOOKS like, not a pattern; a rule
 *   firing on it would move a chore for no reason a person could see.
 * - Not four. `SUGGESTION_WINDOW_WEEKS` is four and a signal that needs a
 *   month of evidence before acting is one the household stops waiting for;
 *   the owner's words were "week after week", and three weeks is the
 *   smallest run that is a habit rather than a coincidence.
 *
 * Recorded in docs/allocation-corpus.md with the same reasoning.
 */
export const REPEAT_HOLDER_WEEKS = 3

/**
 * The window the moved-off signal reads, in prior weeks, and how many of
 * those weeks must carry a hand move off the same member — AC 3's "two of
 * the last three weeks".
 *
 * Two of three, not one of one: a single hand move is a week's circumstance
 * (somebody was away), and a rule acting on it would treat every correction
 * as a standing instruction. Not three of four: a person who has disagreed
 * with the split twice in three weeks has disagreed, and making them say so
 * a third time is the negotiation the charter says the product exists to
 * remove. And not wider than three weeks, so the steer stops within a month
 * of the household stopping the moves.
 *
 * Recorded in docs/allocation-corpus.md with the same reasoning.
 */
export const MOVED_OFF_WINDOW_WEEKS = 3
export const MOVED_OFF_MOVES = 2

/** The wider of the two windows — how far back the read goes. */
export const HISTORY_WINDOW_WEEKS = Math.max(REPEAT_HOLDER_WEEKS, MOVED_OFF_WINDOW_WEEKS)

/**
 * The history rows for one household from `since` (a Monday) up to but not
 * including `before` (the week being dealt).
 *
 * By household, not by member set (`0014`'s route, `household_id` granted):
 * a row must outlive the member it names, and a member-set scope would drop
 * exactly the rows that say "moved off them" the week they left.
 *
 * Bounded above as well as below, because the fold never reads the current
 * week (see the header) and PostgREST caps a read at the project's
 * `db-max-rows` with no error — an unbounded read would spend that cap on the
 * newest rows first, which are the inert ones, and drop the oldest prior week
 * silently. Three weeks of one household's assignment changes is tens of
 * rows, not a thousand, so the read is not paged; if a household ever
 * reaches the cap the steer degrades to "no run" for the dropped week rather
 * than to a wrong one (`holders.has(undefined)` below).
 */
export async function listAssignmentHistory(householdId, since, before) {
  if (!householdId) throw new Error('Which household? A history read must name one.')
  if (!since) throw new Error('A history read starts at a particular week.')
  if (!before) throw new Error('A history read stops at the week being dealt.')
  return (
    unwrap(
      await getSupabase()
        .from('chore_assignment_history')
        .select(ASSIGNMENT_HISTORY_COLUMNS)
        .eq('household_id', householdId)
        .gte('period_start', since)
        .lt('period_start', before)
        .order('recorded_at', { ascending: true }),
      'reading the assignment history',
    ) ?? []
  )
}

/** The key "the same chore across weeks" is read by. */
export function historyKeyOf(chore) {
  return chore.generated_from ?? chore.repeat_parent_id ?? chore.id
}

/**
 * The steer for each chore about to be dealt — `allocate`'s `steer` input.
 *
 * @param {object} input
 * @param {Array} input.history   rows from `listAssignmentHistory`
 * @param {Array<{id, key}>} input.chores
 *   the chores the allocator will PLACE (pins never reach it), each with the
 *   history key it is read under — `historyKeyOf` for a row
 * @param {string} input.periodStart  the week being dealt, `YYYY-MM-DD`
 * @returns {Array<{choreId, avoid: string[], kind, weeks}>} sorted by chore id
 *
 * `avoid` is a LIST. For `repeat` it holds the one member the run names; for
 * `movedOff` it holds every member the chore was moved off often enough,
 * most often first — because the allocator acts only when the member it is
 * about to choose is on the list, and a second member who also had the chore
 * moved off them twice would otherwise take it with no rule and no "why"
 * (review-fanout, 2026-09-18).
 *
 * Where both signals fire for one chore, `movedOff` wins: it is the stronger
 * claim (a person disagreed) and carries the stronger rule (last resort).
 */
export function steeringFor({ history, chores, periodStart }) {
  if (!periodStart) throw new Error('A steer is relative to a particular week.')
  const repeatWeeks = priorPeriodStarts(periodStart, REPEAT_HOLDER_WEEKS)
  const movedOffWeeks = new Set(priorPeriodStarts(periodStart, MOVED_OFF_WINDOW_WEEKS))
  const repeatWeekSet = new Set(repeatWeeks)

  // key → rows. Order is deliberately not consulted (see the header).
  const byKey = new Map()
  for (const row of history ?? []) {
    const key = row.repeat_parent_id ?? row.chore_id
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(row)
  }

  const steer = []
  for (const chore of chores ?? []) {
    const rows = byKey.get(chore.key) ?? []
    if (rows.length === 0) continue

    const movedOff = movedOffFrom(rows, movedOffWeeks)
    if (movedOff) {
      steer.push({ choreId: chore.id, ...movedOff })
      continue
    }

    const repeat = repeatHolderFrom(rows, repeatWeeks, repeatWeekSet)
    if (repeat) steer.push({ choreId: chore.id, ...repeat })
  }

  return steer.sort((a, b) => String(a.choreId).localeCompare(String(b.choreId)))
}

/**
 * Every member the allocator dealt the chore to and a person then moved it
 * OFF, in at least MOVED_OFF_MOVES distinct weeks of the window — most
 * weeks first, ties by id — or null when nobody qualifies.
 *
 * A move is `auto → manual` onto a DIFFERENT member — AC 3's words. An
 * unassign (`to` null) is not a move onto somebody, and a hand placement
 * onto the same person (`auto → manual`, same member) is a pin, not a
 * disagreement; neither counts. Weeks are counted, not rows, so two moves in
 * one week are one week's evidence.
 */
function movedOffFrom(rows, weeks) {
  const weeksByMember = new Map()
  for (const row of rows) {
    if (!weeks.has(row.period_start)) continue
    if (row.from_source !== 'auto' || row.source !== 'manual') continue
    if (row.from_member_id == null || row.to_member_id == null) continue
    if (row.from_member_id === row.to_member_id) continue
    if (!weeksByMember.has(row.from_member_id)) weeksByMember.set(row.from_member_id, new Set())
    weeksByMember.get(row.from_member_id).add(row.period_start)
  }

  const named = [...weeksByMember]
    .map(([memberId, moved]) => ({ memberId, weeks: moved.size }))
    .filter((entry) => entry.weeks >= MOVED_OFF_MOVES)
    .sort((a, b) => b.weeks - a.weeks || String(a.memberId).localeCompare(String(b.memberId)))
  if (named.length === 0) return null
  return { avoid: named.map((entry) => entry.memberId), kind: 'movedOff', weeks: named[0].weeks }
}

/**
 * The one member EVERY auto placement of the chore went to, in every one of
 * the last REPEAT_HOLDER_WEEKS weeks — or null if any week had no deal-out,
 * or any week's placements were split between members.
 *
 * A set per week, not the last row (see the header): a repeat with two
 * occurrences dealt to two people in one week is a week the chore did NOT
 * land on one person, whatever order the rows carry. A week with no auto
 * placement breaks the run rather than being skipped: "week after week" is
 * the owner's phrase, and a chore that was not dealt that week is a week
 * with no evidence either way. `holders` carries `undefined` for such a
 * week, so a missing week breaks the run by the same test as a split one —
 * there is no separate "every week present" guard to weaken (there was; a
 * mutation of it reddened nothing, because this test already refused it).
 */
function repeatHolderFrom(rows, weeks, weekSet) {
  const membersByWeek = new Map()
  for (const row of rows) {
    if (!weekSet.has(row.period_start)) continue
    if (row.source !== 'auto' || row.to_member_id == null) continue
    if (!membersByWeek.has(row.period_start)) membersByWeek.set(row.period_start, new Set())
    membersByWeek.get(row.period_start).add(row.to_member_id)
  }

  const holders = new Set(
    weeks.map((week) => {
      const members = membersByWeek.get(week)
      return members && members.size === 1 ? [...members][0] : undefined
    }),
  )
  if (holders.size !== 1 || holders.has(undefined)) return null
  return { avoid: [[...holders][0]], kind: 'repeat', weeks: weeks.length }
}
