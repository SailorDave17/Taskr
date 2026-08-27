import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { corsHeaders } from '@supabase/supabase-js/cors'

// #112 - the Edge Function's CORS allow-list, checked against what the SDK sends.
//
// WHY THIS IS A SEPARATE TEST AND NOT PART OF THE FUNCTION SUITE
//
// `provisioning.functions.test.js` drives the real function over real HTTP and
// still cannot see this defect. It builds its own request with `fetch` from
// Node, where there is no CORS preflight at all - and the headers it happens to
// send are exactly the two the old allow-list permitted. The app does not call
// it that way: it calls `supabase.functions.invoke`, from a browser, which sends
// four non-simple headers and triggers a preflight covering all of them.
//
// So the harness passed while the deployed path was blocked, and the organizer
// got "Failed to send a request to the Edge Function" - a sentence that names no
// header and reads like the network is down. The harness building the call
// instead of using the production path is the whole reason it was blind.
//
// The subject here is SOURCE TEXT, deliberately. The function is a Deno module
// that calls `Deno.serve` at import time, so it cannot be imported here; and
// `gate.test.js` forbids anything under `src/` importing from
// `supabase/functions/`, so reaching for the constant directly would weaken a
// guard that exists to keep the bundler out of that directory. Reading the file
// is the instrument available - and the assertion below is semantic rather than
// a spelling check, because it compares two computed sets and fails when the
// SDK's set grows.

// EVERY function directory, not one named file — #95.
//
// This test was written for `provision-member` and hard-coded its path, which
// made it a check on one function rather than on the repo. The second function
// then arrived with its own hand-written CORS list, in a story whose whole
// subject is a browser calling it, and nothing here would have looked. That is
// the shape `a-guard-stays-where-the-hazard-was` describes: the guard stays
// correct, the hazard moves next door, and no test goes red.
//
// The list is read off the FILESYSTEM rather than from `LIVE_EDGE_FUNCTIONS`,
// deliberately. That constant is derived from the app's `invoke` call sites, so
// a function that is deployed but not yet called from the client would be absent
// from it and unchecked here — and the subject of this file is a source file's
// contents, which is a question about what is in the directory.
const FUNCTIONS_DIR = resolve(process.cwd(), 'supabase/functions')
const FUNCTION_NAMES = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

function headerList(value) {
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

/** The `const CORS = { ... }` literal alone, so prose elsewhere cannot read as config. */
function corsBlock(source) {
  const start = source.indexOf('const CORS = {')
  expect(start, 'no `const CORS = {` in this Edge Function').toBeGreaterThan(-1)
  // No nested braces live inside the CORS literal, so the first closing brace
  // after it is its own.
  const end = source.indexOf('}', start)
  expect(end, 'the CORS literal is not closed').toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The values of one declared CORS key, lowercased and split. */
function declaredIn(source, name) {
  const pattern = new RegExp("'" + name + "':[^']*'([^']*)'")
  const match = corsBlock(source).match(pattern)
  return match ? headerList(match[1]) : []
}

describe('every function directory is actually scanned', () => {
  it('finds more than one, so a hard-coded path cannot have crept back', () => {
    // Without this the whole suite below passes vacuously against an empty
    // directory listing — an absence reading as a clean bill of health, which is
    // the failure this file already guards against one level down.
    expect(FUNCTION_NAMES.length).toBeGreaterThan(1)
    expect(FUNCTION_NAMES).toContain('provision-member')
    expect(FUNCTION_NAMES).toContain('calendar-connect')
  })
})

describe.each(FUNCTION_NAMES)('%s answers a browser preflight from supabase-js', (name) => {
  const sdkHeaders = headerList(corsHeaders['Access-Control-Allow-Headers'])

  // The CORS literal lives in `index.ts` for `provision-member` and in
  // `handler.ts` for `calendar-connect`, whose decisions were split out so they
  // could be unit-tested without a Deno runtime. Both files are read and joined
  // rather than one being guessed at, because which file holds it is a property
  // of how that function is organised and not something this check should have
  // an opinion about.
  const SOURCE = ['index.ts', 'handler.ts']
    .map((file) => {
      try {
        return readFileSync(resolve(FUNCTIONS_DIR, name, file), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')

  const declared = (key) => declaredIn(SOURCE, key)

  it('POSITIVE CONTROL: both sides of the comparison are non-empty', () => {
    // Without this the real assertion below is vacuous in two directions: an SDK
    // that stopped exporting its list, or a regex that stopped matching the
    // source, leaves one set empty - and a subset check against an empty
    // expectation passes while proving nothing. An empty result reads as a clean
    // one, which is the failure this control exists to make impossible.
    expect(sdkHeaders).toContain('authorization')
    expect(sdkHeaders.length).toBeGreaterThan(1)
    expect(declared('Access-Control-Allow-Headers').length).toBeGreaterThan(1)
  })

  it('allows every header supabase-js sends, so the preflight succeeds', () => {
    // `apikey` and `x-client-info` are the two that get missed, and neither is
    // asked for at the call site: the client's fetch wrapper sets `apikey` on
    // every request, and `X-Client-Info` is a default header on every Supabase
    // client. Both reach the preflight without appearing anywhere in this repo's
    // calling code, which is why a list built by reading `household.js` looked
    // complete.
    const allowed = new Set(declared('Access-Control-Allow-Headers'))
    const missing = sdkHeaders.filter((header) => !allowed.has(header))
    expect(
      missing,
      `a browser preflight would be refused over: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('allows the method invoke() actually uses', () => {
    // The preflight carries Access-Control-Request-Method as well, and a list
    // that covers every header but not the verb fails in exactly the same way,
    // with exactly the same message.
    expect(declared('Access-Control-Allow-Methods')).toContain('post')
  })

  it('answers with an allowed origin at all', () => {
    expect(declared('Access-Control-Allow-Origin')).toEqual(['*'])
  })
})
