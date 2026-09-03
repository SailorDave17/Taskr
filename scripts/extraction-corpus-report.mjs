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
// The rendering is SHARED with scripts/extraction-run.mjs (#203 AC 4): a
// score's spelling lives in exactly one file, so the transcript runner cannot
// print the same figures a different way. The #202 due-date-axis commentary
// moved there with the code it explains.
import { killConditionSection, pct, scoreLines, shapeLine } from './extraction-report-format.mjs'

function score(label, summary) {
  for (const line of scoreLines(label, summary)) console.log(line)
}

const floor = await gradeExtraction(zeroExtractor, CORPUS)
const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)

console.log('Extraction corpus — #42')
console.log('='.repeat(78))
console.log('Corpus shape')
for (const kind of INPUT_KINDS) console.log(`  ${kind.padEnd(10)} ${shapeLine(ceiling.byKind[kind])}`)
console.log(`  ${'all'.padEnd(10)} ${shapeLine(ceiling.overall)}`)

console.log('')
console.log('FLOOR — the negative control: an extractor that answers with nothing (AC 4)')
for (const kind of INPUT_KINDS) score(kind, floor.byKind[kind])
score('all', floor.overall)

console.log('')
console.log("CEILING — the positive control: the corpus's own expected values (AC 5)")
for (const kind of INPUT_KINDS) score(kind, ceiling.byKind[kind])
score('all', ceiling.overall)

// #204 — the kill conditions, printed against BOTH controls.
//
// The controls are not candidate extractors, so neither verdict is a verdict on
// the bet. They are the two-sided control on the COMPARISON MECHANISM itself:
// the floor must fail every axis that has a figure and the ceiling must clear
// every one, so `npm test` exercises both outcomes on every run rather than
// only the outcome that happens to be true today. A comparator that could only
// print PASS would look identical to a working one until the day it mattered.
//
// Latency, cost and correction rate read "not measured" here and will keep
// reading it until #205, #206 and the capture flow supply figures. That is the
// point of printing them: an axis omitted from a report reads exactly like an
// axis that passed.
console.log('')
console.log('KILL CONDITIONS — the comparison mechanism, on both controls (#204)')
console.log('')
console.log('  FLOOR — every axis with a figure must FAIL, or the comparator cannot express one')
for (const line of killConditionSection({ graded: floor })) console.log(line)
console.log('')
console.log('  CEILING — every axis with a figure must PASS')
for (const line of killConditionSection({ graded: ceiling })) console.log(line)

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
