// The kill conditions the extraction bet is judged against — #204.
//
// The owner named five kill numbers on 2026-08-26, BEFORE any measurement, and
// they are recorded on epic #217 and in `docs/extraction-corpus.md`. This module
// is the ONE place each of them is written down (AC 2): the corpus report, the
// transcript runner and #207's verdict all read them from here, so a threshold
// cannot be restated at a call site and quietly disagree with the one the owner
// ratified.
//
// It is a LEAF. It imports nothing, reads no environment variable and makes no
// call — the same wall `src/lib/extraction.js` states for itself, for the same
// reason: nothing in the app calls any of this, and an instrument that can
// reach the network is an instrument whose figures can be blamed on the network.
// (The app does READ one value from here — `CLIENT_WAIT_MS`, derived from the
// latency kill number, which #210's capture flow waits for — and reading a
// constant is not a call.)
//
// WHAT AN AXIS IS
//
// A threshold, a direction, the scopes it was named against, and a `measure`
// that either produces a figure or says WHY there is none. That last half is
// the whole point of the story: an axis with no figure must print "not
// measured", never "pass", because a report that passes an axis nothing has
// measured is exactly what a report looks like when nothing ran — and this
// report's entire authority is that a FAIL is real.
//
// PER KIND, AND WHERE THE PER-KIND NUMBERS COME FROM
//
// The verdict is recorded per input kind — two verdicts, capacity and chores,
// never one combined — because proceed-on-capacity / stop-on-chores is the most
// likely non-trivial outcome and a combined figure cannot express it: capacity
// 25 of 25 plus chores 10 of 25 is 35 of 50, which CLEARS the accuracy kill
// number while chore capture is broken.
//
// The owner's numbers are counts against the combined corpus, so the per-kind
// ones are derived by ONE stated rule rather than invented per axis: the same
// RATE, applied to each half, rounded toward strictness. Ratified by the owner
// at pickup, 2026-08-30.
//
//     within tolerance   35 of 50 = 70%   ->  70% of 25 = 17.5  ->  >= 18 of 25
//     ambiguous refused   7 of 10 = 70%   ->  70% of  5 =  3.5  ->  >=  4 of  5
//     overconfident       2 of 10 = 20%   ->  20% of  5 =  1.0  ->  <=  1 of  5
//
// The corpus is exactly symmetric — 25 answerable and 5 ambiguous of each kind —
// which is what makes the halving clean rather than a fudge. A test asserts that
// symmetry, so a corpus that stopped being symmetric reddens here instead of
// silently repricing a decided bet.

/** Every outcome an axis can reach. `NOT_MEASURED` is not a kind of pass. */
export const VERDICTS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  NOT_MEASURED: 'not measured',
})

/** The scopes a verdict is taken at: one per input kind, plus the whole run. */
export const SCOPES = Object.freeze(['capacity', 'chores', 'all'])

/**
 * What a failure MEANS, which is not uniform and was ratified as not uniform.
 * Four axes kill the bet; the date axis, below its floor, NARROWS it — the
 * chore contract keeps the field and the confirm form supplies it. A summary
 * that flattened the two would report a survivable result as a stop.
 */
export const SEVERITY = Object.freeze({ KILLS: 'kills', NARROWS: 'narrows' })

/** A measured figure, or the reason there is none. Never both. */
const measured = (value, outOf) => ({ value, outOf })
const pending = (why) => ({ pending: why })

/**
 * A figure that was COMPUTED FROM measurements rather than taken from one —
 * #207 AC 3, which requires the deployed-path p95 to be "labelled an estimate
 * rather than a measurement".
 *
 * This is a third fact, orthogonal to the figure/pending pair above: those say
 * whether there is a number, this says how it was arrived at. A reading carries
 * `estimate` as the reason it is one, so the row can print it and the verdict
 * can call a pass over it PROVISIONAL — an estimate that clears a kill number
 * is not the same claim as a measurement that clears it, and the difference is
 * exactly what a proceed decision must not lose.
 */
const estimated = (value, why, outOf) => ({ value, outOf, estimate: why })

/**
 * A figure is a number or it is absent — and `0` is a MEASUREMENT. `!value`
 * would read a zero-millisecond p95 and a missing one as the same thing, which
 * is the exact confusion this story exists to stop.
 */
