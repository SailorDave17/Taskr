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
// else; this file only spells its numbers.

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
