// @vitest-environment node
//
// Node, not the repo-wide jsdom: this exercises a Deno-shaped handler that takes
// a `Request` and returns a `Response`, and Node 22 supplies both as globals.
//
// The Edge Function's decisions, with no network and no Supabase — story #101.
//
// WHY THIS RUNS IN `npm test`: `calendar-busy/handler.test.js` gives the
// argument and it applies here unchanged — the subject is what GOOGLE does, and
// there is no local Google. `handler.ts` takes `fetch`, `env`, `createClient`
// and a clock as arguments, and everything below runs on every push.
//
// WHAT THIS FILE IS MOSTLY ABOUT: that the function WRITES NOTHING (AC 2) and
// RETURNS NOTHING BUT the fields the import form needs (AC 1's "titles transit
// the server per-request and are never stored"). The fake client records every
// write it is offered, and the Google fixture carries attendees, a location and
// a description precisely so the response can be shown not to.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//
//   - Whether `0038`'s ledger grants and policies are right — a fake client can
//     neither refuse nor enforce. That is src/test/calendarImport.pglite.test.js.
//   - Whether a BROWSER can call the function at all. That is
//     src/test/edge-function-cors.test.js.
//   - Whether Google's real events payload has the shape assumed here, and
//     whether the real incremental consent grants what `EVENT_READ_SCOPES`
//     expects. That is #102, and no amount of care here substitutes for it: the
//     fixtures below were written from the API's documented shape by the same
//     person who wrote the code reading it.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORS,
  EVENT_READ_SCOPES,
  GOOGLE_EVENTS_ENDPOINT,
  GOOGLE_EVENTS_FIELDS,
  GOOGLE_TOKEN_ENDPOINT,
  MAX_EVENTS,
  NEEDS_SCOPE_MESSAGE,
  createHandler,
  localDateIn,
  reduceEvents,
  scopeReadsEvents,
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
/** Wednesday of that week, mid-morning New York. */
const NOW = new Date('2026-09-09T14:00:00.000Z')

const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'
const READONLY = 'https://www.googleapis.com/auth/calendar.readonly'
/** What Google returns after the incremental consent: both, space-separated. */
const WIDENED = `${FREEBUSY} ${READONLY}`

/**
 * A fake Supabase client that RECORDS WHICH KEY IT WAS BUILT WITH, and — the
 * point of this file — records every WRITE it is offered, on a client whose
 * contract has no write method at all. If the handler ever reaches for one,
 * `world.writes` says so.
 */
function makeWorld(overrides = {}) {
  const world = {
    user: { id: 'auth-1' },
    members: [MEMBER],
    households: [{ id: 'household-1', timezone: ZONE }, { id: 'household-2', timezone: ZONE }],
    tokens: [{ member_id: 'member-1', refresh_token: '1//placeholder-refresh', scope: WIDENED }],
    memberError: null,
    householdError: null,
    tokenError: null,
    /** Every write attempted, in order — `[]` is what AC 2 asserts. */
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

  world.clients = []

  world.createClient = (url, key, options) => {
    const role = key === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'caller'
    world.clients.push({ role, url, key, options })
    const write = (verb) => async (row) => {
      world.writes.push({ role, verb, row })
      return { error: null }
    }
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
        // Offered so a write CAN be recorded; the handler's type has none of
        // these, and the assertion is that none is ever called.
        insert: write('insert'),
        upsert: write('upsert'),
        update: write('update'),
        delete: () => ({ eq: write('delete') }),
      }),
    }
  }

  return world
}

/** A `fetch` that answers each call from a queue, and records every request. */
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

/**
 * A Google payload that carries MORE than the function asks for — attendees, a
 * location, a description, a creator — because a reduction proven only on a
 * minimal fixture proves nothing about what it drops.
 */
