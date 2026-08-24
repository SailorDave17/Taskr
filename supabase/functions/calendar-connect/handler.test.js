// @vitest-environment node
//
// Node, not the repo-wide jsdom: this exercises a Deno-shaped handler that takes
// a `Request` and returns a `Response`, and Node 22 supplies both as globals.
//
// The Edge Function's decisions, with no network and no Supabase — story #95.
//
// WHY THIS RUNS IN `npm test` AND #87's FUNCTION SUITE DOES NOT
//
// `provisioning.functions.test.js` drives the real function over real HTTP
// against a LOCAL Supabase stack, which needs Docker, Postgres, GoTrue and a
// service_role key — none of which CI has, so it is a third runner CI never
// runs. That is the right trade for #87, whose whole subject is what Postgres
// and GoTrue do.
//
// It is the wrong trade here, because the subject is what GOOGLE does, and there
// is no local Google. A suite that needed one would leave the branch #95 AC 6 is
// entirely about — Google refuses, and NO token row exists afterwards — covered
// by nothing that runs. So `handler.ts` takes `fetch`, `env` and `createClient`
// as arguments, and everything below is exercised on every push.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//
//   - Whether the grants and policies in `0011` are right. A fake client returns
//     whatever this file tells it to; it can neither refuse nor enforce. That is
//     src/test/calendar.pglite.test.js.
//   - Whether a BROWSER can call the function at all — a preflight is a browser
//     behaviour and Node sends none. That is src/test/edge-function-cors.test.js,
//     and #112 is this repo's recorded case of a Node harness passing while the
//     deployed path was blocked.
//   - Whether the function is deployed. That is `npm run check:live`.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CORS, GOOGLE_TOKEN_ENDPOINT, createHandler } from './handler.ts'

const MEMBER = {
  id: 'member-1',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  email: 'placeholder.one@example.test',
}

const PIN_MEMBER = { ...MEMBER, email: null }

const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_placeholder',
  GOOGLE_CLIENT_ID: '1234567890-placeholder.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-placeholder',
}

const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'

/**
 * A fake Supabase client that RECORDS WHICH KEY IT WAS BUILT WITH.
 *
 * That is the point of the fake rather than an accident of it. #87's
 * authorization shape says the caller's authority must be settled with a
 * caller-scoped client BEFORE the service_role one is used for anything, and the
 * failure mode of getting it wrong is silent: doing the member read as
 * service_role bypasses row-level security, so it succeeds for every member of
 * every household and the only thing left between a signed-in stranger and
 * somebody else's calendar is a check this file could get wrong.
 *
 * So every operation is tagged with the key that performed it, and the tests
 * assert the tag rather than trusting the ordering to be visible.
 */
function makeWorld(overrides = {}) {
  const world = {
    user: { id: 'auth-1' },
    member: MEMBER,
    memberError: null,
    householdIds: ['household-1'],
    householdError: null,
    upsertErrors: {},
    /** Every write attempted, in order — `[]` is what AC 6 asserts. */
    writes: [],
    /** Every read, tagged with the key that made it. */
    reads: [],
    deletes: [],
    ...overrides,
  }

  world.createClient = (url, key) => {
    const role = key === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'caller'
    return {
      auth: {
        getUser: async () => ({ data: { user: world.user } }),
      },
      rpc: async (fn) => {
        world.reads.push({ role, rpc: fn })
        if (fn === 'current_household_ids') {
          return { data: world.householdIds, error: world.householdError }
        }
        return { data: null, error: null }
      },
      from: (table) => ({
        select: (columns) => ({
          eq: (column, value) => ({
            maybeSingle: async () => {
              world.reads.push({ role, table, columns, column, value })
              return { data: world.member, error: world.memberError }
            },
          }),
        }),
        upsert: async (row, options) => {
          world.writes.push({ role, table, row, options })
          return { error: world.upsertErrors[table] ?? null }
        },
        delete: () => ({
          eq: async (column, value) => {
            world.deletes.push({ role, table, column, value })
            return { error: null }
          },
        }),
      }),
    }
  }

  return world
}

/** A `fetch` that answers once with whatever this test wants, and records the call. */
function makeFetch(answer) {
  const calls = []
  const fn = vi.fn(async (input, init) => {
    calls.push({ input, init })
    if (typeof answer === 'function') return answer()
    return answer
  })
  fn.calls = calls
  return fn
}

const googleOk = (body = { refresh_token: '1//placeholder-refresh', scope: FREEBUSY }) =>
  new Response(JSON.stringify(body), { status: 200 })

function post(body = { code: 'the-code', redirectUri: 'https://taskr.example.test/' }, init = {}) {
  return new Request('https://placeholder.supabase.co/functions/v1/calendar-connect', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  })
}

let world
let fetchFn

function handler({ env = ENV } = {}) {
  return createHandler({
    fetch: fetchFn,
    env: (name) => env[name],
    createClient: world.createClient,
  })
}

