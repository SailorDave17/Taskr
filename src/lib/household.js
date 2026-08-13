// The household data layer — story #5, PR 2 of 2.
//
// Everything the UI is allowed to know about the backend lives here. The rules
// that actually protect the data are NOT in this file and cannot be: they are
// the row-level security policies in supabase/migrations/0001_household_and_roster.sql,
// and docs/access-model.md explains why a client-side guard is not a guard.
// Nothing below is a security boundary. If a call in this file is removed, the
// database still refuses; that is the whole design.
//
// Two invariants carried over from the migration, because getting them wrong
// here would quietly undo them:
//
//   1. `members.id` is the durable person. Chores, completions and the
//      expected-vs-actual history in later stories reference THAT. This is
//      unchanged by #62 and is the reason that story was cheap: nothing
//      durable was ever keyed to an auth id, so per-member sign-in migrated
//      identity without migrating history.
//   2. `claimed_by` is the person's AUTH USER — since #62, and it used to be
//      the opposite. It meant "which device session is acting as this person",
//      and could not be relied on because an anonymous session expired after 30
//      idle days and returned with a new auth id. A real credential returns the
//      same auth user every time, which is what let `household_devices` go and
//      what makes this column the sole input to every policy in the schema.

import { getSupabase } from './supabase.js'

/**
 * Unwrap a Supabase `{ data, error }` result.
 *
 * Throws rather than returning a null the caller has to remember to check. The
 * UI has exactly one error path as a result, and a forgotten check cannot
 * present as an empty roster — which would read as "the household is empty"
 * when it actually means "the query failed".
 */
function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

/**
 * The signed-in session, or null. It no longer creates one — #62.
 *
 * Under device auth this was `ensureSession()`, and it signed the DEVICE in
 * anonymously so that a phone always had an identity before it had a person.
 * That is exactly what per-member sign-in removes: an identity now belongs to
 * somebody, and there is no such thing as being signed in as nobody. So a phone
 * with no session is a normal state that the UI answers with a sign-in screen,
 * not a condition to be repaired behind the user's back.
 *
 * Renamed rather than reused. `ensureSession` promised to return a session and
 * this returns null routinely; leaving the old name on the new behaviour would
 * have every caller's null-check read as defensive rather than load-bearing.
 */
export async function currentSession() {
  const { data } = await getSupabase().auth.getSession()
  return data?.session ?? null
}

/**
 * Sign a person in with the credential they hold.
 *
 * Both kinds go through here. A member with a real address types it; a member
 * without one has a synthetic `<members.id>@taskr.invalid` address they never
 * see, and their PIN is the password — so from this function's point of view
 * there is one flow, and `members.email` is the only thing that differs.
 */
export async function signIn({ email, password }) {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: String(email ?? '').trim(),
    password: String(password ?? ''),
  })
  if (error) {
    // Two failures are named, and everything else is deliberately collapsed.
    //
    // COLLAPSED: a wrong password and an unknown address. Supabase answers those
    // identically on purpose and this keeps the property rather than helpfully
    // undoing it — a household is a small closed set of people, so "no such
    // account" tells a guesser which addresses exist.
    //
    // NAMED, because neither is a credential problem and both are otherwise
    // unactionable:
    //
    //   - `email_not_confirmed`. Leaving it collapsed tells somebody with the
    //     RIGHT password to try again forever, or to reset a password that was
    //     never wrong. It leaks nothing: GoTrue validates the password BEFORE
    //     checking confirmation state, so this code only ever reaches a caller
    //     who already proved they hold the credential.
    //   - the rate limit. `ensureSession` carried this branch and it was dropped
    //     when the call changed to `signInWithPassword` — but the reasoning did
    //     not stop applying: a household shares one home NAT, so several people
    //     signing in on one evening are one IP, and "that did not match" sends
    //     them hunting a credential fault that does not exist.
    const code = error.code || ''
    let hint = 'That email and password did not match. Try again.'
    if (code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) {
      hint =
        'That account still needs its email confirmed. Check the inbox for the link — ' +
        'the password was right.'
    } else if (code === 'over_request_rate_limit' || /rate limit|429/i.test(error.message)) {
      hint =
        'Too many sign-in attempts from this network in the last hour — a household shares ' +
        'one connection, so this counts everyone. Wait and try again; nothing is wrong with ' +
        'the password.'
    }
    const err = new Error(hint)
    err.cause = error
    throw err
  }
  return data.session
}

