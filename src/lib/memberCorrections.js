// The correction rate — the one kill number no corpus can reach (#207).
//
// Every other axis the extraction bet is judged on is scored against expected
// values somebody wrote down in advance. This one cannot be: it counts how
// often a REAL HOUSEHOLD MEMBER had to fix a figure the extractor proposed
// from a sentence THEY wrote, and there is no expected value anywhere — the
// member's judgement is the ground truth, recorded after the fact.
//
// That makes it the only axis whose input is an observation rather than a
// computation, so this module is deliberately small and does exactly one
// thing: turn a list of recorded corrections into a rate, per input kind and
// overall, with the denominator defined so that the two degenerate extractors
// land at the ends of the scale rather than at the good end.
//
// THE DENOMINATOR IS THE WHOLE DESIGN
//
// The obvious denominator — figures the extractor PROPOSED — scores an
// extractor that proposes nothing at a perfect 0%: it never put a wrong figure
// in front of anybody, so nothing it did was corrected. That is the same fault
// `src/lib/extraction.js`'s floor control forced out of the minutes grader
// ("grade tolerance on matched entities alone and the do-nothing extractor
// scores a perfect 100%"), arriving in a different axis wearing different
// clothes. `docs/extraction-corpus.md` states it for that grader; it is
// restated here because a reader arriving at this axis has no reason to go
// looking for it.
//
// So the denominator is every figure the member HAD TO DEAL WITH:
//
//     proposed figures  +  figures the member had to supply themselves
//
// and the numerator is every correction, of any class. A refusal on a sentence
// naming three people therefore reads 3 of 3 — 100% — because the member typed
// all three by hand, which is what "the extraction did not help" means when the
// question is trust rather than accuracy. A flawless extraction of the same
// sentence reads 0 of 3.
//
// The two controls are asserted in `memberCorrections.test.js`, and they are
// the reason to believe any figure in between.
//
// WHAT "HAD TO SUPPLY" MEANS, PRECISELY — AND IT IS NARROWER THAN IT SOUNDS
//
// A supplied figure reaches the denominator only when the member RECORDED it as
// a correction. That is not an oversight and it is stated here because the
// paragraph above, read alone, promises something wider: a review lens read it
// as a defect on 2026-09-07, and it is the more natural reading.
//
// The narrower rule is the owner's, taken at #207's rulings. Where a sentence
// states no duration at all, the figure the member then types is an HONEST
// BLANK — the confirm form's own empty field — not a correction of anything the
// extraction did. Counting those in the denominator would flatter the rate
// (more figures, the same corrections); counting them in both would punish the
// extractor for a quantity the member never gave it. The owner ruled they are
// neither, and 19 of the 20 refused rows in the committed review are that case.
//
// The consequence to know: the shipped rate is HARSHER than this file's own
// floor example implies, because that example describes a refusal on a sentence
// that DID name three people's time. Both rules are in play, and which applies
// is decided by whether the sentence carried the quantity.

/**
 * The five classes a correction is recorded as — #207 AC 2, verbatim from the
 * criterion, "because those five damage trust differently and a single
 * correction count cannot distinguish them".
 *
 * They split two ways, and the split is what the arithmetic reads:
 *
 *   ON A PROPOSED FIGURE   the extractor put something on screen and it was
 *                          wrong. Already counted in `proposed`.
 *   SUPPLIED BY THE MEMBER the figure was not there and the member typed it.
 *                          Adds to the denominator; nothing else does.
 */
export const CORRECTION_CLASSES = Object.freeze({
  WRONG_NUMBER: 'wrong number',
  MISSED_ENTITY: 'missed entity',
  INVENTED_ENTITY: 'invented entity',
  WRONG_DATE: 'wrong date',
  REFUSAL: 'refusal',
})

/**
 * Which classes describe a figure the member had to supply.
 *
 * `REFUSAL` is here rather than being a property of the sentence: a refused
 * sentence contributes one correction PER FIGURE the member then typed, so a
 * refusal on a three-person sentence weighs three times a refusal on a
 * one-person sentence. Recording it per sentence would make the rate depend on
 * how the member happened to split their week across messages.
 */
