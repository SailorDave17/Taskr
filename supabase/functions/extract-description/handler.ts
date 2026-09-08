// Extract structured facts from one plain-language description — story #208.
//
// The server half of the charter's one deliberate bet. A phone sends a
// sentence and which flow it came from; this asks a model, through the
// adapter `src/lib/extractionAdapter.js` already wrote for the graded corpus,
// and hands back exactly the contract shape the grader scores. The provider
// credential lives in this function's environment and nowhere a phone can
// reach — which is the whole reason there is an endpoint rather than a fetch
// in the browser.
//
// WHY THE HANDLER IS A SEPARATE MODULE FROM `index.ts`
//
// `calendar-connect`'s reason, and it applies harder here: the subject is what
// a PROVIDER does, and there is no local provider. Everything that decides
// anything takes its dependencies as arguments, and `handler.test.js` runs in
// `npm test`, on every push, with no network, no provider account and no
// credential (AC 8).
//
// WHY THIS IMPORTS FROM `src/lib`, WHICH NO OTHER FUNCTION DOES
//
// The prompt and the parser are written ONCE, in the adapter, and the adapter
// was written to be imported from here — it names no `fetch`, no URL, no
// header and no credential, so the only thing this file adds is the transport.
// A copy under `_shared/` would be a second prompt to keep in step with the one
// the corpus was graded on. The deploy walks relative imports from the
// entrypoint and uploads each file it reaches (read off the CLI source at the
// installed version, `apps/cli-go/pkg/function/deno.go` at v2.116.0, where
// `WalkImportPaths` follows `./` and `../` specifiers with no root check); #209
// is the first deploy and is where that reading is measured. The `#87` scan in
// `src/test/gate.test.js` is unaffected — it refuses `src/` importing from
// `supabase/functions/`, and this is the other direction.
//
// THE AUTHORIZATION SHAPE — the same three steps, in the same order
//
//   1. Find the member THROUGH THE CALLER, by `claimed_by = auth.uid()` AND the
//      household the request names. Row-level security scopes `members` to the
//      households the caller belongs to, so this cannot return somebody else's
//      row even if the caller asks for one — and a caller in TWO households is
//      the everyday case since `0009`, which is why the body names which (#161).
//   2. Take the household FROM THAT ROW, because the row is the record being
//      acted on and the body is not a source of truth about it. Never from
//      `current_household_ids()[0]`, which is the defect #161 removed from the
//      two functions already deployed and which AC 3 exists to keep out of a
//      third.
//   3. Only then use service_role, and only for the one thing a client is
//      deliberately unable to touch: the call ledger the rate bound counts in.
//
// WHAT THIS RETURNS, AND WHY A WIRE FAILURE IS A 200
//
// The adapter folds a provider error, a timeout, an unreadable answer and a
// dead transport into the contract's refusal shape with the outcome as a
// prefix — `http-error: …`, `timeout: …`, `unparseable-response: …`,
// `transport-error: …` — and AC 5 asks that each be a DISTINCT stated failure.
// They are, and they arrive at the phone as the contract shape at status 200,
// because `src/lib/capture.js` was written to read exactly those prefixes off
// a contract-shaped body and turn them into "the service could not answer"
// rather than into a question for the member. A refusal the MODEL made
// carries no prefix and reaches the member as a question. The two are told
// apart by the reason string, which is why the prefixes are the adapter's
// named outcomes and not prose.
//
// Everything that is a refusal of the CALLER — no session, wrong household, a
// kind the corpus does not define, the rate bound — is a non-2xx with `{
// error }`, which the same client reads off the body under that key.

import { DEPLOYED_CONFIG, attemptExtraction } from '../../../src/lib/extractionAdapter.js'
import { INPUT_KINDS } from '../../../src/lib/extraction.js'

/** The provider's Messages endpoint. Named so the test can assert it is the one used. */
export const PROVIDER_ENDPOINT = 'https://api.anthropic.com/v1/messages'

