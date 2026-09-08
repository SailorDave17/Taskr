// List a member's upcoming events for one week, and hand them back — story #101.
//
// `calendar-connect` (#95) put a refresh token in a table no client can read;
// `calendar-busy` (#96) spends it for one integer a week. This spends the same
// token for the one thing free/busy cannot say — what an event is CALLED — so a
// member can import one as a chore, and it is the only function here whose
// answer carries anything out of a calendar.
//
// ===========================================================================
// WHAT THIS FUNCTION IS ALLOWED TO DO WITH WHAT IT READS — NOTHING BUT RETURN IT
// ===========================================================================
//
// Titles TRANSIT. They are read from Google, reduced to the handful of fields
// the import form needs, returned to the phone that asked, and written nowhere:
// there is no table with a column for them (`0038`'s ledger keeps the event id
// and nothing else), and this handler holds no service_role client for any
// purpose but reading the credential. `handler.test.js` asserts the fake
// client saw zero writes, and asserts the response carries no attendee, no
// location and no description even when Google's payload does — because the
// `fields` parameter below asks Google not to send them, and the reduction
// would drop them if it did.
//
// That is how #101 AC 1 keeps the minimization decision (owner, 2026-08-16)
// while widening the scope: the decision is about what is STORED, and nothing
// here stores.
//
// ===========================================================================
// THE SCOPE CHECK — the server half of AC 1
// ===========================================================================
//
// The stored token's `scope` is what Google GRANTED (`0011` stores the token
// response, not the request). A #95 connection holds free/busy alone, and the
// events endpoint would refuse it with a 403 nobody on the phone can act on —
// so this refuses FIRST, by name, with `needsScope: true`, and the client
// offers the incremental-consent step instead of a sentence about Google. The
// screen already decides the same thing from the readable connection row; this
// is the boundary that holds when the row is stale or the caller is not this
// app.
//
// ===========================================================================
// THE AUTHORIZATION SHAPE — the same three steps, in the same order
// ===========================================================================
//
// `calendar-busy`'s, unchanged: find the member THROUGH THE CALLER by
// `claimed_by` and the household the body names; take the household from that
// row; only then read the credential as service_role. Own row only, for the
// reason #96's owner decision gives — a housemate's token is never spent on
// this caller's tap.

import {
  GOOGLE_TOKEN_ENDPOINT,
  accessTokenFor,
  isWeekStart,
  weekBoundsUtc,
} from '../calendar-busy/handler.ts'

export { GOOGLE_TOKEN_ENDPOINT }

/**
 * Google's events list for the primary calendar. Returns EVENTS — titles,
 * times, and (unless asked otherwise) attendees, locations and descriptions —
 * which is why the request below names exactly the fields it wants.
 */
export const GOOGLE_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/**
 * The fields asked of Google, and the ONLY fields that arrive. `attendees`,
 * `location`, `description`, `creator`, `organizer`, `hangoutLink` and the rest
 * are absent because they are not named; the reduction copies from a fixed set
 * as a second wall, and the test plants each of them to prove it.
 */
export const GOOGLE_EVENTS_FIELDS = 'items(id,summary,start,end,status)'

/** How many events one week may return. A week with more is a calendar, not a to-do list. */
export const MAX_EVENTS = 100

/**
 * Every scope under which the events endpoint answers. The same list as
 * `EVENT_READ_SCOPES` in src/lib/calendar.js, restated rather than imported
 * for the reason every constant here is: this is a deploy-path file, and
 * `gate.test.js` keeps the bundler out of `supabase/functions/` in the other
 * direction. `handler.test.js` reads the client's list off its source and holds
 * the two equal.
 */
export const EVENT_READ_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
]

/** The sentence the client turns into the consent step. */
export const NEEDS_SCOPE_MESSAGE =
  'This calendar is connected for free/busy only. Allow Taskr to read events to import one.'

/**
 * Every header supabase-js puts on a `functions.invoke` call — the same list as
 * the four functions beside this one, restated rather than imported for the
 * reason all of them give: a deploy-path constant must not be resolved at
 * deploy time. `src/test/edge-function-cors.test.js` reads EVERY function
 * directory off the filesystem, so this one was covered from the moment the
 * directory existed.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** The two environment names this function cannot run without, beyond Supabase's own. */
export const REQUIRED_GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']

export interface Filterable {
  eq(column: string, value: unknown): Filterable
  maybeSingle(): Promise<{ data: any; error: any }>
}

/**
 * The bits of a Supabase client this handler touches — READS ONLY. There is
 * deliberately no `insert`, `upsert`, `update` or `delete` in this type: the
 * handler cannot call what the contract does not name, and a fake that
 * satisfies it has nothing to record a write with.
 */
export interface SupabaseLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null }> }
  from(table: string): {
    select(columns: string): Filterable
  }
}

