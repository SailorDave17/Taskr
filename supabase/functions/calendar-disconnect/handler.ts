// Forget a member's Google Calendar — story #99.
//
// `calendar-connect` (#95) stored a refresh token no client can read, and
// `calendar-busy` (#96) spent it into a table of derived figures. This is the
// only way back out, and the charter's trust-erosion kill condition is why it
// exists at all: an input a member cannot switch off erodes exactly the trust
// this feature is asking for.
//
// WHY THE HANDLER IS A SEPARATE MODULE FROM `index.ts`
//
// The same reason `calendar-connect` and `calendar-busy` give, and one of their
// two halves applies harder here. There is no local Google, so AC 4 — the
// revoke call fails and the local deletion succeeds anyway — is a branch no
// suite pointed at a real stack could reach on demand. And AC 1 is about which
// rows are DELETED, which a fake client can testify to precisely because it
// records every call. So the three things that differ between the edge runtime
// and a unit test are arguments, and `handler.test.js` runs in `npm test`, on
// every push, with no network.
//
// ===========================================================================
// THE ORDER OF THE DELETIONS IS THE WHOLE GUARANTEE
// ===========================================================================
//
// Three rows go, and they are deleted CREDENTIAL FIRST:
//
//   1. `calendar_tokens` — the refresh token. A bearer credential for somebody's
//      calendar that does not expire on its own.
//   2. `calendar_busy`   — every derived figure, every week. AC 1's "what Taskr
//      read", which is deliberately not scoped to the current week: a member
//      asking to be forgotten is not asking to be forgotten since Monday.
//   3. `calendar_connections` — the status row the screen reads.
//
// Any of the three can fail, and the residue differs by which. A token left
// behind is a live credential nobody is tracking; a connection row left behind
// is a screen that says "Calendar connected" over nothing. Only the first is
// dangerous, so it goes first — and if a later delete fails the member is told
// and can press the control again, because every step here is keyed on
// `member_id` and deleting a row that is already gone is a no-op. The retry is
// idempotent by construction rather than by care.
//
// There is deliberately no transaction. These are three PostgREST statements,
// and wrapping them would need a `security definer` function holding the token
// table — which is the one table this schema keeps unreachable from SQL a client
// can name (`0011`'s reasoning). The ordering buys what a transaction would, for
// the only failure that matters.
//
// ===========================================================================
// WHY THE GOOGLE SECRETS ARE NOT REQUIRED HERE
// ===========================================================================
//
// `calendar-connect` and `calendar-busy` both refuse with a 500 when
// `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing, because neither can
// do its job without them. This function can: the deletion is entirely local,
// and Google's revocation endpoint takes the token alone.
//
// So the check is ABSENT rather than copied, and the reason is a rule about
// exits: a way out must never be narrower than the way in. A household whose
// Google configuration was removed, rotated or mistyped would otherwise be able
// to connect a calendar and never disconnect one — the state where the app
// holds a credential and refuses to let go of it, which is the precise shape of
// the thing #99 exists to prevent.

/** Google's OAuth 2.0 revocation endpoint. Named so the test can assert it is the one used. */
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

/**
 * Every header supabase-js puts on a `functions.invoke` call.
 *
 * The same list as `provision-member`, `calendar-connect` and `calendar-busy`,
 * restated rather than imported, and #112 is why the list is this long: a
 * browser preflight asks about ALL of the headers at once and a list missing
 * even one fails the whole request before it is sent, with the client reporting
 * "Failed to send a request to the Edge Function" — a sentence that names no
 * header and reads like a dropped connection.
 *
 * Restated rather than imported for the reason all three of the others give:
 * this is a deploy-path constant, and a value that must not change silently
 * should not be resolved at deploy time. `src/test/edge-function-cors.test.js`
 * reads EVERY function directory off the filesystem, so this one is covered by
 * that check from the moment the directory exists.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * The three tables this deletes, in the order it deletes them.
 *
 * Exported so the test asserts the ORDER rather than only the set — see the
 * header: which row survives a partial failure is decided here and nowhere
 * else, and a test that checked membership alone would pass on the dangerous
 * ordering.
 */
