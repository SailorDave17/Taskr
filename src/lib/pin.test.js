import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, assertPinShape, isValidPin } from './pin.js'

describe('the PIN shape rule', () => {
  it('accepts what a nine-year-old can remember and type', () => {
    expect(isValidPin('4821')).toBe(true)
    expect(isValidPin('482137')).toBe(true)
    expect(isValidPin('a-longer-one')).toBe(true)
  })

  it('rejects anything short enough to guess by hand', () => {
    // There is deliberately no rate limit on claim_member_with_pin, so the
    // length is doing all of the work. 999 tries is an afternoon.
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('')).toBe(false)
    expect(isValidPin(null)).toBe(false)
    expect(isValidPin(undefined)).toBe(false)
  })

  it('rejects one padded out with spaces, since the server trims before measuring', () => {
    // If this disagreed with the server the UI would enable the button and the
    // round trip would fail — the two rules must trim the same way.
    expect(isValidPin('  1  ')).toBe(false)
  })

  it('rejects one longer than the cap', () => {
    expect(isValidPin('x'.repeat(PIN_MAX_LENGTH + 1))).toBe(false)
    expect(isValidPin('x'.repeat(PIN_MAX_LENGTH))).toBe(true)
  })

  it('throws a message naming both bounds, so the fix is obvious without reading the source', () => {
    expect(() => assertPinShape('1')).toThrow(/between 4 and 12/i)
  })

  it('returns the trimmed value, so callers cannot send something the rule did not check', () => {
    expect(assertPinShape('  4821  ')).toBe('4821')
  })
})

describe('the JS rule and the SQL rule are the same rule', () => {
  // pin.js and assert_valid_pin() in migration 0002 are two copies that cannot
  // import each other — one runs in a browser, the other inside Postgres. This
  // repo has shipped the two-copies-of-one-rule defect before (race-timer #89,
  // where the second copy was written INVERTED and nothing noticed), so the pair
  // is pinned by a test instead of by a comment asking people to be careful.
  // Resolved from the project root, not from import.meta.url: under the repo's
  // jsdom environment import.meta.url is not a file: URL, and readFileSync dies
  // with "The URL must be of scheme file" — which collects ZERO tests from this
  // file while the suite still reports a failure elsewhere. A cross-check that
  // silently stops running is worse than not having one.
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '0002_member_pins_and_column_grants.sql'),
    'utf8',
  )

  it('the migration still contains the bounds check this test is about', () => {
    // Asserted separately because the two regexes below would both "pass" by
    // matching nothing if the function were renamed or removed, and a bounds
    // check that has silently vanished is exactly what this file exists to catch.
    expect(sql).toMatch(/create or replace function public\.assert_valid_pin/)
  })

  it('agrees on the minimum', () => {
    const match = sql.match(/length\(trimmed\)\s*<\s*(\d+)/)
    expect(match, 'no minimum-length check found in assert_valid_pin').not.toBeNull()
    expect(Number(match[1])).toBe(PIN_MIN_LENGTH)
  })

  it('agrees on the maximum', () => {
    const match = sql.match(/length\(trimmed\)\s*>\s*(\d+)/)
    expect(match, 'no maximum-length check found in assert_valid_pin').not.toBeNull()
    expect(Number(match[1])).toBe(PIN_MAX_LENGTH)
  })
})
