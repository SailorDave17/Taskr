// @vitest-environment node
//
// #430 — the purge function's decisions, with no network and no Supabase.
//
// A fake client that RECORDS every call in order is the instrument, because the
// subject is ORDER: grants revoked before the household is deleted (the cascade
// takes the tokens), and sign-ins deleted only after it, and only where they
// claim nothing else.
//
// WHAT THIS CANNOT SEE, stated rather than left to be discovered:
//   - whether `purge_household` deletes only a due household, and whether no row
//     survives: src/test/householdDeletion.pglite.test.js, against a real Postgres;
//   - whether service_role may call these RPCs: the same file's privilege test;
//   - whether the function is deployed and its secret set: the deploy checks.
//
// Values are synthetic and lower-case — see #19.

import { describe, expect, it, vi } from 'vitest'
import {
  CORS,
  PURGE_SECRET_ENV,
  PURGE_SECRET_HEADER,
  createHandler,
  secretsMatch,
} from './handler.ts'
import { GOOGLE_REVOKE_ENDPOINT } from '../calendar-disconnect/handler.ts'

const SECRET = 'purge-secret-placeholder-0123456789'
const ENV = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-placeholder',
  [PURGE_SECRET_ENV]: SECRET,
}

/**
 * A fake client scripted per test. `script.rpc[fn]` answers an RPC, `script.select`
 * answers a read, `script.deleteUser` answers an account deletion; every call is
 * pushed onto `log` in the order it happens.
 */
