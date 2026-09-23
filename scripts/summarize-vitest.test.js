// @vitest-environment node
// Node, not jsdom: the reporter below imports `vitest/reporters`, which loads
// esbuild, and esbuild refuses jsdom's `TextEncoder` (measured on #555).
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  budgetLines,
  failureLines,
  main,
  parseArgs,
  pgliteTime,
  suiteErrorLines,
  summaryLines,
  verdictOf,
} from './summarize-vitest.mjs'
import JsonWithFileDurations, { withFileDurations } from './vitest-json-file-durations.mjs'

// Fixtures are the shape read off a real `vitest run --reporter=json` (2.1.8),
// not an invented one — see the header of summarize-vitest.mjs.

const passing = {
  numTotalTestSuites: 6,
  numPassedTestSuites: 6,
  numFailedTestSuites: 0,
  numTotalTests: 23,
  numPassedTests: 23,
  numFailedTests: 0,
  numPendingTests: 0,
  success: true,
  testResults: [
    {
      name: 'C:/Users/HSCCo/code/Taskr/scripts/check-deployed.test.js',
      status: 'passed',
      message: '',
      assertionResults: [
        { fullName: 'the function list — AC 2 checks the functions', status: 'passed', failureMessages: [] },
      ],
    },
  ],
}

const failing = {
  numTotalTestSuites: 2,
  numPassedTestSuites: 1,
  numFailedTestSuites: 1,
  numTotalTests: 4,
  numPassedTests: 3,
  numFailedTests: 1,
  numPendingTests: 0,
  success: false,
  testResults: [
    {
      name: 'C:/Users/HSCCo/code/Taskr/src/test/rebalance.test.js',
      status: 'failed',
      message: '',
      assertionResults: [
        { fullName: 'rebalance > carries unbought items forward', status: 'passed', failureMessages: [] },
        {
          fullName: 'rebalance > closes the run exactly once',
          status: 'failed',
          failureMessages: ['AssertionError: expected 2 to be 1\n  at rebalance.test.js:44:7'],
        },
      ],
    },
  ],
}

// The case the whole file exists for: the runner could not collect a suite, so
// NOTHING failed because nothing ran. numFailedTests is 0 and success is false.
const collectionError = {
  numTotalTestSuites: 1,
  numPassedTestSuites: 0,
  numFailedTestSuites: 1,
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  success: false,
  testResults: [
    {
      name: 'C:/Users/HSCCo/code/Taskr/src/test/schema.pglite.test.js',
      status: 'failed',
      message: 'Error: Cannot find module \'@electric-sql/pglite\'\n  at loadSuite (vitest)',
      assertionResults: [],
    },
  ],
}

describe('verdictOf — the verdict is not the failure count', () => {
  it('passes a run that succeeded with no failures', () => {
    expect(verdictOf(passing)).toEqual({ ok: true, reason: 'all passing' })
  })

  it('fails a run with failing tests, and says how many', () => {
    const verdict = verdictOf(failing)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('1 failing')
  })

  it('FAILS a run where nothing failed because nothing ran', () => {
    // The regression this guards: `numFailedTests === 0` alone calls this PASS.
    expect(collectionError.numFailedTests).toBe(0)
    const verdict = verdictOf(collectionError)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/a suite failed to run/)
  })

  it('refuses to call a report with no success flag a pass', () => {
    const verdict = verdictOf({ numFailedTests: 0 })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/unproven/)
  })
})

describe('failureLines', () => {
  it('names the file, the test and its message', () => {
    const lines = failureLines(failing).join('\n')
    expect(lines).toContain('rebalance.test.js')
    expect(lines).toContain('closes the run exactly once')
    expect(lines).toContain('expected 2 to be 1')
  })

  it('says so rather than printing nothing when a failure carries no message', () => {
    const report = {
      testResults: [
        { name: 'a.test.js', assertionResults: [{ fullName: 't', status: 'failed', failureMessages: [] }] },
      ],
    }
    expect(failureLines(report).join('\n')).toMatch(/failed with no message/)
  })

  it('is empty for a passing report', () => {
    expect(failureLines(passing)).toEqual([])
  })
})

describe('suiteErrorLines — the failure with nothing to attribute it to', () => {
  it('surfaces a suite that errored before producing assertions', () => {
    const lines = suiteErrorLines(collectionError).join('\n')
    expect(lines).toContain('schema.pglite.test.js')
    expect(lines).toContain('Cannot find module')
    expect(lines).toContain('0 assertion(s)')
  })

  it('stays quiet for a file whose failure IS attributable to an assertion', () => {
    // Otherwise every ordinary failure is reported twice.
    expect(suiteErrorLines(failing)).toEqual([])
  })

  it('is empty for a passing report', () => {
    expect(suiteErrorLines(passing)).toEqual([])
  })
})

