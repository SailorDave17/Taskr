// @vitest-environment node
//
// Node, not the repo-wide jsdom: this exercises a Deno-shaped handler that takes
// a `Request` and returns a `Response`, and Node 22 supplies both as globals.
//
// The extraction endpoint's decisions, with no network, no Supabase and no
// provider — story #208.
//
// WHY THIS RUNS IN `npm test` (AC 8)
//
// The subject is what a PROVIDER does, and there is no local provider. A suite
// that needed one would leave every branch AC 5 is about — a provider error, a
// timeout, an answer that does not parse — covered by nothing that runs. So
// `handler.ts` takes `fetch`, `env`, `createClient` and a clock as arguments,
// and everything below is exercised on every push with none of the four
// things CI lacks.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//
//   - Whether `0036`'s grants and the absence of any policy are right. A fake
//     client returns whatever this file tells it to; it can neither refuse nor
//     enforce. That is src/test/extraction-calls.pglite.test.js.
//   - Whether a BROWSER can call the function at all — a preflight is a browser
//     behaviour and Node sends none. That is src/test/edge-function-cors.test.js,
//     which reads every function directory off disk and so covered this one
//     from the moment the directory existed.
//   - Whether the function is deployed, and whether the deploy carries the
//     `src/lib` files the handler imports. That is `npm run check:live` and
//     #209.
//   - Whether the provider's REAL envelope matches the fixtures. The fixtures
//     are in the documented wire shape, constructed, not captured — and #206's
//     transcript is the run that replayed real envelopes through the same
//     adapter this handler calls (cairn: a fake cannot disagree with its author).
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORS,
  MAX_SPEAKER_LENGTH,
  MAX_TEXT_LENGTH,
  PROVIDER_ENDPOINT,
  PROVIDER_VERSION,
  RATE_LIMIT,
  createHandler,
} from './handler.ts'
import { DEPLOYED_CONFIG } from '../../../src/lib/extractionAdapter.js'

const MEMBER = {
  id: 'member-1',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  household_id: 'household-1',
}

/** The SAME person's roster entry in a SECOND household — #161's shape. */
const MEMBER_IN_B = {
  id: 'member-2',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  household_id: 'household-2',
}

/** What postgrest-js manufactures when `maybeSingle()` matches more than one row. */
const MULTIPLE_ROWS = (n) => ({
  code: 'PGRST116',
  details: `Results contain ${n} rows, application/vnd.pgrst.object+json requires 1 row`,
  hint: null,
  message: 'JSON object requested, multiple (or no) rows returned',
})

// The provider key fixture is assembled rather than written, and deliberately
// too short to be a key: cairn's `a-credential-fixture-must-look-real-to-work`
// records a positive control refused at the push because it had the real
// length. Nothing here is about the key's length, so nothing needs it.
const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_placeholder',
  ANTHROPIC_API_KEY: 'sk-ant-' + 'placeholder',
}

const NOW = new Date('2026-09-07T12:00:00Z')

/**
 * A fake Supabase client that RECORDS WHICH KEY IT WAS BUILT WITH, and
 * answers a window count off the ledger rows this file gives it.
 *
 * Every operation is tagged with the key that performed it, and the tests
 * assert the tag: doing the member read as service_role would bypass RLS and
 * find every household, silently.
 */
