// Scan the TRACKER — issue and pull request titles, bodies and comments — for
// live identifiers, and report which items carry them without ever printing what
// they are.
//
// #328. The repository went public on or before 2026-08-30 (`docs/ci-gate.md`
// traded control 5 for reachable branch rulesets), and the tracker went public
// with it. `src/test/gate.test.js`'s Decision 2 corpus is `git ls-files` plus
// untracked-not-ignored files; issues, comments and pull request bodies are not
// files, so no scan in this repo has ever been able to see them. This script is
// the instrument for that surface.
//
// WHAT IT IS AND IS NOT
//
// It is DETECTIVE, never PREVENTIVE, and the distinction is structural rather
// than a limitation of this implementation. GitHub offers no write-time hook on
// an issue or a comment — there is no pre-receive equivalent, nothing a
// repository can install that refuses a comment before it is stored. So the
// earliest this can fire is after the value is already published, and the honest
// claim is "a value that lands here is found", never "a value cannot land here".
// `docs/access-model.md`'s *What a story may record about the live project*
// states the convention this measures compliance with, and says so there too.
//
// IT NEVER PRINTS WHAT IT FOUND, AND THAT IS A REQUIREMENT RATHER THAN A COURTESY.
// This repository is public, so its Actions logs are public. A check that printed
// the identifier it caught would publish that identifier a second time, on a
// surface with a different retention story and no edit history to redact. Every
// report line is an item number plus a match CLASS. `assertReportCarriesNoValues`
// holds that property mechanically rather than by care, because care is what
// fails on the twentieth edit.
//
// TWO HALVES, AND ONLY ONE OF THEM RUNS IN CI
//
// The SHAPE half — UUID-shaped and address-shaped strings — needs no secret and
// runs on the workflow's own `GITHUB_TOKEN`. That is the enforceable half.
//
// The TERM half — the live project's actual household names and member addresses
// — needs those values, and they exist in exactly two places today: the live
// database, and `.env.local` on the owner's machine. Putting them into a GitHub
// Actions secret to detect their publication would create a third home for them,
// which is the direction this repo's whole Decision 2 argument runs against. So
// the term half is LOCAL ONLY, via `--names-file`, and the script states which
// halves ran on every invocation. A run that silently skipped the term half and
// reported clean would be the exact shape cairn records as an absent result
// reading as a clean one.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const REPO_OWNER = 'SailorDave17'
export const REPO_NAME = 'Taskr'

// ANY 8-4-4-4-12 hex string, not a version-4-shaped one.
//
// This was `[1-5]` in the version nibble and `[89ab]` in the variant until the
// #328 review. Two things were wrong with that. It rejected v6, v7 and v8 —
// versions a pasted id could plausibly carry, and v7 in particular is what a
// modern generator reaches for — so the scan had a live coverage gap dressed as
// precision. And it made the nil-UUID skip below **dead code**: the all-zero
// UUID supplies `0` in both nibbles, so the pattern already rejected it, the
// branch could not execute on any input, and the test named for it passed on
// the pattern rather than on the guard it credited.
//
// Widening the pattern is what makes that guard load-bearing for the first time.
export const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

// The all-zero UUID is the canonical "no id" literal and names no row.
export const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// Domains that cannot identify a person here. `taskr.invalid` is deliberately
// ABSENT from this list: a provisioned member's synthetic address encodes their
// `members.id` in its local part (#246, #247, #262), so it is a live row id
// wearing an address's shape, and excluding it would be excluding the very thing
// this scan is for.
export const PLACEHOLDER_EMAIL_DOMAINS = Object.freeze([
  'example.com',
  'example.org',
  'example.net',
  'taskr.test',
  'test.local',
  'noreply.github.com',
  'users.noreply.github.com',
  // Vendor and tooling domains that appear in pasted output and error text.
  'anthropic.com',
  'supabase.co',
  'supabase.com',
  'github.com',
  'sentry.io',
  'vercel.com',
])

