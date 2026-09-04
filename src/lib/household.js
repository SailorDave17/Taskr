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
 * The same, plus the two member-write failures that are worth naming — #242.
 *
 * Both come from constraints `0007` added with `members.email`, and both reach
 * the organizer as a Postgres string if nothing translates them. Named here
 * rather than in the component because the constraint is the authority and the
 * component is not: the client's own check below is a courtesy that saves a
 * round trip, and this is what happens when the database disagrees with it.
 */
function unwrapMemberWrite(result, whatWeWereDoing) {
  try {
    return unwrap(result, whatWeWereDoing)
  } catch (err) {
    const hint = describeMemberWriteFailure(err.cause)
    if (!hint) throw err
    const friendly = new Error(hint)
    friendly.cause = err.cause
    throw friendly
  }
}

function describeMemberWriteFailure(error) {
  const code = error?.code ?? ''
  const text = `${error?.message ?? ''} ${error?.details ?? ''}`

  // `members_email_key` is a unique index on `lower(email)` over the WHOLE
  // table, not per household — deliberately, because the address ends up being
  // an auth identity and GoTrue's own uniqueness is global too. So the sentence
  // must not say "in this household": a collision with somebody in a household
  // this organizer cannot see is exactly the case they cannot diagnose.
  if (code === '23505' || /members_email_key|duplicate key/i.test(text)) {
    return 'That email address is already on a roster entry. An address identifies one person across all of Taskr, so this one needs a different address.'
  }
  if (code === '23514' || /members_email_shape/i.test(text)) {
    return 'That does not look like an email address — it needs an @ with a dot somewhere after it.'
  }
  return null
}

/**
 * An address for a member row, or `undefined` to leave the column alone — #242.
 *
 * Three inputs, three answers, and the middle one is the one worth stating:
 *
 * - `undefined` → `undefined`. The caller is not talking about the address.
 * - `''` or blank → `null`. The caller IS talking about it and is clearing it,
 *   which is what null means on this column: no real inbox, so a synthetic
 *   `<id>@taskr.invalid` address and a PIN (`0007`'s own column comment).
 * - anything else → trimmed and lower-cased.
 *
 * Lower-cased because the uniqueness index is on `lower(email)` while the shape
 * check is case-blind, so `Alex@` and `alex@` are one person to the database and
 * two to a reader. Storing the folded form makes the roster agree with the index
 * rather than merely not contradicting it — and GoTrue folds the address anyway
 * when the Edge Function mints an account from it, so the alternative is a
 * roster that displays something the person does not actually type.
 *
 * The shape mirrors `members_email_shape` from `0007`. It is a courtesy, not the
 * guard: the constraint refuses the write whatever this function does, and
 * `describeMemberWriteFailure` above is what a reader sees when it does.
 */
export function normalizeMemberEmail(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  const folded = trimmed.toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(folded)) {
    throw new Error('That does not look like an email address — it needs an @ with a dot somewhere after it.')
  }
  return folded
}

/**
 * The address this member signs in with — #242.
 *
 * There is no name-based sign-in and there never was: `signIn` above calls
 * `signInWithPassword`, so the address is half the credential. A member with a
 * real address types it; a member without one signs in with the synthetic form,
 * and the organizer has to be able to READ it or nobody can be admitted at all.
 * `access-model.md` described that address as one they "never see or type",
 * which was a design intention that the sign-in form has never been able to
 * honour.
 *
 * THIS MIRRORS A RULE THAT LIVES IN THE EDGE FUNCTION. `provision-member` is
 * Deno and cannot import this module, so `syntheticAddressFor` there and this
 * are two copies of one rule. `gate.test.js` asserts they still agree — the
 * copies cannot be merged, so the next best thing is that they cannot drift
 * silently.
 *
 * On an already-provisioned member this is a PREDICTION of what the account was
 * minted as rather than a reading of it: the address lives in `auth.users`,
 * which no client may read. It is right for every account this app has ever
 * minted, because `members.email` could not be set until now — and it is wrong
 * the moment somebody changes an address in the Supabase dashboard, which is
 * why the roster labels it as the address they were GIVEN rather than asserting
 * what auth currently holds.
 */