const isFigure = (value) => Number.isFinite(value)

/** The graded summary for one scope, or `undefined` where no run was supplied. */
function summaryFor(figures, scope) {
  const graded = figures.graded
  if (!graded) return undefined
  return scope === 'all' ? graded.overall : graded.byKind?.[scope]
}

/** Read one field off the graded summary for a scope, or say there is no run. */
function fromGraded(read) {
  return (figures, scope) => {
    const summary = summaryFor(figures, scope)
    if (!summary) return pending('no graded run')
    return read(summary)
  }
}

const countOf = (value, outOf) => `${value} of ${outOf}`

/**
 * The deployed-path latency kill number, in milliseconds — the ONE place it is
 * written. Exported on its own because #210's capture flow WAITS this long for
 * a proposal (its AC 2): the number the bet is judged on and the number a
 * member waits for are one constant, so neither can drift from the other. The
 * latency axis below reads it rather than restating it.
 */
export const DEPLOYED_LATENCY_BUDGET_MS = 3000

/**
 * How long a PHONE waits for one proposal before offering the typed field —
 * #210's per-request abort. DERIVED from the kill number, deliberately not
 * equal to it (review-fanout escalation, owner decision 2026-09-04): the kill
 * number is a p95 CEILING the bet is judged against, under which one answer in
 * twenty is expected to be slower even when the bet passes — and the diff that
 * first bound the two together carried a recorded, correct refusal at 3060 ms
 * provider-only. Read the ceiling as an abort and a correct slow-tail answer
 * reaches the member as a timeout. One constant governing two subjects is
 * `a-ceiling-that-holds-is-not-a-fit`; this is the second constant.
 *
 * Twice the ceiling: the p95 plus one more p95-sized tail, so the abort sits
 * where an answer has stopped being slow and started being absent. Still one
 * named constant read by one caller (`src/lib/capture.js`), which is what
 * #210 AC 2 asks for; a first version of this file had the flow read the kill
 * number itself. #205's phone measurement is what can move this — it records
 * the deployed round trip this margin is a guess about.
 */
export const CLIENT_WAIT_MS = DEPLOYED_LATENCY_BUDGET_MS * 2

/**
 * The five ratified kill numbers, as seven axes.
 *
 * `thresholds` is keyed by scope: an axis absent from a scope has no row there
 * rather than a fourth "not applicable" verdict. Due dates apply to chore
 * descriptions only — a week has no due date — so they carry no capacity entry,
 * and their `all` threshold is the same number because capacity contributes no
 * applicable item to the overall denominator (asserted, not assumed).
 *
 * Latency and cost are named at the run level and have no per-kind meaning:
 * one provider call serves whichever kind it was handed, at one price.
 *
 * THE CORRECTION RATE IS NOT LIKE THEM, and this comment said it was until
 * #207 measured it. Its unit is a FIGURE the member had to deal with, and every
 * figure belongs to exactly one kind — so the rate decomposes cleanly, and
 * *measured 2026-09-07* the two halves came apart: capacity 33.3% against
 * chores 29.6%, on either side of the kill number. A run-level-only rate would
 * have reported one number over both and hidden the split the epic exists to
 * express. The per-kind threshold is the owner's own number unchanged, because
 * their stated rule is "the same RATE applied to each half" and 30% is already
 * a rate — the halving that rounds toward strictness applies to counts, and
 * there are no counts here.
 */
