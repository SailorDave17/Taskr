import { afterEach, describe, expect, it, vi } from 'vitest'

// WHY THIS FILE STATES ITS ENVIRONMENT INSTEAD OF READING IT.
//
// `supabase.js` reads `import.meta.env` into module-level constants at import
// time, so a statically-imported copy inherits whatever the machine happens to
// have configured. This suite used to do exactly that, and the result was
// backwards: on any machine set up to run `npm run test:rls` — which needs
// `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` — all five
// assertions inverted. Measured 2026-08-06: `npm test` with `.env.local`
// present, 5 failed; with it parked, 5 passed (#32). CI is green either way,
// because CI is defined by those variables being absent, so nothing could ever
// catch it there.
//
// A test that inherits its condition is not testing that condition; it is
// reporting the machine. So every test below stubs the two variables, resets
// the module registry, and imports a fresh copy of the module. That is also
// what makes the CONFIGURED path testable at all — nothing covered it before.

/** Load a fresh `supabase.js` with exactly the environment named here. */
async function loadSupabase({ url, anonKey }) {
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', anonKey)
  // The module caches `url`, `anonKey`, `hasSupabaseConfig` and its client at
  // import time, so without this the stubs return the copy already in the
  // registry and do nothing at all — silently.
  vi.resetModules()
  return import('./supabase.js')
}

const PUBLISHABLE = 'sb_publishable_test_key'
const SECRET = 'sb_secret_test_key'

afterEach(() => {
  // Defensive rather than load-bearing: every test above stubs both variables
  // before importing, so a leak changes no current result. It is here so the
  // next test added without a stub inherits nothing — which is the exact class
  // of bug this file exists to end.
  vi.unstubAllEnvs()
  vi.resetModules()
})

// The state of a fresh checkout and of CI, asserted here whether or not this
// machine is in it. The decision being guarded is that an unconfigured build
// fails *at the point of asking*, with a message naming what is missing, rather
// than handing back a client built from `undefined` that dies later at a call
// site with a network error reading like the database is down.
describe('supabase client wiring, unconfigured', () => {
  const unconfigured = { url: undefined, anonKey: undefined }

  it('reports that there is no backend rather than pretending there is', async () => {
    const { hasSupabaseConfig } = await loadSupabase(unconfigured)
    expect(hasSupabaseConfig).toBe(false)
  })

  it('throws OUR error, not the library’s, when asked for a client', async () => {
    // A bare `.toThrow()` here was useless and mutation proved it: deleting the
    // guard entirely still throws, because createClient(undefined, undefined)
    // raises `supabaseUrl is required`. The test passed for the wrong reason and
    // was the one assertion that could not detect the guard being removed.
    // Matching our own wording is what makes it a guard rather than a
    // restatement of "something went wrong".
    const { getSupabase } = await loadSupabase(unconfigured)
    expect(() => getSupabase()).toThrow(/Supabase is not configured/)
  })

  it('names both variables, so the message is actionable without reading the source', async () => {
    // Named literally rather than interpolated from the module: an expected value
    // computed from the code under test compares it against itself and passes
    // whatever either of them says.
    const { getSupabase } = await loadSupabase(unconfigured)
    expect(() => getSupabase()).toThrow(/VITE_SUPABASE_URL/)
    expect(() => getSupabase()).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('says where they go, since the two locations differ and one is gitignored', async () => {
    const { getSupabase } = await loadSupabase(unconfigured)
    expect(() => getSupabase()).toThrow(/\.env\.local/)
  })

  it('warns that the values are inlined at build time', async () => {
    // The trap recorded in docs/deploy-runbook.md: setting a VITE_ variable does
    // nothing to an already-built deployment or a running dev server, and the
    // resulting failure looks like the value being absent rather than stale.
    const { getSupabase } = await loadSupabase(unconfigured)
    expect(() => getSupabase()).toThrow(/BUILD time/i)
  })

  it('treats half a configuration as no configuration, both ways round', async () => {
    // `Boolean(url && anonKey)` — a URL with no key, or a key with no URL, must
    // not read as configured. Both directions, because one of them is a single
    // character away from passing.
    const urlOnly = await loadSupabase({ url: 'https://example.supabase.co', anonKey: undefined })
    expect(urlOnly.hasSupabaseConfig).toBe(false)

    const keyOnly = await loadSupabase({ url: undefined, anonKey: PUBLISHABLE })
    expect(keyOnly.hasSupabaseConfig).toBe(false)
  })
})

// The other half, and it had no coverage at all until #32 — because the suite
// could only ever observe whichever branch the machine happened to be in.
describe('supabase client wiring, configured', () => {
  // Each test gets its own project ref. The client derives its auth storage key
  // from the ref, and reusing one across module resets makes GoTrue warn about
  // multiple instances on the same key — noise in a suite whose whole point is
  // that people keep reading it.
  const configured = (ref) => ({ url: `https://${ref}.supabase.co`, anonKey: PUBLISHABLE })

  it('reports that there is a backend', async () => {
    const { hasSupabaseConfig } = await loadSupabase(configured('has-config'))
    expect(hasSupabaseConfig).toBe(true)
  })

  it('hands back a usable client rather than throwing', async () => {
    const { getSupabase } = await loadSupabase(configured('usable-client'))
    const client = getSupabase()
    expect(client).toBeTruthy()
    expect(typeof client.from).toBe('function')
    expect(client.auth).toBeTruthy()
  })

  it('returns the same client every time, so one session is not two', async () => {
    // `persistSession` means a second client is a second auth listener on the
    // same storage. The memoisation is load-bearing and was untested.
    const { getSupabase } = await loadSupabase(configured('memoised'))
    expect(getSupabase()).toBe(getSupabase())
  })

  it('refuses a SECRET key even though the build should have caught it first', async () => {
    // Belt to vite.config.js's braces, and until now the belt was never pulled.
    // The build-time check is what stops a secret key reaching a bundle; this
    // one catches a dev server started against a bad `.env.local`, where no
    // build runs at all. See src/lib/keyShape.js and the 2026-08-05 incident.
    const { getSupabase } = await loadSupabase({ url: 'https://secret-key.supabase.co', anonKey: SECRET })
    expect(() => getSupabase()).toThrow(/SECRET key/)
  })
})

// #32 itself, asserted rather than described. Every test above would still pass
// if the module quietly inherited the machine's environment and the stubs did
// nothing — as long as the machine happened to be in the branch that test wants.
// This one cannot: it demands the answer CHANGE three times inside a single
// test, which no ambient value can satisfy. It is what makes `loadSupabase`'s
// `vi.resetModules()` load-bearing; without it this reddens and nothing else
// does. Mutation-checked 2026-08-07.
describe('the suite reads the environment it states, not the machine it runs on', () => {
  it('flips its answer with the stubs, in both directions, within one test', async () => {
    const off = await loadSupabase({ url: undefined, anonKey: undefined })
    expect(off.hasSupabaseConfig).toBe(false)

    const on = await loadSupabase({ url: 'https://flips.supabase.co', anonKey: PUBLISHABLE })
    expect(on.hasSupabaseConfig).toBe(true)

    const offAgain = await loadSupabase({ url: undefined, anonKey: undefined })
    expect(offAgain.hasSupabaseConfig).toBe(false)
  })
})
