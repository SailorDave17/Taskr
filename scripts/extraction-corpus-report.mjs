// Re-derive the extraction corpus figures — #42.
//
// AC 3 asks for a grader that reports per-description absolute error, the
// proportion within tolerance, the attribution counts and the refusals. This is
// the command that prints them; docs/extraction-corpus.md holds the recorded
// numbers, and a test in src/lib/extraction.test.js fails when the document and
// this command disagree, so the record cannot quietly fall behind the corpus.
//
// It grades the TWO CONTROL EXTRACTORS (AC 4 and AC 5) rather than a real one,
// because there is no real one yet — #56 stands up the endpoint and #43 drives
// a live model through this same grader. What this command prints today is the
// SCALE: the floor a do-nothing extractor reaches and the ceiling the corpus's
// own answers reach. A later score is read as a position between them.
//
// Figures are reported PER KIND as well as overall, which is the charter's
// 2026-08-08 widening stated as a number: a good capacity score must not be
// able to hide a poor chore score.

import { gradeExtraction, oracleExtractorFor, zeroExtractor, INPUT_KINDS } from '../src/lib/extraction.js'
import { CORPUS } from '../src/lib/extraction.corpus.js'

const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`)

function shape(summary) {
  return [
    `total ${String(summary.total).padStart(3)}`,
    `answerable ${String(summary.answerable).padStart(3)}`,
    `ambiguous ${String(summary.ambiguous).padStart(3)}`,
  ].join('   ')
}

function score(label, summary) {
  console.log(`  ${label.padEnd(10)}`)
  console.log(
    `    within tolerance      ${String(summary.withinTolerance).padStart(3)} of ${String(
      summary.answerable,
    ).padStart(3)}   (${pct(summary.withinTolerance, summary.answerable)})`,
  )
  console.log(
    `    absolute error        ${String(summary.totalAbsoluteErrorMinutes).padStart(3)} minutes total, worst ${summary.worstAbsoluteErrorMinutes} on one entity`,
  )
  console.log(
    `    attribution           ${summary.unattributed} unattributed, ${summary.misattributed} misattributed`,
  )
  console.log(
    `    refusals              ${summary.refusals.total} (${summary.refusals.onAmbiguous} correct, ${summary.refusals.onAnswerable} on answerable)`,
  )
  console.log(`    overconfident         ${summary.overconfident} of ${summary.ambiguous} ambiguous`)
  console.log(`    unparseable           ${summary.malformed}`)
  // #202 — the due-date axis, its own figure with its own floor and ceiling,
  // never folded into the within-tolerance count above: that scale is the one
  // the owner's accuracy threshold is named against. Applies to chore
  // descriptions only, so the capacity row reads a dash rather than a vacuous
  // zero-of-zero.
  if (summary.dueApplicable > 0) {
    console.log(
      `    due dates exact       ${String(summary.dueExact).padStart(3)} of ${String(
        summary.dueApplicable,
      ).padStart(3)}   (${pct(summary.dueExact, summary.dueApplicable)}), ${summary.dueInvented} invented`,
    )
  } else {
    console.log('    due dates exact       —   (no due-date expectations in this kind)')
  }
}

const floor = await gradeExtraction(zeroExtractor, CORPUS)
const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)

console.log('Extraction corpus — #42')
console.log('='.repeat(78))
console.log('Corpus shape')
for (const kind of INPUT_KINDS) console.log(`  ${kind.padEnd(10)} ${shape(ceiling.byKind[kind])}`)
console.log(`  ${'all'.padEnd(10)} ${shape(ceiling.overall)}`)

console.log('')
console.log('FLOOR — the negative control: an extractor that answers with nothing (AC 4)')
for (const kind of INPUT_KINDS) score(kind, floor.byKind[kind])
score('all', floor.overall)

console.log('')
console.log("CEILING — the positive control: the corpus's own expected values (AC 5)")
for (const kind of INPUT_KINDS) score(kind, ceiling.byKind[kind])
score('all', ceiling.overall)

console.log('')
console.log('='.repeat(78))
console.log(
  `The scale a real extractor is read against: ${pct(
    floor.overall.withinTolerance,
    floor.overall.answerable,
  )} to ${pct(ceiling.overall.withinTolerance, ceiling.overall.answerable)} within tolerance.`,
)
console.log(
  `The due-date axis (#202), scored separately: ${floor.overall.dueExact} of ${floor.overall.dueApplicable} to ${ceiling.overall.dueExact} of ${ceiling.overall.dueApplicable} exact.`,
)
console.log('No network call, no API key, no provider account. #56 stands up the endpoint; #43 takes the verdict.')

export const FIGURES = { floor, ceiling }
