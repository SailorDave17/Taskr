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
import { pathToFileURL } from 'node:url'

// Imported, never restated — AC 2. The list of functions lives in
// `deploy-function.mjs`, so a third function added there is checked here the
// same day, and a copy here would be free to drift from it.
import { FUNCTION_NAMES, resolveSupabaseUrl } from './deploy-function.mjs'
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
  return [...FUNCTION_NAMES]
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
 * When the last commit touching this function's source landed, in epoch ms.
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

/** The real git read, split out so tests can inject. */
export function defaultRunGit(name) {
  const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', `supabase/functions/${name}`], {
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
export function deploymentVerdict(name, deployed, sourceMs) {
  if (!deployed) {
    return { name, stale: true, reason: 'the platform has no function by this name — never deployed' }
  }
  const deployedMs = parseDeployTime(deployed.updated_at)
  if (deployedMs < sourceMs) {
    return { name, stale: true, deployedMs, reason: 'the deploy predates the last commit to its source' }
  }
  return { name, stale: false, deployedMs, reason: '' }
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

  const verdicts = []
  for (const name of names) {
    const deployed = listed.functions.find((fn) => fn.slug === name)
    const source = sourceCommitTime(name)
    const verdict = deploymentVerdict(name, deployed, source.ms)
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
    console.log(`  verdict  : ${verdict.stale ? `STALE — ${verdict.reason}` : 'current — the deploy is not older than the source'}`)

    // A dirty working tree is this comparison's stated blind spot, not a
    // verdict: `deploy:function` uploads the working tree, so uncommitted
    // changes can be either side of the deployed build and nothing here can
    // know which. Saying so beats silently reading a just-edited function as
    // current because its last COMMIT is old.
    const dirty = spawnSync('git', ['status', '--porcelain', '--', `supabase/functions/${name}`], {
      encoding: 'utf8',
    })
    if (String(dirty.stdout ?? '').trim()) {
      console.log('  note     : uncommitted changes under this function — this comparison reads COMMITS, and cannot see them')
    }
    console.log('')
  }

  const stale = verdicts.filter((verdict) => verdict.stale)
  if (stale.length) {
    refuse(
      `${stale.length} of ${verdicts.length} Edge Function deploy(s) are STALE:\n\n` +
        stale.map((verdict) => `  ${verdict.name} — ${verdict.reason}`).join('\n') +
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