// GitHub mints a UUID for every image somebody drags into a comment, and serves
// it from this path. Those ids name an attachment on GitHub's own CDN, not a row
// on the live project. Measured on #328: this was the ONLY false positive in the
// whole corpus (issue #80, two attachment URLs in one comment), and excluding it
// by URL context rather than by issue number is what keeps the rule true for the
// next screenshot somebody attaches.
export const ATTACHMENT_PREFIX = 'github.com/user-attachments/assets/'

/**
 * True when the UUID at `index` is the trailing segment of a GitHub attachment
 * URL. Matched by looking BEHIND the id rather than by matching a whole URL,
 * because the surrounding markup varies (`<img src="…">`, a bare link, a
 * markdown image) and a whole-URL pattern would quietly stop matching when it
 * changes.
 */
export function isAttachmentId(text, index) {
  const before = text.slice(Math.max(0, index - ATTACHMENT_PREFIX.length), index)
  return before.endsWith(ATTACHMENT_PREFIX)
}

export function isPlaceholderDomain(domain) {
  const d = domain.toLowerCase()
  return PLACEHOLDER_EMAIL_DOMAINS.some((p) => d === p || d.endsWith(`.${p}`))
}

/**
 * The classes of live identifier `text` carries. Returns class NAMES, never the
 * matched values — see the header. `terms` are literal strings (household names,
 * member addresses) read from the live project at run time.
 *
 * SECOND CONSUMER, since #409: `src/test/gate.test.js` imports this to read
 * `README.md` and `docs/*.md` for the same two shapes. Decision 2's literal
 * scans match straight-quoted strings and are therefore nearly inert against
 * prose, so the documents needed a rule built for prose and this is it, reused
 * rather than copied. A change here changes what the CI gate refuses in a
 * document — which is the intended coupling, and is worth knowing before
 * narrowing either pattern.
 */
export function classify(text, terms = []) {
  const hits = new Set()
  if (!text) return hits

  for (const match of text.matchAll(UUID_PATTERN)) {
    if (match[0].toLowerCase() === NIL_UUID) continue
    if (isAttachmentId(text, match.index)) continue
    hits.add('uuid')
  }

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    if (isPlaceholderDomain(match[0].split('@')[1])) continue
    hits.add('email')
  }

  const lower = text.toLowerCase()
  for (const term of terms) {
    if (!term) continue
    if (lower.includes(term.toLowerCase())) hits.add(`term:${maskTerm(term)}`)
  }

  return hits
}

/**
 * A term rendered so it can appear in a report. Two leading characters and a
 * length is enough for a reader to tell WHICH term matched without the report
 * carrying the term. `assertReportCarriesNoValues` is what proves this is
 * sufficient rather than merely intended.
 */
export function maskTerm(term) {
  if (term.includes('@')) {
    const [local, domain] = term.split('@')
    return `mail:${local.slice(0, 2)}…${local.length}ch@${domain}`
  }
  return `name:${term.slice(0, 2)}…${term.length}ch`
}

/**
 * Walk fetched items and return one finding per item that carries anything, with
 * the PLACE of each hit. The place matters to a reader deciding what to do: a
 * comment can be deleted outright, while a body can only be edited — and an edit
 * leaves the prior text readable through `userContentEdits` (measured on #158,
 * three prior versions returned verbatim through the public GraphQL API). So
 * `body` and `comment N` are different remedies, not different locations.
 */
