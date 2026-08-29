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
//     ({ kind: 'chores',   text }) => { kind: 'chores', chores: [{ title, expectedMinutes, dueDate? }] }
//     (anything)                   => { kind: 'refusal', reason: '...' }
//
// `dueDate` (#202) is the date AS THE DESCRIPTION STATES IT — 'Tuesday',
// 'tomorrow', 'the 12th of september', '2026-09-18' — or absent/null where the
// description states none. The extractor never resolves a phrase to a calendar
// date: date arithmetic is deterministic code's job (`normalizeDueDate`, in
// dueDates.js), and asking a model to do it would put the corpus's hardest
// failure mode — an invented fact — inside the field that exists to avoid one.
// The grader normalises the stated form against the item's reference date and
// compares the result to the corpus's hand-computed expectation.
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

import { normalizeDueDate } from './dueDates.js'

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
    // #202: a stated due date is a string or it is not there. Any other type is
    // a malformed answer, same as a non-finite minutes value — the shape is the
    // contract, and tolerating a Date object here would let one cross the
    // string boundary dueDates.js exists to hold.
    if (chore.dueDate !== undefined && chore.dueDate !== null && typeof chore.dueDate !== 'string') {
      return null
    }
    const key = normalizeEntity(chore.title ?? '')
    if (!key || entities.has(key)) return null
    entities.set(key, chore.expectedMinutes)
  }
  return entities
}

/**
 * The stated due dates of a chores answer, `entity -> string`, entities with
 * no stated date absent — #202. Runs AFTER `entitiesOf` has validated the
 * answer, so it assumes shape rather than re-refusing it. An empty or
 * whitespace stated date counts as no date claimed: a provider spelling
 * "no date" as `""` is answering honestly, not malformed.
 */
function statedDuesOf(answer) {
  const dues = new Map()
  for (const chore of answer.chores) {
    const stated = typeof chore.dueDate === 'string' ? chore.dueDate.trim() : ''
    if (stated) dues.set(normalizeEntity(chore.title ?? ''), stated)
  }
  return dues
}

/** Whether the due-date axis applies to an item: an answerable chore
 * description whose corpus entry carries a `due` expectation. */
function dueApplies(item) {
  return item.kind === 'chores' && !item.ambiguous && Boolean(item.expect?.due)
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
 *
 * THE DUE-DATE AXIS (#202) IS ITS OWN FIGURE, NEVER FOLDED IN. The owner's
 * accuracy threshold is named against the 0-of-50 to 50-of-50 within-tolerance
 * scale, and a new axis that moved it would silently reprice a decided bet.
 * `dueExact` is `null` where the axis does not apply (capacity, ambiguous, or
 * an item with no `due` expectation), `true` only when EVERY expected entity
 * was found carrying exactly the right date — the right calendar date where
 * one is stated, no date where none is. A refusal or a malformed answer on an
 * applicable item is a date miss for the same reason it is a tolerance miss:
 * the denominator is what was answerable, not what was answered.
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
    dueExact: dueApplies(item) ? false : null,
    dueInvented: [],
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

  // #202 — the due-date axis, walked over the EXPECTED entities so that an
  // answer with no entities at all scores a miss on every one of them. Walk
  // the matched entities instead and the do-nothing extractor's empty answer
  // has nothing to be wrong about — the same vacuous-aggregate fault the
  // within-tolerance rule closed for minutes, closed the same way for dates.
  let dueExact = base.dueExact
  const dueInvented = []
  if (dueApplies(item)) {
    const dues = statedDuesOf(answer)
    dueExact = true
    for (const [entity, expectedDue] of Object.entries(item.expect.due)) {
      const key = normalizeEntity(entity)
      if (!actual.has(key)) {
        dueExact = false
        continue
      }
      const stated = dues.get(key) ?? null
      if (expectedDue === null) {
        // The description states no date, so the only right answer is none —
        // extraction never invents one (#202, decided at the filing gate). An
        // invented date is tallied by name because it is the trust-destroying
        // direction: it lands in the app looking like a fact.
        if (stated !== null) {
          dueInvented.push(key)
          dueExact = false
        }
      } else if (stated === null) {
        dueExact = false
      } else {
        // A stated form the normaliser refuses is a miss on this axis and ONLY
        // this axis — the minutes may still be within tolerance, and folding a
        // bad date into the minutes verdict would hide which failure happened.
        let normalised = null
        try {
          normalised = normalizeDueDate(stated, item.dueReference)
        } catch {
          normalised = null
        }
        if (normalised !== expectedDue) dueExact = false
      }
    }
  }

  return {
    ...base,
    outcome: exact && matchedWithin ? OUTCOMES.WITHIN_TOLERANCE : OUTCOMES.OUTSIDE_TOLERANCE,
    absoluteErrorMinutes: total,
    worstEntityErrorMinutes: worst,
    unattributed,
    misattributed,
    minutesWithinToleranceOnMatched: matchedWithin,
    dueExact,
    dueInvented,
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
    dueApplicable: 0,
    dueExact: 0,
    dueInvented: 0,
    refusals: { total: 0, onAmbiguous: 0, onAnswerable: 0 },
    overconfident: 0,
    malformed: 0,
  }
}

function accumulate(summary, result) {
  summary.total += 1
  if (result.ambiguous) summary.ambiguous += 1
  else summary.answerable += 1

  // #202 — tallied BEFORE the outcome branches return, because a refusal or a
  // malformed answer on an applicable item is still a date miss: the axis
  // divides by what was answerable, and an early return that skipped these
  // would quietly shrink the denominator to what the extractor chose to
  // answer — the exact vacuity the within-tolerance denominator rule names.
  if (result.dueExact !== null) {
    summary.dueApplicable += 1
    if (result.dueExact) summary.dueExact += 1
  }
  summary.dueInvented += result.dueInvented.length

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
      chores: entries.map(([title, expectedMinutes]) => {
        // #202: the oracle answers a dated entity with the expected calendar
        // date itself — ISO is one of the stated forms the normaliser accepts,
        // and it passes through unchanged. An undated entity gets no dueDate
        // at all, which is the no-date answer the corpus expects for it.
        const due = item.expect.due?.[title]
        return due ? { title, expectedMinutes, dueDate: due } : { title, expectedMinutes }
      }),
    }
  }
}
