// @vitest-environment node
//
// #430 — the Vercel cron's endpoint, with no network. What it cannot see:
// whether Vercel actually sends the cron (only a production run shows that),
// and whether the Edge Function purges correctly (its own handler.test.js and
// householdDeletion.pglite.test.js).

import { describe, expect, it, vi } from 'vitest'
import { createPurgeProxy, sameSecret } from './purge.js'

const ENV = {
  CRON_SECRET: 'cron-secret-placeholder-0123456789',
  PURGE_FUNCTION_URL: 'https://placeholder.supabase.co/functions/v1/purge-deleted-households',
  PURGE_SHARED_SECRET: 'purge-secret-placeholder-0123456789',
}

const cronRequest = (authorization = `Bearer ${ENV.CRON_SECRET}`) =>
  new Request('https://placeholder.vercel.app/api/purge', {
    headers: authorization === null ? {} : { authorization },
  })

function proxy({ env = ENV, answer = () => new Response('{"due":0}', { status: 200 }) } = {}) {
  const fetch = vi.fn(async (...args) => answer(...args))
  return { GET: createPurgeProxy({ env, fetch }), fetch }
}

describe('the purge endpoint the cron calls (#430)', () => {
  it('refuses any caller without the cron secret, and calls nothing', async () => {
    for (const authorization of [null, '', 'Bearer wrong', ENV.CRON_SECRET, `Bearer ${ENV.CRON_SECRET}x`]) {
      const { GET, fetch } = proxy()
      const response = await GET(cronRequest(authorization))
      expect(response.status, String(authorization)).toBe(401)
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('refuses when CRON_SECRET is unset, rather than admitting everyone', async () => {
    const { GET, fetch } = proxy({ env: { ...ENV, CRON_SECRET: undefined } })
    expect((await GET(cronRequest('Bearer undefined'))).status).toBe(401)
    expect((await GET(cronRequest('Bearer '))).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says it is not configured when the purge URL or secret is missing', async () => {
    for (const missing of ['PURGE_FUNCTION_URL', 'PURGE_SHARED_SECRET']) {
      const { GET, fetch } = proxy({ env: { ...ENV, [missing]: undefined } })
      expect((await GET(cronRequest())).status, missing).toBe(500)
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('calls the purge function once, by POST, with the purge secret and no Supabase key', async () => {
    const { GET, fetch } = proxy()
    const response = await GET(cronRequest())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"due":0}')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(ENV.PURGE_FUNCTION_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'x-purge-secret': ENV.PURGE_SHARED_SECRET })
  })

  it('answers 502 when the purge fails or cannot be reached, so the hour-long log shows it', async () => {
    const failing = proxy({ answer: () => new Response('{"failures":1}', { status: 500 }) })
    expect((await failing.GET(cronRequest())).status).toBe(502)
    const unreachable = proxy({
      answer: () => {
        throw new Error('network down')
      },
    })
    expect((await unreachable.GET(cronRequest())).status).toBe(502)
  })

  it('compares secrets exactly', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abd', 'abc')).toBe(false)
    expect(sameSecret('ab', 'abc')).toBe(false)
  })
})