function fakeClient(script, log) {
  return {
    rpc: async (fn, args) => {
      log.push(['rpc', fn, args])
      return script.rpc[fn](args)
    },
    from: (table) => ({
      select: () => ({
        eq: (column, value) => {
          const run = () => {
            log.push(['select', table, column, value])
            return Promise.resolve(script.select(table, column, value))
          }
          return { then: (resolve, reject) => run().then(resolve, reject), limit: () => run() }
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: async (id) => {
          log.push(['deleteUser', id])
          return script.deleteUser(id)
        },
      },
    },
  }
}

function harness(script, { env = ENV, googleOk = true } = {}) {
  const log = []
  const createClient = vi.fn(() => fakeClient(script, log))
  const fetch = vi.fn(async (url, init) => {
    log.push(['revoke', url, new URLSearchParams(init.body).get('token')])
    if (googleOk === 'throw') throw new Error('network down')
    return new Response('', { status: googleOk ? 200 : 400 })
  })
  const handle = createHandler({ env: (name) => env[name], createClient, fetch })
  return { handle, log, createClient, fetch }
}

const post = (secret = SECRET) =>
  new Request('https://placeholder.supabase.co/functions/v1/purge-deleted-households', {
    method: 'POST',
    headers: secret === null ? {} : { [PURGE_SECRET_HEADER]: secret },
  })

/** Two due households: the first with two grants and two claimants, one of whom is in another household. */
function twoHouseholds(overrides = {}) {
  return {
    rpc: {
      households_due_for_purge: () => ({
        data: [
          { household_id: 'household-1', claimants: ['auth-a', 'auth-b'] },
          { household_id: 'household-2', claimants: ['auth-c'] },
        ],
        error: null,
      }),
      purge_household: () => ({ data: true, error: null }),
      record_household_purge_run: () => ({ data: null, error: null }),
      ...overrides.rpc,
    },
    select: (table, column, value) => {
      if (overrides.select) {
        const answer = overrides.select(table, column, value)
        if (answer) return answer
      }
      if (table === 'calendar_tokens') {
        return value === 'household-1'
          ? { data: [{ refresh_token: 'token-1' }, { refresh_token: 'token-2' }], error: null }
          : { data: [], error: null }
      }
      if (table === 'members') {
        // auth-b still claims a member in another household; the others claim nothing.
        return { data: value === 'auth-b' ? [{ id: 'member-elsewhere' }] : [], error: null }
      }
      throw new Error(`unexpected read of ${table}`)
    },
    deleteUser: overrides.deleteUser ?? (() => ({ error: null })),
  }
}

describe('who may call the purge (#430)', () => {
  it('answers a preflight with the CORS headers every function carries', async () => {
    const { handle } = harness(twoHouseholds())
    const response = await handle(new Request('https://x/', { method: 'OPTIONS' }))
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(CORS['Access-Control-Allow-Headers'])
  })

  it('refuses anything but POST', async () => {
    const { handle, createClient } = harness(twoHouseholds())
    const response = await handle(new Request('https://x/', { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('refuses a wrong secret and a missing one, before any database client exists', async () => {
    for (const secret of ['wrong', '', null, `${SECRET}x`]) {
      const { handle, createClient } = harness(twoHouseholds())
      const response = await handle(post(secret))
      expect(response.status, String(secret)).toBe(401)
      expect(createClient).not.toHaveBeenCalled()
    }
  })

  it('refuses when the secret is not configured, rather than admitting everyone', async () => {
    const { handle, createClient } = harness(twoHouseholds(), {
      env: { ...ENV, [PURGE_SECRET_ENV]: undefined },
    })
    const response = await handle(post(''))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'This function is not configured.' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('compares secrets exactly: equal, unequal, and unequal lengths', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true)
    expect(secretsMatch(SECRET.replace(/.$/, 'X'), SECRET)).toBe(false)
    expect(secretsMatch(SECRET.slice(0, -1), SECRET)).toBe(false)
    expect(secretsMatch('', SECRET)).toBe(false)
  })
})

describe('what a purge does, in what order (#430)', () => {
  it('revokes each grant, THEN purges, THEN deletes only the sign-ins that claim nothing else', async () => {
    const { handle, log } = harness(twoHouseholds())
    const response = await handle(post())
    expect(response.status).toBe(200)

    const steps = log.map(([kind, a, b]) => {
      if (kind === 'rpc') return `rpc ${a}${b?.household_id ? ` ${b.household_id}` : ''}`
      if (kind === 'revoke') return `revoke ${b}`
      if (kind === 'deleteUser') return `deleteUser ${a}`
      return `select ${a} ${b}`
    })
    expect(steps).toEqual([
      'rpc households_due_for_purge',
      'select calendar_tokens household_id',
      'revoke token-1',
      'revoke token-2',
      'rpc purge_household household-1',
      'select members claimed_by',
      'deleteUser auth-a',
      'select members claimed_by',
      'select calendar_tokens household_id',
      'rpc purge_household household-2',
      'select members claimed_by',
      'deleteUser auth-c',
      'rpc record_household_purge_run',
    ])
    expect(log.filter(([kind]) => kind === 'revoke').every(([, url]) => url === GOOGLE_REVOKE_ENDPOINT)).toBe(true)
  })

  it('records the counts, and says nothing that names a household, a person or a token', async () => {
    const { handle, log } = harness(twoHouseholds())
    const response = await handle(post())
    const body = await response.json()
    expect(body).toEqual({ due: 2, purged: 2, failures: 0, revoked: 2, accountsDeleted: 2, recorded: true })
    const record = log.find(([kind, fn]) => kind === 'rpc' && fn === 'record_household_purge_run')
    expect(record[2]).toEqual({ due: 2, purged: 2, failures: 0 })
    expect(JSON.stringify(body)).not.toMatch(/household-|auth-|token-/)
  })

  it('does not purge a household whose grants could not be read, so none stays live at Google', async () => {
    const { handle, log } = harness(
      twoHouseholds({
        select: (table, _column, value) =>
          table === 'calendar_tokens' && value === 'household-1'
            ? { data: null, error: { message: 'read failed' } }
            : null,
      }),
    )
    const response = await handle(post())
    expect(response.status).toBe(500)
    const purgedIds = log.filter(([kind, fn]) => kind === 'rpc' && fn === 'purge_household').map(([, , args]) => args.household_id)
    expect(purgedIds).toEqual(['household-2'])
    expect(await response.json()).toMatchObject({ purged: 1, failures: 1, recorded: true })
  })

  it('still purges when Google refuses or cannot be reached — a refused revoke is usually a grant already gone', async () => {
    for (const googleOk of [false, 'throw']) {
      const { handle } = harness(twoHouseholds(), { googleOk })
      const body = await (await handle(post())).json()
      expect(body, String(googleOk)).toMatchObject({ purged: 2, revoked: 0, failures: 0 })
    }
  })

  it('deletes no sign-in when the household was already purged by another run', async () => {
    const { handle, log } = harness(
      twoHouseholds({ rpc: { purge_household: () => ({ data: false, error: null }) } }),
    )
    const body = await (await handle(post())).json()
    expect(log.some(([kind]) => kind === 'deleteUser')).toBe(false)
    expect(body).toMatchObject({ purged: 0, accountsDeleted: 0, failures: 0 })
  })

  it('counts a failed account deletion and a failed purge as failures, and answers non-2xx', async () => {
    const { handle } = harness(
      twoHouseholds({
        rpc: {
          purge_household: ({ household_id: id }) =>
            id === 'household-2' ? { data: null, error: { message: 'boom' } } : { data: true, error: null },
        },
        deleteUser: () => ({ error: { message: 'auth down' } }),
      }),
    )
    const response = await handle(post())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ purged: 1, accountsDeleted: 0, failures: 2 })
  })

  it('stops before touching anything when the due list cannot be read', async () => {
    const { handle, log } = harness(
      twoHouseholds({ rpc: { households_due_for_purge: () => ({ data: null, error: { message: 'x' } }) } }),
    )
    const response = await handle(post())
    expect(response.status).toBe(500)
    expect(log).toEqual([['rpc', 'households_due_for_purge', undefined]])
  })

  it('records a run with nothing due, so a quiet day is distinguishable from a stopped purge', async () => {
    const { handle, log } = harness(
      twoHouseholds({ rpc: { households_due_for_purge: () => ({ data: [], error: null }) } }),
    )
    const response = await handle(post())
    expect(response.status).toBe(200)
    const record = log.find(([kind, fn]) => kind === 'rpc' && fn === 'record_household_purge_run')
    expect(record[2]).toEqual({ due: 0, purged: 0, failures: 0 })
  })
})
