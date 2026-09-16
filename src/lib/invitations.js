// The invitation data layer — story #172.
//
// `0040` (#171) created `invitations` and `redeem_invitation` and shipped no
// client code at all. This file is BOTH halves: the organizer's (#172) — mint a
// code, list what is outstanding, withdraw one — and the redeemer's (#173),
// `redeemInvitation` below, which is the one call site of the function.
//
// ===========================================================================
// THE CODE EXISTS IN THIS PROCESS AND NOWHERE ELSE
// ===========================================================================
//
// `0040`'s AC 4 decision is that the row holds `token_hash` and the plaintext
// is stored in no column. So the mint below is the ONLY moment the spendable
// string exists anywhere: it is generated here, hashed here, and the hash is
// what crosses the wire. `mintInvitation` returns the plaintext to its caller
// precisely once, and if the organizer loses it the only repair is to mint
// another — which is the cost `0040`'s header names and accepts.
//
// Two consequences that are easy to undo by accident:
//
//   1. NOTHING may write the code into anything that outlives the render. Not
//      `localStorage`, not a logged error message, not a query parameter. The
//      whole point of storing a digest is defeated by a second copy.
//   2. `token_hash` is deliberately ABSENT from `INVITATION_COLUMNS`. The
//      organizer is granted select on it (`0040` grants the column) and has no
//      use for it: a digest cannot be displayed, read aloud or spent. Asking
//      for it would put the one scarce column on the wire on every refresh for
//      no reader.
//
// ===========================================================================
// THE NORMALISATION IS SHARED WITH THE DATABASE, AND THAT IS THE DRIFT RISK
// ===========================================================================
//
// `redeem_invitation` hashes `lower(btrim(code))` and `0040`'s own comment says
// why it lives there rather than in a client: "two normalisations in two places
// is one drift away from a code that cannot be redeemed". This file is the
// second place, unavoidably — the mint has to produce a digest the redemption
// will reproduce — so `normalizeInvitationCode` below is written to be that
// same function and `invitationMint.pglite.test.js` proves the pair agrees by
// minting through THIS code and redeeming through the REAL function. A unit
// test of either half alone cannot see a disagreement between them.

import { getSupabase } from './supabase.js'

/**
 * The alphabet a code is drawn from — 31 symbols, lower case.
 *
 * Owner decision at pickup, 2026-09-10: ten characters from this set, which is
 * ~8.2e14 combinations. `redeem_invitation` is executable by any signed-in
 * person, so the code is the only thing standing between an account and a
 * household it was not invited to; a shorter code would want a rate limit this
 * story does not build.
 *
 * WHAT IS MISSING FROM IT IS THE POINT. No `0` or `o`, no `1`, `l` or `i` —
 * the pairs somebody reading a code down a phone line or copying it off a
 * screen gets wrong. Lower case, and that is not a style choice: the displayed
 * string has to BE the hashed string after `lower(btrim(...))`, so a code shown
 * in upper case would hash differently from the way it reads. Typing it in
 * upper case still works, because the normalisation below lowers it.
 *
 * There is no separator character either, for a harder reason:
 * `redeem_invitation` normalises with `lower(btrim(code))` and nothing else, so
 * an internal hyphen or space would be part of the secret and a redeemer who
 * left it out — or added one — would be refused by a code that looked right.
 * The grouping a reader needs is done with letter-spacing in the stylesheet,
 * which changes how it looks and not what it is.
 */
export const INVITATION_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

/** How many characters a code carries. */
export const INVITATION_CODE_LENGTH = 10

/**
 * How long a minted code lasts — owner decision at pickup, 2026-09-10.
 *
 * Seven days, matching the default `0040`'s own pglite fixture uses. Long
 * enough that passing a code to somebody who is away for the week still works,
 * and `0040` refuses an unbounded row outright: `expires_at` is `not null` with
 * a check that it is after `created_at`, because a code that works forever is a
 * credential nobody remembers issuing.
 */
export const INVITATION_LIFETIME_DAYS = 7

