// Exchange a Google authorization code for a refresh token — story #95.
//
// WHY THE HANDLER IS A SEPARATE MODULE FROM `index.ts`
//
// `index.ts` calls `Deno.serve` at import time and imports from `npm:`, so it
// cannot be loaded by anything but the edge runtime. #87's function is tested by
// driving real HTTP against a LOCAL Supabase stack, which needs Docker, Postgres
// and GoTrue — none of which CI has, which is why that suite is a third runner
// that CI does not run.
//
// This story cannot afford that. #95 AC 2 asks for the handler to be
// "unit-tested in vitest with an injected fetch", and the reason is the thing
// being tested: the call to Google. There is no local Google, so a suite that
// needs a real one is a suite that never runs — and the branch that matters most
// (AC 6: Google returns an error, and NO token row exists afterwards) is exactly
// the branch a live harness is worst at reaching.
//
// So everything that decides anything lives here, behind three injected
// dependencies, and `index.ts` is the four lines that bind them to the platform.
// `handler.test.js` runs in `npm test`, on every push, with no network.
//
// WHAT IS NOT INJECTED, AND WHY THAT IS THE POINT
//
// The authorization shape is not a dependency. It is the same shape #87
// establishes and the same reason: this function holds a key that can do
// anything to anybody, so the caller's authority is settled with a
// CALLER-SCOPED client — the anon key plus the caller's own JWT — before the
// service_role client is used for anything.
//
//   1. Find the member THROUGH THE CALLER, by `claimed_by = auth.uid()` AND the
//      household the request names. Row level security scopes `members` to the
//      households the caller belongs to, so this cannot return somebody else's
//      row even if the caller asks for one. The request body never says who it
//      is about — only which household, and a household the caller is not in
//      matches nothing.
//   2. Take the household FROM THAT ROW, because the row is the record being
//      acted on and the body is not a source of truth about it.
//   3. Only then use service_role, and only to write the two rows a client is
//      deliberately unable to write at all.
//
// Doing (1) with service_role would be the classic hole. Under the shape above,
// getting it wrong fails closed: the read returns nothing.
//
// Step 2 is #161, and it replaces a step that asked the database which
// households the caller was in and then took the FIRST one. That was correct
// for exactly as long as there could only be one. Since 0009 a person can hold
// a member row per household, and from that moment the old step 1 could not
// return a row at all — `maybeSingle()` over two rows is a refusal, not a pick —
// so this endpoint failed outright for anyone in two households.

/** Google's OAuth 2.0 token endpoint. Named so the test can assert it is the one used. */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/**
 * Every header supabase-js puts on a `functions.invoke` call.
 *
 * The same list as `provision-member`, restated rather than imported, and #112
 * is why the list is this long: a browser preflight asks about ALL of the
 * headers at once and a list missing even one fails the whole request before it
 * is sent, with the client reporting "Failed to send a request to the Edge
 * Function" — a sentence that names no header and reads like a dropped
 * connection.
 *
 * `authorization` and `content-type` are the two anyone would think of.
 * `apikey` is set by the client's own fetch wrapper on every request,
 * `x-client-info` is a default header on every Supabase client, and
 * `x-retry-count` is postgrest-js's — none of the three appears at any call site
 * in this repo, which is why the short list looked complete.
 *
 * Restated rather than imported for the reason `provision-member` gives: this is
 * a deploy-path constant, and a value that must not change silently should not
 * be resolved at deploy time. `src/test/edge-function-cors.test.js` asserts the
 * list in EVERY function directory still covers the SDK's published set, so an
 * SDK release that adds a header fails the gate here rather than on a phone.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** The three environment names this function cannot run without, beyond Supabase's own. */
export const REQUIRED_GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']

/**
 * A minimal shape for the bits of a Supabase client this handler touches.
 *
 * Deliberately structural rather than the SDK's own types: the point of the
 * injection is that the test supplies a fake, and a fake that has to satisfy the
 * whole client interface is a fake nobody writes.
 */
export interface SupabaseLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null }> }
  from(table: string): {
    select(columns: string): Filterable
    upsert(row: unknown, options?: unknown): Promise<{ error: any }>
    delete(): { eq(column: string, value: unknown): Promise<{ error: any }> }
  }
}

/**
 * A filter chain, because one `eq()` was never the shape of the question — #161.
 *
 * This used to read `eq(...): { maybeSingle() }`, which is worth stating plainly
 * rather than quietly widening: the type could express neither a second filter
 * nor a result of more than one row, so the defect #161 fixes was invisible in
 * the CONTRACT and not merely untested. A fake written to satisfy that shape
 * agreed with it, and the two agreed with each other about something neither had
 * checked.
 *
 * `maybeSingle()` returning more than one row is an ERROR, not a pick.
 * *Measured 2026-08-26* against a local stack, one auth user claimed on member
 * rows in two households: `status 406`, `data null`, `code PGRST116`. The
 * handler routes that to 'Could not read your roster entry.' with a 400, so
 * before this story such a person could not connect a calendar at all.
 */
