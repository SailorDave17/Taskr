// Vitest's JSON report, plus each file's own duration — #555.
//
// The stock JSON reporter times a file from its first test's start to its last
// test's end (vitest 2.1.9, `JsonReporter.logTasks`), so a `beforeAll` sits
// OUTSIDE the span it reports. *Measured 2026-09-22*: `realtime.pglite.test.js`
// boots its database in `beforeAll` and read 1,601 ms on the console and 22 ms
// in the report; `memberSignInState.pglite.test.js` boots in `beforeEach` and
// read the same on both. A time budget summed from the stock report would be
// blind to exactly the move #557 makes — one database per file, booted in
// `beforeAll` — and would read that story's boot cost as free.
//
// So this adds `duration` to every `testResults[]` entry: the file task's own
// `result.duration`, the figure the console prints beside each file and the
// one CI's per-file lines were summed from. Everything else in the report is
// the stock reporter's, untouched. `scripts/summarize-vitest.mjs --budget`
// refuses a report without it rather than falling back to the span.
//
// Used by CI's Test step:
//   npm test -- --reporter=default --reporter=./scripts/vitest-json-file-durations.mjs \
//     --outputFile.json=vitest-report.json

import { JsonReporter } from 'vitest/reporters'

/** `testResults[]` with each file's own duration added, keyed by path. */
export function withFileDurations(report, durations) {
  return {
    ...report,
    testResults: (report.testResults ?? []).map((file) => ({
      ...file,
      duration: durations.get(file.name),
    })),
  }
}

export default class JsonWithFileDurations extends JsonReporter {
  durations = new Map()

  async onFinished(files = this.ctx.state.getFiles()) {
    this.durations = new Map(files.map((file) => [file.filepath, file.result?.duration]))
    await super.onFinished(files)
  }

  async writeReport(report) {
    await super.writeReport(JSON.stringify(withFileDurations(JSON.parse(report), this.durations)))
  }
}
