import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { failureLines, main, suiteErrorLines, summaryLines, verdictOf } from './summarize-vitest.mjs'

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
