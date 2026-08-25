// Scoring plain-language extraction against a fixed corpus — #42.
//
// This module is an INSTRUMENT, not a feature. Nothing in the app calls it. It
// exists so that "accurate enough" is a number rather than an impression, and
// so that the number is re-derivable by anyone rather than remembered by
// whoever ran it. The charter names extraction accuracy as one of three things
// that kill the AI bet; #43 is the story that takes the verdict, and this is
// the half of that measurement needing no account, key or deployment.
//
// WHAT AN EXTRACTOR IS
//
// A function taking `{ kind, text }` and answering. That is deliberately the
// whole of it — it is exactly what a real endpoint receives, so #56 can
// implement this contract rather than a convenient variant of it, and the
// grader can never leak the expected answer into the thing it is grading.
// `kind` is present because the app knows which flow it is in: a capacity
// update and a chore capture are two different screens, not one guess.
//
//     ({ kind: 'capacity', text }) => { kind: 'capacity', minutesByPerson: {...} }
//     ({ kind: 'chores',   text }) => { kind: 'chores', chores: [{ title, expectedMinutes }] }
//     (anything)                   => { kind: 'refusal', reason: '...' }
//
// The oracle control below needs to recognise which item it was handed, and it
// does so by KEYING ON THE TEXT rather than by being passed an id. That is why
// the corpus tests assert every description is unique: two identical
// descriptions would make the oracle ambiguous, and would also inflate a count
// silently.
//
// WHY IT IS ASYNC
//
// #43 drives a live model through this grader. A grader that cannot await is a
// grader that consumer has to reimplement, and a second implementation of the
// score is the one thing this artefact exists to prevent. Items are graded
// SEQUENTIALLY on purpose: a metered provider has a rate limit, and a run whose
// order varies is a run whose failures are harder to reproduce.

/** The two input kinds the bet covers. Widened from capacity-only 2026-08-08. */
export const INPUT_KINDS = Object.freeze(['capacity', 'chores'])

/**
 * The key two entity names are compared under.
 *
 * Case and surrounding whitespace only. Deliberately NOT stemming, synonyms or
 * any fuzzy distance: the whole purpose of the unattributed and misattributed
 * counts is to say whether the extractor found the RIGHT people and the RIGHT
 * jobs, and a matcher generous enough to pair a bare noun with the phrase it
 * came from is a matcher that cannot tell "found the right jobs" from "found
 * some jobs". The strictness is a stated property, recorded in
 * docs/extraction-corpus.md, rather than a limitation nobody wrote down.
 */