function makeWorld(overrides = {}) {
  const world = {
    user: { id: 'auth-1' },
    /** Every member row the CALLER-SCOPED read can see. */
    members: [MEMBER],
    memberError: null,
    /** Rows in `extraction_calls` — `{ household_id, called_at }` — that the window count sees. */
    ledger: [],
    countError: null,
    insertError: null,
    /** Every write attempted, in order, tagged with the key. */
    writes: [],
    /** Every read, tagged with the key that made it. */
    reads: [],
    ...overrides,
  }

  world.createClient = (url, key) => {
    const role = key === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'caller'
    return {
      auth: {
        getUser: async () => ({ data: { user: world.user } }),
      },
      // `SupabaseLike` does not declare this and the handler must not call it —
      // and it stays on the double ON PURPOSE, answering correctly. A fake that
      // cannot express the behaviour being kept out cannot testify that it is
      // absent: with this here, resolving the household through
      // `current_household_ids()` reddens exactly the one assertion about it,
      // rather than everything for the unrelated reason that the fake threw.
      rpc: async (fn, args) => {
        world.reads.push({ role, rpc: fn, args })
        if (fn === 'current_household_ids') {
          return { data: [...new Set(world.members.map((m) => m.household_id))], error: null }
        }
        return { data: null, error: null }
      },
      from: (table) => ({
        select: (columns, options) => {
          const filters = []
          const builder = {
            eq(column, value) {
              filters.push({ op: 'eq', column, value })
              return builder
            },
            gte(column, value) {
              filters.push({ op: 'gte', column, value })
              return builder
            },
            async maybeSingle() {
              world.reads.push({ role, table, columns, filters: [...filters] })
              if (world.memberError) return { data: null, error: world.memberError }
              const matched = world.members.filter((row) =>
                filters.every((f) => row[f.column] === f.value),
              )
              if (matched.length > 1) return { data: null, error: MULTIPLE_ROWS(matched.length) }
              return { data: matched[0] ?? null, error: null }
            },
            // The count query is awaited directly, the way postgrest-js's
            // builder is: `then` makes the builder a thenable.
            then(onfulfilled) {
              // `writesAtCount` is how many ledger rows existed when the count
              // was taken — the insert-before-count order is observable only
              // this way, since reads and writes are recorded in two lists.
              world.reads.push({
                role,
                table,
                columns,
                options,
                filters: [...filters],
                writesAtCount: world.writes.length,
              })
              if (world.countError) return Promise.resolve(onfulfilled({ count: null, error: world.countError }))
              const rows = world.ledger.filter((row) =>
                filters.every((f) =>
                  f.op === 'eq' ? row[f.column] === f.value : row[f.column] >= f.value,
                ),
              )
              return Promise.resolve(onfulfilled({ count: rows.length, error: null }))
            },
          }
          return builder
        },
        insert: async (row) => {
          world.writes.push({ role, table, row })
          if (world.insertError) return { error: world.insertError }
          world.ledger.push({ household_id: row.household_id, called_at: NOW.toISOString() })
          return { error: null }
        },
      }),
    }
  }

  return world
}