/**
 * Whether a code can be SPENT yet — and so whether the organizer's card exists.
 *
 * TRUE SINCE #173 SHIPPED REDEMPTION, and it was false from #172 until then.
 * Owner decision 2026-09-10, at an escalation two review lenses raised
 * independently: #172's own issue said it and #173 "must reach a release
 * together", and a sentence was all that said so. `release` is promoted from
 * `develop` as a whole branch, so a promotion for ANY story between the two
 * would have put a "Create an invitation code" button in front of real
 * organizers with no screen anywhere that could redeem one — the shape cairn's
 * `a-ratified-dependency-is-not-an-owned-deliverable` records.
 *
 * So the coupling was code: App wires the card, and reads the list, only when
 * this is true, and #173's AC 10 is the criterion that flipped it — a visible
 * edit in that diff, never a default somebody forgot. `invitations.test.js`
 * pins the value either way, so the flip cannot happen by accident in either
 * direction. The constant stays rather than being folded away: the gate it
 * feeds is the record of WHY the two stories were coupled, and a future story
 * that has to switch redemption off (a compromised alphabet, say) has one line
 * to change.
 */
export const INVITATIONS_REDEEMABLE = true

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Columns the organizer reads — `token_hash` deliberately not among them.
 *
 * Imported by `liveSchema.js` rather than restated there, which is #78 AC 3:
 * the strings this module passes to `.select()` are the strings the live check
 * probes, so a column added to the read cannot drift away from the thing that
 * checks it.
 */
export const INVITATION_COLUMNS =
  'id, household_id, created_by_member_id, created_at, expires_at, withdrawn_at, redeemed_at, redeemed_by_member_id'

/**
 * The characters `redeem_invitation` strips from either end of a code — the
 * second argument of its `btrim`, since `0041`: space, tab, carriage return,
 * newline. Exactly these four, in this order, and `INVITATION_TRIM_SET` is the
 * one place the client spells them.
 */
export const INVITATION_TRIM_SET = ' \t\r\n'

/**
 * The trim as a pattern, BUILT from the set rather than spelled a second time
 * — review finding: a literal regex beside the constant made the constant
 * decorative, since widening one left the other unchanged with nothing red
 * between them. All four characters are safe unescaped inside a class.
 */
const TRIM_PATTERN = new RegExp(`^[${INVITATION_TRIM_SET}]+|[${INVITATION_TRIM_SET}]+$`, 'g')

/**
 * The same normalisation `redeem_invitation` applies —
 * `lower(btrim(code, E' \t\r\n'))` since `0041` (#173 AC 8).
 *
 * FOUR CHARACTERS AND NOT `trim()`, and the history is two corrections deep.
 * The first version used `String.prototype.trim()` under a docstring asserting
 * that `btrim` with one argument "strips spaces, tabs, newlines and carriage
 * returns". It does not: `btrim(string)` removes the longest run of characters
 * from its second argument, and that argument DEFAULTS TO A SINGLE SPACE.
 * *Measured 2026-09-10* in `invitationMint.pglite.test.js`: `'  K7M3QP4RWN\t'`
 * hashed by `trim()` and by `digest(lower(btrim(...)))` came out DIFFERENT — the
 * tab survived on the server and not here. So #172 narrowed this to spaces
 * only, to BE the server's function.
 *
 * Then #173 met the consequence at the other end: a code copied out of a
 * message arrives with its line ending, and `btrim(code)` left the newline in
 * the digest, so a correct code was refused as unusable. Owner decision at
 * #173's pickup (2026-09-11): widen the SERVER, in `0041`, to the four
 * characters a paste or a keyboard can put around a code — and widen this to
 * match, because this function's whole claim is still to be the server's
 * normalisation and nothing friendlier. `.trim()` would be wider than the
 * server again (every Unicode space), which is the first defect back.
 *
 * Matching exactly is what lets `invitationMint.pglite.test.js` assert
 * agreement on the inputs that DIFFER — a tab, a newline, a carriage return —
 * rather than only on the inputs the two happened to agree on.
 *
 * `lower()` and `toLowerCase()` agree on the alphabet, which is ASCII by
 * construction; they can differ on other scripts under some collations, and no
 * code this module mints contains one.
 *
 * Exported because the mint, the redemption and the cross-check all need
 * exactly this, and a second spelling of it is the drift this file's header is
 * about.
 */