beforeEach(() => {
  world = makeWorld()
  fetchFn = makeFetch(googleOk())
})

describe('the browser has to be able to reach it at all', () => {
  it('answers a preflight without a body', async () => {
    const response = await handler()(
      new Request('https://x.test/', { method: 'OPTIONS' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('puts the CORS headers on a REFUSAL too, or the browser hides the reason', async () => {
    // A response without them is unreadable to the page that asked: the fetch
    // rejects on the CORS check and the app reports a network error instead of
    // the sentence the function wrote. #112 in miniature.
    const response = await handler()(new Request('https://x.test/', { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      CORS['Access-Control-Allow-Headers'],
    )
  })
})

describe('what it refuses before Google is involved at all', () => {
  it.each([
    [
      'a caller with no bearer token',
      () => post(undefined, { headers: { Authorization: '' } }),
      401,
    ],
    ['a request that is not JSON', () =>
      new Request('https://x.test/', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt' },
        body: 'not json',
      }), 400],
    ['a request with no code', () => post({ redirectUri: 'https://taskr.example.test/' }), 400],
    ['a request with no redirect address', () => post({ code: 'the-code' }), 400],
  ])('refuses %s', async (_label, build, status) => {
    const response = await handler()(build())
    expect(response.status).toBe(status)
    expect(fetchFn, 'nothing should have been sent to Google').not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('refuses when a Google secret is missing, and NAMES which one', async () => {
    // Supabase injects its own three into every function; the two Google ones
    // are set by hand per project, so "not configured" almost always means those.
    // A message that did not say which sends somebody to check the wrong ones —
    // and this is the state the live project is in until the runbook step runs.
    const response = await handler({ env: { ...ENV, GOOGLE_CLIENT_SECRET: undefined } })(post())
    expect(response.status).toBe(500)
    expect((await response.json()).error).toMatch(/GOOGLE_CLIENT_SECRET/)
  })

  it('refuses a caller whose session is not valid', async () => {
    world.user = null
    const response = await handler()(post())
    expect(response.status).toBe(401)
    expect(world.writes).toEqual([])
  })

  it('refuses somebody who is in no household', async () => {
    world.member = null
    const response = await handler()(post())
    expect(response.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('AC 1 — refuses a PIN member, on the server, whatever the screen drew', async () => {
    // The screen does not offer this to a member with no address (#95 AC 1), and
    // that is manners rather than a boundary: the control is a component, and a
    // rule enforced only inside code we provide is enforced only for callers who
    // choose to call it. docs/access-model.md's central lesson, applied to a
    // function.
    world.member = PIN_MEMBER
    const response = await handler()(post())
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/real email address/)
    expect(fetchFn, 'a PIN member has no Google identity to ask about').not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })
})

describe('the authorization shape — who answers which question', () => {
  it('finds the member THROUGH THE CALLER, never as service_role', async () => {
    await handler()(post())
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.role, 'a service_role read bypasses RLS and finds every household').toBe(
      'caller',
    )
    expect(memberRead.column, 'the request body must not say who this is about').toBe('claimed_by')
    expect(memberRead.value).toBe('auth-1')
  })

  it('never NAMES household_id in the member select, which the grant withholds', async () => {
    // Measured on #87: naming it made every call fail with a 400, because a
    // column withheld from `select` cannot even be mentioned — PostgREST answers
    // "permission denied for table members", which reads like the whole table is
    // closed rather than like one column is.
    await handler()(post())
    expect(world.reads.find((r) => r.table === 'members').columns).not.toContain('household_id')
  })

  it('asks the database which household the caller is in, as the caller', async () => {
    await handler()(post())
    const rpc = world.reads.find((r) => r.rpc === 'current_household_ids')
    expect(rpc.role).toBe('caller')
  })

  it('writes as service_role, because the client is granted nothing here', async () => {
    await handler()(post())
    expect(world.writes.every((w) => w.role === 'service')).toBe(true)
  })
})

describe('AC 2 — the exchange happens on the server', () => {
  it('asks GOOGLE, at its token endpoint, with the secret the client never sees', async () => {
    await handler()(post())
    const [call] = fetchFn.calls
    expect(call.input).toBe(GOOGLE_TOKEN_ENDPOINT)
    expect(call.init.method).toBe('POST')

    const sent = new URLSearchParams(call.init.body)
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code')).toBe('the-code')
    expect(sent.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID)
    expect(sent.get('client_secret')).toBe(ENV.GOOGLE_CLIENT_SECRET)
    expect(sent.get('redirect_uri')).toBe('https://taskr.example.test/')
  })

  it('stores the refresh token in the token table, with the household it belongs to', async () => {
    const response = await handler()(post())
    expect(response.status).toBe(200)

    const token = world.writes.find((w) => w.table === 'calendar_tokens')
    expect(token.row).toEqual({
      household_id: 'household-1',
      member_id: 'member-1',
      refresh_token: '1//placeholder-refresh',
      scope: FREEBUSY,
    })
    // A second connection is a CORRECTION of the same fact, so the old token is
    // replaced. Accumulating rows would be a pile of live credentials nobody is
    // tracking, and the unique constraint in `0011` is what this rides on.
    expect(token.options).toEqual({ onConflict: 'member_id' })
  })

  it('records the connection the screen reads, carrying NO credential', async () => {
    // AC 5's half of the split: `calendar_connections` is what the client may
    // select, so anything replayable against Google must not be in it.
    await handler()(post())
    const connection = world.writes.find((w) => w.table === 'calendar_connections')
    expect(connection.row).toEqual({
      household_id: 'household-1',
      member_id: 'member-1',
      scope: FREEBUSY,
    })
    expect(JSON.stringify(connection.row)).not.toContain('1//')
  })

  it('records what Google GRANTED rather than what was asked for', async () => {
    // #101 widens this through incremental consent, and a later slice has to
    // know which scope it is actually holding. Storing the request would make
    // that answer a guess.
    fetchFn = makeFetch(
      googleOk({ refresh_token: '1//x', scope: `${FREEBUSY} https://www.googleapis.com/auth/calendar.readonly` }),
    )
    await handler()(post())
    expect(world.writes.find((w) => w.table === 'calendar_tokens').row.scope).toContain('readonly')
  })
})

describe('AC 6 — Google fails, and no token row exists', () => {
  it('POSITIVE CONTROL: the happy path DOES write two rows', async () => {
    // Without this, every "wrote nothing" assertion below passes just as
    // happily against a handler that writes nothing ever — an absence proving
    // nothing, which is how this whole family of assertions goes quiet.
    await handler()(post())
    expect(world.writes.map((w) => w.table)).toEqual(['calendar_tokens', 'calendar_connections'])
  })

  it.each([
    [
      'Google refuses the code',
      () =>
        makeFetch(
          new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), {
            status: 400,
          }),
        ),
      /Google refused the connection/,
    ],
    [
      'Google cannot be reached',
      () =>
        makeFetch(() => {
          throw new TypeError('fetch failed')
        }),
      /Could not reach Google/,
    ],
    [
      'Google answers with something unreadable',
      () => makeFetch(new Response('<html>502</html>', { status: 200 })),
      /could not read/,
    ],
    [
      'Google answers 200 with no refresh token',
      () => makeFetch(googleOk({ access_token: 'ya29.placeholder', scope: FREEBUSY })),
      /lasting connection/,
    ],
  ])('%s — nothing is written and the sentence says which', async (_label, build, message) => {
    fetchFn = build()
    const response = await handler()(post())

    expect(response.status).toBe(502)
    expect((await response.json()).error).toMatch(message)
    expect(world.writes, 'AC 6: no token row may exist after a failed exchange').toEqual([])
    expect(world.deletes, 'nothing was written, so nothing needs undoing').toEqual([])
  })

  it('gives each failure its OWN sentence, so they do not collapse into one', async () => {
    // Four distinct causes with four distinct repairs: retry, wait, report a
    // bug, revoke and reconnect. A single generic message sends whoever is
    // holding the phone to the wrong one — which is what #56 AC 3 asks for on
    // the extraction endpoint, and the same argument applies here.
    const messages = new Set()
    for (const build of [
      () => makeFetch(new Response('{"error":"invalid_grant"}', { status: 400 })),
      () =>
        makeFetch(() => {
          throw new TypeError('fetch failed')
        }),
      () => makeFetch(new Response('<html>', { status: 200 })),
      () => makeFetch(googleOk({ access_token: 'ya29.x' })),
    ]) {
      world = makeWorld()
      fetchFn = build()
      messages.add((await (await handler()(post())).json()).error)
    }
    expect(messages.size).toBe(4)
  })
})

describe('when the database refuses the write', () => {
  it('reports a failure rather than a success, if the token cannot be stored', async () => {
    world.upsertErrors = { calendar_tokens: { message: 'permission denied' } }
    const response = await handler()(post())
    expect(response.status).toBe(500)
    expect(world.writes.map((w) => w.table)).toEqual(['calendar_tokens'])
  })

  it('ROLLS BACK the token when the connection row cannot be written', async () => {
    // A token nobody can see is worse than no token: the screen would say "not
    // connected", the member would press Connect again, and a live credential
    // would sit in a table nothing reads. Same argument as #87's orphaned auth
    // user, and there is no transaction spanning two PostgREST calls to lean on.
    world.upsertErrors = { calendar_connections: { message: 'permission denied' } }
    const response = await handler()(post())

    expect(response.status).toBe(500)
    expect(world.deletes).toEqual([
      { role: 'service', table: 'calendar_tokens', column: 'member_id', value: 'member-1' },
    ])
  })
})
