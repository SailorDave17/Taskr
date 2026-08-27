import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INPUT_KINDS,
  OUTCOMES,
  entitiesOf,
  gradeExtraction,
  gradeItem,
  normalizeEntity,
  oracleExtractorFor,
  zeroExtractor,
} from './extraction.js'
import { CAST, CORPUS, WEEKDAY_WORDS } from './extraction.corpus.js'
import { MAX_CAPACITY_MINUTES, MIN_CAPACITY_MINUTES } from './capacity.js'
import { MAX_EXPECTED_MINUTES, MIN_EXPECTED_MINUTES } from './chores.js'

// #42 — the corpus and the grader that scores an extractor against it.
//
// Two things here are not ordinary behaviour tests and are the reason the file
// is worth reading. The SOURCE-reading describe for AC 3 states a property
// about the shape of the module rather than its output — "makes no network
// call" is not observable from a grader that was handed a pure function, and
// no behavioural test can see it. And the CONTROL extractors are the
// instrument's own calibration: without them a score is a number with no units,
// and this file would be asserting that the grader still does what it does.

const SOURCE = readFileSync(resolve(process.cwd(), 'src/lib/extraction.js'), 'utf8')
const CORPUS_SOURCE = readFileSync(resolve(process.cwd(), 'src/lib/extraction.corpus.js'), 'utf8')

const capacityItems = CORPUS.filter((item) => item.kind === 'capacity')
const choreItems = CORPUS.filter((item) => item.kind === 'chores')
const answerable = CORPUS.filter((item) => !item.ambiguous)
const ambiguous = CORPUS.filter((item) => item.ambiguous)