export function findingsFor(items, terms = []) {
  const findings = []
  for (const item of items) {
    const places = []

    const add = (where, text, written) => {
      const hits = classify(text, terms)
      if (hits.size) places.push({ where, written: dayOf(written), hits: [...hits].sort() })
    }

    add('title', item.title, item.createdAt)
    add('body', item.body, item.createdAt)

    for (const [index, comment] of (item.comments?.nodes ?? []).entries()) {
      add(`comment ${index + 1}`, comment.body, comment.createdAt)
    }

    for (const [index, review] of (item.reviews?.nodes ?? []).entries()) {
      add(`review ${index + 1}`, review.body, review.createdAt)
      for (const [ci, c] of (review.comments?.nodes ?? []).entries()) {
        add(`review ${index + 1} comment ${ci + 1}`, c.body, c.createdAt)
      }
    }

    if (places.length) {
      findings.push({ kind: item.kind, number: item.number, places })
    }
  }
  return findings
}

/** A date with no time. A day is what a reader needs; an exact instant is noise. */
export function dayOf(timestamp) {
  return typeof timestamp === 'string' && timestamp.length >= 10 ? timestamp.slice(0, 10) : 'undated'
}

/** The report, as lines. Item numbers, dates and classes only — never values. */
export function formatReport(findings) {
  if (!findings.length) return ['no live identifiers found']
  return findings.map(
    (f) =>
      `${f.kind} #${f.number}: ` +
      f.places.map((p) => `${p.where} (${p.written}) [${p.hits.join(', ')}]`).join('; '),
  )
}

/**
 * Refuse to emit a report that carries any search term verbatim. The masking in
 * `maskTerm` is the mechanism; this is the proof, and it is here rather than in a
 * test because the property has to hold on the RUN, not only on the fixtures. A
 * term short enough to appear by chance in ordinary prose would trip this — which
 * is the correct outcome, since such a term cannot be reported safely either.
 */
export function assertReportCarriesNoValues(lines, terms) {
  const text = lines.join('\n').toLowerCase()
  const leaked = terms.filter((t) => t && text.includes(t.toLowerCase()))
  if (leaked.length) {
    throw new Error(
      `the report carries ${leaked.length} search term(s) verbatim — refusing to print it. ` +
        'A public repository has public Actions logs; a check that prints what it caught ' +
        'publishes it a second time.',
    )
  }
  return true
}

// The positive control. An absence search whose instrument is untested reads as
// clean, and "no live identifiers found" is exactly the output a scanner that
// matches nothing at all produces.
//
// IT TRAVELS THE CHANNEL. Until the #328 review this classified a string in
// isolation, which proved `classify()` worked and nothing else — the field
// selection, `fetchAll` and `main()` were all uncovered, and every one of them
// fails toward "no live identifiers found". A control that does not travel the
// path the real subject travels is not a control of that path
// (cairn: a-planted-control-must-travel-the-channel). So the record is built as
// a whole ITEM, walked by the same `findingsFor` the corpus is walked by, and
// stripped out before anything is printed.
//
// The field-selection half cannot be reached this way — the control never goes
// near GraphQL — so `REQUIRED_ITEM_FIELDS` covers it in the suite instead, and
// an empty corpus is refused outright below. Those three together are what the
// success sentence stands on.
export function controlRecord(terms = []) {
  const term = terms.find((t) => t && t.length >= 4)
  return {
    kind: 'control',
    number: 0,
    title: 'planted — never printed',
    body: 'household 3f2504e0-4f89-41d3-9a0c-0305e82c3301 organised by someone@a-real-looking-domain.co',
    createdAt: '1970-01-01T00:00:00Z',
    // A term is planted ONLY when terms were supplied, because a control drawn
    // from the same names file and then found is close to a tautology — it
    // cannot detect a wrong or stale names file, and nothing can. What it does
    // buy is the one thing that was undefended: that `terms` is still WIRED
    // through `findingsFor` on this run. That is a regression control, and it
    // is worth having precisely because the wiring had none.
    comments: { totalCount: term ? 1 : 0, nodes: term ? [{ body: `mentions ${term}`, createdAt: '1970-01-01T00:00:00Z' }] : [] },
  }
}

/**
 * Classes the control must yield on this run: both shape classes always, plus a
 * term class whenever terms were supplied.
 */
