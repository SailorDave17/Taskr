// @vitest-environment node
//
// Node, not the repo-wide jsdom: this exercises a Deno-shaped handler that takes
// a `Request` and returns a `Response`, and Node 22 supplies both as globals.
// The directive above is matched anywhere in the file, so it is written exactly
// once and this sentence deliberately does not repeat it.
//
// The Edge Function's decisions, with no network, no Docker and no Supabase —
// stories #62, #87, #247 and #341.
//
// WHY THIS FILE EXISTS, WHEN THE FUNCTION ALREADY HAD A SUITE
//
// `src/test/provisioning.functions.test.js` drives the real function over real
// HTTP against a LOCAL Supabase stack. That is the right instrument for the
// authorization shape — it is the only thing that proves row-level security
// actually refuses — and it is a third runner CI never runs, because it needs
// Docker, Postgres, GoTrue and a service_role key.
//
// #341 AC 4 is the branch that instrument cannot reach: **the mailer refuses the
// send**. Supabase's built-in SMTP allows a handful of emails an hour and there
// is no way to ask a local GoTrue to fail on demand, so the branch deciding
// whether an organizer is told "the sign-in was not created" would have been
// covered by a suite that never runs, on a stack that will not produce it.
// `calendar-connect/handler.test.js` made the same argument about Google first.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//
//   - Whether the policies and grants in `0007`/`0014`/`0016` are right. A fake
//     client returns whatever this file tells it to; it can neither refuse nor
//     enforce. That is the pglite suites and the functions suite.
//   - Whether a BROWSER can call the function at all — a preflight is a browser
//     behaviour and Node sends none. That is src/test/edge-function-cors.test.js.
//   - Whether the function is deployed. That is `npm run check:live`.
//   - Whether GoTrue really refuses a second invitation to the same address.
//     `isAddressTakenError` is asserted against the shapes GoTrue is documented
//     to send; that it sends one of them is a claim only the live project
//     settles, and #178 is where it is settled.
//
// Names are synthetic — see #19.

import { describe, expect, it } from 'vitest'
import { ACTIONS, CORS, createHandler, hasRealAddress, isAddressTakenError } from './handler.ts'

const MEMBER = {
  id: 'member-1',
  display_name: 'Placeholder One',
  claimed_by: null,
  email: 'placeholder.one@example.test',
  household_id: 'household-1',
}

/** A member with no inbox — `email` null is the discriminator `0007` established. */
const PIN_MEMBER = { ...MEMBER, id: 'member-2', display_name: 'Placeholder Two', email: null }

const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_placeholder',
}

const ORIGIN = 'https://placeholder.example.test'

/**
 * A fake Supabase client that RECORDS WHICH KEY IT WAS BUILT WITH.
 *
 * That is the point of the fake rather than an accident of it, and it is copied
 * from `calendar-connect/handler.test.js` for the same reason. #87's
 * authorization shape says the caller's authority must be settled with a
 * caller-scoped client BEFORE the service_role one is used for anything, and the
 * failure mode of getting it wrong is silent: doing the member read as
 * service_role bypasses row-level security, so it succeeds for every member of
 * every household and the only thing left between a signed-in stranger and
 * somebody else's household is a check this file could get wrong.
 *
 * So every operation is tagged with the key that performed it and the tests
 * assert the tag, rather than trusting the ordering to be visible.
 *
 * THE FAKE OFFERS MORE THAN THE HANDLER USES, deliberately. `createUser`,
 * `updateUserById` and `deleteUser` are all present and all recorded even in
 * tests that expect none of them, so "no account was created" is an assertion
 * about a client that COULD have created one. A fake exposing only the verbs the
 * happy path calls would make every such assertion a statement about the fake.
 */
