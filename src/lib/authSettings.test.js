import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetGoogleSignIn, readGoogleSignIn } from './authSettings.js'

// #339 — the read that decides whether Continue with Google is offered. The
// transport is injected, so nothing here reaches the network; the endpoint is
// injected too, because supabase.js reads its values at import time.

const REQUEST = {
  url: 'https://project-ref.supabase.co/auth/v1/settings',
  headers: { apikey: 'placeholder-anon-key' },
}
const request = () => REQUEST

/** A fetch answering 200 with `body`. */
const answering = (body) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))

beforeEach(() => {
  forgetGoogleSignIn()
})

describe('#339 — readGoogleSignIn', () => {
  it('reads `external.google: true` as on', async () => {
    const fetchImpl = answering({ external: { email: true, google: true } })
    await expect(readGoogleSignIn({ fetchImpl, request })).resolves.toBe(true)
  })

  it('reads `external.google: false` as off — the live project on 2026-09-04', async () => {
    const fetchImpl = answering({ external: { email: true, google: false } })
    await expect(readGoogleSignIn({ fetchImpl, request })).resolves.toBe(false)
  })

  it('asks the public settings endpoint with the anon key, and nothing else', async () => {
    const fetchImpl = answering({ external: { google: true } })
    await readGoogleSignIn({ fetchImpl, request })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(REQUEST.url, { headers: REQUEST.headers })
  })

  describe('AC 1: a read that produces no answer is unknown, never off', () => {
    it.each([
      ['the network refuses', () => vi.fn(async () => { throw new TypeError('Failed to fetch') })],
      // The body would read as OFF if the status were ignored — so this case
      // proves the status check, not the parser.
      ['the endpoint answers non-2xx', () => vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ external: { google: false } }) }))],
      ['the body is not JSON', () => vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad') } }))],
      ['the body has no `external`', () => answering({ disable_signup: false })],
      ['`external.google` is missing', () => answering({ external: { email: true } })],
      ['`external.google` is not a boolean', () => answering({ external: { google: 'false' } })],
    ])('%s → null', async (_label, make) => {
      await expect(readGoogleSignIn({ fetchImpl: make(), request })).resolves.toBeNull()
    })

    it('no backend configured → null, and no request is made', async () => {
      const fetchImpl = answering({ external: { google: false } })
      await expect(readGoogleSignIn({ fetchImpl, request: () => null })).resolves.toBeNull()
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })

  it('AC 1: reads once per page — later calls get the first answer', async () => {
    const fetchImpl = answering({ external: { google: false } })
    const later = answering({ external: { google: true } })
    await expect(readGoogleSignIn({ fetchImpl, request })).resolves.toBe(false)
    await expect(readGoogleSignIn({ fetchImpl: later, request })).resolves.toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()
  })

  it('a failed read is cached too — the control stays, and nobody re-asks', async () => {
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const later = answering({ external: { google: false } })
    await expect(readGoogleSignIn({ fetchImpl: failing, request })).resolves.toBeNull()
    await expect(readGoogleSignIn({ fetchImpl: later, request })).resolves.toBeNull()
    expect(later).not.toHaveBeenCalled()
  })
})
