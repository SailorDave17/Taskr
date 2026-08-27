import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  MANAGEMENT_API_ROOT,
  TOKEN_VAR,
  compareEcho,
  dollarTagAt,
  echoQuery,
  localBytes,
  localChars,
  localDigest,
  queryUrl,
  requireAccessToken,
  resolveAccessToken,
  runQuery,
  safeDollarTag,
  splitStatements,
} from './management-api.mjs'

// The Management API transport — #185.
//
// WHAT THESE TESTS CAN AND CANNOT SAY, stated first because it decides how much
// the green run below is worth.
//
// The statement scanner and the payload comparison are PURE, and they are checked
// against the real files in `supabase/migrations/` as well as against fixtures.
// That distinction matters: a fixture is something the author wrote, so it agrees
// with whatever the author believed, while `0013` on disk was written by somebody
// else for another purpose and its character count was measured INDEPENDENTLY by
// #150 before this code existed. A scanner that agrees with an outside
// measurement has been told something.
//
// `runQuery` is driven with an injected `fetch`, and there the limit is real: a
// fake cannot disagree with the person who wrote it, so these prove what this
// code DECIDES — which URL, which headers, which body, what it does with a
// non-2xx — and prove nothing about whether Supabase's Management API behaves as
// assumed. That half is only answerable against the live service, and #185's AC 1
// and AC 4 are where it gets answered.

const migration = (name) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')

