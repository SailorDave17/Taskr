// Connecting a Google Calendar — story #95, the client half.
//
// Same contract as chores.js, exclusions.js and household.js: NOTHING IN THIS
// FILE IS A SECURITY BOUNDARY. What decides whether a calendar may be connected
// is `supabase/functions/calendar-connect/handler.ts`, which checks the caller's
// identity through a caller-scoped client before touching anything; and what
// decides who may READ a connection is the row-level policy in `0011`. The
// functions here choose what to draw and where to send the browser.
//
// ===========================================================================
// WHAT IS AND IS NOT A SECRET HERE
// ===========================================================================
//
// `VITE_GOOGLE_CLIENT_ID` is inlined into the bundle, deliberately. An OAuth
// client id is public by design — it appears in the consent URL, which is a
// browser address bar — and Google's own single-page-app documentation puts it
// in the page. What must never be inlined is the client SECRET, which sits one
// line away from the client id on the same Google console screen;
// `src/lib/keyShape.js` knows its shape and refuses the build if one is ever put
// in a `VITE_` variable (#95 AC 4). The secret and the refresh token live in the
// Edge Function's environment and in the token table, neither of which a browser
// can reach.
//
// The secret's prefix is deliberately NOT spelled out in this file, and that is
// not squeamishness: `gate.test.js` refuses any file under `src/` that names it,
// with a short allowlist of files that must. Writing it here for the sake of a
// comment would buy a sentence and cost an exemption, and an exemption is a path
// already marked safe for somebody to paste a real value into later.
//
// Owner decision at pickup, 2026-08-24, over having the Edge Function issue the
// consent URL: the client id is not a credential, so keeping it in the bundle
// costs nothing and saves a round trip before the redirect — and it leaves the
// function with exactly the one job #95 AC 2 describes.
//
// ===========================================================================
// WHY THE REDIRECT COMES BACK TO THE APP ROOT
// ===========================================================================
//
// There is no router in this SPA and the PWA scope is `/`. A dedicated
// `/oauth/google` path would read better in Google's registered-URI list and
// would 404 on a hard load without a rewrite rule at Vercel — one more piece of
// configuration outside git, for no behaviour. Owner decision at pickup.

import { getSupabase } from './supabase.js'

/**
 * The ONLY scope this story asks for.
 *
 * Free/busy is the minimum capacity inference needs: it answers "how many
 * minutes of this week are already spoken for" and returns no titles, no
 * attendees and no locations. `calendar.readonly` would answer the same question
 * and also hand Taskr the content of every meeting in the household.
 *
 * #101's event import genuinely needs the wider scope, and asks for it THEN,
 * through incremental consent — which is a deliberate sequencing decision rather
 * than an oversight here: a member who only ever wants capacity never grants
 * read access to what their week actually contains. #95 AC 3 makes it a check.
 */
export const GOOGLE_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy'

/** Google's OAuth 2.0 consent endpoint. */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

/** Where the state token waits while the browser is at Google. */
export const CONSENT_STATE_KEY = 'taskr.calendar.consent-state'

/**
 * Where the household waits beside it — #161.
 *
 * The Edge Function has to be told which household the connection is for: since
 * 0009 a person can hold a member row in two, and the function finds its member
 * by `claimed_by` plus a household. Remembering it here rather than resolving it
 * on the way back binds the connection to the household that was ON SCREEN when
 * Connect was pressed, which is what the member chose — a resolution taken after
 * the trip to Google would be a fresh guess at "active", made at the one moment
 * the app has no idea what it was showing beforehand.
 *
 * It rides in the same storage as the state token deliberately: that token
 * ALREADY has to survive the round trip, so this adds no new way to fail. Lose
 * the storage and the state check refuses first, which it did before this
 * existed.
 */
export const CONSENT_HOUSEHOLD_KEY = 'taskr.calendar.consent-household'

/** Matches the select grant in `0011` exactly; `select('*')` fails on this table. */
export const CALENDAR_CONNECTION_COLUMNS = 'id, member_id, scope, connected_at'

const clientId = import.meta.env?.VITE_GOOGLE_CLIENT_ID

/**
 * Whether this build was given a Google OAuth client.
 *
 * False in a local checkout, and false on any deployment where the variable has
 * not been set — both ordinary states. It is NOT used to hide the Connect
 * action: #95 AC 1 says a real-email member is shown it, and a member who is
 * shown nothing has no way to find out that the household's app is missing a
 * setting. Pressing it says so instead.
 */
export const hasCalendarConfig = Boolean(clientId)

