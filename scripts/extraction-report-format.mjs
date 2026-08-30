// The one rendering of an extraction summary — #203 AC 4.
//
// Extracted from `extraction-corpus-report.mjs` when the transcript runner
// arrived, because "prints the same report" is only checkable while there is
// exactly one implementation of the printing. Both commands import these; a
// second copy of a figure's spelling is the drift `src/test/gate.test.js`
// already hunts in the README, arriving in stdout instead.
//
// Everything here RETURNS lines rather than printing them, so a test can
// assert two commands render one summary identically without capturing stdout.
// The score arithmetic itself lives in `src/lib/extraction.js` and nowhere
// else; this file only spells its numbers. The same split holds for #204's
// kill conditions: every threshold and every verdict is decided in
// `src/lib/extractionThresholds.js`, and this file only spells them.

import { SCOPES, VERDICTS, killConditionRows, verdictOf } from '../src/lib/extractionThresholds.js'

/** A percentage cell, or an em dash where the denominator is zero. */
export const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`)

/** The one-line shape of a summary: totals, answerable, ambiguous. */
export function shapeLine(summary) {
  return [
    `total ${String(summary.total).padStart(3)}`,
    `answerable ${String(summary.answerable).padStart(3)}`,
    `ambiguous ${String(summary.ambiguous).padStart(3)}`,
  ].join('   ')
}

/**
 * The scored block for one summary, labelled. Every figure the grader keeps,
 * including the due-date axis as its own row with its own scale (#202) —
 * a dash rather than a vacuous zero-of-zero where the axis does not apply.
 */
export function scoreLines(label, summary) {
  const lines = [
    `  ${label.padEnd(10)}`,
    `    within tolerance      ${String(summary.withinTolerance).padStart(3)} of ${String(
      summary.answerable,
    ).padStart(3)}   (${pct(summary.withinTolerance, summary.answerable)})`,
    `    absolute error        ${String(summary.totalAbsoluteErrorMinutes).padStart(3)} minutes total, worst ${summary.worstAbsoluteErrorMinutes} on one entity`,
    `    attribution           ${summary.unattributed} unattributed, ${summary.misattributed} misattributed`,
    `    refusals              ${summary.refusals.total} (${summary.refusals.onAmbiguous} correct, ${summary.refusals.onAnswerable} on answerable)`,
    `    overconfident         ${summary.overconfident} of ${summary.ambiguous} ambiguous`,
    `    unparseable           ${summary.malformed}`,
  ]
  if (summary.dueApplicable > 0) {
    lines.push(
      `    due dates exact       ${String(summary.dueExact).padStart(3)} of ${String(
        summary.dueApplicable,
      ).padStart(3)}   (${pct(summary.dueExact, summary.dueApplicable)}), ${summary.dueInvented} invented`,
    )
  } else {
    lines.push('    due dates exact       —   (no due-date expectations in this kind)')
  }
  return lines
}

/** How a verdict is spelled in a column, widest first so the block lines up. */
const VERDICT_CELL = {
  [VERDICTS.PASS]: 'PASS',
  [VERDICTS.FAIL]: 'FAIL',
  [VERDICTS.NOT_MEASURED]: 'not measured',
}

/**
 * One axis: what was measured, what it must clear, and which of the three
 * outcomes that is — #204 AC 2.
 *
 * A not-measured row prints the REASON there is no figure instead of a
 * comparison. Printing a threshold beside a blank cell would read as a
 * comparison that was made and came out fine, which is the misreading this
 * whole story exists to prevent.
 */
export function axisLine(row) {
  const cell = VERDICT_CELL[row.verdict]
  const label = `    ${row.axis.label.padEnd(28)}`
  if (row.verdict === VERDICTS.NOT_MEASURED) {
    return `${label}${'—'.padEnd(14)}${cell.padEnd(14)}${row.pending}`
  }
  // A row claiming a verdict with no figure is an internal inconsistency, and
  // it is reported IN BAND rather than thrown. Found by the #204 AC 6 mutation,
  // which reached `render` with an undefined value and killed the whole report
  // inside a `.toFixed` — on a path that runs at the END of a live run, after
  // every provider call has been paid for. Losing the report to a TypeError is
  // the worst available outcome there, and a stack trace naming `toFixed` tells
  // the reader nothing about which axis broke. This says which, stays loud
  // enough that nobody reads it as a result, and lets the other axes print.
  if (!Number.isFinite(row.value)) {
    return (
      `${label}${'—'.padEnd(14)}${'!! BROKEN'.padEnd(14)}` +
      `internal: ${row.axis.key} claims "${row.verdict}" with no figure`
    )
  }
  return (
    `${label}${row.axis.render(row.value, row.outOf).padEnd(14)}${cell.padEnd(14)}` +
    `threshold ${row.axis.renderThreshold(row.threshold, row.outOf)}`
  )
}

/**
 * The kill-condition block for one scope: every axis that applies there, then
 * the scope's own verdict NAMING the axes that produced it (AC 4).
 *
 * "FAIL" on its own would be the single combined verdict the criterion forbids:
 * a latency failure and an accuracy failure are the same word and different
 * actions. So the summary line lists what failed, keeps a date shortfall
 * separate because it NARROWS the bet rather than killing it, and says outright
 * when a pass is a pass over an incomplete sheet.
 */
export function killConditionLines(label, figures, scope) {
  const rows = killConditionRows(figures, scope)
  const summary = verdictOf(rows)
  const lines = [`  ${label.padEnd(10)}`, ...rows.map(axisLine)]

  const named = (subject) => subject.map((row) => row.axis.key).join(', ')
  const parts = []
  if (summary.kills.length) parts.push(`FAILS on ${named(summary.kills)}`)
  if (summary.narrows.length) parts.push(`NARROWS on ${named(summary.narrows)}`)
  if (!summary.kills.length && !summary.narrows.length) parts.push('clears every axis with a figure')
  if (!summary.complete) parts.push(`NOT YET MEASURED: ${named(summary.notMeasured)}`)
  lines.push(`    ${'verdict'.padEnd(28)}${parts.join(' · ')}`)
  return lines
}

/**
 * The whole kill-condition section: one block per input kind, then the run.
 *
 * Per kind and not merely overall, because capacity 25 of 25 with chores 10 of
 * 25 is 35 of 50 — clearing the accuracy kill number on a run whose chore half
 * is broken. Two verdicts is the only shape that can stop chore capture while
 * sparing capacity, which is the outcome the owner named as most likely.
 */
export function killConditionSection(figures) {
  return SCOPES.flatMap((scope) => killConditionLines(scope, figures, scope))
}
