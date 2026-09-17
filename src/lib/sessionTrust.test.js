import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UNTRUSTED_KEY,
  isUntrustedSession,
  sessionTrustStorage,
  setSessionTrust,
} from './sessionTrust.js'

// #482 — "Trust this device". Two halves.
//
// The first is the adapter on its own: which store each call reaches.
//
// The second is the one that matters, and it goes through the REAL client:
// `household.js`'s `signIn` / `sessionIsGone` over `supabase.js`'s
// `getSupabase()`, with only `fetch` faked. A hand-built client handed the
// adapter would pass whatever `supabase.js` passed to `createClient` — so
// replacing the adapter there with plain `localStorage` (AC 7) would leave it
// green. Loading the app's own modules fresh is what makes that mutation
// visible, and it is `supabase.test.js`'s pattern for the same reason.

const PUBLISHABLE = 'sb_publishable_test_key'

/** Every key in a store, so a test can say "nothing under `sb-`" without knowing the ref. */
const keysOf = (store) => Array.from({ length: store.length }, (_, i) => store.key(i))
const authKeysIn = (store) => keysOf(store).filter((k) => k.startsWith('sb-'))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('#482 — the storage adapter', () => {
  it('reads and writes localStorage when nothing was chosen — a tab that never saw the box', () => {
    sessionTrustStorage.setItem('sb-x-auth-token', 'v')
    expect(localStorage.getItem('sb-x-auth-token')).toBe('v')
    expect(sessionStorage.getItem('sb-x-auth-token')).toBeNull()
    expect(sessionTrustStorage.getItem('sb-x-auth-token')).toBe('v')
    sessionTrustStorage.removeItem('sb-x-auth-token')
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull()
  })

  it('reads and writes sessionStorage once the sign-in was not trusted', () => {
    setSessionTrust(false)
    expect(isUntrustedSession()).toBe(true)
    sessionTrustStorage.setItem('sb-x-auth-token', 'v')
    expect(sessionStorage.getItem('sb-x-auth-token')).toBe('v')
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull()
    expect(sessionTrustStorage.getItem('sb-x-auth-token')).toBe('v')
  })

  it('an untrusted sign-out leaves a trusted session another tab holds in localStorage', () => {
    // One store per call, never both — removing from localStorage here would
    // end somebody else's session in this browser.
    localStorage.setItem('sb-x-auth-token', 'another tab')
    setSessionTrust(false)
    sessionStorage.setItem('sb-x-auth-token', 'this tab')
    sessionTrustStorage.removeItem('sb-x-auth-token')
    expect(sessionStorage.getItem('sb-x-auth-token')).toBeNull()
    expect(localStorage.getItem('sb-x-auth-token')).toBe('another tab')
  })

  it('trusting clears the flag, so the next sign-in in the tab goes back to localStorage', () => {
    setSessionTrust(false)
    setSessionTrust(true)
    expect(sessionStorage.getItem(UNTRUSTED_KEY)).toBeNull()
    expect(isUntrustedSession()).toBe(false)
  })

  it('the flag is kept in sessionStorage, never localStorage, so it dies with the browser', () => {
    setSessionTrust(false)
    expect(sessionStorage.getItem(UNTRUSTED_KEY)).toBe('1')
    expect(localStorage.getItem(UNTRUSTED_KEY)).toBeNull()
  })

  it('refuses an untrusted sign-in the browser cannot keep to the window, rather than keeping it forever', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('refused', 'QuotaExceededError')
    })
    try {
      expect(() => setSessionTrust(false)).toThrow(/Trust this device/)
    } finally {
      spy.mockRestore()
    }
    expect(isUntrustedSession()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Through the real client
// ---------------------------------------------------------------------------

/** A JWT-shaped access token; auth-js reads it as opaque on these paths. */
function accessToken(sub) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  const exp = Math.round(Date.now() / 1000) + 3600
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, role: 'authenticated' })}.c2ln`
}

const USER = { id: 'person-1', aud: 'authenticated', role: 'authenticated', email: 'kid@example.com' }

/**
 * The two endpoints these paths reach. `atRequest` records whether the flag
 * was already written when the password request went out — AC 2's "written
 * BEFORE `signInWithPassword` is called".
 */
function fakeAuthServer() {
  const seen = []
  const fetch = vi.fn(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    seen.push({ url, untrusted: sessionStorage.getItem(UNTRUSTED_KEY) === '1' })
    const json = (body) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/auth/v1/token?grant_type=password')) {
      return json({
        access_token: accessToken(USER.id),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.round(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-one',
        user: USER,
      })
    }
    if (url.endsWith('/auth/v1/user')) return json(USER)
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  })
  return { fetch, seen }
}

let loaded = []

async function disposeAll() {
  for (const getSupabase of loaded.splice(0)) {
    try {
      await getSupabase().auth.dispose()
    } catch {
      // A client that never finished building has nothing to tear down.
    }
  }
}

/**
 * A fresh boot of the app's data layer: new module instances, so a new auth
 * client that reads storage from scratch — the closest a unit suite gets to
 * reopening the browser. Each test names its own project ref so no two
 * clients share a storage key (GoTrue warns on that).
 */
async function boot(ref) {
  // The page before this one is gone: its client stops, as a closed page's would.
  await disposeAll()
  vi.stubEnv('VITE_SUPABASE_URL', `https://${ref}.supabase.co`)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', PUBLISHABLE)
  vi.resetModules()
  const household = await import('./household.js')
  const { getSupabase } = await import('./supabase.js')
  loaded.push(getSupabase)
  return { ...household, storageKey: `sb-${ref}-auth-token`, getSupabase }
}

