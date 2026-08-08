import { readFileSync } from 'node:fs'
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
