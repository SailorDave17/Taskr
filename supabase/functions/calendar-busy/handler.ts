// Read one week of Google free/busy and store the derived minutes — story #96.
//
// `calendar-connect` (#95) put a refresh token in a table no client can read.
// This is the only thing that spends it, and everything it hands back is a
// single integer per (member, week).
//
// WHY THE HANDLER IS A SEPARATE MODULE FROM `index.ts`
//
// Identical to `calendar-connect`'s reason, and the same reason applies harder
// here: the subject is what GOOGLE does, and there is no local Google. A suite
// that needed one would leave every branch this story turns on — a revoked
// token, a calendar Google refuses, an unreachable endpoint (AC 5) — covered by
// nothing that runs. So the three things that differ between the edge runtime
// and a unit test are arguments, and `handler.test.js` runs in `npm test`, on
// every push, with no network.
//
// ===========================================================================
// WHAT THIS FUNCTION IS ALLOWED TO STORE, WHICH IS THE WHOLE STORY
// ===========================================================================
//
// Owner decision at #96's groom gate, 2026-08-16: derived busy-minutes only —
// no titles, no attendees, no event times, ever. The reduction below is where
// that decision is executed and `0030`'s column list is where it is enforced;
// this handler never holds a Google response for longer than the reduction and
// never passes one back to the caller. The response it returns carries the
// integer, the interval count and the timestamp, and nothing that came out of
// anybody's calendar.
//
// `items: [{ id: 'primary' }]` is the only calendar asked about. The
// `calendar.freebusy` scope `0011` records answers for the member's own
// calendars, and asking for one is what keeps the request as narrow as the
// scope.
//
// ===========================================================================
// THE AUTHORIZATION SHAPE — the same three steps, in the same order
// ===========================================================================
//
//   1. Find the member THROUGH THE CALLER, by `claimed_by = auth.uid()` AND the
//      household the request names. Row-level security scopes `members` to the
//      households the caller belongs to, so this cannot return somebody else's
//      row even if the caller asks for one.
//   2. Take the household FROM THAT ROW, because the row is the record being
//      acted on and the body is not a source of truth about it.
//   3. Only then use service_role, and only to read the credential and write
//      the derived row — the two things a client is deliberately unable to do.
//
// Owner decision at #96's pickup, 2026-09-04: this function acts on the
// CALLER'S OWN member row only. It was worth asking, because AC 1's "a
// connected member ... invokes the function once for that week" also reads as
// one call covering every connected member in the household. That shape was
// rejected: it would have this function read other people's refresh tokens on a
// caller's action, so one person opening the app would spend a housemate's
// credential against Google. Own-row-only fails closed the way `calendar-connect`
// does — get the read wrong and it returns nothing — and a housemate's figure
// arrives when they open the app, which is the freshness model every other read
// here already has.

/** Google's OAuth 2.0 token endpoint. Named so the test can assert it is the one used. */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** Google's free/busy query. Returns INTERVALS: no titles, no attendees, no locations. */
export const GOOGLE_FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy'

/**
 * Every header supabase-js puts on a `functions.invoke` call.
 *
 * The same list as `provision-member` and `calendar-connect`, restated rather
 * than imported, and #112 is why the list is this long: a browser preflight asks
 * about ALL of the headers at once and a list missing even one fails the whole
 * request before it is sent, with the client reporting "Failed to send a request
 * to the Edge Function" — a sentence that names no header and reads like a
 * dropped connection.
 *
 * Restated rather than imported for the reason both of the others give: this is
 * a deploy-path constant, and a value that must not change silently should not
 * be resolved at deploy time. `src/test/edge-function-cors.test.js` reads EVERY
 * function directory off the filesystem, so this one was covered by that check
 * from the moment the directory existed.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** The two environment names this function cannot run without, beyond Supabase's own. */
export const REQUIRED_GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']