const SUPPLIED = Object.freeze([CORRECTION_CLASSES.MISSED_ENTITY, CORRECTION_CLASSES.REFUSAL])

/** Every class, for validation and for the per-class breakdown AC 2 asks for. */
export const ALL_CLASSES = Object.freeze(Object.values(CORRECTION_CLASSES))

/**
 * How many figures one extractor answer put in front of the member.
 *
 * A capacity answer proposes one figure per person. A chore answer proposes the
 * job's minutes, plus its due date WHERE IT RETURNED ONE — an omitted date is
 * not a figure the member had to check, and counting it as one would inflate
 * every denominator by the number of chores the extractor correctly left
 * undated. A refusal and an answer nothing could parse propose nothing.
 *
 * This is derived from the answer rather than typed by the member, because it
 * is the one number in the input that IS a computation, and a hand-typed count
 * that disagreed with the answer would be undetectable.
 */
export function proposedFigures(answer) {
  if (!answer || typeof answer !== 'object') return 0
  if (answer.kind === 'capacity') {
    return Object.keys(answer.minutesByPerson ?? {}).length
  }
  if (answer.kind === 'chores') {
    return (answer.chores ?? []).reduce(
      (total, chore) => total + 1 + (chore?.dueDate === undefined || chore?.dueDate === null ? 0 : 1),
      0,
    )
  }
  // Refusals, and anything the adapter could not turn into one of the two
  // contract shapes, propose nothing. They are not free: whatever the member
  // then typed arrives as SUPPLIED corrections and lands in the denominator.
  return 0
}

/**
 * One reviewed sentence: what the extractor answered, and what the member had
 * to fix. Returns the two counts the rate is built from, and refuses input it
 * cannot score rather than scoring it wrong.
 */
export function scoreSentence(review) {
  const corrections = review.corrections ?? []
  for (const correction of corrections) {
    if (!ALL_CLASSES.includes(correction.class)) {
      throw new Error(
        `unknown correction class "${correction.class}" on ${review.id} — expected one of: ${ALL_CLASSES.join(', ')}`,
      )
    }
  }
  const proposed = proposedFigures(review.answer)
  const supplied = corrections.filter((c) => SUPPLIED.includes(c.class)).length

  // A correction on a proposed figure cannot outnumber the proposed figures:
  // that means the answer and the markup describe different runs, which is
  // silent and fatal — the rate would still compute, and be about nothing.
  const onProposed = corrections.length - supplied
  if (onProposed > proposed) {
    throw new Error(
      `${review.id}: ${onProposed} corrections on proposed figures but the answer proposed only ${proposed}` +
        ' — the markup and the transcript disagree',
    )
  }

  return { id: review.id, kind: review.kind, proposed, supplied, corrections: corrections.length }
}

/**
 * A review of a sentence that is a RE-FRAMING of another sentence already in
 * the set — the second arm of an experiment, not new evidence.
 *
 * #207 ran ten capacity sentences twice: once as the app sends them, once with
 * the question that drew them prepended. Both arms were reviewed, and scoring
 * both into one rate counts the same member language twice. *Measured*: it
 * moved the run-level figure from 9 of 30 to 10 of 33 — 30.00% to 30.30% — and
 * flipped the axis from meeting the owner's ceiling to failing it, on an arm
 * the document itself records as having produced identical outcomes. An
 * experiment arm that contributes no information must not move the denominator.
 *
 * So a review carrying `variantOf` is tallied SEPARATELY and never folded into
 * its scope's totals. It is not discarded: the comparison is the whole point of
 * running it, and a variant silently dropped would be indistinguishable from
 * one nobody ran.
 */
const isVariant = (review) => Boolean(review.variantOf)

/** Blank tallies, so a kind with no sentences reads as a zero rather than absent. */
const emptyTally = () => ({
  sentences: 0,
  proposed: 0,
  supplied: 0,
  corrections: 0,
  byClass: Object.fromEntries(ALL_CLASSES.map((name) => [name, 0])),
})

