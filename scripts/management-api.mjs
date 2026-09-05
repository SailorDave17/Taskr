// The Supabase Management API, and the two commands built on it — #185.
//
// WHY THIS EXISTS AT ALL
//
// Applying a migration and reading the catalog back were both browser-only until
// this landed. #150 measured that route working and recorded its limit in
// `docs/deploy-runbook.md`: it needs a live signed-in dashboard session in the
// automated browser, so it serves an attended session and no cron, CI job or
// headless run. `POST /v1/projects/{ref}/database/query` takes a bearer token
// instead, which is a thing a machine can hold.
//
// WHY THE SURFACE IS TWO NARROW COMMANDS AND NOT ONE GENERAL ONE
//
// A general "run this SQL against production" command is the thing a token makes
// easy and the thing worth not building. It would put an unreviewed statement one
// typo away from the live project — which is precisely why #150 confirmed a paste
// with a read-only `select` from the catalog rather than by re-running the grants
// to see whether they took. So this module exports the transport, and the two
// scripts above it each do exactly one thing: apply a NAMED FILE, or read the
// catalog. Neither takes SQL from a person.
//
// WHAT A TOKEN OF THIS CLASS IS
//
// A Supabase personal access token has full authority over EVERY project in the
// account. Nothing else this repo touches is like that: `VITE_SUPABASE_ANON_KEY`
// is public by design and subject to RLS, and the service-role key is scoped to
// one project and lives in an Edge Function's environment, never here. This is the
// first long-lived, account-wide, outside-the-repo secret Taskr has needed, and
// the containment around it — the refusals below, `.env.example`, the `.gitignore`
// note and the repo-wide scan in `src/test/gate.test.js` — is as much of #185 as
// the feature is.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Imported, never restated. `deploy-function.mjs` already derives the project ref
// from `VITE_SUPABASE_URL` and already parses `.env.local`, and a second copy of
// either would be free to drift from the first — the same argument `LIVE_SCHEMA`
// makes for importing its column lists instead of writing them out. The direction
// is deliberate: the deploy script owns those helpers because it needed them
// first, and this module borrows rather than moving them, so nothing that
// currently works is disturbed by a story that only adds commands.
import { parseEnvFile, projectRefFrom } from './deploy-function.mjs'

/**
 * A refusal a command makes on purpose, as opposed to a crash.
 *
 * It is a THROW rather than a `process.exit()`, and both halves of that matter.
 *
 * Throwing means a refusal cannot fall through. The first version of both
 * commands used a `fail()` helper that called `process.exit()` and therefore
 * never returned, and six call sites sat in `catch` blocks relying on exactly
 * that. Setting an exit code in place of the exit, without restructuring, would
 * have let each of those continue with `ref`, `path`, `sql` or `token`
 * undefined — trading a wrong exit code for a cascade of undefined-value
 * failures. So the callers run inside one `try` and the refusal unwinds.
 *
 * Not calling `process.exit()` is the other half, and it is a platform fact
 * rather than a matter of taste: on Windows/Node 24, `process.exit()` after
 * exactly ONE completed `fetch` aborts inside libuv — `Assertion failed:
 * !(handle->flags & UV_HANDLE_CLOSING)` — replacing the exit code with
 * `0xC0000409`, which a shell reports as **127**. *Measured 3/3 on these
 * scripts, 5/5 synthetic, with a two-fetch control exiting 1 cleanly 5/5, and a
 * single 200 response aborting identically 4/4.*
 *
 * The paths that fail after exactly one request are the echo-stage refusals —
 * including `REFUSED: the database did not receive the file that is on disk`,
 * which is the reason `migrate:live` exists — so the single most important
 * message these commands can print was being stapled under a crash and reported
 * to an unattended caller as command-not-found. That matters here more than in
 * most repos, because running with nobody watching is the whole pitch of this
 * route. cairn `reference/node-process-exit-after-fetch-2026-08-23.md` records
 * the hazard, and measured the repair — `process.exitCode` plus a natural drain
 * — as FASTER than the immediate exit, so there is no trade.
 */