export function expectedControlClasses(terms = []) {
  const expected = ['email', 'uuid']
  const term = terms.find((t) => t && t.length >= 4)
  if (term) expected.push(`term:${maskTerm(term)}`)
  return expected.sort()
}

/**
 * Walk the control through `findingsFor` and report which expected classes it
 * failed to produce. Empty means the instrument demonstrably fired on this run.
 */
export function controlMisses(terms = []) {
  const found = findingsFor([controlRecord(terms)], terms)
  const hits = new Set(found.flatMap((f) => f.places.flatMap((p) => p.hits)))
  return expectedControlClasses(terms).filter((c) => !hits.has(c))
}

// `createdAt` everywhere, because *when* a value was written is half of what a
// reader re-pricing the #328 decision needs — an id written before the
// repository went public is a correct habit overtaken by a surface change, and
// one written after is a rule being broken. The instrument used to answer only
// the first half, so the document had to assert the second from memory, and
// **it asserted it wrongly** (two of the thirteen were post-public).
//
// `totalCount` on every comment connection is the truncation signal. `first:
// 100` with no `pageInfo` returns exactly 100 nodes with `errors` null, and the
// connection is **oldest-first** (measured on issue #5), so the cap silently
// drops the NEWEST comments — on a busy item the `issue_comment` trigger would
// be blind to the very comment that fired it. `assertNoTruncation` turns that
// into an exit-2 refusal rather than a quiet partial scan.
// PAGE SIZES ARE CONSTANTS BECAUSE TWO THINGS READ THEM. The queries below ask
// for exactly these many, and `truncationErrors` refuses a connection whose
// `totalCount` exceeds them — so a number changed in one place and not the other
// would silently under-report, which is the failure this whole file is about.
//
// They are also bounded by GitHub's 500,000-node query limit, which the first
// draft of the review-aware query breached: 50 pull requests x (100 comments +
// 100 reviews x 100 comments) is 510,000 and answers MAX_NODE_LIMIT_EXCEEDED.
// The pull request page is 20 rather than 50 for that reason alone — worst case
// 20 x (100 + 50 x (1 + 50)) = 53,000.
export const COMMENT_PAGE = 100
export const REVIEW_PAGE = 50
export const REVIEW_COMMENT_PAGE = 50
export const ISSUE_PAGE = 50
export const PULL_PAGE = 20

const COMMENT_FIELDS = 'totalCount nodes { body createdAt }'

const ISSUE_FIELDS = `
  number title body createdAt
  comments(first: ${COMMENT_PAGE}) { ${COMMENT_FIELDS} }
`

// A pull request carries THREE writable text surfaces, not one. `comments` is
// the conversation tab; a review body and an inline review-thread comment are
// separate connections, and until the #328 review neither was fetched — so an
// id pasted into a code review was invisible to every route into this script
// while the workflow's own header claimed it covered every surface.
const PULL_FIELDS = `
  number title body createdAt
  comments(first: ${COMMENT_PAGE}) { ${COMMENT_FIELDS} }
  reviews(first: ${REVIEW_PAGE}) {
    totalCount
    nodes { body createdAt comments(first: ${REVIEW_COMMENT_PAGE}) { ${COMMENT_FIELDS} } }
  }
`

export const ISSUES_QUERY = `
query($owner:String!, $name:String!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    issues(first: ${ISSUE_PAGE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`

export const PULLS_QUERY = `
query($owner:String!, $name:String!, $cursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequests(first: ${PULL_PAGE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PULL_FIELDS} }
    }
  }
}`

// Every key `findingsFor` reads off a fetched item, so a field selection that
// stops naming one is caught by a test rather than by a clean-looking scan.
export const REQUIRED_ITEM_FIELDS = Object.freeze(['number', 'title', 'body', 'createdAt', 'comments'])
export const REQUIRED_PULL_FIELDS = Object.freeze([...REQUIRED_ITEM_FIELDS, 'reviews'])