describe('summaryLines', () => {
  it('leads with the verdict, so a truncated terminal still carries it', () => {
    expect(summaryLines(passing)[0]).toBe('PASS — all passing')
    expect(summaryLines(failing)[0]).toBe('FAIL — 1 failing')
  })

  it('reports the totals it was given', () => {
    expect(summaryLines(passing)[1]).toContain('23 passed, 0 failed')
    expect(summaryLines(passing)[2]).toContain('6 passed, 0 failed of 6')
  })

  it('renders a collection error as FAIL with the suite block', () => {
    const out = summaryLines(collectionError).join('\n')
    expect(out.startsWith('FAIL')).toBe(true)
    expect(out).toContain('suites that did not run:')
  })
})

describe('main — an absent report is an error, never an empty summary', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summarize-vitest-'))
  const collect = () => {
    const out = []
    const err = []
    return { out, err, log: (l) => out.push(l), warn: (l) => err.push(l) }
  }

  it('exits 2 and says the run produced nothing when the file is absent', () => {
    const c = collect()
    const code = main([path.join(tmp, 'never-written.json')], c.log, c.warn)
    expect(code).toBe(2)
    expect(c.out).toEqual([])
    expect(c.err.join('\n')).toMatch(/it is no run/)
  })

  it('exits 2 on a truncated report rather than parsing around it', () => {
    const p = path.join(tmp, 'truncated.json')
    fs.writeFileSync(p, '{"numTotalTests": 12, "testResu')
    const c = collect()
    expect(main([p], c.log, c.warn)).toBe(2)
    expect(c.err.join('\n')).toMatch(/not valid JSON/)
  })

  it('exits 2 with usage when given no path', () => {
    const c = collect()
    expect(main([], c.log, c.warn)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage:/)
  })

  it('exits 0 on a passing report and 1 on a failing one', () => {
    const pass = path.join(tmp, 'pass.json')
    const fail = path.join(tmp, 'fail.json')
    fs.writeFileSync(pass, JSON.stringify(passing))
    fs.writeFileSync(fail, JSON.stringify(failing))
    expect(main([pass], () => {}, () => {})).toBe(0)
    expect(main([fail], () => {}, () => {})).toBe(1)
  })

  it('exits 1 on a report where no test failed but the run did not succeed', () => {
    const p = path.join(tmp, 'collection.json')
    fs.writeFileSync(p, JSON.stringify(collectionError))
    expect(main([p], () => {}, () => {})).toBe(1)
  })
})

// #555 AC 2 — the PGlite time budget.
//
// `duration` is what scripts/vitest-json-file-durations.mjs adds to each file;
// `startTime`/`endTime` are the stock reporter's span, set here to disagree
// with it on purpose, so a sum that read the span would give a different
// number from the one asserted.
const timed = {
  ...passing,
  testResults: [
    { name: 'C:/Taskr/src/test/a.pglite.test.js', status: 'passed', assertionResults: [], startTime: 0, endTime: 21, duration: 1601 },
    { name: 'C:/Taskr/src/test/b.pglite.test.js', status: 'passed', assertionResults: [], startTime: 0, endTime: 12839, duration: 12840 },
    // Not a PGlite file: never part of the sum, however slow.
    { name: 'C:/Taskr/src/App.test.jsx', status: 'passed', assertionResults: [], startTime: 0, endTime: 46000, duration: 46000 },
  ],
}

describe('#555 AC 2 — pgliteTime sums every PGlite file’s own duration', () => {
  it('sums duration over *.pglite.test.js files only, in seconds', () => {
    const time = pgliteTime(timed)
    expect(time.ok).toBe(true)
    expect(time.files).toBe(2)
    expect(time.seconds).toBeCloseTo(14.441, 3)
  })

  it('does NOT read the stock span, which leaves out a beforeAll', () => {
    // 21 + 12,839 ms is what endTime - startTime would sum to.
    expect(pgliteTime(timed).seconds).not.toBeCloseTo(12.86, 1)
  })

  it('refuses a PGlite file with no duration — a stock report is unproven, not cheaper', () => {
    const stock = { ...timed, testResults: timed.testResults.map((file) => ({ ...file, duration: undefined })) }
    const time = pgliteTime(stock)
    expect(time.ok).toBe(false)
    expect(time.reason).toMatch(/2 of 2 PGlite file\(s\) carry no duration/)
    expect(time.reason).toMatch(/vitest-json-file-durations\.mjs/)
  })

  it('refuses a report with no PGlite file at all, since a budget over nothing always passes', () => {
    const none = { ...timed, testResults: [timed.testResults[2]] }
    expect(pgliteTime(none).ok).toBe(false)
    expect(pgliteTime(none).reason).toMatch(/nothing to time/)
  })
})