export const DELETED_TABLES = Object.freeze([
  'calendar_tokens',
  'calendar_busy',
  'calendar_connections',
])

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
    delete(): { eq(column: string, value: unknown): Promise<{ error: any }> }
  }
}

export interface CalendarDisconnectDeps {
  /** Injected so the revoke call can be exercised with no network — AC 4. */
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
 * Same rule as the three functions beside it: the caller-scoped read already
 * decided what this caller may know, and echoing more back would turn the
 * endpoint into a way to probe other households.
 */
function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * Ask Google to forget the grant too — AC 4, and best-effort by construction.
 *
 * @returns `true` when Google accepted, `false` when it did not or could not be
 *   reached. Never throws, and the caller never branches on it before deleting:
 *   the local deletion is what the member asked for and it happens either way.
 *
 * WHY A FAILURE HERE IS NOT AN ERROR. Three of the ways this fails mean the
 * grant is ALREADY gone — the member revoked Taskr in their Google account, the
 * token was replaced by a later consent, or Google has expired it — and Google
 * answers a token it does not recognise with a 400. Refusing the disconnect on
 * that would leave the app holding a credential *because* the credential was
 * already dead. The fourth way is a network failure, where the honest thing to
 * say is that Taskr has forgotten it and Google may not have.
 *
 * The client id and secret are deliberately not sent. Google's revocation
 * endpoint takes the token alone (RFC 7009's `token` parameter), so requiring
 * them would tie the exit to configuration it does not need — see the header.
 */
async function revokeAtGoogle(
  deps: CalendarDisconnectDeps,
  refreshToken: string,
): Promise<boolean> {
  try {
    const response = await deps.fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    })
    return response.ok
  } catch {
    // Unreachable, timed out, DNS — all the same answer to the one question the
    // caller asks, and none of them a reason to keep the row.
    return false
  }
}

/**
 * The whole endpoint, as a function of its dependencies.
 *
 * @param deps see `CalendarDisconnectDeps` — the three things that differ
 *   between the edge runtime and a unit test, and nothing else.
 */
