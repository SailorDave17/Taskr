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
//
// #562 moved the literal to `_shared/http.ts`, so the question split in two:
// is the ONE list right (checked once, below), and does every function answer
// with it (checked per directory, by its import). A directory whose name starts
// with `_` is Supabase's convention for code that is not a function, and is
// excluded here by that rule rather than by name — with a control that the
// shared directory exists, so the exclusion cannot quietly swallow everything.
const FUNCTIONS_DIR = resolve(process.cwd(), 'supabase/functions')
const DIRECTORIES = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const FUNCTION_NAMES = DIRECTORIES.filter((name) => !name.startsWith('_'))
const SHARED_HTTP = 'supabase/functions/_shared/http.ts'

function headerList(value) {
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

/** The `const CORS = { ... }` literal alone, so prose elsewhere cannot read as config. */
function corsBlock(source) {
  const start = source.indexOf('const CORS = {')
  expect(start, 'no `const CORS = {` in the shared module').toBeGreaterThan(-1)
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

  it('excludes the shared directory and nothing else — #562', () => {
    // The `_` rule removes exactly one directory today. If it removed a real
    // function, that function's preflight would go unchecked, so the excluded
    // set is pinned rather than trusted.
    expect(DIRECTORIES.filter((name) => name.startsWith('_'))).toEqual(['_shared'])
  })
})

describe('the one CORS list (`_shared/http.ts`) answers a browser preflight from supabase-js', () => {
  const sdkHeaders = headerList(corsHeaders['Access-Control-Allow-Headers'])
  const SOURCE = readFileSync(resolve(process.cwd(), SHARED_HTTP), 'utf8')
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

// Every function answers with THAT list — #562.
//
// The list above being right says nothing about a function that stopped using
// it. So each directory is held to importing `CORS` from the shared module, and
// to declaring no literal of its own in either file: a local copy is exactly
// how nine lists stayed in step only by luck. `gate.test.js` refuses a local
// `const CORS =` in any handler too; this check is the one that also sees
// `index.ts` and asserts the import is actually there.
const SHARED_CORS_IMPORT = /import\s*\{[^}]*\bCORS\b[^}]*\}\s*from\s*'\.\.\/_shared\/http\.ts'/
/** Comments blanked, so a sentence ABOUT the old literal cannot read as one. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')

describe.each(FUNCTION_NAMES)('%s answers with the shared CORS list', (name) => {
  const read = (file) => {
    try {
      return readFileSync(resolve(FUNCTIONS_DIR, name, file), 'utf8')
    } catch {
      return ''
    }
  }
  const handler = read('handler.ts')

  it('POSITIVE CONTROL: the handler is there to read', () => {
    // An absent file reads as "declares no literal" below, which is a pass that
    // proves nothing.
    expect(handler.length).toBeGreaterThan(500)
  })

  it('imports CORS from _shared/http.ts', () => {
    expect(handler).toMatch(SHARED_CORS_IMPORT)
  })

  it('declares no CORS literal of its own, in handler.ts or index.ts', () => {
    const code = stripComments(handler + '\n' + read('index.ts'))
    expect(code).not.toMatch(/\bCORS\s*=\s*\{/)
  })
})
