// Is production running the current Edge Function source? — #222.
//
//     npm run check:deployed
//
// WHAT THIS ANSWERS THAT `check:live` STRUCTURALLY CANNOT
//
// `check:live` asks whether a function is THERE AND CALLABLE, which a superseded
// build answers just as well — #196 measured it reading 24 of 24 green while
// production served a build a day older than the source, before the redeploy and
// after it, identically. The omission it cannot see is the one this reports: a
// merge that changed `supabase/functions/**` with no `npm run deploy:function`
// after it. `docs/deploy-runbook.md` section 3 carries the incident.
//
// Until this landed, the instrument was a raw CLI command in that runbook — a
// command in prose, which is the failure this repo has already paid for twice
// (`scripts/deploy-function.mjs`'s header records both days). This is the same
// repair applied to the check instead of the deploy.
//
// HOW IT DECIDES
//
// The platform's record, against git's. `GET /v1/projects/{ref}/functions`
// returns `version`, `updated_at` and `ezbr_sha256` per function; git gives the
// last commit that touched that function's source. A deploy older than the last
// commit is owed, and this exits non-zero saying so. The hash is printed rather
// than compared — it is content-addressed (*measured on #196*: an identical
// redeploy moved v5 to v6 and left it unchanged), so it is the value a human
// checks a suspect deploy against, but nothing here can compute the eszip hash
// of the local source to compare it with.
//
// The two timestamps come from two clocks — Supabase's server and whatever
// machine made the commit. That is fine for this comparison, whose subject is
// hours-to-days, and deliberately carries no tolerance window: a window is a way
// for a deploy genuinely two minutes older than its source to read current.
//
// IS THIS SAFE TO RUN AGAINST PRODUCTION?
//
// It sends one GET to the Management API and runs `git log`. It takes no
// arguments, writes nothing, and deploys nothing.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Imported, never restated — AC 2. The list of functions lives in
// `deploy-function.mjs`, so a third function added there is checked here the
// same day, and a copy here would be free to drift from it.
import { FUNCTION_NAMES, SERVER_ONLY_FUNCTIONS, resolveSupabaseUrl } from './deploy-function.mjs'
import {
  MANAGEMENT_API_ROOT,
  Refusal,
  explainHttpFailure,
  projectRefFrom,
  readEnvLocal,
  requireAccessToken,
  resolveAccessToken,
} from './management-api.mjs'

/**
 * The functions this checks, taken from `scripts/deploy-function.mjs`.
 *
 * A function rather than the import used inline below, so that a test can
 * assert THIS is what the command works from — the same seam as
 * `probeTables()` in `probe-live-grants.mjs`. Rewriting it as a hand-written
 * list has to redden something the day the source list moves.
 */
export function functionsToCheck() {
  // #430: the server-only functions are deployed by the same script and go
  // stale the same way, so they are checked the same way.
  return [...FUNCTION_NAMES, ...SERVER_ONLY_FUNCTIONS]
}

/** Where the platform's record of deployed functions lives. */
export function functionsUrl(ref, root = MANAGEMENT_API_ROOT) {
  return `${root}/v1/projects/${ref}/functions`
}

/**
 * Read the deployed-function records for one project.
 *
 * Returns `{ ok, status, functions, error }` rather than throwing on an HTTP
 * failure, the same shape as `runQuery` and for the same reason: an absent
 * answer must never read as a clean one. A body that is not a list comes back
 * as a failure, never as "no functions deployed" — for this check that
 * misreading would convert a broken read into a claim that every deploy is
 * missing, or (worse, filtered) into silence.
 */