export function normalizeInvitationCode(value) {
  return String(value ?? '')
    .replace(TRIM_PATTERN, '')
    .toLowerCase()
}

/**
 * A fresh code, drawn uniformly from `INVITATION_ALPHABET`.
 *
 * REJECTION SAMPLING, not `% 31`. 256 is not a multiple of 31, so the naive
 * modulo maps 256 byte values onto 31 symbols unevenly — the first eight
 * symbols would come up 9 times in 256 and the rest 8, which is a ~12% bias
 * towards a known quarter of the alphabet (8 of its 31 symbols) on every character. That is not a
 * theoretical complaint about a 10-character code: a bias the attacker knows is
 * exactly what makes a guessing order better than random. Bytes at or above 248
 * (the largest multiple of 31 below 256) are discarded and redrawn, so every
 * symbol is equally likely.
 *
 * `crypto.getRandomValues` and nothing else. `Math.random` is seeded and
 * predictable and has no business anywhere near a bearer secret;
 * `allocation.test.js` already refuses it by name in the allocator for a
 * weaker reason than this one.
 *
 * The source is injectable for the test that proves the rejection branch is
 * reached at all — a random generator cannot be asked to produce a 248 on
 * demand, so the one assertion that the discard works has to hand it one.
 */
export function generateInvitationCode(randomBytes = defaultRandomBytes) {
  const limit = Math.floor(256 / INVITATION_ALPHABET.length) * INVITATION_ALPHABET.length
  const out = []
  // Draw in batches rather than one byte at a time: the expected number of
  // discards over ten characters is under a third of one byte, so a single
  // batch of `INVITATION_CODE_LENGTH` almost always suffices and the loop is
  // there for the run that is unlucky rather than for the common case.
  while (out.length < INVITATION_CODE_LENGTH) {
    for (const byte of randomBytes(INVITATION_CODE_LENGTH)) {
      if (byte >= limit) continue
      out.push(INVITATION_ALPHABET[byte % INVITATION_ALPHABET.length])
      if (out.length === INVITATION_CODE_LENGTH) break
    }
  }
  return out.join('')
}

function defaultRandomBytes(count) {
  return globalThis.crypto.getRandomValues(new Uint8Array(count))
}

/**
 * `extensions.digest(lower(btrim(code)), 'sha256')`, in the form PostgREST
 * parses into a `bytea`.
 *
 * Postgres's hex input format for `bytea` is a literal backslash, an `x`, then
 * the bytes — so the string this returns begins `\x` and that backslash is a
 * character in the value rather than an escape in the wire format. Sent through
 * supabase-js it is ordinary JSON; PostgREST hands it to Postgres, which parses
 * it back to the same thirty-two bytes `digest()` would have produced
 * server-side. The round trip is what `invitationMint.pglite.test.js` proves.
 *
 * `crypto.subtle` is a secure-context API and the app is served over https;
 * *measured 2026-09-10*, this repo's jsdom test environment provides it and
 * agrees with the canonical SHA-256 of `abc`, so the unit tests exercise the
 * real primitive rather than a stub of it.
 */
export async function hashInvitationCode(code) {
  const normalized = normalizeInvitationCode(code)
  if (!normalized) throw new Error('An invitation code cannot be blank.')
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  )
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `\\x${hex}`
}

/** When a code minted at `now` stops working. */
export function invitationExpiryFrom(now = new Date()) {
  return new Date(now.getTime() + INVITATION_LIFETIME_DAYS * MS_PER_DAY).toISOString()
}