export function createHandler(deps: CalendarDisconnectDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return refuse('Sign in first.', 401)

    let body: { householdId?: string }
    try {
      body = await req.json()
    } catch {
      return refuse('Send a JSON body.', 400)
    }
    // `req.json()` resolves for the JSON literal `null` as happily as for an
    // object, and `null.householdId` is a TypeError the try above does not
    // cover — escaping as a bare 500 with no CORS headers, which a browser
    // reports as the network being down. `calendar-busy` carries the same guard
    // for the same reason (review-fanout, 2026-09-04).
    if (!body || typeof body !== 'object') return refuse('Send a JSON body.', 400)

    // WHICH household, and only which. The body never says WHO this is about:
    // the person is `auth.uid()` off the JWT, exactly as `calendar-connect` and
    // `calendar-busy` do it, and this narrows that person's roster entries to
    // one household — #161's shape, which a person in two households needs.
    const householdId = String(body.householdId ?? '')
    if (!householdId) return refuse('No household was named.', 400)

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anonKey || !serviceKey) {
      // Supabase injects all three into every function, so this is a platform
      // fault rather than a household's missing setting — which is why it names
      // no variable, unlike the sibling functions' Google check.
      return refuse('This function is not configured.', 500)
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
    // than a pick. Row-level security scopes `members` to the households the
    // caller belongs to, so a household they are not in matches nothing and the
    // read comes back empty — the 403 below, not somebody else's row.
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

    // NO `member.email` CHECK, and its absence is a decision rather than an
    // omission — the header's exit rule. `calendar-connect` and `calendar-busy`
    // both refuse a PIN member because neither can do anything for one; this
    // can, and what it does is delete rows keyed on the caller's OWN member id.
    // A PIN member holds none, so the honest outcome is a successful disconnect
    // that deleted nothing, and a refusal would be a sentence about a rule that
    // protects nobody.

    // ---- 3: the credential no client is granted -----------------------------

    // Read BEFORE the deletions, because revoking needs the value and the first
    // deletion destroys it. A read that fails is not fatal to the disconnect:
    // it costs the revocation, not the forgetting, so it is reported through
    // `revoked` exactly as a refused revoke is.
    //
    // `error` IS bound, and the first draft of this file did not bind it — which
    // is the whole defect the review found, because the omission inverts the one
    // sentence this function owes the member. PostgREST answers a failed read
    // with `data: null`, indistinguishable from an absent row, so an unbound
    // error made a FAILURE report as `null`: *there was nothing to revoke*. The
    // revoke would never be attempted, the deletes would all succeed, and the
    // member would be shown a plain success while Taskr destroyed the only
    // handle on a grant Google may still hold. The sibling `calendar-busy`
    // binds it and refuses; this one binds it and DEGRADES, because a read
    // failure here costs the revocation rather than the forgetting.
    const { data: token, error: tokenError } = await asService
      .from('calendar_tokens')
      .select('refresh_token')
      .eq('member_id', member.id)
      .maybeSingle()

    const storedToken = typeof token?.refresh_token === 'string' ? token.refresh_token : ''

    // Did a PREVIOUS attempt already get past the token deletion?
    //
    // The deletions run credential-first, so no token beside a surviving
    // connection row is the signature of a disconnect that failed part way
    // through — the exact state the 500 below tells the member to repair by
    // pressing Disconnect again. Without this the retry reports `null` and the
    // AC 4 warning is erased on the one path the handler itself prescribes:
    // the revoke outcome was decided on the first attempt, and the value that
    // would let us re-derive it is gone by construction.
    //
    // Read as `service_role` and NOT scoped by household, deliberately: it is
    // keyed on the member row already resolved through the caller, so it can
    // reach nothing this caller has not already been granted.
    const { data: strandedConnection } = await asService
      .from('calendar_connections')
      .select('id')
      .eq('member_id', member.id)
      .maybeSingle()

    // Three values, and the two that are not `true` are NOT interchangeable:
    //
    //   true  — Google accepted the revocation.
    //   false — Taskr could not confirm the grant is gone. Either the revoke was
    //           refused or unreachable, or the credential could not be READ, or
    //           a previous attempt already destroyed it after deciding. All
    //           three leave the member in one state, and it is the state the
    //           screen has a sentence for.
    //   null  — there was nothing outstanding at Google at all.
    //
    // A member with no stored credential and no stranded connection has nothing
    // to be told, and telling them anyway would put "Google may still list
    // Taskr" on a screen where it is untrue — the opposite of what this story is
    // for. `revokeNoteFor` in src/lib/calendar.js owns which of the three
    // speaks.
    let revoked: boolean | null
    if (storedToken) {
      revoked = await revokeAtGoogle(deps, storedToken)
    } else if (tokenError || strandedConnection) {
      // Taskr cannot vouch for the grant: it either could not read the
      // credential, or a previous attempt spent it and did not finish.
      revoked = false
    } else {
      revoked = null
    }

    // ---- The deletions, credential first ------------------------------------

    for (const table of DELETED_TABLES) {
      const { error } = await asService.from(table).delete().eq('member_id', member.id)
      if (error) {
        // The sentence does NOT claim nothing happened, because something did:
        // every table before this one in `DELETED_TABLES` was deleted, and the
        // ordering means the credential is the first thing gone. Saying "part
        // of it went" and asking for another press is both true and the whole
        // repair — a second attempt re-runs the same three deletions, and one
        // that finds nothing left to delete succeeds.
        return refuse(
          'Could not finish disconnecting that calendar. Part of it was removed — ' +
            'press Disconnect again.',
          500,
        )
      }
    }

    return json({ ok: true, memberId: member.id, revoked })
  }
}