export async function listDeployedFunctions({
  ref,
  token,
  fetchImpl = fetch,
  root = MANAGEMENT_API_ROOT,
}) {
  let response
  try {
    response = await fetchImpl(functionsUrl(ref, root), {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    return {
      ok: false,
      status: null,
      functions: null,
      error: `the request never completed — ${error?.message ?? error}`,
    }
  }

  // Inside a try for the reason `runQuery` gives: reading the body is a second
  // network operation and a reset here must become a reported failure, not an
  // unhandled rejection.
  let text
  try {
    text = await response.text()
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      functions: null,
      error: `the response body could not be read — ${error?.message ?? error}`,
    }
  }

  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const detail =
      (parsed && (parsed.message || parsed.error || parsed.msg)) || text.slice(0, 500) || '(no body)'
    return {
      ok: false,
      status: response.status,
      functions: null,
      error: explainHttpFailure(response.status, detail),
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      status: response.status,
      functions: null,
      error: 'the API answered 200 with something other than a list of functions — refusing to read that as "nothing is deployed"',
    }
  }

  return { ok: true, status: response.status, functions: parsed, error: null }
}

/**
 * `updated_at` as milliseconds since the epoch, refusing anything unreadable.
 *
 * The Management API returns epoch milliseconds (*measured 2026-08-28 against
 * the live project*; the runbook's CLI shows the same raw value). An absent or
 * unparseable timestamp THROWS rather than defaulting, because any default is a
 * verdict: 0 reads as "older than everything" and `Date.now()` as "current",
 * and neither is something this check measured.
 */
export function parseDeployTime(value) {
  const ms = typeof value === 'number' ? value : Number(String(value ?? '').trim() || NaN)
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `the deployed record carries an unreadable updated_at (${JSON.stringify(value)}) — ` +
        'refusing to guess which side of the source it falls on',
    )
  }
  return ms
}

/**
 * The import specifiers one source file names — the CLI's own pattern, copied
 * from `apps/cli-go/pkg/function/deno.go` at v2.116.0 so this walks exactly
 * what the deploy uploads.
 */
const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^{}]+\}|.*?)\s*(?:from)?\s*['"](.*?)['"]|import\(\s*['"](.*?)['"]\)/gi

/**
 * Every file the deploy of `name` carries — #208.
 *
 * Walked from the entrypoint the way the CLI's upload walker walks it: each
 * `./` or `../` specifier with an extension, resolved against the importing
 * file, depth first, once. Until #208 this check compared the deploy against
 * the last commit to `supabase/functions/<name>` alone, and `extract-description`
 * is the first function whose bundle carries files OUTSIDE that directory —
 * the adapter (the prompt), the grader's contract and the date rules under
 * `src/lib`. A prompt edit that merged with no redeploy read as CURRENT: the
 * instrument built for exactly that omission (#222) agreeing with a green
 * `check:live` (a preflight cannot see a prompt) that production was fine
 * (review-fanout, 2026-09-07). The blindness is the same under either outcome
 * of #209's import measurement — a `_shared/` copy is outside the directory
 * too — which is why this walks imports rather than widening a glob.
 *
 * Paths are repo-relative posix, the shape `git log -- <path>` takes. A
 * specifier this cannot read is kept in the list rather than dropped: `git
 * log` over a path that never existed contributes nothing, and a dropped file
 * is the silent half this function exists to close.
 */
export function bundleFilesOf(name, readFile = defaultReadFile) {
  const entry = `supabase/functions/${name}/index.ts`
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const current = queue.pop()
    if (seen.has(current)) continue
    seen.add(current)
    let text
    try {
      text = readFile(current)
    } catch {
      continue
    }
    for (const match of String(text ?? '').matchAll(IMPORT_PATTERN)) {
      const specifier = (match[1] || match[2] || '').trim()
      if (!specifier || !/\.[a-z]+$/i.test(specifier)) continue
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      queue.push(posixJoin(posixDirname(current), specifier))
    }
  }
  return [...seen]
}

function posixDirname(path) {
  const at = path.lastIndexOf('/')
  return at === -1 ? '.' : path.slice(0, at)
}

