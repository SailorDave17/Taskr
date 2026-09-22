import { describe, expect, it } from 'vitest'

import { FUNCTION_NAMES, SERVER_ONLY_FUNCTIONS } from './deploy-function.mjs'
import { TOKEN_PAGE } from './management-api.mjs'
import {
  bundleFilesOf,
  commitIsOnRelease,
  deploymentVerdict,
  functionsToCheck,
  functionsUrl,
  listDeployedFunctions,
  parseDeployTime,
  resolveReleaseRef,
  sourceCommitHash,
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
    // Since #430 that includes the server-only functions, which the same script
    // deploys and which go stale the same way.
    expect(functionsToCheck()).toEqual([...FUNCTION_NAMES, ...SERVER_ONLY_FUNCTIONS])
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

  it('a 401 says the token is probably dead — the failure this command actually had (#324)', async () => {
    // This reader has its own non-2xx composer, separate from `runQuery`'s, and
    // this is the command whose bare `[401] Unauthorized` was measured on
    // 2026-09-03. A fix that annotated only `runQuery` would leave this one silent
    // while every test about it still passed.
    const result = await listDeployedFunctions({
      ref: 'x',
      token: 't',
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"message":"Unauthorized"}' }),
    })
    expect(result.error).toMatch(/expired|revoked/i)
    expect(result.error).toContain(TOKEN_PAGE)
  })

  it('does not say that on the failures it already handled', async () => {
    for (const status of [404, 500]) {
      const result = await listDeployedFunctions({
        ref: 'x',
        token: 't',
        fetchImpl: async () => ({ ok: false, status, text: async () => '{"message":"nope"}' }),
      })
      expect(result.error).toBe(`[${status}] nope`)
      expect(result.error).not.toMatch(/expired|revoked/i)
    }
  })

  it('does not say that when the API answers 200 with the wrong shape', async () => {
    // The one non-2xx-shaped failure in this reader: a 200 carrying something that
    // is not a list. It must keep saying what it says — a credential message here
    // would send somebody to the token page over a platform response change.
    const result = await listDeployedFunctions({
      ref: 'x',
      token: 't',
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"functions":[]}' }),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/other than a list of functions/)
    expect(result.error).not.toMatch(/expired|revoked/i)
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

describe('#208 — the source a deploy is compared against is the BUNDLE, not the directory', () => {
  // A fake filesystem shaped like `extract-description`: the entrypoint imports
  // the handler, the handler imports two files under `src/lib`, and one of
  // those imports a third. None of the `src/lib` files is under the function's
  // directory, which is the whole blindness this closes.
  const FILES = {
    'supabase/functions/fn/index.ts':
      "import { createClient } from 'npm:@supabase/supabase-js@2'\nimport { createHandler } from './handler.ts'\n",
    'supabase/functions/fn/handler.ts':
      "import { DEPLOYED_CONFIG, attemptExtraction } from '../../../src/lib/extractionAdapter.js'\n" +
      "import { INPUT_KINDS } from '../../../src/lib/extraction.js'\n" +
      "import type { Thing } from './types.ts'\n",
    'src/lib/extractionAdapter.js': '// no imports\n',
    'src/lib/extraction.js': "import { normalizeDueDate } from './dueDates.js'\n",
    'src/lib/dueDates.js': '// leaf\n',
    'supabase/functions/fn/types.ts': 'export type Thing = string\n',
  }
  const readFile = (path) => {
    if (!(path in FILES)) throw new Error(`ENOENT ${path}`)
    return FILES[path]
  }

  it('walks relative imports from the entrypoint and reaches files outside the directory', () => {
    const files = bundleFilesOf('fn', readFile)
    expect(files).toContain('supabase/functions/fn/index.ts')
    expect(files).toContain('supabase/functions/fn/handler.ts')
    expect(files).toContain('src/lib/extractionAdapter.js')
    expect(files).toContain('src/lib/extraction.js')
    // Transitive: reached through extraction.js, not named by the handler.
    expect(files).toContain('src/lib/dueDates.js')
    expect(files).toContain('supabase/functions/fn/types.ts')
  })

  it('follows only ./ and ../ specifiers with an extension — npm: and bare names are the platform’s', () => {
    const files = bundleFilesOf('fn', readFile)
    expect(files.some((f) => f.includes('npm:'))).toBe(false)
    expect(files.some((f) => f.includes('supabase-js'))).toBe(false)
  })

  it('visits each file once, so a cycle terminates', () => {
    const cyclic = {
      'supabase/functions/loop/index.ts': "import './a.ts'\n",
      'supabase/functions/loop/a.ts': "import './b.ts'\n",
      'supabase/functions/loop/b.ts': "import './a.ts'\n",
    }
    const files = bundleFilesOf('loop', (p) => cyclic[p] ?? (() => { throw new Error('ENOENT') })())
    expect(files.sort()).toEqual(Object.keys(cyclic).sort())
  })

  it('keeps a specifier it cannot read rather than dropping it', () => {
    // A file that does not exist contributes nothing to `git log`, and a
    // dropped file is the silent half this walker exists to close.
    const files = bundleFilesOf('fn', (p) => (p === 'src/lib/dueDates.js' ? readFile('src/lib/extraction.js') : readFile(p)))
    expect(files).toContain('src/lib/dueDates.js')
  })

  it('POSITIVE CONTROL: on the real tree, extract-description’s bundle carries the adapter', () => {
    // The case that motivated this: a prompt edit under src/lib is a commit to
    // this function's source. Read off disk, so a rename of the adapter or the
    // import reddens here rather than silently narrowing the comparison.
    const files = bundleFilesOf('extract-description')
    expect(files).toContain('src/lib/extractionAdapter.js')
    expect(files).toContain('src/lib/extraction.js')
    expect(files).toContain('src/lib/dueDates.js')
  })

  it('and the other three functions carry nothing outside their own directory but _shared/', () => {
    // #562 moved every function's HTTP preamble into `supabase/functions/_shared/`,
    // so each bundle now reaches exactly those three files beyond its own
    // directory — which is also what makes a commit to `_shared/` read as every
    // importing function going stale. Pinned as the exact set, so a fourth
    // shared file or a stray `../` import is still a red here, not a widening.
    const SHARED = [
      'supabase/functions/_shared/clients.ts',
      'supabase/functions/_shared/http.ts',
      'supabase/functions/_shared/preamble.ts',
    ]
    for (const name of ['provision-member', 'calendar-connect', 'calendar-busy']) {
      const outside = bundleFilesOf(name).filter((f) => !f.startsWith(`supabase/functions/${name}/`))
      expect(outside.sort(), name).toEqual(SHARED)
    }
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

// #415 — two different facts were wearing one word.
//
// Production builds from `release`, and this script compares the deploy against
// the last commit touching the function IN THE CHECKOUT IT RUNS IN, normally
// `develop`. So a function whose newest source commit is not promoted yet reads
// STALE while production is perfectly correct, and it stays red on every run
// until the next promotion.
//
// Why that is worth a story: this instrument exists BECAUSE #196 measured
// production serving a day-old build while `check:live` read 24 of 24 green. An
// alarm that is always on cannot report the thing it was built for. *Measured
// while writing this story*: the run showed 2 of 8 STALE and BOTH were real —
// two genuinely owed deploys sitting inside a red the repo had learned to read
// as the known-noisy one.
describe('#415 — a deploy behind its source, versus behind an unpromoted branch', () => {
  const sourceMs = Date.parse('2026-09-19T00:00:00Z')
  const older = { slug: 'provision-member', updated_at: sourceMs - 60_000 }

  it('POSITIVE CONTROL: with no ancestry information, the original claim is unchanged', () => {
    // The old three-argument call still means what it always meant. Without
    // this, every assertion below could pass against a function that had
    // quietly stopped reporting staleness at all.
    const verdict = deploymentVerdict('provision-member', older, sourceMs)
    expect(verdict.stale).toBe(true)
    expect(verdict.kind).toBe('behind-source')
    expect(verdict.reason).toContain('predates')
  })

  it('AC 1: a source commit NOT on the release branch is reported as unpromoted, naming the branch', () => {
    const verdict = deploymentVerdict('provision-member', older, sourceMs, {
      onReleaseBranch: false,
      releaseRef: 'origin/release',
    })
    expect(verdict.kind).toBe('unpromoted')
    expect(verdict.reason).toContain('origin/release')
    expect(verdict.reason).toContain('promotion that has not happened')
  })

  it('an unpromoted verdict is still STALE — the fact is reclassified, never withdrawn', () => {
    // FOUND BY MUTATION, predicted 1 and reddened 0: nothing here asserted
    // that an unpromoted verdict keeps `stale: true`, so flipping it to
    // `false` passed the whole suite. That would turn this story's fix into
    // the defect it was written to avoid — the deploy genuinely IS behind its
    // source, and only WHO fixes it changes. `main` decides what fails from
    // `kind`; this holds the underlying fact.
    const verdict = deploymentVerdict('provision-member', older, sourceMs, {
      onReleaseBranch: false,
      releaseRef: 'origin/release',
    })
    expect(verdict.stale).toBe(true)
  })

  it('AC 2: the two cases are distinguishable, and a promoted commit stays a real staleness', () => {
    const promoted = deploymentVerdict('provision-member', older, sourceMs, {
      onReleaseBranch: true,
      releaseRef: 'origin/release',
    })
    const unpromoted = deploymentVerdict('provision-member', older, sourceMs, {
      onReleaseBranch: false,
      releaseRef: 'origin/release',
    })
    expect(promoted.kind).toBe('behind-source')
    expect(unpromoted.kind).toBe('unpromoted')
    expect(promoted.kind).not.toBe(unpromoted.kind)
  })

  it('AC 3: a real staleness still reports stale — the verdict is not softened', () => {
    // The criterion this file exists to keep honest. Both kinds are `stale`;
    // what differs is WHICH, and only the promoted kind makes the command fail.
    const verdict = deploymentVerdict('provision-member', older, sourceMs, {
      onReleaseBranch: true,
      releaseRef: 'origin/release',
    })
    expect(verdict.stale).toBe(true)
    expect(verdict.kind).toBe('behind-source')
  })

  it('an unanswerable ancestry falls back to the ORIGINAL claim, never to the softer one', () => {
    // An instrument that downgrades its own alarm when it cannot check is the
    // failure this whole file argues against. `undefined` is "I could not
    // check", and it must not read as "not promoted".
    const verdict = deploymentVerdict('provision-member', older, sourceMs, {
      onReleaseBranch: undefined,
      releaseRef: 'origin/release',
    })
    expect(verdict.kind).toBe('behind-source')
  })

  it('a current deploy is never reclassified, whatever the branch says', () => {
    const verdict = deploymentVerdict(
      'provision-member',
      { slug: 'provision-member', updated_at: sourceMs + 60_000 },
      sourceMs,
      { onReleaseBranch: false, releaseRef: 'origin/release' },
    )
    expect(verdict.stale).toBe(false)
    expect(verdict.kind).toBe('current')
  })

  it('a never-deployed function is never reclassified as unpromoted', () => {
    // The loudest case must stay loudest: nothing on the platform is an
    // omission at its maximum, and an unpromoted source does not excuse it.
    const verdict = deploymentVerdict('provision-member', undefined, sourceMs, {
      onReleaseBranch: false,
      releaseRef: 'origin/release',
    })
    expect(verdict.stale).toBe(true)
    expect(verdict.kind).toBe('never-deployed')
  })

  describe('commitIsOnRelease — the ancestry read', () => {
    it('reports true when git says the commit is contained', () => {
      expect(commitIsOnRelease('abc123', 'origin/release', () => true)).toBe(true)
    })

    it('reports false when git says it is not', () => {
      expect(commitIsOnRelease('abc123', 'origin/release', () => false)).toBe(false)
    })

    it('reports undefined — not false — when git cannot answer', () => {
      // A shallow clone, a missing ref, a git that failed. Reading any of
      // those as "not promoted" would silently downgrade a real staleness.
      expect(commitIsOnRelease('abc123', 'origin/release', () => undefined)).toBeUndefined()
      expect(
        commitIsOnRelease('abc123', 'origin/release', () => {
          throw new Error('fatal: bad revision')
        }),
      ).toBeUndefined()
    })

    it('refuses to guess about an empty commit', () => {
      expect(commitIsOnRelease('', 'origin/release', () => true)).toBeUndefined()
    })
  })

  describe('resolveReleaseRef — which spelling of the branch exists', () => {
    it('prefers origin/release, because a local release can sit behind it silently', () => {
      expect(resolveReleaseRef((ref) => ref === 'origin/release' || ref === 'release')).toBe(
        'origin/release',
      )
    })

    it('falls back to a local release when there is no remote-tracking ref', () => {
      expect(resolveReleaseRef((ref) => ref === 'release')).toBe('release')
    })

    it('returns undefined when neither exists, rather than inventing one', () => {
      expect(resolveReleaseRef(() => false)).toBeUndefined()
    })
  })

  describe('sourceCommitHash — reporting, not gating', () => {
    it('returns the trimmed hash', () => {
      expect(sourceCommitHash('provision-member', () => '  abc123\n')).toBe('abc123')
    })

    it('returns undefined on an empty or failed read rather than throwing', () => {
      // `sourceCommitTime` has already refused the empty case by the time this
      // runs, so a second throw here would turn a reporting nicety into a
      // reason the whole check cannot run.
      expect(sourceCommitHash('provision-member', () => '')).toBeUndefined()
      expect(
        sourceCommitHash('provision-member', () => {
          throw new Error('git exploded')
        }),
      ).toBeUndefined()
    })
  })
})