/**
 * Is this member one who could consent at all?
 *
 * The discriminator `0007` established: `members.email` is null for everybody
 * provisioned with a synthetic `<id>@taskr.invalid` address, and holds a real
 * address for everybody who signed up with one. A synthetic address has no
 * mailbox by construction and no Google identity behind it, so there is nothing
 * for a consent screen to attach to.
 *
 * Reading the ROSTER ROW rather than the auth session's email is deliberate.
 * Both would answer correctly today, and only one of them is the fact `0007`
 * defines and every other rule in this repo keys on — the session's address is a
 * copy, and `provision-member` is explicit that storing the synthetic form on
 * the member row would destroy the distinction.
 */
export function isRealEmailMember(member) {
  return Boolean(member?.email)
}

/** The connection row for a member, or null. */
export function connectionFor(connections, memberId) {
  return connections.find((row) => row.member_id === memberId) ?? null
}

/**
 * A fresh, unguessable value to tie the consent request to the response.
 *
 * `crypto.randomUUID` is available in every browser this app targets (Android
 * Chrome only — `docs/hosting-decision.md`) and in Node 22, which is what the
 * tests run on.
 */
export function newConsentState() {
  return crypto.randomUUID()
}

/**
 * The address to send the browser to.
 *
 * `access_type=offline` and `prompt=consent` are both load-bearing and neither
 * is decoration:
 *
 * - Without `access_type=offline` Google returns an access token and NO refresh
 *   token, so the connection would work once and be gone within the hour.
 * - Without `prompt=consent` Google withholds the refresh token on every consent
 *   after the first, because it has already issued one — and the second attempt
 *   after a re-install would fail in a way the member cannot fix. The handler
 *   has a dedicated sentence for exactly that state.
 *
 * `include_granted_scopes=true` is what makes #101's later widening incremental:
 * the second consent adds `calendar.readonly` to what is already held rather
 * than replacing it.
 */