describe('splitStatements — counting what a paste actually sends', () => {
  it('counts plain statements', () => {
    expect(splitStatements('select 1; select 2;')).toHaveLength(2)
  })

  it('does not count a trailing comment as a statement', () => {
    // The obvious bug in any `split(';')`: the tail after the last semicolon is
    // not empty, so it survives an emptiness filter and inflates every count by
    // one on every file in this repo, all of which end in prose.
    expect(splitStatements('select 1;\n-- a closing note about why\n')).toHaveLength(1)
  })

  it('does not count whitespace after the last semicolon', () => {
    expect(splitStatements('select 1;\n\n   \n')).toHaveLength(1)
  })

  it('counts a final statement with no trailing semicolon', () => {
    expect(splitStatements('select 1;\nselect 2')).toHaveLength(2)
  })

  it('ignores a semicolon inside a line comment', () => {
    expect(splitStatements('select 1; -- and then; and then\nselect 2;')).toHaveLength(2)
  })

  it('ignores a semicolon inside a block comment', () => {
    expect(splitStatements('select 1; /* ; ; ; */ select 2;')).toHaveLength(2)
  })

  it('handles NESTED block comments, which Postgres has and C does not', () => {
    // A scanner that closes on the first `*/` would end the comment early and
    // start counting the rest of the comment as SQL.
    expect(splitStatements('select 1; /* outer /* inner ; */ still comment ; */ select 2;'))
      .toHaveLength(2)
  })

  it('ignores a semicolon inside a string', () => {
    expect(splitStatements("select 'a;b'; select 'it''s; fine';")).toHaveLength(2)
  })

  it('DOES NOT PROVE the doubled-quote escape, and the reason is worth the comment', () => {
    // This test used to be named for the escape and could never have failed on
    // it. *Measured*: an implementation with the `''` branch deleted produces
    // byte-identical output on all 16 files in `supabase/migrations/` and on
    // eight fixtures written to target it — including `'o''brien'`, `'a'';'` and
    // `'a''--;'`.
    //
    // It is not a gap in the fixtures. A doubled quote is TWO quotes, so the
    // correct parse (escape, stay inside the string) and the naive one (close,
    // immediately reopen) end in the same state, and every character between the
    // outer quotes is inside SOME string either way. No input exists on which
    // they disagree about where a top-level semicolon is — so no fixture can
    // discriminate them, and inventing a contrived one would only hide that.
    //
    // The branch is KEPT because it is correct SQL lexing and the cost is three
    // lines: the moment this scanner is asked for anything but split points — a
    // string's span, a comment-stripped copy — it becomes load-bearing. This
    // test exists so the next person to read a zero-red mutation there knows it
    // is unexercised rather than dead, which are the two things that look alike.
    const withEscape = splitStatements("select 'o''brien'; select 2;")
    expect(withEscape).toHaveLength(2)
  })

  it('ignores a semicolon inside a double-quoted identifier', () => {
    expect(splitStatements('select "odd;name"; select 2;')).toHaveLength(2)
  })

  it('ignores everything inside a dollar-quoted body, which is where plpgsql lives', () => {
    const sql = 'create function f() returns void as $$\nbegin\n  perform 1; perform 2;\nend;\n$$ language plpgsql;\nselect 1;'
    expect(splitStatements(sql)).toHaveLength(2)
  })

  it('handles a TAGGED dollar quote, and a body containing a bare $$', () => {
    const sql = 'select $tag$ inside $$ still inside ; $tag$; select 1;'
    expect(splitStatements(sql)).toHaveLength(2)
  })

  it('does NOT read $1 as opening a dollar quote', () => {
    // The nastiest failure available: a positional parameter read as a quote tag
    // swallows the whole rest of the file, and the count silently becomes 1.
    expect(splitStatements('select $1; select $2;')).toHaveLength(2)
  })

  it('dollarTagAt recognises the two legal forms and refuses a parameter', () => {
    expect(dollarTagAt('$$x', 0)).toBe('$$')
    expect(dollarTagAt('$body$x', 0)).toBe('$body$')
    expect(dollarTagAt('$1', 0)).toBeNull()
    expect(dollarTagAt('x', 0)).toBeNull()
  })

  it('POSITIVE CONTROL: agrees with a count taken independently of this code', () => {
    // #187 recorded `0013` as carrying "all 3 `grant` statements" while confirming
    // the paste in the SQL editor, months before this scanner existed. A fixture
    // written here could only ever agree with its author; this cannot.
    expect(splitStatements(migration('0013_grants_the_platform_no_longer_infers.sql'))).toHaveLength(3)
  })

  it('POSITIVE CONTROL: the plpgsql-heavy files do not blow up the count', () => {
    // `0012` is 27 statements and full of `$$` bodies containing dozens of
    // semicolons. A naive split reports it as ~90, so this number moving is the
    // loudest possible signal that the dollar-quote branch stopped working.
    expect(splitStatements(migration('0012_repeating_chores.sql'))).toHaveLength(27)
    expect(splitStatements(migration('0007_per_member_auth.sql'))).toHaveLength(64)
  })

  it('POSITIVE CONTROL: every migration on disk parses to at least one statement', () => {
    // Discovered rather than listed, so a migration added tomorrow is scanned the
    // day it lands. A scanner that returned [] for everything — a dollar-quote
    // branch that swallows the file, say — is caught here even if every count
    // above were loosened.
    const names = readdirSync(resolve(process.cwd(), 'supabase/migrations')).filter((name) =>
      name.endsWith('.sql'),
    )
    expect(names.length).toBeGreaterThan(10)
    const empty = names.filter((name) => splitStatements(migration(name)).length === 0)
    expect(empty, `these files parsed to no statements at all: ${empty.join(', ')}`).toEqual([])
  })
})

