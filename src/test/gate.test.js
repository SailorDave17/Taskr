import { execSync } from 'node:child_process'
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
    //
    // #75: the first form of this control asserted only "the offset is not
    // zero", which passes on any machine whose own zone is non-UTC — including
    // the machine the suite was written on, which sat in the pinned zone. It
    // could discriminate on a UTC runner and nowhere else, i.e. in CI and never
    // on the laptop where vite.config.js actually gets edited.
    //
    // Two assertions against the value read out of the config, with different
    // blind spots. env.TZ proves vitest APPLIED the setting — and still fails
    // on pin deletion when the machine's default zone happens to equal the
    // pinned one, because a machine default arrives from the OS, not through
    // the TZ variable. The resolved zone proves Node HONOURED it — measured on
    // Windows, a TZ set at process start and one set at runtime both move
    // Intl and Date together, so this reads the same clock the date tests use.
    // The residual blind spot is a developer who exports TZ=<the pinned zone>
    // in their own shell; the zone below is chosen so that nobody plausibly
    // does.
    const pinned = config.match(/TZ:\s*'([^']+)'/)
    expect(pinned, 'no TZ value found in vite.config.js').not.toBeNull()
    expect(process.env.TZ).toBe(pinned[1])
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(pinned[1])
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

  // The spellings that matter: the env vars a function reads, and the prefixes
  // of a modern secret. Legacy JWT secret keys are covered by keyShape.js at
  // build time, which reads the role claim rather than a prefix.
  //
  // The Google pair arrives with #95, and the second Edge Function is why the
  // list had to grow rather than stay put. `GOOGLE_CLIENT_SECRET` is the name
  // `calendar-connect` reads from its environment; `GOCSPX-` is the prefix of
  // the value, and it is here because a NAME is only forbidden where somebody
  // remembers to use one — a value pasted straight into a `VITE_` line has no
  // name attached to it at all.
  //
  // Note what this does NOT cover, deliberately: a Google refresh token
  // (`1//…`). It is guarded by `keyShape.js`, which is the right place, and a
  // two-character prefix is too weak to grep source with — it would match a
  // protocol-relative URL and a comment about integer division. A guard that
  // cries wolf gets run with --no-verify.
  const FORBIDDEN = [
    /SUPABASE_SERVICE_ROLE_KEY/,
    /sb_secret_/,
    /GOOGLE_CLIENT_SECRET/,
    /GOCSPX-/,
  ]

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

  it('POSITIVE CONTROL: every pattern matches something, so none is a dead entry', () => {
    // #95 doubled the list, and a pattern that matches nothing anywhere is
    // indistinguishable from one that is working — the scan comes back clean
    // either way. So each is exercised against a file OUTSIDE `src/` that
    // genuinely carries it: `calendar-connect` reads the Google secret from its
    // environment, and its own test plants a `GOCSPX-` fixture. A typo in any of
    // the four reddens here rather than going quiet in the scan above.
    const outsideSrc = [
      'supabase/functions/provision-member/index.ts',
      'supabase/functions/calendar-connect/handler.ts',
      'supabase/functions/calendar-connect/handler.test.js',
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
      .join('\n')

    const dead = FORBIDDEN.filter((pattern) => !pattern.test(outsideSrc))
    expect(dead, `these patterns match nothing at all: ${dead.join(', ')}`).toEqual([])
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

// #19 — no real household name, and no screenshot, reaches version control.
//
// The decision is docs/data-outside-production.md; this is the half a check can
// see. The measured fact that makes it a guard rather than a preference: a
// preview bundle carries the PRODUCTION Supabase host — measured 2026-08-20, the
// same host production serves. Previews were world-readable until 2026-08-21,
// and a name committed here is in git whether or not a URL is gated.
//
// #19 decided to gate previews behind a custom domain; #121 applied it on
// 2026-08-21, and that does NOT retire this guard — it is the reason the
// guard is worth having rather than the reason it is not. A name in version
// control is exposed to everyone with repository access, to every future
// reader, and to whatever
// the hosting arrangement happens to be on the day; gating one URL changes none
// of those. #121 has landed and this block stays.
//
// The obvious design is unavailable. A DENYLIST of the household's real names
// would put those names in git, which is the exact thing being prevented. So the
// vocabulary is positive: every name-shaped literal must be DECLARED, which
// converts "somebody committed a real name" into "somebody added a name to a
// list, in a diff, where a human can see it". That is the whole of what a check
// can do here — none of these assertions can tell a real name from a plausible
// one, and the doc says so rather than implying otherwise.
//
// Two scans, with DIFFERENT blind spots, and neither is sufficient alone:
//
//   SHAPE    — every capitalised-word-shaped literal in the corpus, in ANY
//              position, so a name cannot hide in syntax nobody taught the
//              check about. Blind to a name written in lower case.
//   POSITION — every person-shaped literal in a name POSITION, case
//              insensitively, so `name: 'alex'` is caught. Blind to a position
//              not on the list.
//
// The single-letter household 'H' is the worked example of why both exist: it
// fails the shape test (one character) and is caught by position alone.
describe('#19 — no real household name reaches version control', () => {
  const tracked = execSync('git ls-files -z', {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)

  // Discovered, never hard-coded: a test file added tomorrow is scanned the day
  // it lands. A hand-maintained corpus list is the drift this file already
  // guards against twice (the README lists, the migrations array).
  //
  // gate.test.js excludes ITSELF, and the reason is the hazard cairn records as
  // `a-guard-that-reads-source-must-survive-its-own-docs`: the declaration
  // cannot be its own subject. Every vocabulary entry appears in this file as a
  // literal, and the positive control below must contain a name the vocabulary
  // REFUSES — so scanning this file would refuse the correct file. The cost is
  // stated rather than hidden: a real name pasted into this file is not caught
  // by these assertions.
  const corpus = tracked.filter(
    (path) =>
      path !== 'src/test/gate.test.js' &&
      (/^src\/.*\.test\.jsx?$/.test(path) ||
        /^src\/test\/.*\.jsx?$/.test(path) ||
        path === 'src/lib/allocation.corpus.js' ||
        /^supabase\/(migrations|seed)[^\n]*\.sql$/.test(path)),
  )

  // Comments stripped before scanning, per extension. A `--` strip on JavaScript
  // would eat a decrement operator, and a `//` strip on SQL would eat nothing
  // useful, so the two are not interchangeable.
  //
  // Split out from codeOf so it can be exercised on text rather than only on the
  // corpus, and the reason is a MEASURED finding: deleting the stripping
  // entirely reddened NOTHING here, because no comment in the corpus happens to
  // QUOTE an undeclared name today. The defence against
  // `a-guard-that-reads-source-must-survive-its-own-docs` is real, the corpus
  // does not exercise it, and an unexercised defence is one nobody has asked.
  // The positive control below asks it.
  function stripComments(text, isSql) {
    const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
    return isSql
      ? withoutBlocks.replace(/--[^\n]*/g, ' ')
      : withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  }

  function codeOf(path) {
    return stripComments(readFileSync(resolve(process.cwd(), path), 'utf8'), path.endsWith('.sql'))
  }

  // One to three words, first word capitalised and NOT all-caps — which is what
  // keeps SELECT, POST, JWT and UTC out without an exemption each.
  const NAME_SHAPE = /^[A-Z][a-z][A-Za-z'’-]*(?: [A-Z][A-Za-z'’-]*){0,2}$/
  // The same shape with the capital dropped, used only inside a name position,
  // where a lower-case word IS the interesting case.
  const PERSON_SHAPE = /^[A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*){0,2}$/

  // The arguments and keys that CREATE a person or a household. `\bname` does
  // not match `table_name` or `function_name`, which is why the SQL identifiers
  // those tests carry need no exemptions.
  const NAME_POSITIONS = [
    /create_household\(\s*'([^']*)'\s*,\s*'([^']*)'/g,
    /create_household\(\s*'([^']*)'/g,
    /organizer_?name\s*[:=]\s*['"]([^'"]*)['"]/gi,
    // Both spellings. The column is `display_name` and the client prop is
    // `displayName`, and `\bname` below matches NEITHER — the underscore is a
    // word character, so there is no boundary in front of `name`. Found by
    // reading the fixtures rather than by the mutation pass, which would have
    // reported a clean POSITION scan while every member name in every component
    // fixture was covered by the shape scan alone.
    /display_?[Nn]ame\s*[:=]\s*['"]([^'"]*)['"]/g,
    /\bname\s*:\s*['"]([^'"]*)['"]/g,
    /\bname\s*=\s*'([^']*)'/g,
  ]

  // The vocabulary. People and households only — audited against the real
  // household by the owner on 2026-08-20, which is an OBSERVATION and not
  // something these assertions establish. Alex, Robin and Sam are ordinary
  // given names rather than structured placeholders, and they are declared for
  // that reason: they are the entries a reader should look at hardest.
  const PLACEHOLDER_NAMES = new Set([
    'Alex', 'Robin', 'Sam',
    'Organizer', 'Person', 'Kid', 'Sibling', 'Spare', 'Second Child', 'Third Child',
    'Intruder', 'Hijacked', 'Smuggled', 'Not Yet Provisioned', 'Kid renamed',
    'Placeholder', 'Placeholder One', 'Placeholder One Renamed', 'Placeholder Two',
    'Placeholder Three', 'Placeholder Child', 'Placeholder Organizer', 'Renamed Placeholder',
    'Placeholder Household', 'Placeholder Other Household', 'Placeholder Other Organizer',
    'Other', 'Other Org', 'Other Household', 'Other Organizer',
    'Mutant Household', 'Mutant Organizer',
    'Ours', 'Theirs', 'Mine now', 'H',
  ])

  // Literals that match a scan and are not names. Each carries its reason, and
  // each is asserted below to still be NEEDED — an exemption whose subject has
  // left is a hole waiting for somebody to reuse the string.
  const NOT_NAMES = {
    Dishes: 'a chore title in App.test.jsx',
    'Placeholder Chore': 'a chore title',
    'Placeholder Other Chore': 'a chore title',
    // #37 AC 4's fixture needs four chores in one household. Declared rather
    // than written in lower case to slip past the shape scan, which would have
    // worked and would have been the wrong instinct: the point of this
    // vocabulary is that every name-shaped literal is a line in a diff somebody
    // can look at.
    'Placeholder Third Chore': 'a chore title',
    'Placeholder Fourth Chore': 'a chore title',
    Taskr: 'the application name',
    Monday: 'the week boundary, asserted in capacity.test.js',
    'nothing to do': 'an allocation corpus scenario name',
    'provision-member': 'the Edge Function name',
    FunctionsFetchError: 'a supabase-js error class',
    FunctionsHttpError: 'a supabase-js error class',
    'Access-Control-Allow-Origin': 'an HTTP header asserted by the CORS tests',
    'Access-Control-Allow-Headers': 'an HTTP header asserted by the CORS tests',
    'Access-Control-Allow-Methods': 'an HTTP header asserted by the CORS tests',
    'Access-Control-Request-Headers': 'an HTTP header asserted by the CORS tests',
  }

  const declared = new Set([...PLACEHOLDER_NAMES, ...Object.keys(NOT_NAMES)])
  const declaredLower = new Set([...declared].map((value) => value.toLowerCase()))

  // Both scanners take TEXT rather than a path, so the positive controls below
  // can run them against a sample containing a name the vocabulary refuses.
  // Routed through the same functions the real scan uses — a control that
  // builds its own matcher proves the control, not the guard.
  function shapeOffenders(text) {
    const found = []
    for (const match of text.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
      const value = match[1] ?? match[2]
      if (value && NAME_SHAPE.test(value) && !declared.has(value)) found.push(value)
    }
    return found
  }

  function positionOffenders(text) {
    const found = []
    for (const pattern of NAME_POSITIONS) {
      for (const match of text.matchAll(pattern)) {
        for (const value of match.slice(1)) {
          if (value && PERSON_SHAPE.test(value) && !declaredLower.has(value.toLowerCase())) {
            found.push(value)
          }
        }
      }
    }
    return found
  }

  it('POSITIVE CONTROL: there is a corpus to scan, so an empty pass is impossible', () => {
    // Without this the whole describe passes the moment the filter stops
    // matching — a directory rename, a move to .ts, a git invocation that
    // returns nothing. An always-empty scan reads exactly like a clean tree.
    expect(corpus.length).toBeGreaterThan(20)
    expect(corpus).toContain('src/App.test.jsx')
    expect(corpus).toContain('src/test/migrations.pglite.test.js')
    expect(corpus).toContain('supabase/migrations/0001_household_and_roster.sql')
  })

  it('SHAPE: every name-shaped literal in the fixture corpus is declared', () => {
    const offenders = corpus.flatMap((path) =>
      shapeOffenders(codeOf(path)).map((value) => `${value} (${path})`),
    )
    expect(
      [...new Set(offenders)],
      'undeclared name-shaped literals — add them to PLACEHOLDER_NAMES or NOT_NAMES, and confirm none is a real household name',
    ).toEqual([])
  })

  it('POSITION: every person-shaped literal in a name position is declared', () => {
    const offenders = corpus.flatMap((path) =>
      positionOffenders(codeOf(path)).map((value) => `${value} (${path})`),
    )
    expect([...new Set(offenders)], 'undeclared literals in a name position').toEqual([])
  })

  it('POSITIVE CONTROL: both scans catch a name the vocabulary does not declare', () => {
    // The two halves are deliberately different: the shape scan is given a name
    // in an arbitrary position, and the position scan is given a LOWER-CASE one,
    // which is precisely what the shape scan cannot see. If either assertion
    // ever needs weakening, the scan it belongs to has stopped working.
    const sample = `const fixture = { id: 'm1', name: 'jordan', role: 'Marguerite' }`
    expect(shapeOffenders(sample)).toContain('Marguerite')
    expect(positionOffenders(sample)).toContain('jordan')
    // ...and the vocabulary is what lets the declared ones through, rather than
    // the scans simply matching nothing.
    expect(shapeOffenders(`const m = { name: 'Placeholder One' }`)).toEqual([])
  })

  it('POSITIVE CONTROL: a name QUOTED IN A COMMENT is prose, not a fixture', () => {
    // Written because the mutation said so: removing the stripping changed
    // nothing against the corpus as it stands, so this defence was carried on
    // faith. Both dialects, because they are stripped by different rules — and
    // the third assertion is what stops this passing for the wrong reason, by
    // showing the same string OUTSIDE a comment is still caught.
    const js = `// the fixture used to say 'Marguerite' here\nconst x = 1`
    const sql = `-- the organizer used to be 'Marguerite'\nselect 1;`
    expect(shapeOffenders(stripComments(js, false))).toEqual([])
    expect(shapeOffenders(stripComments(sql, true))).toEqual([])
    expect(shapeOffenders(stripComments(`const x = 'Marguerite'`, false))).toContain('Marguerite')
  })

  it('every NOT_NAMES exemption is still needed', () => {
    // An exemption for a string that has left the corpus is a hole: the next
    // person to use it inherits a pass nobody granted them.
    const text = corpus.map(codeOf).join('\n')
    const unnecessary = Object.keys(NOT_NAMES).filter((value) => !text.includes(value))
    expect(unnecessary, `these exemptions are no longer needed: ${unnecessary.join(', ')}`).toEqual(
      [],
    )
  })

  // The other face of the same decision: an image is a name too, and a
  // screenshot of the running app carries the whole roster at once.
  const ALLOWED_ASSETS = {
    'public/favicon.svg': 'the tab icon',
    'public/icons/icon-192.png': 'PWA manifest icon, generated by scripts/generate-icons.mjs',
    'public/icons/icon-512.png': 'PWA manifest icon, generated by scripts/generate-icons.mjs',
    'public/icons/icon-512-maskable.png':
      'PWA maskable icon, generated by scripts/generate-icons.mjs',
  }
  const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif|svg)$/i

  it('no image is committed except the icon set the manifest names', () => {
    const offenders = tracked.filter((path) => IMAGE.test(path) && !ALLOWED_ASSETS[path])
    expect(offenders, `committed images outside the icon set: ${offenders.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: the icon set is tracked and the pattern matches it', () => {
    // Without this, the assertion above passes identically against a typo in the
    // extension list, or a `git ls-files` that returned nothing.
    const images = tracked.filter((path) => IMAGE.test(path))
    expect(images).toEqual(expect.arrayContaining(Object.keys(ALLOWED_ASSETS)))
    expect(images.length).toBe(Object.keys(ALLOWED_ASSETS).length)
  })
})

// #37 AC 3 — the routes into exclusion-setting, ENUMERATED as a check.
//
// The AC asks that when every route in is enumerated, the only one is from a
// chore already on the list: no capability step in onboarding, no capability
// section on the roster, no screen laying all chores against all members, and an
// onboarding step count unchanged from before this story.
//
// That is a property of the WIRING, so no behavioural test can see it — a
// component test renders the screen it was handed and says nothing about which
// screens exist. It is the same shape as every other guard in this file, and it
// is the criterion most likely to decay quietly: adding a capability section to
// the roster later would break nothing, fail nothing, and read as an improvement.
//
// #8 asked for exactly that screen — "given a chore's edit screen, when
// capability is configured" — a per-chore by per-member matrix, a form, in the
// same window the charter's bet exists to delete forms. This is what refuses it.
describe('#37 AC 3 — an exclusion is set from a chore, and from nowhere else', () => {
  const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8')
  const app = read('src/App.jsx')
  const onboarding = read('src/components/Onboarding.jsx')
  const roster = read('src/components/Roster.jsx')
  const chores = read('src/components/Chores.jsx')

  it('POSITIVE CONTROL: the route EXISTS, so the absences below are not an unbuilt feature', () => {
    // Without this the whole describe passes on a build where nobody can record
    // an exclusion at all — which satisfies "the only route is from a chore"
    // vacuously and is option (d), the one that was declined.
    expect(app).toMatch(/from '\.\/lib\/exclusions\.js'/)
    expect(app).toMatch(/\bexcludeMember\b/)
    expect(app).toMatch(/\ballowMember\b/)
    expect(chores).toMatch(/from '\.\.\/lib\/exclusions\.js'/)
  })

  it('hands the two writes to the chore screen, and to no other element', () => {
    // Scoped to the element for the reason the #34 guard records: an unscoped
    // grep passes on a neighbour. Here the neighbour is the point — the claim is
    // that the roster does NOT get these props, so an assertion that merely
    // found them somewhere in the file would be blind to the whole criterion.
    const choreElement = app.match(/<Chores[\s\S]*?\/>/)
    const rosterElement = app.match(/<Roster[\s\S]*?\/>/)
    const onboardingElement = app.match(/<Onboarding[\s\S]*?\/>/)

    expect(choreElement, 'no chore element in App.jsx').not.toBeNull()
    expect(choreElement[0]).toMatch(/onExclude=\{/)
    expect(choreElement[0]).toMatch(/onAllow=\{/)
    expect(choreElement[0]).toMatch(/exclusions=\{/)

    for (const [name, element] of [
      ['roster', rosterElement],
      ['onboarding', onboardingElement],
    ]) {
      expect(element, `no ${name} element in App.jsx`).not.toBeNull()
      expect(element[0], `${name} must not be a second route in`).not.toMatch(/onExclude=|onAllow=/)
    }
  })

  it('neither onboarding nor the roster knows the exclusion data layer exists', () => {
    // The strongest available form, and the same argument #36 AC 10's check
    // makes: a file that cannot reach the module cannot become a route into it,
    // whatever anybody wires up later.
    for (const [name, source] of [
      ['Onboarding.jsx', onboarding],
      ['Roster.jsx', roster],
    ]) {
      expect(source, `${name} imports the exclusion data layer`).not.toMatch(/lib\/exclusions/)
      expect(source, `${name} names an exclusion write`).not.toMatch(
        /\bexcludeMember\b|\ballowMember\b/,
      )
    }
  })

  it('the onboarding step count is unchanged from before this story', () => {
    // TWO cards and TWO forms — create a household, or sign in — which is what
    // Onboarding carried before #37 and what it carries now. A capability step
    // would be a third of each, and this is the number that says so.
    //
    // The cost of a literal here is real and deliberate: a legitimate rework of
    // onboarding fails this test and has to change the number in a diff. That is
    // the same trade every floor in this file makes, and the AC asks for a count.
    expect([...onboarding.matchAll(/<section className="card"/g)]).toHaveLength(2)
    expect([...onboarding.matchAll(/<form\b/g)]).toHaveLength(2)
  })

  it('no component offers a capability screen, by any of the words one would be called', () => {
    // Vocabulary rather than structure, because the grid could be built without
    // ever nesting two maps — and a matrix that called itself something else
    // would still be the artefact the charter's bet exists to delete. The chore
    // screen is exempt: it is the one route, and it has to say what it does.
    const CAPABILITY_VOCABULARY = /capabilit|capability matrix|skills? (grid|matrix)|who can do what/i
    for (const [name, source] of [
      ['App.jsx', app],
      ['Onboarding.jsx', onboarding],
      ['Roster.jsx', roster],
    ]) {
      expect(source, `${name} looks like it offers a capability screen`).not.toMatch(
        CAPABILITY_VOCABULARY,
      )
    }
  })

  it('POSITIVE CONTROL: that vocabulary scan can actually match something', () => {
    // Without this the assertion above passes identically against a typo in the
    // pattern, and an always-empty scan reads exactly like a clean bill of health.
    const CAPABILITY_VOCABULARY = /capabilit|capability matrix|skills? (grid|matrix)|who can do what/i
    expect(CAPABILITY_VOCABULARY.test('a capability matrix on the roster')).toBe(true)
    expect(CAPABILITY_VOCABULARY.test('who can do what, at a glance')).toBe(true)
  })
})
