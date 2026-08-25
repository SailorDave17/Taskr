// Who cannot do a chore — story #37.
//
// Same contract as chores.js and household.js: NOTHING IN THIS FILE IS A
// SECURITY BOUNDARY, and here the point is sharper than usual, because this
// module has a namesake in the database that IS one.
//
// `supabase/migrations/0010_chore_exclusions.sql` defines `is_member_eligible`
// and `eligible_members` in SQL, and those are the authority — they are what a
// transactional allocator RPC (#40, #49) evaluates inside its own transaction,
// where no JavaScript is running at all. The functions below are the SCREEN's
// copy: which name to draw beside a chore, whom to leave out of a picker, whom
// to warn about. If the two ever disagree, the SQL is right and this is a
// rendering bug.
//
// That is why the pure helpers here take the exclusion ROWS as an argument
// rather than asking the database a question per pair. The rows are read once
// per refresh, exactly like chores and members, and every derivation on the
// screen is a fold over them — so the screen cannot be in a state where half its
// answers came from one read and half from another.

import { getSupabase } from './supabase.js'
import { currentHousehold } from './household.js'

/**
 * Unwrap a Supabase `{ data, error }` result.
 *
 * A third copy of the eight-line helper household.js and chores.js each carry.
 * chores.js's own comment said the duplication was cheaper than the coupling and
 * that "if a third caller appears, that is the moment it earns its own module" —
 * this is the third caller, and the module is deliberately still not extracted:
 * this copy adds a translation the other two do not want (see below), so a
 * shared helper would need a hook on its first day. The note is left here rather
 * than quietly ignored, because the next person to add a fourth should extract
 * it and will want to know this one is not a plain copy.
 */
function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    // 23505 is `unique_violation`, and on this table it can only be
    // `chore_exclusions_one_per_pair`: somebody recorded the same pair twice.
    // The screen never offers an already-excluded person, so this arrives only
    // when two devices act at once — and "duplicate key value violates unique
    // constraint" is a sentence about Postgres, where the person wants a
    // sentence about their household. The row they wanted exists either way,
    // which is why this is a plain statement and not an apology.
    if (error.code === '23505') {
      throw new Error('That person is already marked as unable to do this chore.')
    }
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

// The columns a client may read, matching the select grant in 0010 exactly.
// `household_id` is absent for the reason 0003 gives and 0005 repeats: it is
// written on insert, never read back, and withholding it is what makes
// `select('*')` fail loudly on this table instead of quietly returning a shape
// nobody checked.
export const EXCLUSION_COLUMNS = 'id, chore_id, member_id, created_at'

/**
 * Every exclusion this device's household has recorded.
 *
 * Not filtered by chore. The chore screen renders every chore at once, so a
 * per-chore read would be one round trip per row to answer a question the whole
 * set answers in one — and the set is bounded by the pairs a household has
 * actually bothered to record, which is the count this story's whole shape
 * exists to keep near zero.
 */
export async function listExclusions() {
  return (
    unwrap(
      await getSupabase().from('chore_exclusions').select(EXCLUSION_COLUMNS),
      'loading who cannot do what',
    ) ?? []
  )
}

/**
 * Record that a member cannot do a chore — AC 2.
 *
 * A plain insert rather than an RPC, and the difference from `assign_chore` is
 * worth stating because the two look alike. `assigned_member_id` moves through
 * a definer function because the ALLOCATOR's invariants depend on that column
 * having one write path (0006 argues it at length). An exclusion is an INPUT to
 * those invariants rather than one of them: the rule about who may set it is the
 * household trust boundary and nothing more, which is exactly what a row-level
 * policy expresses. So this is `member_capacity`'s shape, not `chores`'.
 *
 * `household_id` is not a parameter for `addChore`'s reason: the UI does not
 * choose which household it writes into, and the with-check policy in 0010 would
 * refuse any other value anyway.
 */
export async function excludeMember(choreId, memberId) {
  if (!choreId) throw new Error('Which chore cannot they do?')
  if (!memberId) throw new Error('Who cannot do it?')

  const household = await currentHousehold()
  if (!household) throw new Error('You are not signed in to a household.')

  return unwrap(
    await getSupabase()
      .from('chore_exclusions')
      .insert({ household_id: household.id, chore_id: choreId, member_id: memberId })
      .select(EXCLUSION_COLUMNS)
      .single(),
    'recording that they cannot do this chore',
  )
}

/**
 * Undo one — the pair becomes eligible again.
 *
 * A delete rather than a flag, because 0010 grants no UPDATE on this table at
 * all: an exclusion has no editable content, and a "revoked" column would be a
 * second way to express eligibility that the SQL predicate would then have to
 * agree with. One representation, and absence is the default.
 */
export async function allowMember(choreId, memberId) {
  unwrap(
    await getSupabase()
      .from('chore_exclusions')
      .delete()
      .eq('chore_id', choreId)
      .eq('member_id', memberId),
    'letting them do this chore again',
  )
}

/**
 * Is this pair excluded? The JavaScript mirror of `is_member_eligible`, inverted.
 *
 * An absent member id returns FALSE — not excluded — rather than matching a row
 * whose `member_id` is null. The caller asks with a null on every render, because
 * an unassigned chore has no assignee; `committedMinutes` guards the same shape
 * for the same reason, that the wrong answer would be a plausible boolean rather
 * than a crash and would therefore survive being read.
 *
 * WHAT THE MUTATION PASS MEASURED, and it is worth knowing before deleting this
 * line: removing the guard reddens **nothing** against rows this schema can
 * produce. `chore_id` and `member_id` are both `not null` in `0010`, so no row a
 * client can receive carries one, and the comparison is false either way. That
 * makes it an unexercised defence — which is byte-identical to dead code to
 * whoever is next tidying up. It is kept rather than deleted (the guard is about
 * the ARGUMENT, and an argument arrives from the screen rather than from the
 * table), and `exclusions.test.js` gives it a SYNTHETIC control: a malformed row
 * the database could not have sent, so the defence is observable at all.
 */
export function isExcluded(exclusions, choreId, memberId) {
  if (!choreId || !memberId) return false
  return exclusions.some((x) => x.chore_id === choreId && x.member_id === memberId)
}

/** The member ids excluded from one chore, in no particular order. */
export function excludedMemberIds(exclusions, choreId) {
  if (!choreId) return []
  return exclusions.filter((x) => x.chore_id === choreId).map((x) => x.member_id)
}

/**
 * The members who may do a chore — the mirror of `eligible_members`.
 *
 * In ROSTER order, for `commitmentByMember`'s reason: any other order is a
 * ranking, and a household must not be able to read "who is most eligible" off a
 * list that was only ever meant to say who is allowed.
 *
 * Returns the EMPTY ARRAY when everyone is excluded, rather than falling back to
 * the whole roster. The SQL function makes the same choice and 0010 says why:
 * falling back hides an impossible allocation from the one caller that could
 * report it.
 */
export function eligibleMembers(members, exclusions, choreId) {
  const excluded = new Set(excludedMemberIds(exclusions, choreId))
  return members.filter((m) => !excluded.has(m.id))
}