export function consentUrl({ redirectUri, state, clientId: id = clientId }) {
  if (!id) throw new Error('This app has no Google client id: set VITE_GOOGLE_CLIENT_ID.')
  if (!redirectUri) throw new Error('A consent request needs a redirect address.')
  if (!state) throw new Error('A consent request needs a state token.')

  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_FREEBUSY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * Where Google sends the member back to — this app, at its root.
 *
 * Built from `location.origin` rather than written down, so a preview
 * deployment, the custom domain and a dev server each ask for themselves. Google
 * matches it exactly against the registered list, so a host that is not
 * registered is refused BY GOOGLE with a message naming the address — which is
 * the failure worth having, rather than one that silently sends people to the
 * wrong deployment.
 */
export function redirectUriFor(location = globalThis.location) {
  return `${location.origin}/`
}

/**
 * The `?code=` / `?state=` pair Google puts on the return, or null if this is
 * an ordinary load — or somebody else's return.
 *
 * `state` is REQUIRED since #304. Google echoes the state `startConnect` sent
 * on every return, success or refusal, so a query without one did not come
 * from this flow: Supabase's own sign-in redirects put `error`/`error_code` on
 * the root with no state, and a PKCE client would put a `code` there too.
 * Before this, a stale Google sign-in was reported as "Google could not
 * complete that connection", which sent a person to the calendar to fix a
 * sign-in. `readSignInReturn` in household.js is the other half of the rule,
 * and a `?code=` with no state is read by neither.
 */
export function readConsentReturn(search) {
  const params = new URLSearchParams(String(search ?? ''))
  const state = params.get('state')
  if (!state) return null
  const code = params.get('code')
  const error = params.get('error')
  if (!code && !error) return null
  return { code, error, state }
}

/**
 * Begin a connection: remember the state, and hand back the address to go to.
 *
 * The state lives in `sessionStorage` rather than in a table. It is a one-hop
 * CSRF token whose whole life is this tab's trip to Google and back; storing it
 * server-side would add a table, a write and a cleanup problem to defend a value
 * that is worthless the moment the tab is closed.
 */
export function startConnect({ householdId, storage = globalThis.sessionStorage, location } = {}) {
  if (!householdId) throw new Error('Which household? A calendar connection must name one.')
  const state = newConsentState()
  storage.setItem(CONSENT_STATE_KEY, state)
  // #161 — written with the state, read back with it, cleared with it. Three
  // operations on two keys that must not drift apart, which is why they sit
  // next to each other in both functions rather than in a tidier place.
  storage.setItem(CONSENT_HOUSEHOLD_KEY, householdId)
  return consentUrl({ redirectUri: redirectUriFor(location), state })
}

/**
 * Finish a connection: check the state, then hand the code to the Edge Function.
 *
 * The state is consumed whatever happens, so a failed attempt cannot leave a
 * value behind for a later request to match against.
 */
export async function completeConnect(
  { code, state },
  { storage = globalThis.sessionStorage, location } = {},
) {
  const expected = storage.getItem(CONSENT_STATE_KEY)
  const householdId = storage.getItem(CONSENT_HOUSEHOLD_KEY)
  storage.removeItem(CONSENT_STATE_KEY)
  // Consumed whatever happens, for the same reason the state is: a value left
  // behind is one a later request could match against.
  storage.removeItem(CONSENT_HOUSEHOLD_KEY)

  if (!expected || !state || state !== expected) {
    throw new Error('That calendar connection did not come from this device. Nothing was changed.')
  }

  // Checked AFTER the state, so a forged return is refused as a forgery rather
  // than as a missing household — the two failures route to different places
  // and only one of them is the member's problem.
  if (!householdId) {
    throw new Error('This device forgot which household that connection was for. Try again.')
  }

  const { data, error } = await getSupabase().functions.invoke('calendar-connect', {
    body: { code, redirectUri: redirectUriFor(location), householdId },
  })

  if (error) {
    // `functions.invoke` puts the function's own body on `error.context`, and
    // the sentence in it is the one worth showing: the handler distinguishes a
    // refused code from an unreachable Google from a missing configuration, and
    // collapsing all three into "Edge Function returned a non-2xx status code"
    // throws that away. #112 is the case for reading the body: the generic
    // message names nothing and reads like the network is down.
    let detail = ''
    try {
      detail = (await error.context?.json?.())?.error ?? ''
    } catch {
      detail = ''
    }
    throw new Error(detail || `Could not connect that calendar: ${error.message}`)
  }

  return data
}

/**
 * Every calendar connection ONE household has — #159 AC 1.
 *
 * Scoped by `memberIds`, like capacity and exclusions: `calendar_connections`
 * grants `member_id` (0011) and withholds `household_id`, so it is scoped from
 * the already-scoped member set with no grant change (#157 AC 4). A connection
 * belongs to this household exactly when its member does.
 *
 * `0011`'s unique index is per MEMBER row, and two households mean two member
 * rows for one person — so a person in two households can hold two independent
 * connections and neither read nor write collides. #161 owns the function half
 * of that.
 */
export async function listCalendarConnections(memberIds) {
  if (!Array.isArray(memberIds)) throw new Error('Which household? A connection read must name its members.')
  if (memberIds.length === 0) return []
  const { data, error } = await getSupabase()
    .from('calendar_connections')
    .select(CALENDAR_CONNECTION_COLUMNS)
    .in('member_id', memberIds)

  if (error) {
    const err = new Error(`loading calendar connections: ${error.message}`)
    err.cause = error
    throw err
  }
  return data ?? []
}

/**
 * Matches the select grant in `0030` exactly; `select('*')` fails on this table.
 *
 * `household_id` is absent for the reason it is absent from the capacity and
 * connection column lists: this table is scoped from an already-scoped member
 * set, so the client never needs to name a household — and withholding the
 * column is what makes a forgotten column list a loud refusal instead of a quiet
 * superset.
 */
export const CALENDAR_BUSY_COLUMNS =
  'id, member_id, period_start, busy_minutes, event_count, computed_at'

/** The derived row for a member in a week, or null. */
export function busyWeekFor(busyWeeks, memberId, periodStart) {
  return (
    busyWeeks.find((row) => row.member_id === memberId && row.period_start === periodStart) ?? null
  )
}

/**
 * How old a derived figure may be before an app open reads the week again —
 * #98 AC 1's "staleness bound, a named constant".
 *
 * Twelve hours, so a member's free/busy is read on their behalf at most twice
 * a day: a morning open and an evening open each see what today has become,
 * and a phone opened six times between them spends nothing. The decision and
 * the two values rejected beside it (one hour, one day) are recorded in
 * `docs/refresh-charter.md`, "Decision taken 2026-09-05". WALL-CLOCK age, not
 * calendar day: a figure read at 23:00 is not stale at 00:01.
 *
 * Client-triggered, and only ever client-triggered. #53 settled why for every
 * periodic read this app will ever do — the free plan's pg_cron stops silently
 * when the project pauses — and `gate.test.js` refuses a scheduler anywhere in
 * the tree so that decision cannot be quietly re-taken one story at a time.
 * What "on app open" can cost is bounded twice: by this constant, and by the
 * once-per-session key in App.jsx. Nothing here loops.
 */
export const BUSY_STALE_AFTER_HOURS = 12
export const BUSY_STALE_AFTER_MS = BUSY_STALE_AFTER_HOURS * 60 * 60 * 1000

/**
 * Is a derived row old enough that an app open should read the week again?
 *
 * Strictly OLDER than the bound: a row exactly twelve hours old is fresh, so
 * the boundary is pinned in one direction rather than left to whichever
 * comparison somebody writes next. A row whose `computed_at` nothing can parse
 * is reported STALE, not fresh — its age is unknown, and a bounded refresh is
 * cheap where a figure of unknown age presented as current is not. No row at
 * all is NOT stale: that is #96's trigger, and this predicate is the other
 * half of the boundary the two stories draw between them.
 */
export function isBusyWeekStale(busyWeek, now = Date.now()) {
  if (!busyWeek) return false
  const at = new Date(busyWeek.computed_at).getTime()
  if (Number.isNaN(at)) return true
  return now - at > BUSY_STALE_AFTER_MS
}

/**
 * Every derived busy figure ONE household has for a week — #96 AC 4.
 *
 * Scoped by `memberIds` like capacity, exclusions and connections: `0030` grants
 * `member_id` and withholds `household_id`, so a row belongs to this household
 * exactly when its member does. An empty member set short-circuits rather than
 * issuing `in ()`, for `listCapacity`'s reason — the answer is knowable without
 * the round trip.
 *
 * The rows carry no credential and nothing out of anybody's calendar: `0030`'s
 * column list is the whole minimization decision, so there is no version of this
 * read that could return an event title.
 */
export async function listBusyWeeks(periodStart, memberIds) {
  if (!periodStart) throw new Error('Which week? A busy read must name one.')
  if (!Array.isArray(memberIds)) throw new Error('Which household? A busy read must name its members.')
  if (memberIds.length === 0) return []
  const { data, error } = await getSupabase()
    .from('calendar_busy')
    .select(CALENDAR_BUSY_COLUMNS)
    .in('member_id', memberIds)
    .eq('period_start', periodStart)

  if (error) {
    const err = new Error(`loading calendar busy minutes: ${error.message}`)
    err.cause = error
    throw err
  }
  return data ?? []
}

/**
 * Ask the Edge Function to read this week and store the derived figure — AC 1.
 *
 * The function acts on the CALLER's own member row (owner decision, 2026-09-04),
 * so the body names only which household and which week: who it is about is
 * `auth.uid()` off the JWT, exactly as `completeConnect` sends no member id.
 *
 * The failure sentence is read off the function's own body for #112's reason —
 * `functions.invoke` collapses everything into "Edge Function returned a non-2xx
 * status code", and the handler deliberately distinguishes a revoked connection
 * from an unreachable Google from a missing configuration. AC 5 renders that
 * sentence beside the last figure, so collapsing them would put the same words
 * on a problem the member can fix and one they cannot.
 */
export async function fetchBusyWeek({ householdId, periodStart }) {
  if (!householdId) throw new Error('Which household? A calendar read must name one.')
  if (!periodStart) throw new Error('Which week? A calendar read must name one.')

  const { data, error } = await getSupabase().functions.invoke('calendar-busy', {
    body: { householdId, periodStart },
  })

  if (error) {
    let detail = ''
    try {
      detail = (await error.context?.json?.())?.error ?? ''
    } catch {
      detail = ''
    }
    throw new Error(detail || `Could not read that calendar: ${error.message}`)
  }

  return data
}

/**
 * When a derived figure was read, as a person reads it — "Sep 4".
 *
 * In the HOUSEHOLD's zone, and that is the opposite call from `weekRangeLabel`
 * in done.js, which formats in UTC. The difference is the data: a period start
 * is a pure calendar date and formatting it in a zone west of Greenwich moves it
 * a day, while `computed_at` is an INSTANT — an actual moment — and the only
 * honest way to say which day it happened on is to ask the household's clock.
 *
 * Null for an unreadable value rather than throwing. This decorates a figure;
 * a timestamp the app cannot parse must cost the date beside the number, never
 * the number.
 */
export function busyComputedLabel(computedAt, timeZone) {
  if (!computedAt || !timeZone) return null
  const at = new Date(computedAt)
  if (Number.isNaN(at.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at)
  } catch {
    return null
  }
}