function posixJoin(dir, relative) {
  const parts = dir === '.' ? [] : dir.split('/')
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

function defaultReadFile(path) {
  return readFileSync(path, 'utf8')
}

/**
 * When the last commit touching this function's BUNDLE landed, in epoch ms.
 *
 * REFUSES an empty answer. `git log` over a path prints nothing when the path
 * has no commits — which here means the name is wrong, the checkout is shallow,
 * or the function directory is gone — and every one of those must be loud,
 * because an empty answer defaulted to 0 would make every deploy read current.
 */
export function sourceCommitTime(name, runGit = defaultRunGit) {
  const output = String(runGit(name) ?? '').trim()
  if (!output) {
    throw new Error(
      `git has no commit touching supabase/functions/${name} — either the name is wrong, ` +
        'the checkout is shallow, or the directory is gone. Refusing to read that as "old".',
    )
  }
  const ms = Date.parse(output)
  if (!Number.isFinite(ms)) {
    throw new Error(`git returned an unparseable commit time for ${name}: ${output}`)
  }
  return { iso: output, ms }
}

/**
 * The real git read, split out so tests can inject. Over the function's
 * DIRECTORY plus every file its bundle carries (`bundleFilesOf`), so a commit
 * to the adapter under `src/lib` is a commit to `extract-description`'s
 * source. The directory stays in the list so a test file or a comment-only
 * change there still counts, exactly as before #208.
 */
export function defaultRunGit(name) {
  const paths = [`supabase/functions/${name}`, ...bundleFilesOf(name)]
  const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', ...paths], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`git log failed for supabase/functions/${name}: ${result.stderr || result.status}`)
  }
  return result.stdout
}

/**
 * The verdict for one function: is the deploy at least as new as the source?
 *
 * `deployed` is the platform's record for this name, or undefined when the
 * platform has none. Undefined is STALE, not an error — a function that exists
 * in `supabase/functions/` and nowhere on the platform is the omission at its
 * maximum, and this is the check that must say so out loud.
 *
 * The comparison is strict: a deploy strictly older than the last commit is
 * stale, an equal timestamp is not, because "predates" is the claim.
 */
export function deploymentVerdict(name, deployed, sourceMs, source = {}) {
  if (!deployed) {
    return {
      name,
      stale: true,
      kind: 'never-deployed',
      reason: 'the platform has no function by this name — never deployed',
    }
  }
  const deployedMs = parseDeployTime(deployed.updated_at)
  if (deployedMs < sourceMs) {
    // #415 — TWO different facts wear the same word.
    //
    // Production builds from `release`. This script compares the deploy
    // against the last commit touching the function IN THE CHECKOUT IT RUNS
    // IN, which is normally `develop`. So a function whose newest source
    // commit has not been promoted yet reads STALE while production is
    // perfectly correct — the verdict is true about the tree and misleading
    // about production, and it stays red on every run until the next
    // promotion.
    //
    // That is not a cosmetic complaint. A standing red is one everybody
    // learns to scroll past, and this instrument exists BECAUSE #196 measured
    // production serving a day-old build while `check:live` read 24 of 24
    // green. An alarm that is always on cannot report the thing it was built
    // for. *Measured while writing this story*: the run showed 2 of 8 STALE
    // and BOTH were real — sitting inside a red the repo had been reading as
    // the known-noisy one.
    //
    // `onReleaseBranch` is undefined when the caller could not resolve it
    // (no `release` ref, a shallow clone). Undefined is deliberately treated
    // as the ORIGINAL claim rather than as the softer one: an instrument that
    // downgrades its own alarm when it cannot check is the failure this whole
    // file argues against.
    if (source.onReleaseBranch === false) {
      return {
        name,
        stale: true,
        kind: 'unpromoted',
        deployedMs,
        reason:
          `the deploy predates the last commit to its source, but that commit is not on ` +
          `${source.releaseRef ?? 'release'} yet — production does not have it either, ` +
          'so this is a promotion that has not happened rather than a deploy that is owed',
      }
    }
    return {
      name,
      stale: true,
      kind: 'behind-source',
      deployedMs,
      reason: 'the deploy predates the last commit to its source',
    }
  }
  return { name, stale: false, kind: 'current', deployedMs, reason: '' }
}

/**
 * Is a commit contained in the release branch? — #415.
 *
 * Pure but for the injected runner, so the tests can drive every branch
 * without a repository in a particular state. Returns `undefined` rather than
 * a boolean when the question cannot be answered — no `release` ref, a shallow
 * clone, a git that failed — because "I could not check" and "no, it is not
 * there" are different claims and the verdict above treats them differently.
 */