/**
 * The correction rate, per input kind and overall — #207 AC 1.
 *
 * `rate` is `null`, never zero, where nothing was reviewed. A zero rate is the
 * BEST possible result on this axis, so returning one for an empty run would
 * report the strongest evidence the bet can produce from no evidence at all —
 * the failure `extractionThresholds.js` calls "a report that passes an axis
 * nothing has measured".
 */
export function correctionRates(reviews, { withheld } = {}) {
  const tallies = { capacity: emptyTally(), chores: emptyTally(), all: emptyTally() }
  const variants = { capacity: emptyTally(), chores: emptyTally(), all: emptyTally() }

  for (const review of reviews) {
    const scored = scoreSentence(review)
    const into = isVariant(review) ? variants : tallies
    if (!into[scored.kind]) throw new Error(`unknown input kind "${scored.kind}" on ${scored.id}`)
    for (const scope of [scored.kind, 'all']) {
      const tally = into[scope]
      tally.sentences += 1
      tally.proposed += scored.proposed
      tally.supplied += scored.supplied
      tally.corrections += scored.corrections
    }
    for (const correction of review.corrections ?? []) {
      into[scored.kind].byClass[correction.class] += 1
      into.all.byClass[correction.class] += 1
    }
  }

  // Sentences whose TEXT is not in this repository but whose arithmetic is —
  // #207 withheld two describing the owner's child. Their tallies are folded in
  // here, in the one place the rate is computed, rather than by whoever happens
  // to be reading. Leaving this to the caller is how the shipped document came
  // to print a figure its own named command could not produce.
  if (withheld) {
    const kind = withheld.kind
    if (!tallies[kind]) throw new Error(`withheld tallies name unknown kind "${kind}"`)
    // These numbers are typed by hand into a JSON file, standing in for
    // sentences whose text is not in the repository — so nothing can check them
    // against an answer, and they are the one input to the rate with no
    // artefact behind it. Validate the shape at least: an incoherent block
    // otherwise flows straight into a published figure, and one spelling of it
    // (corrections with no figures) renders a measured axis as "not measured".
    const { proposed = 0, supplied = 0, corrections = 0, count = 0 } = withheld
    for (const [name, value] of Object.entries({ proposed, supplied, corrections, count })) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`withheld tallies: ${name} must be a non-negative integer, got ${value}`)
      }
    }
    if (corrections > proposed + supplied) {
      throw new Error(
        `withheld tallies: ${corrections} corrections over ${proposed + supplied} figures — ` +
          'a correction has to be on a figure somebody dealt with',
      )
    }
    const byClassTotal = Object.values(withheld.byClass ?? {}).reduce((a, b) => a + b, 0)
    if (byClassTotal !== corrections) {
      throw new Error(
        `withheld tallies: byClass sums to ${byClassTotal} but corrections is ${corrections}`,
      )
    }
    if (count === 0 && (proposed || supplied || corrections)) {
      throw new Error('withheld tallies carry figures but no sentences')
    }
    for (const scope of [kind, 'all']) {
      tallies[scope].proposed += withheld.proposed ?? 0
      tallies[scope].supplied += withheld.supplied ?? 0
      tallies[scope].corrections += withheld.corrections ?? 0
      tallies[scope].withheldSentences = (tallies[scope].withheldSentences ?? 0) + (withheld.count ?? 0)
    }
    for (const [name, count] of Object.entries(withheld.byClass ?? {})) {
      if (!ALL_CLASSES.includes(name)) throw new Error(`withheld tallies name unknown class "${name}"`)
      tallies[kind].byClass[name] += count
      tallies.all.byClass[name] += count
    }
  }

  for (const group of [tallies, variants]) {
    for (const tally of Object.values(group)) {
      tally.figures = tally.proposed + tally.supplied
      tally.rate = tally.figures === 0 ? null : tally.corrections / tally.figures
    }
  }
  tallies.variants = variants
  return tallies
}