export class Refusal extends Error {
  constructor(message) {
    super(message)
    this.name = 'Refusal'
  }
}

/** The variable both scripts read. The name the Supabase CLI uses, so one token serves both. */
export const TOKEN_VAR = 'SUPABASE_ACCESS_TOKEN'

/** Where the Management API lives. */
export const MANAGEMENT_API_ROOT = 'https://api.supabase.com'

/** Where a personal access token is minted. Named in every refusal below. */
export const TOKEN_PAGE = 'https://supabase.com/dashboard/account/tokens'

/**
 * The environment first, then `.env.local`, which is gitignored and holds the
 * real value. The same shape as `resolveSupabaseUrl` in the deploy script, and
 * separate from it only because it reads a different key.
 */
export function resolveAccessToken(env, readFile) {
  if (env[TOKEN_VAR]) return String(env[TOKEN_VAR]).trim()
  try {
    return String(parseEnvFile(readFile())[TOKEN_VAR] ?? '').trim()
  } catch {
    return ''
  }
}

/** Reads `.env.local` from the working directory. Split out so tests can inject. */
export function readEnvLocal() {
  return readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
}

/**
 * REFUSE rather than proceed, and refuse the near-misses by name — AC 2.
 *
 * Three failures, and the middle one is why this is a function rather than an
 * `if`. An ABSENT token is loud on its own: nothing works. A token that is really
 * one of the OTHER two Supabase credentials is not, because both are to hand in
 * `.env.local`, both are called a key, and pasting either here produces a `401`
 * from the Management API — a message about authentication, which sends somebody
 * to re-mint a token they already have rather than to look at what they pasted.
 *
 * The anon key is called out first because it is the one that is RIGHT THERE and
 * because AC 2 names it. There is no fallback to it, or to anything else: this
 * throws, and both callers exit non-zero having sent nothing. A script that
 * carried on with a lesser credential would report success having done nothing,
 * which is the failure shape this repo has already paid for twice.
 */
export function requireAccessToken(token) {
  const value = String(token ?? '').trim()

  if (!value) {
    throw new Error(
      `${TOKEN_VAR} is not set, so there is nothing to authenticate with.\n\n` +
        'This command talks to the Supabase Management API, which takes a PERSONAL\n' +
        'ACCESS TOKEN — not the anon key, and not the service-role key. Mint one at\n' +
        `${TOKEN_PAGE} and put it in \`.env.local\`:\n\n` +
        `    ${TOKEN_VAR}=<the token>\n\n` +
        'It has authority over every project in the account. `.env.example` says what\n' +
        'that means and how to revoke it; docs/deploy-runbook.md section 5 says when\n' +
        'to use this route and when to use the browser instead.\n\n' +
        'Nothing was sent and nothing was changed.',
    )
  }

  if (/^sb_publishable_/.test(value) || /^sb_secret_/.test(value)) {
    throw new Error(
      `${TOKEN_VAR} holds a PROJECT API KEY, not a personal access token.\n\n` +
        'The two sit near each other in the dashboard and are both called keys. A\n' +
        "project key authenticates to the project's own API (PostgREST, GoTrue); the\n" +
        'Management API is a different service and answers 401 — which reads as a bad\n' +
        'token rather than as the wrong KIND of credential.\n\n' +
        'A personal access token comes from the ACCOUNT page, not the project page:\n' +
        `${TOKEN_PAGE}\n\n` +
        'Nothing was sent and nothing was changed.',
    )
  }

  // A legacy JWT key — the older `anon`/`service_role` pair. The same mistake,
  // and it has no memorable prefix to recognise by eye, so recognising it here is
  // worth more than recognising the modern one.
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(value)) {
    throw new Error(
      `${TOKEN_VAR} holds a JWT, which is a legacy PROJECT key (\`anon\` or\n` +
        '`service_role`), not a personal access token. The same confusion as the\n' +
        'modern `sb_` pair, without a prefix to spot it by.\n\n' +
        `Mint a personal access token at ${TOKEN_PAGE}\n\n` +
        'Nothing was sent and nothing was changed.',
    )
  }

  return value
}