/** A Messages API response envelope, in the documented wire shape. */
function envelope(text) {
  return {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model: 'claude-fixture-model',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

/**
 * A `fetch` that answers with whatever this test wants, and records the call —
 * including how many ledger rows existed AT THE MOMENT it was called, which is
 * the only way to assert write-before-call. An `expect` thrown inside the
 * transport is NOT a way: the adapter catches a throwing transport and
 * classifies it as `transport-error`, so the assertion vanishes into a 200
 * refusal and the test reads green — measured on mutation M7, where the
 * ordering test stayed green and a different test carried the red.
 */
function makeFetch(answer) {
  const calls = []
  const fn = vi.fn(async (input, init) => {
    calls.push({ input, init, writesAtCall: world.writes.length })
    if (typeof answer === 'function') return answer()
    return answer
  })
  fn.calls = calls
  return fn
}

const providerOk = (answer) => () =>
  new Response(JSON.stringify(envelope(JSON.stringify(answer))), { status: 200 })

const CAPACITY_ANSWER = { kind: 'capacity', minutesByPerson: { 'Placeholder One': 300 } }
const CHORES_ANSWER = {
  kind: 'chores',
  chores: [
    {
      title: 'take the bins out',
      expectedMinutes: 5,
      dueDate: 'Tuesday',
      repeat: 'every week',
      assignee: 'Placeholder One',
    },
  ],
}

function post(body = { householdId: 'household-1', kind: 'capacity', text: 'I have five hours this week.' }, init = {}) {
  return new Request('https://placeholder.supabase.co/functions/v1/extract-description', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer caller-jwt',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })
}

let world
let fetchFn

function handler({ env = ENV, now = () => NOW } = {}) {
  return createHandler({
    fetch: fetchFn,
    env: (name) => env[name],
    createClient: world.createClient,
    now,
  })
}

/** The body the provider was sent, parsed. */
const sentRequest = () => JSON.parse(fetchFn.calls[0].init.body)

beforeEach(() => {
  world = makeWorld()
  fetchFn = makeFetch(providerOk(CAPACITY_ANSWER))
})

describe('the browser has to be able to reach it at all', () => {
  it('answers a preflight without a body', async () => {
    const response = await handler()(new Request('https://x.test/', { method: 'OPTIONS' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('puts the CORS headers on a REFUSAL too, or the browser hides the reason', async () => {
    const response = await handler()(new Request('https://x.test/', { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      CORS['Access-Control-Allow-Headers'],
    )
  })
})

describe('AC 2 — refused before the provider is involved at all', () => {
  it.each([
    ['a caller with no bearer token', () => post(undefined, { headers: { Authorization: '' } }), 401],
    [
      'a request that is not JSON',
      () =>
        new Request('https://x.test/', {
          method: 'POST',
          headers: { Authorization: 'Bearer caller-jwt' },
          body: 'not json',
        }),
      400,
    ],
    ['a JSON null', () => post(null), 400],
    ['a request naming no household', () => post({ kind: 'capacity', text: 'x' }), 400],
    ['a request with no text', () => post({ householdId: 'household-1', kind: 'capacity', text: '  ' }), 400],
    [
      'a request longer than the cap',
      () => post({ householdId: 'household-1', kind: 'capacity', text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }),
      400,
    ],
  ])('refuses %s', async (_label, build, status) => {
    const response = await handler()(build())
    expect(response.status).toBe(status)
    expect(fetchFn, 'nothing should have been sent to the provider').not.toHaveBeenCalled()
    expect(world.writes, 'nothing should have been written to the ledger').toEqual([])
  })

  it('refuses a caller whose session is not valid', async () => {
    world.user = null
    const response = await handler()(post())
    expect(response.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('refuses a caller with a session and no member row in the household named', async () => {
    // The second half of AC 2: signed in, and not on that roster. Row-level
    // security makes the caller-scoped read come back empty for a household
    // the caller is not in, which the double models by filtering the rows the
    // caller CAN see — so a household id that matches none of them is the 403
    // branch and not the 400 one.
    world.members = [MEMBER]
    const response = await handler()(
      post({ householdId: 'household-somebody-elses', kind: 'capacity', text: 'x' }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/not a member of that household/)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('refuses somebody who is in no household at all', async () => {
    world.members = []
    const response = await handler()(post())
    expect(response.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses when the provider key is missing, and NAMES it', async () => {
    // Supabase injects its own three into every function; the provider key is
    // set by hand per project, so "not configured" almost always means it.
    const response = await handler({ env: { ...ENV, ANTHROPIC_API_KEY: undefined } })(post())
    expect(response.status).toBe(500)
    expect((await response.json()).error).toMatch(/ANTHROPIC_API_KEY/)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('AC 4 — a kind the corpus does not define is refused with the transport never invoked', () => {
  it.each(['week', '', 'CAPACITY', 'chore'])('refuses kind %j', async (kind) => {
    const response = await handler()(post({ householdId: 'household-1', kind, text: 'x' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/capacity, chores/)
    expect(fetchFn, 'the transport must not even be built').not.toHaveBeenCalled()
    expect(world.writes, 'and the window must not be spent').toEqual([])
    // Refused before the caller is resolved, too: a request that cannot be
    // answered should cost no database round trip either.
    expect(world.reads).toEqual([])
  })

  it('POSITIVE CONTROL: both defined kinds reach the provider', async () => {
    for (const kind of ['capacity', 'chores']) {
      world = makeWorld()
      fetchFn = makeFetch(providerOk(kind === 'chores' ? CHORES_ANSWER : CAPACITY_ANSWER))
      const response = await handler()(post({ householdId: 'household-1', kind, text: 'x' }))
      expect(response.status, kind).toBe(200)
      expect(fetchFn, kind).toHaveBeenCalledTimes(1)
    }
  })
})

describe('AC 3 — the household is the one on the member row the request names', () => {
  it('finds the member THROUGH THE CALLER, never as service_role', async () => {
    await handler()(post())
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.role, 'a service_role read bypasses RLS and finds every household').toBe('caller')
    expect(memberRead.filters).toContainEqual({ op: 'eq', column: 'claimed_by', value: 'auth-1' })
    expect(memberRead.filters).toContainEqual({ op: 'eq', column: 'household_id', value: 'household-1' })
  })

  it('a person in two households is answered for the one the request names', async () => {
    // Without the second filter, `maybeSingle()` over two rows is a REFUSAL —
    // the exact state #161 measured on `calendar-connect` — so this is both
    // the two-household case working and the proof the read carries the
    // household. The ledger row is what shows which household was resolved.
    world.members = [MEMBER, MEMBER_IN_B]
    const response = await handler()(post({ householdId: 'household-2', kind: 'capacity', text: 'x' }))
    expect(response.status).toBe(200)
    expect(world.writes.map((w) => w.row.household_id)).toEqual(['household-2'])
    expect(world.writes.map((w) => w.row.member_id)).toEqual(['member-2'])
  })

  it('takes the household from the MEMBER ROW, asking the database for no list', async () => {
    // AC 3's named test. The defect #161 removed from the two deployed
    // functions was `current_household_ids()[0]` — whichever household the
    // database happened to return first. The double answers that RPC
    // correctly, so a handler that reached for it would pass every other
    // assertion in this file and fail exactly this one.
    world.members = [{ ...MEMBER, household_id: 'household-7' }]
    await handler()(post({ householdId: 'household-7', kind: 'capacity', text: 'x' }))
    expect(
      world.reads.find((r) => r.rpc === 'current_household_ids'),
      'the household list must never be consulted',
    ).toBeUndefined()
    expect(world.writes.map((w) => w.row.household_id)).toEqual(['household-7'])
  })

  it('CONTROL: the double refuses two rows the way postgrest-js does', async () => {
    // A test of the instrument, not of the handler: if the double could not
    // express the two-row refusal, the test above would be a fake agreeing
    // with its author.
    world.members = [MEMBER, MEMBER_IN_B]
    const client = world.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY)
    const unscoped = await client.from('members').select('id').eq('claimed_by', 'auth-1').maybeSingle()
    expect(unscoped.data).toBeNull()
    expect(unscoped.error.code).toBe('PGRST116')
  })

  it('IGNORES a member id in the request body', async () => {
    world.members = [MEMBER, { ...MEMBER_IN_B, id: 'member-99' }]
    await handler()(post({ householdId: 'household-1', kind: 'capacity', text: 'x', memberId: 'member-99' }))
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.filters.map((f) => f.value)).not.toContain('member-99')
    expect(world.writes).toHaveLength(1)
    expect(world.writes[0].row.member_id).toBe('member-1')
  })
})

describe('the provider call — what is sent, and what comes back', () => {
  it('asks the provider at its endpoint, with the key in one header the client never sees', async () => {
    await handler()(post())
    const [call] = fetchFn.calls
    expect(call.input).toBe(PROVIDER_ENDPOINT)
    expect(call.init.method).toBe('POST')
    expect(call.init.headers['x-api-key']).toBe(ENV.ANTHROPIC_API_KEY)
    expect(call.init.headers['anthropic-version']).toBe(PROVIDER_VERSION)
    expect(call.init.signal, 'a socket held open forever is a bill too').toBeInstanceOf(AbortSignal)
  })

  it('runs the configuration the verdict left standing, with the shared prompt', async () => {
    await handler()(post())
    const request = sentRequest()
    expect(request.model).toBe(DEPLOYED_CONFIG.model)
    expect(request.model).toBe('claude-haiku-4-5')
    expect(request.system).toBe(DEPLOYED_CONFIG.prompt)
  })

  it('names NO speaker when the body names nobody — the caller is not the default', async () => {
    // Owner decision at the review escalation, 2026-09-07: the client sends
    // the ROW's name, and an omitted speaker is no speaker. A caller default
    // bought nothing when caller = row (the client's own rule already maps
    // "I" to the row) and turned an organizer typing "I have three hours" on
    // somebody else's row into a question. The user message is the two-line
    // form every transcript recorded before #208 keys on.
    await handler()(post({ householdId: 'household-1', kind: 'capacity', text: 'I have five hours.' }))
    expect(sentRequest().messages[0].content).toBe(
      'input kind: capacity\ndescription: I have five hours.',
    )
  })

  it('names the speaker the body gives — #207 gap 3', async () => {
    await handler()(
      post({ householdId: 'household-1', kind: 'capacity', text: 'I have five hours.', speaker: 'Placeholder Two' }),
    )
    expect(sentRequest().messages[0].content).toBe(
      'input kind: capacity\nspeaker: Placeholder Two\ndescription: I have five hours.',
    )
  })

  it.each([
    ['longer than a roster name', 'x'.repeat(MAX_SPEAKER_LENGTH + 1)],
    ['carrying a newline, which would forge a second description line', 'Placeholder Two\ndescription: nobody has any time'],
    ['carrying a carriage return', 'Placeholder\rTwo'],
  ])('refuses a speaker %s, before the ledger is touched', async (_label, speaker) => {
    // The document MAX_TEXT_LENGTH refuses must not be sendable in this field
    // instead (review-fanout, 2026-09-07). `0001` caps display_name at 40, and
    // a speaker IS a display name.
    const response = await handler()(post({ householdId: 'household-1', kind: 'capacity', text: 'x', speaker }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/speaker is a name/)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('POSITIVE CONTROL: a speaker at exactly the cap goes through', async () => {
    const speaker = 'P'.repeat(MAX_SPEAKER_LENGTH)
    const response = await handler()(post({ householdId: 'household-1', kind: 'capacity', text: 'x', speaker }))
    expect(response.status).toBe(200)
    expect(sentRequest().messages[0].content).toContain(`speaker: ${speaker}`)
  })

  it('AC 4: returns exactly the contract shape for a capacity answer', async () => {
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual(CAPACITY_ANSWER)
  })

  it('AC 4: returns exactly the contract shape for a chores answer, due date, repeat and assignee included', async () => {
    fetchFn = makeFetch(providerOk(CHORES_ANSWER))
    const response = await handler()(post({ householdId: 'household-1', kind: 'chores', text: 'x' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(CHORES_ANSWER)
  })

  it('passes a model refusal through as the contract refusal shape, unprefixed', async () => {
    fetchFn = makeFetch(providerOk({ kind: 'refusal', reason: 'no quantity is stated' }))
    const response = await handler()(post())
    expect(response.status).toBe(200)
    const answer = await response.json()
    expect(answer).toEqual({ kind: 'refusal', reason: 'no quantity is stated' })
  })
})

describe('AC 5 — a provider error, a timeout and an unreadable answer are three stated failures', () => {
  const failures = {
    'provider error': () =>
      makeFetch(
        new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }), {
          status: 529,
        }),
      ),
    timeout: () =>
      makeFetch(() => {
        const error = new Error('the operation was aborted due to timeout')
        error.name = 'TimeoutError'
        throw error
      }),
    'unreadable answer': () => makeFetch(new Response('<html>a gateway page</html>', { status: 200 })),
  }

  it.each([
    ['provider error', /^http-error: status 529/],
    ['timeout', /^timeout: /],
    ['unreadable answer', /^unparseable-response: /],
  ])('%s — arrives as a contract refusal naming its outcome', async (label, reason) => {
    fetchFn = failures[label]()
    const response = await handler()(post())
    // 200 with the contract shape, not a 5xx: `src/lib/capture.js` reads these
    // prefixes off a contract-shaped body and turns them into "the service
    // could not answer" — see the handler's header.
    expect(response.status).toBe(200)
    const answer = await response.json()
    expect(answer.kind).toBe('refusal')
    expect(answer.reason).toMatch(reason)
  })

  it('and the three are three, not one generic failure wearing labels', async () => {
    const reasons = new Set()
    for (const build of Object.values(failures)) {
      world = makeWorld()
      fetchFn = build()
      const answer = await (await handler()(post())).json()
      reasons.add(answer.reason.split(':')[0])
    }
    expect(reasons).toEqual(new Set(['http-error', 'timeout', 'unparseable-response']))
  })

  it('a failed attempt still spent the window', async () => {
    // The ledger row is written before the provider is asked, so a provider
    // that is down cannot be hammered for free. Three failures, three rows.
    for (const build of Object.values(failures)) {
      fetchFn = build()
      await handler()(post())
    }
    expect(world.writes).toHaveLength(3)
  })
})

describe('AC 7 — one household is bounded to RATE_LIMIT.calls per RATE_LIMIT.windowMs', () => {
  const inWindow = (n) =>
    Array.from({ length: n }, (_, i) => ({
      household_id: 'household-1',
      called_at: new Date(NOW.getTime() - (i + 1) * 1000).toISOString(),
    }))

  it('POSITIVE CONTROL: below the bound, the call goes through and is recorded FIRST', async () => {
    world.ledger = inWindow(RATE_LIMIT.calls - 1)
    // The row is written before the provider is asked: at the moment the
    // transport fired, the ledger already held this call. Read off the
    // recorded call rather than asserted inside the transport, because "three
    // failures, three rows" cannot tell a write-before from a write-after (the
    // adapter never throws) and an `expect` inside the transport is swallowed
    // by the adapter's catch — see `makeFetch`.
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.calls[0].writesAtCall, 'the ledger row must exist before the provider is asked').toBe(1)
    expect(world.writes).toHaveLength(1)
    expect(world.writes[0]).toEqual({
      role: 'service',
      table: 'extraction_calls',
      row: { household_id: 'household-1', member_id: 'member-1', kind: 'capacity' },
    })
  })

  it('at the bound, the call is refused, the provider is not asked, and the refusal SPENDS a row', async () => {
    // Insert-first, then count with the row: a refused call is recorded too,
    // so a client hammering the bound keeps itself out for the hour, and N
    // devices arriving together at 59 all count 59 + N and are all refused
    // rather than all passing (review-fanout, 2026-09-07 — count-then-insert
    // was two statements with nothing serialising them).
    world.ledger = inWindow(RATE_LIMIT.calls)
    const response = await handler()(post())
    expect(response.status).toBe(429)
    expect((await response.json()).error).toMatch(new RegExp(`${RATE_LIMIT.calls} times`))
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toHaveLength(1)
    const countRead = world.reads.find((r) => r.table === 'extraction_calls')
    expect(countRead.writesAtCount, 'the count is taken AFTER the insert').toBe(1)
  })

  it('counts its own row: the insert happens before the count, so the count includes it', async () => {
    // The order is what makes the bound fail closed under concurrency. The
    // fake's `insert` appends to `world.ledger` at call time, so the count the
    // handler received included this call's row — 59 + 1 = 60, not > 60, and
    // the call goes through; a count taken BEFORE the insert would read 59
    // here and 60 in the test above, passing both while being the race.
    world.ledger = inWindow(RATE_LIMIT.calls - 1)
    const response = await handler()(post())
    expect(response.status).toBe(200)
    const countRead = world.reads.find((r) => r.table === 'extraction_calls')
    expect(countRead.writesAtCount).toBe(1)
    expect(world.ledger).toHaveLength(RATE_LIMIT.calls)
  })

  it('counts the household named on the MEMBER ROW, as service_role, over exactly the window', async () => {
    await handler()(post())
    const countRead = world.reads.find((r) => r.table === 'extraction_calls')
    expect(countRead.role, 'no client is granted this table').toBe('service')
    expect(countRead.options).toEqual({ count: 'exact', head: true })
    expect(countRead.filters).toContainEqual({ op: 'eq', column: 'household_id', value: 'household-1' })
    const since = countRead.filters.find((f) => f.op === 'gte' && f.column === 'called_at')
    expect(new Date(since.value).getTime()).toBe(NOW.getTime() - RATE_LIMIT.windowMs)
  })

  it('a call just outside the window does not count', async () => {
    world.ledger = [
      ...inWindow(RATE_LIMIT.calls - 1),
      { household_id: 'household-1', called_at: new Date(NOW.getTime() - RATE_LIMIT.windowMs - 1).toISOString() },
    ]
    const response = await handler()(post())
    expect(response.status).toBe(200)
  })

  it('another household’s calls do not count against this one', async () => {
    world.ledger = inWindow(RATE_LIMIT.calls).map((row) => ({ ...row, household_id: 'household-2' }))
    const response = await handler()(post())
    expect(response.status).toBe(200)
  })

  it('the owner’s numbers are pinned as literals, because every fixture above derives from the constant', () => {
    // Every AC 7 fixture is built FROM RATE_LIMIT, so `calls: 1`, `calls: 3600`
    // or a one-day window reddens nothing above — the fixtures scale with the
    // mutation (review-fanout, 2026-09-07; the refuter measured the suite
    // incidentally pinning only `windowMs >= calls * 1000`, an artefact of
    // `inWindow`'s one-second spacing). These literals carry the owner's
    // 2026-09-07 decision — sixty calls per household per rolling hour, a
    // 2,000-character description, a 40-character speaker — so a change to
    // any of them is a line in a diff and not a silent re-pricing. No
    // document copies the numbers; this is their one home outside the code.
    expect(RATE_LIMIT).toEqual({ calls: 60, windowMs: 3_600_000 })
    expect(Object.isFrozen(RATE_LIMIT)).toBe(true)
    expect(MAX_TEXT_LENGTH).toBe(2000)
    expect(MAX_SPEAKER_LENGTH).toBe(40)
  })

  it('a ledger that cannot be read or written is a refusal, never a free call', async () => {
    world.countError = { message: 'permission denied' }
    expect((await handler()(post())).status).toBe(500)
    expect(fetchFn).not.toHaveBeenCalled()

    world = makeWorld({ insertError: { message: 'permission denied' } })
    expect((await handler()(post())).status).toBe(500)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