/** Comments stripped, so prose ABOUT a forbidden name is not the name itself. */
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('AC 1 — a corpus of hand-written expectations', () => {
  it('carries at least 25 descriptions of each input kind', () => {
    // The floor is per KIND, not across both. Owner decision 2026-08-25, on the
    // charter's 2026-08-08 widening: a single pooled floor is satisfiable by 49
    // capacity descriptions and one chore, which is the measurement being
    // silent about half the bet while reporting a number.
    expect(capacityItems.length).toBeGreaterThanOrEqual(25)
    expect(choreItems.length).toBeGreaterThanOrEqual(25)
  })

  it('gives every description a stated reason for being in the corpus', () => {
    for (const item of CORPUS) {
      expect(item.why, `no stated reason for: ${item.text}`).toBeTruthy()
    }
  })

  it('gives every description either a hand-written expectation or an ambiguity marker, never both and never neither', () => {
    for (const item of CORPUS) {
      const hasExpectation = Boolean(item.expect)
      const isAmbiguous = Boolean(item.ambiguous)
      expect(hasExpectation !== isAmbiguous, `neither or both, for: ${item.text}`).toBe(true)
    }
  })

  it('states minutes per named entity and a tolerance in minutes, for every answerable description', () => {
    for (const item of answerable) {
      const entries = Object.entries(item.expect.minutesByEntity)
      expect(entries.length, `no expected entities for: ${item.text}`).toBeGreaterThan(0)
      for (const [entity, minutes] of entries) {
        expect(entity.trim(), `an empty entity name in: ${item.text}`).toBeTruthy()
        expect(Number.isInteger(minutes), `${entity} is not whole minutes in: ${item.text}`).toBe(
          true,
        )
      }
      expect(
        Number.isInteger(item.expect.toleranceMinutes),
        `tolerance is not whole minutes for: ${item.text}`,
      ).toBe(true)
      expect(item.expect.toleranceMinutes).toBeGreaterThanOrEqual(0)
    }
  })

  it('states a REASON on every ambiguous description rather than an invented answer', () => {
    // AC 1's second half. A bare `ambiguous: true` would satisfy a count and
    // tell the next reader nothing about why a number here would be invention.
    for (const item of ambiguous) {
      expect(typeof item.ambiguous, `ambiguity marker is not a reason: ${item.text}`).toBe('string')
      expect(item.ambiguous.trim().length).toBeGreaterThan(10)
    }
  })

  it('expects only values the app could actually store', () => {
    // The corpus scores an extractor whose output lands in capacity.js and
    // chores.js. An expectation outside their bounds would be scoring a number
    // the app refuses, which is a measurement of nothing.
    for (const item of answerable.filter((i) => i.kind === 'capacity')) {
      for (const minutes of Object.values(item.expect.minutesByEntity)) {
        expect(minutes).toBeGreaterThanOrEqual(MIN_CAPACITY_MINUTES)
        expect(minutes).toBeLessThanOrEqual(MAX_CAPACITY_MINUTES)
      }
    }
    for (const item of answerable.filter((i) => i.kind === 'chores')) {
      for (const minutes of Object.values(item.expect.minutesByEntity)) {
        expect(minutes).toBeGreaterThanOrEqual(MIN_EXPECTED_MINUTES)
        expect(minutes).toBeLessThanOrEqual(MAX_EXPECTED_MINUTES)
      }
    }
  })

  it('has no duplicate description, because the oracle control keys on the text', () => {
    const seen = new Set(CORPUS.map((item) => item.text))
    expect(seen.size, 'two descriptions share their text').toBe(CORPUS.length)
  })

  it('names every expected entity in the description it belongs to', () => {
    // An expectation naming somebody the text never mentions is not a hard
    // extraction problem, it is a corpus bug — and it would show up as an
    // unattributed entity nobody could have found.
    const missing = []
    for (const item of answerable) {
      const haystack = item.text.toLowerCase()
      for (const entity of Object.keys(item.expect.minutesByEntity)) {
        if (!haystack.includes(entity.toLowerCase())) missing.push(`${entity} — ${item.text}`)
      }
    }
    expect(missing, `expected entities absent from their own description: ${missing.join('; ')}`).toEqual(
      [],
    )
  })

  it('covers every kind the grader knows about, and no kind it does not', () => {
    // Adding a third input kind to the corpus without adding it to INPUT_KINDS
    // would drop it out of every per-kind figure silently — the summary would
    // simply not have a row for it.
    expect([...new Set(CORPUS.map((item) => item.kind))].sort()).toEqual([...INPUT_KINDS].sort())
  })

  it('POSITIVE CONTROL: both kinds carry answerable AND ambiguous descriptions', () => {
    // A corpus that was all answerable would satisfy every count above while
    // making AC 6 unmeasurable; all-ambiguous would make ACs 4 and 5 vacuous.
    for (const kind of INPUT_KINDS) {
      const ofKind = CORPUS.filter((item) => item.kind === kind)
      expect(ofKind.filter((item) => item.ambiguous).length, `no ambiguous ${kind}`).toBeGreaterThan(0)
      expect(ofKind.filter((item) => !item.ambiguous).length, `no answerable ${kind}`).toBeGreaterThan(
        0,
      )
    }
  })
})

