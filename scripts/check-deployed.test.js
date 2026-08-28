import { describe, expect, it } from 'vitest'

import { FUNCTION_NAMES } from './deploy-function.mjs'
import {
  deploymentVerdict,
  functionsToCheck,
  functionsUrl,
  listDeployedFunctions,
  parseDeployTime,
  sourceCommitTime,
} from './check-deployed.mjs'

// The pure half of `npm run check:deployed` — #222.
//
// The impure half (the real fetch, the real `git log`) is exercised by running
// the command; what is tested here is the part whose failure is silent — the
// verdict, and every branch where an absent answer could read as a clean one.

describe('the function list comes from deploy-function.mjs — AC 2', () => {
  it('checks exactly the functions the deploy script deploys', () => {
    // The seam `probeTables()` established: the test asserts what the COMMAND
    // works from. Rewriting `functionsToCheck` as a hand-written list goes red
    // the day `FUNCTION_NAMES` gains a third entry — which is the scenario the
    // AC names. (A hand-copy of today's full list survives this until then;
    // the import in check-deployed.mjs is what makes that a non-event.)
    expect(functionsToCheck()).toEqual([...FUNCTION_NAMES])
  })

  it('POSITIVE CONTROL: the list is not empty, so the check cannot pass vacuously', () => {
    expect(functionsToCheck().length).toBeGreaterThan(0)
  })
})

describe('the endpoint', () => {
  it('is the Management API functions listing for the derived ref', () => {
    expect(functionsUrl('abcdefghijklmnop')).toBe(
      'https://api.supabase.com/v1/projects/abcdefghijklmnop/functions',
    )
  })
})

describe('an absent answer never reads as a clean one', () => {
  const ok = (body) => async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  })

  it('POSITIVE CONTROL: a real listing comes back as rows', async () => {
    const result = await listDeployedFunctions({
      ref: 'x',
      token: 't',
      fetchImpl: ok([{ slug: 'provision-member', version: 6, updated_at: 1787802091238 }]),
    })
    expect(result.ok).toBe(true)
    expect(result.functions).toHaveLength(1)
  })

  it('an HTTP failure is a reported failure, not an empty deployment', async () => {
    const result = await listDeployedFunctions({
      ref: 'x',
      token: 't',
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"message":"no"}' }),
    })
    expect(result.ok).toBe(false)
    expect(result.functions).toBeNull()
    expect(result.error).toContain('401')
  })

  it('a request that never completes is a reported failure', async () => {
    const result = await listDeployedFunctions({
      ref: 'x',
      token: 't',
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
    })
    expect(result.ok).toBe(false)
    expect(result.functions).toBeNull()
    expect(result.error).toContain('never completed')
  })

  it('a 200 whose body is not a list is REFUSED, never read as "nothing deployed"', async () => {
    const result = await listDeployedFunctions({
      ref: 'x',
      token: 't',
      fetchImpl: ok({ message: 'shaped like an object' }),
    })
    expect(result.ok).toBe(false)
    expect(result.functions).toBeNull()
  })
})

describe('timestamps refuse to guess — an unreadable value is not a verdict', () => {
  it('POSITIVE CONTROL: the epoch-ms number the API really returns parses', () => {
    expect(parseDeployTime(1787802091238)).toBe(1787802091238)
    expect(parseDeployTime('1787802091238')).toBe(1787802091238)
  })

  it.each([[undefined], [null], [''], ['not a time'], [0], [-5]])(
    'refuses %j rather than defaulting to either side',
    (value) => {
      expect(() => parseDeployTime(value)).toThrow(/unreadable|refus/i)
    },
  )

  it('a git answer with no commit in it throws rather than reading as "old"', () => {
    expect(() => sourceCommitTime('provision-member', () => '')).toThrow(/no commit/i)
  })

  it('a parseable git answer becomes epoch ms', () => {
    const { iso, ms } = sourceCommitTime('provision-member', () => '2026-08-27T01:50:54Z\n')
    expect(iso).toBe('2026-08-27T01:50:54Z')
    expect(ms).toBe(Date.parse('2026-08-27T01:50:54Z'))
  })
})

describe('the verdict — AC 1, AC 3, AC 4', () => {
  const sourceMs = Date.parse('2026-08-27T01:50:54Z')

  it('POSITIVE CONTROL: a deploy newer than the source is current — AC 4', () => {
    const verdict = deploymentVerdict(
      'provision-member',
      { slug: 'provision-member', updated_at: sourceMs + 60_000 },
      sourceMs,
    )
    expect(verdict.stale).toBe(false)
  })

  it('a deploy older than the source is STALE', () => {
    const verdict = deploymentVerdict(
      'provision-member',
      { slug: 'provision-member', updated_at: sourceMs - 60_000 },
      sourceMs,
    )
    expect(verdict.stale).toBe(true)
    expect(verdict.reason).toContain('predates')
  })

  it('BOUNDARY: an equal timestamp is not "predates", so it passes', () => {
    // The value and the comparison are two mutations, not one — a `<` that
    // becomes `<=` moves only this test.
    const verdict = deploymentVerdict(
      'provision-member',
      { slug: 'provision-member', updated_at: sourceMs },
      sourceMs,
    )
    expect(verdict.stale).toBe(false)
  })

  it('a function the platform has no record of is STALE, loudly, not an error', () => {
    const verdict = deploymentVerdict('provision-member', undefined, sourceMs)
    expect(verdict.stale).toBe(true)
    expect(verdict.reason).toContain('never deployed')
  })
})
