// @vitest-environment node
//
// #431 — the leave function's decisions, with no network and no Supabase.
//
// Two fake clients — the caller's and the service role's — record every call in
// one log, tagged by role, because the subjects are ORDER (the grant is revoked
// before the leave's cascade takes the token, the login goes last) and WHOSE
// POWER each step uses (the leave is the caller's own RPC; only the token read
// and the account deletion are service_role's).
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//   - what `leave_household`, `transfer_household` and `member_tokens_to_revoke`
//     do in SQL: src/test/leaveHousehold.pglite.test.js, against a real Postgres;
//   - whether the function is deployed: the deploy checks.
//
// Values are synthetic and lower-case — see #19.

import { describe, expect, it, vi } from 'vitest'
import { ACCOUNT_NOT_DELETED, CORS, createHandler } from './handler.ts'
import { GOOGLE_REVOKE_ENDPOINT } from '../calendar-disconnect/handler.ts'

const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-placeholder',
}

/** The script a test overrides: the caller, their member row, and every answer. */
function script(overrides = {}) {
  return {
    user: { id: 'auth-a' },
    member: { id: 'member-a', household_id: 'household-1' },
    organizes: false,
    tokens: [{ refresh_token: 'token-1' }],
    tokenError: null,
    leaveError: null,
    others: [],
    othersError: null,
    deleteError: null,
    ...overrides,
  }
}

