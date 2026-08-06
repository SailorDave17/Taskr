import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertPublishableKey, isSecretKey, jwtRole } from './keyShape.js'

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

  it('imports it from the module these tests exercise', () => {
    expect(config).toMatch(/from '\.\/src\/lib\/keyShape\.js'/)
  })
})