/**
 * The fourth near-miss — the one no shape check above can reach — #324.
 *
 * `requireAccessToken` recognises three wrong credentials by their SHAPE, before
 * anything is sent. An EXPIRED or REVOKED personal access token is the fourth
 * case and is invisible to every one of them: it is the right kind of credential
 * and still well-formed, so each test passes and the request goes out. What comes
 * back is a bare `[401] Unauthorized`, which reads as a question about the
 * endpoint or the project and sends somebody to re-check those — which is exactly
 * what happened. *Measured 2026-09-03*: `check:deployed` and a direct
 * `GET /v1/projects/<ref>/config/auth` returned 401 with one token, two different
 * endpoints, and the token was simply dead.
 *
 * So this case can only be recognised AFTER a response, which is why it lives
 * here and not in `requireAccessToken`. It is composed in one place rather than
 * at each command's `refuse()` because both readers — `runQuery` and
 * `listDeployedFunctions` in `check-deployed.mjs` — build this string
 * identically, and all three commands surface whichever one they used. A copy per
 * caller would be three paragraphs free to drift, and a fourth command added
 * later would silently get none of them.
 *
 * Every other status is returned UNCHANGED, deliberately. Widening this to
 * "anything that failed" would swallow the cases already handled: a 404 is the
 * wrong project ref, a 400 is bad SQL, and `migrate:live` says in as many words
 * that an apply-stage failure means the fault is in the file rather than in
 * transit. A message about re-minting on top of those would send somebody to the
 * token page over a typo in their own migration.
 *
 * 403 is left alone for the same reason the near-misses each name one specific
 * mistake: nothing here has measured one, and a guess would read as a
 * measurement.
 */
export function explainHttpFailure(status, detail) {
  const base = `[${status}] ${detail}`
  if (status !== 401) return base

  return (
    `${base}\n\n` +
    'THE TOKEN WAS REJECTED, and it is probably EXPIRED OR REVOKED.\n\n' +
    `${TOKEN_VAR} is well-formed and is the right KIND of credential — it is not a\n` +
    'project API key or a legacy JWT, which are refused by name before anything is\n' +
    'sent. So a 401 here is very unlikely to be the project ref or the endpoint,\n' +
    'and re-checking those is the wrong next move.\n\n' +
    `Mint a new personal access token at ${TOKEN_PAGE} and replace\n` +
    `${TOKEN_VAR} in \`.env.local\`. It takes ten seconds, and the old one can be\n` +
    'revoked on the same page.\n\n' +
    'docs/deploy-runbook.md section 5 says what else goes dark while this one is\n' +
    'dead: all three of check:deployed, migrate:live and probe:live-grants answer\n' +
    'the same question — has production drifted from the repo? — and a dead token\n' +
    'takes all three at once.'
  )
}

/**
 * `https://abcdefgh.supabase.co` -> `abcdefgh`, refusing anything else.
 *
 * Re-exported rather than reimplemented so both scripts import one module. The
 * refusal matters more here than for a deploy: applying a migration to the wrong
 * project succeeds, and is not undoable.
 */
export { projectRefFrom }

/** The endpoint a query goes to, for one project. */
export function queryUrl(ref, root = MANAGEMENT_API_ROOT) {
  return `${root}/v1/projects/${ref}/database/query`
}

/**
 * Run SQL against a project through the Management API.
 *
 * Returns `{ ok, status, rows, error }` rather than throwing on an HTTP failure,
 * so the caller decides what a given status means — the same reason
 * `probeEdgeFunction` returns its error instead of raising it. An absent answer
 * must never read as a clean one, so a transport failure comes back with
 * `ok: false` and `rows: null`, never as an empty result set.
 */