export function commitIsOnRelease(commit, releaseRef, runner = defaultRunAncestry) {
  if (!commit) return undefined
  try {
    return runner(commit, releaseRef)
  } catch {
    return undefined
  }
}

/**
 * The branch production builds from — #415.
 *
 * Resolved rather than hard-coded to one spelling: a checkout that has never
 * checked `release` out has only the remote-tracking ref, and one that has
 * carries both. `origin/release` is preferred because it is what the remote
 * says, and a local `release` can sit behind it without anything saying so —
 * which would make this check answer "not promoted" about a commit that is.
 * `undefined` when neither exists, which `commitIsOnRelease` turns into "I
 * could not check" rather than "no".
 */
export function resolveReleaseRef(runner = defaultRunRefExists) {
  for (const ref of ['origin/release', 'release']) {
    try {
      if (runner(ref)) return ref
    } catch {
      // Try the next spelling; an unreadable ref is not an answer.
    }
  }
  return undefined
}

/** The real ref-existence read, split out so tests can inject. */
export function defaultRunRefExists(ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    encoding: 'utf8',
  })
  return result.status === 0
}

/**
 * The hash of the last commit touching this function's bundle — #415.
 *
 * A separate read rather than a wider `sourceCommitTime`, deliberately: that
 * function's contract is covered by tests that assert its refusals, and this
 * question is only ever asked about a function already judged stale. An empty
 * answer is `undefined` here rather than a throw, because `sourceCommitTime`
 * has already refused the empty case by the time this runs — the caller is
 * past that gate, and a second throw would turn a reporting nicety into a
 * reason the whole check cannot run.
 */
export function sourceCommitHash(name, runner = defaultRunCommitHash) {
  try {
    const output = String(runner(name) ?? '').trim()
    return output || undefined
  } catch {
    return undefined
  }
}

/** The real hash read, split out so tests can inject. */
export function defaultRunCommitHash(name) {
  const paths = [`supabase/functions/${name}`, ...bundleFilesOf(name)]
  const result = spawnSync('git', ['log', '-1', '--format=%H', '--', ...paths], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return undefined
  return result.stdout
}

/** The real ancestry read, split out so tests can inject. */
export function defaultRunAncestry(commit, releaseRef) {
  if (!releaseRef) return undefined
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, releaseRef], {
    encoding: 'utf8',
  })
  // 0 = contained, 1 = not contained, anything else = git could not answer.
  if (result.status === 0) return true
  if (result.status === 1) return false
  return undefined
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

