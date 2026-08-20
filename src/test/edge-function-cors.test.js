import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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

const SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/functions/provision-member/index.ts'),
  'utf8',
)

/** The `const CORS = { ... }` literal alone, so prose elsewhere cannot read as config. */
function corsBlock() {
  const start = SOURCE.indexOf('const CORS = {')
  expect(start, 'no `const CORS = {` in the Edge Function').toBeGreaterThan(-1)
  // No nested braces live inside the CORS literal, so the first closing brace
  // after it is its own.
  const end = SOURCE.indexOf('}', start)
  expect(end, 'the CORS literal is not closed').toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

function headerList(value) {
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

/** The values of one declared CORS key, lowercased and split. */
function declared(name) {
  const pattern = new RegExp("'" + name + "':[^']*'([^']*)'")
  const match = corsBlock().match(pattern)
  return match ? headerList(match[1]) : []
}

describe('the Edge Function answers a browser preflight from supabase-js', () => {
  const sdkHeaders = headerList(corsHeaders['Access-Control-Allow-Headers'])

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