function makeWorld(overrides = {}) {
  const world = {
    user: { id: 'auth-1' },
    members: [MEMBER, PIN_MEMBER],
    organizerOf: new Set(['household-1']),
    /** What `inviteUserByEmail` answers. Overridden per test — this is the subject. */
    inviteResult: { data: { user: { id: 'auth-new' } }, error: null },
    createUserResult: { data: { user: { id: 'auth-new' } }, error: null },
    claimError: null,
    /** Every operation, tagged with the key that performed it. */
    ops: [],
    ...overrides,
  }

  const record = (key, op) => {
    world.ops.push({ key, ...op })
  }

  world.createClient = (url, key, options) => {
    const role = key === ENV.SUPABASE_SERVICE_ROLE_KEY ? 'service' : 'caller'
    return {
      // Recorded so a test can assert the caller-scoped client really carried
      // the caller's JWT — an anon-key client with no Authorization header would
      // pass every assertion below about WHICH key was used and still be
      // unauthenticated.
      authorizationHeader: options?.global?.headers?.Authorization ?? null,
      auth: {
        getUser: async () => ({ data: { user: world.user } }),
        admin: {
          createUser: async (attrs) => {
            record(role, { op: 'createUser', email: attrs.email, password: attrs.password })
            return world.createUserResult
          },
          inviteUserByEmail: async (email, opts) => {
            record(role, { op: 'inviteUserByEmail', email, redirectTo: opts?.redirectTo })
            return world.inviteResult
          },
          updateUserById: async (id, attrs) => {
            record(role, { op: 'updateUserById', id, password: attrs.password })
            return { error: null }
          },
          deleteUser: async (id) => {
            record(role, { op: 'deleteUser', id })
            return { error: null }
          },
        },
      },
      rpc: async (name, args) => {
        record(role, { op: 'rpc', name, args })
        if (name !== 'is_household_organizer') return { data: null, error: null }
        return { data: world.organizerOf.has(args.target_household), error: null }
      },
      from: (table) => ({
        select: (columns) => {
          const filters = {}
          const chain = {
            eq: (column, value) => {
              filters[column] = value
              return chain
            },
            neq: () => chain,
            limit: async () => {
              record(role, { op: 'select', table, columns, filters })
              return { data: [], error: null }
            },
            maybeSingle: async () => {
              record(role, { op: 'select', table, columns, filters })
              // The caller-scoped read is what row-level security scopes. The
              // fake models that by answering ONLY from the caller's list, so a
              // handler that did this read as service_role would be visible in
              // the tag rather than in the result.
              const found = world.members.find((m) => m.id === filters.id) ?? null
              return { data: found, error: null }
            },
          }
          return chain
        },
        update: (row) => ({
          eq: async (column, value) => {
            record(role, { op: 'update', table, row, [column]: value })
            return { error: world.claimError }
          },
        }),
      }),
    }
  }

  return world
}