/**
 * The most minutes a week can hold — `0030`'s bound, restated here as the
 * single number the two must agree on.
 *
 * 169 hours, not 168. A week is seven LOCAL days (`weekBoundsUtc`), and the one
 * containing a fall-back transition is an hour longer than the others, so a
 * calendar that is busy for the whole of it reduces to 10140 minutes. The first
 * version said 10080 and clamped to it, which understated exactly that week by
 * an hour while landing precisely on the constraint's ceiling — the value the
 * constraint exists to make suspicious (review-fanout, 2026-09-04).
 *
 * Nothing in `reduceBusy` clamps to this any more, and that is deliberate: every
 * interval is already clamped to the WINDOW, so the sum cannot exceed the
 * window's length, and the window is at most this long. A second clamp here was
 * dead code with a test that could not fail (`Math.min` of a value already at or
 * below its bound), which the same review measured by deleting it. The database
 * constraint is the backstop for a figure that is impossible, and this constant
 * is what it is checked against.
 */
export const MAX_BUSY_MINUTES = 169 * 60

export interface Filterable {
  eq(column: string, value: unknown): Filterable
  maybeSingle(): Promise<{ data: any; error: any }>
}

/**
 * A minimal shape for the bits of a Supabase client this handler touches.
 *
 * Structural rather than the SDK's own types, for `calendar-connect`'s reason:
 * the point of the injection is that the test supplies a fake, and a fake that
 * has to satisfy the whole client interface is a fake nobody writes.
 */
export interface SupabaseLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null }> }
  from(table: string): {
    select(columns: string): Filterable
    upsert(row: unknown, options?: unknown): Promise<{ error: any }>
  }
}

export interface CalendarBusyDeps {
  /** Injected so the Google calls can be exercised with no network — AC 2 and AC 5. */
  fetch: (input: string, init?: unknown) => Promise<Response>
  /** `Deno.env.get` in production; a plain lookup in the test. */
  env: (name: string) => string | undefined
  /** Built per request, because the caller-scoped one carries the caller's JWT. */
  createClient: (url: string, key: string, options?: unknown) => SupabaseLike
  /** The clock, so `computed_at` and a "now" are pinnable. Defaults to the real one. */
  now?: () => Date
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

/**
 * A refusal says what is wrong without saying whether anybody else exists.
 *
 * Same rule as `provision-member` and `calendar-connect`: the caller-scoped read
 * already decided what this caller may know, and echoing more back would turn
 * the endpoint into a way to probe other households.
 */
function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * Is this the `YYYY-MM-DD` of a Monday?
 *
 * The client resolves the week with `periodStartFor` (src/lib/capacity.js),
 * which is the one implementation of that arithmetic and takes the household's
 * zone. This is deliberately NOT a second copy of it: it is a shape check on
 * what arrived, so a hand-built call cannot file a figure under a key nothing
 * will ever read. `0030`'s `extract(isodow) = 1` constraint is the same refusal
 * one layer down, and this one exists only so the caller gets a sentence rather
 * than a constraint violation.
 */
export function isWeekStart(periodStart: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return false
  const at = new Date(`${periodStart}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return false
  // Round-trips, so `2026-02-30` is refused rather than silently read as March.
  if (at.toISOString().slice(0, 10) !== periodStart) return false
  return at.getUTCDay() === 1
}

/**
 * How far the named zone is from UTC at a given instant, in milliseconds.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which is not the same thing:
 * with `hour12: false` some engines format midnight as hour `24`, and the
 * arithmetic below would then place local midnight a day late — a bug that
 * appears only for zones whose offset is being resolved AT midnight, which is
 * every call this function receives.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const at: Record<string, string> = {}
  for (const part of parts) at[part.type] = part.value
  const asUtc = Date.UTC(
    Number(at.year),
    Number(at.month) - 1,
    Number(at.day),
    Number(at.hour),
    Number(at.minute),
    Number(at.second),
  )
  return asUtc - instant.getTime()
}

/**
 * The instant a local calendar date begins in the named zone.
 *
 * TWO PASSES — and the honest statement about the second one is that **no test
 * in this repo can tell it from one pass**, which is why it is written down here
 * rather than left as a confident comment.
 *
 * The reasoning for it is real: the first pass resolves the offset at midnight
 * UTC of that date, which is up to a day's worth of zone away from the instant
 * actually wanted, so where the offset changes in between it can land on the
 * wrong side of a transition. Re-resolving AT the candidate settles it.
 *
 * *Measured 2026-09-04*, over every zone `Intl.supportedValuesOf('timeZone')`
 * returns and every **Monday** from 2024 to 2030: the two spellings agree on
 * every one — **0 differences**. Transitions in the IANA database land on
 * Sundays or on local midnight, and a Monday's UTC-midnight is never on the far
 * side of one. The mutation pass agrees: reducing this to a single pass reddens
 * NOTHING, and that is recorded rather than repaired, because the alternative is
 * a test asserting a case that does not exist.
 *
 * So the second pass is kept as defence for a caller this module does not
 * restrict — `weekBoundsUtc` is exported and takes any date string — and not
 * because anything here exercises it. `isWeekStart` means the handler only ever
 * reaches it with a Monday.
 *
 * The property the week bounds actually need is CONTIGUITY, and that one IS
 * tested: `weekBoundsUtc` computes both ends with this same function, so one
 * week's end is byte-identical to the next week's start whatever the zone did —
 * including a zone whose transition is at midnight itself, where local midnight
 * may not exist at all. No minute can be double-counted or dropped between two
 * weeks.
 */
function zonedMidnight(date: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`)
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone)
  return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone))
}

