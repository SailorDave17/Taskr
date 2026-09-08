// @vitest-environment node
//
// Node, not the repo-wide jsdom: this exercises a Deno-shaped handler that takes
// a `Request` and returns a `Response`, and Node 22 supplies both as globals.
//
// The Edge Function's decisions, with no network and no Supabase — story #99.
//
// WHY THIS RUNS IN `npm test` AND #87's FUNCTION SUITE DOES NOT
//
// `provisioning.functions.test.js` drives the real function over real HTTP
// against a LOCAL Supabase stack, which needs Docker, Postgres, GoTrue and a
// service_role key — none of which CI has, so it is a third runner CI never
// runs. That is the right trade for #87, whose whole subject is what Postgres
// and GoTrue do.
//
// It is the wrong trade here, twice over. AC 1's subject is WHICH ROWS ARE
// DELETED — a fake client can testify to that precisely because it records
// every call it was handed, where a live stack would only let you look at what
// survived. And AC 4's subject is what happens when GOOGLE REFUSES the
// revocation, which is a branch nothing pointed at a real Google could produce
// on demand. So `handler.ts` takes `fetch`, `env` and `createClient` as
// arguments, and everything below is exercised on every push.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//
//   - Whether `service_role` may actually delete these rows. A fake client
//     returns whatever this file tells it to; it can neither refuse nor
//     enforce. That is src/test/calendar.pglite.test.js and
//     src/test/grants.pglite.test.js, where `0011` and `0030`'s explicit
//     `grant ... delete ... to service_role` is the load-bearing line.
//   - Whether a BROWSER can call the function at all — a preflight is a browser
//     behaviour and Node sends none. That is src/test/edge-function-cors.test.js,
//     and #112 is this repo's recorded case of a Node harness passing while the
//     deployed path was blocked.
//   - Whether the function is deployed. That is `npm run check:live`.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CORS, DELETED_TABLES, GOOGLE_REVOKE_ENDPOINT, createHandler } from './handler.ts'

const MEMBER = {
  id: 'member-1',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  email: 'placeholder.one@example.test',
  household_id: 'household-1',
}

/**
 * The SAME person's roster entry in a SECOND household — #161's shape.
 *
 * One `claimed_by`, two member ids, two household ids. Since `0009` that is
 * what a person in two households looks like, and `maybeSingle()` over both is
 * a REFUSAL rather than a pick — so a disconnect that filtered on
 * `claimed_by` alone could not be performed by such a person at all.
 */
const MEMBER_IN_B = {
  id: 'member-2',
  display_name: 'Placeholder One',
  claimed_by: 'auth-1',
  email: 'placeholder.one@example.test',
  household_id: 'household-2',
}

/** A PIN member — `members.email` null, the discriminator `0007` established. */
const PIN_MEMBER = { ...MEMBER, email: null }

/**
 * What postgrest-js manufactures when `maybeSingle()` matches more than one row.
 *
 * Copied from `calendar-connect/handler.test.js`, which measured it two ways
 * that agree: read out of `@supabase/postgrest-js` (`isMaybeSingle &&
 * data.length > 1` sets exactly this object, `data` to null and the status to
 * 406), and observed end to end against a local stack.
 */
const MULTIPLE_ROWS = (n) => ({
  code: 'PGRST116',
  details: `Results contain ${n} rows, application/vnd.pgrst.object+json requires 1 row`,
  hint: null,
  message: 'JSON object requested, multiple (or no) rows returned',
})

const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_placeholder',
}

const STORED_TOKEN = '1//placeholder-refresh'

/**
 * A fake Supabase client that RECORDS WHICH KEY IT WAS BUILT WITH.
 *
 * That is the point of the fake rather than an accident of it, and #99 needs it
 * more than its siblings did. Three tables are deleted here, and doing the
 * member read as service_role would bypass row-level security — so it would
 * succeed for every member of every household, and the only thing between a
 * signed-in stranger and deleting somebody else's calendar rows would be a check
 * this file could get wrong. Every operation is tagged with the key that
 * performed it, and the tests assert the tag rather than trusting the ordering
 * to be visible.
 *
 * Every DELETE is recorded with its table, column and value, in order. The order
 * is asserted rather than the set, because `handler.ts`'s whole partial-failure
 * argument is about which row survives — see `DELETED_TABLES`.
 */