async function main(env) {
  const refuse = (message) => {
    throw new Refusal(message)
  }

  let ref
  try {
    ref = projectRefFrom(resolveSupabaseUrl(env, readEnvLocal))
  } catch (error) {
    refuse(`Cannot work out which project to read.\n\n${error.message}`)
  }

  const token = requireAccessToken(resolveAccessToken(env, readEnvLocal))
  const names = functionsToCheck()

  console.log(`\nproject   : ${ref}   (derived from VITE_SUPABASE_URL)`)
  console.log(`functions : ${names.join(', ')}   (from scripts/deploy-function.mjs)\n`)

  const listed = await listDeployedFunctions({ ref, token, fetchImpl: fetch })
  if (!listed.ok) refuse(`Could not read the deployed-function records.\n\n${listed.error}`)

  // #415 — resolved once, not per function.
  const RELEASE_REF = resolveReleaseRef()

  const verdicts = []
  for (const name of names) {
    const deployed = listed.functions.find((fn) => fn.slug === name)
    const source = sourceCommitTime(name)
    // #415 — only asked when it can change the answer. The ancestry read is
    // two git calls, and a function whose deploy is current does not care
    // whether its source is promoted.
    const commit = sourceCommitHash(name)
    const onReleaseBranch = commit ? commitIsOnRelease(commit, RELEASE_REF) : undefined
    const verdict = deploymentVerdict(name, deployed, source.ms, {
      onReleaseBranch,
      releaseRef: RELEASE_REF,
    })
    verdicts.push(verdict)

    console.log(name)
    if (deployed) {
      console.log(
        `  deployed : v${deployed.version}   ${new Date(verdict.deployedMs).toISOString()}   ` +
          `ezbr_sha256 ${deployed.ezbr_sha256 ?? '(none reported)'}`,
      )
    } else {
      console.log('  deployed : NOTHING — the platform has no function by this name')
    }
    console.log(`  source   : last commit ${source.iso}`)
    // #415 — the word carries the distinction, not just the sentence after it.
    // A reader scanning a column of verdicts sees which kind this is without
    // reading to the end of the line.
    const label = verdict.kind === 'unpromoted' ? 'NOT PROMOTED' : 'STALE'
    console.log(
      `  verdict  : ${verdict.stale ? `${label} — ${verdict.reason}` : 'current — the deploy is not older than the source'}`,
    )
    if (verdict.kind === 'unpromoted') {
      console.log(`  source   : that commit is on this checkout and not on ${RELEASE_REF}`)
    }

    // A dirty working tree is this comparison's stated blind spot, not a
    // verdict: `deploy:function` uploads the working tree, so uncommitted
    // changes can be either side of the deployed build and nothing here can
    // know which. Saying so beats silently reading a just-edited function as
    // current because its last COMMIT is old.
    const dirty = spawnSync(
      'git',
      ['status', '--porcelain', '--', `supabase/functions/${name}`, ...bundleFilesOf(name)],
      { encoding: 'utf8' },
    )
    if (String(dirty.stdout ?? '').trim()) {
      console.log('  note     : uncommitted changes under this function or in a file its bundle carries — this comparison reads COMMITS, and cannot see them')
    }
    console.log('')
  }

  // #415 — split, because the two need different actions from different
  // people. A deploy that is owed is fixed by one command here; a commit that
  // is not promoted is fixed by a `develop -> release` pull request, which is
  // the owner's. Reporting them under one word sent every reader looking for
  // the wrong fix, and made the whole verdict ignorable.
  const owed = verdicts.filter((verdict) => verdict.stale && verdict.kind !== 'unpromoted')
  const unpromoted = verdicts.filter((verdict) => verdict.kind === 'unpromoted')

  if (unpromoted.length) {
    // Printed BEFORE the refusal, so it is visible whether or not the check
    // goes on to fail.
    console.log(
      `${unpromoted.length} of ${verdicts.length} function(s) have a source commit that is not on ` +
        `${RELEASE_REF} yet:\n\n` +
        unpromoted.map((verdict) => `  ${verdict.name}`).join('\n') +
        '\n\nProduction builds from that branch, so it does not have those commits either and\n' +
        'nothing is wrong with the deployed build. This is a promotion that has not\n' +
        'happened, not a deploy that is owed, and it clears on the next\n' +
        `develop -> ${RELEASE_REF?.replace(/^origin\//, '') ?? 'release'} merge.\n`,
    )
  }

  // AC 3 — a real staleness still FAILS, and it fails on its own count rather
  // than on a total that unpromoted commits had inflated.
  if (owed.length) {
    refuse(
      `${owed.length} of ${verdicts.length} Edge Function deploy(s) are STALE:\n\n` +
        owed.map((verdict) => `  ${verdict.name} — ${verdict.reason}`).join('\n') +
        '\n\nThe fix is one command:  npm run deploy:function\n' +
        'It deploys every function by default, and redeploying an unchanged one is a\n' +
        'no-op by content (the ezbr_sha256 does not move), so there is no cost to\n' +
        'running it whole.',
    )
  }

  console.log(`${verdicts.length} of ${verdicts.length} deploys are at least as new as their source.\n`)
}

if (isMain) {
  try {
    await main(process.env)
  } catch (error) {
    // `process.exitCode`, never `process.exit()` — see `Refusal` in
    // scripts/management-api.mjs: on Windows/Node 24 an exit after one completed
    // fetch aborts inside libuv and reports as 127, and the one-fetch path here
    // is exactly the refusal this command exists to print.
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}