describe('#555 AC 2 — budgetLines is within at or under the ceiling, and over past it', () => {
  it('within at exactly the sum', () => {
    expect(budgetLines(timed, 14.441).code).toBe(0)
  })

  it('over one step past it, and says by how much', () => {
    const verdict = budgetLines(timed, 14)
    expect(verdict.code).toBe(1)
    expect(verdict.lines[0]).toMatch(/OVER — 14\.4 s across 2 files, ceiling 14 s \(0\.4 s over\)/)
  })

  it('names the slowest files, slowest first, so a red run says where to look', () => {
    const lines = budgetLines(timed, 100).lines
    expect(lines[2]).toMatch(/12\.8 s {2}C:\/Taskr\/src\/test\/b\.pglite\.test\.js$/)
    expect(lines[3]).toMatch(/1\.6 s {2}C:\/Taskr\/src\/test\/a\.pglite\.test\.js$/)
  })

  it('exits 2 when the time cannot be read', () => {
    expect(budgetLines({ ...timed, testResults: [] }, 100).code).toBe(2)
  })
})

describe('#555 AC 2 — main --budget', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summarize-vitest-budget-'))
  const report = path.join(tmp, 'timed.json')
  fs.writeFileSync(report, JSON.stringify(timed))

  it('exits 0 within the ceiling and prints the reading', () => {
    const out = []
    expect(main([report, '--budget', '3200'], (l) => out.push(l), () => {})).toBe(0)
    expect(out.join('\n')).toMatch(/PGlite time budget: within — 14\.4 s across 2 files, ceiling 3200 s/)
  })

  it('exits 1 over the ceiling, with --budget before or after the path', () => {
    expect(main([report, '--budget', '10'], () => {}, () => {})).toBe(1)
    expect(main(['--budget', '10', report], () => {}, () => {})).toBe(1)
  })

  it('without --budget, the time is not read at all — the summary stays what it was', () => {
    const out = []
    expect(main([report], (l) => out.push(l), () => {})).toBe(0)
    expect(out.join('\n')).not.toMatch(/PGlite time budget/)
  })

  it('a failing suite over its budget still exits non-zero', () => {
    const p = path.join(tmp, 'failing-timed.json')
    fs.writeFileSync(p, JSON.stringify({ ...timed, numFailedTests: 1, success: false }))
    expect(main([p, '--budget', '3200'], () => {}, () => {})).toBe(1)
  })

  it('exits 2 with usage on a --budget that is not a positive number', () => {
    for (const bad of [[report, '--budget'], [report, '--budget', 'soon'], [report, '--budget', '0']]) {
      const err = []
      expect(main(bad, () => {}, (l) => err.push(l))).toBe(2)
      expect(err.join('\n')).toMatch(/--budget needs a positive number of seconds/)
    }
  })

  it('parseArgs reads the path and the ceiling in either order', () => {
    expect(parseArgs(['r.json', '--budget', '3200'])).toEqual({ path: 'r.json', budget: 3200 })
    expect(parseArgs(['--budget', '3200', 'r.json'])).toEqual({ path: 'r.json', budget: 3200 })
    expect(parseArgs(['r.json'])).toEqual({ path: 'r.json', budget: null })
  })
})

// The reporter, run through vitest's REAL JsonReporter rather than a copy of
// its logic: the property that matters is what the stock reporter leaves out,
// so the stock reporter is what has to produce the span beside it.
describe('#555 AC 2 — vitest-json-file-durations adds each file’s own duration', () => {
  it('withFileDurations adds duration by path and leaves the rest of the report alone', () => {
    const report = { success: true, testResults: [{ name: '/x.pglite.test.js', startTime: 1, endTime: 2 }] }
    expect(withFileDurations(report, new Map([['/x.pglite.test.js', 1601]]))).toEqual({
      success: true,
      testResults: [{ name: '/x.pglite.test.js', startTime: 1, endTime: 2, duration: 1601 }],
    })
  })

  it('writes the stock report plus duration, and the duration includes what the span leaves out', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-json-file-durations-'))
    const outputFile = path.join(tmp, 'report.json')
    // One file whose `beforeAll` took 1,580 ms before its one 21 ms test —
    // the shape of realtime.pglite.test.js as measured.
    const test = { type: 'test', name: 'one', mode: 'run', result: { state: 'pass', startTime: 1_580, duration: 21 } }
    const file = {
      type: 'suite',
      name: 'x.pglite.test.js',
      filepath: '/repo/src/test/x.pglite.test.js',
      mode: 'run',
      tasks: [test],
      result: { state: 'pass', startTime: 0, duration: 1_601 },
    }
    test.suite = file
    const reporter = new JsonWithFileDurations({ outputFile })
    reporter.onInit({ config: { root: tmp }, logger: { log() {}, warn() {} }, snapshot: { summary: {} } })
    await reporter.onFinished([file])

    const written = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
    const [entry] = written.testResults
    expect(entry.name).toBe('/repo/src/test/x.pglite.test.js')
    expect(entry.endTime - entry.startTime, 'the stock span, which leaves out beforeAll').toBe(21)
    expect(entry.duration, 'the file’s own duration').toBe(1_601)
    expect(written.success).toBe(true)
    expect(pgliteTime(written)).toMatchObject({ ok: true, files: 1, seconds: 1.601 })
  })
})