const GOOGLE_ITEMS = [
  {
    id: 'evt-timed',
    summary: 'Placeholder Event',
    start: { dateTime: '2026-09-10T13:00:00-04:00' },
    end: { dateTime: '2026-09-10T14:30:00-04:00' },
    status: 'confirmed',
    attendees: [{ email: 'somebody@example.test', responseStatus: 'accepted' }],
    location: '1 Placeholder Road',
    description: 'a line nobody should ever see in a table',
    creator: { email: 'creator@example.test' },
  },
  {
    id: 'evt-allday',
    summary: 'Placeholder Other Event',
    start: { date: '2026-09-12' },
    end: { date: '2026-09-13' },
    status: 'confirmed',
  },
  {
    id: 'evt-cancelled',
    summary: 'cancelled placeholder',
    start: { dateTime: '2026-09-11T13:00:00-04:00' },
    end: { dateTime: '2026-09-11T14:00:00-04:00' },
    status: 'cancelled',
  },
]

const eventsOk = (items = GOOGLE_ITEMS) =>
  new Response(JSON.stringify({ kind: 'calendar#events', items }), { status: 200 })

function post(body = { householdId: 'household-1', periodStart: WEEK }, init = {}) {
  return new Request('https://placeholder.supabase.co/functions/v1/calendar-events', {
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

function handler({ env = ENV, now = NOW } = {}) {
  return createHandler({
    fetch: fetchFn,
    env: (name) => env[name],
    createClient: world.createClient,
    now: () => now,
  })
}

beforeEach(() => {
  world = makeWorld()
  fetchFn = makeFetch(tokenOk(), eventsOk())
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
    const res = await handler()(post({}))
    expect(res.status).toBe(400)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('refuses anything but POST', async () => {
    const res = await handler()(new Request('https://x.test/', { method: 'GET' }))
    expect(res.status).toBe(405)
  })
})

describe('the request has to be well-formed and signed in', () => {
  it('refuses a call with no bearer token', async () => {
    const res = await handler()(post(undefined, { headers: { Authorization: '' } }))
    expect(res.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON, and the JSON literal null', async () => {
    const notJson = await handler()(
      new Request('https://x.test/', {
        method: 'POST',
        headers: { Authorization: 'Bearer t' },
        body: 'not json',
      }),
    )
    expect(notJson.status).toBe(400)
    const literalNull = await handler()(
      new Request('https://x.test/', {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'content-type': 'application/json' },
        body: 'null',
      }),
    )
    expect(literalNull.status).toBe(400)
    expect(literalNull.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it.each([
    [{ periodStart: WEEK }, /household/i],
    [{ householdId: 'household-1' }, /week/i],
    [{ householdId: 'household-1', periodStart: '2026-09-08' }, /Monday/],
    [{ householdId: 'household-1', periodStart: '2026-02-30' }, /Monday/],
  ])('refuses %j — %s', async (body, pattern) => {
    const res = await handler()(post(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(pattern)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('names the missing Google secrets rather than saying "not configured"', async () => {
    const env = { ...ENV }
    delete env.GOOGLE_CLIENT_SECRET
    const res = await handler({ env })(post())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('GOOGLE_CLIENT_SECRET')
  })
})

describe('the authorization shape — the caller decides who, the service reads the credential', () => {
  it('reads the member THROUGH THE CALLER, filtered by both claimed_by and household', async () => {
    await handler()(post())
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.role).toBe('caller')
    expect(memberRead.filters).toEqual([
      { column: 'claimed_by', value: 'auth-1' },
      { column: 'household_id', value: 'household-1' },
    ])
    const callerClient = world.clients.find((c) => c.role === 'caller')
    expect(callerClient.options.global.headers.Authorization).toBe('Bearer caller-jwt')
  })

  it('reads the credential as service_role, and reads its SCOPE with it', async () => {
    await handler()(post())
    const tokenRead = world.reads.find((r) => r.table === 'calendar_tokens')
    expect(tokenRead.role).toBe('service')
    expect(tokenRead.columns).toContain('scope')
    expect(tokenRead.filters).toEqual([{ column: 'member_id', value: 'member-1' }])
  })

  it('refuses a household the caller is not in, and asks Google nothing', async () => {
    const res = await handler()(post({ householdId: 'household-9', periodStart: WEEK }))
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(world.reads.some((r) => r.table === 'calendar_tokens')).toBe(false)
  })

  it('#161 — a person in two households reads the row for the household named', async () => {
    world.members = [MEMBER, MEMBER_IN_B]
    world.tokens.push({ member_id: 'member-2', refresh_token: '1//other', scope: WIDENED })
    const res = await handler()(post({ householdId: 'household-2', periodStart: WEEK }))
    expect(res.status).toBe(200)
    const tokenRead = world.reads.find((r) => r.table === 'calendar_tokens')
    expect(tokenRead.filters).toEqual([{ column: 'member_id', value: 'member-2' }])
  })

  it('refuses a PIN member by name — no Google identity, no calendar', async () => {
    world.members = [PIN_MEMBER]
    const res = await handler()(post())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/email/i)
  })

  it('refuses a member with no connection at all', async () => {
    world.tokens = []
    const res = await handler()(post())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/not connected/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('AC 1 — the scope check, before Google is asked anything', () => {
  it('refuses a free/busy-only connection with needsScope, and spends no token', async () => {
    world.tokens = [{ member_id: 'member-1', refresh_token: '1//x', scope: FREEBUSY }]
    const res = await handler()(post())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe(NEEDS_SCOPE_MESSAGE)
    expect(body.needsScope).toBe(true)
    // The whole point of refusing HERE: no exchange, no Google call.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('accepts the widened grant, and each of the wider scopes Google could have granted', async () => {
    expect(scopeReadsEvents(WIDENED)).toBe(true)
    for (const scope of EVENT_READ_SCOPES) expect(scopeReadsEvents(scope)).toBe(true)
    expect(scopeReadsEvents(FREEBUSY)).toBe(false)
    expect(scopeReadsEvents('')).toBe(false)
    expect(scopeReadsEvents(null)).toBe(false)
    // A prefix is not a scope: `calendar.readonly.evil` must not pass.
    expect(scopeReadsEvents(`${READONLY}.evil`)).toBe(false)
  })

  it('names the same scopes the client checks, so the screen and the server agree', () => {
    // The client's list is read off its SOURCE: gate.test.js keeps `src/` from
    // importing `supabase/functions/`, and the reverse import would put the
    // bundler's module into a Deno deploy.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/calendar.js'), 'utf8')
    const block = source.match(/export const EVENT_READ_SCOPES = Object\.freeze\(\[([\s\S]*?)\]\)/)
    expect(block, 'EVENT_READ_SCOPES must be declared in src/lib/calendar.js').not.toBeNull()
    const literal = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    const constants = [...block[1].matchAll(/\b(GOOGLE_[A-Z_]+_SCOPE)\b/g)].map((m) => m[1])
    for (const name of constants) {
      const value = source.match(new RegExp(`export const ${name} = '([^']+)'`))
      expect(value, `${name} must be a string constant`).not.toBeNull()
      literal.push(value[1])
    }
    expect([...literal].sort()).toEqual([...EVENT_READ_SCOPES].sort())
  })
})

describe('AC 2 — the week is read, reduced and RETURNED, and nothing is stored', () => {
  it('exchanges the refresh token, then GETs the primary calendar’s events with a fixed field list', async () => {
    const res = await handler()(post())
    expect(res.status).toBe(200)

    const [exchange, events] = fetchFn.calls
    expect(exchange.input).toBe(GOOGLE_TOKEN_ENDPOINT)
    expect(new URLSearchParams(exchange.body).get('grant_type')).toBe('refresh_token')
    expect(new URLSearchParams(exchange.body).get('refresh_token')).toBe('1//placeholder-refresh')

    const url = new URL(events.input)
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_EVENTS_ENDPOINT)
    expect(events.init.method).toBe('GET')
    expect(events.init.headers.authorization).toBe('Bearer ya29.placeholder-access')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('orderBy')).toBe('startTime')
    expect(url.searchParams.get('maxResults')).toBe(String(MAX_EVENTS))
    expect(url.searchParams.get('fields')).toBe(GOOGLE_EVENTS_FIELDS)
    // The field list is the first wall: no attendees, no location, no
    // description are ever ASKED for.
    expect(GOOGLE_EVENTS_FIELDS).not.toMatch(/attendees|location|description|creator|organizer/)
  })

  it('asks for the window from NOW to the end of the household-local week', async () => {
    await handler()(post())
    const url = new URL(fetchFn.calls[1].input)
    // Wednesday 14:00Z is inside the week, so the window starts at the clock,
    // not at Monday — "upcoming", not "this week's whole calendar".
    expect(url.searchParams.get('timeMin')).toBe(NOW.toISOString())
    // Monday 2026-09-14 00:00 New York = 04:00Z.
    expect(url.searchParams.get('timeMax')).toBe('2026-09-14T04:00:00.000Z')
  })

  it('starts the window at the week’s start when the clock is before it', async () => {
    const before = new Date('2026-09-05T12:00:00.000Z')
    await handler({ now: before })(post())
    const url = new URL(fetchFn.calls[1].input)
    // Monday 2026-09-07 00:00 New York = 04:00Z.
    expect(url.searchParams.get('timeMin')).toBe('2026-09-07T04:00:00.000Z')
  })

  it('answers a week that has already ended with nothing, and spends no token', async () => {
    const after = new Date('2026-09-15T12:00:00.000Z')
    const res = await handler({ now: after })(post())
    expect(res.status).toBe(200)
    expect((await res.json()).events).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns the events reduced to the import form’s fields — and NOTHING Google added', async () => {
    const res = await handler()(post())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.events).toEqual([
      {
        id: 'evt-timed',
        title: 'Placeholder Event',
        start: '2026-09-10T17:00:00.000Z',
        end: '2026-09-10T18:30:00.000Z',
        allDay: false,
        durationMinutes: 90,
        dueOn: '2026-09-10',
      },
      {
        id: 'evt-allday',
        title: 'Placeholder Other Event',
        start: '2026-09-12',
        end: '2026-09-13',
        allDay: true,
        durationMinutes: null,
        dueOn: '2026-09-12',
      },
    ])
    // The second wall, asserted on the WHOLE response text rather than on the
    // shape above: nothing the fixture planted survives anywhere in it.
    const text = JSON.stringify(body)
    expect(text).not.toContain('somebody@example.test')
    expect(text).not.toContain('Placeholder Road')
    expect(text).not.toContain('nobody should ever see')
    expect(text).not.toContain('creator@example.test')
    expect(text).not.toContain('cancelled placeholder')
  })

  it('WRITES NOTHING — not as the caller, not as the service', async () => {
    // The fake offers every write verb and records each; the handler's type
    // names none of them. This is the assertion AC 2 names: "displayed, never
    // persisted (test asserts no event rows are stored)".
    const res = await handler()(post())
    expect(res.status).toBe(200)
    expect(world.writes).toEqual([])
  })

  it('reads exactly three rows, and none of them is a chore or a ledger row', async () => {
    await handler()(post())
    expect(world.reads.map((r) => r.table)).toEqual(['members', 'households', 'calendar_tokens'])
  })
})

describe('the reduction, on its own', () => {
  it('drops a cancelled event, an item with no id, and an inside-out interval', () => {
    const reduced = reduceEvents(
      [
        { id: 'ok', summary: 'a', start: { dateTime: '2026-09-10T13:00:00Z' }, end: { dateTime: '2026-09-10T13:30:00Z' } },
        { id: 'c', summary: 'b', status: 'cancelled', start: { dateTime: '2026-09-10T13:00:00Z' }, end: { dateTime: '2026-09-10T13:30:00Z' } },
        { summary: 'no id', start: { dateTime: '2026-09-10T13:00:00Z' }, end: { dateTime: '2026-09-10T13:30:00Z' } },
        { id: 'inside-out', start: { dateTime: '2026-09-10T14:00:00Z' }, end: { dateTime: '2026-09-10T13:00:00Z' } },
        { id: 'unparseable', start: { dateTime: 'never' }, end: { dateTime: 'never' } },
        null,
        'not an object',
      ],
      ZONE,
    )
    expect(reduced.map((e) => e.id)).toEqual(['ok'])
    expect(reduced[0].durationMinutes).toBe(30)
  })

  it('tolerates a missing summary as an empty title rather than dropping the event', () => {
    const [event] = reduceEvents(
      [{ id: 'untitled', start: { dateTime: '2026-09-10T13:00:00Z' }, end: { dateTime: '2026-09-10T13:30:00Z' } }],
      ZONE,
    )
    expect(event.title).toBe('')
  })

  it('files a late-evening event under the HOUSEHOLD’s day, not UTC’s', () => {
    // 23:30 New York on the 10th is 03:30Z on the 11th. The chore is the 10th's.
    const [event] = reduceEvents(
      [{ id: 'late', summary: 'x', start: { dateTime: '2026-09-10T23:30:00-04:00' }, end: { dateTime: '2026-09-11T00:15:00-04:00' } }],
      ZONE,
    )
    expect(event.dueOn).toBe('2026-09-10')
    expect(event.durationMinutes).toBe(45)
    // POSITIVE CONTROL: the same instant in UTC is the 11th, so the zone did
    // the work rather than the fixture happening to agree.
    expect(localDateIn(new Date('2026-09-11T03:30:00Z'), 'UTC')).toBe('2026-09-11')
  })

  it('refuses an all-day event whose date is not a date', () => {
    expect(reduceEvents([{ id: 'x', start: { date: 'tomorrow' } }], ZONE)).toEqual([])
  })

  it('accepts a zero-length event, which Google does emit for reminders', () => {
    const [event] = reduceEvents(
      [{ id: 'z', summary: 'x', start: { dateTime: '2026-09-10T13:00:00Z' }, end: { dateTime: '2026-09-10T13:00:00Z' } }],
      ZONE,
    )
    expect(event.durationMinutes).toBe(0)
  })
})

describe('when Google will not answer, the sentence says which failure', () => {
  it('a revoked connection is the member’s to repair, and says so', async () => {
    fetchFn = makeFetch(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    )
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/no longer valid.*Connect it again/)
    expect(world.writes).toEqual([])
  })

  it('an unreachable Google is nobody’s fault, and says so', async () => {
    fetchFn = makeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Could not reach Google/)
  })

  it('a refused events read carries Google’s own reason', async () => {
    fetchFn = makeFetch(
      tokenOk(),
      new Response(JSON.stringify({ error: { message: 'Insufficient Permission' } }), { status: 403 }),
    )
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('Insufficient Permission')
  })

  it('an unreadable events payload is reported rather than returned as an empty week', async () => {
    // The harmful version of this error is a confident empty list: "nothing
    // to import" is a perfectly plausible week nobody would question.
    fetchFn = makeFetch(tokenOk(), new Response('<html>', { status: 200 }))
    const res = await handler()(post())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/could not read/i)
  })

  it('a failed token read is a refusal, not an empty list', async () => {
    world.tokenError = { message: 'boom' }
    const res = await handler()(post())
    expect(res.status).toBe(500)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('an unknown household zone is a refusal about the household, not the member', async () => {
    world.households = [{ id: 'household-1', timezone: 'Mars/Olympus' }]
    const res = await handler()(post())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/timezone/i)
  })
})