export const KILL_CONDITIONS = Object.freeze([
  Object.freeze({
    key: 'accuracy',
    label: 'within tolerance',
    direction: 'atLeast',
    severity: SEVERITY.KILLS,
    thresholds: Object.freeze({ capacity: 18, chores: 18, all: 35 }),
    render: countOf,
    renderThreshold: (threshold, outOf) => `>= ${countOf(threshold, outOf ?? '?')}`,
    measure: fromGraded((s) => measured(s.withinTolerance, s.answerable)),
  }),
  Object.freeze({
    key: 'refusals',
    label: 'ambiguous refused',
    direction: 'atLeast',
    severity: SEVERITY.KILLS,
    thresholds: Object.freeze({ capacity: 4, chores: 4, all: 7 }),
    render: countOf,
    renderThreshold: (threshold, outOf) => `>= ${countOf(threshold, outOf ?? '?')}`,
    measure: fromGraded((s) => measured(s.refusals.onAmbiguous, s.ambiguous)),
  }),
  Object.freeze({
    key: 'overconfident',
    label: 'overconfident',
    direction: 'atMost',
    severity: SEVERITY.KILLS,
    thresholds: Object.freeze({ capacity: 1, chores: 1, all: 2 }),
    render: countOf,
    renderThreshold: (threshold, outOf) => `<= ${countOf(threshold, outOf ?? '?')}`,
    measure: fromGraded((s) => measured(s.overconfident, s.ambiguous)),
  }),
  Object.freeze({
    key: 'dates',
    label: 'due dates exact',
    direction: 'atLeast',
    severity: SEVERITY.NARROWS,
    thresholds: Object.freeze({ chores: 18, all: 18 }),
    render: countOf,
    renderThreshold: (threshold, outOf) => `>= ${countOf(threshold, outOf ?? '?')}`,
    measure: fromGraded((s) => measured(s.dueExact, s.dueApplicable)),
  }),
  Object.freeze({
    key: 'latency',
    label: 'p95, deployed path',
    direction: 'atMost',
    severity: SEVERITY.KILLS,
    thresholds: Object.freeze({ all: DEPLOYED_LATENCY_BUDGET_MS }),
    render: (value) => `${value} ms`,
    renderThreshold: (threshold) => `<= ${threshold} ms`,
    // The kill number is specified ON THE DEPLOYED PATH, which is transport and
    // cold start (#205, timed from a real phone) PLUS the provider call (#206,
    // timed by the transcript runner). NEITHER COMPONENT ALONE IS THIS FIGURE.
    // A local run measures this machine to the provider and would understate a
    // phone's round trip by the whole transport leg — so feeding it in here
    // would be the failure this story is about, wearing a real measurement's
    // clothes. Both components or nothing, and the row names which one is
    // missing rather than saying only that something is.
    measure: (figures) => {
      const { transportP95Ms, providerCallP95Ms } = figures.latency ?? {}
      const absent = [
        isFigure(transportP95Ms) ? null : 'transport and cold start (#205)',
        isFigure(providerCallP95Ms) ? null : 'the provider call (#206)',
      ].filter(Boolean)
      if (absent.length) return pending(`needs ${absent.join(' and ')}`)
      // THE SUM OF TWO p95s IS NOT THE p95 OF THE SUM, and saying so is #207
      // AC 3's whole point: "summing two p95 figures does not produce the p95
      // of the sum and claiming otherwise would put a false arithmetic claim
      // inside the artefact the whole block is judged by".
      //
      // Under independence the sum OVERSTATES, because both legs landing in
      // their own slowest 5% at the same moment is rarer than one leg doing it
      // — so it is the conservative direction, which is the right way for a
      // kill number to be wrong. Under positive correlation it can understate;
      // nothing here measures the correlation, and until the extraction
      // endpoint exists nothing can, because the two legs have never been in
      // the same request. That is why this is an estimate and stays one until
      // #209 times the deployed endpoint end to end.
      return estimated(
        transportP95Ms + providerCallP95Ms,
        'transport p95 + provider p95; the sum of two p95s is not the p95 of the sum',
      )
    },
  }),
  Object.freeze({
    key: 'cost',
    label: 'cost per household per year',
    direction: 'atMost',
    severity: SEVERITY.KILLS,
    thresholds: Object.freeze({ all: 5 }),
    render: (value) => `$${value.toFixed(2)}`,
    renderThreshold: (threshold) => `<= $${threshold.toFixed(2)}`,
    measure: (figures) =>
      isFigure(figures.costPerHouseholdPerYearUsd)
        ? measured(figures.costPerHouseholdPerYearUsd)
        : pending('needs token usage from a live run (#206)'),
  }),
  Object.freeze({
    key: 'correctionRate',
    label: 'correction rate',
    direction: 'atMost',
    severity: SEVERITY.KILLS,
    thresholds: Object.freeze({ capacity: 0.3, chores: 0.3, all: 0.3 }),
    render: (value) => `${(value * 100).toFixed(1)}%`,
    renderThreshold: (threshold) => `<= ${(threshold * 100).toFixed(0)}%`,
    // The one kill number no corpus can reach: it counts how often a real member
    // fixes a figure the extraction proposed, so its ground truth is a person's
    // judgement rather than an expected value anybody wrote down. It is carried
    // here and prints "not measured" until there is one, because an axis
    // silently missing from a report reads exactly like an axis that passed.
    // (#204 AC 1 names six thresholds and omits this one; epic #217 names it as
    // one of the five. Owner decision at pickup, 2026-08-30: carry it, so the
    // report is the one place all five live.)
    //
    // #207 measured it from a REVIEW — a member scoring extractions of sentences
    // they wrote — which is not the same instrument as the capture flow in
    // production, and is weaker: nobody has yet corrected a figure with the
    // confirm form in front of them. The figure is real and the caveat travels
    // with it in `docs/extraction-verdict.md`.
    //
    // A bare number is read as the run-level rate and leaves the per-kind rows
    // unmeasured, rather than quietly reporting the overall figure at both —
    // which would report capacity's verdict using chores' evidence.
    measure: (figures, scope) => {
      const rate = figures.correctionRate
      const value = rate !== null && typeof rate === 'object' ? rate[scope] : scope === 'all' ? rate : undefined
      return isFigure(value) ? measured(value) : pending('needs a scored member-sentence run (#207)')
    },
  }),
])