export async function runQuery({ ref, token, sql, fetchImpl = fetch, root = MANAGEMENT_API_ROOT }) {
  let response
  try {
    response = await fetchImpl(queryUrl(ref, root), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    })
  } catch (error) {
    return {
      ok: false,
      status: null,
      rows: null,
      error: `the request never completed — ${error?.message ?? error}`,
    }
  }

  // INSIDE a try, and it was outside until review found it. Reading the body is
  // a second network operation: a connection reset mid-response throws here, not
  // at the `fetch` above, and both callers `await` this function at top level
  // with no catch — so an escape becomes an unhandled rejection and the process
  // dies, rather than the deliberate refusal this whole module is built around.
  // An absent answer must read as a reported failure, never as a crash.
  let text
  try {
    text = await response.text()
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      rows: null,
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
      rows: null,
      error: explainHttpFailure(response.status, detail),
    }
  }

  return {
    ok: true,
    status: response.status,
    rows: Array.isArray(parsed) ? parsed : [],
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Counting statements — the half of AC 1 that is a language problem
// ---------------------------------------------------------------------------

/**
 * The dollar-quote tag opening at `index`, or null.
 *
 * `$$` and `$name$` open one; `$1` does NOT — a tag must start with a letter or
 * an underscore, which is what stops a positional parameter being read as the
 * start of a quoted region that never ends.
 */
export function dollarTagAt(text, index) {
  if (text[index] !== '$') return null
  if (text[index + 1] === '$') return '$$'
  const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$/.exec(text.slice(index))
  return match ? match[0] : null
}

/**
 * Split SQL into statements the way Postgres reads it, rather than the way
 * `split(';')` does.
 *
 * This is not pedantry about an edge case. `supabase/migrations/` is full of
 * `plpgsql` bodies and every one of them contains semicolons inside a `$$ ... $$`
 * region, so a naive split reports `0012` as dozens of statements and makes the
 * count this prints worthless. All four things that hide a semicolon are present
 * in this repo's files:
 *
 *   - line comments introduced by two hyphens, running to the newline;
 *   - block comments, which NEST in Postgres unlike in C;
 *   - single-quoted strings, where a quote is escaped by DOUBLING it and never
 *     by a backslash;
 *   - dollar-quoted bodies, inside which nothing at all is special.
 *
 * Double-quoted identifiers are handled for the same reason, though nothing here
 * uses one: a scanner right for three of the four cases is a scanner whose
 * failure is waiting for the first file that uses the fourth.
 *
 * A trailing segment of nothing but whitespace and comments is not a statement,
 * which is why `sawCode` is tracked rather than segments being filtered on
 * emptiness afterwards — a trailing comment is not empty and is not a statement
 * either.
 */
export function splitStatements(sql) {
  const text = String(sql ?? '')
  const out = []
  let start = 0
  let sawCode = false
  let i = 0

  const flush = (end) => {
    if (sawCode) out.push(text.slice(start, end))
    sawCode = false
  }

  while (i < text.length) {
    const ch = text[i]

    if (ch === '-' && text[i + 1] === '-') {
      const newline = text.indexOf('\n', i)
      i = newline === -1 ? text.length : newline + 1
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < text.length && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth += 1
          i += 2
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth -= 1
          i += 2
        } else {
          i += 1
        }
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      sawCode = true
      const quote = ch
      i += 1
      while (i < text.length) {
        if (text[i] === quote) {
          // UNEXERCISED, deliberately, and this comment is the only thing that
          // stops it reading as dead code. *Measured*: deleting these three
          // lines changes the output of this function on NOTHING — all 16
          // migrations and eight fixtures aimed at it. A doubled quote is two
          // quotes, so escaping it and closing-then-reopening end in the same
          // state and cover the same characters, and no input can tell them
          // apart. Kept because it is correct lexing and becomes load-bearing
          // the moment this scanner is asked for a string's span rather than
          // for split points. `management-api.test.js` carries the measurement.
          if (text[i + 1] === quote) {
            i += 2
            continue
          }
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    if (ch === '$') {
      const tag = dollarTagAt(text, i)
      if (tag) {
        sawCode = true
        const end = text.indexOf(tag, i + tag.length)
        i = end === -1 ? text.length : end + tag.length
        continue
      }
    }

    if (ch === ';') {
      flush(i)
      i += 1
      start = i
      continue
    }

    if (!/\s/.test(ch)) sawCode = true
    i += 1
  }

  flush(text.length)
  return out
}

// ---------------------------------------------------------------------------
// Proving the payload arrived intact — the other half of AC 1
// ---------------------------------------------------------------------------

/**
 * A dollar-quote tag that does not appear in `text`.
 *
 * Inside a dollar-quoted region Postgres treats everything as literal until it
 * sees exactly the same tag again, so a tag absent from the body makes the
 * embedding safe whatever the body contains — quotes, semicolons, other
 * dollar-quotes and all. It REFUSES rather than truncating if it cannot find
 * one, because the failure of this function is a payload Postgres parses as
 * code.
 */
export function safeDollarTag(text, base = 'taskr_echo') {
  for (let n = 0; n < 100; n += 1) {
    const tag = `$${base}${n === 0 ? '' : n}$`
    if (!String(text ?? '').includes(tag)) return tag
  }
  throw new Error('cannot find a dollar-quote tag absent from this file')
}

/**
 * A read-only query asking Postgres to describe the payload IT received.
 *
 * This is the whole of AC 1's "a character count it read back", and the point is
 * WHICH END does the reading. #150 confirmed a paste by comparing the saved
 * snippet's character count against the repo file, because a clipboard on this
 * machine can re-encode a file in transit — cairn `windows-shell-hazards` hazard
 * 24, where `clip.exe` puts a cp1252 round trip on the clipboard and the
 * casualties are the non-ASCII characters inside `comment on ... is '...'`
 * literals, which persist into the database as schema documentation.
 *
 * Comparing the file against itself would prove nothing whatever. This embeds the
 * payload, asks the DATABASE for its length and digest, and compares those
 * against the local file's — so the answer covers the whole path, and it is taken
 * BEFORE anything is applied. A mangled payload is refused rather than run.
 *
 * `length()` counts characters in a UTF-8 database, which is why the local side
 * counts code points and not UTF-16 units. `md5()` is over the UTF-8 bytes, which
 * is what `localDigest` computes. The digest is the real check; the length is the
 * one a person can read.
 */
export function echoQuery(sql) {
  const tag = safeDollarTag(sql)
  return (
    `with payload as (select ${tag}${sql}${tag}::text as body)\n` +
    'select length(body) as chars, md5(body) as digest, octet_length(body) as bytes\n' +
    'from payload;'
  )
}

/** Characters as Postgres counts them: code points, not UTF-16 units. */
export function localChars(text) {
  return [...String(text ?? '')].length
}

/** `md5()` in Postgres is over the UTF-8 bytes of the text. */
export function localDigest(text) {
  return createHash('md5')
    .update(Buffer.from(String(text ?? ''), 'utf8'))
    .digest('hex')
}

/** Bytes as `octet_length()` counts them. */
export function localBytes(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8')
}

/**
 * Did the payload survive the trip?
 *
 * Returns a list of complaints, empty when it did. A list rather than a boolean
 * because a length mismatch and a digest mismatch mean different things — the
 * first says characters were LOST, the second says they were CHANGED, and a
 * character-set round trip does the second while often leaving the first intact.
 * That is exactly the failure the browser route had to be checked for by hand.
 */
export function compareEcho(local, remote) {
  if (!remote || typeof remote !== 'object') {
    return ['the database returned no description of what it received']
  }

  const problems = []
  const chars = Number(remote.chars)
  const bytes = Number(remote.bytes)
  const digest = String(remote.digest ?? '')

  if (chars !== localChars(local)) {
    problems.push(
      `the database received ${chars} characters, the file on disk has ` +
        `${localChars(local)} — characters were lost or added in transit`,
    )
  }
  if (bytes !== localBytes(local)) {
    problems.push(
      `the database received ${bytes} bytes, the file on disk is ${localBytes(local)} bytes`,
    )
  }
  if (digest !== localDigest(local)) {
    problems.push(
      `md5 differs: the database computed ${digest || '(none)'}, the file on disk is ` +
        `${localDigest(local)} — the bytes CHANGED even where the count did not, which is ` +
        'what a character-set round trip looks like',
    )
  }
  return problems
}
