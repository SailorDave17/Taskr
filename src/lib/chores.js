// The chore data layer — story #34.
//
// Same contract as household.js: nothing in this file is a security boundary.
// The rules that protect the data are the row-level policies and the column
// grants in supabase/migrations/0003_chores.sql. If a check below is deleted,
// the database still refuses; these only turn a Postgres constraint violation
// into a sentence a person can act on.
//
// The invariant this file exists to hold: a chore is a quantity of TIME.
// `expected_minutes` is the unit the fairness split divides, not a label on a
// to-do item, which is why the minutes bound is enforced here, in a check
// constraint, and in the form — three places, because it is the number the
// whole thesis rests on.

import { getSupabase } from './supabase.js'
import { currentHousehold } from './household.js'

/**
 * Unwrap a Supabase `{ data, error }` result.
 *
 * Deliberately a second copy of household.js's helper rather than an import of
 * it. Exporting it from there to here would make a module about households the
 * home of a generic utility, and the two are eight lines each; the duplication
 * is cheaper than the coupling. If a third caller appears, that is the moment
 * it earns its own module.
 */
function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

// The columns a client is allowed to read, matching the select grant in 0003
// exactly. `select('*')` FAILS on this table rather than quietly omitting a
// column — that is the intended behaviour of a column grant, and the reason this
// list is a constant rather than being spelled out at each call site.
//
// `household_id` is absent on purpose. It is written on insert and never read
// back: row-level security already guarantees every chore this device can see
// belongs to its household, so the value would be a constant the client can
// already name. 0003 carries the full reasoning.
export const CHORE_COLUMNS =
  'id, title, expected_minutes, due_on, created_at, completed_at, completed_by_member_id, assigned_member_id'

/** The bounds of `chores_expected_minutes_range`, named so the UI can say them. */
export const MIN_EXPECTED_MINUTES = 1
export const MAX_EXPECTED_MINUTES = 1440

/**
 * Minutes of work a chore is expected to take.
 *
 * Zero is refused rather than clamped up. A chore costing no time cannot be
 * allocated against a budget of minutes, so silently turning it into one minute
 * would put a meaningless row into the calculation the app's fairness claim
 * rests on — better to refuse it and let a person decide it is a note.
 */
export function normalizeExpectedMinutes(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error('How many minutes does this chore take?')
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Expected minutes must be a number.')
  if (!Number.isInteger(n)) throw new Error('Expected minutes must be a whole number of minutes.')
  if (n < MIN_EXPECTED_MINUTES) throw new Error('A chore has to take at least a minute.')
  if (n > MAX_EXPECTED_MINUTES) {
    throw new Error('That is more than a day of work — split it into smaller chores.')
  }
  return n
}

/**
 * A due date as the `date` column wants it: `YYYY-MM-DD`, no time, no zone.
 *
 * Deliberately string-in, string-out, and deliberately NOT via `new Date()`.
 * Parsing '2026-08-10' into a Date and formatting it back returns the previous
 * day for anyone west of UTC, because the parse is UTC-midnight and the format
 * is local — a chore due Monday would be stored as Sunday for half the world.
 * The column is a calendar date and this keeps it one all the way down.
 */
export function normalizeDueDate(value) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('When is this chore due?')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('A due date needs to look like 2026-08-10.')

  const [year, month, day] = text.split('-').map(Number)
  if (month < 1 || month > 12) throw new Error('That is not a real month.')
  // Round-trip through UTC to reject 31 February and friends, which the regex
  // above is happy with. UTC on both sides, so no zone can shift the answer.
  const asUtc = new Date(Date.UTC(year, month - 1, day))
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    throw new Error('That is not a real date.')
  }
  return text
}

/** A chore title the column will accept. */
export function normalizeTitle(value) {
  const title = String(value ?? '').trim()
  if (!title) throw new Error('A chore needs a name.')
  if (title.length > 80) throw new Error('That name is too long — 80 characters at most.')
  return title
}

/**
 * Every chore in this device's household, soonest first.
 *
 * Ordered by `due_on` then `created_at` so the order is total and therefore
 * stable: two chores due the same day would otherwise come back in whatever
 * order Postgres found them, and the list would reshuffle between refreshes for
 * no visible reason.
 */