export function queryNamesField(query, field) {
  return countField(query, field) > 0
}

/**
 * How many times a query selects `field`, at a word boundary.
 *
 * The count, not the presence, is what a test can hold — and the difference is
 * a defect this file already walked into once. `createdAt` is selected at the
 * item level AND inside every comment connection, so *"does the query mention
 * createdAt?"* stays true when the item-level one is deleted: the guard written
 * to catch a dropped field was satisfied by its own neighbour, and a mutation
 * dropping the item-level `createdAt` reddened **0 of a predicted 2**.
 */
export function countField(query, field) {
  return (query.match(new RegExp(`(^|[^A-Za-z])${field}([^A-Za-z]|$)`, 'g')) ?? []).length
}

// How many times each field must be selected, per query. A number here is a
// claim about the shape of the selection, and dropping any single occurrence
// moves it.
export const ISSUE_FIELD_COUNTS = Object.freeze({ number: 1, title: 1, body: 2, createdAt: 2, comments: 1 })
export const PULL_FIELD_COUNTS = Object.freeze({ number: 1, title: 1, body: 4, createdAt: 4, comments: 2, reviews: 1 })

/**
 * Refuse a partial scan. A comment connection at its cap has dropped the newest
 * comments with no error and no signal, and a partial absence search reports
 * clean — so this is an exit-2 "the scan did not run", never a warning.
 */
export function truncationErrors(items, caps = {}) {
  const commentCap = caps.comment ?? COMMENT_PAGE
  const reviewCap = caps.review ?? REVIEW_PAGE
  const reviewCommentCap = caps.reviewComment ?? REVIEW_COMMENT_PAGE
  const errors = []
  for (const item of items) {
    const at = `${item.kind} #${item.number}`
    if (item.comments?.totalCount > commentCap) {
      errors.push(`${at}: ${item.comments.totalCount} comments exceeds the ${commentCap} fetched`)
    }
    if (item.reviews?.totalCount > reviewCap) {
      errors.push(`${at}: ${item.reviews.totalCount} reviews exceeds the ${reviewCap} fetched`)
    }
    for (const review of item.reviews?.nodes ?? []) {
      if (review.comments?.totalCount > reviewCommentCap) {
        errors.push(
          `${at}: a review thread has ${review.comments.totalCount} comments, exceeding the ${reviewCommentCap} fetched`,
        )
      }
    }
  }
  return errors
}

export function resolveToken(env = process.env) {
  const fromEnv = env.GITHUB_TOKEN || env.GH_TOKEN
  if (fromEnv) return fromEnv
  // Local runs: borrow the CLI's token rather than asking for a second one.
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
}

export function readTerms(path) {
  return [...new Set(readFileSync(path, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))]
}

async function fetchAll({ query, key, kind, token, fetchImpl = fetch }) {
  const out = []
  let cursor = null
  for (;;) {
    const response = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'taskr-scan-tracker',
      },
      body: JSON.stringify({
        query,
        variables: { owner: REPO_OWNER, name: REPO_NAME, cursor },
      }),
    })
    if (!response.ok) {
      throw new Error(`GitHub API answered ${response.status} — the scan did not run`)
    }
    const json = await response.json()
    if (json.errors) {
      throw new Error(`GitHub API returned errors — the scan did not run: ${json.errors.map((e) => e.type ?? 'error').join(', ')}`)
    }
    const page = json.data.repository[key]
    out.push(...page.nodes.map((n) => ({ ...n, kind })))
    if (!page.pageInfo.hasNextPage) break
    cursor = page.pageInfo.endCursor
  }
  return out
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

/**
 * Resolve the term half's state from argv. Three outcomes, and the middle one is
 * the reason this is a function: `--names-file` with nothing after it used to
 * take the same branch as the flag being absent and print *"no --names-file
 * given"* — a false statement about the invocation the operator actually made,
 * sending them to re-check a command line that was already correct.
 */