describe('the payload comparison — proving the file arrived, from the far end', () => {
  const sql = migration('0013_grants_the_platform_no_longer_infers.sql')

  it('POSITIVE CONTROL: the local character count matches what #150 measured', () => {
    // 6761 is not a number this repo invented for a test. #150 measured it in the
    // SQL editor on 2026-08-26 — "6761 characters plus 120 carriage returns is
    // exactly the 6881 the editor held" — and `docs/deploy-runbook.md` records
    // it. If `localChars` ever starts counting UTF-16 units instead of code
    // points, this is what says so.
    expect(localChars(sql)).toBe(6761)
  })

  it('POSITIVE CONTROL: the byte count reflects the 8 non-ASCII characters #187 counted', () => {
    // Each is three bytes in UTF-8, so bytes exceed characters by exactly 16.
    // This is the assertion that fails if a file is ever normalised through a
    // character set that cannot carry them — which is the whole hazard.
    expect(localBytes(sql) - localChars(sql)).toBe(16)
  })

  it('counts characters as code points, not UTF-16 units', () => {
    expect(localChars('a—b')).toBe(3)
    expect(localBytes('a—b')).toBe(5)
  })

  it('safeDollarTag returns a tag the body does not contain', () => {
    expect(safeDollarTag('nothing special')).toBe('$taskr_echo$')
    expect(safeDollarTag('a $taskr_echo$ b')).toBe('$taskr_echo1$')
    expect(safeDollarTag('a $taskr_echo$ b $taskr_echo1$ c')).toBe('$taskr_echo2$')
  })

  it('echoQuery embeds the payload in a tag the payload does not contain', () => {
    const query = echoQuery(sql)
    expect(query).toContain('$taskr_echo$')
    expect(query).toContain('md5(body)')
    expect(query).toContain('length(body)')
    // Embedded ONCE. A second copy would double the payload on every apply.
    expect(query.split(sql).length - 1).toBe(1)
  })

  it('compareEcho is silent when the database describes the file it was sent', () => {
    expect(
      compareEcho(sql, {
        chars: localChars(sql),
        bytes: localBytes(sql),
        digest: localDigest(sql),
      }),
    ).toEqual([])
  })

  it('catches characters LOST — a truncated payload', () => {
    const truncated = sql.slice(0, 4000)
    const problems = compareEcho(sql, {
      chars: localChars(truncated),
      bytes: localBytes(truncated),
      digest: localDigest(truncated),
    })
    expect(problems.join(' ')).toMatch(/characters were lost or added/)
  })

  it('catches characters CHANGED at an identical count — which is what a transcode does', () => {
    // The case the length check alone cannot see, and the one that actually
    // happened here: `clip.exe` re-encodes an em dash and the schema comment in
    // the database ends up carrying mojibake. One character swapped for another
    // leaves the count untouched and the digest different.
    const swapped = sql.replace('—', '-')
    expect(localChars(swapped)).toBe(localChars(sql))

    const problems = compareEcho(sql, {
      chars: localChars(swapped),
      bytes: localBytes(sql),
      digest: localDigest(swapped),
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/md5 differs/)
  })

  it('treats an absent description as a problem rather than as agreement', () => {
    expect(compareEcho(sql, null)).toEqual([
      'the database returned no description of what it received',
    ])
  })
})

describe(`${TOKEN_VAR} — refusing rather than falling back`, () => {
  it('refuses an absent token, naming the variable', () => {
    expect(() => requireAccessToken('')).toThrow(new RegExp(TOKEN_VAR))
    expect(() => requireAccessToken(undefined)).toThrow(/is not set/)
  })

  it('says plainly that nothing was sent, so an absent token cannot read as a no-op success', () => {
    expect(() => requireAccessToken('')).toThrow(/Nothing was sent and nothing was changed/)
  })

  it('refuses the publishable key, which is the one sitting in the same file', () => {
    expect(() => requireAccessToken('sb_publishable_abcdefghijklmnop')).toThrow(
      /PROJECT API KEY/,
    )
  })

  it('refuses the secret key', () => {
    expect(() => requireAccessToken('sb_secret_abcdefghijklmnop')).toThrow(/PROJECT API KEY/)
  })

  it('refuses a legacy JWT key, which has no prefix to spot by eye', () => {
    expect(() => requireAccessToken('eyJhbGciOi.eyJyb2xlIjo.sig')).toThrow(/legacy PROJECT key/)
  })

  it('accepts a token that is none of those, and trims it', () => {
    expect(requireAccessToken('  a-plausible-token-value  ')).toBe('a-plausible-token-value')
  })

  it('reads the environment first, then .env.local', () => {
    expect(resolveAccessToken({ [TOKEN_VAR]: 'from-env' }, () => '')).toBe('from-env')
    expect(resolveAccessToken({}, () => `${TOKEN_VAR}=from-file\n`)).toBe('from-file')
  })

  it('prefers the environment when BOTH are set, which is the only case that shows precedence', () => {
    // The two assertions above pass whichever order the function checks in: each
    // supplies exactly one source, so the other returns nothing and the fallback
    // is indistinguishable from the preference. Only a fixture where they
    // DISAGREE can tell the two implementations apart — and precedence is what
    // lets a one-off run override the file without editing it.
    expect(
      resolveAccessToken({ [TOKEN_VAR]: 'from-env' }, () => `${TOKEN_VAR}=from-file\n`),
    ).toBe('from-env')
  })

  it('returns empty rather than throwing when .env.local is not there', () => {
    // The refusal belongs to requireAccessToken, which says what to do about it.
    // A throw here would surface as a stack trace about a missing file.
    expect(
      resolveAccessToken({}, () => {
        throw new Error('ENOENT')
      }),
    ).toBe('')
  })
})

describe('runQuery — what it sends, and what it does with an answer', () => {
  const ok = (body) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    headers: new Map(),
  })

  it('posts to the project query endpoint with a bearer token', async () => {
    const calls = []
    await runQuery({
      ref: 'abcdefghijklmnopqrst',
      token: 'a-token',
      sql: 'select 1;',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return ok([])
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      `${MANAGEMENT_API_ROOT}/v1/projects/abcdefghijklmnopqrst/database/query`,
    )
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.Authorization).toBe('Bearer a-token')
    expect(JSON.parse(calls[0].init.body)).toEqual({ query: 'select 1;' })
  })

  it('queryUrl names the project, so a wrong ref cannot reach the right project', () => {
    expect(queryUrl('xyz')).toContain('/v1/projects/xyz/database/query')
  })

  it('returns rows on success', async () => {
    const result = await runQuery({
      ref: 'r',
      token: 't',
      sql: 'select 1;',
      fetchImpl: async () => ok([{ chars: 3 }]),
    })
    expect(result).toMatchObject({ ok: true, status: 200, rows: [{ chars: 3 }] })
  })

  it('reports a non-2xx as a failure with the service message, not as empty rows', async () => {
    // The distinction this repo keeps insisting on: an absent answer must never
    // read as a clean one. `rows: []` here would make a failed catalog read look
    // like a project with no grants.
    const result = await runQuery({
      ref: 'r',
      token: 't',
      sql: 'select 1;',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'Unauthorized' }),
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.rows).toBeNull()
    expect(result.error).toMatch(/\[401\] Unauthorized/)
  })

  it('reports a transport failure as unproven rather than as an empty result', async () => {
    const result = await runQuery({
      ref: 'r',
      token: 't',
      sql: 'select 1;',
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      },
    })
    expect(result.ok).toBe(false)
    expect(result.rows).toBeNull()
    expect(result.error).toMatch(/never completed/)
  })

  it('reports a body that cannot be READ, rather than escaping as an unhandled rejection', async () => {
    // Reading the body is a second network operation: a connection reset
    // mid-response throws at `.text()`, not at the `fetch`. That call sat outside
    // the try until review found it, and both callers await this at top level
    // with no catch — so the process died with an unhandled rejection instead of
    // producing the deliberate refusal this module is built around.
    const result = await runQuery({
      ref: 'r',
      token: 't',
      sql: 'select 1;',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('socket hang up')
        },
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.rows).toBeNull()
    expect(result.error).toMatch(/body could not be read/)
    expect(result.error).toMatch(/socket hang up/)
  })

  it('survives a body that is not JSON, rather than throwing over an HTML error page', async () => {
    const result = await runQuery({
      ref: 'r',
      token: 't',
      sql: 'select 1;',
      fetchImpl: async () => ({ ok: false, status: 502, text: async () => '<html>gateway</html>' }),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/502/)
  })
})