export async function listChores() {
  return (
    unwrap(
      await getSupabase()
        .from('chores')
        .select(CHORE_COLUMNS)
        .order('due_on', { ascending: true })
        .order('created_at', { ascending: true }),
      'loading the chores',
    ) ?? []
  )
}

/**
 * Record a chore as a titled unit of expected minutes — AC 1.
 *
 * `household_id` is not a parameter. The UI does not get to choose which
 * household it writes into: it is read from this device's membership, and the
 * with-check policy in 0003 would refuse any other value anyway.
 */
export async function addChore({ title, expectedMinutes, dueOn }) {
  const cleanTitle = normalizeTitle(title)
  const minutes = normalizeExpectedMinutes(expectedMinutes)
  const due = normalizeDueDate(dueOn)

  const household = await currentHousehold()
  if (!household) throw new Error('This device has not joined a household.')

  return unwrap(
    await getSupabase()
      .from('chores')
      .insert({
        household_id: household.id,
        title: cleanTitle,
        expected_minutes: minutes,
        due_on: due,
      })
      .select(CHORE_COLUMNS)
      .single(),
    'adding the chore',
  )
}

/** Edit a chore's title, minutes or due date — AC 6. */
export async function updateChore(id, { title, expectedMinutes, dueOn }) {
  const patch = {}
  if (title !== undefined) patch.title = normalizeTitle(title)
  if (expectedMinutes !== undefined) patch.expected_minutes = normalizeExpectedMinutes(expectedMinutes)
  if (dueOn !== undefined) patch.due_on = normalizeDueDate(dueOn)

  // An empty patch would issue `update chores set` — a syntax error from
  // Postgres reported as "saving the change: ...", which reads like the row was
  // rejected rather than like nothing was asked for.
  if (Object.keys(patch).length === 0) throw new Error('Nothing to change.')

  return unwrap(
    await getSupabase().from('chores').update(patch).eq('id', id).select(CHORE_COLUMNS).single(),
    'saving the change',
  )
}

/**
 * Mark a chore done — #35.
 *
 * Through an RPC rather than an update, and the reason is the CLOCK rather than
 * access control: `completed_at` is set by `now()` inside the function, so a
 * phone with the wrong date cannot move work between weeks. The column is not
 * in the update grant at all, so this is not merely the preferred path — it is
 * the only one.
 */
export async function completeChore(id) {
  return unwrap(await getSupabase().rpc('complete_chore', { chore_id: id }), 'marking it done')
}

/** Undo a completion — the chore returns to the outstanding list. */
export async function uncompleteChore(id) {
  return unwrap(
    await getSupabase().rpc('uncomplete_chore', { chore_id: id }),
    'putting it back on the list',
  )
}

/**
 * Give a chore to a person - #36 AC 1.
 *
 * Through an RPC because `assigned_member_id` is absent from the update grant in
 * 0003/0006, so this is not the preferred path - it is the only one. A client
 * that could write the column directly would make the eligibility rule (#37),
 * the churn bound (#41) and every allocator invariant advisory.
 */
export async function assignChore(choreId, memberId) {
  return unwrap(
    await getSupabase().rpc('assign_chore', { chore_id: choreId, member_id: memberId }),
    'giving the chore to that person',
  )
}

/** Take a chore off whoever is holding it - #36 AC 4. */
export async function unassignChore(choreId) {
  return unwrap(
    await getSupabase().rpc('unassign_chore', { chore_id: choreId }),
    'taking the chore off that person',
  )
}

/** Is this chore still to do? The whole definition of outstanding, in one place. */
export function isOutstanding(chore) {
  return chore.completed_at === null || chore.completed_at === undefined
}

/**
 * Minutes of work still to do — #35 AC 5.
 *
 * Sums ONLY outstanding chores. A sum over every row is the defect this exists
 * to prevent: committed minutes that can only grow, so the load figure drifts
 * upward all week and any re-balance derived from it is computed over work
 * already finished.
 */
export function outstandingMinutes(chores) {
  return chores.filter(isOutstanding).reduce((sum, c) => sum + (c.expected_minutes || 0), 0)
}