/**
 * Register the organizer's own account, which is the one signup a client may do.
 *
 * The distinction is the whole reason #62 needs an Edge Function. `signUp()`
 * signs the CALLER in as the account it creates, so an organizer using it to
 * make a child's account would be signed out of their own and into the child's.
 * That is fine here and only here, because the account being created IS the
 * caller's. Everybody else is provisioned server-side with the `service_role`
 * key, which must never reach this bundle — `src/lib/keyShape.js` fails the
 * build over it.
 */
export async function signUpOrganizer({ email, password }) {
  const { data, error } = await getSupabase().auth.signUp({
    email: String(email ?? '').trim(),
    password: String(password ?? ''),
  })
  if (error) {
    const err = new Error(`Could not create your account: ${error.message}`)
    err.cause = error
    throw err
  }
  // Null when the project requires email confirmation. Not an error and not
  // something this app can work around — say so plainly rather than leaving the
  // caller with a session-shaped null.
  if (!data.session) {
    throw new Error(
      'Your account was created but needs email confirmation before you can sign in. ' +
        'Check your inbox, or turn off email confirmation in Supabase → Authentication → Providers.',
    )
  }
  return data.session
}

/** End the session on this phone. */
export async function signOut() {
  const { error } = await getSupabase().auth.signOut()
  if (error) {
    const err = new Error(`Could not sign out: ${error.message}`)
    err.cause = error
    throw err
  }
}

/**
 * The auth user id of the signed-in person, or null.
 *
 * Was `currentDeviceId`. The value it returns changed meaning in #62 — it used
 * to identify a phone's anonymous session and now identifies a PERSON — and the
 * old name would have gone on reading correctly while meaning something else,
 * which is the kind of drift this repo has already paid for once.
 */
export async function currentUserId() {
  const { data } = await getSupabase().auth.getUser()
  return data?.user?.id ?? null
}

/**
 * The household the signed-in person belongs to, or null if they belong to none.
 *
 * Read from the server every time. It is deliberately NOT cached in
 * localStorage: AC 3 requires that the roster survive a reinstall and a backend
 * restart because it lives in the hosted database, and a local copy would make
 * a passing check indistinguishable from a device that simply remembered.
 */
export async function currentHousehold() {
  const supabase = getSupabase()

  // One read, not two. Under device auth this resolved `household_devices`
  // first and then fetched the household by id, because the device's membership
  // row was the only thing it could see. #62 dropped that table: membership is
  // now `members.claimed_by = auth.uid()`, and `households_select_joined`
  // resolves it inside the policy — so selecting households returns the
  // caller's own and nothing else, and an empty result means "not signed in as
  // anybody" rather than "no such household".
  //
  // `limit(1)` rather than a bare `maybeSingle()`: the membership predicate
  // returns a set, so a person could in principle belong to two households, and
  // `maybeSingle()` treats a second row as an error rather than as a choice.
  // One household per person is today's product decision, not a schema
  // guarantee, and this read should not be the thing that discovers otherwise.
  const rows = unwrap(
    await supabase.from('households').select('*').limit(1),
    'loading the household',
  )
  return rows?.[0] ?? null
}

/**
 * Create a household, with the caller as its organizer — AC 1.
 *
 * The join code it used to return went with #62: admission is no longer a shared
 * secret anybody holding it can spend, it is an account provisioned per person.
 *
 * The insert is server-side (`create_household` runs as definer) because there
 * is no insert policy on `households` at all. A client cannot mint one.
 */
export async function createHousehold(name, { organizerName } = {}) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new Error('A household needs a name.')

  const organizer = (organizerName ?? '').trim()
  if (!organizer) throw new Error('The organizer needs a name — they are a person in the household too.')

  // The organizer's own member row is created in the same statement as the
  // household, claimed by them. That is what stops a household being born
  // unreachable: under #62's predicate a household with no claimed member is
  // visible to NOBODY, including the person who just made it, so a second round
  // trip to attach the organizer would leave a window with no way out of it.
  //
  // No PIN argument any more. 0007 takes the signature back to three arguments
  // and the third is the TIMEZONE — the same position the PIN used to occupy,
  // which is why passing the old shape did not fail cleanly: `organizer_pin`
  // landed in the timezone slot and the household was refused with `not a known
  // timezone: 4821`, an error that names neither the caller's mistake nor the
  // migration.
  //
  // The timezone still goes in the SAME statement, for #44's reason. A week
  // boundary is a local-time fact and the household's zone decides it; setting
  // it afterwards can fail on its own and would leave the household filing
  // capacity under UTC weeks nobody lives in.
  return unwrap(
    await getSupabase().rpc('create_household', {
      household_name: trimmed,
      organizer_name: organizer,
      household_timezone: deviceTimezone(),
    }),
    'creating the household',
  )
}