export function signInAddressFor(member) {
  const real = typeof member?.email === 'string' ? member.email.trim() : ''
  return real || `${member?.id}@taskr.invalid`
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
 * Start signing in with Google — #304.
 *
 * Supabase's own OAuth flow, through the client this app already has: the
 * browser leaves for `/auth/v1/authorize?provider=google`, Google hands the
 * grant to Supabase's callback, and Supabase sends the person back to the
 * origin they left from with the session in the URL FRAGMENT, which the client
 * reads on the next boot. There is no second OAuth client and no ID-token
 * exchange here — the client id and secret live in the Supabase dashboard
 * (`docs/deploy-runbook.md` §3b), so nothing new is inlined into the bundle.
 *
 * IMPLICIT, NOT PKCE — owner decision 2026-09-04, recorded on #304. The issue
 * asked for PKCE, and in supabase-js the flow type is a CLIENT-WIDE setting:
 * `flowType: 'pkce'` makes `signUp` send a code challenge too (measured in
 * auth-js 2.112.1), so every confirmation email (#129) would come back as a
 * `?code=` that only exchanges in the browser that signed up. Keeping the
 * default keeps confirmation working from any device — and it means this app
 * never exchanges a code at all, so a `?code=` on the root is the calendar's
 * (#95) or nobody's. `readSignInReturn` below and `readConsentReturn` in
 * calendar.js are the two halves of that rule.
 *
 * `redirectTo` is the origin the person is on, for the reason
 * `confirmationRedirectTo` gives — a dev server comes back to the dev server —
 * and it has to be in the project's Redirect URLs list or Supabase falls back
 * to Site URL (production). Preview origins are excluded on purpose: the same
 * decision, seen a third time.
 *
 * Who this reaches is decided by Supabase, not here. A Google address equal to
 * a member's confirmed sign-in address resolves to the SAME auth user
 * (same-verified-email linking), so the roster does not change; a Google
 * address matching nobody gets a fresh auth user with no household, which is
 * the state invitation redemption (#173/#191) later attaches. A member on a
 * synthetic `<id>@taskr.invalid` address can never match a Google account and
 * keeps their PIN.
 *
 * WHAT THE PERSON SEES AT GOOGLE is not this app's name: the consent screen
 * names the redirect URI's domain, `<project ref>.supabase.co`, and the only
 * fix is Supabase's paid custom domain (cairn:
 * google-consent-screen-names-the-callback-domain). Recorded so nobody hunts
 * a misconfiguration.
 */
export async function signInWithGoogle() {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: confirmationRedirectTo() },
  })
  if (error) {
    const err = new Error(`Could not start signing in with Google: ${error.message}`)
    err.cause = error
    throw err
  }
}

/**
 * The failure Supabase put on the URL when a sign-in did not complete, or null.
 *
 * Two shapes, both landing on the app ROOT, because `redirectTo` and Site URL
 * both point there:
 *
 *   - `#error=…&error_code=…&error_description=…` in the FRAGMENT: a provider
 *     refusal (Google said no, or the account is not one of the consent
 *     screen's registered test users), or an expired confirmation link. This
 *     is the implicit flow's error channel, the counterpart of the
 *     `#access_token` it puts there on success.
 *   - `?error=…&error_code=…` in the QUERY, with NO `state`: GoTrue's
 *     bad-flow-state redirects (`bad_oauth_state`, `bad_oauth_callback`,
 *     `flow_state_already_used`) come from middleware that never read the
 *     flow, so they go to Site URL as a query string whatever flow started
 *     them. Probed live 2026-09-04: `GET /auth/v1/callback?state=probe` is a
 *     303 to the production root carrying exactly this shape (cairn:
 *     gotrue-provider-callback-errors-bypass-redirect-to).
 *
 * THE DISCRIMINATOR AGAINST THE CALENDAR — #304 AC 4. Google echoes the
 * calendar's own `state` (calendar.js `startConnect`) on every return, success
 * or refusal, and Supabase's returns never carry one. So a query carrying
 * `state` is the calendar's and is not read here; a query without one is not
 * the calendar's, and `readConsentReturn` refuses it. A `?code=` with no state
 * is therefore NOBODY'S — this app never exchanges a code (see
 * `signInWithGoogle`) — and both readers leave it alone rather than one of them
 * guessing. Before this, a stale Google sign-in landing as `?error=…` was
 * reported as "Google could not complete that connection".
 *
 * `error_code` is the contract and `error_description` is prose: GoTrue
 * rewords descriptions without versioning them, so `describeSignInReturn`
 * branches on the code and quotes the description only as a fallback.
 */