/**
 * Minutes this person is still carrying - #36 AC 5.
 *
 * Computed at READ TIME by summing `expected_minutes` over that member's chores
 * with no completion, and there is deliberately no stored counterpart. A
 * `members.committed_minutes` column would be two sources for one quantity, and
 * they would disagree the first time a chore was completed on another phone;
 * 0006's comment carries the full argument and the pglite suite asserts the
 * absence of any such column rather than only the presence of this sum.
 *
 * Outstanding only, for the reason `outstandingMinutes` gives: a figure that
 * counts finished work can only grow, so it drifts upward all week and any
 * re-balance derived from it is computed over work already done.
 */
export function committedMinutes(chores, memberId) {
  // An absent member id returns zero rather than matching every UNASSIGNED
  // chore, which is what a bare `=== memberId` does: `assigned_member_id` is
  // null exactly when nobody holds the chore, so asking about "the null person"
  // silently returns the size of the unassigned pile. Nothing calls it that way
  // today - `commitmentByMember` always passes a real `member.id` - and it is
  // guarded here because the wrong answer is a plausible number rather than a
  // crash, which is how it would survive being read.
  if (memberId === null || memberId === undefined) return 0
  return chores
    .filter((c) => c.assigned_member_id === memberId && isOutstanding(c))
    .reduce((sum, c) => sum + (c.expected_minutes || 0), 0)
}

/**
 * Every member with what they are carrying and what is left - #36 AC 5, 6.
 *
 * CAPACITY ARRIVES AS AN ARGUMENT and this module never reads
 * `members.weekly_minutes`. That is #44 AC 7's rule, and it is enforced: a test
 * in capacity.test.js allowlists the three files permitted to name the column,
 * and its comment says the allowlist edit is where somebody should ask whether
 * the new reader ought to be calling `effectiveCapacity` instead. It ought to.
 * Reading the baseline here would have hard-coded capacity-as-constant into the
 * first screen that shows a fairness number - the exact thing the charter says
 * every competitor gets wrong.
 *
 * So `capacities` is the allocator's own shape, `{id, capacityMinutes}`, which
 * is what `capacitiesFor` returns. Today the caller builds it from baselines
 * because no override can exist yet; #46 changes that call site and nothing
 * here.
 *
 * In ROSTER order, because any other order is a ranking. AC 9 forbids
 * sort-by-load on the screen, and a sorted derivation would put a leaderboard
 * there through a function whose name says nothing about order.
 *
 * `remainingMinutes` GOES NEGATIVE and is not clamped. That is the whole point
 * of AC 6: the household must be able to see the fairness claim failing, and a
 * figure that stops at zero says "exactly full" for someone three hours over.
 * Note `formatMinutes` DOES clamp at zero, so a negative remainder must never be
 * handed to it - the screen decides the sign and passes only the magnitude.
 *
 * A member with no chores appears with committed 0 rather than being absent: the
 * person carrying nothing is the most important row on a fairness screen.
 */
export function commitmentByMember(members, chores, capacities) {
  const capacityOf = new Map(capacities.map((c) => [c.id, c.capacityMinutes]))
  return members.map((member) => {
    const committed = committedMinutes(chores, member.id)
    // A member absent from `capacities` is a caller bug, not a person with no
    // time - but this runs inside a render, where throwing replaces the screen
    // with nothing. `capacitiesFor` returns one entry per member and a test
    // pins that, which is where the gap is caught instead.
    const capacity = capacityOf.get(member.id) ?? 0
    return {
      member,
      capacityMinutes: capacity,
      committedMinutes: committed,
      remainingMinutes: capacity - committed,
    }
  })
}

/** Remove a chore — AC 6. */
export async function removeChore(id) {
  unwrap(await getSupabase().from('chores').delete().eq('id', id), 'removing the chore')
}

/**
 * "20" → "20m", "90" → "1h 30m". The same reading aid the roster uses.
 *
 * Re-exported from household.js rather than reimplemented: two formatters that
 * drift apart would show the same quantity two ways on one screen.
 */
export { formatMinutes } from './household.js'

// Still deliberately absent, now that the per-member figure has arrived (#36):
// any household-wide RANKING, share-of-capacity percentage, or ordering by load.
// The per-member numbers above are in roster order and nothing here sorts them.
//
// The percentage is #47's, not an oversight. This story owns the DERIVATION and
// says it in the ugliest form that is honest — plain minutes — because the
// charter's test is that a proposal must not be satisfiable by a screenshot of
// the 2020 all-users view. #47 replaces the presentation with share-of-own-
// capacity; replacing it is cheap, and un-shipping a leaderboard is not.
