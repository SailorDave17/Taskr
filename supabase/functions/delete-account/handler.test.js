// @vitest-environment node
//
// #432 — the delete-account function's decisions, with no network and no
// Supabase.
//
// Two fake clients — the caller's and the service role's — record every call in
// one log, tagged by role, because the subjects are ORDER (the live-household
// check is the caller's own read and comes first; the grants are revoked
// before the sign-in goes; the sign-in goes last) and WHOSE POWER each step
// uses (only the pending-row read, the token read and the account deletion are
// service_role's).
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//   - that row-level security really hides a household pending deletion from
//     the caller's read: `householdDeletion.pglite.test.js`, against a real
//     Postgres, holds `current_household_ids()` to that;
//   - what `member_tokens_to_revoke` returns: `revokeKeying.pglite.test.js`;
//   - whether the function is deployed: the deploy checks.
//
// Values are synthetic and lower-case — see #19.

import { describe, expect, it, vi } from 'vitest'
import { CORS, STILL_IN_A_HOUSEHOLD, createHandler } from './handler.ts'
import { GOOGLE_REVOKE_ENDPOINT } from '../calendar-disconnect/handler.ts'

const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-placeholder',
}

/** The script a test overrides: the caller, what each read answers, and every error. */
function script(overrides = {}) {
  return {
    user: { id: 'auth-a' },
    /** What the CALLER's read of their own rows answers: rows in live households. */
    live: [],
    liveError: null,
    /** What the SERVICE read of their rows answers: rows in pending households. */
    pending: [],
    pendingError: null,
    /** Tokens per pending member id. */
    tokens: {},
    tokenError: null,
    deleteError: null,
    ...overrides,
  }
}

