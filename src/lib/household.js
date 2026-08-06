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
//      expected-vs-actual history in later stories reference THAT.
//   2. `claimed_by` is only ever "which device session is acting as this
//      person". An anonymous session expires after 30 days idle and the user
//      returns with a NEW auth id, so nothing durable may be keyed to it.

import { getSupabase } from './supabase.js'
import { assertPinShape } from './pin.js'

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
 * The signed-in session for this device, creating an anonymous one if needed.
 *
 * Anonymous auth is the household's access model (owner decision, #5): a device
 * gets an identity without anybody collecting an email address for a
 * nine-year-old. It is a *device* identity, not a person — who the device is
 * acting as is `claimMember` below.
 */
export async function ensureSession() {
  const supabase = getSupabase()

  const { data: existing } = await supabase.auth.getSession()
  if (existing?.session) return existing.session

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) {
    // Named explicitly because both of these present as a bug in our own code.
    // Anonymous sign-in is capped at 30/hour per IP and a whole household
    // shares one home NAT; and the provider is OFF by default, which fails with
    // a message that does not obviously say so.
    const hint = /rate|limit|429/i.test(error.message)
      ? 'Too many devices have joined from this network in the last hour. Wait and try again.'
      : 'The backend is not accepting new devices. Check that Anonymous Sign-Ins are enabled in Supabase → Authentication → Providers.'
    const err = new Error(hint)
    err.cause = error
    throw err
  }
  return data.session
}

/** The auth user id of this device session, or null if there is no session. */
export async function currentDeviceId() {
  const { data } = await getSupabase().auth.getUser()
  return data?.user?.id ?? null
}

/**
 * The household this device has joined, or null if it has not joined one.
 *
 * Read from the server every time. It is deliberately NOT cached in
 * localStorage: AC 3 requires that the roster survive a reinstall and a backend
 * restart because it lives in the hosted database, and a local copy would make
 * a passing check indistinguishable from a device that simply remembered.
 */
export async function currentHousehold() {
  const supabase = getSupabase()

  // A device sees its own membership row and nothing else, so an empty result
  // here means "not joined" rather than "no such household".
  const membership = unwrap(
    await supabase.from('household_devices').select('household_id').maybeSingle(),
    'checking whether this device has joined a household',
  )
  if (!membership) return null

  return unwrap(
    await supabase.from('households').select('*').eq('id', membership.household_id).maybeSingle(),
    'loading the household',
  )
}

/**
 * Create a household and put this device in it. Returns the household including
 * its join code, which is the credential the organizer reads out — AC 1.
 *
 * The insert is server-side (`create_household` runs as definer) because there
 * is no insert policy on `households` at all. A client cannot mint one.
 */
export async function createHousehold(name, { organizerName, organizerPin } = {}) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new Error('A household needs a name.')

  const organizer = (organizerName ?? '').trim()
  if (!organizer) throw new Error('The organizer needs a name — they are a person in the household too.')

  assertPinShape(organizerPin)

  // The organizer's own member row and PIN are created in the same statement as
  // the household. A PIN set afterwards would leave a window in which the
  // organizer cannot move to a new phone, and a household briefly without an
  // organizer is a household nobody can administer.
  return unwrap(
    await getSupabase().rpc('create_household', {
      household_name: trimmed,
      organizer_name: organizer,
      organizer_pin: String(organizerPin),
    }),
    'creating the household',
  )
}



/**
 * Join an existing household by code — AC 5.
 *
 * The code is normalised on both sides. `normalizeJoinCode` is in joinCode.js
 * and deliberately does not restate the alphabet; a wrong character is the
 * server's answer to give, and it gives the same answer for "no such code" and
 * "malformed" so a guesser learns nothing.
 */
export async function joinHousehold(code) {
  return unwrap(await getSupabase().rpc('join_household', { code }), 'joining the household')
}

// The columns a client is allowed to read. `pin_hash` is NOT among them — the
// grants in migration 0002 refuse it — so `select('*')` now fails outright.
// That is deliberate: a household sibling who can read the bcrypt hash can
// attack a four-digit PIN offline. `has_pin` is the generated boolean the UI
// actually needs.
const MEMBER_COLUMNS = 'id, household_id, display_name, weekly_minutes, claimed_by, has_pin, created_at'

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
  if (!household) throw new Error('This device has not joined a household.')

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

/**
 * Say "this device is this person" — the attribution AC 5 asks for.
 *
 * Server-side (`claim_member` takes FOR UPDATE) so two phones racing to claim
 * the same person serialise and the second is refused, rather than both reading
 * "unclaimed" and both writing.
 */
export async function claimMember(memberId) {
  return unwrap(await getSupabase().rpc('claim_member', { member_id: memberId }), 'picking who you are')
}

/**
 * Set or reset a person's PIN. Organizer only, enforced server-side — the check
 * here would be advice.
 *
 * A reset releases whichever phone is currently acting as that person, so a
 * child who has forgotten their PIN and a phone that has been handed on are the
 * same operation. That is the whole of the recovery story: there is no email to
 * send a reset link to, and deliberately so.
 */
export async function setMemberPin(memberId, pin) {
  assertPinShape(pin)
  return unwrap(
    await getSupabase().rpc('set_member_pin', { member_id: memberId, new_pin: String(pin) }),
    'setting the PIN',
  )
}

/**
 * Claim a person by proving you are them.
 *
 * Unlike `claimMember`, this deliberately succeeds when the person is already
 * claimed on another device — that is what a credential is for. The same child
 * on a new phone must be able to say so without an organizer reset, and holding
 * the PIN is what makes them the same child.
 */
export async function claimMemberWithPin(memberId, pin) {
  return unwrap(
    await getSupabase().rpc('claim_member_with_pin', { member_id: memberId, pin: String(pin ?? '') }),
    'signing in as this person',
  )
}

/**
 * Which member this device is acting as, or null.
 *
 * Derived by matching `claimed_by` against the live auth id rather than being
 * stored anywhere: if the anonymous session ever rolls over, this correctly
 * reports "nobody" and the user picks themselves again, instead of a stale
 * local value attributing work to the wrong person.
 */
export function findClaimedMember(members, deviceId) {
  if (!deviceId) return null
  return members.find((m) => m.claimed_by === deviceId) ?? null
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
