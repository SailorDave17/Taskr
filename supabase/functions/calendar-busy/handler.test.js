// @vitest-environment node
//
// Node, not the repo-wide jsdom: this exercises a Deno-shaped handler that takes
// a `Request` and returns a `Response`, and Node 22 supplies both as globals.
//
// The Edge Function's decisions, with no network and no Supabase — story #96.
//
// WHY THIS RUNS IN `npm test`
//
// `calendar-connect/handler.test.js` gives the argument and it applies harder
// here: the subject is what GOOGLE does. There is no local Google, so a suite
// needing a real one would leave every branch AC 5 is about — a revoked token,
// a calendar Google refuses, an unreachable endpoint — covered by nothing that
// runs. `handler.ts` takes `fetch`, `env`, `createClient` and a clock as
// arguments, and everything below runs on every push with no network.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//
//   - Whether `0030`'s grants and policies are right. A fake client returns
//     whatever this file tells it to; it can neither refuse nor enforce. That is
//     src/test/calendar.pglite.test.js.
//   - Whether a BROWSER can call the function at all — a preflight is a browser
//     behaviour and Node sends none. That is src/test/edge-function-cors.test.js.
//   - Whether the function is deployed, or whether Google's real free/busy
//     response has the shape assumed here. That is #100, and it is the one thing
//     no amount of care in this file can substitute for: every fixture below was
//     written from the API's documented shape by the same person who wrote the
//     code reading it, so the two agree with each other about something neither
//     has checked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORS,
  GOOGLE_FREEBUSY_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  MAX_BUSY_MINUTES,
  createHandler,
  isWeekStart,
  reduceBusy,
  weekBoundsUtc,
} from './handler.ts'

const MEMBER = {
  id: 'member-1',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  email: 'placeholder.one@example.test',
  household_id: 'household-1',
}

/** The SAME person's roster entry in a SECOND household — #161's shape, since 0009. */
const MEMBER_IN_B = {
  id: 'member-2',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  email: 'placeholder.one@example.test',
  household_id: 'household-2',
}

const PIN_MEMBER = { ...MEMBER, email: null }

const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_placeholder',
  GOOGLE_CLIENT_ID: '1234567890-placeholder.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-placeholder',
}

const ZONE = 'America/New_York'
/** An ordinary Monday-keyed week in that zone, well clear of any transition. */
const WEEK = '2026-09-07'
const COMPUTED_AT = new Date('2026-09-09T12:00:00.000Z')

/**
 * A fake Supabase client that RECORDS WHICH KEY IT WAS BUILT WITH.
 *
 * The same instrument `calendar-connect`'s suite uses, and for the same reason:
 * the authorization shape says the caller's authority is settled with a
 * caller-scoped client BEFORE service_role is used for anything, and getting
 * that wrong is SILENT — a member read as service_role bypasses row-level
 * security and succeeds for every member of every household. So every operation
 * is tagged with the key that performed it and the tests assert the tag, rather
 * than trusting an ordering to be visible.
 */