/**
 * The invitations this household has not ended — read by the organizer alone.
 *
 * FILTERED ON THE TWO STAMPS SERVER-SIDE AND ON THE EXPIRY CLIENT-SIDE, and
 * the split is deliberate. `withdrawn_at` and `redeemed_at` are facts: a row
 * carrying either is finished and no clock can disagree. Expiry is a comparison
 * against *a* clock, and the only one that decides anything is the server's
 * inside `redeem_invitation` — so filtering it here would be this device's
 * opinion dressed as a query. It is applied by `outstandingInvitations` below,
 * where it is plainly presentational.
 *
 * `household_id` is passed rather than rediscovered, the same rule as
 * `listMembers`: the caller passes the household it is actually showing, and
 * `invitations_select_organizer` refuses every row outside the caller's own
 * organized households regardless — so the filter is defence in depth over a
 * database guard and not the guard. A member who is not the organizer gets an
 * EMPTY array from this, not an error, because row-level security filters
 * rather than refuses.
 *
 * Newest first, which is the order `invitations_household_created_idx` carries
 * (`household_id, created_at desc`) — so the list the organizer reads walks the
 * index rather than sorting afterwards.
 */
export async function listInvitations(householdId) {
  if (!householdId) throw new Error('Which household? An invitation read must name one.')
  const { data, error } = await getSupabase()
    .from('invitations')
    .select(INVITATION_COLUMNS)
    .eq('household_id', householdId)
    .is('withdrawn_at', null)
    .is('redeemed_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    const err = new Error(`loading the invitations: ${error.message}`)
    err.cause = error
    throw err
  }
  return data ?? []
}

/**
 * Mint one, and hand the caller the only copy of the code — AC 1 and AC 2.
 *
 * Returns `{ code, invitation }`. The code is the plaintext and this is the one
 * time it is available; the row comes back so the list can show the new
 * invitation without waiting for a re-read to prove it exists.
 *
 * `createdByMemberId` is required and is the caller's OWN member row in this
 * household. `invitations_insert_organizer` checks exactly that — the row's
 * creator must be a member of the row's household claimed by `auth.uid()` — so
 * passing somebody else's id is refused by the database, which
 * `invitations.pglite.test.js` proves in both directions. It is an argument
 * rather than something this function discovers because the component already
 * holds `me` for the household on screen, and a second lookup here could
 * resolve against a different household from the one the organizer is looking
 * at. That is the fault #159 measured on `addMember`.
 */
export async function mintInvitation({ householdId, createdByMemberId, now = new Date() }) {
  if (!householdId) throw new Error('Which household? Minting an invitation must name one.')
  if (!createdByMemberId) throw new Error('An invitation records who minted it.')

  const code = generateInvitationCode()
  const { data, error } = await getSupabase()
    .from('invitations')
    .insert({
      household_id: householdId,
      token_hash: await hashInvitationCode(code),
      created_by_member_id: createdByMemberId,
      expires_at: invitationExpiryFrom(now),
    })
    .select(INVITATION_COLUMNS)
    .single()
  if (error) {
    const err = new Error(`creating the invitation: ${error.message}`)
    err.cause = error
    throw err
  }
  return { code, invitation: data }
}

/**
 * Withdraw one — AC 4.
 *
 * A STAMP, never a delete. `0040` grants no DELETE to any client role and
 * writes no delete policy, because the record that an invitation existed is how
 * the household knows one was issued. The only column this may write is
 * `withdrawn_at` (`grant update (withdrawn_at)`), so a caller that tried to
 * reach `redeemed_at` from here would be refused at the privilege layer before
 * any policy was consulted.
 *
 * The stamp comes from the SERVER clock, not from this device: `now()` inside
 * the update rather than an ISO string built here. It is a record of when a
 * credential was revoked and the device's clock is not evidence of anything.
 * PostgREST has no way to say "now()" in a value, so the literal is the
 * keyword-free spelling Postgres still resolves — see the constant below.
 */
