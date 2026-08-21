// The #88 AC 2 scanner: its unit cover, and the corpus scan that uses it.
//
// TWO KINDS OF TEST LIVE HERE AND THEY ANSWER DIFFERENT QUESTIONS.
//
// The blocks above the divider run the scanner against SYNTHETIC input and ask
// *can this logic be wrong?* They are deliberately not drawn from the real
// files: a defence is only exercised by input that reaches it, and the corpus
// may contain none of the awkward shapes — cairn records a comment-stripper
// that reddened ZERO on mutation for exactly that reason, because an
// unexercised defence is byte-identical to dead code.
//
// The block below the divider runs it against the REAL suites and asks *has the
// repo actually migrated?* That is the acceptance criterion itself.
//
// Both are in `npm test`, so CI gates both with no credentials. Keeping the
// corpus scan out of the live suite is the whole point of it being here — a
// source-text question that needed a Supabase project to ask would only ever be
// asked on a machine that could already ask everything else.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RETIRED_BY_0007, blankComments, retiredNamesIn } from './retiredVocabulary.js'

describe('blankComments', () => {
  it('blanks a line comment but keeps the code before it', () => {
    // Asserted as three properties rather than as an exact run of spaces: the
    // space count is arithmetic nobody can check by eye, and a test that pins
    // it fails on a harmless change while proving nothing extra.
    const source = 'const a = 1 // join_household'
    const blanked = blankComments(source)
    expect(blanked, 'offsets must survive so a reported line still lines up').toHaveLength(
      source.length,
    )
    expect(blanked.startsWith('const a = 1 ')).toBe(true)
    expect(blanked).not.toContain('join_household')
    expect(blanked.trimEnd()).toBe('const a = 1')
  })

  it('blanks a block comment without losing the line count', () => {
    const source = 'a\n/* join_household\n   pin_hash */\nb'
    const blanked = blankComments(source)
    expect(blanked.split('\n')).toHaveLength(4)
    expect(blanked).not.toMatch(/join_household|pin_hash/)
    expect(blanked.startsWith('a\n')).toBe(true)
    expect(blanked.endsWith('\nb')).toBe(true)
  })

  it('does NOT blank a comment marker inside a string', () => {
    // The case that makes this a state machine rather than a regex. If `//`
    // inside a string started a comment, everything after it on the line would
    // stop being scanned — so a real reference could hide behind one.
    const source = `const url = 'https://x.test/join_household'`
    expect(blankComments(source)).toBe(source)
  })

  it('does not treat an escaped quote as the end of a string', () => {
    const source = `const s = 'it\\'s fine' // pin_hash`
    const blanked = blankComments(source)
    expect(blanked).toContain(`'it\\'s fine'`)
    expect(blanked).not.toContain('pin_hash')
  })

  it('leaves a division that is not a comment alone', () => {
    expect(blankComments('const half = total / 2')).toBe('const half = total / 2')
  })
})

describe('retiredNamesIn', () => {
  it('finds nothing in a file that has migrated', () => {
    expect(retiredNamesIn('await client.rpc("current_household_ids")')).toEqual([])
  })

  it('finds a real reference and names the line', () => {
    const source = ['const a = 1', '', 'await client.rpc("join_household", { code })'].join('\n')
    expect(retiredNamesIn(source)).toEqual([{ name: 'join_household', line: 3 }])
  })

  it('ignores a retired name that only appears in prose', () => {
    // The property that makes a migrated file writable at all: its header has
    // to explain what was removed, and explaining is not referencing.
    const source = [
      '// `join_household` and `claim_member_with_pin` were dropped by 0007.',
      '/* `household_devices` was the table every policy asked about. */',
      'const kept = 1',
    ].join('\n')
    expect(retiredNamesIn(source)).toEqual([])
  })

  it('reports the most specific name, not a prefix of it', () => {
    // `claim_member` is a prefix of `claim_member_with_pin`. Reporting the
    // short one sends a reader hunting a call that is not there.
    expect(retiredNamesIn('rpc("claim_member_with_pin")')).toEqual([
      { name: 'claim_member_with_pin', line: 1 },
    ])
    expect(retiredNamesIn('rpc("generate_join_code")')).toEqual([
      { name: 'generate_join_code', line: 1 },
    ])
  })

  it('reports two different names on one line', () => {
    const found = retiredNamesIn('x(pin_hash, has_pin)')
    expect(found.map((f) => f.name).sort()).toEqual(['has_pin', 'pin_hash'])
  })

  it('POSITIVE CONTROL: every name in the list is detectable', () => {
    // Without this, a typo in the list — or a name silently dropped from it —
    // leaves the scanner passing on a file that still calls the thing. The list
    // is the guard's whole extension, and nothing else asserts it is live.
    for (const name of RETIRED_BY_0007) {
      expect(retiredNamesIn(`call(${name})`), `${name} is in the list but not detectable`)
        .toEqual([{ name, line: 1 }])
    }
  })

  it('the list still covers everything 0007 drops', () => {
    // A floor, not an equality: 0007 drops eleven names and this asserts the
    // list has not been quietly shortened. An equality on the exact contents
    // would be a change-detector on spelling and nothing more.
    expect(RETIRED_BY_0007.length).toBeGreaterThanOrEqual(11)
    for (const required of ['join_household', 'claim_member', 'pin_hash', 'household_devices']) {
      expect(RETIRED_BY_0007).toContain(required)
    }
  })
})

