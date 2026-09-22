// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkPromotion, compareSemver, parseArgs, parseSemver } from './check-release-version.mjs'

// #540 AC 6 — a promotion into `release` must carry a strictly greater version.

describe('checkPromotion — the verdict CI prints (#540 AC 6)', () => {
  it('refuses an EQUAL version, naming both values', () => {
    const verdict = checkPromotion({ head: '1.0.0', base: '1.0.0' })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toMatch(/reads 1\.0\.0, the same as release's 1\.0\.0/)
    // The fix is in the refusal, so the person reading a red check has it.
    expect(verdict.message).toContain('npm version <patch|minor|major> --no-git-tag-version')
  })

  it('refuses a LOWER version at each position, naming both values', () => {
    for (const [head, base] of [
      ['1.2.2', '1.2.3'],
      ['1.1.9', '1.2.0'],
      ['0.9.9', '1.0.0'],
    ]) {
      const verdict = checkPromotion({ head, base })
      expect(verdict.ok, `${head} over ${base}`).toBe(false)
      expect(verdict.message).toContain(`reads ${head}, LOWER than release's ${base}`)
    }
  })

  it('accepts a HIGHER version at each position, naming both values', () => {
    for (const [head, base] of [
      ['1.0.1', '1.0.0'],
      ['1.1.0', '1.0.9'],
      ['2.0.0', '1.9.9'],
      ['1.0.0', '0.0.0'],
    ]) {
      const verdict = checkPromotion({ head, base })
      expect(verdict.ok, `${head} over ${base}`).toBe(true)
      expect(verdict.message).toBe(`ok: this promotion ships ${head}, above release's ${base}.`)
    }
  })

  it('orders numerically, not as text: 1.10.0 is above 1.9.0', () => {
    expect(checkPromotion({ head: '1.10.0', base: '1.9.0' }).ok).toBe(true)
    expect(checkPromotion({ head: '1.9.0', base: '1.10.0' }).ok).toBe(false)
  })

  it('PRE-RELEASE: sorts below its release and above the one before', () => {
    expect(checkPromotion({ head: '1.1.0-rc.1', base: '1.0.0' }).ok).toBe(true)
    expect(checkPromotion({ head: '1.1.0', base: '1.1.0-rc.1' }).ok).toBe(true)
    // Going from a release to its own pre-release is going backwards.
    expect(checkPromotion({ head: '1.1.0-rc.1', base: '1.1.0' }).ok).toBe(false)
    expect(checkPromotion({ head: '1.1.0-rc.1', base: '1.1.0' }).message).toContain('LOWER than')
    expect(checkPromotion({ head: '1.1.0-rc.10', base: '1.1.0-rc.2' }).ok).toBe(true)
    expect(checkPromotion({ head: '1.1.0-rc.1', base: '1.1.0-rc.1' }).ok).toBe(false)
  })

  it('ignores build metadata, so it cannot stand in for a bump', () => {
    expect(checkPromotion({ head: '1.0.0+b2', base: '1.0.0+b1' }).ok).toBe(false)
    expect(checkPromotion({ head: '1.0.0+b2', base: '1.0.0+b1' }).message).toContain('the same as')
  })

  it('refuses a value that is not SemVer on either side, naming both', () => {
    for (const [head, base] of [
      ['v1.0.1', '1.0.0'],
      ['1.1', '1.0.0'],
      ['01.0.0', '0.9.0'],
      ['1.0.1', undefined],
    ]) {
      const verdict = checkPromotion({ head, base })
      expect(verdict.ok, `${head} over ${base}`).toBe(false)
      expect(verdict.message).toContain('is not a SemVer version')
      expect(verdict.message).toContain(`head ${JSON.stringify(head)}`)
      expect(verdict.message).toContain(`release ${JSON.stringify(base)}`)
    }
  })
})

describe('compareSemver — SemVer 2.0.0 precedence (#540 AC 6)', () => {
  it('orders semver.org §11’s own example chain, every adjacent pair both ways', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(compareSemver(chain[i], chain[i + 1]), `${chain[i]} < ${chain[i + 1]}`).toBe(-1)
      expect(compareSemver(chain[i + 1], chain[i]), `${chain[i + 1]} > ${chain[i]}`).toBe(1)
    }
  })

  it('puts a numeric identifier below an alphanumeric one', () => {
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBe(-1)
  })

  it('compares numbers too long for a Number without losing precision', () => {
    expect(compareSemver('1.0.9007199254740993', '1.0.9007199254740992')).toBe(1)
  })

  it('throws on a value that is not SemVer, rather than ordering it', () => {
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(/not a SemVer version/)
    expect(parseSemver('1.0.0-')).toBeNull()
  })
})

describe('parseArgs (#540 AC 6)', () => {
  it('defaults to the local question: HEAD against origin/release', () => {
    expect(parseArgs([])).toEqual({ head: 'HEAD', base: 'origin/release' })
  })

  it('takes the head sha and base ref CI passes, and refuses anything else', () => {
    expect(parseArgs(['--head', 'abc1234', '--base', 'origin/release'])).toEqual({
      head: 'abc1234',
      base: 'origin/release',
    })
    expect(() => parseArgs(['--head'])).toThrow(/needs a git ref/)
    expect(() => parseArgs(['--from', 'x'])).toThrow(/unknown argument/)
  })
})

// The command itself, against a throwaway repository with two commits — so the
// `git show <ref>:package.json` plumbing CI relies on is exercised in both
// directions, with no network and no dependence on this checkout's history
// (CI's checkout is depth 1, so HEAD~1 does not exist there).
describe('the command, end to end (#540 AC 6)', () => {
  const script = resolve(process.cwd(), 'scripts/check-release-version.mjs')
  let repo

  const git = (...args) => {
    const run = spawnSync(
      'git',
      ['-c', 'user.name=placeholder', '-c', 'user.email=placeholder@example.invalid', ...args],
      { cwd: repo, encoding: 'utf8' },
    )
    expect(run.status, run.stderr).toBe(0)
  }
  const commitVersion = (version) => {
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'probe', version }, null, 2)}\n`)
    git('add', 'package.json')
    git('commit', '--quiet', '-m', `version ${version}`)
  }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' })

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'taskr-540-'))
    git('init', '--quiet')
    commitVersion('1.0.0')
    commitVersion('1.0.1')
  })

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  it('exits 0 when the head is above the base', () => {
    const result = run('--head', 'HEAD', '--base', 'HEAD~1')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("ships 1.0.1, above release's 1.0.0")
  })

  it('exits 1 when the head is below the base, naming both', () => {
    const result = run('--head', 'HEAD~1', '--base', 'HEAD')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("reads 1.0.0, LOWER than release's 1.0.1")
  })

  it('exits 1 when the two are equal', () => {
    const result = run('--head', 'HEAD', '--base', 'HEAD')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("reads 1.0.1, the same as release's 1.0.1")
  })

  it('exits 1 naming the ref, and the fetch, when the base was never fetched', () => {
    // The depth-1 checkout's case: `origin/release` is simply absent.
    const result = run('--head', 'HEAD')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('cannot read package.json at origin/release')
    expect(result.stderr).toContain('git fetch origin release')
  })
})
