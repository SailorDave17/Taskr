// Does a promotion into `release` carry a new release version? — #540.
//
//     node scripts/check-release-version.mjs [--head <ref>] [--base <ref>]
//
// Defaults: `--head HEAD --base origin/release`, which is the question to ask
// locally before opening a promotion. CI runs it on every pull request whose
// base is `release`, passing the pull request's head sha (`.github/workflows/
// ci.yml`), and a promotion whose `package.json` version is not STRICTLY
// greater than the one `release` already carries is refused, naming both.
//
// WHY A CHECK AND NOT A HABIT
//
// The version moves once per promotion, by `npm version <part>
// --no-git-tag-version` landing on `develop` through an ordinary pull request
// BEFORE the promotion is opened (`develop` refuses a direct push). Forgetting
// that step produces a build that works perfectly and names the previous
// release — the footer, the report mailto and `/version.json` would all agree
// on the wrong answer, and nothing would look broken. The check makes the
// forgetting loud at the one merge that ships it. `docs/deploy-runbook.md`
// carries the procedure.
//
// ORDERING
//
// SemVer 2.0.0 precedence (semver.org §11): major, minor and patch compared
// numerically; a pre-release sorts BELOW its release; pre-release identifiers
// compared left to right, numeric ones numerically, alphanumeric ones in ASCII
// order, numeric below alphanumeric, and a longer list above a shorter one it
// extends. Build metadata (`+…`) is ignored, so `1.0.0+b2` does not beat
// `1.0.0+b1`. Written here rather than taken from the `semver` package because
// the story adds no dependency; the unit test carries the spec's own ordered
// example.
//
// IS THIS SAFE TO RUN?
//
// It runs `git show <ref>:package.json` twice and prints. It writes nothing,
// fetches nothing and needs no credential. CI fetches `release` itself first,
// because `actions/checkout@v4` clones at depth 1.

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// semver.org's own suggested pattern, anchored. It is what refuses `v1.0.0`,
// `1.0` and `01.0.0` rather than guessing what they meant.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** `{ core: [major, minor, patch], prerelease: [...] }`, or null when not SemVer. */
export function parseSemver(value) {
  const match = typeof value === 'string' ? value.match(SEMVER) : null
  if (!match) return null
  return {
    core: [match[1], match[2], match[3]],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

const isNumeric = (identifier) => /^\d+$/.test(identifier)

// Digit strings the pattern has already stripped of leading zeros, so length
// then text orders them — and no identifier is too long for a Number to hold.
function compareDigits(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

function compareIdentifier(a, b) {
  const numericA = isNumeric(a)
  const numericB = isNumeric(b)
  if (numericA && numericB) return compareDigits(a, b)
  if (numericA) return -1
  if (numericB) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** -1, 0 or 1 by SemVer precedence. Throws on a value that is not SemVer. */
export function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left) throw new Error(`${JSON.stringify(a)} is not a SemVer version`)
  if (!right) throw new Error(`${JSON.stringify(b)} is not a SemVer version`)
  for (let i = 0; i < 3; i += 1) {
    const order = compareDigits(left.core[i], right.core[i])
    if (order !== 0) return order
  }
  const [preA, preB] = [left.prerelease, right.prerelease]
  if (preA.length === 0 || preB.length === 0) {
    // A release outranks any pre-release of the same core; two releases tie.
    return preA.length === preB.length ? 0 : preA.length === 0 ? 1 : -1
  }
  for (let i = 0; i < Math.min(preA.length, preB.length); i += 1) {
    const order = compareIdentifier(preA[i], preB[i])
    if (order !== 0) return order
  }
  return preA.length === preB.length ? 0 : preA.length < preB.length ? -1 : 1
}

const BUMP = 'npm version <patch|minor|major> --no-git-tag-version'

/**
 * The verdict on one promotion: `{ ok, message }`, where `head` is the version
 * the pull request would ship and `base` the one `release` carries now. Every
 * message names both values, pass or refuse.
 */
export function checkPromotion({ head, base }) {
  const invalid = [
    ['this pull request', head],
    ['release', base],
  ].find(([, value]) => !parseSemver(value))
  if (invalid) {
    return {
      ok: false,
      message:
        `refused: package.json on ${invalid[0]} reads ${JSON.stringify(invalid[1])}, which is not a SemVer ` +
        `version (head ${JSON.stringify(head)}, release ${JSON.stringify(base)}).`,
    }
  }
  const order = compareSemver(head, base)
  if (order > 0) {
    return { ok: true, message: `ok: this promotion ships ${head}, above release's ${base}.` }
  }
  const relation = order === 0 ? 'the same as' : 'LOWER than'
  return {
    ok: false,
    message:
      `refused: package.json on this pull request reads ${head}, ${relation} release's ${base}. ` +
      `A promotion must carry a new version: land \`${BUMP}\` on develop by pull request first, and ` +
      'this pull request picks it up. See docs/deploy-runbook.md, section 1 step 4.',
  }
}

/** The `version` in package.json at a git ref, read with `git show`. */
export function versionAt(ref, { cwd = process.cwd() } = {}) {
  const shown = spawnSync('git', ['show', `${ref}:package.json`], { cwd, encoding: 'utf8' })
  if (shown.status !== 0) {
    throw new Error(
      `cannot read package.json at ${ref}: ${(shown.stderr || shown.error?.message || '').trim()}` +
        (ref.startsWith('origin/') ? ` — fetch it first: git fetch origin ${ref.slice('origin/'.length)}` : ''),
    )
  }
  return JSON.parse(shown.stdout).version
}

export function parseArgs(argv) {
  const args = { head: 'HEAD', base: 'origin/release' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag !== '--head' && flag !== '--base') throw new Error(`unknown argument ${flag}`)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a git ref`)
    args[flag.slice(2)] = value
    i += 1
  }
  return args
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isMain) {
  try {
    const { head, base } = parseArgs(process.argv.slice(2))
    const verdict = checkPromotion({ head: versionAt(head), base: versionAt(base) })
    if (verdict.ok) console.log(verdict.message)
    else console.error(verdict.message)
    process.exitCode = verdict.ok ? 0 : 1
  } catch (error) {
    console.error(`refused: ${error.message}`)
    process.exitCode = 1
  }
}