/** `YYYY-MM-DD`, n days on, as pure UTC calendar arithmetic — no zone involved. */
function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * The instants a household-local week begins and ends — AC 2.
 *
 * @returns RFC 3339 strings, which is what Google's `timeMin`/`timeMax` take.
 *
 * A week is seven LOCAL days, which is 167, 168 or 169 hours depending on what
 * the zone did in the middle of it. Subtracting `7 * 86400000` milliseconds
 * would be the classic version of this bug and would quietly move an hour of
 * somebody's Sunday into the next week twice a year.
 */
export function weekBoundsUtc(periodStart: string, timeZone: string): {
  timeMin: string
  timeMax: string
} {
  return {
    timeMin: zonedMidnight(periodStart, timeZone).toISOString(),
    timeMax: zonedMidnight(addDays(periodStart, 7), timeZone).toISOString(),
  }
}

/**
 * Google's busy intervals, reduced to ONE integer — AC 2 and AC 3.
 *
 * Three things happen here and each is a decision:
 *
 *   - **Clamped** to the week. Google returns intervals that OVERLAP the
 *     window, not intervals inside it, so an event running from Sunday night
 *     into Monday morning arrives whole. Counting it whole would put last
 *     week's minutes in this week's figure.
 *   - **Coalesced once.** Double-booked time is one interval of busy-ness, not
 *     two: a person with two meetings at 10:00 is busy for one hour, and a sum
 *     over raw intervals would say two. "Once" is the word the criterion uses
 *     and this is what it means.
 *   - **Counted before coalescing.** `event_count` is how many intervals the
 *     answer was reduced FROM, which is what lets 0 minutes from 0 intervals
 *     (an empty week) be told apart from 0 minutes from 4 (a bug). Google's
 *     free/busy never says how many EVENTS there were, so this is honestly
 *     named in `0030`'s comment and nothing renders it.
 *
 * Unparseable or inside-out intervals are dropped rather than throwing: a single
 * malformed row must not cost a member their whole week's figure, and the drop
 * is visible as a gap between `event_count` and what Google sent.
 */
