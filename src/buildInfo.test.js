import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildInfo } from './buildInfo.js'

// #540 AC 2 — the release version reaches the bundle from package.json, and
// from nowhere else. Read through process.cwd(), as gate.test.js reads source:
// under vitest `import.meta.url` is not a file: URL.
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

describe('the release version (#540)', () => {
  it('is package.json’s version, read back through the define vite.config.js maps in', () => {
    // A literal in vite.config.js's define, or in buildInfo.js itself, that
    // differs from the file reddens this — which is the point: `npm version`
    // must be the one place the value moves.
    expect(buildInfo.version).toBe(pkg.version)
  })

  it('POSITIVE CONTROL: package.json carries a SemVer version to compare against', () => {
    // The test above is only as good as the value it compares against: a
    // version-less package.json would make its failure say nothing useful.
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})
