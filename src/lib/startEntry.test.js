import { describe, expect, it } from 'vitest'
import { START_FLAG, readStartFlag, withoutStartFlag } from './startEntry.js'

// #343 — the website's `?start` link: one reader, one strip, and the rule that
// everything else on the URL is somebody else's and comes through untouched.

describe('#343 — reading the website’s start flag off the query', () => {
  it('the flag is named `start`, and that is the value the website links to', () => {
    // The runbook records `/?start` as THE URL. A rename here without a rename
    // there breaks every link already published, silently — the app would
    // simply open on sign-in.
    expect(START_FLAG).toBe('start')
  })

  it('is present as a bare flag, with an empty value, or with any value', () => {
    expect(readStartFlag('?start')).toBe(true)
    expect(readStartFlag('?start=')).toBe(true)
    expect(readStartFlag('?start=1')).toBe(true)
    expect(readStartFlag('?utm_source=site&start')).toBe(true)
  })

  it('is absent from the ordinary root, and from the other readers’ URLs', () => {
    expect(readStartFlag('')).toBe(false)
    expect(readStartFlag(undefined)).toBe(false)
    expect(readStartFlag(null)).toBe(false)
    // The calendar's return and GoTrue's bad-flow-state return, neither of
    // which is this flag.
    expect(readStartFlag('?code=abc&state=xyz')).toBe(false)
    expect(readStartFlag('?error=invalid_request&error_code=bad_oauth_state')).toBe(false)
  })

  it('does not match a parameter that merely begins with the word', () => {
    // `has()` is exact. A `?started=` or `?start_at=` is nobody's and must not
    // open the account card.
    expect(readStartFlag('?started=1')).toBe(false)
    expect(readStartFlag('?start_at=2026')).toBe(false)
  })
})

describe('#343 — stripping the flag and nothing else', () => {
  it('a lone flag leaves an empty query, so the caller appends nothing', () => {
    expect(withoutStartFlag('?start')).toBe('')
    expect(withoutStartFlag('?start=1')).toBe('')
  })

  it('keeps the calendar’s `?code=&state=` for the read that follows, in order', () => {
    // AC 4's second shape. `readConsentReturn` runs AFTER the strip and must
    // find exactly what Google sent.
    expect(withoutStartFlag('?start&code=the-code&state=the-state')).toBe(
      '?code=the-code&state=the-state',
    )
    expect(withoutStartFlag('?code=the-code&start&state=the-state')).toBe(
      '?code=the-code&state=the-state',
    )
  })

  it('keeps GoTrue’s bad-flow-state return for the sign-in reader', () => {
    expect(withoutStartFlag('?start&error=invalid_request&error_code=bad_oauth_state')).toBe(
      '?error=invalid_request&error_code=bad_oauth_state',
    )
  })

  it('is the identity on a query with no flag', () => {
    expect(withoutStartFlag('')).toBe('')
    expect(withoutStartFlag(undefined)).toBe('')
    expect(withoutStartFlag('?code=abc&state=xyz')).toBe('?code=abc&state=xyz')
  })
})