// ── the corpus scan ─── #88 AC 2 ──────────────────────────────────────────
//
// The assertion the acceptance criterion actually asks for, and it lives HERE
// rather than inside `rls.integration.test.js` on purpose.
//
// It is a question about source text: no network, no project, no credentials.
// Putting it in the live suite would have made a check CI can run depend on
// credentials CI does not have — so it would only ever run on a machine that
// could already run everything else, which is the wrong way round. A guard is
// worth what it is wired into. Here it gates every push.
//
// What it catches is a merge or a half-finished edit reintroducing a call that
// cannot work against `0007`. Without it, that arrives as a confusing setup
// failure against a live project rather than as a sentence saying the model is
// stale.
describe('#88 AC 2 — the live suites no longer name the model 0007 retired', () => {
  // Both files, because `npm run test:rls` runs BOTH — one `include` glob, no
  // path filter — so a stale reference in either reddens that command.
  const FILES = ['src/test/rls.integration.test.js', 'src/test/schema.integration.test.js']

  // Vocabulary with a LEGITIMATE non-violating use, per file, with its reason.
  //
  // This is the second way a guard whose subject is source text refuses a
  // correct file. The first is prose about the hazard, and stripping comments
  // handles that. This one is a real use of the word that is not the thing
  // being banned, and the repair is an allowlist with a stated reason rather
  // than a looser pattern: loosening turns a guard into decoration, while an
  // exemption is something a reader can argue with.
  const EXEMPT = {
    'src/test/schema.integration.test.js': {
      signInAnonymously:
        'not the retired MEMBERSHIP model. #115 uses an anonymous session purely as a ' +
        'CREDENTIAL, to ask a schema question on role `authenticated` — it reads zero rows, ' +
        'creates no household and claims nobody. The comment above that call was written ' +
        'AFTER #62 and reasons about exactly this, including that disabling anonymous ' +
        'sign-in would take the CHECK down and not the app.',
    },
  }

  const sourceOf = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')

  it.each(FILES)('%s references nothing 0007 dropped', (file) => {
    const exempt = EXEMPT[file] ?? {}
    const found = retiredNamesIn(sourceOf(file)).filter((f) => !exempt[f.name])
    expect(
      found,
      found.length
        ? `${file} still references the retired model: ` +
          found.map((f) => `${f.name} (line ${f.line})`).join(', ')
        : '',
    ).toEqual([])
  })

  it('POSITIVE CONTROL: the scan can fail, on the real corpus', () => {
    // Without this, the assertions above pass identically against a scan that
    // reads nothing — an unreadable path, an emptied list, a matcher that
    // matches nothing. Planting into a copy of the REAL source exercises the
    // same code path on the same corpus, rather than proving a synthetic string
    // routes correctly, which the unit tests above already cover.
    const planted = `${sourceOf(FILES[0])}\nawait client.rpc('join_household', { code: 'X' })\n`
    expect(retiredNamesIn(planted).map((f) => f.name)).toContain('join_household')
  })

  it('every exemption is still needed', () => {
    // An exemption whose subject has left is a hole waiting for somebody to
    // reuse the string — the same assertion `gate.test.js` makes about its own
    // NOT_NAMES list, for the same reason. It is also the check nobody thinks
    // of: an allowlist is written once and then only ever grows.
    const unnecessary = []
    for (const [file, names] of Object.entries(EXEMPT)) {
      const found = retiredNamesIn(sourceOf(file)).map((f) => f.name)
      for (const name of Object.keys(names)) {
        if (!found.includes(name)) unnecessary.push(`${name} (${file})`)
      }
    }
    expect(unnecessary, 'these exemptions no longer exempt anything — delete them').toEqual([])
  })

  it('every exemption carries a reason somebody can argue with', () => {
    for (const [file, names] of Object.entries(EXEMPT)) {
      for (const [name, reason] of Object.entries(names)) {
        expect(reason, `${name} in ${file} is exempt with no reason given`).toBeTruthy()
        expect(reason.length, `${name} in ${file} needs a real reason, not a word`)
          .toBeGreaterThan(40)
      }
    }
  })
})