function makeWorld(overrides = {}) {
  const world = {
    user: { id: 'auth-1' },
    /**
     * Every member row the CALLER-SCOPED read can see.
     *
     * These are the rows row-level security lets this caller see, so a filter
     * naming a household they do not belong to matches nothing — which is what
     * the real database does, and is why naming a household in the request body
     * cannot reach one.
     */
    members: [MEMBER],
    memberError: null,
    /** The stored refresh token, or null for a member who has none. */
    token: { refresh_token: STORED_TOKEN },
    tokenError: null,
    /**
     * The connection row, read to tell a NEVER-CONNECTED member from one whose
     * previous disconnect died after the token deletion.
     *
     * Modelled explicitly rather than left to fall through the member filter.
     * It would fall through to `null` today — `members` rows have no
     * `member_id` column, so nothing matches — and that is an accident of the
     * fake rather than a statement about the schema, which is exactly the kind
     * of agreement between a double and its author that testifies to nothing.
     */
    connection: { id: 'conn-1' },
    /** Per-table delete failures, keyed by table name — `{}` is the happy path. */
    deleteErrors: {},
    /** Every delete attempted, in order. AC 1 reads this. */
    deletes: [],
    /** Every read, tagged with the key that made it. */
    reads: [],
    /**
     * Every read, revoke and delete as ONE ordered log — the instrument the
     * ordering test needs.
     *
     * Kept beside `reads` and `deletes` rather than replacing them: those two
     * answer "what was asked, and with which key", which is a different
     * question from "in what sequence", and collapsing them would make the
     * membership assertions read the sequence log by accident.
     */
    events: [],
    /**
     * What each client was CONSTRUCTED with, per role — #99's review.
     *
     * The first draft dropped `createClient`'s third argument, so the caller
     * client's `global.headers.Authorization` was invisible to every test: a
     * handler that forwarded no JWT would run the member read unauthenticated,
     * every disconnect would 401 in production, and all 29 tests here would
     * still pass because the fake returns `world.user` regardless. A fake that
     * cannot express the thing being removed cannot testify that it is there.
     */
    clientOptions: {},
    ...overrides,
  }

  world.createClient = (url, key, options) => {
    const role = key === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'caller'
    world.clientOptions[role] = { url, options }
    return {
      auth: {
        getUser: async () => ({ data: { user: world.user } }),
      },
      from: (table) => ({
        select: (columns) => {
          // A chainable filter builder, because the member read needs two
          // `eq()`s — the shape that could hold only one is what hid #161.
          const filters = []
          const builder = {
            eq(column, value) {
              filters.push({ column, value })
              return builder
            },
            async maybeSingle() {
              world.reads.push({ role, table, columns, filters: [...filters] })
              world.events.push(`read:${table}`)
              const mine = filters.every((f) =>
                f.column === 'member_id' ? f.value === MEMBER.id : true,
              )
              if (table === 'calendar_tokens') {
                if (world.tokenError) return { data: null, error: world.tokenError }
                return { data: mine ? world.token : null, error: null }
              }
              if (table === 'calendar_connections') {
                return { data: mine ? world.connection : null, error: null }
              }
              if (world.memberError) return { data: null, error: world.memberError }
              const matched = world.members.filter((row) =>
                filters.every((f) => row[f.column] === f.value),
              )
              // The platform's behaviour, not this file's opinion of it: more
              // than one match is a REFUSAL, and `data` is null with it.
              if (matched.length > 1) {
                return { data: null, error: MULTIPLE_ROWS(matched.length) }
              }
              return { data: matched[0] ?? null, error: null }
            },
          }
          return builder
        },
        delete: () => ({
          eq: async (column, value) => {
            world.deletes.push({ role, table, column, value })
            world.events.push(`delete:${table}`)
            return { error: world.deleteErrors[table] ?? null }
          },
        }),
      }),
    }
  }

  return world
}

