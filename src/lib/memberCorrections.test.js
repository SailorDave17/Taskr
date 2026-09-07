// #207 — the correction rate, and the two controls that make it a scale.
//
// THE FLOOR IS THE POINT OF THIS FILE.
//
// `docs/extraction-corpus.md` records why the minutes grader is built the way
// it is: "an extractor that answers with nothing has no matched entity, so a
// worst error over what it named is zero over an empty set — grade tolerance on
// matched entities alone and the do-nothing extractor scores a perfect 100%.
// The negative control is what discriminates the two designs."
//
// The correction rate has the identical fault available to it, and it is easier
// to walk into here because the natural English of the criterion — "the number
// of figures the member had to correct" — points straight at the wrong
// denominator. An extractor that refuses every sentence proposes no figure, so
// no figure it proposed was corrected, so it scores 0% on a kill number whose
// good direction is LOW. It would clear the 30% threshold by doing nothing, on
// the axis that exists to measure trust.
//
// So the floor control below is not a completeness test. It is the assertion
// that discriminates this module's design from the one a reader would write,
// and `theNaiveDenominatorWouldPassTheFloor` states the rejected design in band
// so the difference is visible rather than implied.

import { describe, expect, it } from 'vitest'

import {
  ALL_CLASSES,
  CORRECTION_CLASSES,
  correctionRates,
  proposedFigures,
  scoreSentence,
} from './memberCorrections.js'

/** A capacity sentence naming three people, and a flawless answer to it. */
const threePeople = {
  id: 'cap-1',
  kind: 'capacity',
  answer: { kind: 'capacity', minutesByPerson: { Alex: 300, Robin: 180, Sam: 60 } },
}

/** A chore sentence answered with two jobs, one of them carrying a date. */
const twoChores = {
  id: 'cho-1',
  kind: 'chores',
  answer: {
    kind: 'chores',
    chores: [
      { title: 'hoover downstairs', expectedMinutes: 20, dueDate: 'friday' },
      { title: 'bins out', expectedMinutes: 5 },
    ],
  },
}

describe('proposedFigures', () => {
  it('counts one figure per person on a capacity answer', () => {
    expect(proposedFigures(threePeople.answer)).toBe(3)
  })

  it('counts a chore as its minutes plus its date, and only where a date came back', () => {
    // 2 for the dated job (minutes + date), 1 for the undated one.
    expect(proposedFigures(twoChores.answer)).toBe(3)
  })

  it('does not count a date the extractor correctly omitted', () => {
    const undated = { kind: 'chores', chores: [{ title: 'bins out', expectedMinutes: 5 }] }
    const dated = { kind: 'chores', chores: [{ title: 'bins out', expectedMinutes: 5, dueDate: 'friday' }] }
    expect(proposedFigures(undated)).toBe(1)
    expect(proposedFigures(dated)).toBe(2)
  })

  it('treats an explicit null date as no figure, the way an omitted one is', () => {
    // The corpus records the no-date outcome as an explicit null per job, so a
    // transcript can carry either spelling for the same fact.
    expect(proposedFigures({ kind: 'chores', chores: [{ title: 'x', expectedMinutes: 5, dueDate: null }] })).toBe(1)
  })

  it('proposes nothing for a refusal, and nothing for an answer of no shape at all', () => {
    expect(proposedFigures({ kind: 'refusal', reason: 'no quantity named' })).toBe(0)
    expect(proposedFigures(null)).toBe(0)
    expect(proposedFigures('not an object')).toBe(0)
  })
})