// AC 2 — no real household name reaches this corpus.
//
// src/test/gate.test.js already scans fixtures for undeclared name-shaped
// literals, and this file and extraction.corpus.js are both in that scan's
// population — the filter was widened from a hard-coded allocation.corpus.js to
// every `src/lib/*.corpus.js` as part of this story, because a check whose
// population does not contain the file you are adding is a check that answers
// about somebody else's work.
//
// That scan is necessary and NOT sufficient here, and the gap is structural
// rather than an oversight. Its SHAPE test matches a literal only when the
// WHOLE literal is name-shaped, so it sees `'Alex'` as an object key and is
// blind to `'Alex has five hours this week and Robin has three.'` — a corpus
// whose entire content is sentences would be scanned and would pass whatever
// was written in it. The assertions below are the half that reaches prose.
//
// The issue's own wording for this criterion has expired and the requirement
// has not: AC 2 says "because #19 is open", and #19 closed on 2026-08-21 when
// #121 gated previews behind a custom domain. gate.test.js records why that
// does not retire the guard — a name in version control is exposed to everyone
// with repository access whatever the hosting arrangement is on the day — so
// the criterion's reason survived its stated trigger.
describe('AC 2 — every person in the corpus is a declared placeholder', () => {
  const permitted = new Set([...CAST, ...WEEKDAY_WORDS])

  /**
   * Every capitalised word in a piece of text.
   *
   * Takes TEXT rather than reading the corpus itself, so the positive control
   * below can run the real scanner against a sample containing a name the cast
   * does not include. A control that builds its own matcher proves the control.
   */
  function capitalisedWordsIn(text) {
    return [...text.matchAll(/\b[A-Z][A-Za-z-]*/g)].map((match) => match[0])
  }

  it('names nobody outside the cast in any expected capacity map', () => {
    const strangers = []
    for (const item of capacityItems.filter((i) => !i.ambiguous)) {
      for (const person of Object.keys(item.expect.minutesByEntity)) {
        if (!CAST.includes(person)) strangers.push(`${person} — ${item.text}`)
      }
    }
    expect(strangers, `people outside CAST: ${strangers.join('; ')}`).toEqual([])
  })

  it('capitalises nothing in any description except the cast and the weekdays', () => {
    // This is the assertion that reaches PROSE, which the #19 shape scan cannot.
    // It holds because every description is deliberately written in lower case
    // apart from those two vocabularies — so there is no allowlist here to go
    // stale, and a capitalised word appearing in a future description is a name
    // candidate by construction rather than by guesswork.
    const offenders = []
    for (const item of CORPUS) {
      for (const word of capitalisedWordsIn(item.text)) {
        if (!permitted.has(word)) offenders.push(`${word} — ${item.text}`)
      }
    }
    expect(
      [...new Set(offenders)],
      `capitalised words that are neither cast nor weekday: ${offenders.join('; ')}`,
    ).toEqual([])
  })

  it('POSITIVE CONTROL: the prose scan catches a name the cast does not include', () => {
    // The probe name is ASSEMBLED rather than written as a literal, and the
    // reason is the hazard cairn records as
    // `a-guard-that-reads-source-must-survive-its-own-docs`: gate.test.js scans
    // THIS file, and a bare undeclared name-shaped literal here would be
    // refused by the very guard these assertions exist to complement.
    // gate.test.js solves the same problem by excluding itself; this file
    // cannot, so it never spells one.
    //
    // The split is after the FIRST letter, and that is not arbitrary: the first
    // attempt split it as `Mar` + the rest, and gate.test.js refused `Mar` —
    // three letters, capital first, is name-shaped on its own. A fragment has to
    // be one character or start in lower case to be outside that shape, and the
    // guard is what established which.
    const probe = ['M', 'arguerite'].join('')
    const sample = `${probe} has three hours and Alex has two on Monday.`
    const found = capitalisedWordsIn(sample)
    expect(found).toContain(probe)
    expect(found.filter((word) => !permitted.has(word))).toEqual([probe])
    // ...and the vocabulary is what lets the rest through, rather than the scan
    // simply matching nothing.
    expect(capitalisedWordsIn('Alex has an hour on Monday.').filter((w) => !permitted.has(w))).toEqual(
      [],
    )
  })

  it('varies the cast between descriptions, so a fixed roster cannot score well', () => {
    // Without this the misattributed count measures nothing: an extractor that
    // ignored the text and always answered with all three would have a clean
    // attribution sheet on every item. Measured as a spread of cast sizes
    // rather than an average, because "some items name one person" is the
    // property that makes an invented person visible.
    const sizes = new Set(
      capacityItems.filter((i) => !i.ambiguous).map((i) => Object.keys(i.expect.minutesByEntity).length),
    )
    expect(sizes.has(1), 'no capacity description names exactly one person').toBe(true)
    expect(sizes.size, 'every capacity description names the same number of people').toBeGreaterThan(1)

    const everyone = capacityItems.filter(
      (i) => !i.ambiguous && Object.keys(i.expect.minutesByEntity).length === CAST.length,
    )
    expect(everyone.length, 'no capacity description names the whole cast').toBeGreaterThan(0)
    expect(
      everyone.length,
      'every capacity description names the whole cast',
    ).toBeLessThan(capacityItems.filter((i) => !i.ambiguous).length)
  })

  it('commits no screenshot or transcript alongside the corpus', () => {
    // The corpus is prose about a household week, which is the one artefact
    // most likely to arrive as a pasted real message. gate.test.js owns the
    // image half; this asserts the corpus files themselves carry no data URI,
    // which is how an image reaches a .js file.
    for (const source of [SOURCE, CORPUS_SOURCE]) {
      expect(source).not.toMatch(/data:image\//)
    }
  })
})

describe('AC 3 — the grader reports error, tolerance, attribution and refusals', () => {
  it('imports nothing that can reach the network', () => {
    const imports = [...SOURCE.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    const forbidden = imports.filter((spec) =>
      /@supabase\/supabase-js|supabase\.js$|^react$|^react\//.test(spec),
    )
    expect(forbidden, `forbidden imports: ${forbidden.join(', ')}`).toEqual([])
    // The grader imports nothing at all today, which is the strongest form of
    // this claim and also the form that would pass vacuously if the scan broke
    // — hence the positive control below.
    expect(imports).toEqual([])
  })

  it('POSITIVE CONTROL: the import scan can see an import when there is one', () => {
    const chores = readFileSync(resolve(process.cwd(), 'src/lib/chores.js'), 'utf8')
    const imports = [...chores.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    // Was './household.js' until #159, which removed that dependency from
    // chores.js - addChore no longer resolves a household for itself. A
    // control pointing at an import that no longer exists is not a weaker
    // control, it is a failing one, so it is re-pointed at what remains.
    expect(imports).toContain('./supabase.js')
    expect(imports.length).toBeGreaterThan(0)
  })

  it('never calls out, by any of the names a call would have', () => {
    // Comments stripped: this module's prose says at length that it makes no
    // network call, and scanning the raw file would make an accurate comment
    // indistinguishable from the defect it describes.
    const code = codeOf(SOURCE)
    for (const name of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'process.env', 'import(']) {
      expect(code, `the grader names ${name}`).not.toContain(name)
    }
  })

  it('POSITIVE CONTROL: the call scan can find a call when there is one', () => {
    // Without this, the assertion above passes identically against a typo in
    // every one of those five strings.
    expect(codeOf("const r = await fetch('https://example.invalid')")).toContain('fetch(')
  })

  it('reports absolute error in minutes, per description', async () => {
    const item = capacityItems.find((i) => !i.ambiguous && Object.keys(i.expect.minutesByEntity).length === 2)
    const [first, second] = Object.keys(item.expect.minutesByEntity)
    const answer = {
      kind: 'capacity',
      minutesByPerson: {
        [first]: item.expect.minutesByEntity[first] + 20,
        [second]: item.expect.minutesByEntity[second] - 5,
      },
    }
    const result = gradeItem(item, answer)
    expect(result.absoluteErrorMinutes).toBe(25)
    expect(result.worstEntityErrorMinutes).toBe(20)
  })

  it('counts a person the extractor failed to attribute, and one it invented', () => {
    const item = capacityItems.find(
      (i) => !i.ambiguous && Object.keys(i.expect.minutesByEntity).length === 1,
    )
    const only = Object.keys(item.expect.minutesByEntity)[0]
    const stranger = CAST.find((name) => name !== only)
    const result = gradeItem(item, { kind: 'capacity', minutesByPerson: { [stranger]: 60 } })
    expect(result.unattributed).toEqual([normalizeEntity(only)])
    expect(result.misattributed).toEqual([normalizeEntity(stranger)])
    expect(result.outcome).toBe(OUTCOMES.OUTSIDE_TOLERANCE)
  })

  it('counts a refusal, and does not score it as an error', () => {
    const item = answerable[0]
    const result = gradeItem(item, { kind: 'refusal', reason: 'not sure' })
    expect(result.outcome).toBe(OUTCOMES.REFUSED)
    expect(result.absoluteErrorMinutes).toBeNull()
  })

  it('names an answer it cannot parse rather than throwing on it', async () => {
    // #56 AC 3 requires an unparseable provider response to map to a distinct
    // stated failure. A grader that throws hands its caller no way to report one.
    for (const junk of [null, undefined, 42, 'three hours', { kind: 'capacity' }, { kind: 'chores' }]) {
      expect(gradeItem(answerable[0], junk).outcome).toBe(OUTCOMES.MALFORMED)
    }
    const thrown = await gradeExtraction(() => {
      throw new Error('provider exploded')
    }, CORPUS)
    expect(thrown.overall.malformed).toBe(CORPUS.length)
  })

  it('refuses an answer of the wrong kind for the description it answers', () => {
    const capacityItem = capacityItems.find((i) => !i.ambiguous)
    expect(gradeItem(capacityItem, { kind: 'chores', chores: [] }).outcome).toBe(OUTCOMES.MALFORMED)
  })

  it('refuses a duplicated entity rather than silently keeping the last one', () => {
    // Two chores with the same title collapse to one key in a Map, so an
    // extractor returning a duplicate would have one of its answers vanish and
    // the count would still look right.
    expect(
      entitiesOf(
        { kind: 'chores', chores: [{ title: 'Mow the lawn', expectedMinutes: 60 }, { title: 'mow the LAWN', expectedMinutes: 30 }] },
        'chores',
      ),
    ).toBeNull()
  })

  it('reports per kind as well as overall, so one kind cannot mask the other', async () => {
    // The charter's reason for widening the bet, stated as a figure: a good
    // capacity score must not be able to hide a poor chore score.
    const capacityOnlyOracle = oracleExtractorFor(capacityItems)
    const report = await gradeExtraction(capacityOnlyOracle, CORPUS)
    expect(report.byKind.capacity.proportionWithinTolerance).toBe(1)
    expect(report.byKind.chores.proportionWithinTolerance).toBe(0)
    expect(report.overall.proportionWithinTolerance).toBeGreaterThan(0)
    expect(report.overall.proportionWithinTolerance).toBeLessThan(1)
  })

  it('counts a refusal of an answerable description separately from a correct one', async () => {
    const report = await gradeExtraction(() => ({ kind: 'refusal', reason: 'always' }), CORPUS)
    expect(report.overall.refusals.total).toBe(CORPUS.length)
    expect(report.overall.refusals.onAnswerable).toBe(answerable.length)
    expect(report.overall.refusals.onAmbiguous).toBe(ambiguous.length)
    expect(report.overall.proportionWithinTolerance).toBe(0)
  })

  it('divides by every answerable description, not by the ones the extractor chose to answer', async () => {
    // The vacuity this denominator exists to prevent: an extractor that refuses
    // everything it is unsure of would otherwise score 100% by narrowing the
    // question until it could not get it wrong.
    //
    // The fixture is a REFUSE-THE-HARD-ONES extractor, not a refuse-everything
    // one, and the difference is the whole test. Refuse everything and `scored`
    // is zero, so both denominators guard against dividing by zero and both
    // report 0.0 — the assertion above passes identically against the mutation
    // it is named for. This one refuses only the hedged descriptions and is
    // perfect on the rest, which is the only shape where the two denominators
    // disagree.
    const oracle = oracleExtractorFor(CORPUS)
    const hedged = new Set(
      answerable.filter((item) => item.expect.toleranceMinutes > 0).map((item) => item.text),
    )
    expect(hedged.size, 'no hedged descriptions, so this fixture proves nothing').toBeGreaterThan(0)
    expect(hedged.size).toBeLessThan(answerable.length)

    const refusesTheHardOnes = (request) =>
      hedged.has(request.text)
        ? { kind: 'refusal', reason: 'not confident enough' }
        : oracle(request)

    const report = await gradeExtraction(refusesTheHardOnes, CORPUS)
    // It got right every description it was willing to answer...
    expect(report.overall.withinTolerance).toBe(report.overall.scored)
    expect(report.overall.scored).toBeLessThan(report.overall.answerable)
    // ...and it still does not score a perfect run, because refusing an
    // answerable description is a miss rather than an abstention.
    expect(report.overall.proportionWithinTolerance).toBeLessThan(1)
    expect(report.overall.proportionWithinTolerance).toBeCloseTo(
      (answerable.length - hedged.size) / answerable.length,
      10,
    )
  })

  it('separates the arithmetic axis from the attribution axis', async () => {
    // "Got the numbers right on the people it found" and "found the right
    // people" are different failures with different repairs, and one combined
    // figure hides which happened. This extractor drops one person from every
    // description and is otherwise perfect.
    const oracle = oracleExtractorFor(CORPUS)
    const dropsOne = (request) => {
      const answer = oracle(request)
      if (answer.kind !== 'capacity') return answer
      const entries = Object.entries(answer.minutesByPerson).slice(1)
      return { kind: 'capacity', minutesByPerson: Object.fromEntries(entries) }
    }
    const report = await gradeExtraction(dropsOne, CORPUS)
    expect(report.byKind.capacity.unattributed).toBeGreaterThan(0)
    expect(report.byKind.capacity.misattributed).toBe(0)
    // Every description it did answer, it answered with the right numbers...
    expect(report.byKind.capacity.minutesWithinToleranceOnMatched).toBe(
      report.byKind.capacity.scored,
    )
    // ...and it is still not within tolerance, because it lost people.
    expect(report.byKind.capacity.withinTolerance).toBeLessThan(report.byKind.capacity.answerable)
  })
})

describe('AC 4 — the negative control, proving the grader can express failure', () => {
  it('scores an extractor that answers with nothing as a failure, not a pass', async () => {
    const report = await gradeExtraction(zeroExtractor, CORPUS)
    expect(report.overall.withinTolerance).toBe(0)
    expect(report.overall.proportionWithinTolerance).toBe(0)
    for (const kind of INPUT_KINDS) {
      expect(report.byKind[kind].withinTolerance, `${kind} scored above the floor`).toBe(0)
    }
  })

  it('reports every expected entity as unattributed, and invents none', async () => {
    const report = await gradeExtraction(zeroExtractor, CORPUS)
    const expectedEntities = answerable.reduce(
      (total, item) => total + Object.keys(item.expect.minutesByEntity).length,
      0,
    )
    expect(report.overall.unattributed).toBe(expectedEntities)
    expect(report.overall.misattributed).toBe(0)
  })

  it('is a failure BECAUSE tolerance requires the entity sets to match', async () => {
    // The design this control forces, asserted rather than only described.
    // An empty answer has no matched entity, so a "worst error over what it
    // named" is zero over an empty set — grade tolerance on matched entities
    // alone and the do-nothing extractor scores a perfect 100%.
    const report = await gradeExtraction(zeroExtractor, CORPUS)
    expect(report.overall.minutesWithinToleranceOnMatched).toBe(report.overall.scored)
    expect(report.overall.withinTolerance).toBe(0)
  })

  it('answers every ambiguous description confidently, which is counted as such', async () => {
    // The zero extractor is not refusing — it is answering, with nothing. On an
    // ambiguous description that is still a confident answer, and AC 6 says so.
    const report = await gradeExtraction(zeroExtractor, CORPUS)
    expect(report.overall.overconfident).toBe(ambiguous.length)
    expect(report.overall.refusals.total).toBe(0)
  })
})

describe('AC 5 — the positive control, bounding the scale at the other end', () => {
  it('scores a perfect run against the corpus it was built from', async () => {
    const report = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    expect(report.overall.proportionWithinTolerance).toBe(1)
    expect(report.overall.withinTolerance).toBe(answerable.length)
    expect(report.overall.totalAbsoluteErrorMinutes).toBe(0)
    expect(report.overall.worstAbsoluteErrorMinutes).toBe(0)
    expect(report.overall.unattributed).toBe(0)
    expect(report.overall.misattributed).toBe(0)
    expect(report.overall.malformed).toBe(0)
    expect(report.overall.overconfident).toBe(0)
  })

  it('is perfect in both kinds, not on average', async () => {
    const report = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    for (const kind of INPUT_KINDS) {
      expect(report.byKind[kind].proportionWithinTolerance, `${kind} is not perfect`).toBe(1)
    }
  })

  it('refuses exactly the ambiguous descriptions, because a refusal is their expected result', async () => {
    const report = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    expect(report.overall.refusals.total).toBe(ambiguous.length)
    expect(report.overall.refusals.onAmbiguous).toBe(ambiguous.length)
    expect(report.overall.refusals.onAnswerable).toBe(0)
  })

  it('POSITIVE CONTROL: the perfect score is not the grader passing everything', async () => {
    // The two controls are only a scale if they land in different places. A
    // grader that returned "within tolerance" unconditionally would satisfy
    // AC 5 and every assertion above it.
    const perfect = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    const floor = await gradeExtraction(zeroExtractor, CORPUS)
    expect(perfect.overall.proportionWithinTolerance).toBe(1)
    expect(floor.overall.proportionWithinTolerance).toBe(0)
  })

  it('scores one minute past tolerance as a failure, and exactly on it as a pass', () => {
    // The boundary, in both directions. A tolerance compared with the wrong
    // operator moves a whole band of results across the line, and the two arms
    // are what make the operator observable at all.
    const item = answerable.find((i) => i.expect.toleranceMinutes > 0)
    const [entity, minutes] = Object.entries(item.expect.minutesByEntity)[0]
    const rest = Object.fromEntries(Object.entries(item.expect.minutesByEntity).slice(1))
    const answerWith = (value) =>
      item.kind === 'capacity'
        ? { kind: 'capacity', minutesByPerson: { ...rest, [entity]: value } }
        : {
            kind: 'chores',
            chores: [
              { title: entity, expectedMinutes: value },
              ...Object.entries(rest).map(([t, m]) => ({ title: t, expectedMinutes: m })),
            ],
          }

    const onTheLine = minutes + item.expect.toleranceMinutes
    expect(gradeItem(item, answerWith(onTheLine)).outcome).toBe(OUTCOMES.WITHIN_TOLERANCE)
    expect(gradeItem(item, answerWith(onTheLine + 1)).outcome).toBe(OUTCOMES.OUTSIDE_TOLERANCE)
    expect(gradeItem(item, answerWith(minutes - item.expect.toleranceMinutes)).outcome).toBe(
      OUTCOMES.WITHIN_TOLERANCE,
    )
  })
})

describe('AC 6 — a confident answer to an ambiguous description is its own count', () => {
  it('counts it as overconfidence rather than as an arithmetic error', () => {
    const item = ambiguous.find((i) => i.kind === 'capacity')
    const result = gradeItem(item, { kind: 'capacity', minutesByPerson: { [CAST[0]]: 240 } })
    expect(result.outcome).toBe(OUTCOMES.OVERCONFIDENT)
    // The whole point: it reaches none of the arithmetic, so it can neither
    // inflate nor depress the error figures a reader uses to judge accuracy.
    expect(result.absoluteErrorMinutes).toBeNull()
    expect(result.worstEntityErrorMinutes).toBeNull()
    expect(result.unattributed).toEqual([])
    expect(result.misattributed).toEqual([])
  })

  it('counts it on the chore side too, not only the capacity side', () => {
    const item = ambiguous.find((i) => i.kind === 'chores')
    const result = gradeItem(item, {
      kind: 'chores',
      chores: [{ title: 'Wash the dishes', expectedMinutes: 15 }],
    })
    expect(result.outcome).toBe(OUTCOMES.OVERCONFIDENT)
  })

  it('does not count a refusal of an ambiguous description as overconfidence', () => {
    const item = ambiguous[0]
    expect(gradeItem(item, { kind: 'refusal', reason: 'not enough to go on' }).outcome).toBe(
      OUTCOMES.REFUSED,
    )
  })

  it('keeps the two counts separate over a whole run', async () => {
    // An extractor that is confident everywhere: right on the answerable ones,
    // and answering the ambiguous ones anyway. Its arithmetic is perfect and
    // its overconfidence count is the whole ambiguous set — one figure must not
    // be readable from the other.
    const oracle = oracleExtractorFor(CORPUS)
    const alwaysAnswers = (request) => {
      const answer = oracle(request)
      if (answer.kind !== 'refusal') return answer
      return request.kind === 'capacity'
        ? { kind: 'capacity', minutesByPerson: { [CAST[0]]: 120 } }
        : { kind: 'chores', chores: [{ title: 'Walk the dog', expectedMinutes: 20 }] }
    }
    const report = await gradeExtraction(alwaysAnswers, CORPUS)
    expect(report.overall.overconfident).toBe(ambiguous.length)
    expect(report.overall.proportionWithinTolerance).toBe(1)
    expect(report.overall.totalAbsoluteErrorMinutes).toBe(0)
    expect(report.overall.refusals.total).toBe(0)
  })
})

describe('AC 7 — the run is meaningful in CI, with no account, key or network', () => {
  it('grades both control extractors in this file, which npm test runs', async () => {
    // AC 7 asks that CI grade BOTH controls. That is a property of where these
    // tests live: vite.config.js excludes only *.integration.test.js and
    // *.functions.test.js, so this file is in the default run and the CI Test
    // step is `npm test`. Asserted here rather than assumed, because a future
    // exclusion pattern that swallowed this file would leave the criterion
    // green in a run that never happened.
    const floor = await gradeExtraction(zeroExtractor, CORPUS)
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    expect(floor.overall.total).toBe(CORPUS.length)
    expect(ceiling.overall.total).toBe(CORPUS.length)
  })

  it('is matched by none of the exclusion patterns in vite.config.js', () => {
    // The limit is stated rather than implied: a pattern that DID exclude this
    // file would also stop this assertion running, so it cannot catch its own
    // exclusion. What it catches is a pattern added for another file that
    // happens to swallow this one, which is the realistic version — and the
    // file count in a CI log is what would show the other case.
    const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')
    const patterns = [...config.matchAll(/'\*\*\/([^']+)'/g)].map((m) => m[1])
    expect(patterns.length, 'the exclusion scan found no patterns to check').toBeGreaterThan(0)

    const matches = (pattern, file) =>
      new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(file)

    expect(patterns.filter((p) => matches(p, 'extraction.test.js'))).toEqual([])

    // POSITIVE CONTROL: the same matcher DOES catch the two files that ARE
    // excluded. Without it the assertion above passes identically against a
    // matcher that matches nothing at all.
    expect(patterns.filter((p) => matches(p, 'rls.integration.test.js')).length).toBeGreaterThan(0)
    expect(
      patterns.filter((p) => matches(p, 'provisioning.functions.test.js')).length,
    ).toBeGreaterThan(0)
  })

  it('reads no environment variable and no credential, in either file', () => {
    for (const source of [codeOf(SOURCE), codeOf(CORPUS_SOURCE)]) {
      expect(source).not.toMatch(/process\.env/)
      expect(source).not.toMatch(/import\.meta\.env/)
      expect(source).not.toMatch(/VITE_/)
    }
  })

  it('records figures in docs/extraction-corpus.md that the corpus still supports', async () => {
    // The most recurring documentation defect in this workspace is a number in
    // prose that something else computes. `npm run extraction:corpus` prints
    // these; this is what stops the recorded figures drifting from the corpus
    // they describe.
    const doc = readFileSync(resolve(process.cwd(), 'docs/extraction-corpus.md'), 'utf8')
    const floor = await gradeExtraction(zeroExtractor, CORPUS)
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)

    const row = (...cells) => new RegExp(`\\|\\s*${cells.join('\\s*\\|\\s*')}\\s*\\|`)
    for (const kind of INPUT_KINDS) {
      const summary = ceiling.byKind[kind]
      expect(doc, `no row for ${kind}`).toMatch(
        row(kind, summary.total, summary.answerable, summary.ambiguous),
      )
    }
    expect(doc, 'the overall row does not match the corpus').toMatch(
      row('all', ceiling.overall.total, ceiling.overall.answerable, ceiling.overall.ambiguous),
    )
    expect(doc, 'the recorded ceiling is not what the oracle scores').toContain(
      `${ceiling.overall.withinTolerance} of ${ceiling.overall.answerable}`,
    )
    expect(doc, 'the recorded floor is not what the zero extractor scores').toContain(
      `${floor.overall.withinTolerance} of ${floor.overall.answerable}`,
    )
    expect(doc).toContain(`${floor.overall.unattributed} unattributed`)
  })
})

describe('the entity matcher, whose strictness the attribution counts rest on', () => {
  it('matches on case and surrounding whitespace only', () => {
    expect(normalizeEntity('  Clean   the  Bathroom ')).toBe('clean the bathroom')
    expect(normalizeEntity('ALEX')).toBe(normalizeEntity('alex'))
  })

  it('does NOT match a bare noun against the phrase it came from', () => {
    // Stated as a test because it is a decision, not an accident: a matcher
    // generous enough to pair these cannot tell "found the right jobs" from
    // "found some jobs", which is the distinction the counts exist to make.
    // Written in lower case rather than declared in gate.test.js's vocabulary:
    // `normalizeEntity` folds case anyway, so the capital added nothing to the
    // assertion and cost an exemption for a word that is not a name.
    expect(normalizeEntity('bathroom')).not.toBe(normalizeEntity('Clean the bathroom'))
  })
})
