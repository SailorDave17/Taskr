import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  FUNCTION_NAMES,
  PENDING_FUNCTIONS,
  functionsToDeploy,
  parseEnvFile,
  projectRefFrom,
  redactForRefusal,
  REFUSAL_VALUE_LIMIT,
  resolveSupabaseUrl,
} from './deploy-function.mjs'

import { LIVE_EDGE_FUNCTIONS } from '../src/lib/liveSchema.js'

// The pure half of `npm run deploy:function` — #112.
//
// The impure half (spawning the CLI) is deliberately untested: it shells out to
// a binary that does not exist on CI and whose success would mean deploying to
// production. What CAN be tested is the part that decides WHERE the deploy goes,
// and that is the part worth testing, because getting it wrong is silent —
// deploying to the wrong project succeeds, prints success, and leaves the app
// failing exactly as before.

describe('the deploy target is derived, never guessed', () => {
  it('POSITIVE CONTROL: a real hosted URL yields its ref', () => {
    // Without this, every refusal below is satisfied by a function that always
    // throws, which would refuse the deploy that is supposed to work.
    expect(projectRefFrom('https://oitdjvxtqdvegsrimexn.supabase.co')).toBe(
      'oitdjvxtqdvegsrimexn',
    )
    expect(projectRefFrom('https://oitdjvxtqdvegsrimexn.supabase.co/')).toBe(
      'oitdjvxtqdvegsrimexn',
    )
  })

  it.each([
    ['', 'nothing set at all'],
    [undefined, 'undefined rather than empty'],
    ['http://127.0.0.1:54321', 'the LOCAL stack, which has no project ref'],
    ['https://example.com', 'a URL that is not Supabase at all'],
    ['not a url', 'not a URL'],
    // Both of these EMBED a valid-looking ref, and both are refused only
    // because the pattern is anchored at each end. A mutation dropping the
    // anchors reddened nothing until these existed - the coverage hole was
    // found by predicting 0 red and getting it.
    ['https://evil.test/https://oitdjvxtqdvegsrimexn.supabase.co', 'a ref embedded in another URL'],
    ['https://oitdjvxtqdvegsrimexn.supabase.co.evil.test', 'a lookalike domain with the ref as a prefix'],
  ])('refuses %s — %s', (input) => {
    // Every one of these must THROW rather than return something plausible. The
    // local-stack case is the dangerous one: a naive first-label parse returns
    // `127`, which is a well-formed-looking ref for a project nobody owns.
    expect(() => projectRefFrom(input)).toThrow()
  })

  it('names the offending value in the refusal, so the fix is obvious', () => {
    expect(() => projectRefFrom('https://example.com')).toThrow(/example\.com/)
  })
})

describe('the URL is read from the environment first, then .env.local', () => {
  it('prefers an explicit environment variable', () => {
    const url = resolveSupabaseUrl({ VITE_SUPABASE_URL: 'https://fromenv.supabase.co' }, () => {
      throw new Error('.env.local must not be read when the environment has it')
    })
    expect(url).toBe('https://fromenv.supabase.co')
  })

  it('falls back to .env.local', () => {
    const url = resolveSupabaseUrl({}, () => 'VITE_SUPABASE_URL=https://fromfile.supabase.co\n')
    expect(url).toBe('https://fromfile.supabase.co')
  })

  it('returns empty rather than throwing when .env.local is absent', () => {
    // An absent file is an ordinary state on a fresh clone. It must reach the
    // caller's own refusal, which names the variable to set, rather than an
    // ENOENT stack trace.
    const url = resolveSupabaseUrl({}, () => {
      throw new Error('ENOENT')
    })
    expect(url).toBe('')
    expect(() => projectRefFrom(url)).toThrow(/not set/)
  })

  it('reads a KEY=value file without being confused by the other lines', () => {
    const parsed = parseEnvFile(
      ['# a comment', '', 'VITE_SUPABASE_URL=https://a.supabase.co', 'VITE_OTHER=2'].join('\n'),
    )
    expect(parsed.VITE_SUPABASE_URL).toBe('https://a.supabase.co')
    expect(parsed.VITE_OTHER).toBe('2')
  })
})