export function normalizeEntity(value) {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Every outcome the grader can name, as a value rather than a loose string. */
export const OUTCOMES = Object.freeze({
  WITHIN_TOLERANCE: 'within-tolerance',
  OUTSIDE_TOLERANCE: 'outside-tolerance',
  REFUSED: 'refused',
  OVERCONFIDENT: 'overconfident',
  MALFORMED: 'malformed',
})

/**
 * An answer reduced to `entity -> minutes`, or `null` where it is not one.
 *
 * Both kinds collapse to the same shape so ONE scoring rule covers both: for a
 * capacity description the entity is a person and the minutes are their week;
 * for a chore description the entity is the job's title and the minutes are how
 * long it takes. That is what lets AC 3's figures be reported per kind without
 * two graders that could quietly disagree.
 *
 * Returns `null` rather than throwing for anything that is not a well-formed
 * answer of the expected kind. #56 AC 3 requires an unparseable provider
 * response to map to a distinct stated failure, and a grader that throws on
 * first contact with a real model gives its caller no way to report one.
 */
export function entitiesOf(answer, expectedKind) {
  if (!answer || typeof answer !== 'object') return null
  if (answer.kind !== expectedKind) return null

  const entities = new Map()

  if (expectedKind === 'capacity') {
    const source = answer.minutesByPerson
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null
    for (const [person, minutes] of Object.entries(source)) {
      if (!Number.isFinite(minutes)) return null
      const key = normalizeEntity(person)
      if (!key || entities.has(key)) return null
      entities.set(key, minutes)
    }
    return entities
  }

  const source = answer.chores
  if (!Array.isArray(source)) return null
  for (const chore of source) {
    if (!chore || typeof chore !== 'object') return null
    if (!Number.isFinite(chore.expectedMinutes)) return null
    const key = normalizeEntity(chore.title ?? '')
    if (!key || entities.has(key)) return null
    entities.set(key, chore.expectedMinutes)
  }
  return entities
}

/** The corpus item's own expectation, in the same `entity -> minutes` shape. */
function expectedEntitiesOf(item) {
  const entities = new Map()
  for (const [entity, minutes] of Object.entries(item.expect.minutesByEntity)) {
    entities.set(normalizeEntity(entity), minutes)
  }
  return entities
}

/**
 * Score one answer against one corpus item.
 *
 * WITHIN TOLERANCE REQUIRES THE ENTITY SETS TO MATCH EXACTLY, and that is not
 * strictness for its own sake — it is the constraint AC 4's negative control
 * forces. An extractor that answers with nothing at all has no matched
 * entities, so a "worst error over what it did name" is zero over an empty set;
 * grade tolerance on matched entities alone and the do-nothing extractor scores
 * a perfect 100%. The control is what discriminates the two designs, which is
 * the whole reason a grader is built with one before it is trusted.
 *
 * The arithmetic axis is still reported in isolation, as
 * `minutesWithinToleranceOnMatched`, because "got the numbers right on the
 * people it found" and "found the right people" are different failures with
 * different repairs, and one combined figure hides which of them happened.
 */
export function gradeItem(item, answer) {
  const base = {
    text: item.text,
    kind: item.kind,
    ambiguous: Boolean(item.ambiguous),
    absoluteErrorMinutes: null,
    worstEntityErrorMinutes: null,
    unattributed: [],
    misattributed: [],
    toleranceMinutes: item.ambiguous ? null : item.expect.toleranceMinutes,
    minutesWithinToleranceOnMatched: null,
  }

  const refused = Boolean(answer) && typeof answer === 'object' && answer.kind === 'refusal'
  if (refused) return { ...base, outcome: OUTCOMES.REFUSED }

  const actual = entitiesOf(answer, item.kind)
  if (actual === null) return { ...base, outcome: OUTCOMES.MALFORMED }

  // AC 6. A confident number on a description the corpus marks ambiguous is
  // counted HERE and nowhere else: it never reaches the arithmetic below, so it
  // can neither inflate nor depress the error figures. The charter's kill
  // condition is trust, and a confident wrong answer damages trust differently
  // from a wide one — folding them into one number is the measurement asserting
  // they are the same thing.
  if (item.ambiguous) return { ...base, outcome: OUTCOMES.OVERCONFIDENT }

  const expected = expectedEntitiesOf(item)
  const unattributed = [...expected.keys()].filter((key) => !actual.has(key))
  const misattributed = [...actual.keys()].filter((key) => !expected.has(key))

  let total = 0
  let worst = 0
  for (const [key, minutes] of expected) {
    if (!actual.has(key)) continue
    const error = Math.abs(actual.get(key) - minutes)
    total += error
    if (error > worst) worst = error
  }

  const matchedWithin = worst <= item.expect.toleranceMinutes
  const exact = unattributed.length === 0 && misattributed.length === 0

  return {
    ...base,
    outcome: exact && matchedWithin ? OUTCOMES.WITHIN_TOLERANCE : OUTCOMES.OUTSIDE_TOLERANCE,
    absoluteErrorMinutes: total,
    worstEntityErrorMinutes: worst,
    unattributed,
    misattributed,
    minutesWithinToleranceOnMatched: matchedWithin,
  }
}

/** The zero row a summary starts from, so an empty kind reports zeros rather than NaN. */
function emptySummary() {
  return {
    total: 0,
    ambiguous: 0,
    answerable: 0,
    scored: 0,
    withinTolerance: 0,
    proportionWithinTolerance: 0,
    totalAbsoluteErrorMinutes: 0,
    worstAbsoluteErrorMinutes: 0,
    unattributed: 0,
    misattributed: 0,
    minutesWithinToleranceOnMatched: 0,
    refusals: { total: 0, onAmbiguous: 0, onAnswerable: 0 },
    overconfident: 0,
    malformed: 0,
  }
}

function accumulate(summary, result) {
  summary.total += 1
  if (result.ambiguous) summary.ambiguous += 1
  else summary.answerable += 1

  if (result.outcome === OUTCOMES.REFUSED) {
    summary.refusals.total += 1
    if (result.ambiguous) summary.refusals.onAmbiguous += 1
    else summary.refusals.onAnswerable += 1
    return
  }
  if (result.outcome === OUTCOMES.OVERCONFIDENT) {
    summary.overconfident += 1
    return
  }
  if (result.outcome === OUTCOMES.MALFORMED) {
    summary.malformed += 1
    return
  }

  summary.scored += 1
  summary.totalAbsoluteErrorMinutes += result.absoluteErrorMinutes
  if (result.worstEntityErrorMinutes > summary.worstAbsoluteErrorMinutes) {
    summary.worstAbsoluteErrorMinutes = result.worstEntityErrorMinutes
  }
  summary.unattributed += result.unattributed.length
  summary.misattributed += result.misattributed.length
  if (result.minutesWithinToleranceOnMatched) summary.minutesWithinToleranceOnMatched += 1
  if (result.outcome === OUTCOMES.WITHIN_TOLERANCE) summary.withinTolerance += 1
}

/**
 * Close the proportion, once every item of a kind has been accumulated.
 *
 * THE DENOMINATOR IS `answerable`, NEVER `scored`. Divide by what the extractor
 * chose to answer and an extractor that refuses everything it is unsure of
 * scores 100% — it would be rewarded for narrowing the question until it could
 * not get it wrong. Refusing an answerable description is a miss, and this is
 * the line that makes it one.
 */
function close(summary) {
  summary.proportionWithinTolerance =
    summary.answerable === 0 ? 0 : summary.withinTolerance / summary.answerable
  return summary
}

/**
 * Grade an extractor against a corpus.
 *
 * Makes NO network call and imports nothing that could — AC 3, asserted by a
 * source-reading test rather than left to inspection. Whatever the extractor
 * does is the extractor's business; the grader only awaits it.
 */
export async function gradeExtraction(extractor, corpus) {
  const items = []
  const byKind = {}
  for (const kind of INPUT_KINDS) byKind[kind] = emptySummary()
  const overall = emptySummary()

  for (const item of corpus) {
    let answer
    try {
      answer = await extractor({ kind: item.kind, text: item.text })
    } catch {
      // A throwing extractor is an unparseable answer arriving by another
      // route. Reporting that is the grader's job; becoming it is not.
      answer = null
    }
    const result = gradeItem(item, answer)
    items.push(result)
    accumulate(byKind[item.kind], result)
    accumulate(overall, result)
  }

  for (const kind of INPUT_KINDS) close(byKind[kind])
  close(overall)

  return { items, byKind, overall }
}

/**
 * AC 4's negative control — answers every description with nothing.
 *
 * "Zero minutes for everything", spelled the only way a control may be spelled:
 * it has not read the corpus and cannot. Every expected entity comes back
 * unattributed, so nothing is within tolerance and the score is a floor rather
 * than a number. An extractor scoring at or near this one has told you nothing
 * you did not already know before running it.
 */
export function zeroExtractor({ kind }) {
  return kind === 'capacity'
    ? { kind: 'capacity', minutesByPerson: {} }
    : { kind: 'chores', chores: [] }
}

/**
 * AC 5's positive control — answers every description with the corpus's own
 * expected values, and refuses the ones the corpus marks ambiguous.
 *
 * Circular by construction, and that is the point: it bounds the scale at the
 * far end, so a real score can be read as a position between two known points
 * rather than as a number with no units. It is built by CLOSING OVER the corpus
 * rather than by the grader passing expectations in, which is what keeps
 * `gradeExtraction` unable to leak an answer to anything else it is handed.
 *
 * Refusing the ambiguous items is not a convenience: an item marked ambiguous
 * has no expected answer to return, so a refusal IS its expected result, and an
 * oracle that invented a number for one would fail AC 6 against its own corpus.
 */
export function oracleExtractorFor(corpus) {
  const byText = new Map(corpus.map((item) => [item.text, item]))
  return ({ kind, text }) => {
    const item = byText.get(text)
    if (!item || item.kind !== kind) {
      return { kind: 'refusal', reason: 'not in the corpus this oracle was built from' }
    }
    if (item.ambiguous) return { kind: 'refusal', reason: item.ambiguous }
    const entries = Object.entries(item.expect.minutesByEntity)
    if (kind === 'capacity') {
      return { kind: 'capacity', minutesByPerson: Object.fromEntries(entries) }
    }
    return {
      kind: 'chores',
      chores: entries.map(([title, expectedMinutes]) => ({ title, expectedMinutes })),
    }
  }
}
