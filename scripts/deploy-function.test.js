import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  FUNCTION_NAMES,
  functionsToDeploy,
  parseEnvFile,
  projectRefFrom,
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
    expect([...FUNCTION_NAMES].sort()).toEqual([...LIVE_EDGE_FUNCTIONS].sort())
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
    expect(functionsToDeploy([])).toEqual([...FUNCTION_NAMES])
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