function call(world, body, { authorization = 'Bearer caller-jwt', method = 'POST' } = {}) {
  const handler = createHandler({
    env: (name) => ENV[name],
    createClient: world.createClient,
  })
  return handler(
    new Request('https://placeholder.functions.test/provision-member', {
      method,
      headers: { Authorization: authorization, 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  )
}

const opsOf = (world, op) => world.ops.filter((entry) => entry.op === op)

describe('#341 — provision-member, the invitation path', () => {
  it('POSITIVE CONTROL: the happy path answers ok, so a refusal below means something', async () => {
    // Without this every "it refused" assertion passes just as well against a
    // handler that refuses everything, and a fake that can never succeed makes
    // the whole file vacuous in one direction.
    const world = makeWorld()
    const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      action: 'invite',
      memberId: MEMBER.id,
      email: MEMBER.email,
      claimedBy: 'auth-new',
    })
  })

  it('sends the invitation to the row’s address, with the origin the organizer is on', async () => {
    const world = makeWorld()
    await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

    const invites = opsOf(world, 'inviteUserByEmail')
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({ email: MEMBER.email, redirectTo: ORIGIN })
    // The whole story: no credential is chosen for anybody. `createUser` takes a
    // password and this path must never reach it.
    expect(opsOf(world, 'createUser')).toHaveLength(0)
  })

  it('attaches the freshly created account to the member row, as service_role', async () => {
    const world = makeWorld()
    await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

    const updates = opsOf(world, 'update')
    expect(updates).toHaveLength(1)
    // `claimed_by` is absent from the client update grant in 0007, so this write
    // has to be the service_role client's or it could not happen at all.
    expect(updates[0]).toMatchObject({
      key: 'service',
      table: 'members',
      row: { claimed_by: 'auth-new' },
      id: MEMBER.id,
    })
  })

  it('settles authority with the CALLER before service_role does anything — #87, #161', async () => {
    const world = makeWorld()
    await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

    const firstService = world.ops.findIndex((entry) => entry.key === 'service')
    const memberRead = world.ops.findIndex((entry) => entry.op === 'select')
    const organizerCheck = world.ops.findIndex((entry) => entry.op === 'rpc')

    expect(world.ops[memberRead].key).toBe('caller')
    expect(world.ops[organizerCheck].key).toBe('caller')
    // Ordering asserted by INDEX rather than by "did it happen", because both
    // reads happening is not the property — both happening FIRST is.
    expect(memberRead).toBeLessThan(firstService)
    expect(organizerCheck).toBeLessThan(firstService)
    // #161: the organizer question is about the household on the MEMBER'S ROW,
    // never the caller's first one.
    expect(world.ops[organizerCheck].args).toEqual({ target_household: MEMBER.household_id })
  })

  it('refuses a caller who does not organise the member’s household', async () => {
    const world = makeWorld({ organizerOf: new Set(['household-elsewhere']) })
    const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

    expect(res.status).toBe(403)
    expect(opsOf(world, 'inviteUserByEmail')).toHaveLength(0)
    expect(world.ops.some((entry) => entry.key === 'service')).toBe(false)
  })

  it('refuses a member who already has a sign-in, and names reset as the way out', async () => {
    const world = makeWorld({ members: [{ ...MEMBER, claimed_by: 'auth-existing' }] })
    const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'That person already has a sign-in — reset it instead.',
    })
    expect(opsOf(world, 'inviteUserByEmail')).toHaveLength(0)
  })

  it('refuses a member with no email, because a synthetic address has no mailbox', async () => {
    const world = makeWorld()
    const res = await call(world, { action: 'invite', memberId: PIN_MEMBER.id, redirectTo: ORIGIN })

    expect(res.status).toBe(409)
    const { error } = await res.json()
    // The sentence has to name the repair. "Cannot invite" tells an organizer
    // nothing they can act on; "add an address first" does.
    expect(error).toContain(PIN_MEMBER.display_name)
    expect(error).toMatch(/add one first/i)
    expect(opsOf(world, 'inviteUserByEmail')).toHaveLength(0)
  })

  it('refuses an invite with no redirectTo rather than defaulting to production', async () => {
    // A default would work from every origin, which is exactly what would stop
    // anybody noticing that a dev-server invitation lands on the live site.
    const world = makeWorld()
    const res = await call(world, { action: 'invite', memberId: MEMBER.id })

    expect(res.status).toBe(400)
    expect(opsOf(world, 'inviteUserByEmail')).toHaveLength(0)
  })

  it('takes no password for an invite, so a short one is not the refusal', async () => {
    // The password floor applies to provision and reset. If it applied here, the
    // organizer would be asked for a credential by the very story that removes
    // the idea — and the refusal would name length, which reads as a bug.
    const world = makeWorld()
    const res = await call(world, {
      action: 'invite',
      memberId: MEMBER.id,
      redirectTo: ORIGIN,
      password: 'x',
    })
    expect(res.status).toBe(200)
  })

  describe('AC 3 — the address already holds an account', () => {
    // The two shapes GoTrue sends, asserted separately rather than through one
    // fixture: `code` is the contract and the message is prose that gets
    // reworded without versioning, so the fallback is load-bearing on older
    // builds and must be proven on its own.
    const SHAPES = [
      ['a coded refusal', { code: 'email_exists', status: 422, message: 'Email address already registered' }],
      ['an uncoded refusal', { status: 422, message: 'A user with this email address has already been registered' }],
    ]

    it.each(SHAPES)('classifies %s as taken, not as a mailer fault', (_label, error) => {
      expect(isAddressTakenError(error)).toBe(true)
    })

    it('does NOT classify a mailer refusal as taken', () => {
      // The control. Without it the classifier could return true for everything
      // and every assertion above would still pass.
      expect(isAddressTakenError({ code: 'error_sending_email', status: 500, message: 'Error sending invite email' })).toBe(false)
      expect(isAddressTakenError(null)).toBe(false)
    })

    it.each(SHAPES)('answers 409 naming reset, and does not claim the row (%s)', async (_label, error) => {
      const world = makeWorld({ inviteResult: { data: { user: null }, error } })
      const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain(MEMBER.email)
      // The organizer must not read this as "the email went" — AC 3 in as many
      // words, so the sentence is asserted to say both halves.
      expect(body.error).toMatch(/no invitation was sent/i)
      expect(body.error).toMatch(/reset sign-in/i)
      expect(opsOf(world, 'update')).toHaveLength(0)
    })
  })

  describe('AC 4 — the mailer refuses the send', () => {
    const MAILER_REFUSED = {
      code: 'error_sending_email',
      status: 500,
      message: 'Error sending invite email',
    }

    it('says the sign-in was NOT created, as one fact', async () => {
      const world = makeWorld({ inviteResult: { data: { user: null }, error: MAILER_REFUSED } })
      const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

      expect(res.status).toBe(502)
      const { error } = await res.json()
      expect(error).toMatch(/not created/i)
      expect(error).toMatch(/try again/i)
      // A half-created state is the thing the criterion forbids, so the row must
      // be untouched — asserted on a fake that offers `update` and records it.
      expect(opsOf(world, 'update')).toHaveLength(0)
    })

    it('deletes an account GoTrue created before the send failed', async () => {
      // The rollback is what makes the sentence TRUE rather than merely
      // reassuring. GoTrue creates the user and then sends, so a failed send can
      // leave an unconfirmed account — and that account is exactly what makes
      // the organizer's NEXT attempt fail on AC 3's already-registered branch,
      // for somebody who has never signed in.
      const world = makeWorld({
        inviteResult: { data: { user: { id: 'auth-stranded' } }, error: MAILER_REFUSED },
      })
      const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

      expect(res.status).toBe(502)
      expect(opsOf(world, 'deleteUser')).toEqual([
        { key: 'service', op: 'deleteUser', id: 'auth-stranded' },
      ])
      expect(opsOf(world, 'update')).toHaveLength(0)
    })

    it('has nothing to roll back when GoTrue created nothing', async () => {
      // The negative control for the test above: a delete fired unconditionally
      // would pass that one and be wrong here, and `deleteUser(undefined)` is
      // the kind of call that fails on a real client and not on a fake.
      const world = makeWorld({ inviteResult: { data: { user: null }, error: MAILER_REFUSED } })
      await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })
      expect(opsOf(world, 'deleteUser')).toHaveLength(0)
    })
  })

  it('rolls back the account when the claim write fails, leaving no orphan', async () => {
    const world = makeWorld({ claimError: { message: 'nope' } })
    const res = await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })

    expect(res.status).toBe(400)
    expect(opsOf(world, 'deleteUser')).toEqual([
      { key: 'service', op: 'deleteUser', id: 'auth-new' },
    ])
  })
})