/**
 * A `fetch` that answers with whatever this test wants, and records the call.
 *
 * It appends to the world's ordered log as well as its own, so the revoke takes
 * its place in the same sequence as the reads and the deletes — which is what
 * lets the ordering test ask a question about indices rather than about
 * existence.
 */
function makeFetch(answer) {
  const calls = []
  const fn = vi.fn(async (input, init) => {
    calls.push({ input, init })
    world?.events?.push('revoke')
    if (typeof answer === 'function') return answer()
    return answer
  })
  fn.calls = calls
  return fn
}

/** Google's answer to a revocation it accepted: 200, with an empty body. */
const revokeOk = () => new Response('', { status: 200 })

function post(body = { householdId: 'household-1' }, init = {}) {
  return new Request('https://placeholder.supabase.co/functions/v1/calendar-disconnect', {
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
  })
}

/** The tables deleted, in the order they were deleted. */
const deletedTables = () => world.deletes.map((d) => d.table)

beforeEach(() => {
  world = makeWorld()
  fetchFn = makeFetch(revokeOk())
})

describe('the browser has to be able to reach it at all', () => {
  it('answers a preflight without a body', async () => {
    const response = await handler()(new Request('https://x.test/', { method: 'OPTIONS' }))
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

describe('what it refuses before anything is deleted', () => {
  it.each([
    [
      'a caller with no bearer token',
      () => post(undefined, { headers: { Authorization: '' } }),
      401,
    ],
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
    ['a request that is the JSON literal null', () => post(null), 400],
    ['a request naming no household', () => post({}), 400],
  ])('refuses %s', async (_label, build, status) => {
    const response = await handler()(build())
    expect(response.status).toBe(status)
    // The whole point of refusing EARLY: nothing was touched.
    expect(world.deletes).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a caller whose session resolves to nobody', async () => {
    world.user = null
    const response = await handler()(post())
    expect(response.status).toBe(401)
    expect(world.deletes).toEqual([])
  })

  it('refuses a household the caller is not a member of, and says nothing about it', async () => {
    const response = await handler()(post({ householdId: 'household-nobody' }))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('You are not a member of that household.')
    expect(world.deletes).toEqual([])
  })

  it('refuses when the roster read itself failed', async () => {
    world.memberError = MULTIPLE_ROWS(2)
    const response = await handler()(post())
    expect(response.status).toBe(400)
    expect(world.deletes).toEqual([])
  })

  it('refuses when the platform did not inject its own environment', async () => {
    const response = await handler({ env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' } })(post())
    expect(response.status).toBe(500)
    expect(world.deletes).toEqual([])
  })

  it('needs NO Google configuration, because an exit must not be narrower than the way in', async () => {
    // The sibling functions refuse a 500 without GOOGLE_CLIENT_ID and
    // GOOGLE_CLIENT_SECRET. This one must not: a household whose Google
    // configuration was removed or mistyped would otherwise be able to connect
    // a calendar and never disconnect one — the app holding a credential
    // BECAUSE the configuration to release it is broken.
    const response = await handler({
      env: {
        SUPABASE_URL: ENV.SUPABASE_URL,
        SUPABASE_ANON_KEY: ENV.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY,
      },
    })(post())
    expect(response.status).toBe(200)
    expect(deletedTables()).toEqual([...DELETED_TABLES])
  })
})

describe('AC 1 — the token row and the derived busy rows go, server-side', () => {
  it('deletes the token, every derived busy row and the connection, keyed on the member', async () => {
    const response = await handler()(post())
    expect(response.status).toBe(200)

    // The SET, named one table at a time so a failure says which is missing.
    expect(deletedTables()).toContain('calendar_tokens')
    expect(deletedTables()).toContain('calendar_busy')
    expect(deletedTables()).toContain('calendar_connections')

    // Every one keyed on the caller's own member row, and on nothing else. A
    // delete keyed on `household_id` would take a housemate's calendar with it.
    for (const del of world.deletes) {
      expect(del.column).toBe('member_id')
      expect(del.value).toBe(MEMBER.id)
    }
  })

  it('deletes EVERY week of derived figures, not this week alone', async () => {
    // `member_id` with no `period_start` filter is the whole of it: a member
    // asking to be forgotten is not asking to be forgotten since Monday. The
    // assertion is that the busy delete carries exactly one filter — the
    // chainable builder would record a second if the handler added one.
    await handler()(post())
    const busy = world.deletes.filter((d) => d.table === 'calendar_busy')
    expect(busy).toHaveLength(1)
    expect(busy[0]).toMatchObject({ column: 'member_id', value: MEMBER.id })
  })

  it('deletes CREDENTIAL FIRST, so a partial failure never strands a live token', async () => {
    // The order is the whole partial-failure guarantee — see handler.ts. A test
    // asserting only the set would pass on the dangerous ordering, where a
    // failed second delete leaves a refresh token behind with the screen
    // already saying "not connected".
    await handler()(post())
    expect(deletedTables()).toEqual([...DELETED_TABLES])
    expect(deletedTables()[0]).toBe('calendar_tokens')
  })

  it('does every delete as service_role, and finds the member as the CALLER', async () => {
    await handler()(post())
    // The authorization shape: the caller's authority is settled with a
    // caller-scoped client before service_role is used for anything.
    const memberRead = world.reads.find((r) => r.table === 'members')
    expect(memberRead.role).toBe('caller')
    expect(memberRead.filters).toEqual([
      { column: 'claimed_by', value: 'auth-1' },
      { column: 'household_id', value: 'household-1' },
    ])
    for (const del of world.deletes) expect(del.role).toBe('service')
    // The credential is read as service_role and nowhere else: `calendar_tokens`
    // has no client grant of any kind (`0011`).
    expect(world.reads.find((r) => r.table === 'calendar_tokens').role).toBe('service')

    // AND THE CALLER CLIENT ACTUALLY CARRIES THE CALLER'S JWT.
    //
    // Tagging by KEY alone is not enough, and that gap is what the review
    // found: the anon key is what makes a client "the caller" only if the
    // request also forwards the Authorization header. Without it the client is
    // anonymous, row-level security scopes it to nothing, `auth.getUser()`
    // returns nobody and every disconnect 401s in production — while this
    // fake, which returns `world.user` regardless, keeps all of these tests
    // green. The whole 403 argument rests on this header, so it is asserted
    // rather than assumed.
    expect(world.clientOptions.caller.options.global.headers.Authorization).toBe('Bearer caller-jwt')
    expect(world.clientOptions.caller.url).toBe(ENV.SUPABASE_URL)
    // And the service client does NOT carry it — it is authority in its own
    // right, and forwarding a caller's token to it would be a second identity
    // on a client that must have exactly one.
    expect(world.clientOptions.service.options.global).toBeUndefined()
  })

  it('deletes NOTHING but the three calendar tables — a confirmed capacity row is not ours', async () => {
    // AC 3's server half. `member_capacity` holds the figures the member
    // accepted, and an accepted figure is theirs whatever produced it, so this
    // function must never name that table. Asserted as an absence over the
    // recorded calls rather than by reading the source, so a delete added later
    // reddens here.
    await handler()(post())
    expect(deletedTables()).not.toContain('member_capacity')
    expect(deletedTables()).not.toContain('members')
    expect(deletedTables()).not.toContain('chores')
  })

  it('acts on the household the body named, when the caller is in two', async () => {
    // #161's shape. Both rows are visible to this caller; the body narrows to
    // one, and the deletes are keyed on THAT household's member row.
    world.members = [MEMBER, MEMBER_IN_B]
    await handler()(post({ householdId: 'household-2' }))
    // The count FIRST. A `for` over an empty array asserts nothing, and the
    // mutation this test is written against — dropping the household filter —
    // produces exactly that: `maybeSingle()` over two rows is a refusal, the
    // handler returns 400, and the loop below would then pass having watched
    // nothing happen.
    expect(world.deletes).toHaveLength(DELETED_TABLES.length)
    for (const del of world.deletes) expect(del.value).toBe(MEMBER_IN_B.id)
  })
})

describe('AC 4 — Google is asked to forget it too, best-effort', () => {
  it('posts the stored refresh token to Google’s revocation endpoint', async () => {
    const response = await handler()(post())
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [input, init] = [fetchFn.calls[0].input, fetchFn.calls[0].init]
    expect(input).toBe(GOOGLE_REVOKE_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(new URLSearchParams(init.body).get('token')).toBe(STORED_TOKEN)
    expect((await response.json()).revoked).toBe(true)
  })

  it('revokes BEFORE the deletion, because the first delete destroys the value', async () => {
    // ORDER, asserted as order. The first draft of this test checked that a
    // fetch happened and that the token was read at some point — two facts
    // about EXISTENCE, neither about sequence — so moving the revoke after the
    // deletion loop left it green while the behaviour it is named for was gone.
    // A test named for a property it does not test is the shape `prove-tests`
    // exists to catch, and a mutation cannot find it because there is nothing
    // wrong with the code it covers.
    //
    // The instrument is a single ordered log: every read and every delete
    // appends to `world.events` as it happens, and the revoke appends through
    // the injected `fetch`. Sequence is then a question about indices.
    await handler()(post())

    const order = world.events
    const tokenRead = order.indexOf('read:calendar_tokens')
    const revoke = order.indexOf('revoke')
    const firstDelete = order.findIndex((e) => e.startsWith('delete:'))

    expect(tokenRead, 'the token must be read at all').toBeGreaterThanOrEqual(0)
    expect(revoke, 'the revoke must happen at all').toBeGreaterThanOrEqual(0)
    expect(firstDelete, 'something must be deleted').toBeGreaterThanOrEqual(0)

    expect(tokenRead).toBeLessThan(revoke)
    expect(revoke).toBeLessThan(firstDelete)
    // And the delete that follows is the credential's, so the value the revoke
    // needed is destroyed by the very next step — which is why the order is not
    // a preference.
    expect(order[firstDelete]).toBe('delete:calendar_tokens')
  })

  it('deletes everything anyway when Google REFUSES the revocation', async () => {
    // The criterion's own sentence: local deletion succeeds even when the
    // revoke call fails. Google answers a token it no longer recognises with a
    // 400, which is the commonest way this happens — and it means the grant is
    // already gone, so refusing here would leave the app holding a credential
    // BECAUSE the credential was already dead.
    fetchFn = makeFetch(new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 }))
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect(deletedTables()).toEqual([...DELETED_TABLES])
    expect((await response.json()).revoked).toBe(false)
  })

  it('deletes everything anyway when Google cannot be reached at all', async () => {
    fetchFn = makeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect(deletedTables()).toEqual([...DELETED_TABLES])
    expect((await response.json()).revoked).toBe(false)
  })

  it('reports `revoked: null` — not false — when there was no credential to revoke', async () => {
    // A member with no stored token AND no stranded connection has nothing
    // outstanding at Google. Saying `false` would put the "Google may still
    // hold it" sentence on a screen where it is untrue, which is the opposite
    // of what this story is for.
    world.token = null
    world.connection = null
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect((await response.json()).revoked).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
    // Still deletes: the connection row and any derived figures may outlive the
    // token, and a disconnect that skipped them because the token was already
    // gone would leave the screen saying "Calendar connected".
    expect(deletedTables()).toEqual([...DELETED_TABLES])
  })

  it('reports `false` when the token row could not be READ — not null', async () => {
    // THE DEFECT THE REVIEW FOUND, from the side that proves it.
    //
    // PostgREST answers a failed read with `data: null`, which is
    // indistinguishable from an absent row — so a handler that does not bind
    // `error` reports a FAILURE as "there was nothing to revoke", never
    // attempts the revoke, deletes everything, and hands the member a plain
    // success while Taskr has destroyed the only handle on a grant Google may
    // still hold.
    //
    // This assertion is the whole guard, and the first draft of this file
    // asserted `toBeNull()` here — under a comment saying exactly what the line
    // below now says. A test that states the intent in prose and asserts its
    // opposite is worse than no test: it converts the defect into a defended
    // one. `false` is right even though Taskr never asked Google, because the
    // member-facing question is not "did Taskr ask" but "can Taskr vouch that
    // the grant is gone", and here it cannot.
    // `connection` CLEARED, and that is not tidying — it is what makes this
    // test about the read error at all. *Measured* in the second mutation pass:
    // with the fixture's default connection row present, removing the
    // `tokenError` arm from the handler reddened **0 of 30** against a written
    // prediction of 0, because the stranded-connection arm answered `false` in
    // its place. Two guards producing one observable are one guard with a
    // spare, and the spare is what keeps it green — the same fault this repo
    // measured on #95's `isMe`. With the row gone, `tokenError` is the only
    // thing that can produce the assertion below.
    world.connection = null
    world.tokenError = { code: '42501', message: 'permission denied' }
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect((await response.json()).revoked).toBe(false)
    expect(deletedTables()).toEqual([...DELETED_TABLES])
  })

  it('reports `false` on the RETRY the handler itself prescribes', async () => {
    // A disconnect that fails part way through has already deleted the token —
    // credential first — and tells the member to press Disconnect again. On
    // that second attempt the credential is gone by construction, so the revoke
    // outcome cannot be re-derived, and reporting `null` would erase the AC 4
    // warning on the one path the refusal sentence sends people down.
    //
    // No token beside a SURVIVING connection row is the signature of exactly
    // that state: the deletions run credential-first, and `calendar-connect`
    // rolls its token back when the connection write fails, so this pairing
    // cannot arise any other way.
    world.token = null
    world.connection = { id: 'conn-1' }
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect((await response.json()).revoked).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(deletedTables()).toEqual([...DELETED_TABLES])
  })

  it('never sends the client id or the client secret', async () => {
    // Google's revocation endpoint takes the token alone. Sending credentials
    // it does not need would tie this exit to configuration it does not need —
    // the thing the missing-env test above is about, from the other side.
    await handler()(post())
    const sent = new URLSearchParams(fetchFn.calls[0].init.body)
    expect(sent.get('client_id')).toBeNull()
    expect(sent.get('client_secret')).toBeNull()
    expect([...sent.keys()]).toEqual(['token'])
  })
})

describe('when a deletion fails', () => {
  it('stops, and says part of it was removed rather than claiming nothing happened', async () => {
    world.deleteErrors = { calendar_busy: { code: '42501', message: 'permission denied' } }
    const response = await handler()(post())
    expect(response.status).toBe(500)
    const { error } = await response.json()
    expect(error).toContain('Part of it was removed')
    expect(error).toContain('press Disconnect again')
    // Stopped at the failure rather than pressing on: the connection row is
    // still there, which is what makes the control still visible to press.
    expect(deletedTables()).toEqual(['calendar_tokens', 'calendar_busy'])
  })

  it('reports a failure on the FIRST delete without having deleted anything else', async () => {
    world.deleteErrors = { calendar_tokens: { code: '42501', message: 'permission denied' } }
    const response = await handler()(post())
    expect(response.status).toBe(500)
    expect(deletedTables()).toEqual(['calendar_tokens'])
  })
})

describe('a PIN member', () => {
  it('is not refused — the exit is not narrower than the way in', async () => {
    // `calendar-connect` and `calendar-busy` both refuse a member with no real
    // email, because neither can do anything for one. This can: it deletes rows
    // keyed on the caller's own member id, and a PIN member holds none. The
    // honest outcome is a disconnect that removed nothing, and a refusal would
    // be a sentence about a rule that protects nobody.
    world.members = [PIN_MEMBER]
    world.token = null
    const response = await handler()(post())
    expect(response.status).toBe(200)
    expect(deletedTables()).toEqual([...DELETED_TABLES])
  })
})

describe('what it hands back', () => {
  it('names the member it acted on, so the client is not guessing', async () => {
    const response = await handler()(post())
    expect(await response.json()).toEqual({ ok: true, memberId: MEMBER.id, revoked: true })
  })

  it('carries nothing out of anybody’s calendar', async () => {
    // The same minimization discipline `calendar-busy` holds to: the response
    // is an acknowledgement, and there is no version of it that could carry an
    // event, a title or the credential it just destroyed.
    const response = await handler()(post())
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['memberId', 'ok', 'revoked'])
    expect(JSON.stringify(body)).not.toContain(STORED_TOKEN)
  })
})