/** The API version the adapter's request and response shapes were written against. */
export const PROVIDER_VERSION = '2023-06-01'

/**
 * Every header supabase-js puts on a `functions.invoke` call.
 *
 * The same list as the three functions before it, restated rather than
 * imported, and #112 is why the list is this long: a browser preflight asks
 * about ALL of the headers at once and a list missing even one fails the whole
 * request before it is sent, with the client reporting "Failed to send a
 * request to the Edge Function" — a sentence that names no header and reads
 * like a dropped connection.
 *
 * Restated rather than imported for the reason the others give: this is a
 * deploy-path constant, and a value that must not change silently should not
 * be resolved at deploy time. `src/test/edge-function-cors.test.js` reads EVERY
 * function directory off the filesystem, so this one was covered by that check
 * from the moment the directory existed (AC 8).
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * The one environment name this function cannot run without, beyond
 * Supabase's own three. Set by hand per project — docs/deploy-runbook.md
 * section 3c — and named in the refusal when it is missing, because the three
 * Supabase ones are always there and an unqualified "not configured" would
 * send somebody to check the wrong half.
 */
export const REQUIRED_PROVIDER_ENV = ['ANTHROPIC_API_KEY']

/**
 * The rate bound — AC 7. One household, one rolling window, one constant,
 * stated here and nowhere else; the refusal sentence and the ledger query both
 * read it from this object.
 *
 * Sixty an hour is generous for people and tight for a loop: a household of
 * five capturing every chore and every week by hand would not reach it, and a
 * foreign client hammering it is held to 1,440 calls a day — at the deployed
 * configuration's measured cost (#206, fractions of a cent a call) a bounded
 * nuisance rather than a bill. The window is ROLLING, counted from the ledger
 * (`0036`), because a counter in this isolate's memory is one count per
 * isolate and is reset on every cold start — a bound that holds in every test
 * and in no production hour. Owner decision at pickup, 2026-09-07. The two
 * numbers are pinned as literals in `handler.test.js` so a change to them is a
 * diff a reader sees; no document copies them.
 */
export const RATE_LIMIT = Object.freeze({ calls: 60, windowMs: 60 * 60 * 1000 })

/**
 * The most description this will send. A sentence is what the bet is about; a
 * pasted document is a bill and a prompt of somebody else's choosing. Refused
 * before the ledger is touched, so an oversized request spends nothing.
 */
export const MAX_TEXT_LENGTH = 2000

/**
 * The most speaker this will send — `0001`'s cap on `display_name`, which is
 * what a speaker IS. Without it the document `MAX_TEXT_LENGTH` refuses could
 * be sent in this field instead and billed sixty times an hour (review-fanout,
 * 2026-09-07). A newline is refused too: the speaker is interpolated into the
 * user message as one line, and a `\n` in it would forge a second
 * `description:` line.
 */
export const MAX_SPEAKER_LENGTH = 40

/**
 * How long this waits on the provider before the adapter's `timeout` outcome.
 * Longer than the phone's own wait (`CLIENT_WAIT_MS`, twice the 3000 ms kill
 * number), deliberately: the phone decides when the MEMBER has waited long
 * enough, and this decides when the ISOLATE stops holding a socket open for an
 * answer nobody is waiting for. The two are different questions, and the
 * server one only has to be finite.
 */
export const PROVIDER_TIMEOUT_MS = 20_000

export interface Filterable {
  eq(column: string, value: unknown): Filterable
  gte(column: string, value: unknown): Filterable
  maybeSingle(): Promise<{ data: any; error: any }>
  then<T>(onfulfilled: (value: { count: number | null; error: any }) => T): Promise<T>
}

/**
 * A minimal shape for the bits of a Supabase client this handler touches.
 *
 * Structural rather than the SDK's own types, for `calendar-connect`'s reason:
 * the point of the injection is that the test supplies a fake, and a fake that
 * has to satisfy the whole client interface is a fake nobody writes. Note what
 * is NOT here: `rpc`. The household is read off the member row and never asked
 * for as a list (AC 3), and a shape with no `rpc` on it is the contract saying
 * so — the test double keeps one, answering correctly, so that a handler which
 * reached for it would redden exactly the assertion about it.
 */