export function resolveTerms(argv, read = readTerms) {
  const index = argv.indexOf('--names-file')
  if (index < 0) return { terms: [], path: null, given: false }
  const path = argv[index + 1]
  if (!path || path.startsWith('--')) {
    throw new Error(
      '--names-file was given with no path after it — the scan did not run. ' +
        'The term half searches for the live project’s household names and member ' +
        'addresses, and running without it silently answers a narrower question.',
    )
  }
  return { terms: read(path), path, given: true }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { terms, path: termsPath, given } = resolveTerms(argv)

  // The control is walked through `findingsFor` — the same function the corpus
  // is walked through — so a break anywhere in that path is caught here rather
  // than reported as a clean tracker.
  const misses = controlMisses(terms)
  if (misses.length) {
    throw new Error(
      `POSITIVE CONTROL FAILED — the scanner did not find ${misses.join(', ')} in its own planted ` +
        'control record, so a clean result would mean nothing. Refusing to report.',
    )
  }

  const termLine = given
    ? terms.length
      ? `ON, ${terms.length} term(s) from ${termsPath}`
      : `OFF — --names-file ${termsPath} was given but yielded no terms, so live household names and member addresses were NOT searched for`
    : 'OFF — no --names-file given, so live household names and member addresses were NOT searched for'
  console.log(`shape half: ON (uuid, email) — needs no secret\nterm  half: ${termLine}`)

  const token = resolveToken(env)
  const issues = await fetchAll({ query: ISSUES_QUERY, key: 'issues', kind: 'issue', token })
  const pulls = await fetchAll({ query: PULLS_QUERY, key: 'pullRequests', kind: 'pr', token })
  console.log(`corpus: ${issues.length} issues, ${pulls.length} pull requests`)

  // An empty corpus is the one delivery failure the control cannot see: a
  // narrowed token returns zero nodes with no error, every item classifies
  // empty, and the run prints the most reassuring line it has.
  if (issues.length === 0 && pulls.length === 0) {
    throw new Error(
      'the fetched corpus is EMPTY — the scan did not run. A token without repository read access ' +
        'returns zero nodes and no error, which is indistinguishable from a clean tracker.',
    )
  }

  const truncated = truncationErrors([...issues, ...pulls])
  if (truncated.length) {
    throw new Error(
      `the scan did not run — a connection is at its fetch cap, so the newest entries were ` +
        `silently dropped:\n  ${truncated.join('\n  ')}\n` +
        'Page the connection before trusting any result from this corpus.',
    )
  }

  const findings = findingsFor([...issues, ...pulls], terms)
  const lines = formatReport(findings)
  assertReportCarriesNoValues(lines, terms)

  console.log(`\n${lines.join('\n')}\n`)

  if (findings.length) {
    console.log(
      `${findings.length} item(s) carry live identifiers. Values are deliberately not printed — ` +
        'read them on the item itself. `docs/access-model.md` carries what a story may record ' +
        'about the live project, and `docs/data-outside-production.md` carries the #328 decision.',
    )
    return 1
  }
  // Say which halves the clean result covers. The unqualified version of this
  // sentence was quoted by two documents as proof the instrument works, while
  // the control it referred to covered the shape half alone.
  console.log(
    `nothing found. On this run the positive control fired for: ${expectedControlClasses(terms).join(', ')}` +
      (terms.length ? '' : ' — the term half did NOT run, so household names were not searched for'),
  )
  return 0
}

if (isMain) {
  try {
    // `process.exitCode`, never `process.exit()` — a `process.exit()` after a
    // completed fetch aborts inside libuv on Windows/Node 24 and replaces the
    // computed code with one a shell reports as 127. Same reason as
    // scripts/management-api.mjs.
    process.exitCode = await main()
  } catch (error) {
    console.error(`\n${error?.stack ?? error}\n`)
    process.exitCode = 2
  }
}