export function reduceBusy(
  intervals: unknown,
  timeMin: string,
  timeMax: string,
): { busyMinutes: number; eventCount: number } {
  const windowStart = Date.parse(timeMin)
  const windowEnd = Date.parse(timeMax)
  const clamped: Array<[number, number]> = []
  let eventCount = 0

  for (const raw of Array.isArray(intervals) ? intervals : []) {
    const entry = raw as { start?: unknown; end?: unknown } | null
    if (!entry || typeof entry !== 'object') continue
    const start = Date.parse(String(entry.start ?? ''))
    const end = Date.parse(String(entry.end ?? ''))
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue
    eventCount += 1
    const from = Math.max(start, windowStart)
    const to = Math.min(end, windowEnd)
    if (to > from) clamped.push([from, to])
  }

  clamped.sort((a, b) => a[0] - b[0])
  let total = 0
  let openFrom: number | null = null
  let openTo = 0
  for (const [from, to] of clamped) {
    if (openFrom === null) {
      openFrom = from
      openTo = to
      continue
    }
    if (from <= openTo) {
      // Overlapping, or touching end-to-end. Extend rather than add — this is
      // the coalesce, and `<=` rather than `<` is what stops a 10:00–11:00 and
      // an 11:00–12:00 being counted as two spans of the same hour boundary.
      openTo = Math.max(openTo, to)
      continue
    }
    total += openTo - openFrom
    openFrom = from
    openTo = to
  }
  if (openFrom !== null) total += openTo - openFrom

  // No clamp against MAX_BUSY_MINUTES here — see that constant. Every interval
  // was clamped to the window above, so the sum is bounded by the window.
  return { busyMinutes: Math.round(total / 60000), eventCount }
}

/**
 * Trade the stored refresh token for a short-lived access token.
 *
 * Every failure gets its OWN sentence, for `calendar-connect`'s reason: a
 * revoked connection is the member's problem to re-connect, an unreachable
 * endpoint is nobody's, and a single generic sentence sends whoever is holding
 * the phone to the wrong place. AC 5 renders these next to the last figure.
 */
async function accessTokenFor(
  deps: CalendarBusyDeps,
  { refreshToken, clientId, clientSecret }: Record<string, string>,
): Promise<{ ok: true; accessToken: string } | { ok: false; message: string; status: number }> {
  let response: Response
  try {
    response = await deps.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
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
    // `invalid_grant` here means the member revoked Taskr in their Google
    // account, or the token was replaced. It is the one failure with a repair
    // the member can perform, so it must not read like an outage.
    if (payload?.error === 'invalid_grant') {
      return {
        ok: false,
        message: 'That calendar connection is no longer valid. Connect it again.',
        status: 502,
      }
    }
    const detail = payload?.error_description ?? payload?.error ?? `HTTP ${response.status}`
    return { ok: false, message: `Google refused the calendar read: ${detail}`, status: 502 }
  }

  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : ''
  if (!accessToken) {
    return {
      ok: false,
      message: 'Google answered with something this app could not read.',
      status: 502,
    }
  }
  return { ok: true, accessToken }
}

/**
 * Ask Google for the week's busy intervals — and hold the answer no longer than
 * the reduction takes.
 */
