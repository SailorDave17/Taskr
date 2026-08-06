import { describe, expect, it } from 'vitest'

import { getSupabase, hasSupabaseConfig } from './supabase.js'

// This suite runs with no VITE_SUPABASE_* variables set, which is the state of a
// fresh checkout and of CI. That is deliberately the case under test: the
// decision being guarded is that an unconfigured build fails *at the point of
// asking*, with a message naming what is missing, rather than handing back a
// client built from `undefined` that dies later at a call site with a network
// error reading like the database is down.

describe('supabase client wiring, unconfigured', () => {
  it('reports that there is no backend rather than pretending there is', () => {
    expect(hasSupabaseConfig).toBe(false)
  })

  it('throws OUR error, not the library’s, when asked for a client', () => {
    // A bare `.toThrow()` here was useless and mutation proved it: deleting the
    // guard entirely still throws, because createClient(undefined, undefined)
    // raises `supabaseUrl is required`. The test passed for the wrong reason and
    // was the one assertion that could not detect the guard being removed.
    // Matching our own wording is what makes it a guard rather than a
    // restatement of "something went wrong".
    expect(() => getSupabase()).toThrow(/Supabase is not configured/)
  })

  it('names both variables, so the message is actionable without reading the source', () => {
    // Named literally rather than interpolated from the module: an expected value
    // computed from the code under test compares it against itself and passes
    // whatever either of them says.
    expect(() => getSupabase()).toThrow(/VITE_SUPABASE_URL/)
    expect(() => getSupabase()).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('says where they go, since the two locations differ and one is gitignored', () => {
    expect(() => getSupabase()).toThrow(/\.env\.local/)
  })

  it('warns that the values are inlined at build time', () => {
    // The trap recorded in docs/deploy-runbook.md: setting a VITE_ variable does
    // nothing to an already-built deployment or a running dev server, and the
    // resulting failure looks like the value being absent rather than stale.
    expect(() => getSupabase()).toThrow(/BUILD time/i)
  })
})