/**
 * The IANA zone this device is in, for a household that has not stated one.
 *
 * Falls back to UTC rather than throwing: a browser with no resolved zone is
 * rare and is not a reason to refuse to create a household, and 0005 makes the
 * value correctable by any member afterwards.
 */
export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}


// The columns a client is allowed to read, and `select('*')` still fails
// outright — 0002 established that by revoking wholesale and granting per
// column, and 0007 re-issued the grant keeping one column back so that stays
// true. It very nearly stopped being true: the refusal was a side effect of
// withholding `pin_hash`, so dropping that column would have made `select('*')`
// quietly succeed while this comment went on claiming otherwise. `household_id`
// is the withheld column now, as it already was on `chores` and
// `member_capacity` — a client learns its household from `households`.
//
// What changed in #62: `pin_hash` and its generated boolean `has_pin` are gone
// with the credential they described, and `email` takes their place. It is not
// a like-for-like swap. `has_pin` told the UI which sign-in control to draw;
// `email` says which KIND of credential a member has — an address means a real
// one and a longer secret, null means a synthetic `<id>@taskr.invalid` address
// and a PIN, and there is deliberately no second flag that can disagree with
// it. Reading it is safe in a way `pin_hash` never was: it identifies a person,
// it does not authenticate them.
export const MEMBER_COLUMNS = 'id, display_name, weekly_minutes, claimed_by, email, created_at'

/** Everyone in this device's household, oldest first so the order is stable. */
export async function listMembers() {
  return (
    unwrap(
      await getSupabase().from('members').select(MEMBER_COLUMNS).order('created_at', { ascending: true }),
      'loading the roster',
    ) ?? []
  )
}

/**
 * Add a person with their weekly available minutes — AC 2.
 *
 * `household_id` is not passed by the caller. The UI does not get to choose
 * which household it writes into: it is read from this device's membership, and
 * the insert policy would refuse any other value anyway.
 */
export async function addMember({ displayName, weeklyMinutes }) {
  const name = (displayName ?? '').trim()
  if (!name) throw new Error('A person needs a name.')

  const household = await currentHousehold()
  if (!household) throw new Error('You are not signed in to a household.')

  return unwrap(
    await getSupabase()
      .from('members')
      .insert({
        household_id: household.id,
        display_name: name,
        weekly_minutes: normalizeMinutes(weeklyMinutes),
      })
      .select(MEMBER_COLUMNS)
      .single(),
    'adding the person',
  )
}

/** Edit a person's name or weekly minutes — AC 4. */
export async function updateMember(id, { displayName, weeklyMinutes }) {
  const patch = {}
  if (displayName !== undefined) {
    const name = displayName.trim()
    if (!name) throw new Error('A person needs a name.')
    patch.display_name = name
  }
  if (weeklyMinutes !== undefined) patch.weekly_minutes = normalizeMinutes(weeklyMinutes)

  return unwrap(
    await getSupabase().from('members').update(patch).eq('id', id).select(MEMBER_COLUMNS).single(),
    'saving the change',
  )
}

/** Remove a person from the roster — AC 4. */
export async function removeMember(id) {
  unwrap(await getSupabase().from('members').delete().eq('id', id), 'removing the person')
}

// `claimMember`, `setMemberPin` and `claimMemberWithPin` were here until #62.
//
// All three are gone rather than deprecated, because 0007 drops the RPCs they
// called: keeping a wrapper would turn a compile-time absence into a runtime
// `PGRST202 function not found`, discovered by a child on a phone. Identity is
// no longer something a client asks for at all — it is written by the Edge
// Function as `service_role`, and `members.claimed_by` is absent from the client
// update grant precisely so this file cannot have a fourth attempt at it.

/**
 * Which member this device is acting as, or null.
 *
 * Derived by matching `claimed_by` against the live auth id rather than being
 * stored anywhere: if the anonymous session ever rolls over, this correctly
 * reports "nobody" and the user picks themselves again, instead of a stale
 * local value attributing work to the wrong person.
 */
export function findClaimedMember(members, userId) {
  if (!userId) return null
  return members.find((m) => m.claimed_by === userId) ?? null
}

/**
 * Minutes a person has available in a week.
 *
 * Clamped to the same bounds as the column's check constraint so a typo is
 * refused with a sentence rather than a Postgres constraint violation. The
 * database remains the authority; this only improves the message.
 */
export function normalizeMinutes(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Weekly minutes must be a number.')
  const rounded = Math.round(n)
  if (rounded < 0) throw new Error('Weekly minutes cannot be negative.')
  if (rounded > 10080) throw new Error('There are only 10080 minutes in a week.')
  return rounded
}

/** "120 min/week" → "2h 0m", for a roster that is read at a glance. */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}
