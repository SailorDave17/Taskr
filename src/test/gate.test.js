import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// AC 4 of #4: "a test suite containing zero tests must FAIL rather than pass
// vacuously — an explicit fail-on-empty setting".
//
// This guards the SETTING, not the code. cairn's `prove-a-guard-test-can-fail`
// records the reason: a suite whose meaning depends on a configuration passes
// vacuously the moment that configuration stops applying, and code-only tests
// say nothing about the ground they stand on. Deleting the config line must
// redden something, so here it is.
describe('the CI gate can actually fail', () => {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')

  it('pins passWithNoTests to false explicitly, rather than relying on the default', () => {
    expect(config).toMatch(/passWithNoTests:\s*false/)
  })

  it('runs vitest in run mode in CI, so a watcher never hangs the pipeline green', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts.test).toBe('vitest run')
  })

  it('has a lint script, because the CI workflow claims to run one', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts.lint).toBeTruthy()
  })
})

// #63 — a data-layer function with no caller is not a feature, and every signal
// short of this one said it was.
//
// `claimMemberWithPin` was exported from src/lib/household.js and covered by
// household.test.js ("claims a person by proving you are them, via the PIN
// route"). No component called it, so the bundler dropped it: the deployed
// bundle contained `claim_member` and not `claim_member_with_pin`. Meanwhile
// Roster.jsx correctly hid "this is me" from anyone holding a PIN, deferring to
// a flow that did not exist — and set_member_pin releases that person's phone,
// so setting a PIN locked them out.
//
// This reads source rather than behaviour, which is the same shape as the
// passWithNoTests guard above and for the same reason: the property is about
// the ground the other tests stand on, and no behavioural test can see it,
// because a unit test calls the function directly and is happy.
describe('the credential flow is reachable from the app, not just exported', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  // #62 replaced the functions this guard names, and the guard is kept rather
  // than retired because the FAILURE it caught is a property of the shape, not
  // of those two names: a credential path is exactly the kind of code that can
  // be exported, unit-tested and reachable by nobody. The names below are the
  // new ones; if they are ever the wrong names, this test fails loudly, which is
  // the intended cost.
  it('imports both halves of the sign-in path from the data layer', () => {
    // Both, because they fail differently. Without `signIn` an existing member
    // cannot get back in; without `signUpOrganizer` a new household cannot be
    // made at all, since `create_household` refuses an unauthenticated caller.
    expect(app).toMatch(/\bsignIn\b/)
    expect(app).toMatch(/\bsignUpOrganizer\b/)
  })

  it('hands them to onboarding, which is the only place a person can reach them', () => {
    expect(app).toMatch(/onSignIn=\{/)
    expect(app).toMatch(/onCreate=\{/)
  })

  it('and offers a way back out, which device auth never needed', () => {
    // A session is a PERSON now. On a shared family tablet, no sign-out means no
    // way to stop being that person — and no way to correct signing in as the
    // wrong one.
    expect(app).toMatch(/\bsignOut\b/)
    expect(app).toMatch(/onSignOut=\{/)
  })
})

// #34 — the same shape as the #63 guard above, applied to the chore flow while
// it is being built rather than after it ships broken.
//
// cairn's `exported-is-not-reachable` records the general form: a unit test
// calls a function directly and is happy, so no behavioural test can answer
// "is there a path from a person to this code?". The chore data layer could be
// fully exported, fully unit-tested, and dropped by the bundler for want of a
// caller — which is exactly what happened to claimMemberWithPin.
describe('the chore flow is reachable from the app, not just exported', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  it('imports the chore data layer', () => {
    expect(app).toMatch(/from '\.\/lib\/chores\.js'/)
  })

  it('renders the chore screen, which is the only place a person can reach it', () => {
    expect(app).toMatch(/<Chores\b/)
  })

  it('wires every write ON THE CHORE ELEMENT, not merely somewhere in the file', () => {
    // Scoped to the <Chores> element on purpose. Measured 2026-08-08: the
    // unscoped version stayed GREEN when the whole <Chores /> render was
    // deleted, because <Roster> carries onAdd, onSave and onRemove too — the
    // test passed on a neighbour and pinned nothing about chores.
    //
    // #36 added assignment, and it is the case the general form was written for:
    // <Roster> has no onAssign, so an unscoped grep would have passed on the
    // element list alone while the control reached nobody.
    const element = app.match(/<Chores[\s\S]*?\/>/)
    expect(element, 'no <Chores .../> element in App.jsx').not.toBeNull()
    expect(element[0]).toMatch(/onAdd=\{/)
    expect(element[0]).toMatch(/onSave=\{/)
    expect(element[0]).toMatch(/onRemove=\{/)
    expect(element[0]).toMatch(/onAssign=\{/)
    expect(element[0]).toMatch(/onUnassign=\{/)
    // The load figures are derived from these two, so a <Chores> that renders
    // without them shows every person carrying nothing — a plausible screen
    // rather than a broken one, which is why it is pinned here.
    expect(element[0]).toMatch(/members=\{/)
    expect(element[0]).toMatch(/capacities=\{/)
  })

  it('imports the assignment writes, so the RPCs are not dead exports', () => {
    expect(app).toMatch(/\bassignChore\b/)
    expect(app).toMatch(/\bunassignChore\b/)
  })
})

// #46 — the capacity flow, same shape and the same reason.
//
// This one had already happened here and is not hypothetical: `listCapacity`,
// `setCapacity` and `clearCapacity` shipped with #44 and sat exported, tested at
// no level, with NO CALLER for five days. The allocator (#40) is still in that
// state. A unit test cannot see it, because a unit test supplies its own caller.
describe('the capacity flow is reachable from the app, not just exported', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')

  it('imports the capacity data layer', () => {
    expect(app).toMatch(/from '\.\/lib\/capacity\.js'/)
  })

  it('reads this week from the server, rather than resolving overrides it never fetched', () => {
    // capacitiesFor with a hard-coded [] is exactly what #36 shipped, and it was
    // correct then because nothing could write a row. Once #46 makes them
    // writable, an empty literal here means every override is silently ignored
    // while every number on screen stays plausible.
    // A CALL, not the identifier. Measured while mutating this: deleting the
    // call left the import line in place, which satisfies a bare name grep — so
    // the check proved the import existed and said nothing about anything using
    // it. That is exported-is-not-reachable, arriving inside the guard written
    // to catch exported-is-not-reachable.
    expect(app).toMatch(/listCapacity\(/)
    expect(app).not.toMatch(/capacitiesFor\(\s*members\s*,\s*\[\s*\]/)
  })

  it('wires both writes ON THE ROSTER ELEMENT, not merely somewhere in the file', () => {
    // Scoped for the reason the chore version records: an unscoped grep passes
    // on a neighbour. <Chores> carries neither of these, so the scoping is what
    // makes the assertion about the roster.
    const element = app.match(/<Roster[\s\S]*?\/>/)
    expect(element, 'no <Roster .../> element in App.jsx').not.toBeNull()
    expect(element[0]).toMatch(/onSetCapacity=\{/)
    expect(element[0]).toMatch(/onClearCapacity=\{/)
    expect(element[0]).toMatch(/overrides=\{/)
  })
})

// The date guards in src/lib/chores.test.js are meaningless in UTC — measured,
// the local-getter bug they exist for reddens 3 of them at GMT-0400 and none at
// UTC. Same shape as the passWithNoTests guard at the top of this file: the
// property is about the ground the other tests stand on.
describe('the suite runs in a zone where a date bug can show', () => {
  const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')

  it('pins a timezone rather than inheriting the runner', () => {
    expect(config).toMatch(/env:\s*\{\s*TZ:/)
  })

  it('and the pinned zone is not UTC, which is the zone that hides the bug', () => {
    const pinned = config.match(/TZ:\s*'([^']+)'/)
    expect(pinned, 'no TZ value found in vite.config.js').not.toBeNull()
    expect(pinned[1]).not.toMatch(/^(UTC|Etc\/UTC|GMT)$/i)
  })

  it('POSITIVE CONTROL: the pin actually reaches the running process', () => {
    // Asserting the config text alone would pass if vitest ignored the setting.
    expect(new Date('2026-08-10').getTimezoneOffset()).not.toBe(0)
  })
})

// #34, added after review-fanout found that NONE of the eight chore* class
// names had a rule anywhere — the feature would have shipped as an unstyled
// bulleted list beside a fully styled roster, and nothing failed.
//
// This is the third guard in this file with the same shape: the property is
// about the ground the other tests stand on, and no behavioural test can see
// it. jsdom applies no stylesheet, so every component test passes identically
// whether or not a single rule exists.
describe('every class name a component emits has a rule in the stylesheet', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const components = ['src/App.jsx', 'src/components/Chores.jsx', 'src/components/Roster.jsx', 'src/components/Onboarding.jsx']

  const emitted = new Set()
  for (const file of components) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const [, value] of source.matchAll(/className="([^"{]+)"/g)) {
      for (const name of value.split(/\s+/).filter(Boolean)) emitted.add(name)
    }
  }

  it('finds class names to check, so an empty pass is impossible', () => {
    // Without this the whole describe passes vacuously the moment the regex
    // stops matching — a switch to clsx, or to template-literal classNames.
    expect(emitted.size).toBeGreaterThan(15)
    expect(emitted).toContain('chore')
  })

  it('has a rule for each one', () => {
    const missing = [...emitted].filter((name) => !css.includes(`.${name}`)).sort()
    expect(missing, `no CSS rule for: ${missing.join(', ')}`).toEqual([])
  })
})

// #82 / #83 - phone-width layout, asserted against the STYLESHEET rather than
// the rendered DOM. jsdom applies no stylesheet and computes no layout, so a
// component test here would pass identically with these rules deleted. That is
// the vacuity #80 and #82 both record, and the reason both issues ask for a
// stylesheet assertion or a dated owner observation instead of a render test.
//
// Comments are stripped before matching: the #83 comment contains `{name}`, and
// a `[^}]*` scan would stop at that brace and fail for the wrong reason.
describe('the phone-width action row keeps its buttons together', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const roster = readFileSync(resolve(process.cwd(), 'src/components/Roster.jsx'), 'utf8')
  const chores = readFileSync(resolve(process.cwd(), 'src/components/Chores.jsx'), 'utf8')

  it('#82: stretches whatever lands on a wrapped line, so no button is left an orphan', () => {
    expect(css).toMatch(/\.row--actions\s*>\s*\.button\s*\{[^}]*flex:\s*1\s+1\s+auto/)
  })

  it('#82: both action rows opt in, so it is one rule and not a per-screen patch', () => {
    expect(roster).toContain('className="row row--end row--actions"')
    expect(chores).toContain('className="row row--end row--actions"')
  })

  it('#82: the opt-in stays narrow — one row per screen, never `.row--end` at large', () => {
    // This test used to name the two PIN forms: they carried `.row--end` without
    // `.row--actions`, and they were the evidence that hanging the stretch off
    // `.row--end` would have restyled buttons nobody had measured.
    //
    // #62 deleted both forms, so that evidence is gone and the second assertion
    // — "something uses bare `.row--end`" — went to zero. It was NOT simply
    // dropped: an assertion whose subject has left is exactly the shape that
    // goes on passing while measuring nothing. What it was really protecting is
    // that `.row--actions` is applied deliberately and in one place, which is
    // still true and still checkable.
    expect([...roster.matchAll(/row--actions/g)]).toHaveLength(1)
    expect([...chores.matchAll(/row--actions/g)]).toHaveLength(1)
    // And the stretch rule is keyed on the opt-in, not on `.row--end`, so a row
    // that has not been measured cannot inherit it.
    expect(css).not.toMatch(/\.row--end\s*>\s*\.button\s*\{[^}]*flex:\s*1\s+1\s+auto/)
  })

  it('#83: a label with no wrap opportunity breaks instead of overflowing the row', () => {
    expect(css).toMatch(/\.button\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
})

// #69 — the README carries two hand-maintained lists beside things that change:
// the scripts table beside package.json, and the docs list beside docs/. Both
// had already fallen behind (`npm run test:rls` and `docs/access-model.md` were
// missing) and nothing said so.
//
// Same shape as #34 AC 8, which guards supabase/migrations against the
// MIGRATIONS array, and the same reason: a hand-maintained list that nothing
// compares against its source drifts silently, and prose asking a human to keep
// two lists in step is how it recurs.
describe('the README lists nothing has fallen behind', () => {
  const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8')

  /**
   * The body of one `##` section, so a check means "listed HERE" rather than
   * "mentioned somewhere in the file".
   *
   * MEASURED while proving these tests: without this, deleting
   * `docs/access-model.md` from the docs list reddened NOTHING, because the
   * Status section also links it and a whole-file `includes` was satisfied by
   * that. The assertion was wider than the property it was named for — a
   * document can be cited in passing and still be missing from the list a
   * reader scans to find it.
   */
  function section(heading) {
    const start = readme.indexOf(heading)
    expect(start, `no section titled ${heading}`).toBeGreaterThan(-1)
    const after = readme.indexOf('\n## ', start + heading.length)
    return readme.slice(start, after === -1 ? undefined : after)
  }

  it('names every script in package.json, in the scripts table', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    const running = section('## Running it locally')
    const missing = Object.keys(pkg.scripts).filter(
      (name) => !running.includes(`npm run ${name}`) && !running.includes(`npm ${name}`),
    )
    expect(missing, `the scripts table omits: ${missing.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: there are scripts to check, so an empty pass is impossible', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(Object.keys(pkg.scripts).length).toBeGreaterThan(4)
  })

  it('links every document in docs/ from one of the two sections that list them', () => {
    // The README splits the docs deliberately: ci-gate.md and deploy-runbook.md
    // are linked from "CI and deployment", which is why the other section is
    // called "The REST of docs/". Checking only the second one fails on a
    // correct README; checking the whole file is too loose — MEASURED, deleting
    // access-model.md from the list reddened nothing, because the Status
    // section also links it in passing. The union of the two listing sections
    // is the property: every document is reachable from somewhere a reader
    // scans to find one.
    const docs = readdirSync(resolve(process.cwd(), 'docs')).filter((f) => f.endsWith('.md'))
    const listed = section('## CI and deployment') + section('## The rest of `docs/`')
    const missing = docs.filter((name) => !listed.includes(name))
    expect(missing, `no docs section links: ${missing.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: there are docs to check', () => {
    const docs = readdirSync(resolve(process.cwd(), 'docs')).filter((f) => f.endsWith('.md'))
    expect(docs.length).toBeGreaterThan(3)
    expect(docs).toContain('access-model.md')
  })

  it('does not still claim the app persists nothing', () => {
    // The specific sentence that was wrong for four stories. Narrow on purpose:
    // a general "is the README current?" test cannot exist, but this one claim
    // was load-bearing enough to mislead a reader about the whole repo.
    expect(readme).not.toMatch(/persists nothing|no database wired up/i)
  })
})

// #36 — AC 10, as a check rather than as a promise.
//
// The AC says the component tests for this screen must not assert an access rule
// through the fake Supabase client. That is a property of a FILE, so no
// behavioural test can see it and a reviewer reading carefully is the only thing
// that would catch a regression — which is the shape every other guard in this
// file exists for.
//
// The reason it matters: a fake client returns whatever the test tells it to. It
// cannot refuse. A test that "proves" a household boundary against one has proved
// that the test author wrote a rejection into a stub, and it stays green with the
// column grants deleted, the policies dropped and the definer functions gone.
// docs/access-model.md and cairn's supabase-rls-column-grants note both record
// the live version of that mistake.
describe('AC 10 — no component test proves an access rule', () => {
  // Comments are stripped before scanning, and that is not a convenience: this
  // very check tripped on the docblock in Chores.test.jsx EXPLAINING the rule.
  // A guard that a correct file fails is a guard that gets deleted. Same helper
  // shape as capacity.test.js codeOf, for the same reason.
  const codeOf = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const componentTests = readdirSync(resolve(process.cwd(), 'src/components'))
    .filter((name) => name.endsWith('.test.jsx'))
    .map((name) => ({
      name,
      text: codeOf(readFileSync(resolve(process.cwd(), 'src/components', name), 'utf8')),
    }))

  // POSTGRES vocabulary, deliberately not the human-readable refusals.
  //
  // A first version of this list included the definer functions own sentences —
  // "no such chore in your household", "already claimed on another device" — and
  // it fired on Roster.test.jsx, which uses the second as the NAME OF A UI STATE
  // while asserting that a button is not offered. That is not an access-rule
  // proof, and neither would a test be that renders a server message to check it
  // reaches the screen: displaying a refusal is a legitimate component concern.
  //
  // What is left is vocabulary a component has no way to produce. A privilege
  // error, a policy violation and the privilege catalogs belong to Postgres, so
  // one appearing in a component test means a stub was taught to speak as the
  // database — which is the thing AC 10 forbids.
  const DATABASE_REFUSALS =
    /permission denied|violates row-level|row-level security policy|column_privileges|table_privileges|grant (update|select|insert)|insufficient privilege/i

  it('finds component tests to check, so an empty pass is impossible', () => {
    expect(componentTests.length).toBeGreaterThan(2)
    expect(componentTests.map((f) => f.name)).toContain('Chores.test.jsx')
  })

  it('none of them stands up a Supabase client, fake or real', () => {
    // The strongest available form: a file with no client cannot assert a rule
    // through one. These components take data and handlers as props, so there is
    // nothing legitimate for a client to be doing in their tests.
    const offenders = componentTests
      .filter((f) => /supabase/i.test(f.text))
      .map((f) => f.name)
    expect(offenders, `component tests referencing a Supabase client: ${offenders.join(', ')}`).toEqual([])
  })

  it('and none of them asserts a refusal that only the database can make', () => {
    const offenders = componentTests.filter((f) => DATABASE_REFUSALS.test(f.text)).map((f) => f.name)
    expect(offenders, `component tests asserting a database refusal: ${offenders.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: the refusal pattern fires where those claims legitimately live', () => {
    // Without this, the two assertions above pass identically if the regex is
    // wrong — and an always-empty scan reads exactly like a clean bill of health.
    const pglite = codeOf(
      readFileSync(resolve(process.cwd(), 'src/test/assignment.pglite.test.js'), 'utf8'),
    )
    expect(DATABASE_REFUSALS.test(pglite), 'the pattern must match the suite that does prove these').toBe(true)
  })
})

// #87 AC 1 — the `service_role` key must never reach the client bundle.
//
// The Edge Function holds a key that BYPASSES row-level security entirely: with
// it, every policy in supabase/migrations/ is void. `src/lib/keyShape.js` already
// refuses at build time if a secret key is put in a `VITE_` variable, but that
// guards the VALUE. This guards the BOUNDARY — that the code which names the key
// lives somewhere Vite cannot reach.
//
// Asserted on source rather than on `dist/`, deliberately. The bundle is built
// FROM `src/`, so "no file under src/ names the secret" is the property that
// makes inlining impossible, and it can be checked on every run. A dist/ scan
// would need a build to have happened first and would SKIP when it had not,
// which is the vacuous-pass shape this file exists to refuse.
describe('#87 — the service_role key cannot reach the client bundle', () => {
  const srcDir = resolve(process.cwd(), 'src')

  function filesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = resolve(dir, entry.name)
      return entry.isDirectory() ? filesUnder(full) : [full]
    })
  }

  // The two spellings that matter: the env var the function reads, and the
  // prefix of a modern secret key. Legacy JWT secret keys are covered by
  // keyShape.js at build time, which reads the role claim rather than a prefix.
  const FORBIDDEN = [/SUPABASE_SERVICE_ROLE_KEY/, /sb_secret_/]

  // A guard whose subject is SOURCE TEXT cannot tell the hazard from prose
  // about the hazard, so it refuses the very code written to detect it. Measured
  // on the first run of this test: it flagged keyShape.js — the build-time check
  // that exists to catch a secret key — plus its own tests.
  //
  // The repair is an allowlist with a stated reason per entry, NOT a looser
  // pattern. Loosening is what turns a guard into decoration; an allowlist keeps
  // the refusal sharp and turns each exemption into something a reader can argue
  // with. Every entry is asserted to still exist below, so a rename cannot
  // silently widen the exemption into a hole.
  const ALLOWED = {
    'src/lib/keyShape.js': 'the build-time detector itself — it must name what it refuses',
    'src/lib/keyShape.test.js': 'proves the detector can fail, using real secret-key shapes',
    'src/lib/supabase.test.js': 'asserts the client refuses a secret key',
    'src/test/gate.test.js': 'this file — the patterns above and the prose around them',
  }

  function repoPath(file) {
    return file.slice(process.cwd().length + 1).split('\\').join('/')
  }

  it('no file under src/ names the service_role key, outside the allowlist', () => {
    const offenders = []
    for (const file of filesUnder(srcDir)) {
      if (!/\.(js|jsx|ts|tsx)$/.test(file)) continue
      const relative = repoPath(file)
      if (ALLOWED[relative]) continue
      const text = readFileSync(file, 'utf8')
      if (FORBIDDEN.some((pattern) => pattern.test(text))) {
        offenders.push(relative)
      }
    }
    expect(offenders, `these files could inline a secret key: ${offenders.join(', ')}`).toEqual([])
  })

  it('every allowlisted file still exists, so a rename cannot widen the exemption', () => {
    const missing = Object.keys(ALLOWED).filter((relative) => {
      try {
        readFileSync(resolve(process.cwd(), relative), 'utf8')
        return false
      } catch {
        return true
      }
    })
    expect(missing, `allowlist names files that are gone: ${missing.join(', ')}`).toEqual([])
  })

  it('every allowlisted file actually contains a forbidden pattern', () => {
    // An exemption for a file that no longer needs one is a hole waiting for
    // somebody to paste a key into a path already marked safe.
    const unnecessary = Object.keys(ALLOWED).filter((relative) => {
      const text = readFileSync(resolve(process.cwd(), relative), 'utf8')
      return !FORBIDDEN.some((pattern) => pattern.test(text))
    })
    expect(unnecessary, `these exemptions are no longer needed: ${unnecessary.join(', ')}`).toEqual(
      [],
    )
  })

  it('POSITIVE CONTROL: the Edge Function DOES name it, so the search works', () => {
    // Without this the test above passes just as happily against a typo in the
    // pattern, or if the function were deleted — an absence proving nothing.
    // The function lives outside src/, which is the whole point.
    const fn = readFileSync(
      resolve(process.cwd(), 'supabase/functions/provision-member/index.ts'),
      'utf8',
    )
    expect(fn).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('the Edge Function is outside src/, so the bundler cannot follow an import', () => {
    const offenders = []
    for (const file of filesUnder(srcDir)) {
      if (!/\.(js|jsx|ts|tsx)$/.test(file)) continue
      const text = readFileSync(file, 'utf8')
      if (/from\s+['"][^'"]*supabase\/functions/.test(text)) {
        offenders.push(file.slice(process.cwd().length + 1))
      }
    }
    expect(offenders, `src/ imports the Edge Function: ${offenders.join(', ')}`).toEqual([])
  })
})
