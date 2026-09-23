// Summarise a vitest JSON report: totals, then every failure with its message.
//
// This exists because the same summary was being reinvented as an inline
// `node -e "…"` one-liner on each invocation. An inline interpreter cannot be
// allowlisted responsibly — whatever follows `-e` runs with full privileges, so
// `Bash(node -e:*)` is a blank cheque and not a narrowing of `Bash` at all —
// while `node scripts/summarize-vitest.mjs` is an exact-match rule, stable
// across sessions, reviewable in a diff, and testable. That is the whole reason
// this is a file.
//
// House style follows `extraction-report-format.mjs`: everything RETURNS lines
// rather than printing them, so the test asserts on the rendering without
// capturing stdout, and `main()` is the only part that touches the filesystem.
//
// The shape below was read off a real report (`vitest run --reporter=json`,
// vitest 2.1.8) rather than assumed: top-level `numTotalTests` / `numFailedTests`
// / `numPassedTests` / `success`, and `testResults[]` of files each carrying
// `name`, `status`, `message` and `assertionResults[]` of
// `{ fullName, status, failureMessages[] }`.

import fs from 'node:fs'

/**
 * The verdict, and the reason for it.
 *
 * Deliberately NOT `numFailedTests === 0`. A run whose suite throws while
 * collecting — a bad import, a config error, a `beforeAll` that cannot start —
 * reports `success: false` with **zero** failed tests, because no test ever ran
 * to fail. Reading only the failure count calls that a clean run, which is the
 * absent-result-reads-as-a-clean-one shape with a test report as the artefact.
 * So both are consulted, and a file-level `message` is surfaced too.
 */
export function verdictOf(report) {
  const failed = report.numFailedTests ?? 0
  if (failed > 0) return { ok: false, reason: `${failed} failing` }
  if (report.success === false) {
    return { ok: false, reason: 'no test failed, but the run did not succeed — a suite failed to run' }
  }
  if (report.success !== true) {
    return { ok: false, reason: 'the report carries no success flag — treat it as unproven, not as passing' }
  }
  return { ok: true, reason: 'all passing' }
}

/** File-level errors: a suite that never produced assertions still has a message. */
export function suiteErrorLines(report) {
  const lines = []
  for (const file of report.testResults ?? []) {
    if (file.status === 'passed') continue
    const ran = (file.assertionResults ?? []).length
    if (ran > 0 && (file.assertionResults ?? []).some((a) => a.status === 'failed')) continue
    // Failed or errored with nothing to attribute it to — the case a
    // failure-count summary loses entirely.
    lines.push(`  ${file.name}`)
    lines.push(`    suite ${file.status ?? 'errored'} with ${ran} assertion(s)`)
    for (const line of String(file.message ?? '').trim().split('\n').filter(Boolean).slice(0, 20)) {
      lines.push(`    ${line}`)
    }
  }
  return lines
}

/** One block per failing assertion: where it is, and why it failed. */
export function failureLines(report) {
  const lines = []
  for (const file of report.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      if (a.status !== 'failed') continue
      lines.push(`  ${file.name}`)
      lines.push(`    ${a.fullName || a.title}`)
      const messages = a.failureMessages ?? []
      if (messages.length === 0) {
        lines.push('    (failed with no message — read the raw report)')
      }
      for (const message of messages) {
        for (const line of String(message).split('\n').slice(0, 12)) {
          lines.push(`    ${line}`)
        }
      }
      lines.push('')
    }
  }
  return lines
}

/** The whole rendering, verdict first so it survives a truncated terminal. */
export function summaryLines(report) {
  const verdict = verdictOf(report)
  const lines = [
    `${verdict.ok ? 'PASS' : 'FAIL'} — ${verdict.reason}`,
    `  tests   ${report.numPassedTests ?? 0} passed, ${report.numFailedTests ?? 0} failed, ` +
      `${report.numPendingTests ?? 0} pending of ${report.numTotalTests ?? 0}`,
    `  suites  ${report.numPassedTestSuites ?? 0} passed, ${report.numFailedTestSuites ?? 0} failed ` +
      `of ${report.numTotalTestSuites ?? 0}`,
  ]
  const suiteErrors = suiteErrorLines(report)
  if (suiteErrors.length > 0) lines.push('', 'suites that did not run:', ...suiteErrors)
  const failures = failureLines(report)
  if (failures.length > 0) lines.push('', 'failures:', ...failures)
  return lines
}

/** The files the time budget sums — #555. */
export const PGLITE_FILE = /\.pglite\.test\.js$/