function fakes(s, log) {
  const select = (role, table) => {
    const filters = []
    const run = () => {
      log.push([role, 'select', table, filters.map(([c, v]) => `${c}=${v}`).join(' ')])
      if (role === 'caller' && table === 'members') {
        const mine = filters.some(([c, v]) => c === 'claimed_by' && v === s.user?.id)
        return { data: mine ? s.member : null, error: null }
      }
      if (role === 'service' && table === 'members') return { data: s.others, error: s.othersError }
      throw new Error(`unexpected ${role} read of ${table}`)
    }
    const builder = {
      eq: (column, value) => (filters.push([column, value]), builder),
      limit: () => Promise.resolve(run()),
      maybeSingle: () => Promise.resolve(run()),
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
      if (fn === 'is_household_organizer') return { data: s.organizes, error: null }
      if (fn === 'member_tokens_to_revoke') return { data: s.tokenError ? null : s.tokens, error: s.tokenError }
      if (fn === 'leave_household') return { data: s.leaveError ? null : true, error: s.leaveError }
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

const post = (body = { householdId: 'household-1' }, bearer = true) =>
  new Request('https://placeholder.supabase.co/functions/v1/leave-household', {
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

describe('who may call leave-household (#431)', () => {
  it('answers a preflight with the CORS headers every function carries', async () => {
    const { handle } = harness()
    const response = await handle(new Request('https://x/', { method: 'OPTIONS' }))
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(CORS['Access-Control-Allow-Headers'])
  })

  it('refuses anything but POST, a missing sign-in, and a body that names no household', async () => {
    expect((await harness().handle(new Request('https://x/', { method: 'GET' }))).status).toBe(405)
    expect((await harness().handle(post(undefined, false))).status).toBe(401)
    expect((await harness().handle(post(null))).status).toBe(400)
    expect((await harness().handle(post({}))).status).toBe(400)
  })

  it('refuses when not configured, before any client exists', async () => {
    const { handle, createClient } = harness(script(), { env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined } })
    expect((await handle(post())).status).toBe(500)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('refuses a token that names nobody, and touches nothing', async () => {
    const { handle, log } = harness(script({ user: null }))
    expect((await handle(post())).status).toBe(401)
    expect(log).toEqual([])
  })

  it('refuses somebody who is not in that household, and touches nothing else', async () => {
    const { handle, log } = harness(script({ member: null }))
    expect((await handle(post())).status).toBe(403)
    expect(kinds(log)).toEqual(['caller select members claimed_by=auth-a household_id=household-1'])
  })

  it('takes WHO is leaving from the sign-in, never from the body', async () => {
    const { handle, log } = harness()
    await handle(post({ householdId: 'household-1', memberId: 'member-b', userId: 'auth-b' }))
    const read = log.find(([role, kind, table]) => role === 'caller' && kind === 'select' && table === 'members')
    expect(read[3]).toBe('claimed_by=auth-a household_id=household-1')
    expect(log.some(([, , a, b]) => a === 'auth-b' || b === 'auth-b')).toBe(false)
  })

  it('refuses the organizer before revoking anything — they hand it over or delete it first', async () => {
    const { handle, log } = harness(script({ organizes: true }))
    const response = await handle(post())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/hand the household over or delete it first/i)
    expect(log.some(([role]) => role === 'service' || role === 'google')).toBe(false)
  })
})

describe('what leaving does, in what order (#431)', () => {
  it('revokes the grant, THEN leaves as the caller, THEN deletes the login that claims nothing else', async () => {
    const { handle, log } = harness()
    const response = await handle(post())
    expect(response.status).toBe(200)
    expect(kinds(log)).toEqual([
      'caller select members claimed_by=auth-a household_id=household-1',
      'caller rpc is_household_organizer',
      'service rpc member_tokens_to_revoke',
      'google revoke token-1',
      'caller rpc leave_household',
      'service select members claimed_by=auth-a',
      'service deleteUser auth-a',
    ])
    expect(log.find(([, kind]) => kind === 'revoke')[2]).toBe(GOOGLE_REVOKE_ENDPOINT)
    expect(await response.json()).toEqual({ ok: true, left: true, revoked: 1, accountDeleted: true })
  })

  it('asks about the tokens of the leaver\'s own member row, and leaves the household the body named', async () => {
    const { handle, log } = harness()
    await handle(post())
    expect(log.find(([, , fn]) => fn === 'member_tokens_to_revoke')[3]).toEqual({ member_id: 'member-a' })
    expect(log.find(([, , fn]) => fn === 'leave_household')[3]).toEqual({ household_id: 'household-1' })
  })

  it('changes nothing when the grants cannot be read, so none is left live at Google', async () => {
    const { handle, log } = harness(script({ tokenError: { message: 'read failed' } }))
    const response = await handle(post())
    expect(response.status).toBe(503)
    // Named exactly: a pattern like /revoke/ also matches `member_tokens_to_revoke`,
    // the one read that SHOULD happen — it failed this test on its first run.
    const forbidden = (k) => k === 'caller rpc leave_household' || k.startsWith('google revoke') || k.includes('deleteUser')
    expect(kinds(log).filter(forbidden)).toEqual([])
    expect(kinds(log)).toContain('service rpc member_tokens_to_revoke')
  })

  it('still leaves when Google refuses or cannot be reached — a refused revoke is usually a grant already gone', async () => {
    for (const googleOk of [false, 'throw']) {
      const { handle } = harness(script(), { googleOk })
      const body = await (await handle(post())).json()
      expect(body, String(googleOk)).toMatchObject({ left: true, revoked: 0, accountDeleted: true })
    }
  })

  it('keeps a login that still claims another household (#262)', async () => {
    const { handle, log } = harness(script({ others: [{ id: 'member-elsewhere' }] }))
    const body = await (await handle(post())).json()
    expect(body).toMatchObject({ left: true, accountDeleted: false, kept: 'claimed-elsewhere' })
    expect(log.some(([, kind]) => kind === 'deleteUser')).toBe(false)
  })

  it('reports a login it could not delete as a warning, because the person HAS left', async () => {
    const { handle } = harness(script({ deleteError: { message: 'auth down' } }))
    const response = await handle(post())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ left: true, accountDeleted: false, warning: ACCOUNT_NOT_DELETED })
  })

  it('reports the same warning when it cannot tell whether the login is used elsewhere, and deletes nothing', async () => {
    const { handle, log } = harness(script({ othersError: { message: 'read failed' } }))
    const body = await (await handle(post())).json()
    expect(body).toMatchObject({ left: true, accountDeleted: false, warning: ACCOUNT_NOT_DELETED })
    expect(log.some(([, kind]) => kind === 'deleteUser')).toBe(false)
  })

  it('deletes no login when the leave itself is refused', async () => {
    const { handle, log } = harness(script({ leaveError: { message: 'you are not a member of that household' } }))
    expect((await handle(post())).status).toBe(400)
    expect(log.some(([, kind]) => kind === 'deleteUser')).toBe(false)
  })

  it('says nothing that names a token or another person', async () => {
    const { handle } = harness(script({ tokens: [{ refresh_token: 'token-1' }, { refresh_token: 'token-2' }] }))
    const body = await (await handle(post())).json()
    expect(body.revoked).toBe(2)
    expect(JSON.stringify(body)).not.toMatch(/token-|member-|auth-/)
  })
})