export interface CalendarEventsDeps {
  /** Injected so the Google calls can be exercised with no network. */
  fetch: (input: string, init?: unknown) => Promise<Response>
  /** `Deno.env.get` in production; a plain lookup in the test. */
  env: (name: string) => string | undefined
  /** Built per request, because the caller-scoped one carries the caller's JWT. */
  createClient: (url: string, key: string, options?: unknown) => SupabaseLike
  /** The clock, so "upcoming" is pinnable. Defaults to the real one. */
  now?: () => Date
}

/** One event as the phone receives it — and the WHOLE of what it receives. */
export interface ImportableEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  /** Whole minutes between start and end, or null for an all-day event. */
  durationMinutes: number | null
  /** The event's local date in the household's zone, `YYYY-MM-DD` — the chore's due date. */
  dueOn: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

/** A refusal says what is wrong without saying whether anybody else exists. */
function refuse(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status)
}

/** Does a granted scope string let this token read events? */
export function scopeReadsEvents(scope: unknown): boolean {
  return String(scope ?? '')
    .split(/\s+/)
    .some((granted) => EVENT_READ_SCOPES.includes(granted))
}

/**
 * The calendar date, in a named zone, of an instant — `YYYY-MM-DD`.
 *
 * `en-CA` formats exactly that way; `capacity.js`'s `localDateIn` is the same
 * function on the client, and the two agree because both ask Intl the same
 * question. Not imported from there: `gate.test.js` keeps `src/` and
 * `supabase/functions/` apart in that direction.
 */
export function localDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * Google's event items, reduced to what the import form needs — AC 2.
 *
 * Four things happen here and each is a decision:
 *
 *   - **Copied from a fixed set.** `id`, `summary`, `start`, `end` and nothing
 *     else are read off an item, whatever Google sent. The `fields` parameter
 *     already asks for only those; this is the second wall, so a payload that
 *     ignored the parameter still yields a row with no attendee in it.
 *   - **Cancelled dropped.** Google omits them unless asked (`showDeleted`),
 *     and this asks nothing of the kind; the check is defence for a payload
 *     that says so anyway.
 *   - **All-day told apart from timed.** An all-day event carries `start.date`
 *     and no time; its duration is a day, which is not how long a chore takes,
 *     so `durationMinutes` is null and the client leaves the minutes blank.
 *   - **The due date is the household's.** `dueOn` is the start's local date in
 *     the household's zone — an event at 23:30 in New York is that day's chore,
 *     not the next day's, whatever UTC says.
 *
 * Unparseable or inside-out items are dropped rather than throwing: one odd
 * row must not cost a member the whole list, and nothing here is a figure that
 * a dropped row silently understates.
 */
export function reduceEvents(items: unknown, timeZone: string): ImportableEvent[] {
  const out: ImportableEvent[] = []
  for (const raw of Array.isArray(items) ? items : []) {
    const item = raw as Record<string, any> | null
    if (!item || typeof item !== 'object') continue
    if (item.status === 'cancelled') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) continue

    const startDate = typeof item.start?.date === 'string' ? item.start.date : ''
    const startTime = typeof item.start?.dateTime === 'string' ? item.start.dateTime : ''
    const endDate = typeof item.end?.date === 'string' ? item.end.date : ''
    const endTime = typeof item.end?.dateTime === 'string' ? item.end.dateTime : ''
    const title = typeof item.summary === 'string' ? item.summary.trim() : ''

    if (startDate) {
      // All-day. `start.date` is already a local calendar date, in the
      // CALENDAR's zone rather than the household's — Google gives no instant
      // to re-resolve, so the date stands as written.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) continue
      out.push({
        id,
        title,
        start: startDate,
        end: endDate || startDate,
        allDay: true,
        durationMinutes: null,
        dueOn: startDate,
      })
      continue
    }

    const start = Date.parse(startTime)
    const end = Date.parse(endTime)
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue
    out.push({
      id,
      title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      allDay: false,
      durationMinutes: Math.round((end - start) / 60000),
      dueOn: localDateIn(new Date(start), timeZone),
    })
  }
  return out
}

/**
 * Ask Google for the events in a window — and hold the answer no longer than
 * the reduction takes.
 */
async function eventsFor(
  deps: CalendarEventsDeps,
  { accessToken, timeMin, timeMax }: Record<string, string>,
): Promise<{ ok: true; items: unknown } | { ok: false; message: string; status: number }> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    // Recurring events arrive as their INSTANCES, each with its own id, which
    // is the only shape an import can act on — a series is not a chore.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(MAX_EVENTS),
    fields: GOOGLE_EVENTS_FIELDS,
  })
  let response: Response
  try {
    response = await deps.fetch(`${GOOGLE_EVENTS_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return { ok: false, message: 'Could not reach Google. Try again in a moment.', status: 502 }
  }

  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    // A 403 here after the scope check above means Google's view of the grant
    // differs from the stored one — the member revoked part of it in their
    // Google account. Named as Google's, because it is.
    const detail = payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`
    return { ok: false, message: `Google refused the calendar read: ${detail}`, status: 502 }
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items ?? [])) {
    return {
      ok: false,
      message: 'Google answered with something this app could not read.',
      status: 502,
    }
  }

  return { ok: true, items: payload.items ?? [] }
}

