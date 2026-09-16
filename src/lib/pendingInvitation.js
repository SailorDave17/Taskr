/**
 * The invitation this DEVICE is holding for somebody who has not signed in
 * yet — the code and the name they chose — #173 AC 4 and AC 5.
 *
 * THE ROUND TRIP THIS EXISTS FOR. A person is handed a code by text, opens the
 * app, and has no account. Creating one means `signUp`, and on the live
 * project (`mailer_autoconfirm: false`, measured 2026-08-26) that returns no
 * session until they leave the app for their inbox and come back through the
 * confirmation link. What they typed before leaving has to survive that —
 * AC 4 says the code is "applied without being re-typed" — and nothing in a
 * React render survives a navigation to a mail app and back.
 *
 * THE MECHANISM IS `localStorage` ON THIS DEVICE, AND THAT IS Q14'S ANSWER.
 * Owner decision at #173's pickup, 2026-09-11, taken at a clickable question
 * against two alternatives, both worth recording so the choice reads as one:
 *
 *   * AUTH USER METADATA — send the code as `options.data` on `signUp`, so it
 *     rides in `auth.users` and comes back in any browser. Rejected: it puts
 *     the plaintext code in the database, which `0040`'s AC 4 decision
 *     forbids for exactly this class of secret (the row holds a digest so
 *     that "the plaintext exists nowhere in the database"); and GoTrue writes
 *     no metadata for an address that already has an account, so the
 *     returning-member path would have needed this file anyway.
 *   * THE CONFIRMATION URL — carry it in `emailRedirectTo`. Rejected outright:
 *     the code would travel through the email, Supabase's logs and the
 *     browser's history, and `invitations.js`'s first rule is that nothing
 *     writes the code into anything that outlives the render — "not a query
 *     parameter" is in its own words.
 *
 * WHAT THIS GUARANTEES, STATED SO AC 5 CAN ASSERT IT. The code is applied on
 * the first signed-in boot IN THE BROWSER THAT ENTERED IT. A confirmation link
 * opened in a DIFFERENT browser — the phone's mail app handing the link to a
 * browser that is not the one the code was typed into — finds nothing here,
 * and the person lands on the no-household screen with the join form, where
 * they type the code again. That is the whole guarantee: same browser,
 * automatic; another browser, once more by hand. `App.test.jsx` asserts both
 * halves explicitly rather than leaving the second to a passing happy path.
 *
 * THE NAME RIDES WITH IT (owner decision at the design pass, 2026-09-11).
 * `redeem_invitation` writes the member row as `New member` — `0040` has no
 * name to write, and #191's rule is that the recipient names themselves — so
 * the join forms ask for the name beside the code, and App renames the row
 * through the ordinary `updateMember` grant once the redemption has landed.
 * A signed-out person types both before leaving for their inbox; both are
 * held here, so the person arrives in the household under the name they
 * chose rather than as a placeholder they then have to edit.
 *
 * ONE VALUE, CLEARED ON THREE EVENTS. Written only when a signed-out person
 * enters a code, so a plain load stores nothing (`activeHousehold.js`'s rule,
 * and the reason #210's "a reload starts clean" test still reads
 * `localStorage.length === 0`). Cleared when the code is redeemed, when it is
 * refused (a refused code re-tried on every boot would be a loop), and on
 * sign-out — this is a household app and a shared tablet is likely, so a code
 * one person entered must not be spent by the next person who signs in on it.
 * An unredeemed code expires on the server within seven days whatever this
 * device remembers, so a stale value costs one refusal and is then gone.
 *
 * NOT `sessionStorage`, because a link opened from a mail app lands in a NEW
 * tab and `sessionStorage` is per tab — the code would be gone in precisely
 * the case it exists for.
 *
 * EVERY ACCESS IS WRAPPED, for `activeHousehold.js`'s reason (#165 AC 8):
 * private mode, cleared site data and a browser refusing storage throw on the
 * accessor itself, and a device that cannot remember degrades to the
 * different-browser case above — the person types the code again — rather
 * than to a broken boot.
 */

import { normalizeInvitationCode } from './invitations.js'

/**
 * The key. Says what it holds — an invitation waiting to be applied — and is
 * deliberately neither `taskr.household` nor `taskr.members`, the two names
 * `App.test.jsx`'s "reads the household from the server on every load" test
 * asserts absent (the same rule `activeHousehold.js` records).
 */
const KEY = 'taskr.pendingInvitation'

/**
 * How long a stored code may be. A code is ten characters; the bound refuses
 * a value that was never a code (a colliding key, a devtools edit) without
 * this file knowing the alphabet — that is the server's to judge, and a wrong
 * code costs one refusal.
 */
const MAX_CODE_LENGTH = 64

/** The roster's own bound on a display name (`maxLength={40}` on every name field). */
const MAX_NAME_LENGTH = 40

/** The storage this device offers, or null where it offers none. */
function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The name as it will be written: trimmed, bounded, and never blank. */
export function normalizePendingName(value) {
  const name = String(value ?? '').trim()
  return name && name.length <= MAX_NAME_LENGTH ? name : ''
}

/**
 * The invitation this device is holding — `{ code, name }`, both normalised —
 * or null.
 *
 * Null covers every failure identically: nothing stored, storage unavailable,
 * and a value that cannot be a held invitation. A value that fails the shape
 * is DISCARDED as it is read, so junk cannot sit there being re-rejected on
 * every boot.
 */
export function readPendingInvitation() {
  const store = storage()
  if (!store) return null
  let stored = null
  try {
    stored = store.getItem(KEY)
  } catch {
    return null
  }
  if (!stored) return null
  let parsed = null
  try {
    parsed = JSON.parse(stored)
  } catch {
    parsed = null
  }
  const code = normalizeInvitationCode(parsed?.code)
  const name = normalizePendingName(parsed?.name)
  if (!code || code.length > MAX_CODE_LENGTH || !name) {
    clearPendingInvitation()
    return null
  }
  return { code, name }
}

/**
 * Hold an invitation for the person who is about to sign in or sign up.
 *
 * Stored NORMALISED — the four-character trim and the lowering the server
 * applies to the code, and a trimmed name — so what comes back is what will
 * be sent, and the line ending a paste carried never reaches storage. A blank
 * or oversized value stores nothing and returns false, so the caller can say
 * so rather than promising a code that is not there.
 */
export function writePendingInvitation({ code, name } = {}) {
  const normalizedCode = normalizeInvitationCode(code)
  const normalizedName = normalizePendingName(name)
  if (!normalizedCode || normalizedCode.length > MAX_CODE_LENGTH || !normalizedName) return false
  const store = storage()
  if (!store) return false
  try {
    store.setItem(KEY, JSON.stringify({ code: normalizedCode, name: normalizedName }))
    return true
  } catch {
    // A full or refused quota is the different-browser case: the person will
    // type the code again once signed in. Nothing to repair here.
    return false
  }
}

/** Forget the held invitation — on redemption, on refusal, and on sign-out. */
export function clearPendingInvitation() {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(KEY)
  } catch {
    // A device that cannot forget also could not have remembered.
  }
}