describe('#341 AC 1 — provision is refused for a member who has an inbox', () => {
  it('refuses, and points at the invitation instead', async () => {
    const world = makeWorld()
    const res = await call(world, {
      action: 'provision',
      memberId: MEMBER.id,
      password: 'longenough',
    })

    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toContain(MEMBER.display_name)
    expect(error).toMatch(/send them an invitation/i)
    // The point of the criterion: no account is minted at a password somebody
    // else chose. Asserted on a fake that offers `createUser` and records it.
    expect(opsOf(world, 'createUser')).toHaveLength(0)
    expect(opsOf(world, 'update')).toHaveLength(0)
  })

  it('still mints for an email-less row, which is the only caller left', async () => {
    // The other half, and the reason this is a refusal rather than a deletion:
    // a member with no address cannot be invited, so removing `provision`
    // outright would leave them with no way in at all. #191 retires the ability
    // to CREATE such a row, and this branch goes with it.
    const world = makeWorld()
    const res = await call(world, {
      action: 'provision',
      memberId: PIN_MEMBER.id,
      password: 'longenough',
    })

    expect(res.status).toBe(200)
    const created = opsOf(world, 'createUser')
    expect(created).toHaveLength(1)
    expect(created[0].email).toBe(`${PIN_MEMBER.id}@taskr.invalid`)
    expect(opsOf(world, 'inviteUserByEmail')).toHaveLength(0)
  })

  it('hasRealAddress is the one predicate, and treats blank as absent', () => {
    // Three branches turn on this. A member row whose address is an empty string
    // is a row somebody cleared, and treating it as real would send an
    // invitation to nowhere and refuse the provision that could have helped.
    expect(hasRealAddress({ email: 'placeholder.one@example.test' })).toBe(true)
    expect(hasRealAddress({ email: null })).toBe(false)
    expect(hasRealAddress({ email: '   ' })).toBe(false)
    expect(hasRealAddress({})).toBe(false)
  })
})