/**
 * The whole endpoint, as a function of its dependencies.
 */
export function createHandler(deps: CalendarEventsDeps) {
  const now = deps.now ?? (() => new Date())

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return refuse('Sign in first.', 401)

    let body: { householdId?: string; periodStart?: string }
    try {
      body = await req.json()
    } catch {
      return refuse('Send a JSON body.', 400)
    }
    // `req.json()` resolves for the JSON literal `null` as happily as for an
    // object — `calendar-busy`'s guard, for its reason.
    if (!body || typeof body !== 'object') return refuse('Send a JSON body.', 400)

    const householdId = String(body.householdId ?? '')
    const periodStart = String(body.periodStart ?? '')
    if (!householdId) return refuse('No household was named.', 400)
    if (!periodStart) return refuse('No week was named.', 400)
    if (!isWeekStart(periodStart)) return refuse('A week must start on a Monday.', 400)

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    const clientId = deps.env('GOOGLE_CLIENT_ID')
    const clientSecret = deps.env('GOOGLE_CLIENT_SECRET')
    if (!url || !anonKey || !serviceKey || !clientId || !clientSecret) {
      const missing = REQUIRED_GOOGLE_ENV.filter((name) => !deps.env(name))
      return refuse(
        missing.length
          ? `This function is not configured: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set.`
          : 'This function is not configured.',
        500,
      )
    }

    // ---- 1 & 2: everything the CALLER is allowed to see and be ---------------

    const asCaller = deps.createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Constructed here but deliberately NOT used until the caller-scoped checks
    // below have passed — and used for exactly one read.
    const asService = deps.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller } = (await asCaller.auth.getUser()) ?? { data: null }
    const callerId = caller?.user?.id
    if (!callerId) return refuse('Sign in first.', 401)

    // TWO filters, for #161's reason — a person can hold one member row per
    // household, and `maybeSingle()` over two rows is a refusal, not a pick.
    const { data: member, error: memberError } = await asCaller
      .from('members')
      .select('id, display_name, claimed_by, email, household_id')
      .eq('claimed_by', callerId)
      .eq('household_id', householdId)
      .maybeSingle()

    if (memberError) return refuse('Could not read your roster entry.', 400)
    if (!member) return refuse('You are not a member of that household.', 403)

    if (!member.email) {
      return refuse('Reading a calendar needs a real email address on your roster entry.', 403)
    }

    const { data: household, error: householdError } = await asCaller
      .from('households')
      .select('id, timezone')
      .eq('id', member.household_id)
      .maybeSingle()

    if (householdError || !household?.timezone) {
      return refuse('Could not read this household’s timezone.', 400)
    }

    let bounds: { timeMin: string; timeMax: string }
    try {
      bounds = weekBoundsUtc(periodStart, household.timezone)
    } catch {
      return refuse('This household’s timezone is not one this app understands.', 400)
    }

    // ---- 3: the credential no client is granted, read and never written -----

    const { data: token, error: tokenError } = await asService
      .from('calendar_tokens')
      .select('refresh_token, scope')
      .eq('member_id', member.id)
      .maybeSingle()

    if (tokenError) return refuse('Could not read that calendar connection.', 500)
    if (!token?.refresh_token) return refuse('That calendar is not connected.', 409)

    // AC 1 — the server half. Refused BEFORE Google is asked anything, so a
    // free/busy-only connection costs no token exchange and gets a sentence the
    // client turns into the consent step rather than a 403 from Google.
    if (!scopeReadsEvents(token.scope)) {
      return refuse(NEEDS_SCOPE_MESSAGE, 409, { needsScope: true })
    }

    // "Upcoming events for the current week" — from now to the week's end. A
    // week that has already ended has nothing upcoming in it, and is answered
    // empty without spending the token.
    const at = now().getTime()
    const weekStart = Date.parse(bounds.timeMin)
    const weekEnd = Date.parse(bounds.timeMax)
    if (at >= weekEnd) {
      return json({ ok: true, periodStart, timeMin: bounds.timeMax, timeMax: bounds.timeMax, events: [] })
    }
    const timeMin = new Date(Math.max(at, weekStart)).toISOString()
    const timeMax = bounds.timeMax

    const exchanged = await accessTokenFor(deps, {
      refreshToken: token.refresh_token,
      clientId,
      clientSecret,
    })
    if (!exchanged.ok) return refuse(exchanged.message, exchanged.status)

    const answer = await eventsFor(deps, { accessToken: exchanged.accessToken, timeMin, timeMax })
    if (!answer.ok) return refuse(answer.message, answer.status)

    // Reduced and returned. Nothing below this line writes, and nothing above
    // it did either — see the header.
    return json({
      ok: true,
      periodStart,
      timeMin,
      timeMax,
      events: reduceEvents(answer.items, household.timezone),
    })
  }
}