function makeWorld(overrides = {}) {
  const world = {
    user: { id: 'auth-1' },
    members: [MEMBER],
    households: [{ id: 'household-1', timezone: ZONE }, { id: 'household-2', timezone: ZONE }],
    tokens: [{ member_id: 'member-1', refresh_token: '1//placeholder-refresh' }],
    memberError: null,
    householdError: null,
    tokenError: null,
    upsertErrors: {},
    /** Every write attempted, in order — `[]` is what the AC 5 branches assert. */
    writes: [],
    /** Every read, tagged with the key that made it. */
    reads: [],
    ...overrides,
  }

  const rowsFor = (table) =>
    table === 'members' ? world.members : table === 'households' ? world.households : world.tokens
  const errorFor = (table) =>
    table === 'members'
      ? world.memberError
      : table === 'households'
        ? world.householdError
        : world.tokenError

  /** Every client built, with the options it was built with — see the Authorization test. */
  world.clients = []

  world.createClient = (url, key, options) => {
    const role = key === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'caller'
    // The third argument is RECORDED, and the first version of this fake
    // dropped it — so it could not tell a caller-scoped client that forwards
    // the request's Authorization header from one built bare, which is the
    // whole of what makes step 1 of the authorization shape caller-scoped.
    // The shape `a-fake-that-drops-an-argument-makes-two-behaviours-one`
    // recorded from this repo the day before (review-fanout, 2026-09-04).
    world.clients.push({ role, url, key, options })
    return {
      auth: { getUser: async () => ({ data: { user: world.user } }) },
      from: (table) => ({
        select: (columns) => {
          const filters = []
          const builder = {
            eq(column, value) {
              filters.push({ column, value })
              return builder
            },
            async maybeSingle() {
              world.reads.push({ role, table, columns, filters: [...filters] })
              const error = errorFor(table)
              if (error) return { data: null, error }
              const matched = rowsFor(table).filter((row) =>
                filters.every((f) => row[f.column] === f.value),
              )
              // The platform's behaviour, not this file's opinion of it: more
              // than one match is a REFUSAL, and `data` is null with it.
              if (matched.length > 1) {
                return {
                  data: null,
                  error: { code: 'PGRST116', message: 'more than one row returned' },
                }
              }
              return { data: matched[0] ?? null, error: null }
            },
          }
          return builder
        },
        upsert: async (row, options) => {
          world.writes.push({ role, table, row, options })
          return { error: world.upsertErrors[table] ?? null }
        },
      }),
    }
  }

  return world
}

/**
 * A `fetch` that answers each call from a queue, and records every request.
 *
 * A queue rather than one answer, because this handler makes TWO Google calls in
 * sequence and the interesting failures are "the first one refused" and "the
 * second one refused" — which a single-answer double cannot tell apart.
 */
function makeFetch(...answers) {
  const calls = []
  const queue = [...answers]
  const fn = vi.fn(async (input, init) => {
    calls.push({ input, init, body: init?.body })
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (typeof next === 'function') return next()
    return next
  })
  fn.calls = calls
  return fn
}

const tokenOk = (body = { access_token: 'ya29.placeholder-access' }) =>
  new Response(JSON.stringify(body), { status: 200 })

const busyOk = (busy = []) =>
  new Response(JSON.stringify({ calendars: { primary: { busy } } }), { status: 200 })