export function readSignInReturn(location = globalThis.location) {
  const fragment = new URLSearchParams(String(location?.hash ?? '').replace(/^#/, ''))
  if (fragment.get('error') || fragment.get('error_code') || fragment.get('error_description')) {
    return {
      error: fragment.get('error'),
      code: fragment.get('error_code'),
      description: fragment.get('error_description'),
      source: 'fragment',
    }
  }
  const query = new URLSearchParams(String(location?.search ?? ''))
  if (query.get('state')) return null
  if (query.get('error') || query.get('error_code')) {
    return {
      error: query.get('error'),
      code: query.get('error_code'),
      description: query.get('error_description'),
      source: 'query',
    }
  }
  return null
}

// GoTrue's codes for a flow that is gone rather than refused — the 5-minute
// window from pressing the control, a state Google mangled, a state used twice.
// Keyed on `error_code`, never on the description (see readSignInReturn).
const STALE_FLOW_CODES = new Set([
  'bad_oauth_state',
  'bad_oauth_callback',
  'flow_state_already_used',
  'flow_state_not_found',
  'flow_state_expired',
])

/**
 * The sentence for a sign-in return, in words the person can act on — #304.
 *
 * Two things arrive as `access_denied` and cannot be told apart from here: the
 * person pressing Cancel at Google, and Google refusing an account the consent
 * screen has not been opened to — it is in Testing, so only the registered
 * test users get past it (`docs/deploy-runbook.md` §3b step 2). The sentence
 * fits both and names who can fix the second: the organizer, not Supabase and
 * not Google. It is NOT the collapsed "did not match" sentence — that one is
 * about a credential, and nothing here was a credential.
 *
 * An expired confirmation link also arrives as `access_denied`, with
 * `error_code=otp_expired` — that is #129's flow, not this one, and it falls
 * through to the generic sentence, which quotes GoTrue's own description
 * ("Email link is invalid or has expired") rather than inventing a second one.
 */
export function describeSignInReturn({ error, code, description }) {
  if (error === 'access_denied' && code !== 'otp_expired') {
    return (
      'Google did not sign you in. If Google said this app has not been opened to your ' +
      'account, the organizer is the one who can add it — ask them. Or sign in with your ' +
      'password here.'
    )
  }
  if (STALE_FLOW_CODES.has(code)) {
    return 'That Google sign-in took too long or was already used — press Continue with Google again.'
  }
  return `Sign-in did not complete: ${description || error || 'no reason was given'}.`
}

/**
 * Where a confirmation email's link should land: the origin it was asked from — #129.
 *
 * Supabase's **Site URL** is a single global value, so with nothing passed here
 * every confirmation link goes to whatever that one field says. *Measured
 * 2026-08-21*, that field was still `http://localhost:3000` — the factory
 * default, never changed — and a real organizer clicked a real link and landed
 * on a dead page. The owner corrected the field the same day; this function is
 * the half that stops the class rather than the instance.
 *
 * Reading `window.location.origin` is the point: a signup driven from
 * `npm run dev` comes back to the dev server, and one driven from production
 * comes back to production, without either depending on a dashboard field being
 * right. The value the link carries is fixed at SEND time, which is also why
 * this cannot be repaired after the fact for an email already in an inbox.
 *
 * **Preview origins are deliberately not in Supabase's Redirect URLs list, and
 * that is a decision rather than an omission.** #121 put Vercel preview
 * deployments behind Standard Protection precisely so they are not a public
 * surface; adding `*.vercel.app` to the allow-list would sanction as an auth
 * redirect target the thing that was just walled off, and the allow-list is
 * matched against this value. So a signup driven from a preview deployment
 * falls back to Site URL — a link to production, which is a mild surprise
 * rather than a hole. Do not "fix" that by widening the list without revisiting
 * #121; the two are one decision seen twice.
 *
 * Returns `undefined` rather than a string when there is no `window` (the test
 * environment, or any non-browser caller). `undefined` is what makes
 * supabase-js fall back to Site URL, which is the correct behaviour with no
 * origin to speak of — a hard-coded default here would be the very constant
 * this story exists to remove.
 */
export function confirmationRedirectTo() {
  const origin = globalThis.window?.location?.origin
  return origin ? String(origin) : undefined
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
 *
 * `emailRedirectTo` is derived, never a constant — see `confirmationRedirectTo`
 * above for why, and for why preview origins are excluded on purpose (#129).
 *
 * Resolves to `{ session, needsConfirmation }`. On the live project the session
 * is always null and the flag always true, because confirmation is on; the
 * caller says so and does NOT go on to create a household (#154).
 */
export async function signUpOrganizer({ email, password }) {
  const { data, error } = await getSupabase().auth.signUp({
    email: String(email ?? '').trim(),
    password: String(password ?? ''),
    options: { emailRedirectTo: confirmationRedirectTo() },
  })
  if (error) {
    const err = new Error(`Could not create your account: ${error.message}`)
    err.cause = error
    throw err
  }
  // Null when the project requires email confirmation — which it does:
  // `mailer_autoconfirm: false`, measured live 2026-08-26 (#154). That is the
  // ORDINARY outcome of this call against the real project, not a fault, so it
  // is reported as a named result rather than thrown. This function threw here
  // until #154, which made every first signup against production end in an
  // error the person could do nothing about, with an account already created
  // underneath it.
  //
  // Not a bare `data.session` either: a caller handed a session-shaped null has
  // to remember to check it, and the failure surfaces three steps later as
  // "not signed in". The flag is the claim, spelled out.
  //
  // GoTrue answers a signup for an address that ALREADY has an account, with
  // confirmations on, exactly like a fresh one — obfuscated user, no session,
  // no error — so that this call cannot be used to list who has an account.
  // `needsConfirmation` is therefore also what a returning person sees if they
  // take the sign-up route by mistake, and the screen's wording fits both.
  return { session: data.session ?? null, needsConfirmation: !data.session }
}

/**
 * End the session, on this device only or everywhere.
 *
 * The scope is passed EXPLICITLY and is not the library's default, which is
 * `global` — supabase-js signs out every session for the account on every
 * device unless told otherwise. That default was never chosen here: it shipped
 * because nobody wrote an argument, and it meant tidying up the kitchen tablet
 * silently locked the same person out on their phone (#291).
 *
 * `local` is the right default for THIS app because a session is a person and
 * the devices are a household's: a family sharing a tablet hands it over
 * without anybody losing the phone in their pocket. `global` stays reachable
 * because the one case that genuinely wants it — a lost or stolen device — is
 * a case the person cannot reach the device to fix.
 *
 * @param {{ everywhere?: boolean }} [options] `everywhere: true` revokes every
 *   session for this account, on every device, including this one.
 */
export async function signOut({ everywhere = false } = {}) {
  const scope = everywhere ? 'global' : 'local'
  const { error } = await getSupabase().auth.signOut({ scope })
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
export async function listHouseholds() {
  const supabase = getSupabase()

  // One read, not two. Under device auth this resolved `household_devices`
  // first and then fetched the household by id, because the device's membership
  // row was the only thing it could see. #62 dropped that table: membership is
  // now `members.claimed_by = auth.uid()`, and `households_select_joined`
  // resolves it inside the policy — so selecting households returns the
  // caller's own and nothing else, and an empty result means "not signed in as
  // anybody" rather than "no such household".
  //
  // PLURAL, AND ORDERED — #159 AC 2. This read carried `.limit(1)` with no
  // `order by` until then, which is not "the first household" but "whichever row
  // Postgres handed back first". With one household that is stable by accident;
  // with two it is a coin toss that can land differently on consecutive reads of
  // unchanged data, and every screen downstream inherits the toss.
  //
  // The old comment was right that `maybeSingle()` would be worse — it treats a
  // second row as an error rather than as a choice — and right that a person
  // could in principle belong to two households. What it got wrong was the
  // conclusion: it kept `limit(1)` and left the CHOICE unmade, so the code that
  // knew a set was possible was the code that silently picked from it.
  //
  // `created_at` then `id`: the second key is not decoration. Two households
  // created inside the same clock tick would otherwise re-open exactly the
  // ambiguity this ordering exists to close, and `id` is the only column
  // guaranteed distinct.
  return (
    unwrap(
      await supabase
        .from('households')
        .select('*')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      'loading your households',
    ) ?? []
  )
}

/**
 * The household the app is currently showing.
 *
 * THIS IS THE SEAM the household switcher replaces. Today "active" means "first
 * of the ordered set", which is a deliberate placeholder and not a product
 * decision: there is no affordance for choosing yet, and #159 ships before that
 * affordance exists precisely so the scoping is proven correct before anything
 * makes a second household reachable by accident.
 *
 * For anyone in exactly one household this returns what `.limit(1)` returned and
 * every screen renders identically — #159 AC 9. That is what lets this land this
 * early: under one household it changes nothing observable, so it carries no
 * release risk while removing all of it from the stories that follow.
 */
export async function currentHousehold() {
  const households = await listHouseholds()
  return households[0] ?? null
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


// The columns a client is allowed to read. 0002 established the shape by
// revoking wholesale and granting per column, and 0007 re-issued it.
//
// `select('*')` NO LONGER FAILS on this table — #159, and this is the sentence
// that had to change. It used to fail, and the refusal was doing real work as a
// loud signal that the grant was per-column. That rested entirely on `members`
// having exactly one withheld column, `household_id`, and 0014 grants it: the
// client must be able to NAME a household to filter by one, and #157 measured
// that no mechanism reaches around that (a PostgREST embed is refused 42501 with
// no filter at all, so it is the join that needs the column).
//
// So the narrower property this list still holds, which is the one to rely on
// now: THE GRANT IS PER COLUMN, AND ADDING A COLUMN IS A DECISION. A column
// added by a later migration is not readable until somebody writes it into a
// grant, and `grants.pglite.test.js` holds this constant against the live column
// set so the omission fails in CI rather than in a household. What is gone is
// the wildcard's loud refusal, not the per-column control.
//
// The near-miss recorded here before is worth keeping, because it is the same
// hazard from the other side: the refusal was once a side effect of withholding
// `pin_hash`, so dropping that column would have made `select('*')` quietly
// succeed while this comment went on claiming otherwise. This time the same
// sentence went false, deliberately, in a commit that corrected it.
//
// `chores`, `member_capacity`, `chore_exclusions` and `calendar_connections`
// each keep a withheld column and keep the wildcard refusal with it — 0014 is
// free on `chores` for exactly that reason.
//
// What changed in #62: `pin_hash` and its generated boolean `has_pin` are gone
// with the credential they described, and `email` takes their place. It is not
// a like-for-like swap. `has_pin` told the UI which sign-in control to draw;
// `email` says which KIND of credential a member has — an address means a real
// one and a longer secret, null means a synthetic `<id>@taskr.invalid` address
// and a PIN, and there is deliberately no second flag that can disagree with
// it. Reading it is safe in a way `pin_hash` never was: it identifies a person,
// it does not authenticate them.
export const MEMBER_COLUMNS =
  'id, household_id, display_name, weekly_minutes, claimed_by, email, created_at'

/**
 * Everyone in ONE named household, oldest first so the order is stable.
 *
 * `householdId` is required — #159 AC 1. This read filtered by nothing until
 * then and leaned on row-level security, which was correct while a person could
 * belong to one household and stops being correct the moment they can belong to
 * two: the policy returns every row the caller MAY see, and that set is no
 * longer one household. The rows were never exposed to the wrong person; they
 * were merged into one roster, which is a correctness failure rather than a
 * security one.
 *
 * The filter is defence in depth, not the guard. `members_select_same_household`
 * still refuses rows outside the caller's own households whatever is passed
 * here, so a wrong id returns nothing rather than somebody else's roster.
 */
export async function listMembers(householdId) {
  if (!householdId) throw new Error('Which household? A roster read must name one.')
  return (
    unwrap(
      await getSupabase()
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('household_id', householdId)
        .order('created_at', { ascending: true }),
      'loading the roster',
    ) ?? []
  )
}

/**
 * Add a person with their weekly available minutes — AC 2, and #159 AC 4.
 *
 * `householdId` is now passed in rather than rediscovered here. The old shape
 * called `currentHousehold()` itself, which was the same unordered `.limit(1)`
 * the reads used — so with two households a person could be added to a
 * different one from the roster that was on screen when the button was pressed,
 * and nothing anywhere would have disagreed.
 *
 * The UI still does not get to choose freely: the caller passes the household it
 * is actually showing, and `members_insert_same_household` refuses any id
 * outside `current_household_ids()` regardless — so this is defence in depth
 * over a database guard, not the guard itself (#159 AC 5).
 */
export async function addMember({ displayName, weeklyMinutes, householdId, email }) {
  const name = (displayName ?? '').trim()
  if (!name) throw new Error('A person needs a name.')
  if (!householdId) throw new Error('Which household? Adding a person must name one.')

  const address = normalizeMemberEmail(email)

  return unwrapMemberWrite(
    await getSupabase()
      .from('members')
      .insert({
        household_id: householdId,
        display_name: name,
        weekly_minutes: normalizeMinutes(weeklyMinutes),
        // Omitted entirely rather than sent as null when nobody typed one, so
        // an insert from a caller that does not know about addresses is byte
        // for byte the insert it was before #242. `undefined` is dropped by
        // supabase-js; an explicit null would be a write.
        ...(address === undefined ? {} : { email: address }),
      })
      .select(MEMBER_COLUMNS)
      .single(),
    'adding the person',
  )
}

/**
 * Edit a person's name, weekly minutes or email address — AC 4, and #242.
 *
 * `email` joins the patch because `0007` granted it as UPDATE-able for exactly
 * this case, and its own comment argues for it: "an organizer correcting a typo
 * in an address is ordinary roster maintenance". *Measured on the live project
 * 2026-08-28*, `members.email` carries `authenticated=arw`, so this needs no
 * migration — the grant has been there since #62 with nothing to write through
 * it.
 *
 * Changing the address here does NOT move the account an already-provisioned
 * member signs in with. `provision-member` reads `members.email` when it MINTS,
 * and refuses once `claimed_by` is set; nothing re-points an existing auth user.
 * So on a claimed row this is a record of who they are, and the sign-in address
 * they already hold is whatever it was minted as.
 */
export async function updateMember(id, { displayName, weeklyMinutes, email }) {
  const patch = {}
  if (displayName !== undefined) {
    const name = displayName.trim()
    if (!name) throw new Error('A person needs a name.')
    patch.display_name = name
  }
  if (weeklyMinutes !== undefined) patch.weekly_minutes = normalizeMinutes(weeklyMinutes)

  const address = normalizeMemberEmail(email)
  if (address !== undefined) patch.email = address

  return unwrapMemberWrite(
    await getSupabase().from('members').update(patch).eq('id', id).select(MEMBER_COLUMNS).single(),
    'saving the change',
  )
}

/**
 * Remove a person from the roster — #5 AC 4, and since #247 their sign-in goes
 * with them.
 *
 * Two halves, in the safe order. The AUTH half runs first, through the Edge
 * Function's `revoke` action (#247/#262): `members_claimed_by_fkey` is ON
 * DELETE SET NULL, so a removal that dies between the halves leaves a member
 * showing "No sign-in yet" — a state the roster already renders and the
 * organizer recovers from with Give a sign-in. Row first would leave an
 * account that can still sign in with no member row naming it, which is the
 * orphan #247 was filed about.
 *
 * The ROW half stays a client delete through RLS (0016), not a service_role
 * delete inside the function — the database remains the thing saying no about
 * the row, and removing somebody with no sign-in never touches the function
 * at all, so it keeps working when the function is unreachable.
 *
 * A revoke failure does NOT stop the removal (#247 AC 4). The person is
 * removed and the failure comes back as `warning` — two separate facts, so
 * the organizer is not misled into "the removal failed" and a retry. It is
 * returned rather than thrown because the removal itself succeeded, and the
 * caller decides how to show it.
 *
 * The function may also legitimately KEEP the account — when another member
 * row claims it (one person, two households, #159) there is nothing to warn
 * about: removal from this household is complete and the sign-in belongs to a
 * household this organizer has no say over.
 */
export async function removeMember(id) {
  const member = unwrap(
    await getSupabase()
      .from('members')
      .select('id, display_name, claimed_by')
      .eq('id', id)
      .maybeSingle(),
    'reading the person',
  )
  // Already gone — a double-tap, or another device got there first. Nothing to
  // revoke and nothing to delete.
  if (!member) return { warning: null }

  let warning = null
  if (member.claimed_by) {
    try {
      await callProvisioning('revoke', { memberId: id })
    } catch (err) {
      warning =
        `${member.display_name} was removed from the household, but their ` +
        `sign-in was NOT deleted: ${err.message} That account can still sign ` +
        'in until it is deleted.'
    }
  }

  unwrap(await getSupabase().from('members').delete().eq('id', id), 'removing the person')
  return { warning }
}

// `claimMember`, `setMemberPin` and `claimMemberWithPin` were here until #62.
//
// All three are gone rather than deprecated, because 0007 drops the RPCs they
// called: keeping a wrapper would turn a compile-time absence into a runtime
// `PGRST202 function not found`, discovered by a child on a phone. Identity is
// no longer something a client asks for at all — it is written by the Edge
// Function as `service_role`, and `members.claimed_by` is absent from the client
// update grant precisely so this file cannot have a fourth attempt at it.

/** The deployed function's name, in one place — #87. */
const PROVISION_FUNCTION = 'provision-member'

/**
 * Ask the Edge Function to do something only `service_role` may do — #87.
 *
 * This is the ONLY route by which a member gains an auth identity. The key that
 * makes it possible never comes near this bundle: `src/lib/keyShape.js` fails
 * the build if a secret key is ever put in a `VITE_` variable, and
 * `gate.test.js` asserts the built bundle is clean.
 *
 * The function's own refusals are sentences, so they are surfaced as-is rather
 * than replaced with a generic message — "Only the household organizer can do
 * that" is something the person can act on and "Something went wrong" is not.
 */
/**
 * What to say when the call never got an answer at all — #112.
 *
 * `FunctionsFetchError` means the `fetch` itself rejected: no status, no body,
 * nothing to quote. Its own message is "Failed to send a request to the Edge
 * Function", which reads like a transient blip and is the one thing it usually
 * is not. In a browser the likely causes are a CORS preflight the function
 * refused, and the function not being deployed to this project at all — and both
 * are indistinguishable from being offline, because a blocked request and an
 * unreachable one fail in exactly the same way.
 *
 * So the sentence names both rather than picking one. Guessing "not deployed"
 * would send an organizer to a dashboard when their train went into a tunnel;
 * guessing "you are offline" would hide a deploy nobody has run. It also says
 * nothing was changed, which is the one thing that IS certain here: a request
 * that never left cannot have half-provisioned anybody.
 */
function describeProvisioningFailure(action, error) {
  if (error?.name === 'FunctionsFetchError') {
    return (
      'Could not reach the sign-in service, so nothing was changed. Check this ' +
      `device's connection — if it is fine, the ${PROVISION_FUNCTION} function ` +
      'has not been deployed to this project yet (see docs/access-model.md).'
    )
  }
  return `Could not ${action} that sign-in: ${error?.message ?? 'unknown error'}`
}

async function callProvisioning(action, { memberId, password }) {
  const trimmed = String(password ?? '')
  if (!memberId) throw new Error('Pick a person first.')
  // Revoke takes no password — deleting a sign-in has no credential to set —
  // so the floor applies only to the actions that mint one.
  if (action !== 'revoke' && trimmed.length < 6) {
    throw new Error('That credential is too short — use at least 6 characters.')
  }

  const body =
    action === 'revoke' ? { action, memberId } : { action, memberId, password: trimmed }
  const { data, error } = await getSupabase().functions.invoke(PROVISION_FUNCTION, {
    body,
  })

  if (error) {
    // `FunctionsHttpError` carries the body, and the body is where the useful
    // sentence lives — the error's own message is only "Edge Function returned
    // a non-2xx status code", which tells the organizer nothing.
    let detail = ''
    try {
      const body = await error.context?.json()
      detail = body?.error ?? ''
    } catch {
      detail = ''
    }
    const err = new Error(detail || describeProvisioningFailure(action, error))
    err.cause = error
    throw err
  }
  return data
}

/**
 * Give a member a way to sign in — #87 AC 2.
 *
 * The organizer stays signed in as themselves throughout, which is the whole
 * reason this is a server call: `auth.signUp()` would sign them out and into the
 * account it just made.
 */
export async function provisionMember({ memberId, password }) {
  return callProvisioning('provision', { memberId, password })
}

/**
 * Replace a member's credential when they forget it — #87 AC 3.
 *
 * No inbox is involved and none can be: a provisioned member's address is
 * `<id>@taskr.invalid`, and `.invalid` can never resolve, so an emailed reset
 * link would go nowhere. It is an admin password update instead.
 */
export async function resetMemberCredential({ memberId, password }) {
  return callProvisioning('reset', { memberId, password })
}

/**
 * Which member this person is acting as, or null — within ONE household.
 *
 * Derived by matching `claimed_by` against the live auth id rather than being
 * stored anywhere: if the session ever rolls over, this correctly reports
 * "nobody" and the person signs in again, instead of a stale local value
 * attributing work to the wrong person.
 *
 * `householdId` scopes the match — #160. Since 0009 one person can hold a
 * claimed member row in TWO households, and a match over "whatever list it is
 * handed" returns whichever claimed row happens to come first — who you are
 * decided by list order. With the household named, a row that says it belongs
 * to a different household can never be returned.
 *
 * A row that does not SAY which household it belongs to is taken at face
 * value rather than excluded: every real read includes `household_id` (it is
 * in MEMBER_COLUMNS), so that tolerance never fires on data — it exists so a
 * caller without the column keeps exactly the old behaviour instead of
 * silently losing its identity (#160 AC 6). The argument is optional for the
 * same reason; the App-level tests are what make dropping it at the call
 * site go red rather than degrade quietly.
 */
export function findClaimedMember(members, userId, householdId) {
  if (!userId) return null
  const inHousehold = (m) =>
    householdId == null || m.household_id == null || m.household_id === householdId
  return members.find((m) => inHousehold(m) && m.claimed_by === userId) ?? null
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