export async function withdrawInvitation(id) {
  if (!id) throw new Error('Which invitation? Withdrawing must name one.')
  // `.select('id')` so the update SAYS which rows it changed — review finding,
  // two lenses. Without it an update matching nothing is indistinguishable from
  // one that worked: the invitation was redeemed on another phone (or already
  // withdrawn from another device), the filters below match no row, PostgREST
  // returns no error, and the organizer is told nothing while somebody has
  // already joined. `announce.js`'s writes read their rows back for the same
  // reason. The organizer may read `id` (`0040` grants it), so the row comes
  // back whenever the update really landed.
  const { data, error } = await getSupabase()
    .from('invitations')
    .update({ withdrawn_at: SERVER_NOW })
    .eq('id', id)
    .is('withdrawn_at', null)
    .is('redeemed_at', null)
    .select('id')
  if (error) {
    const err = new Error(`withdrawing the invitation: ${error.message}`)
    err.cause = error
    throw err
  }
  if (!data?.length) {
    throw new Error(
      'That code was already used or withdrawn, so there was nothing left to withdraw.',
    )
  }
}

/**
 * What PostgREST sends so that POSTGRES evaluates the clock.
 *
 * A value in a PostgREST payload is a literal, not an expression — so `now()`
 * would be stored as the text `now()` cast to `timestamptz`, which Postgres
 * accepts and resolves AT CAST TIME to the current transaction time. That is
 * the behaviour wanted here and it is obscure enough to be worth naming rather
 * than leaving as a bare string in the update above: `'now'` is a special input
 * value for the date/time types, documented alongside `'today'` and `'epoch'`,
 * and it is resolved by the server.
 *
 * `invitationMint.pglite.test.js` asserts the stamp it produces is the
 * database's time and not the caller's, because this is the kind of thing that
 * works by accident until a timezone changes.
 */
export const SERVER_NOW = 'now'

/**
 * Which invitations are still usable, by this device's clock — AC 3.
 *
 * Pure, so the expiry boundary can be driven directly. The rows handed in have
 * already had the two stamps filtered out server-side, so expiry is the only
 * thing left to decide and this is the presentational half of that decision.
 *
 * `>` and not `>=`, matching `redeem_invitation`'s `expires_at <= now()`
 * refusal: a row at exactly its expiry instant is refused there, so showing it
 * as outstanding here would put a code on screen the server would not accept.
 */
export function outstandingInvitations(rows, now = new Date()) {
  const cutoff = now.getTime()
  return (rows ?? []).filter((row) => new Date(row.expires_at).getTime() > cutoff)
}

/**
 * When an invitation was created or stops working, as a person reads it —
 * "Sep 10, 3:04 PM". AC 3.
 *
 * `busyComputedLabel`'s shape (calendar.js), with the TIME added, and the time
 * is not decoration. An organizer who mints two codes in one sitting — one
 * lost, one to replace it — sees two rows created on the same day, and the
 * minute is the only thing on screen that says which is which when they come
 * to withdraw the lost one.
 *
 * In the HOUSEHOLD's zone, for `busyComputedLabel`'s reason: both columns are
 * instants, and the honest way to say when one happened is to ask the
 * household's clock rather than the phone's.
 *
 * Null for an unreadable value rather than throwing, so a timestamp the app
 * cannot parse costs the label beside a row and never the row itself.
 */
export function invitationDateLabel(at, timeZone) {
  if (!at || !timeZone) return null
  const instant = new Date(at)
  if (Number.isNaN(instant.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant)
  } catch {
    return null
  }
}

/**
 * The message a shared code travels in — owner decision at the design-bar
 * pass, 2026-09-10, when the Share button was added.
 *
 * THE CODE AND ITS TERMS, AND NOTHING ELSE. `docs/data-outside-production.md`,
 * Decision 4 clause 2: a typed code MUST NOT name the household before it is
 * redeemed, because a code travels — forwarded, screenshotted — and whoever
 * ends up holding it is not the person the organizer chose. Clause 3: no
 * household contents and not the id. So this takes the code as its ONLY
 * argument: there is no route by which a household name, an inviter's name or
 * an id could reach the message, and `invitations.test.js` asserts the arity.
 */
export function invitationShareText(code) {
  return `Your Taskr invitation code is ${code}. It works once, within ${INVITATION_LIFETIME_DAYS} days.`
}