export interface SupabaseLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } | null }> }
  from(table: string): {
    select(columns: string, options?: { count?: 'exact'; head?: boolean }): Filterable
    insert(row: unknown): Promise<{ error: any }>
  }
}

export interface ExtractDescriptionDeps {
  /** Injected so the provider call can be exercised with no network — AC 4, AC 5. */
  fetch: (input: string, init?: unknown) => Promise<Response>
  /** `Deno.env.get` in production; a plain lookup in the test. */
  env: (name: string) => string | undefined
  /** Built per request, because the caller-scoped one carries the caller's JWT. */
  createClient: (url: string, key: string, options?: unknown) => SupabaseLike
  /** The clock, so the window's edge is pinnable. Defaults to the real one. */
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
 * Same rule as the three functions before it: the caller-scoped read already
 * decided what this caller may know, and echoing more back would turn the
 * endpoint into a way to probe other households.
 */
function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * The adapter's transport, and the ONE place in this function a URL, a header
 * and the credential exist. The same shape as `scripts/extraction-run.mjs`'s
 * `liveTransport` — `(requestBody) => { status, body }`, a non-JSON body handed
 * through for the adapter to call unreadable, a timeout thrown as the name
 * `AbortSignal.timeout` produces — restated rather than imported because that
 * file is a Node script that reads `process.env` and the environment is the
 * thing a Deno isolate does differently.
 */
export function providerTransport(
  deps: ExtractDescriptionDeps,
  apiKey: string,
  timeoutMs = PROVIDER_TIMEOUT_MS,
) {
  return async (request: unknown) => {
    const response = await deps.fetch(PROVIDER_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': PROVIDER_VERSION,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: response.status, body }
  }
}

/**
 * The whole endpoint, as a function of its dependencies.
 *
 * @param deps see `ExtractDescriptionDeps` — the things that differ between
 *   the edge runtime and a unit test, and nothing else.
 */
export function createHandler(deps: ExtractDescriptionDeps) {
  const now = deps.now ?? (() => new Date())

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return refuse('Sign in first.', 401)

    let body: { householdId?: string; kind?: string; text?: string; speaker?: string }
    try {
      body = await req.json()
    } catch {
      return refuse('Send a JSON body.', 400)
    }
    // `req.json()` resolves for the literal `null` as happily as for an object
    // (`calendar-busy`, review-fanout 2026-09-04).
    if (!body || typeof body !== 'object') return refuse('Send a JSON body.', 400)

    // WHICH household, and only which — #161. The body never says WHO this is
    // about: the person is `auth.uid()` off the JWT, and this narrows that
    // person's roster entries to one household.
    const householdId = String(body.householdId ?? '')
    const kind = String(body.kind ?? '')
    const text = String(body.text ?? '').trim()
    if (!householdId) return refuse('No household was named.', 400)
    // AC 4: a kind the corpus does not define is refused HERE, before the
    // environment is read, before the caller is resolved, and long before the
    // transport is built — a request that cannot be answered must cost nothing.
    if (!INPUT_KINDS.includes(kind)) {
      return refuse(`Unknown kind "${kind}". Send one of: ${INPUT_KINDS.join(', ')}.`, 400)
    }
    if (!text) return refuse('Describe something first.', 400)
    if (text.length > MAX_TEXT_LENGTH) {
      return refuse(`That is too long to send: keep it under ${MAX_TEXT_LENGTH} characters.`, 400)
    }
    // Who is speaking (#207's third contract gap) — the ROW the capture screen
    // is on, sent by the client, and NOTHING when the body omits it. Not the
    // caller's own name: the client's `proposeCapacity` already maps a
    // first-person key to the row, so a caller default bought nothing when
    // caller = row and turned "I have three hours" typed by an organizer on
    // somebody else's row into a question (owner decision at the review
    // escalation, 2026-09-07). Prompt text and not authority: nothing here is
    // filed under it. Bounded like the text, and before the ledger is touched.
    const speaker = typeof body.speaker === 'string' ? body.speaker.trim() : ''
    if (speaker.length > MAX_SPEAKER_LENGTH || /[\r\n]/.test(speaker)) {
      return refuse(`A speaker is a name: at most ${MAX_SPEAKER_LENGTH} characters, on one line.`, 400)
    }

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    const apiKey = deps.env('ANTHROPIC_API_KEY')
    if (!url || !anonKey || !serviceKey || !apiKey) {
      // Loud rather than degraded, and NAMING the missing half. Supabase injects
      // its own three into every function; the provider key is set by hand per
      // project — docs/deploy-runbook.md section 3c.
      const missing = REQUIRED_PROVIDER_ENV.filter((name) => !deps.env(name))
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
    // than a pick. The household in the filter is the one the body named; the
    // household this function ACTS ON is the one on the row that comes back.
    const { data: member, error: memberError } = await asCaller
      .from('members')
      .select('id, display_name, claimed_by, household_id')
      .eq('claimed_by', callerId)
      .eq('household_id', householdId)
      .maybeSingle()

    if (memberError) return refuse('Could not read your roster entry.', 400)
    // Covers "no such household", "not yours" and "not on that roster" alike,
    // deliberately indistinguishable — the caller-scoped read already decided
    // what this caller may know (AC 2).
    if (!member) return refuse('You are not a member of that household.', 403)

    // The household everything below is filed under. `member.household_id`
    // rather than `householdId` off the body: the body is allowed to NARROW the
    // read and never to be the source of what gets written (#161; AC 3). No
    // `current_household_ids()` call anywhere in this file, and that absence is
    // the contract — `SupabaseLike` has no `rpc` to call it with.
    const household = String(member.household_id)

    // ---- 3: the ledger no client is granted — AC 7 -------------------------

    // INSERT FIRST, THEN COUNT — and the order is the whole bound. A count
    // followed by an insert is two statements with nothing serialising them,
    // so N devices reading the count inside one round trip would all see 59
    // and all pass (review-fanout, 2026-09-07 — bounded by devices, since this
    // client never has two requests in flight, but a first draft stated the
    // bound as exact). Writing the row first and counting WITH it fails closed
    // instead: the N-th concurrent caller counts 59 + N and is refused. A
    // refused call therefore also spends a row, which is the point — a client
    // hammering the bound keeps itself out for the hour — and so does an
    // attempt that times out or is refused by the provider, since the row
    // exists before the provider is asked; a ledger of successes would let a
    // failing provider be hammered for free.
    const { error: ledgerError } = await asService.from('extraction_calls').insert({
      household_id: household,
      member_id: member.id,
      kind,
    })
    if (ledgerError) return refuse('Could not record the call.', 500)

    const windowStart = new Date(now().getTime() - RATE_LIMIT.windowMs).toISOString()
    const { count, error: countError } = await asService
      .from('extraction_calls')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', household)
      .gte('called_at', windowStart)
    if (countError) return refuse('Could not read the call ledger.', 500)
    // `>` and not `>=`: the count includes the row this call just wrote.
    if ((count ?? 0) > RATE_LIMIT.calls) {
      return refuse(
        `This household has asked ${RATE_LIMIT.calls} times in the last ` +
          `${Math.round(RATE_LIMIT.windowMs / 60000)} minutes. Try again later.`,
        429,
      )
    }

    // ---- The provider, through the adapter -----------------------------------

    const attempt = await attemptExtraction(
      DEPLOYED_CONFIG,
      providerTransport(deps, apiKey),
      speaker ? { kind, text, speaker } : { kind, text },
    )

    // The contract shape, unchanged, at 200 — see the header for why a wire
    // failure is not a 5xx here. `attempt.answer` is ALWAYS one of the three
    // documented shapes; the adapter's own tests hold that.
    return json(attempt.answer)
  }
}