/**
 * The summed wall time of every PGlite file, in seconds — #555 AC 2.
 *
 * Read from each file's `duration`, which `vitest-json-file-durations.mjs` adds
 * and the stock JSON reporter does not carry. Deliberately NOT
 * `endTime - startTime`: that span starts at the first test, so a database
 * booted in `beforeAll` is outside it (that reporter's header has the
 * measurement). A file without `duration` makes the whole reading unproven
 * rather than cheaper.
 *
 * `{ ok: false }` when there is nothing honest to sum: no PGlite file at all
 * (a budget over nothing passes every time), or one without its duration.
 */
export function pgliteTime(report) {
  const files = (report.testResults ?? []).filter((file) => PGLITE_FILE.test(String(file.name ?? '')))
  if (files.length === 0) {
    return { ok: false, reason: 'the report names no *.pglite.test.js file, so there is nothing to time' }
  }
  const untimed = files.filter((file) => !Number.isFinite(file.duration))
  if (untimed.length > 0) {
    return {
      ok: false,
      reason:
        `${untimed.length} of ${files.length} PGlite file(s) carry no duration — ` +
        'was the report written by scripts/vitest-json-file-durations.mjs?',
    }
  }
  const seconds = files.reduce((sum, file) => sum + file.duration, 0) / 1000
  const slowest = [...files].sort((a, b) => b.duration - a.duration).slice(0, 5)
  return { ok: true, files: files.length, seconds, slowest }
}

/** The budget verdict and its rendering — within or over the ceiling. */
export function budgetLines(report, ceilingSeconds) {
  const time = pgliteTime(report)
  if (!time.ok) return { code: 2, lines: [`PGlite time budget: UNPROVEN — ${time.reason}`] }
  const over = time.seconds > ceilingSeconds
  const lines = [
    `PGlite time budget: ${over ? 'OVER' : 'within'} — ${time.seconds.toFixed(1)} s across ${time.files} ` +
      `files, ceiling ${ceilingSeconds} s` +
      (over ? ` (${(time.seconds - ceilingSeconds).toFixed(1)} s over)` : ''),
    '  slowest:',
    ...time.slowest.map((file) => `    ${(file.duration / 1000).toFixed(1).padStart(7)} s  ${file.name}`),
  ]
  return { code: over ? 1 : 0, lines }
}

/** `<report> [--budget <seconds>]`, or an error naming what was wrong. */
export function parseArgs(argv) {
  const rest = [...argv]
  let budget = null
  const at = rest.indexOf('--budget')
  if (at !== -1) {
    const value = rest[at + 1]
    budget = Number(value)
    if (value === undefined || !Number.isFinite(budget) || budget <= 0) {
      return { error: `--budget needs a positive number of seconds, got ${value ?? 'nothing'}` }
    }
    rest.splice(at, 2)
  }
  if (rest.length !== 1) return { error: null }
  return { path: rest[0], budget }
}

/**
 * Read a report and render it. Returns the process exit code.
 *
 * An unreadable or absent file is an ERROR, never an empty summary: the run
 * that never wrote a report and the run that found nothing wrong produce the
 * same silence otherwise, and the second is the one a reader believes.
 *
 * With `--budget <seconds>` it also sums the PGlite files' time and exits 1
 * when the sum passes the ceiling (#555), and 2 when it cannot be read.
 */
export function main(argv = process.argv.slice(2), out = console.log, err = console.error) {
  const args = parseArgs(argv)
  if (!args.path) {
    if (args.error) err(args.error)
    err('usage: node scripts/summarize-vitest.mjs <vitest-json-report> [--budget <seconds>]')
    return 2
  }
  const { path } = args
  let raw
  try {
    raw = fs.readFileSync(path, 'utf8')
  } catch (cause) {
    err(`cannot read ${path}: ${cause.message}`)
    err('The run did not write a report. That is not a passing run — it is no run.')
    return 2
  }
  let report
  try {
    report = JSON.parse(raw)
  } catch (cause) {
    err(`${path} is not valid JSON: ${cause.message}`)
    err(`(${raw.length} bytes — a truncated report usually means the runner died mid-write.)`)
    return 2
  }
  for (const line of summaryLines(report)) out(line)
  const verdictCode = verdictOf(report).ok ? 0 : 1
  if (args.budget === null) return verdictCode
  const budget = budgetLines(report, args.budget)
  out('')
  for (const line of budget.lines) out(line)
  return Math.max(verdictCode, budget.code)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('summarize-vitest.mjs')) {
  process.exitCode = main()
}