/**
 * What the redeemer is told when a code is refused — #173 AC 2 and AC 3.
 *
 * THE SERVER SAYS ONE SENTENCE FOR FOUR STATES, AND SO DOES THIS. `0040`
 * section 4 and `docs/data-outside-production.md` Decision 4 clause 4: no such
 * code, expired, withdrawn and already-redeemed all raise `that invitation
 * cannot be used`, because four distinguishable refusals are an oracle —
 * "withdrawn" tells whoever is guessing codes that they found a real one. AC 3
 * asks that each be "refused with its own message"; owner decision at #173's
 * pickup (2026-09-11): the surface's message is ONE sentence that names the
 * three possibilities without saying which applied, so the person knows what
 * to do (ask for a fresh code) and a guesser learns nothing. It names no
 * household and no id, which `invitations.test.js` asserts against every
 * refusal below.
 *
 * `alreadyMember` is the one refusal that necessarily says something, and it is
 * reachable only by somebody already inside (`0040`). The invitation is NOT
 * spent on that path — the function checks membership before the lock — and
 * the sentence says so, because "the code was used" is the reading a person
 * would otherwise take from a refusal.
 *
 * `signedOut` cannot be reached from this app's screens — every entry point to
 * redemption is behind a session — but the function has that branch and a
 * sentence for it is cheaper than a sentence about a JSON error.
 */
export const INVITATION_REFUSALS = Object.freeze({
  unusable:
    'That code cannot be used — it may have expired, been withdrawn, or already been used. Ask whoever gave it to you for a fresh one.',
  alreadyMember: 'You are already in that household, so the code was left unused.',
  signedOut: 'Sign in first, then enter the code.',
})

/**
 * The sentence for a `redeem_invitation` refusal, keyed on the function's OWN
 * words rather than on an error code — the three `raise exception` texts in
 * `0040`, which `invitations.pglite.test.js` pins. Anything else is a fault
 * (a network failure, an unapplied migration) and is reported as one, with the
 * server's message, because a fault dressed as a refusal would tell somebody
 * with a perfectly good code to go and ask for another.
 */
export function describeRedemptionRefusal(error) {
  const message = String(error?.message ?? '')
  if (message.includes('that invitation cannot be used')) return INVITATION_REFUSALS.unusable
  if (message.includes('you are already in that household')) return INVITATION_REFUSALS.alreadyMember
  if (message.includes('not authenticated')) return INVITATION_REFUSALS.signedOut
  return `Could not use that code: ${message || 'no reason was given'}`
}

/**
 * Spend a code and join its household — #173 AC 1 and AC 6.
 *
 * THROUGH THE FUNCTION AND NOTHING ELSE. `members_insert_same_household`
 * requires a membership the redeemer does not have, and `claimed_by` is in no
 * client insert grant, so a client insert against `members` is refused twice
 * over before any policy is read (`0040` section 4, proven in
 * `invitations.pglite.test.js`). This function therefore issues exactly one
 * statement, the RPC, and `invitations.test.js` asserts through a recording
 * client that no `.from('members')` is ever built on this path. The function
 * is `security definer` and runs as its owner; the caller's identity reaches
 * it as `auth.uid()` from the session, which is why there is no argument for
 * WHO is joining.
 *
 * NORMALISED HERE AND AGAIN ON THE SERVER — the same four-character trim and
 * the same lowering, by `normalizeInvitationCode`, which is written to be the
 * server's function. Sending the normalised form is not a second opinion: the
 * server would produce the same digest from the raw input. It is done here so
 * that a blank code is refused with a sentence about the field rather than a
 * round trip, and so that what crosses the wire is the ten characters and not
 * the line ending that came with them.
 *
 * Resolves to the member row the function created — `returns public.members`,
 * which PostgREST serves as one object — and the caller reads `household_id`
 * off it to make the joined household the active one (AC 1's "the app
 * switches to it") before the re-read that follows every write.
 */
export async function redeemInvitation(code) {
  const normalized = normalizeInvitationCode(code)
  if (!normalized) throw new Error('Type the invitation code first.')
  const { data, error } = await getSupabase().rpc('redeem_invitation', { code: normalized })
  if (error) {
    const err = new Error(describeRedemptionRefusal(error))
    err.cause = error
    throw err
  }
  return data
}