async function freeBusyFor(
  deps: CalendarBusyDeps,
  { accessToken, timeMin, timeMax }: Record<string, string>,
): Promise<{ ok: true; busy: unknown } | { ok: false; message: string; status: number }> {
  let response: Response
  try {
    response = await deps.fetch(GOOGLE_FREEBUSY_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
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
    const detail = payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`
    return { ok: false, message: `Google refused the calendar read: ${detail}`, status: 502 }
  }

  const calendar = payload?.calendars?.primary
  if (!calendar || typeof calendar !== 'object') {
    return {
      ok: false,
      message: 'Google answered with something this app could not read.',
      status: 502,
    }
  }

  // A per-calendar error is a 200 with the failure INSIDE it — the shape that
  // reads as success to anything checking the status alone, and would have
  // stored a confident zero.
  if (Array.isArray(calendar.errors) && calendar.errors.length > 0) {
    const reason = calendar.errors[0]?.reason ?? 'unknown'
    return { ok: false, message: `Google could not read that calendar: ${reason}`, status: 502 }
  }

  return { ok: true, busy: calendar.busy }
}

/**
 * The whole endpoint, as a function of its dependencies.
 *
 * @param deps see `CalendarBusyDeps` — the things that differ between the edge
 *   runtime and a unit test, and nothing else.
 */
export function createHandler(deps: CalendarBusyDeps) {
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
    // object, and `null.householdId` is a TypeError the try above does not
    // cover — escaping as a bare 500 with no CORS headers, which a browser
    // reports as the network being down. Unreachable from this app's client
    // (supabase-js drops a null body before sending) and guarded anyway, because
    // a refusal that names its reason is the whole contract of this block
    // (review-fanout, 2026-09-04, second pass).
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
      // Loud rather than degraded, and NAMING the missing half. Supabase injects
      // its own three into every function; the two Google ones are set by hand
      // per project — see docs/deploy-runbook.md.
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
    // below have passed. Creating a client grants nothing; what matters is which
    // one answers the authorization questions.
    const asService = deps.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller } = (await asCaller.auth.getUser()) ?? { data: null }
    const callerId = caller?.user?.id
    if (!callerId) return refuse('Sign in first.', 401)

    // TWO filters, for #161's reason: since `0009` a person can hold one member
    // row per household, and `maybeSingle()` over two rows is a REFUSAL rather
    // than a pick. The body names WHICH household and never who — the person is
    // `auth.uid()` off the JWT — so a household they are not in matches nothing.
    const { data: member, error: memberError } = await asCaller
      .from('members')
      .select('id, display_name, claimed_by, email, household_id')
      .eq('claimed_by', callerId)
      .eq('household_id', householdId)
      .maybeSingle()

    if (memberError) return refuse('Could not read your roster entry.', 400)
    if (!member) return refuse('You are not a member of that household.', 403)

    // The discriminator `0007` established, enforced on the SERVER as well as
    // drawn on the screen. A PIN member has no Google identity, so they can hold
    // no token — this refusal is the honest sentence rather than the empty read
    // below, which would say the same thing about a connected member's missing
    // row.
    if (!member.email) {
      return refuse('Reading a calendar needs a real email address on your roster entry.', 403)
    }

    // The ZONE, read through the caller like the member row was — row-level
    // security scopes `households` to the caller's own. It is read rather than
    // taken from the request because it decides which INSTANTS the week covers,
    // and a client-supplied zone would let a caller shift what "this week" means
    // for a figure the whole household reads.
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
      // An unknown IANA name throws inside `Intl`. It is a household row that is
      // wrong rather than anything the member did, so it says so.
      return refuse('This household’s timezone is not one this app understands.', 400)
    }

    // ---- 3: the credential no client is granted -----------------------------

    const { data: token, error: tokenError } = await asService
      .from('calendar_tokens')
      .select('refresh_token')
      .eq('member_id', member.id)
      .maybeSingle()

    if (tokenError) return refuse('Could not read that calendar connection.', 500)
    if (!token?.refresh_token) {
      return refuse('That calendar is not connected.', 409)
    }

    const exchanged = await accessTokenFor(deps, {
      refreshToken: token.refresh_token,
      clientId,
      clientSecret,
    })
    // AC 5. Nothing is written on any failure path: the last derived row stays
    // exactly as it was, which is what the screen falls back to. Overwriting it
    // with a zero would be the harmful version of "handled the error".
    if (!exchanged.ok) return refuse(exchanged.message, exchanged.status)

    const answer = await freeBusyFor(deps, {
      accessToken: exchanged.accessToken,
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
    })
    if (!answer.ok) return refuse(answer.message, answer.status)

    const { busyMinutes, eventCount } = reduceBusy(answer.busy, bounds.timeMin, bounds.timeMax)
    const computedAt = now().toISOString()

    // `onConflict: 'member_id,period_start'` — a second read of the same week is
    // a correction of one fact, which is `0030`'s unique constraint and the key
    // #98's refresh story will upsert on too.
    const { error: writeError } = await asService.from('calendar_busy').upsert(
      {
        household_id: member.household_id,
        member_id: member.id,
        period_start: periodStart,
        busy_minutes: busyMinutes,
        event_count: eventCount,
        computed_at: computedAt,
      },
      { onConflict: 'member_id,period_start' },
    )
    if (writeError) return refuse('Could not store the calendar figure.', 500)

    return json({
      ok: true,
      memberId: member.id,
      periodStart,
      busyMinutes,
      eventCount,
      computedAt,
    })
  }
}