describe('the script deploys the functions the checks look for', () => {
  it('names exactly the same set as LIVE_EDGE_FUNCTIONS, in both directions', () => {
    // Two lists in two files, and nothing else would notice them diverging: the
    // deploy would succeed and check:live would go on reporting the OTHER name
    // as missing, which reads as a failed deploy.
    //
    // BOTH directions since #95 made these lists longer than one. `toContain`
    // was enough while each held a single entry and is not any more: it passes
    // happily against a script that deploys one of two functions, which is the
    // more likely mistake now — a name added to `LIVE_EDGE_FUNCTIONS` (where the
    // check would go red and prompt you) and forgotten here (where nothing
    // would).
    //
    // Since #210 the invoked set is the DEPLOYABLE set plus the PENDING set: a
    // name the client calls ahead of its function existing is in
    // `LIVE_EDGE_FUNCTIONS` (so check:live reports it honestly) and in
    // `PENDING_FUNCTIONS` (so a bare deploy does not try to ship it). The
    // union is what must match, and the two halves must not overlap.
    expect([...FUNCTION_NAMES, ...PENDING_FUNCTIONS].sort()).toEqual([...LIVE_EDGE_FUNCTIONS].sort())
    expect(FUNCTION_NAMES.filter((name) => PENDING_FUNCTIONS.includes(name))).toEqual([])
  })

  it('a pending function has NO directory yet — the entry expires the day #208 lands', () => {
    // The mirror of the directory test below, and what makes PENDING_FUNCTIONS
    // an exemption that cannot outlive its reason: once the directory exists
    // this reddens until the name moves up into FUNCTION_NAMES.
    for (const name of PENDING_FUNCTIONS) {
      const entry = resolve(process.cwd(), 'supabase/functions', name, 'index.ts')
      expect(
        existsSync(entry),
        `supabase/functions/${name}/index.ts exists — move ${name} from PENDING_FUNCTIONS to FUNCTION_NAMES`,
      ).toBe(false)
    }
  })

  it('refuses to deploy a pending function by name, and says why', () => {
    expect(() => functionsToDeploy(['extract-description'])).toThrow(/not in this tree yet/)
    expect(() => functionsToDeploy(['extract-description'])).toThrow(/#208/)
  })

  it('POSITIVE CONTROL: there is more than one, so the comparison has work to do', () => {
    // A set equality between two empty arrays passes. This is what stops the
    // assertion above reading as healthy if either list is emptied.
    expect(FUNCTION_NAMES.length).toBeGreaterThan(1)
  })

  it('every named function has a directory the CLI can deploy', () => {
    // `functions deploy <name>` reads `supabase/functions/<name>/` relative to
    // the working directory, so a name in the list with no directory behind it
    // fails at the CLI with a message about a path — after the other deploys
    // have already happened.
    for (const name of FUNCTION_NAMES) {
      const entry = resolve(process.cwd(), 'supabase/functions', name, 'index.ts')
      expect(existsSync(entry), `no supabase/functions/${name}/index.ts`).toBe(true)
    }
  })
})

describe('which functions an invocation deploys', () => {
  it('deploys them all when no name is given — the safe action is the short one', () => {
    // Exactly the deployable set: a pending name (#210) is never among them.
    // That second assertion is a restatement of the first plus the
    // disjointness test above, and it stood as a test of its own until a
    // review read it as guarding the pending branch — which an empty argv
    // never reaches (review-fanout, 2026-09-04).
    expect(functionsToDeploy([])).toEqual([...FUNCTION_NAMES])
    for (const name of PENDING_FUNCTIONS) expect(functionsToDeploy([])).not.toContain(name)
  })

  it('ignores flags, so --dry-run does not read as a function name', () => {
    // `process.argv.slice(2)` carries the flags too, and `--dry-run` reaching
    // the name filter would refuse the very invocation that is meant to be safe.
    expect(functionsToDeploy(['--dry-run'])).toEqual([...FUNCTION_NAMES])
  })

  it('narrows to a named function', () => {
    expect(functionsToDeploy(['calendar-connect'])).toEqual(['calendar-connect'])
  })

  it('refuses a name this repo does not have, rather than handing it to the CLI', () => {
    // The CLI would fail with its own message about a missing directory, which
    // sends somebody to look at the filesystem instead of at what they typed.
    expect(() => functionsToDeploy(['calendar-conect'])).toThrow(/No such Edge Function/)
    expect(() => functionsToDeploy(['calendar-conect'])).toThrow(/calendar-connect/)
  })
})

// ---------------------------------------------------------------------------
// #285 — a refusal must never read `.env.local` back to you.
//
// During #52 a `projectRefFrom` refusal printed the WHOLE file, access token
// and test password included, because the "value" it was handed was the entire
// file rather than one variable. The refusal was right to name what it saw; the
// defect is that it saw more than the one value it was asked about.
// ---------------------------------------------------------------------------

// Obvious fakes, and deliberately SHORT: every one of them has to fit inside
// `REFUSAL_VALUE_LIMIT` of the start of the fixture, or a mutation that removes
// the one-line rule would truncate the secret away and the test would pass for
// a reason that has nothing to do with the guard.
const LEAKED_TOKEN = 'sbp_LEAKED_TOKEN'
const LEAKED_PASSWORD = 'LEAKED_PASSWORD'
const LEAKED_ANON = 'sb_publishable_LEAKED'

const URL_LINE = 'VITE_SUPABASE_URL=nope'
const TOKEN_LINE = `SUPABASE_ACCESS_TOKEN=${LEAKED_TOKEN}`
const PASSWORD_LINE = `TASKR_TEST_PASSWORD=${LEAKED_PASSWORD}`
const ANON_LINE = `VITE_SUPABASE_ANON_KEY=${LEAKED_ANON}`
const EVERY_SECRET = [LEAKED_TOKEN, LEAKED_PASSWORD, LEAKED_ANON]

const refusalFor = (input) => {
  try {
    projectRefFrom(input)
  } catch (error) {
    return error.message
  }
  return ''
}

describe('a refusal quotes the one value it was asked about, and no more', () => {
  it.each([
    ['the URL is on line one', [URL_LINE, TOKEN_LINE, PASSWORD_LINE, ANON_LINE]],
    // The order neither the one-line rule NOR the length cap saves you from:
    // the secret is the first thing in the file, so both quote it happily. Only
    // the assignment rule refuses it, which is why that rule exists.
    ['a SECRET is on line one', [TOKEN_LINE, PASSWORD_LINE, URL_LINE, ANON_LINE]],
  ])('handed the whole of .env.local, refuses without quoting a secret — %s', (_case, lines) => {
    const message = refusalFor(lines.join('\n') + '\n')
    expect(message).not.toBe('')
    for (const secret of EVERY_SECRET) {
      expect(message, `refusal quoted ${secret}`).not.toContain(secret)
    }
  })

  it('POSITIVE CONTROL: a short offending value is still quoted in full', () => {
    // Without this, every assertion above is satisfied by a sanitiser that
    // returns the empty string — which would refuse the deploy just as loudly
    // and tell nobody what was wrong with what they set.
    expect(redactForRefusal('https://example.com')).toBe('https://example.com')
    expect(refusalFor('https://example.com')).toContain('https://example.com')
  })

  it('quotes the first line only, and says it truncated', () => {
    const quoted = redactForRefusal('https://bad\nSUPABASE_ACCESS_TOKEN=sbp_LEAKED_TOKEN')
    expect(quoted).toContain('https://bad')
    expect(quoted).not.toContain(LEAKED_TOKEN)
    // The marker matters: a silently shortened value reads as the whole value,
    // and somebody would go looking for a typo in a string they cannot see.
    expect(quoted).toContain('[truncated]')
  })

  it('elides an assignment VALUE and keeps its NAME', () => {
    // Keeping the name is the diagnostic half: a caller that handed us a file
    // needs to be told it handed us a file.
    const quoted = redactForRefusal(TOKEN_LINE)
    expect(quoted).toContain('SUPABASE_ACCESS_TOKEN')
    expect(quoted).toContain('<redacted>')
    expect(quoted).not.toContain(LEAKED_TOKEN)
  })

  it('caps one enormous line', () => {
    const quoted = redactForRefusal('https://' + 'a'.repeat(400))
    expect(quoted.length).toBeLessThan(REFUSAL_VALUE_LIMIT + 20)
    expect(quoted).toContain('[truncated]')
  })
})

describe('.env.local parses to one-line values, whatever wrote it', () => {
  // #285 AC 2. The issue named CRLF handling as the obvious suspect for the
  // "value" that spanned the whole file. MEASURED 2026-08-31: it is innocent —
  // LF and CRLF both parse to identical one-line values, and a CR-only file
  // parses to nothing at all rather than to one giant value. The whole-file
  // value reached the refusal from a CALLER, not from this parser. These cases
  // stay as the regression test that keeps that true.
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('%s: every value is exactly one line', (_case, eol) => {
    const parsed = parseEnvFile([URL_LINE, TOKEN_LINE, PASSWORD_LINE, ANON_LINE].join(eol) + eol)

    expect(Object.keys(parsed)).toEqual([
      'VITE_SUPABASE_URL',
      'SUPABASE_ACCESS_TOKEN',
      'TASKR_TEST_PASSWORD',
      'VITE_SUPABASE_ANON_KEY',
    ])
    for (const [key, value] of Object.entries(parsed)) {
      expect(value, `${key} spans more than one line`).not.toMatch(/[\r\n]/)
    }
    expect(parsed.VITE_SUPABASE_URL).toBe('nope')
  })
})