export interface Filterable {
  eq(column: string, value: unknown): Filterable
  maybeSingle(): Promise<{ data: any; error: any }>
}

export interface CalendarConnectDeps {
  /** Injected so the Google call can be exercised with no network — AC 2 and AC 6. */
  fetch: (input: string, init?: unknown) => Promise<Response>
  /** `Deno.env.get` in production; a plain lookup in the test. */
  env: (name: string) => string | undefined
  /** Built per request, because the caller-scoped one carries the caller's JWT. */
  createClient: (url: string, key: string, options?: unknown) => SupabaseLike
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
 * Same rule as `provision-member`: the caller-scoped read already decided what
 * this caller may know, and echoing more back would turn the endpoint into a way
 * to probe other households.
 */
function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * Ask Google to trade the authorization code for tokens.
 *
 * Every failure gets its OWN sentence, because they route to different repairs
 * and a single generic one sends whoever is holding the phone to the wrong
 * place: a refused code is the member's problem to retry, a missing
 * `refresh_token` is a consent-parameter problem in this repo, and an
 * unreachable endpoint is neither.
 */
async function exchangeCode(
  deps: CalendarConnectDeps,
  { code, redirectUri, clientId, clientSecret }: Record<string, string>,
): Promise<{ ok: true; refreshToken: string; scope: string } | { ok: false; message: string; status: number }> {
  let response: Response
  try {
    response = await deps.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
  } catch {
    // The endpoint itself was unreachable. Distinct from a refusal, because
    // there is nothing for the member to correct.
    return { ok: false, message: 'Could not reach Google. Try again in a moment.', status: 502 }
  }

  let payload: any = null
  let unreadable = false
  try {
    payload = await response.json()
  } catch {
    unreadable = true
  }

  if (!response.ok) {
    // Google's own words where it gave any, because "invalid_grant" against a
    // code that has already been used reads very differently from a redirect_uri
    // that does not match what is registered — and only one of those is fixed by
    // pressing the button again.
    const detail = payload?.error_description ?? payload?.error ?? `HTTP ${response.status}`
    return { ok: false, message: `Google refused the connection: ${detail}`, status: 502 }
  }

  if (unreadable || !payload || typeof payload !== 'object') {
    return {
      ok: false,
      message: 'Google answered with something this app could not read.',
      status: 502,
    }
  }

  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : ''
  if (!refreshToken) {
    // A 200 with no refresh token is what Google returns when the member has
    // consented before and the consent request did not ask to be re-prompted.
    // It is a bug in THIS repo's consent URL rather than anything the member
    // did, so it must not be reported as a Google refusal — `src/lib/calendar.js`
    // sends `access_type=offline` and `prompt=consent` for exactly this reason.
    return {
      ok: false,
      message:
        'Google did not return a lasting connection. Disconnect Taskr in your Google account, then try again.',
      status: 502,
    }
  }

  return { ok: true, refreshToken, scope: String(payload.scope ?? '') }
}

/**
 * The whole endpoint, as a function of its dependencies.
 *
 * @param deps see `CalendarConnectDeps` — the three things that differ between
 *   the edge runtime and a unit test, and nothing else.
 */
export function createHandler(deps: CalendarConnectDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return refuse('Sign in first.', 401)

    let body: { code?: string; redirectUri?: string; householdId?: string }
    try {
      body = await req.json()
    } catch {
      return refuse('Send a JSON body.', 400)
    }

    const code = String(body.code ?? '')
    const redirectUri = String(body.redirectUri ?? '')
    // WHICH household, and only which — #161. The body still never says WHO
    // this is about: the person is `auth.uid()` off the JWT, exactly as before,
    // and this narrows that person's roster entries to one household.
    //
    // It cannot widen anything. Row level security scopes `members` to the
    // households the caller belongs to, so a household id they are not in
    // matches no row and the read comes back empty — the 403 below, not a
    // successful read of somebody else's household. *Measured* against a local
    // stack: a bogus id returns `data: null` with no error at all.
    const householdId = String(body.householdId ?? '')
    if (!code) return refuse('No authorization code was sent.', 400)
    if (!redirectUri) return refuse('No redirect address was sent.', 400)
    if (!householdId) return refuse('No household was named.', 400)

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    const clientId = deps.env('GOOGLE_CLIENT_ID')
    const clientSecret = deps.env('GOOGLE_CLIENT_SECRET')
    if (!url || !anonKey || !serviceKey || !clientId || !clientSecret) {
      // Loud rather than degraded, and NAMING the missing half. Supabase injects
      // its own three into every function; the two Google ones are set by hand
      // per project, so "not configured" here almost always means those and the
      // message should say which — see docs/deploy-runbook.md.
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

    // `household_id` IS selected now, and that sentence is a reversal worth
    // stating rather than a quiet edit. It was absent from 0007's select grant
    // for `authenticated`, and a column withheld from `select` cannot even be
    // NAMED — PostgREST answers "permission denied for table members", which
    // reads like the whole table is closed rather than like one column is
    // (measured on #87: naming it made every call fail with a 400). `0014`
    // grants it, for #159's reason: to filter by a household a client has to be
    // able to name one, and #157 measured that no query rewriting reaches around
    // that. So the trap this comment used to warn about is gone.
    //
    // TWO filters, not one — #161. `claimed_by` alone was correct for exactly as
    // long as a person could hold one member row. Since 0009 they can hold one
    // per household, and `maybeSingle()` over two rows is a REFUSAL rather than
    // a pick: the read comes back `PGRST116` with `data` null, so this fell
    // straight to the 400 below and a person in two households could not connect
    // a calendar at all.
    const { data: member, error: memberError } = await asCaller
      .from('members')
      .select('id, display_name, claimed_by, email, household_id')
      .eq('claimed_by', callerId)
      .eq('household_id', householdId)
      .maybeSingle()

    if (memberError) return refuse('Could not read your roster entry.', 400)
    // Covers "no such household", "not yours" and "not on that roster" alike,
    // deliberately indistinguishable — the caller-scoped read already decided
    // what this caller may know.
    if (!member) return refuse('You are not a member of that household.', 403)

    // The discriminator 0007 established, enforced on the SERVER as well as
    // drawn on the screen. #95 AC 1 is a routing rule about what is shown, and a
    // rule that lives only in a component is a rule for clients that choose to
    // honour it — docs/access-model.md's central lesson. A PIN member has no
    // Google identity to consent with, so this cannot be reached honestly; it
    // can be reached by anybody who calls the endpoint directly.
    if (!member.email) {
      return refuse(
        'Connecting a calendar needs a real email address on your roster entry.',
        403,
      )
    }

    // No `current_household_ids()` call any more, and its absence is the fix.
    // It answered "which households is this person in", and the code then took
    // element [0] of that — whichever the database happened to return first —
    // as the household to file the connection under. The member row read above
    // answers the question that was actually being asked, and answers it about
    // the record being acted on. `member.household_id` rather than the
    // `householdId` off the body: the body is allowed to NARROW the read and
    // never to be the source of what gets written.

    // ---- The exchange, before anything at all is written --------------------

    const exchanged = await exchangeCode(deps, { code, redirectUri, clientId, clientSecret })
    if (!exchanged.ok) {
      // AC 6. Nothing has been written at this point and nothing will be: the
      // ordering is the whole guarantee, which is why the exchange happens
      // before the first service_role call rather than inside a rollback.
      return refuse(exchanged.message, exchanged.status)
    }

    // ---- 3: the two writes no client is granted -----------------------------

    // `onConflict: 'member_id'` stays right per household rather than in spite of
    // them — #161 criterion 7. `0011`'s unique index is per MEMBER ROW, and two
    // households mean two member rows for one person, so these two upserts can
    // never collide across households: reconnecting in household A replaces
    // A's token and leaves B's alone. The constraint that would have been wrong
    // here is one keyed on the PERSON.
    const { error: tokenError } = await asService.from('calendar_tokens').upsert(
      {
        household_id: member.household_id,
        member_id: member.id,
        refresh_token: exchanged.refreshToken,
        scope: exchanged.scope,
      },
      { onConflict: 'member_id' },
    )
    if (tokenError) return refuse('Could not store the connection.', 500)

    const { error: connectionError } = await asService.from('calendar_connections').upsert(
      {
        household_id: member.household_id,
        member_id: member.id,
        scope: exchanged.scope,
      },
      { onConflict: 'member_id' },
    )
    if (connectionError) {
      // A token nobody can see is worse than no token: the screen would say
      // "not connected", the member would press Connect again, and a live
      // credential would sit in a table nothing reads. Same rollback argument as
      // #87's orphaned auth user.
      await asService.from('calendar_tokens').delete().eq('member_id', member.id)
      return refuse('Could not record the connection.', 500)
    }

    return json({ ok: true, memberId: member.id, scope: exchanged.scope })
  }
}
