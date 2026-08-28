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

import { execSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RETIRED_BY_0007,
  blankComments,
  blankSqlComments,
  isSqlPath,
  retiredNamesIn,
} from './retiredVocabulary.js'

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

describe('blankSqlComments', () => {
  // #170 AC 4. The dialect exists because the JavaScript blanker leaves every
  // `--` line untouched, and a migration is mostly `--`. Measured when the
  // corpus widened: 27 sentences of prose in 0001-0007 became refusals.
  it('blanks a -- line comment but keeps the statement before it', () => {
    const source = "select 1; -- join_household was dropped here"
    const blanked = blankSqlComments(source)
    expect(blanked, 'offsets must survive').toHaveLength(source.length)
    expect(blanked.trimEnd()).toBe('select 1;')
    expect(blanked).not.toContain('join_household')
  })

  it('does NOT blank a -- that is inside a string literal', () => {
    // The case that makes this a state machine rather than a regex. If `--`
    // inside a string started a comment, the rest of the line would stop being
    // scanned and a real reference could hide behind one.
    const source = "select 'a--b', public.claim_member(id);"
    expect(blankSqlComments(source)).toBe(source)
  })

  it("treats '' as an escape rather than as the end of a string", () => {
    const source = "select 'it''s fine'; -- pin_hash"
    const blanked = blankSqlComments(source)
    expect(blanked).toContain("'it''s fine'")
    expect(blanked).not.toContain('pin_hash')
  })

  it('does NOT treat a $$ body as a string, so code inside it is still scanned', () => {
    // A plpgsql body is where SQL puts real logic. Blanking it would hide the
    // hazard in the one place it most matters.
    const source = ['create function f() returns void as $$', 'begin', '  perform public.join_household(c);', 'end', '$$ language plpgsql;'].join('\n')
    expect(blankSqlComments(source)).toContain('join_household')
  })

  it('keeps the line count across a block comment', () => {
    const source = 'select 1;\n/* join_household\n   pin_hash */\nselect 2;'
    const blanked = blankSqlComments(source)
    expect(blanked.split('\n')).toHaveLength(4)
    expect(blanked).not.toMatch(/join_household|pin_hash/)
    expect(blanked.startsWith('select 1;')).toBe(true)
    expect(blanked.trimEnd().endsWith('select 2;')).toBe(true)
  })

  it('DAMAGE CONTROL: a comment in the MIDDLE does not take the code around it', () => {
    // #170 AC 4, and the shape matters. A landmark at the END of a file proves
    // only that the transform did not eat everything — the failure that goes
    // green is the one that eats the MIDDLE, which is exactly what an
    // unterminated string state or a mis-set flag does. So both sides of the
    // comment are asserted, and the assertion is on CODE rather than on a
    // trailing marker.
    //
    // Both dialects, because they are blanked by different rules.
    const sql = ["select 'kept-before';", '-- join_household', "select 'kept-after';"].join('\n')
    const sqlBlanked = blankSqlComments(sql)
    expect(sqlBlanked).toContain("'kept-before'")
    expect(sqlBlanked).toContain("'kept-after'")
    expect(sqlBlanked).not.toContain('join_household')

    const js = ["const before = 'kept-before'", '// join_household', "const after = 'kept-after'"].join('\n')
    const jsBlanked = blankComments(js)
    expect(jsBlanked).toContain("'kept-before'")
    expect(jsBlanked).toContain("'kept-after'")
    expect(jsBlanked).not.toContain('join_household')
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
    // A floor, not an equality, and the floor asserts the list has not been
    // quietly shortened. An equality on the exact contents would be a
    // change-detector on spelling and nothing more.
    //
    // The count lives in the assertion and NOWHERE else — #170 AC 6. It used to
    // be spelled out in this comment as well, which is the most recurring
    // documentation defect in this workspace: two copies of a computable number,
    // one of them unable to fail. The brief that filed #170 said ten, the array
    // holds eleven, and `assert_valid_pin` was the name that fell through the
    // gap — which is the argument for a guard over a remembered list, and for
    // not writing the total down twice.
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
// ── #170 — and the corpus is now the code the guard is MEANT to protect ────
//
// Until #170 the corpus was the two integration suites and nothing else, so a
// `join_code` in `src/lib/invitations.js` or in a new migration passed every
// check in this repo. That is the file #171 is about to write. A guard widened
// in the same commit as the code it guards has never been shown to refuse
// anything, so this lands FIRST and on its own.
//
// The corpus is DISCOVERED, never hand-listed — the same argument `gate.test.js`
// makes twice: a list covers exactly the files somebody remembered.
describe('#88 AC 2 / #170 — the code no longer names the model 0007 retired', () => {
  // Both suites, because `npm run test:rls` runs BOTH — one `include` glob, no
  // path filter — so a stale reference in either reddens that command. They are
  // named rather than discovered because they are the ORIGINAL #88 subject and
  // live outside every directory the #170 widening covers.
  const LIVE_SUITES = ['src/test/rls.integration.test.js', 'src/test/schema.integration.test.js']

  // #170 AC 2 — untracked files included, and the reason is measured rather than
  // theoretical. `git ls-files` alone resolves against the INDEX, so a file is
  // scanned the day it is STAGED and not the day it is written; cairn records
  // this repo's own #19 guard firing on the old file in a commit and staying
  // silent on the new one. The file being added right now is exactly the file a
  // vocabulary guard exists to see.
  //
  // The cost is stated rather than hidden: an untracked scratch file under these
  // directories is now scanned, and it has not reached version control. That is
  // the intended direction — this refuses a name while deleting it is still free.
  function ls() {
    return execSync('git ls-files -z --cached --others --exclude-standard', {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean)
  }

  // A migration at or below 0007 is HISTORY, and history has to name what it
  // built. 0001-0006 create `household_devices`, `pin_hash` and `join_code`;
  // 0007 is the migration that DROPS them, and `drop function claim_member` is
  // an executable reference no comment-blanking can excuse. All eight are
  // already applied to the live project and can never be edited, so refusing
  // them would refuse the record rather than a hazard — measured at the moment
  // the corpus widened: 84 findings across the eight, and not one a defect.
  //
  // Owner decision, 2026-08-26, taken against a per-name allowlist for all
  // eight: one dated boundary with its reason in band, rather than a list that
  // can only grow and that the module header above already argues against. What
  // it costs is stated: a retired name RE-ADDED by editing 0001 would not be
  // caught here. Editing an applied migration is forbidden for older reasons.
  const MIGRATION = /^supabase\/migrations\/(\d{4})_[^/]*\.sql$/
  const HISTORY_THROUGH = 7

  function corpusOf(paths) {
    return paths.filter((path) => {
      if (LIVE_SUITES.includes(path)) return true
      if (/^src\/lib\/.*\.jsx?$/.test(path)) return true
      if (/^src\/components\/.*\.jsx?$/.test(path)) return true
      if (/^supabase\/functions\/.*\.(ts|js)$/.test(path)) return true
      const migration = path.match(MIGRATION)
      return Boolean(migration) && Number(migration[1]) > HISTORY_THROUGH
    })
  }

  // Split out from the constant so a control can RE-DERIVE it after creating an
  // untracked file. A corpus computed once cannot be asked whether it WOULD have
  // seen one.
  const scanCorpus = () => corpusOf(ls())
  const corpus = scanCorpus()

  // The four directories #170 AC 1 names, each with the predicate that admits it
  // and a real tracked file that must be in the corpus today. The pairing is
  // what makes the plant test below able to distinguish a corpus covering four
  // directories from one covering three.
  const COVERED = [
    { dir: 'src/lib', matches: (p) => /^src\/lib\/.*\.jsx?$/.test(p) },
    { dir: 'src/components', matches: (p) => /^src\/components\/.*\.jsx?$/.test(p) },
    { dir: 'supabase/functions', matches: (p) => /^supabase\/functions\/.*\.(ts|js)$/.test(p) },
    { dir: 'supabase/migrations', matches: (p) => MIGRATION.test(p) },
  ]

  // Vocabulary with a LEGITIMATE non-violating use, per file, with its reason.
  //
  // This is the second way a guard whose subject is source text refuses a
  // correct file. The first is prose about the hazard, and stripping comments
  // handles that. This one is a real use of the word that is not the thing
  // being banned, and the repair is an allowlist with a stated reason rather
  // than a looser pattern: loosening turns a guard into decoration, while an
  // exemption is something a reader can argue with.
  // `schema.integration.test.js` held an exemption here until #246 — its
  // anonymous sign-in was "purely a CREDENTIAL", which was true and still minted
  // one permanent auth user per run: 45 accumulated on the live project before
  // the count was traced back to it. The file signs in as the seeded account
  // now, the exemption is gone, and this scan is what keeps the call from
  // quietly returning. An exemption is something a reader can argue with; that
  // one lost the argument.
  const EXEMPT = {
    // #170 — the widened corpus reaches the tests that PROVE the retirement, and
    // a negative assertion has to spell the thing it denies. This is the shape
    // cairn records as a criterion refusing its own guard: satisfying "the model
    // is gone" destroys the instrument that would say so, because the only way
    // to assert an absence is to name what must be absent.
    //
    // Each of these is `not.toContain` / `not.toMatch`. None is reachable at
    // run time and none would survive a project on 0007 — they assert that it
    // would not.
    'src/lib/liveSchema.test.js': {
      household_devices:
        'a NEGATIVE assertion, not a reference: `expect(LIVE_TABLES).not.toContain(...)`. ' +
        'This repo shipped `household_devices` in LIVE_SCHEMA once and the check went red ' +
        'against a healthy project, so the name is pinned here precisely to keep it OUT.',
      claim_member:
        'named inside the array of dropped RPCs that LIVE_RPC_NAMES must NOT contain, so ' +
        'probing for them cannot make `check:live` red against a fully migrated project.',
      claim_member_with_pin: 'same array of dropped RPCs asserted absent from LIVE_RPC_NAMES.',
      set_member_pin: 'same array of dropped RPCs asserted absent from LIVE_RPC_NAMES.',
      join_household: 'same array of dropped RPCs asserted absent from LIVE_RPC_NAMES.',
    },
    'src/lib/household.test.js': {
      pin_hash:
        'a NEGATIVE assertion on the selected column list: `expect(call.cols).not.toMatch(...)`. ' +
        'It is what proves the client stopped asking for the credential columns 0007 dropped.',
      has_pin: 'same assertion, the generated companion column — asserted absent from every select.',
    },
  }

  const sourceOf = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')
  const namesIn = (source, file) => retiredNamesIn(source, { sql: isSqlPath(file) })
  const violationsIn = (file) => {
    const exempt = EXEMPT[file] ?? {}
    return namesIn(sourceOf(file), file).filter((f) => !exempt[f.name])
  }

  it('POSITIVE CONTROL: there is a corpus to scan, so an empty pass is impossible', () => {
    // #170 AC 2. Without this the whole describe passes the moment the filter
    // stops matching — a directory rename, a move to .ts, a git invocation that
    // returned nothing. An always-empty scan reads exactly like a clean tree,
    // and it is the failure a path change causes silently.
    expect(corpus.length).toBeGreaterThan(20)

    // Every directory the story names, asserted by a REAL tracked file rather
    // than by the predicate that admits it. A predicate tested against itself
    // proves nothing about what is on disk.
    expect(corpus).toContain('src/lib/household.js')
    expect(corpus).toContain('src/components/Roster.jsx')
    expect(corpus).toContain('supabase/functions/provision-member/index.ts')
    expect(corpus).toContain('supabase/migrations/0014_scope_reads_to_one_household.sql')
    for (const file of LIVE_SUITES) expect(corpus).toContain(file)

    // ...and the history boundary is real in both directions, or `0008+` is a
    // filter nobody has shown to exclude anything.
    expect(corpus).not.toContain('supabase/migrations/0007_per_member_auth.sql')
    expect(corpus).not.toContain('supabase/migrations/0001_household_and_roster.sql')
  })

  it('POSITIVE CONTROL: an UNTRACKED file is scanned, the day it lands and not the day it is staged', () => {
    // #170 AC 2, and the control has to CREATE the condition: on a clean tree
    // nothing is untracked, so the narrow command and the wide one return
    // byte-identical lists and a mutation dropping the flags reddens nothing.
    // That is what makes this blind spot invisible to every assertion over the
    // corpus as it stands.
    //
    // `supabase/functions/` is the one covered directory where a probe FILE is
    // safe. Three suites walk `src/` recursively at run time and two read
    // `supabase/migrations/` from disk, so a probe in either races the other
    // vitest workers; `edge-function-cors.test.js` filters that directory to
    // `isDirectory()` entries, so a loose file there is invisible to it.
    const probe = 'supabase/functions/.retired-probe.tmp.ts'
    const absolute = resolve(process.cwd(), probe)
    writeFileSync(absolute, "const spent = call('join_household')\n")
    try {
      const fresh = scanCorpus()
      expect(fresh, 'the corpus does not list an untracked file').toContain(probe)
      // End to end — listed, READ, and refused. Listing alone would pass with a
      // corpus nothing ever opens.
      expect(namesIn(sourceOf(probe), probe).map((f) => f.name)).toContain('join_household')
    } finally {
      rmSync(absolute, { force: true })
    }
    // Prove the cleanup rather than assuming it: a leftover probe is a failure
    // this file would otherwise report against the NEXT person's change.
    expect(scanCorpus()).not.toContain(probe)
  })

  it.each(corpus)('%s references nothing 0007 dropped', (file) => {
    const found = violationsIn(file)
    expect(
      found,
      found.length
        ? `${file} still references the retired model: ` +
          found.map((f) => `${f.name} (line ${f.line})`).join(', ')
        : '',
    ).toEqual([])
  })

  it.each(COVERED)(
    'POSITIVE CONTROL: a planted name is refused in $dir, naming the file and the most specific match',
    ({ dir, matches }) => {
      // #170 AC 3. One plant per covered directory, because proving a single
      // plant cannot distinguish a corpus covering four directories from one
      // covering three — a pass on `src/lib` says nothing about migrations.
      //
      // Planted into a real corpus file's CONTENT rather than onto disk. The
      // AC's `finally` assumes an on-disk plant, and on-disk is unsafe here for
      // the reason the untracked probe above records: `src/` is walked by three
      // suites and `supabase/migrations/` is read by the pglite harness, both at
      // run time and both in parallel workers, so a plant in either could be
      // read mid-write or applied to Postgres as a call to a dropped function.
      // Nothing is left behind because nothing is written — the risk the
      // `finally` manages is removed by construction rather than cleaned up.
      const host = corpus.find((path) => matches(path) && violationsIn(path).length === 0)
      expect(host, `no clean corpus file under ${dir} to plant into`).toBeTruthy()

      // `claim_member_with_pin` carries two claims at once: that the plant is
      // found, and that the report names the MOST SPECIFIC match — the shorter
      // `claim_member` is a prefix of it, and naming that one sends a reader
      // hunting a call that is not there.
      const statement = isSqlPath(host)
        ? "select public.claim_member_with_pin('x');"
        : "await client.rpc('claim_member_with_pin')"
      const found = namesIn(`${sourceOf(host)}\n${statement}\n`, host)
      const names = found.map((f) => f.name)

      expect(names, `${dir}: the plant was not detected in ${host}`).toContain(
        'claim_member_with_pin',
      )
      expect(names, `${dir}: reported the prefix instead of the specific name`).not.toContain(
        'claim_member',
      )
      // The line, so the failure message can name a place. The plant is the last
      // line, derived rather than spelled out.
      const plantLine = sourceOf(host).split('\n').length + 1
      expect(found.find((f) => f.name === 'claim_member_with_pin').line).toBe(plantLine)
    },
  )

  it('DAMAGE CONTROL: over the real corpus, blanking touches comment lines and nothing else', () => {
    // #170 AC 4, on the real corpus rather than on synthetic input, and shaped
    // like the DAMAGE: the failure worth catching is a transform that ate code,
    // not one that ate everything. A landmark surviving at the end of a file
    // cannot tell those apart — cairn records a comment-stripper that had been
    // deleting a configuration line for its whole life while its control, a key
    // at the end of the file, stayed green.
    //
    // The oracle is LINE-LEVEL and so is independent of the character-level
    // state machine it is checking: a line carrying no comment marker, outside
    // any block comment, must come back byte-identical. An unterminated string
    // or a mis-set flag blanks exactly those lines, and this names each one.
    const offenders = []
    for (const file of corpus) {
      const source = sourceOf(file)
      const blanked = isSqlPath(file) ? blankSqlComments(source) : blankComments(source)
      expect(blanked, `${file}: blanking changed the file's length, so offsets have shifted`)
        .toHaveLength(source.length)

      const before = source.split('\n')
      const after = blanked.split('\n')
      const marker = isSqlPath(file) ? /--|\/\*|\*\// : /\/\/|\/\*|\*\//
      let insideBlock = false

      before.forEach((line, index) => {
        if (!insideBlock && !marker.test(line) && after[index] !== line) {
          offenders.push(`${file}:${index + 1}`)
        }
        const opens = line.includes('/*')
        const closes = line.includes('*/')
        if (opens && !closes) insideBlock = true
        else if (closes) insideBlock = false
      })
    }
    expect(
      offenders,
      `blanking rewrote lines that carry no comment: ${offenders.slice(0, 10).join(', ')}`,
    ).toEqual([])
  })

  it('every exemption is still needed', () => {
    // An exemption whose subject has left is a hole waiting for somebody to
    // reuse the string — the same assertion `gate.test.js` makes about its own
    // NOT_NAMES list, for the same reason. It is also the check nobody thinks
    // of: an allowlist is written once and then only ever grows.
    const unnecessary = []
    for (const [file, names] of Object.entries(EXEMPT)) {
      const found = namesIn(sourceOf(file), file).map((f) => f.name)
      for (const name of Object.keys(names)) {
        if (!found.includes(name)) unnecessary.push(`${name} (${file})`)
      }
    }
    expect(unnecessary, 'these exemptions no longer exempt anything — delete them').toEqual([])
  })

  it('every exempted file is actually in the corpus', () => {
    // The other direction, and the one that rots silently: an exemption for a
    // file the scan no longer reaches is not a hole, it is a claim that the
    // guard covers something it does not. `every exemption is still needed`
    // above would go green on it forever, because a file nobody scans yields no
    // findings and an exemption for nothing looks the same as one for a file
    // that has left the corpus.
    const unscanned = Object.keys(EXEMPT).filter((file) => !corpus.includes(file))
    expect(unscanned, 'exemptions for files the corpus does not cover').toEqual([])
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