describe('provision-member — the platform contract the split must not change', () => {
  it('answers a preflight with the header list a browser asks about', async () => {
    const world = makeWorld()
    const res = await call(world, null, { method: 'OPTIONS' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      CORS['Access-Control-Allow-Headers'],
    )
  })

  it('refuses anything but POST', async () => {
    const world = makeWorld()
    const res = await call(world, null, { method: 'GET' })
    expect(res.status).toBe(405)
  })

  it('refuses a caller with no bearer token before reading anything', async () => {
    const world = makeWorld()
    const res = await call(world, { action: 'invite', memberId: MEMBER.id }, { authorization: '' })
    expect(res.status).toBe(401)
    expect(world.ops).toHaveLength(0)
  })

  it('carries the caller’s JWT on the caller-scoped client', async () => {
    // The tag says WHICH KEY built the client; this says the client was actually
    // authenticated. A caller-scoped client with no Authorization header reads
    // as `anon`, sees nothing, and would make every refusal above pass for the
    // wrong reason.
    const world = makeWorld()
    let callerHeader = null
    const inner = world.createClient
    world.createClient = (url, key, options) => {
      const client = inner(url, key, options)
      if (key === ENV.SUPABASE_ANON_KEY) callerHeader = client.authorizationHeader
      return client
    }
    await call(world, { action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN })
    expect(callerHeader).toBe('Bearer caller-jwt')
  })

  it('names all four actions, and refuses anything else', async () => {
    expect([...ACTIONS]).toEqual(['provision', 'invite', 'reset', 'revoke'])
    const world = makeWorld()
    const res = await call(world, { action: 'mint', memberId: MEMBER.id })
    expect(res.status).toBe(400)
    const { error } = await res.json()
    // The refusal is built FROM the list, so a fifth action cannot be added
    // without the sentence following it.
    for (const action of ACTIONS) expect(error).toContain(action)
  })

  it('refuses when a secret is missing rather than answering degraded', async () => {
    const world = makeWorld()
    const handler = createHandler({
      env: (name) => (name === 'SUPABASE_SERVICE_ROLE_KEY' ? undefined : ENV[name]),
      createClient: world.createClient,
    })
    const res = await handler(
      new Request('https://placeholder.functions.test/provision-member', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'invite', memberId: MEMBER.id, redirectTo: ORIGIN }),
      }),
    )
    expect(res.status).toBe(500)
  })

  it('resets and revokes exactly as before the split', async () => {
    // The split moved 300 lines of authorization code. These two branches are
    // not #341's subject and are asserted here for that reason: a move is
    // supposed to change nothing, and nothing is what has to be checked.
    const claimed = { ...MEMBER, claimed_by: 'auth-existing' }
    const resetWorld = makeWorld({ members: [claimed] })
    const reset = await call(resetWorld, {
      action: 'reset',
      memberId: claimed.id,
      password: 'longenough',
    })
    expect(reset.status).toBe(200)
    expect(opsOf(resetWorld, 'updateUserById')).toMatchObject([
      { key: 'service', id: 'auth-existing', password: 'longenough' },
    ])

    const revokeWorld = makeWorld({ members: [claimed] })
    const revoke = await call(revokeWorld, { action: 'revoke', memberId: claimed.id })
    expect(revoke.status).toBe(200)
    await expect(revoke.json()).resolves.toMatchObject({ deleted: true })
    expect(opsOf(revokeWorld, 'deleteUser')).toMatchObject([{ id: 'auth-existing' }])
  })
})
