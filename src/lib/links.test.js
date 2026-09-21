import { describe, expect, it } from 'vitest'
import { PRIVACY_URL } from './links.js'

describe('published links (#451)', () => {
  it('names the privacy policy as an absolute https URL', () => {
    const url = new URL(PRIVACY_URL)
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe('madcowhq.com')
    expect(url.pathname).toBe('/apps/taskr/privacy')
  })

  it('is the exact address madcowsailing.com #66 published', () => {
    // Pinned as a literal ON PURPOSE, and it is the only place one appears.
    // App.test.jsx asserts the footer renders whatever this constant says —
    // the right question for it, but it moves WITH the constant, so a silent
    // edit to some other page would redden nothing there. Measured on #451:
    // changing the host reddened 1 of 578, and that 1 was this file.
    expect(PRIVACY_URL).toBe('https://madcowhq.com/apps/taskr/privacy')
  })

  it('points at the page itself rather than its redirect', () => {
    // `…/privacy.html` answers by redirecting here (measured on #451). Linking
    // the destination is the owner's call; this asserts the choice so a later
    // edit back to the `.html` form is a deliberate one and not a drift.
    expect(PRIVACY_URL.endsWith('.html')).toBe(false)
  })
})
