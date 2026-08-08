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

  it('imports the PIN claim from the data layer', () => {
    expect(app).toMatch(/claimMemberWithPin/)
  })

  it('hands it to the roster, which is the only place a person can reach it', () => {
    expect(app).toMatch(/onSignIn=\{/)
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

  it('wires all three writes ON THE CHORE ELEMENT, not merely somewhere in the file', () => {
    // Scoped to the <Chores> element on purpose. Measured 2026-08-08: the
    // unscoped version stayed GREEN when the whole <Chores /> render was
    // deleted, because <Roster> carries onAdd, onSave and onRemove too — the
    // test passed on a neighbour and pinned nothing about chores.
    const element = app.match(/<Chores[\s\S]*?\/>/)
    expect(element, 'no <Chores .../> element in App.jsx').not.toBeNull()
    expect(element[0]).toMatch(/onAdd=\{/)
    expect(element[0]).toMatch(/onSave=\{/)
    expect(element[0]).toMatch(/onRemove=\{/)
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