describe('the scale', () => {
  it('CEILING — an extractor that gets everything right corrects nothing, 0 of 6', () => {
    const rates = correctionRates([
      { ...threePeople, corrections: [] },
      { ...twoChores, corrections: [] },
    ])
    expect(rates.all.figures).toBe(6)
    expect(rates.all.corrections).toBe(0)
    expect(rates.all.rate).toBe(0)
  })

  it('FLOOR — an extractor that refuses everything scores 100%, not 0%', () => {
    // Both sentences refused. The member typed all six figures by hand, so
    // every figure they dealt with was one the extraction did not give them.
    const rates = correctionRates([
      {
        id: 'cap-1',
        kind: 'capacity',
        answer: { kind: 'refusal', reason: 'no quantity named' },
        corrections: [
          { class: CORRECTION_CLASSES.REFUSAL, note: 'typed Alex 300 myself' },
          { class: CORRECTION_CLASSES.REFUSAL, note: 'typed Robin 180 myself' },
          { class: CORRECTION_CLASSES.REFUSAL, note: 'typed Sam 60 myself' },
        ],
      },
      {
        id: 'cho-1',
        kind: 'chores',
        answer: { kind: 'refusal', reason: 'no quantity named' },
        corrections: [
          { class: CORRECTION_CLASSES.REFUSAL, note: 'typed hoover 20 myself' },
          { class: CORRECTION_CLASSES.REFUSAL, note: 'typed its friday date myself' },
          { class: CORRECTION_CLASSES.REFUSAL, note: 'typed bins 5 myself' },
        ],
      },
    ])
    expect(rates.all.proposed).toBe(0)
    expect(rates.all.figures).toBe(6)
    expect(rates.all.rate).toBe(1)
  })

  it('the rejected denominator would score that floor at 0% and clear the 30% kill number', () => {
    // The design this module does NOT use, stated as executable arithmetic so
    // the difference between the two is a number rather than a paragraph.
    const refusedEverything = { proposed: 0, corrections: 6 }
    const theNaiveDenominatorWouldPassTheFloor =
      refusedEverything.proposed === 0 ? 0 : refusedEverything.corrections / refusedEverything.proposed

    expect(theNaiveDenominatorWouldPassTheFloor).toBe(0)
    expect(theNaiveDenominatorWouldPassTheFloor).toBeLessThan(0.3)
  })
})