/**
 * Every axis that applies at `scope`, each with its figure, its threshold and
 * its verdict.
 *
 * The not-measured branch RETURNS rather than falling through to a comparison.
 * That ordering is the criterion: a comparison against a missing figure is a
 * comparison against `undefined`, and an at-most axis written as
 * `!(value > threshold)` answers `true` for one — a pass, printed with total
 * confidence, on an axis nothing has measured.
 */
export function killConditionRows(figures, scope) {
  if (!SCOPES.includes(scope)) throw new Error(`unknown scope: ${scope}`)
  return KILL_CONDITIONS.filter((axis) => axis.thresholds[scope] !== undefined).map((axis) => {
    const threshold = axis.thresholds[scope]
    const reading = axis.measure(figures, scope)
    if (reading.pending !== undefined) {
      return { axis, scope, threshold, verdict: VERDICTS.NOT_MEASURED, pending: reading.pending }
    }
    const { value, outOf, estimate } = reading
    const meets = axis.direction === 'atLeast' ? value >= threshold : value <= threshold
    return {
      axis,
      scope,
      threshold,
      value,
      outOf,
      estimate,
      verdict: meets ? VERDICTS.PASS : VERDICTS.FAIL,
    }
  })
}

/**
 * The scope's own verdict, and — the criterion — WHICH axes produced it.
 *
 * Never a single combined pass/fail: the owner's response to a latency failure
 * and to an accuracy failure are different actions, so a summary reporting only
 * "FAIL" would throw away the half that decides what to do next.
 */
export function verdictOf(rows) {
  const failing = rows.filter((row) => row.verdict === VERDICTS.FAIL)
  const kills = failing.filter((row) => row.axis.severity === SEVERITY.KILLS)
  const narrows = failing.filter((row) => row.axis.severity === SEVERITY.NARROWS)
  const notMeasured = rows.filter((row) => row.verdict === VERDICTS.NOT_MEASURED)
  // An axis that CLEARS its threshold on an estimate is reported separately
  // from one that clears it on a measurement — #207 AC 3 requires the verdict
  // to say "cleared, provisionally cleared pending the deployed endpoint, or
  // failed", which is three outcomes where `verdict` alone offers two. A FAIL
  // on an estimate is not provisional in the same way: the conservative
  // direction of the arithmetic means a failing estimate is the weaker claim,
  // and it is reported as a fail with its estimate note attached.
  const provisional = rows.filter((row) => row.verdict === VERDICTS.PASS && row.estimate !== undefined)
  return {
    kills,
    narrows,
    notMeasured,
    provisional,
    // `complete` is reported separately from the verdict rather than folded into
    // it: "every axis passed" and "every axis anyone has measured passed" are
    // different claims, and the second is the one a stop/proceed call must not
    // be taken on by accident.
    complete: notMeasured.length === 0,
    verdict: kills.length ? VERDICTS.FAIL : VERDICTS.PASS,
  }
}
