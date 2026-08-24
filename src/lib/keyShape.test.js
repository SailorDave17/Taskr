import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPublishableKey, isSecretKey, jwtRole, secretKeyKind } from './keyShape.js'

// The guard added after 2026-08-05's incident: a `sb_secret_…` key sitting in
// VITE_SUPABASE_ANON_KEY, inlined into a public bundle, bypassing every RLS
// policy while the app worked perfectly.
//
// Every key below is synthetic and signed by nobody. The payloads are real
// base64 so the decoder is genuinely exercised — a fixture that cannot be
// decoded would let a broken decoder pass.

/** Build a JWT-shaped string with the given role claim. Signature is nonsense. */
function jwtWithRole(role) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.not-a-real-signature`
}

describe('reading a legacy key’s role claim', () => {
  it('reads anon', () => {
    expect(jwtRole(jwtWithRole('anon'))).toBe('anon')
  })

  it('reads service_role', () => {
    expect(jwtRole(jwtWithRole('service_role'))).toBe('service_role')
  })

  it('is null for something that is not a JWT at all', () => {
    expect(jwtRole('sb_publishable_abc123')).toBeNull()
    expect(jwtRole('')).toBeNull()
    expect(jwtRole(undefined)).toBeNull()
  })

  it('is null rather than throwing when the payload is not decodable', () => {
    // Three segments, so it looks like a JWT, and the middle is not base64 JSON.
    expect(jwtRole('aaa.!!!not-base64!!!.ccc')).toBeNull()
  })
})

describe('which keys are safe to publish', () => {
  it.each([
    ['sb_publishable_AbCdEf123456', false],
    ['sb_secret_AbCdEf123456', true],
    [jwtWithRole('anon'), false],
    [jwtWithRole('service_role'), true],
  ])('classifies %s as secret=%s', (key, expected) => {
    expect(isSecretKey(key)).toBe(expected)
  })

  // The 2026-08-05 incident's key by SHAPE ONLY — same prefix, same length, and
  // a body that is not anybody's key. Named separately because a regression here
  // has no symptom: the app keeps working.
  //
  // Reconstructing the real value here would put a live credential in git, which
  // is the thing this guard exists to prevent. A fixture does not need to be the
  // secret to test the detector.
  it('catches the shape that actually shipped', () => {
    expect(isSecretKey('sb_secret_0000000000000000000_0000000')).toBe(true)
  })

  // #95 AC 4 — "a test that plants one proves the extended guard can fail".
  //
  // Shapes only, never a real value, for the reason the Supabase case states
  // one block up: reconstructing a live credential here would put it in git,
  // which is the thing the guard exists to prevent. A fixture does not need to
  // be the secret to test the detector.
  //
  // The FIRST of these is the one that would actually happen. A Google console
  // shows the client ID and the client secret on the same screen, a few lines
  // apart, and both get pasted in the same sitting — so `VITE_GOOGLE_CLIENT_ID`
  // holding a `GOCSPX-…` is a plausible slip, and it is one that produces a
  // WORKING build. Nothing else in the pipeline would notice.
  it.each([
    ['GOCSPX-placeholder_client_secret', 'google-client-secret'],
    ['1//0gPlaceholderRefreshTokenValue', 'google-refresh-token'],
    ['ya29.a0Placeholder-access-token', 'google-access-token'],
  ])('plants %s and the guard refuses it as %s', (planted, kind) => {
    expect(isSecretKey(planted)).toBe(true)
    expect(secretKeyKind(planted)).toBe(kind)
    expect(() => assertPublishableKey(planted, 'the production build')).toThrow(/SECRET key/)
  })

  it('does NOT refuse the value that is supposed to be there', () => {
    // The half that makes the block above mean something. A guard that refused
    // the client ID as well would be refusing every correct build, and the
    // pressure would be to delete it rather than to fix it — which is how a
    // guard with no negative control ends up removed instead of narrowed.
    const clientId = '1234567890-placeholder.apps.googleusercontent.com'
    expect(isSecretKey(clientId)).toBe(false)
    expect(secretKeyKind(clientId)).toBeNull()
    expect(() => assertPublishableKey(clientId)).not.toThrow()
  })

  it('sends each kind to the right console, because the remedy is not one sentence', () => {
    // A refusal naming the wrong dashboard sends somebody to rotate nothing,
    // and they come back believing they have. This is why `secretKeyKind` exists
    // at all rather than the boolean alone.
    expect(() => assertPublishableKey('sb_secret_x')).toThrow(/Supabase → Project Settings/)
    expect(() => assertPublishableKey('GOCSPX-x')).toThrow(/Google Cloud console/)
    expect(() => assertPublishableKey('1//x')).toThrow(/myaccount\.google\.com/)
  })

  it('treats an absent key as not-secret, so an unconfigured build is not a security error', () => {
    // "No key" is a different problem with a different message — getSupabase's
    // own guard. Conflating them would send someone to rotate a key that does
    // not exist.
    expect(isSecretKey('')).toBe(false)
    expect(isSecretKey(undefined)).toBe(false)
    expect(isSecretKey(null)).toBe(false)
  })
})

describe('the assertion the build depends on', () => {
  it('says nothing and returns for a publishable key', () => {
    expect(() => assertPublishableKey('sb_publishable_AbCdEf123456')).not.toThrow()
  })

  it('refuses a secret key in our own words, naming rotation', () => {
    // Matched against our wording rather than a bare toThrow(): a bare
    // assertion is satisfied by any throw at all, including one from a library,
    // so it cannot distinguish "the guard fired" from "the code broke".
    expect(() => assertPublishableKey('sb_secret_AbCdEf123456')).toThrow(/SECRET key/)
    expect(() => assertPublishableKey('sb_secret_AbCdEf123456')).toThrow(/rotate it in/i)
  })

  it('names the caller, so the message says which build refused', () => {
    expect(() => assertPublishableKey('sb_secret_x', 'the production build')).toThrow(
      /given to the production build/,
    )
  })
})

describe('the build itself is wired to the guard', () => {
  // The guard is only worth anything if the build calls it. This asserts the
  // wiring, not the logic — the logic is covered above, and a passing detector
  // that nothing invokes is the failure mode this whole file exists against.
  const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')

  it('calls assertPublishableKey at build time', () => {
    expect(config).toMatch(/assertPublishableKey\(\s*process\.env\.VITE_SUPABASE_ANON_KEY/)
  })

  it('#95 AC 4 — and over the Google client id too, which is the second dashboard value', () => {
    // The extended detector is worth nothing over a variable nothing passes to
    // it. This is the wiring half of AC 4: the guard exists AND the build
    // actually asks it about the value that could carry a `GOCSPX-`.
    expect(config).toMatch(/assertPublishableKey\(\s*process\.env\.VITE_GOOGLE_CLIENT_ID/)
  })

  it('asks about EVERY VITE_ variable the build reads, so a third one cannot slip in', () => {
    // The rule rather than the two instances. A `VITE_` variable is inlined into
    // the bundle by definition, so any new one is a new way to publish a secret
    // — and the failure would be silent in exactly the way #95 AC 4 and the
    // 2026-08-05 incident both describe. Deriving the list from the config
    // itself means the next variable is covered by being added, or this reddens.
    const declared = [...config.matchAll(/process\.env\.(VITE_[A-Z0-9_]+)/g)].map((m) => m[1])
    const asserted = [...config.matchAll(/assertPublishableKey\(\s*process\.env\.(VITE_[A-Z0-9_]+)/g)]
      .map((m) => m[1])

    expect(declared.length, 'the scan found no VITE_ variables at all').toBeGreaterThan(1)
    const unchecked = [...new Set(declared)].filter((name) => !asserted.includes(name))
    expect(
      unchecked,
      `these are inlined into the bundle with no key-shape check: ${unchecked.join(', ')}`,
    ).toEqual([])
  })

  it('imports it from the module these tests exercise', () => {
    expect(config).toMatch(/from '\.\/src\/lib\/keyShape\.js'/)
  })
})