function fakes(s, log) {
  const select = (role, table) => {
    const filters = []
    const run = (bounded) => {
      log.push([role, 'select', table, filters.map(([c, v]) => `${c}=${v}`).join(' ') + (bounded ? ' limit' : '')])
      if (table !== 'members') throw new Error(`unexpected ${role} read of ${table}`)
      const mine = filters.some(([c, v]) => c === 'claimed_by' && v === s.user?.id)
      if (role === 'caller') return { data: mine ? s.live : [], error: s.liveError }
      return { data: mine ? s.pending : [], error: s.pendingError }
    }
    const builder = {
      eq: (column, value) => (filters.push([column, value]), builder),
      limit: () => Promise.resolve(run(true)),
      then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
    }
    return builder
  }
  const client = (role) => ({
    auth: {
      getUser: async () => ({ data: role === 'caller' ? { user: s.user } : null }),
      admin: {
        deleteUser: async (id) => {
          log.push([role, 'deleteUser', id])
          return { error: s.deleteError }
        },
      },
    },
    from: (table) => ({ select: () => select(role, table) }),
    rpc: async (fn, args) => {
      log.push([role, 'rpc', fn, args])
      if (fn === 'member_tokens_to_revoke') {
        return { data: s.tokenError ? null : (s.tokens[args.member_id] ?? []), error: s.tokenError }
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
  })
  return { caller: client('caller'), service: client('service') }
}

function harness(s = script(), { env = ENV, googleOk = true } = {}) {
  const log = []
  const { caller, service } = fakes(s, log)
  const createClient = vi.fn((url, key) => (key === env.SUPABASE_SERVICE_ROLE_KEY ? service : caller))
  const fetch = vi.fn(async (url, init) => {
    log.push(['google', 'revoke', url, new URLSearchParams(init.body).get('token')])
    if (googleOk === 'throw') throw new Error('network down')
    return new Response('', { status: googleOk ? 200 : 400 })
  })
  const handle = createHandler({ env: (name) => env[name], createClient, fetch })
  return { handle, log, createClient, fetch }
}

const post = (body = {}, bearer = true) =>
  new Request('https://placeholder.supabase.co/functions/v1/delete-account', {
    method: 'POST',
    headers: bearer ? { Authorization: 'Bearer jwt-placeholder' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const kinds = (log) =>
  log.map(([role, kind, a, b]) => {
    if (kind === 'rpc') return `${role} rpc ${a}`
    if (kind === 'select') return `${role} select ${a} ${b}`
    if (kind === 'revoke') return `google revoke ${b}`
    return `${role} ${kind} ${a}`
  })

/** Two pending rows, one with a grant and one without. */
const PENDING = {
  pending: [{ id: 'member-p1' }, { id: 'member-p2' }],
  tokens: { 'member-p1': [{ refresh_token: 'token-1' }], 'member-p2': [] },
}

describe('who may call delete-account (#432)', () => {
  it('answers a preflight with the CORS headers every function carries', async () => {
    const { handle } = harness()
    const res = await handle(new Request('https://x.test', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(CORS['Access-Control-Allow-Headers'])
  })

  it('refuses anything but POST, and a missing sign-in, touching nothing', async () => {
    const { handle, log } = harness()
    expect((await handle(new Request('https://x.test', { method: 'GET' }))).status).toBe(405)
    expect((await handle(post({}, false))).status).toBe(401)
    expect(log).toEqual([])
  })

  it('refuses when not configured, before any client exists', async () => {
    const { handle, createClient } = harness(script(), { env: { SUPABASE_URL: ENV.SUPABASE_URL } })
    expect((await handle(post())).status).toBe(500)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('refuses a token that names nobody, and touches nothing', async () => {
    const { handle, log } = harness(script({ user: null }))
    expect((await handle(post())).status).toBe(401)
    expect(kinds(log)).toEqual([])
  })

  it('POSITIVE CONTROL: a sign-in in no household is deleted, as service_role, and nothing else is touched', async () => {
    const { handle, log } = harness()
    const res = await handle(post())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      deleted: true,
      revoked: 0,
      revokeFailed: false,
      pendingHouseholds: 0,
    })
    expect(kinds(log)).toEqual([
      'caller select members claimed_by=auth-a limit',
      'service select members claimed_by=auth-a',
      'service deleteUser auth-a',
    ])
  })

  it('takes WHO is deleted from the sign-in, never from the body (AC 4)', async () => {
    const { handle, log } = harness()
    const res = await handle(post({ userId: 'auth-b', memberId: 'member-b', claimedBy: 'auth-b' }))
    expect(res.status).toBe(200)
    expect(log.filter(([, kind]) => kind === 'deleteUser')).toEqual([['service', 'deleteUser', 'auth-a']])
    expect(JSON.stringify(log)).not.toContain('auth-b')
  })

  it('refuses while a live household still claims them, before any service_role read', async () => {
    const { handle, log } = harness(script({ live: [{ id: 'member-a' }], ...PENDING }))
    const res = await handle(post())
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: STILL_IN_A_HOUSEHOLD })
    expect(kinds(log)).toEqual(['caller select members claimed_by=auth-a limit'])
  })

  it('asks the live-household question as the CALLER, so row-level security decides what counts', async () => {
    // A service_role read would see the pending household too, and refuse a
    // person the leave path has already refused — the trap this function exists
    // to open. The tag is the assertion.
    const { handle, log } = harness(script(PENDING))
    expect((await handle(post())).status).toBe(200)
    expect(log[0]).toEqual(['caller', 'select', 'members', 'claimed_by=auth-a limit'])
  })

  it('refuses when its own roster read fails, and touches nothing', async () => {
    const { handle, log } = harness(script({ liveError: { message: 'boom' } }))
    expect((await handle(post())).status).toBe(400)
    expect(kinds(log)).toEqual(['caller select members claimed_by=auth-a limit'])
  })
})

describe('what deleting does, in what order (#432)', () => {
  it('revokes the grants behind every pending row, THEN deletes the sign-in', async () => {
    const { handle, log } = harness(script(PENDING))
    const res = await handle(post())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      deleted: true,
      revoked: 1,
      revokeFailed: false,
      pendingHouseholds: 2,
    })
    expect(kinds(log)).toEqual([
      'caller select members claimed_by=auth-a limit',
      'service select members claimed_by=auth-a',
      'service rpc member_tokens_to_revoke',
      'google revoke token-1',
      'service rpc member_tokens_to_revoke',
      'service deleteUser auth-a',
    ])
    expect(log.filter(([, kind]) => kind === 'rpc').map(([, , , args]) => args)).toEqual([
      { member_id: 'member-p1' },
      { member_id: 'member-p2' },
    ])
  })

  it('sends the revoke where calendar-disconnect sends it', async () => {
    const { handle, fetch } = harness(script(PENDING))
    await handle(post())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(GOOGLE_REVOKE_ENDPOINT)
  })

  it('deletes nothing when the remaining memberships cannot be read', async () => {
    const { handle, log } = harness(script({ pendingError: { message: 'boom' } }))
    const res = await handle(post())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/was not deleted/) })
    expect(kinds(log)).not.toContain('service deleteUser auth-a')
  })

  it('deletes nothing when the grants cannot be read, so none is left live at Google with nobody to revoke it', async () => {
    const { handle, log } = harness(script({ ...PENDING, tokenError: { message: 'boom' } }))
    const res = await handle(post())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/was not deleted/) })
    expect(kinds(log)).not.toContain('service deleteUser auth-a')
    expect(kinds(log).filter((k) => k.startsWith('google'))).toEqual([])
  })

  it('still deletes when Google refuses or cannot be reached, and says so', async () => {
    for (const googleOk of [false, 'throw']) {
      const { handle, log } = harness(script(PENDING), { googleOk })
      const res = await handle(post())
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({ deleted: true, revoked: 0, revokeFailed: true })
      expect(kinds(log)).toContain('service deleteUser auth-a')
    }
  })

  it('says no revoke failed when there was no grant to revoke — the state the count alone could not tell apart', async () => {
    const { handle } = harness(script({ pending: [{ id: 'member-p2' }], tokens: { 'member-p2': [] } }), { googleOk: false })
    await expect((await handle(post())).json()).resolves.toMatchObject({ revoked: 0, revokeFailed: false })
  })

  it('reports a sign-in it could not delete as a failure, because nothing has changed', async () => {
    const { handle } = harness(script({ deleteError: { message: 'auth down' } }))
    const res = await handle(post())
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Could not delete your sign-in: auth down' })
  })

  it('says nothing that names a token, a household or another person', async () => {
    const { handle } = harness(script(PENDING))
    const body = await (await handle(post())).text()
    expect(body).not.toContain('token-1')
    expect(body).not.toContain('member-p')
    expect(body).not.toContain('auth-a')
  })
})