function post(body = { householdId: 'household-1', periodStart: WEEK }, init = {}) {
  return new Request('https://placeholder.supabase.co/functions/v1/calendar-busy', {
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

function handler({ env = ENV } = {}) {
  return createHandler({
    fetch: fetchFn,
    env: (name) => env[name],
    createClient: world.createClient,
    now: () => COMPUTED_AT,
  })
}

beforeEach(() => {
  world = makeWorld()
  fetchFn = makeFetch(tokenOk(), busyOk())
})

describe('the browser has to be able to reach it at all', () => {
  it('answers a preflight without a body', async () => {
    const res = await handler()(new Request('https://x.test/', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      CORS['Access-Control-Allow-Headers'],
    )
  })

  it('puts the CORS headers on a REFUSAL too, or the browser hides the reason', async () => {
    const res = await handler()(post({}, { headers: { Authorization: '' } }))
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('what it refuses before Google is involved at all', () => {
  it('refuses anything but POST', async () => {
    const res = await handler()(new Request('https://x.test/', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('refuses a body that is not JSON', async () => {
    const res = await handler()(
      new Request('https://x.test/', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt' },
        body: 'not json',
      }),
    )
    expect(res.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a body that is the JSON literal null, with CORS headers on the refusal', async () => {
    // `req.json()` resolves `null` without throwing, so the parse guard alone
    // let `body.householdId` escape as a bare 500 with no CORS headers — which
    // a browser reports as the network being down. Unreachable from this app's
    // own client; guarded because a refusal that names its reason is the whole
    // contract of that block.
    const res = await handler()(
      new Request('https://x.test/', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
        body: 'null',
      }),
    )
    expect(res.status).toBe(400)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual({ error: 'Send a JSON body.' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a request that names no household', async () => {
    const res = await handler()(post({ periodStart: WEEK }))
    expect(res.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a request that names no week', async () => {
    const res = await handler()(post({ householdId: 'household-1' }))
    expect(res.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a week that does not start on the household’s first day', async () => {
    // A Tuesday. `0030`'s check constraint refuses the row anyway; this is the
    // layer that turns a constraint violation into a sentence, and it fires
    // before a member's credential is spent on a figure nothing could store.
    const res = await handler()(post({ householdId: 'household-1', periodStart: '2026-09-08' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A week must start on a Monday.' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('refuses when a Google secret is missing, and NAMES which one', async () => {
    const res = await handler({ env: { ...ENV, GOOGLE_CLIENT_SECRET: undefined } })(post())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('GOOGLE_CLIENT_SECRET')
  })

  it('refuses a caller whose session is not valid', async () => {
    world.user = null
    const res = await handler()(post())
    expect(res.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses somebody who is not in the household they named', async () => {
    const res = await handler()(post({ householdId: 'household-9', periodStart: WEEK }))
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('refuses a PIN member on the server, whatever the screen drew', async () => {
    world.members = [PIN_MEMBER]
    const res = await handler()(post())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('email address')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a member with no stored connection, without asking Google', async () => {
    // The honest sentence rather than a zero. A member who never connected has
    // no token, and storing 0 busy minutes for them would be a confident answer
    // to a question nobody could ask.
    world.tokens = []
    const res = await handler()(post())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('not connected')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.writes).toEqual([])
  })

  it('refuses a household whose timezone cannot be read', async () => {
    world.households = [{ id: 'household-1', timezone: null }]
    const res = await handler()(post())
    expect(res.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a timezone that is not a real zone, rather than guessing one', async () => {
    world.households = [{ id: 'household-1', timezone: 'Nowhere/Atlantis' }]
    const res = await handler()(post())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('timezone')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('the authorization shape — who answers which question', () => {
  it('finds the member THROUGH THE CALLER, never as service_role', async () => {
    await handler()(post())
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.role).toBe('caller')
  })

  it('builds the caller-scoped client WITH the request’s Authorization header', async () => {
    // The thing "caller-scoped" actually means: the anon key plus the caller's
    // own JWT, so row-level security answers about THIS person. A client built
    // with the anon key and no header is `anon`, which since `0017` holds
    // nothing in `public` — every read would come back empty and the handler
    // would refuse everybody with a 403 that looks like "not a member". The
    // fake could not see this until it recorded its third argument.
    await handler()(post())
    const caller = world.clients.find((c) => c.role === 'caller')
    expect(caller.options?.global?.headers?.Authorization).toBe('Bearer caller-jwt')
    expect(caller.options?.auth?.persistSession).toBe(false)
    const service = world.clients.find((c) => c.role === 'service')
    // And the service client carries NO caller header: it acts as the platform
    // role, and a forwarded JWT on it would be a credential on a call that must
    // not be scoped by it.
    expect(service.options?.global?.headers?.Authorization).toBeUndefined()
  })

  it('reads the household’s zone through the caller too', async () => {
    await handler()(post())
    expect(world.reads.find((r) => r.table === 'households').role).toBe('caller')
  })

  it('reads the credential as SERVICE, because no client is granted it', async () => {
    await handler()(post())
    expect(world.reads.find((r) => r.table === 'calendar_tokens').role).toBe('service')
  })

  it('settles the caller BEFORE the credential is touched', async () => {
    // Ordering, asserted rather than assumed. The token read is the first thing
    // that could leak, and everything in front of it is what decides whether
    // this caller may have it at all.
    await handler()(post())
    const order = world.reads.map((r) => r.table)
    expect(order.indexOf('members')).toBeLessThan(order.indexOf('calendar_tokens'))
  })

  it('IGNORES a member id in the request body, whatever the caller puts there', async () => {
    // The body names WHICH household and never WHO. Owner decision, 2026-09-04:
    // this function reads the caller's own calendar, so a member id in the body
    // is the exact thing that must not be honoured.
    await handler()(
      post({ householdId: 'household-1', periodStart: WEEK, memberId: 'member-2' }),
    )
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.filters).toEqual([
      { column: 'claimed_by', value: 'auth-1' },
      { column: 'household_id', value: 'household-1' },
    ])
    expect(world.writes[0].row.member_id).toBe('member-1')
  })

  it('writes as service_role, because the client is granted nothing here', async () => {
    await handler()(post())
    expect(world.writes[0].role).toBe('service')
    expect(world.writes[0].table).toBe('calendar_busy')
  })

  it('#161 — connects the week to the household the request names', async () => {
    world.members = [MEMBER, MEMBER_IN_B]
    world.tokens = [
      { member_id: 'member-1', refresh_token: '1//placeholder-a' },
      { member_id: 'member-2', refresh_token: '1//placeholder-b' },
    ]
    const res = await handler()(post({ householdId: 'household-2', periodStart: WEEK }))
    expect(res.status).toBe(200)
    expect(world.writes[0].row.member_id).toBe('member-2')
    expect(world.writes[0].row.household_id).toBe('household-2')
  })

  it('CONTROL: the double refuses two rows the way postgrest-js does', async () => {
    // Without this the test above proves only that the fake filtered. A person
    // in two households whose read is NOT narrowed must produce a refusal, or
    // the fixture cannot express the defect #161 fixed.
    world.members = [MEMBER, MEMBER_IN_B]
    const client = world.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY)
    const { data, error } = await client
      .from('members')
      .select('id')
      .eq('claimed_by', 'auth-1')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error.code).toBe('PGRST116')
  })
})

describe('AC 2 — the week, in the household’s own zone', () => {
  it('is seven LOCAL days, not 168 hours — the spring-forward week', () => {
    // 2026-03-08 is when this zone loses an hour, so the week beginning
    // 2026-03-02 is 167 hours long. Subtracting `7 * 86400000` would put an hour
    // of somebody's Sunday into the next week, twice a year, in a figure nobody
    // would think to check.
    const { timeMin, timeMax } = weekBoundsUtc('2026-03-02', ZONE)
    expect(timeMin).toBe('2026-03-02T05:00:00.000Z')
    expect(timeMax).toBe('2026-03-09T04:00:00.000Z')
    expect((Date.parse(timeMax) - Date.parse(timeMin)) / 3600000).toBe(167)
  })

  it('and the fall-back week, which is the other sign of the same bug', () => {
    const { timeMin, timeMax } = weekBoundsUtc('2026-10-26', ZONE)
    expect(timeMin).toBe('2026-10-26T04:00:00.000Z')
    expect(timeMax).toBe('2026-11-02T05:00:00.000Z')
    expect((Date.parse(timeMax) - Date.parse(timeMin)) / 3600000).toBe(169)
  })

  it('an ordinary week is 168, so the two above are not the arithmetic being broken', () => {
    const { timeMin, timeMax } = weekBoundsUtc(WEEK, ZONE)
    expect((Date.parse(timeMax) - Date.parse(timeMin)) / 3600000).toBe(168)
  })

  it('CONTIGUITY: one week ends exactly where the next begins, across a transition', () => {
    // The property that actually matters, and the one that survives a zone whose
    // transition happens AT midnight (where local midnight may not exist at
    // all). No minute can be double-counted or dropped between two weeks.
    expect(weekBoundsUtc('2026-03-02', ZONE).timeMax).toBe(weekBoundsUtc('2026-03-09', ZONE).timeMin)
    expect(weekBoundsUtc('2026-10-26', ZONE).timeMax).toBe(weekBoundsUtc('2026-11-02', ZONE).timeMin)
  })

  it('a zone east of Greenwich runs the same way', () => {
    const { timeMin } = weekBoundsUtc(WEEK, 'Australia/Sydney')
    expect(timeMin).toBe('2026-09-06T14:00:00.000Z')
  })

  it('asks Google for exactly those bounds, and for the member’s own calendar', async () => {
    await handler()(post())
    const freeBusy = fetchFn.calls.find((c) => c.input === GOOGLE_FREEBUSY_ENDPOINT)
    const sent = JSON.parse(freeBusy.body)
    expect(sent).toEqual({
      timeMin: '2026-09-07T04:00:00.000Z',
      timeMax: '2026-09-14T04:00:00.000Z',
      items: [{ id: 'primary' }],
    })
  })

  it('recognises a Monday and refuses everything else', () => {
    expect(isWeekStart(WEEK)).toBe(true)
    expect(isWeekStart('2026-09-08')).toBe(false)
    expect(isWeekStart('2026-09-13')).toBe(false)
    expect(isWeekStart('not-a-date')).toBe(false)
    // Refused rather than silently read as March 2nd, which is what `Date`
    // does with it.
    expect(isWeekStart('2026-02-30')).toBe(false)
  })
})

describe('AC 2 — the reduction to ONE integer', () => {
  const MIN = '2026-09-07T04:00:00.000Z'
  const MAX = '2026-09-14T04:00:00.000Z'

  it('sums plain intervals', () => {
    expect(
      reduceBusy(
        [
          { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
          { start: '2026-09-08T13:00:00Z', end: '2026-09-08T13:30:00Z' },
        ],
        MIN,
        MAX,
      ),
    ).toEqual({ busyMinutes: 90, eventCount: 2 })
  })

  it('coalesces overlapping time ONCE — double-booked is not double-busy', () => {
    // A person with two meetings at 13:00 is busy for an hour, not two. This is
    // the assertion the word "once" in the criterion is about, and the naive sum
    // gets 120.
    expect(
      reduceBusy(
        [
          { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
          { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
        ],
        MIN,
        MAX,
      ),
    ).toEqual({ busyMinutes: 60, eventCount: 2 })
  })

  it('coalesces a partial overlap to the union, not to either interval', () => {
    expect(
      reduceBusy(
        [
          { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
          { start: '2026-09-07T13:30:00Z', end: '2026-09-07T15:00:00Z' },
        ],
        MIN,
        MAX,
      ).busyMinutes,
    ).toBe(120)
  })

  it('joins intervals that touch end-to-end', () => {
    expect(
      reduceBusy(
        [
          { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
          { start: '2026-09-07T14:00:00Z', end: '2026-09-07T15:00:00Z' },
        ],
        MIN,
        MAX,
      ).busyMinutes,
    ).toBe(120)
  })

  it('coalesces regardless of the order Google returned them in', () => {
    expect(
      reduceBusy(
        [
          { start: '2026-09-09T10:00:00Z', end: '2026-09-09T11:00:00Z' },
          { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:30:00Z' },
        ],
        MIN,
        MAX,
      ).busyMinutes,
    ).toBe(150)
  })

  it('CLAMPS an interval that straddles the start of the week', () => {
    // Google returns intervals that OVERLAP the window, not intervals inside it.
    // Counting this whole would put last week's minutes in this week's figure.
    expect(
      reduceBusy([{ start: '2026-09-07T02:00:00Z', end: '2026-09-07T05:00:00Z' }], MIN, MAX)
        .busyMinutes,
    ).toBe(60)
  })

  it('CLAMPS an interval that straddles the end of the week', () => {
    expect(
      reduceBusy([{ start: '2026-09-14T03:00:00Z', end: '2026-09-14T09:00:00Z' }], MIN, MAX)
        .busyMinutes,
    ).toBe(60)
  })

  it('drops an interval wholly outside the week', () => {
    expect(
      reduceBusy([{ start: '2026-09-20T10:00:00Z', end: '2026-09-20T11:00:00Z' }], MIN, MAX)
        .busyMinutes,
    ).toBe(0)
  })

  it('counts intervals BEFORE coalescing, which is what makes a zero readable', () => {
    // 0 minutes from 0 intervals is an empty week; 0 minutes from 4 is a bug.
    // Nothing renders `event_count` — it exists so the two can be told apart at
    // all, which a figure alone cannot do.
    expect(reduceBusy([], MIN, MAX)).toEqual({ busyMinutes: 0, eventCount: 0 })
    const doubled = reduceBusy(
      [
        { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
        { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
      ],
      MIN,
      MAX,
    )
    expect(doubled.eventCount).toBe(2)
    expect(doubled.busyMinutes).toBe(60)
  })

  it('drops a malformed interval rather than losing the whole week', () => {
    const reduced = reduceBusy(
      [
        { start: 'whenever', end: 'later' },
        { start: '2026-09-07T13:00:00Z', end: '2026-09-07T12:00:00Z' },
        null,
        { start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:00:00Z' },
      ],
      MIN,
      MAX,
    )
    expect(reduced).toEqual({ busyMinutes: 60, eventCount: 1 })
  })

  it('survives an answer that is not a list at all', () => {
    expect(reduceBusy(undefined, MIN, MAX)).toEqual({ busyMinutes: 0, eventCount: 0 })
    expect(reduceBusy('busy', MIN, MAX)).toEqual({ busyMinutes: 0, eventCount: 0 })
  })

  it('cannot exceed the WINDOW, whatever arrives — and the window is the bound', () => {
    // The first version of this asserted a clamp against MAX_BUSY_MINUTES with a
    // 168-hour fixture window, on which the clamp was an identity: deleting it
    // reddened nothing (review-fanout, 2026-09-04). The property that actually
    // holds is that the sum cannot exceed the window, because every interval is
    // clamped to it first — so it is asserted on the three real week lengths,
    // and the longest of them is exactly what `0030` bounds `busy_minutes` to.
    const decade = [{ start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z' }]
    const ordinary = weekBoundsUtc(WEEK, ZONE)
    const springForward = weekBoundsUtc('2026-03-02', ZONE)
    const fallBack = weekBoundsUtc('2026-10-26', ZONE)
    expect(reduceBusy(decade, ordinary.timeMin, ordinary.timeMax).busyMinutes).toBe(168 * 60)
    expect(reduceBusy(decade, springForward.timeMin, springForward.timeMax).busyMinutes).toBe(167 * 60)
    expect(reduceBusy(decade, fallBack.timeMin, fallBack.timeMax).busyMinutes).toBe(169 * 60)
    expect(MAX_BUSY_MINUTES).toBe(169 * 60)
  })
})

describe('AC 3 — what gets stored, which is the whole minimization decision', () => {
  it('POSITIVE CONTROL: the happy path DOES write one row', async () => {
    fetchFn = makeFetch(
      tokenOk(),
      busyOk([{ start: '2026-09-07T13:00:00Z', end: '2026-09-07T14:30:00Z' }]),
    )
    const res = await handler()(post())
    expect(res.status).toBe(200)
    expect(world.writes).toHaveLength(1)
    expect(await res.json()).toEqual({
      ok: true,
      memberId: 'member-1',
      periodStart: WEEK,
      busyMinutes: 90,
      eventCount: 1,
      computedAt: COMPUTED_AT.toISOString(),
    })
  })

  it('stores the derived fields and NOTHING that came out of a calendar', async () => {
    fetchFn = makeFetch(
      tokenOk(),
      // A response carrying everything the API would carry if a wider scope had
      // been asked for. None of it may appear in the row, and asserting the KEY
      // SET rather than the values is what makes that checkable: a new column
      // added later fails this rather than sliding through.
      new Response(
        JSON.stringify({
          calendars: {
            primary: {
              busy: [
                {
                  start: '2026-09-07T13:00:00Z',
                  end: '2026-09-07T14:00:00Z',
                  summary: 'a title that must never be stored',
                  attendees: ['somebody@example.test'],
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    )
    await handler()(post())
    const { row } = world.writes[0]
    expect(Object.keys(row).sort()).toEqual([
      'busy_minutes',
      'computed_at',
      'event_count',
      'household_id',
      'member_id',
      'period_start',
    ])
    expect(JSON.stringify(row)).not.toContain('a title that must never be stored')
    expect(JSON.stringify(row)).not.toContain('somebody@example.test')
  })

  it('upserts on the member and the week, so a re-read corrects one fact', async () => {
    await handler()(post())
    expect(world.writes[0].options).toEqual({ onConflict: 'member_id,period_start' })
  })

  it('files the figure under the week that was asked for', async () => {
    await handler()(post())
    expect(world.writes[0].row.period_start).toBe(WEEK)
    expect(world.writes[0].row.computed_at).toBe(COMPUTED_AT.toISOString())
  })
})

describe('AC 5 — Google fails, and the last figure is left alone', () => {
  it('a refused refresh token writes NOTHING', async () => {
    fetchFn = makeFetch(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    )
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect(world.writes).toEqual([])
    // Its OWN sentence: this is the one failure the member can repair, and it
    // must not read like an outage.
    expect((await res.json()).error).toContain('Connect it again')
  })

  it('never asks for free/busy once the token exchange has failed', async () => {
    fetchFn = makeFetch(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    await handler()(post())
    expect(fetchFn.calls.map((c) => c.input)).toEqual([GOOGLE_TOKEN_ENDPOINT])
  })

  it('an unreachable Google writes NOTHING, and says so differently', async () => {
    fetchFn = makeFetch(() => {
      throw new TypeError('network')
    })
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect(world.writes).toEqual([])
    expect((await res.json()).error).toContain('Could not reach Google')
  })

  it('a refused free/busy query writes NOTHING', async () => {
    fetchFn = makeFetch(
      tokenOk(),
      new Response(JSON.stringify({ error: { message: 'insufficient scope' } }), { status: 403 }),
    )
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect(world.writes).toEqual([])
    expect((await res.json()).error).toContain('insufficient scope')
  })

  it('a PER-CALENDAR error inside a 200 writes NOTHING', async () => {
    // The shape that reads as success to anything checking the status alone.
    // Without this branch the handler would store a confident ZERO — and zero
    // busy minutes is a perfectly plausible week, so nobody would question it.
    fetchFn = makeFetch(
      tokenOk(),
      new Response(
        JSON.stringify({ calendars: { primary: { busy: [], errors: [{ reason: 'notFound' }] } } }),
        { status: 200 },
      ),
    )
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect(world.writes).toEqual([])
    expect((await res.json()).error).toContain('notFound')
  })

  it('CONTROL: the same response WITHOUT the errors key stores its zero', async () => {
    // The control that makes the assertion above about `errors` rather than
    // about an empty `busy` list. An empty week is a real answer and must be
    // stored; the same empty list carrying a failure must not.
    fetchFn = makeFetch(tokenOk(), busyOk([]))
    const res = await handler()(post())
    expect(res.status).toBe(200)
    expect(world.writes[0].row.busy_minutes).toBe(0)
    expect(world.writes[0].row.event_count).toBe(0)
  })

  it('an answer with no primary calendar writes NOTHING', async () => {
    fetchFn = makeFetch(tokenOk(), new Response(JSON.stringify({ calendars: {} }), { status: 200 }))
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect(world.writes).toEqual([])
  })

  it('a 200 with no access token in it writes NOTHING', async () => {
    fetchFn = makeFetch(new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 }))
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect(world.writes).toEqual([])
  })

  it('reports a failure rather than a success when the row cannot be stored', async () => {
    world.upsertErrors.calendar_busy = { message: 'permission denied' }
    const res = await handler()(post())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Could not store')
  })
})

describe('the token exchange itself', () => {
  it('asks GOOGLE, at its token endpoint, with the secret the client never sees', async () => {
    await handler()(post())
    const call = fetchFn.calls[0]
    expect(call.input).toBe(GOOGLE_TOKEN_ENDPOINT)
    const sent = new URLSearchParams(call.body)
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('refresh_token')).toBe('1//placeholder-refresh')
    expect(sent.get('client_secret')).toBe(ENV.GOOGLE_CLIENT_SECRET)
  })

  it('carries the access token on the free/busy call and nowhere else', async () => {
    await handler()(post())
    const freeBusy = fetchFn.calls.find((c) => c.input === GOOGLE_FREEBUSY_ENDPOINT)
    expect(freeBusy.init.headers.authorization).toBe('Bearer ya29.placeholder-access')
    // The refresh token is spent at the token endpoint and must not travel with
    // the query — a credential on a call that does not need it is a credential
    // in one more log.
    expect(JSON.stringify(freeBusy.init)).not.toContain('1//placeholder-refresh')
  })

  it('never returns the credential to the caller', async () => {
    const res = await handler()(post())
    const body = await res.text()
    expect(body).not.toContain('1//placeholder-refresh')
    expect(body).not.toContain('ya29.placeholder-access')
  })
})
