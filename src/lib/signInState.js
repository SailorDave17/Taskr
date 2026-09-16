// Whether a member's sign-in has been accepted — #458.
//
// `members.claimed_by` says an auth account exists for a row. Since #341 that
// is true from the moment an invitation is SENT, so it cannot tell an organizer
// who has joined from who is sitting on an unopened email. `0045`'s
// `member_sign_in_states` reads the two facts that can, off `auth.users`.
//
// Its own module rather than an export of `household.js`, for #339's measured
// reason: `App.test.jsx` mocks `household.js` by spreading the real module
// first, so a new fetching export there would run for real in every App test.
// Here it has its own `vi.mock`, and its default there is "no read yet".

import { getSupabase } from './supabase.js'

/**
 * How long an emailed invitation link works: the live project's
 * `mailer_otp_exp = 3600`, measured and recorded in docs/deploy-runbook.md §2.
 * A client constant because GoTrue does not publish the figure to the browser;
 * `signInState.test.js` holds it to the runbook's sentence so the two cannot
 * part silently.
 */
export const INVITATION_LINK_LIFETIME_MS = 3600 * 1000

/**
 * The household's sign-in states, one row per CLAIMED member:
 * `{ member_id, invited_at, confirmed_at }`.
 */
export async function listSignInStates(householdId) {
  if (!householdId) throw new Error('Which household? A sign-in read must name one.')
  const { data, error } = await getSupabase().rpc('member_sign_in_states', {
    target_household: householdId,
  })
  if (error) {
    const err = new Error(`Could not read who has joined: ${error.message}`)
    err.cause = error
    throw err
  }
  return data ?? []
}

/**
 * What the roster should say about one member's sign-in.
 *
 *   { kind: 'none' }                      no account — `claimed_by` is null
 *   { kind: 'joined' }                    signed in, today's label (#458 AC 3)
 *   { kind: 'invited', sentAt, expiresAt } invitation out, link still live
 *   { kind: 'expired', sentAt }           invitation out, link past its hour
 *
 * `states` is null when the read has not answered — not applied yet, or
 * refused. That falls back to `joined`, which is what the roster said for every
 * claimed row before #458. It is the defect's own reading, and it is chosen
 * anyway: the alternative is calling every established member "invited" while
 * a read is down, which would send the organizer re-sending invitations to
 * people who joined months ago. The degraded case is a window before `0045`
 * is applied, not a steady state.
 *
 * A claimed member with no row is also `joined`: the function joins
 * `auth.users` on `claimed_by`, whose foreign key makes a missing account
 * impossible, so this is a read that raced a removal rather than a pending
 * invitation.
 */
export function signInStateFor(member, states, now = Date.now()) {
  if (!member?.claimed_by) return { kind: 'none' }
  if (!Array.isArray(states)) return { kind: 'joined' }
  const row = states.find((s) => s.member_id === member.id)
  if (!row || row.confirmed_at) return { kind: 'joined' }
  const sentAt = row.invited_at ?? null
  const sentMs = sentAt ? new Date(sentAt).getTime() : NaN
  if (Number.isNaN(sentMs)) {
    // Unconfirmed, with no usable invitation stamp. Still not signed in, and
    // there is no age to judge the link by, so it reads as outstanding.
    return { kind: 'invited', sentAt: null, expiresAt: null }
  }
  const expiresAt = sentMs + INVITATION_LINK_LIFETIME_MS
  if (now >= expiresAt) return { kind: 'expired', sentAt }
  return { kind: 'invited', sentAt, expiresAt }
}

/**
 * The next moment any row's label changes from invited to expired, or null.
 * The roster re-renders then, so a page left open does not keep calling a dead
 * link live (#458 AC 5).
 */
export function nextExpiry(members, states, now = Date.now()) {
  let soonest = null
  for (const member of members ?? []) {
    const state = signInStateFor(member, states, now)
    if (state.kind === 'invited' && state.expiresAt != null) {
      if (soonest === null || state.expiresAt < soonest) soonest = state.expiresAt
    }
  }
  return soonest
}