describe('#482 — where the real client keeps the session', () => {
  let server

  beforeEach(() => {
    server = fakeAuthServer()
    vi.stubGlobal('fetch', server.fetch)
    loaded = []
  })

  afterEach(async () => {
    await disposeAll()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
    window.history.replaceState(null, '', '/')
  })

  it('AC 1: a sign-in that says nothing keeps the session in localStorage, as it always did', async () => {
    const app = await boot('trust-default')
    await app.signIn({ email: 'kid@example.com', password: '4821' })

    expect(localStorage.getItem(app.storageKey)).toContain('refresh-one')
    expect(authKeysIn(sessionStorage)).toEqual([])
    expect(sessionStorage.getItem(UNTRUSTED_KEY)).toBeNull()
  })

  it('AC 2: unticked, the session is held in sessionStorage only — nothing under `sb-` in localStorage', async () => {
    const app = await boot('trust-off')
    await app.signIn({ email: 'kid@example.com', password: '4821', trusted: false })

    expect(sessionStorage.getItem(app.storageKey)).toContain('refresh-one')
    expect(authKeysIn(localStorage)).toEqual([])
    // Still signed in on this page — the session is somewhere the client reads.
    expect(await app.currentSession()).toMatchObject({ refresh_token: 'refresh-one' })
  })

  it('AC 2: the flag is written before the password request goes out', async () => {
    const app = await boot('trust-order')
    await app.signIn({ email: 'kid@example.com', password: '4821', trusted: false })

    const request = server.seen.find((r) => r.url.includes('grant_type=password'))
    expect(request).toBeTruthy()
    expect(request.untrusted).toBe(true)
  })

  it('AC 2: a trusted sign-in after an untrusted one in the same tab goes back to localStorage', async () => {
    const app = await boot('trust-again')
    await app.signIn({ email: 'kid@example.com', password: '4821', trusted: false })
    await app.signOut()
    expect(authKeysIn(sessionStorage)).toEqual([])

    await app.signIn({ email: 'kid@example.com', password: '4821' })
    expect(localStorage.getItem(app.storageKey)).toContain('refresh-one')
    expect(authKeysIn(sessionStorage)).toEqual([])
  })

  it('a reload keeps an untrusted session — the reason this is an adapter and not `persistSession: false`', async () => {
    const first = await boot('trust-reload')
    await first.signIn({ email: 'kid@example.com', password: '4821', trusted: false })

    // Same tab, new page: sessionStorage survives, the modules do not.
    const reloaded = await boot('trust-reload')
    expect(await reloaded.sessionIsGone()).toBe(false)
    expect(await reloaded.currentSession()).toMatchObject({ refresh_token: 'refresh-one' })
  })

  it('AC 4: after the browser closes, an untrusted sign-in is gone — no `sb-` key anywhere', async () => {
    const first = await boot('trust-closed')
    await first.signIn({ email: 'kid@example.com', password: '4821', trusted: false })

    sessionStorage.clear() // the browser closed: every tab's sessionStorage goes with it
    const reopened = await boot('trust-closed')

    expect(await reopened.sessionIsGone()).toBe(true)
    expect(await reopened.currentSession()).toBeNull()
    expect(authKeysIn(localStorage)).toEqual([])
    expect(authKeysIn(sessionStorage)).toEqual([])
  })

  it('AC 4, the control: a TRUSTED sign-in survives the same close', async () => {
    // Without this, the test above would pass on a client that kept nothing at all.
    const first = await boot('trust-kept')
    await first.signIn({ email: 'kid@example.com', password: '4821' })

    sessionStorage.clear()
    const reopened = await boot('trust-kept')

    expect(await reopened.sessionIsGone()).toBe(false)
    expect(await reopened.currentSession()).toMatchObject({ refresh_token: 'refresh-one' })
  })

  describe('AC 3: the Google return, in the same tab', () => {
    // Supabase sends the person back to the page they left with the session in
    // the FRAGMENT (implicit flow — `household.js`'s `signInWithGoogle` says
    // why), and the client saves it while it initialises on the next boot. The
    // flag `signInWithGoogle({ trusted: false })` wrote before the page left
    // is still in this tab's sessionStorage by then; that is the assumption.
    const returnWithSession = () => {
      const params = new URLSearchParams({
        access_token: accessToken(USER.id),
        expires_in: '3600',
        expires_at: String(Math.round(Date.now() / 1000) + 3600),
        refresh_token: 'refresh-google',
        token_type: 'bearer',
        provider_token: 'provider',
      })
      window.history.replaceState(null, '', `/#${params}`)
    }

    it('unticked: the person is signed in, and the session is in sessionStorage only', async () => {
      setSessionTrust(false) // what signInWithGoogle({ trusted: false }) left behind
      returnWithSession()
      const app = await boot('trust-google-off')

      expect(await app.currentSession()).toMatchObject({ refresh_token: 'refresh-google' })
      expect(sessionStorage.getItem(app.storageKey)).toContain('refresh-google')
      expect(authKeysIn(localStorage)).toEqual([])
      // The client took the tokens off the URL, as it did before #482.
      expect(window.location.hash).toBe('')
    })

    it('ticked: the same return lands in localStorage, as it did before #482', async () => {
      returnWithSession()
      const app = await boot('trust-google-on')

      expect(await app.currentSession()).toMatchObject({ refresh_token: 'refresh-google' })
      expect(localStorage.getItem(app.storageKey)).toContain('refresh-google')
      expect(authKeysIn(sessionStorage)).toEqual([])
    })

    it('unticked, then the browser closes: the Google session is gone too', async () => {
      setSessionTrust(false)
      returnWithSession()
      const first = await boot('trust-google-closed')
      expect(await first.currentSession()).not.toBeNull()

      sessionStorage.clear()
      const reopened = await boot('trust-google-closed')
      expect(await reopened.sessionIsGone()).toBe(true)
      expect(authKeysIn(localStorage)).toEqual([])
    })
  })

  it('AC 5: the chosen household and a held invitation stay in localStorage and are still read', async () => {
    const HOUSEHOLD = '6f1c2f4e-8a3b-4c1d-9e2f-0a1b2c3d4e5f'
    localStorage.setItem('taskr.activeHousehold', HOUSEHOLD)
    localStorage.setItem(
      'taskr.pendingInvitation',
      JSON.stringify({ code: 'k7m3qp4rwn', name: 'Placeholder Three' }),
    )
    const app = await boot('trust-device-state')
    await app.signIn({ email: 'kid@example.com', password: '4821', trusted: false })

    const { readActiveHouseholdChoice } = await import('./activeHousehold.js')
    const { readPendingInvitation } = await import('./pendingInvitation.js')
    expect(readActiveHouseholdChoice()).toBe(HOUSEHOLD)
    expect(readPendingInvitation()).toEqual({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })
    // And neither moved: the flag changes where the SESSION lives, nothing else.
    expect(sessionStorage.getItem('taskr.activeHousehold')).toBeNull()
    expect(sessionStorage.getItem('taskr.pendingInvitation')).toBeNull()
  })
})