describe('correctionRates', () => {
  it('weighs a refusal by the figures it cost, not once per sentence', () => {
    // Otherwise the rate depends on how the member happened to split their week
    // across messages: three people in one sentence, or three sentences.
    const oneBigSentence = correctionRates([
      {
        id: 'a',
        kind: 'capacity',
        answer: { kind: 'refusal', reason: 'x' },
        corrections: [
          { class: CORRECTION_CLASSES.REFUSAL },
          { class: CORRECTION_CLASSES.REFUSAL },
          { class: CORRECTION_CLASSES.REFUSAL },
        ],
      },
    ])
    const threeSmallOnes = correctionRates(
      ['a', 'b', 'c'].map((id) => ({
        id,
        kind: 'capacity',
        answer: { kind: 'refusal', reason: 'x' },
        corrections: [{ class: CORRECTION_CLASSES.REFUSAL }],
      })),
    )
    expect(oneBigSentence.all.rate).toBe(threeSmallOnes.all.rate)
    expect(oneBigSentence.all.figures).toBe(threeSmallOnes.all.figures)
  })

  it('counts an invented entity against the extractor without the member supplying anything', () => {
    const rates = correctionRates([
      {
        id: 'cap-1',
        kind: 'capacity',
        // The invented entity is spelled in lower case with hyphens on purpose:
        // it needs to be a person the household does NOT contain, so it cannot
        // be one of the declared cast, and anything name-shaped would need a
        // #19 vocabulary entry for a string that exists to be nobody.
        answer: {
          kind: 'capacity',
          minutesByPerson: { Alex: 300, Robin: 180, Sam: 60, 'nobody-by-that-name': 90 },
        },
        corrections: [{ class: CORRECTION_CLASSES.INVENTED_ENTITY, note: 'nobody in the household is called that' }],
      },
    ])
    expect(rates.all.proposed).toBe(4)
    expect(rates.all.supplied).toBe(0)
    expect(rates.all.rate).toBe(0.25)
  })

  it('reports per kind as well as overall, because the verdict is taken per kind', () => {
    const rates = correctionRates([
      { ...threePeople, corrections: [{ class: CORRECTION_CLASSES.WRONG_NUMBER }] },
      { ...twoChores, corrections: [] },
    ])
    expect(rates.capacity.rate).toBeCloseTo(1 / 3, 10)
    expect(rates.chores.rate).toBe(0)
    expect(rates.all.rate).toBeCloseTo(1 / 6, 10)
  })

  it('breaks the corrections down by class, because the five damage trust differently', () => {
    const rates = correctionRates([
      {
        ...twoChores,
        corrections: [
          { class: CORRECTION_CLASSES.WRONG_DATE },
          { class: CORRECTION_CLASSES.WRONG_NUMBER },
          { class: CORRECTION_CLASSES.MISSED_ENTITY },
        ],
      },
    ])
    expect(rates.chores.byClass[CORRECTION_CLASSES.WRONG_DATE]).toBe(1)
    expect(rates.chores.byClass[CORRECTION_CLASSES.WRONG_NUMBER]).toBe(1)
    expect(rates.chores.byClass[CORRECTION_CLASSES.MISSED_ENTITY]).toBe(1)
    expect(rates.chores.byClass[CORRECTION_CLASSES.INVENTED_ENTITY]).toBe(0)
    // The missed entity is the only one of the three that adds a figure.
    expect(rates.chores.figures).toBe(4)
  })

  it('folds withheld tallies in, so text that cannot ship still counts', () => {
    const rates = correctionRates([{ ...twoChores, corrections: [] }], {
      withheld: { kind: 'chores', count: 1, proposed: 0, supplied: 1, corrections: 1, byClass: { refusal: 1 } },
    })
    expect(rates.chores).toMatchObject({ proposed: 3, supplied: 1, corrections: 1, figures: 4 })
    expect(rates.chores.byClass[CORRECTION_CLASSES.REFUSAL]).toBe(1)
  })

  describe('the withheld block is validated, because nothing else can check it', () => {
    // It is the one input to the rate with no artefact behind it — hand-typed
    // numbers standing in for sentences whose text is not in the repository.
    const withheldOf = (over) => () =>
      correctionRates([], {
        withheld: { kind: 'chores', count: 1, proposed: 0, supplied: 1, corrections: 1, byClass: { refusal: 1 }, ...over },
      })

    it('refuses more corrections than figures anybody dealt with', () => {
      expect(withheldOf({ proposed: 0, supplied: 1, corrections: 5, byClass: { refusal: 5 } })).toThrow(
        /a correction has to be on a figure somebody dealt with/,
      )
    })

    it('refuses a class breakdown that does not sum to the correction count', () => {
      expect(withheldOf({ byClass: { refusal: 2 } })).toThrow(/byClass sums to 2 but corrections is 1/)
    })

    it('refuses figures attributed to no sentences', () => {
      expect(withheldOf({ count: 0 })).toThrow(/figures but no sentences/)
    })

    it('refuses a negative or fractional tally', () => {
      expect(withheldOf({ supplied: -1 })).toThrow(/non-negative integer/)
      expect(withheldOf({ supplied: 1.5 })).toThrow(/non-negative integer/)
    })

    it('refuses a kind the bet does not cover', () => {
      expect(withheldOf({ kind: 'shopping' })).toThrow(/unknown kind/)
    })

    it('accepts the shape the committed record actually carries', () => {
      expect(withheldOf({})).not.toThrow()
    })
  })

  it('reports no rate at all for an empty run, rather than the best possible one', () => {
    const rates = correctionRates([])
    expect(rates.all.rate).toBeNull()
    expect(rates.capacity.rate).toBeNull()
    expect(rates.chores.rate).toBeNull()
  })

  it('refuses a correction class it does not know', () => {
    expect(() =>
      correctionRates([{ ...threePeople, corrections: [{ class: 'a bit off' }] }]),
    ).toThrow(/unknown correction class/)
  })

  it('refuses markup that describes more wrong figures than the answer proposed', () => {
    // The signature of a review sheet marked up against a different run. It
    // would otherwise compute a rate, and the rate would be about nothing.
    expect(() =>
      correctionRates([
        {
          id: 'cho-1',
          kind: 'chores',
          answer: { kind: 'chores', chores: [{ title: 'bins out', expectedMinutes: 5 }] },
          corrections: [{ class: CORRECTION_CLASSES.WRONG_NUMBER }, { class: CORRECTION_CLASSES.WRONG_DATE }],
        },
      ]),
    ).toThrow(/the markup and the transcript disagree/)
  })

  it('refuses an input kind that is not one of the two the bet covers', () => {
    expect(() =>
      correctionRates([{ id: 'x', kind: 'shopping', answer: { kind: 'refusal' }, corrections: [] }]),
    ).toThrow(/unknown input kind/)
  })

  it('carries exactly the five classes the criterion names', () => {
    expect([...ALL_CLASSES].sort()).toEqual(
      ['invented entity', 'missed entity', 'refusal', 'wrong date', 'wrong number'].sort(),
    )
  })

  it('scores one sentence on its own the same way the totals do', () => {
    const scored = scoreSentence({ ...threePeople, corrections: [{ class: CORRECTION_CLASSES.WRONG_NUMBER }] })
    expect(scored).toEqual({ id: 'cap-1', kind: 'capacity', proposed: 3, supplied: 0, corrections: 1 })
  })
})
