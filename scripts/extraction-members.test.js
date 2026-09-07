// #207 — the member-sentence runner.
//
// Nothing here has an expected value, so there is no grader and nothing to
// check the answers against. What CAN be checked is that the run is honest
// about its own shape: that it refuses a sentence file it cannot score, that a
// replay against the wrong sentences refuses rather than reporting fabricated
// refusals as a bad correction rate, and that a review sheet marked up by a
// person round-trips into the same figures `memberCorrections` computes.
//
// The sentences in these fixtures are invented for the test and cast with the
// corpus's own `Alex` / `Robin` / `Sam`, per `src/test/gate.test.js`'s #19
// vocabulary. Real member sentences never enter this repository through a test.

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  answerLines,
  main,
  ratesFromSheet,
  readInput,
  replay,
  reviewSheet,
  runConfig,
  withheldTallies,
} from './extraction-members.mjs'
import { buildRequest } from '../src/lib/extractionAdapter.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'taskr-207-'))

const write = (body) => {
  const path = join(tmp(), 'input.json')
  writeFileSync(path, JSON.stringify(body))
  return path
}

const SENTENCES = [
  { id: 'cap-1', kind: 'capacity', text: 'alex has about five hours this week' },
  { id: 'cho-1', kind: 'chores', text: 'hoover downstairs takes twenty minutes, needs doing by friday' },
]

/** A transport answering with one contract-shaped body, provider-response shaped. */
const answering = (byKind) => async (request) => ({
  status: 200,
  body: {
    model: request.model,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(byKind(request)) }],
    usage: { input_tokens: 100, output_tokens: 10 },
  },
})

const CONFIG = { label: 'test-config', model: 'claude-haiku-4-5', prompt: 'p' }

describe('the committed member record — #207 AC 8', () => {
  const docs = resolve(import.meta.dirname, '..', 'docs')
  const record = JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.json'), 'utf8'))

  /**
   * EVERY word the committed sentences contain, lower-cased.
   *
   * This is `extraction-corpus.md`'s technique, adapted twice over. That corpus
   * is written entirely in lower case except the cast, so a CAPITAL is a name
   * candidate by construction and scanning capitals is sufficient. Real member
   * sentences are not written that way, and a first pass here scanned capitals
   * only — which a review found insufficient on 2026-09-07: these sentences
   * already contain lower-case cast names ("by alex"), so a real given name
   * typed in lower case would have shipped unseen.
   *
   * So the vocabulary is every word, and there is nothing to allow that is not
   * listed. It is long and that is the price. What it buys is the only thing
   * that matters here: a real given name cannot enter this repository without
   * somebody adding it to this list, by hand, in a diff a human reads.
   */
  const ALLOWED_WORDS = new Set(
    (
      // The declared cast, and the only proper nouns permitted at all.
      "alex robin robin's robins " +
      // A weekday and a product name, spelled as the member spelled it.
      'thursday robot vaccum water ' +
      // Everything else the sentences say, typos included.
      "a abocut about actually already an and any anything are at away back both " +
      'box boxes but by can care cat change changes checkup chores clean cleaning ' +
      'curb day daycare days deep diary did different dishes do does doing done ' +
      'dusted dusting each eat either end energy eveneing event every everything ' +
      'evey fans fireplace for friday fridge from garage get got grass has have he ' +
      "home hour hours how i if in into is it last laundry litter little living " +
      'look maintains many maybe mess microwave might min mine more mow mowed much ' +
      'need needs new next normal of on once one or organized organizing other our ' +
      'outdoor place predictable pretty put putting rebuild refrigerator room round ' +
      "sailing schedule scoops should sideways smart so son steadier swept take " +
      "takes than that that'll the things think thinking this those through time to " +
      'trash two up us varies way we week weekdays weekend weeks went what which ' +
      'while will with work yes you yours'
    ).split(/\s+/),
  )

  it('contains no word that has not been declared — a lower-case name cannot ship', () => {
    const found = new Set()
    for (const sentence of record.sentences) {
      const text = `${sentence.text} ${sentence.askedWhat ?? ''}`
      for (const word of text.match(/[A-Za-z']+/g) ?? []) found.add(word.toLowerCase())
    }
    const undeclared = [...found].filter((word) => !ALLOWED_WORDS.has(word))
    expect(undeclared, `undeclared words: ${undeclared.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: the scan reaches the text and would see a name added to it', () => {
    // Without this the test above passes just as happily over an empty file.
    const words = record.sentences.flatMap((s) => s.text.match(/[A-Za-z']+/g) ?? [])
    expect(words.map((w) => w.toLowerCase())).toContain('alex')
    expect(words.length).toBeGreaterThan(200)
    // And the scan is case-blind, which is the half the first version lacked.
    expect(ALLOWED_WORDS.has('alex')).toBe(true)
    expect(ALLOWED_WORDS.has('cruz')).toBe(false)
  })

  it('records the withheld sentences by tally, so the verdict stays reproducible', () => {
    // The owner withheld two sentences describing their child. Their TEXT does
    // not ship; their arithmetic does, or the verdict's headline figure could
    // not be re-derived from anything in this repository.
    expect(record.withheld.count).toBe(2)
    expect(record.withheld.tallies).toMatchObject({ kind: 'chores', proposed: 0, supplied: 1, corrections: 1 })
    expect(record.withheld.reason).toMatch(/child/)
  })

  it('replays to the figures the verdict is taken on, from the command and not by hand', async () => {
    const input = readInput(resolve(docs, 'extraction-members-2026-09-07.json'))
    const results = await replay(
      JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.transcript.json'), 'utf8')),
      input.sentences,
    )
    const sheet = JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.review.json'), 'utf8'))
    // The withheld tallies go IN, exactly as every command does it. This test
    // used to add them afterwards while no production path did, which is how
    // the shipped document came to print a figure its own named command could
    // not produce.
    const rates = ratesFromSheet(sheet, results, { withheld: withheldTallies(record) })['claude-haiku-4-5']

    expect(rates.capacity).toMatchObject({ corrections: 1, figures: 3 })
    expect(rates.chores).toMatchObject({ corrections: 8, figures: 27 })
    expect(rates.all).toMatchObject({ corrections: 9, figures: 30 })
  })

  it('scores each capacity sentence once, not once per framing arm', async () => {
    const input = readInput(resolve(docs, 'extraction-members-2026-09-07.json'))
    const results = await replay(
      JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.transcript.json'), 'utf8')),
      input.sentences,
    )
    const sheet = JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.review.json'), 'utf8'))
    const rates = ratesFromSheet(sheet, results, { withheld: withheldTallies(record) })['claude-haiku-4-5']

    // Ten capacity sentences, run in two framings. Both arms are reviewed; only
    // one is scored. Counting both moved `all` from 9/30 to 10/33 — 30.00% to
    // 30.30% — and flipped the axis from meeting the owner's ceiling to failing
    // it, on an arm that produced identical outcomes.
    expect(sheet.entries.filter((e) => e.variantOf).length).toBe(10)
    expect(rates.capacity.sentences).toBe(10)
    expect(rates.variants.capacity.sentences).toBe(10)

    // The variant arm is kept and reported, never discarded: the comparison is
    // why it was run, and a silently dropped arm looks like one nobody ran.
    expect(rates.variants.capacity).toMatchObject({ corrections: 1, figures: 3 })
    expect(rates.variants.capacity.rate).toBeCloseTo(rates.capacity.rate, 10)
  })

  it('puts the run-level rate EXACTLY on the ceiling, from the real derivation', async () => {
    // A first version of this test asserted `9 / 30 === 0.3` and called no
    // product code at all — so it constant-folded, and the derivation it exists
    // to pin was unobserved. A review found it, and the mutation it named is the
    // complement form: `1 - (figures - corrections) / figures` returns a
    // DIFFERENT double for this record and flips the axis to FAIL with every
    // printed figure still reading "30.0%".
    const input = readInput(resolve(docs, 'extraction-members-2026-09-07.json'))
    const results = await replay(
      JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.transcript.json'), 'utf8')),
      input.sentences,
    )
    const sheet = JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.review.json'), 'utf8'))
    const rates = ratesFromSheet(sheet, results, { withheld: withheldTallies(record) })['claude-haiku-4-5']

    // The bit-exact identity the verdict rests on, taken off the module.
    expect(rates.all.rate).toBe(0.3)
    expect(rates.all.rate <= 0.3, 'the run-level axis must meet the ceiling').toBe(true)
    // ...and the superseded double-counted figure must still fail, so a
    // regression that reinstated it cannot pass as "still 30-ish".
    expect(10 / 33 <= 0.3).toBe(false)
  })

  it('the verdict document prints the figures the artefacts produce', async () => {
    // The coupling this file's comment used to claim and not have: nothing here
    // read the document, so editing 30.3% to 40.3% reddened nothing.
    const doc = readFileSync(resolve(docs, 'extraction-verdict.md'), 'utf8')
    const input = readInput(resolve(docs, 'extraction-members-2026-09-07.json'))
    const results = await replay(
      JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.transcript.json'), 'utf8')),
      input.sentences,
    )
    const sheet = JSON.parse(readFileSync(resolve(docs, 'extraction-members-2026-09-07.review.json'), 'utf8'))
    const rates = ratesFromSheet(sheet, results, { withheld: withheldTallies(record) })['claude-haiku-4-5']

    for (const scope of ['capacity', 'chores', 'all']) {
      const tally = rates[scope]
      const row = `| ${scope} | ${tally.corrections} | ${tally.figures} | **${(tally.rate * 100).toFixed(1)}%**`
      expect(doc, `docs/extraction-verdict.md has no row for ${scope} matching the artefacts`).toContain(row)
    }
  })

  it('POSITIVE CONTROL: the document row match is strict enough to notice a moved figure', () => {
    const doc = readFileSync(resolve(docs, 'extraction-verdict.md'), 'utf8')
    expect(doc).toContain('| all | 9 | 30 | **30.0%**')
    expect(doc).not.toContain('| all | 10 | 33 | **30.3%**')
  })

  it('carries both configurations, so the unreviewed one can be scored later without re-spending', () => {
    const transcript = JSON.parse(
      readFileSync(resolve(docs, 'extraction-members-2026-09-07.transcript.json'), 'utf8'),
    )
    expect(transcript.runs.map((r) => r.config.label).sort()).toEqual([
      'claude-haiku-4-5',
      'claude-opus-5 effort-low',
    ])
    for (const run of transcript.runs) expect(run.responses).toHaveLength(43)
  })
})

describe('readInput', () => {
  it('refuses a file with no sentences', () => {
    expect(() => readInput(write({ sentences: [] }))).toThrow(/no sentences/)
  })

  it('refuses a duplicate id, which would silently overwrite an answer', () => {
    const path = write({ sentences: [SENTENCES[0], { ...SENTENCES[0], text: 'different' }] })
    expect(() => readInput(path)).toThrow(/duplicate sentence id/)
  })

  it('refuses a kind the bet does not cover', () => {
    expect(() => readInput(write({ sentences: [{ id: 'a', kind: 'shopping', text: 'x' }] }))).toThrow(
      /expected one of/,
    )
  })

  it('refuses a sentence with no text, and one that is only whitespace', () => {
    expect(() => readInput(write({ sentences: [{ id: 'a', kind: 'capacity' }] }))).toThrow(/no text/)
    expect(() => readInput(write({ sentences: [{ id: 'a', kind: 'capacity', text: '   ' }] }))).toThrow(/no text/)
  })

  it('REPORTS the ten-per-kind floor rather than enforcing it', () => {
    // AC 1 asks for at least ten of each. A run of nine is still evidence, and
    // refusing to look at it would lose the measurement instead of qualifying
    // it — so the count comes back and the report says whether it met the bar.
    const input = readInput(write({ sentences: SENTENCES }))
    expect(input.counts).toEqual({ capacity: 1, chores: 1 })
  })
})

describe('runConfig', () => {
  it('answers every sentence, keyed by id, in file order', async () => {
    const seen = []
    const transport = async (request) => {
      seen.push(request.messages[0].content)
      return answering(() => ({ kind: 'refusal', reason: 'no' }))(request)
    }
    const { answers } = await runConfig(CONFIG, SENTENCES, transport)
    expect(Object.keys(answers)).toEqual(['cap-1', 'cho-1'])
    expect(seen[0]).toContain('alex has about five hours')
    expect(seen[1]).toContain('hoover downstairs')
  })

  it('hands the member sentence through as the description, unmodified', async () => {
    let request
    await runConfig(CONFIG, [SENTENCES[0]], async (r) => {
      request = r
      return answering(() => ({ kind: 'refusal', reason: 'no' }))(r)
    })
    expect(request.messages[0].content).toBe(buildRequest(CONFIG, SENTENCES[0]).messages[0].content)
  })
})

describe('replay', () => {
  const recorded = async () => {
    const responses = []
    const transport = async (request) => {
      const answer = await answering((r) =>
        r.messages[0].content.includes('chores')
          ? { kind: 'chores', chores: [{ title: 'hoover downstairs', expectedMinutes: 20, dueDate: 'friday' }] }
          : { kind: 'capacity', minutesByPerson: { Alex: 300 } },
      )(request)
      responses.push({ key: request.messages[0].content, status: answer.status, body: answer.body, ms: 5 })
      return answer
    }
    await runConfig(CONFIG, SENTENCES, transport)
    return { version: 1, kind: 'member-sentences', runs: [{ config: CONFIG, responses }] }
  }

  it('reproduces the recorded answers with no network', async () => {
    const [{ answers }] = await replay(await recorded(), SENTENCES)
    expect(answers['cap-1']).toEqual({ kind: 'capacity', minutesByPerson: { Alex: 300 } })
    expect(answers['cho-1'].chores[0].dueDate).toBe('friday')
  })

  it('REFUSES a transcript recorded against different sentences', async () => {
    // The adapter turns a dead transport into a refusal, so without this the
    // whole run would score as refusals — a 100% correction rate that is a fact
    // about the file paths and not about the extractor.
    const edited = [{ ...SENTENCES[0], text: 'a sentence that was never recorded' }, SENTENCES[1]]
    await expect(replay(await recorded(), edited)).rejects.toThrow(/not in the transcript/)
  })
})

describe('answerLines', () => {
  it('spells a capacity answer one person per line', () => {
    expect(answerLines({ kind: 'capacity', minutesByPerson: { Alex: 300, Robin: 60 } })).toEqual([
      '        Alex: 300 min',
      '        Robin: 60 min',
    ])
  })

  it('says outright when a chore came back with no date, so an omission is visible', () => {
    const lines = answerLines({
      kind: 'chores',
      chores: [
        { title: 'bins out', expectedMinutes: 5 },
        { title: 'hoover', expectedMinutes: 20, dueDate: 'friday' },
      ],
    })
    expect(lines[0]).toContain('no date')
    expect(lines[1]).toContain('due "friday"')
  })

  it('shows a refusal with its stated reason', () => {
    expect(answerLines({ kind: 'refusal', reason: 'names no quantity' })[0]).toContain('names no quantity')
  })

  it('does not pretend an unrecognised answer is an empty one', () => {
    expect(answerLines(null)[0]).toContain('no answer')
    expect(answerLines({ kind: 'weather' })[0]).toContain('unrecognised')
  })
})

describe('the review sheet', () => {
  const results = [
    {
      config: CONFIG,
      answers: {
        'cap-1': { kind: 'capacity', minutesByPerson: { Alex: 300 } },
        'cho-1': { kind: 'chores', chores: [{ title: 'hoover', expectedMinutes: 20, dueDate: 'friday' }] },
      },
    },
  ]
  const input = { sentences: SENTENCES }

  it('carries one entry per configuration per sentence, with the figure count derived', () => {
    const sheet = reviewSheet(input, results)
    expect(sheet.entries).toHaveLength(2)
    expect(sheet.entries[0]._figuresProposed).toBe(1)
    // minutes + date
    expect(sheet.entries[1]._figuresProposed).toBe(2)
  })

  it('shows the member their own sentence beside the answer, so the check is possible at all', () => {
    const sheet = reviewSheet(input, results)
    expect(sheet.entries[0]._text).toBe(SENTENCES[0].text)
    expect(sheet.entries[0]._answer.join(' ')).toContain('Alex: 300 min')
  })

  it('names the five classes in the sheet itself rather than in a document', () => {
    expect(reviewSheet(input, results)._classes).toEqual([
      'wrong number',
      'missed entity',
      'invented entity',
      'wrong date',
      'refusal',
    ])
  })

  /** A sheet a person has walked, which is the only kind that may be scored. */
  const reviewedSheet = (from) => {
    const sheet = reviewSheet(from ?? input, results)
    for (const entry of sheet.entries) entry.reviewed = true
    return sheet
  }

  it('scores a filled-in sheet into the same figures memberCorrections computes', () => {
    const sheet = reviewedSheet()
    sheet.entries[0].corrections = [{ class: 'wrong number', note: 'five hours is 300, it said 300 — fine' }]
    const rates = ratesFromSheet(sheet, results)
    expect(rates[CONFIG.label].capacity.rate).toBe(1)
    expect(rates[CONFIG.label].chores.rate).toBe(0)
    expect(rates[CONFIG.label].all.figures).toBe(3)
    expect(rates[CONFIG.label].all.rate).toBeCloseTo(1 / 3, 10)
  })

  it('emits every entry unreviewed, so a blank sheet cannot be scored at all', () => {
    const blank = reviewSheet(input, results)
    expect(blank.entries.every((entry) => entry.reviewed === false)).toBe(true)
    // A blank sheet used to score 0% — the BEST possible value on a kill axis,
    // produced by nobody having looked at anything.
    expect(() => ratesFromSheet(blank, results)).toThrow(/not marked reviewed/)
  })

  it('REFUSES a partially reviewed sheet, which would always read better than a complete one', () => {
    // The unreviewed entries contribute their proposed figures to the
    // denominator and no corrections to the numerator, so the bias is always
    // toward clearing the kill number.
    const partial = reviewedSheet()
    partial.entries[1].reviewed = false
    expect(() => ratesFromSheet(partial, results)).toThrow(/1 of 2 sheet entries are not marked reviewed/)
  })

  it('scores a review that found nothing to correct, rather than calling it unstarted', () => {
    // The CEILING case, and the best result this instrument can report. Keyed
    // on corrections instead of the marker, it was unreachable: the sheet was
    // regenerated and the report said "No corrections recorded yet" forever.
    const clean = reviewedSheet()
    const rates = ratesFromSheet(clean, results)
    expect(rates[CONFIG.label].all.rate).toBe(0)
    expect(rates[CONFIG.label].all.corrections).toBe(0)
  })

  it('narrows the sheet to one configuration when asked, without dropping it from the run', () => {
    const twoConfigs = [...results, { config: { ...CONFIG, label: 'other-config' }, answers: results[0].answers }]
    expect(reviewSheet(input, twoConfigs).entries).toHaveLength(4)
    const narrowed = reviewSheet(input, twoConfigs, 'other-config')
    expect(narrowed.entries).toHaveLength(2)
    expect([...new Set(narrowed.entries.map((e) => e.config))]).toEqual(['other-config'])
  })

  it('refuses a --sheet-config that matches nothing, rather than writing an empty sheet', () => {
    // An empty sheet scores as "nothing was corrected" — a 0% correction rate,
    // which is the BEST possible result on this axis, produced by a typo.
    expect(() => reviewSheet(input, results, 'claude-haiku-4.5')).toThrow(/matches no configuration/)
  })

  it('REFUSES an unreadable sheet rather than replacing it with a blank one', async () => {
    // A member hand-edits the sheet and leaves a trailing comma. A bare catch
    // treats that exactly like a missing file, and the next line overwrites
    // their finished review — reported as "review sheet written to …".
    const dir = tmp()
    const inputPath = join(dir, 'input.json')
    const sheetPath = join(dir, 'sheet.json')
    const transcriptPath = join(dir, 'transcript.json')
    writeFileSync(inputPath, JSON.stringify({ sentences: SENTENCES }))

    const responses = []
    const transport = async (request) => {
      const answer = await answering(() => ({ kind: 'refusal', reason: 'no' }))(request)
      responses.push({ key: request.messages[0].content, status: answer.status, body: answer.body, ms: 1 })
      return answer
    }
    await runConfig(CONFIG, SENTENCES, transport)
    writeFileSync(transcriptPath, JSON.stringify({ version: 1, runs: [{ config: CONFIG, responses }] }))

    const damaged = '{ "entries": [ { "id": "cap-1", }, ] }'
    writeFileSync(sheetPath, damaged)
    await expect(
      main(['--input', inputPath, '--transcript', transcriptPath, '--sheet', sheetPath]),
    ).rejects.toThrow(/REFUSING to read the review sheet/)

    // The whole point: the member's file is still there, byte for byte.
    expect(readFileSync(sheetPath, 'utf8')).toBe(damaged)
  })

  it('still writes a sheet when there is none, which is the case the catch exists for', async () => {
    const dir = tmp()
    const inputPath = join(dir, 'input.json')
    const sheetPath = join(dir, 'sheet.json')
    const transcriptPath = join(dir, 'transcript.json')
    writeFileSync(inputPath, JSON.stringify({ sentences: SENTENCES }))

    const responses = []
    const transport = async (request) => {
      const answer = await answering(() => ({ kind: 'refusal', reason: 'no' }))(request)
      responses.push({ key: request.messages[0].content, status: answer.status, body: answer.body, ms: 1 })
      return answer
    }
    await runConfig(CONFIG, SENTENCES, transport)
    writeFileSync(transcriptPath, JSON.stringify({ version: 1, runs: [{ config: CONFIG, responses }] }))

    await main(['--input', inputPath, '--transcript', transcriptPath, '--sheet', sheetPath])
    const written = JSON.parse(readFileSync(sheetPath, 'utf8'))
    expect(written.entries).toHaveLength(2)
    expect(written.entries.every((e) => e.reviewed === false)).toBe(true)
  })

  it('REFUSES to regenerate over a sheet somebody may have filled in', async () => {
    // The regression this replaces: a sheet carrying corrections but no
    // `reviewed` markers was silently regenerated blank. Reproduced at the time
    // as nine corrections destroyed, exit 0, and 86 entries where there had
    // been 43 — the else branch re-reads --sheet-config, so the operator's
    // narrowing went with the data.
    const dir = tmp()
    const inputPath = join(dir, 'input.json')
    const sheetPath = join(dir, 'sheet.json')
    const transcriptPath = join(dir, 'transcript.json')
    writeFileSync(inputPath, JSON.stringify({ sentences: SENTENCES }))

    const responses = []
    const transport = async (request) => {
      const answer = await answering(() => ({ kind: 'refusal', reason: 'no' }))(request)
      responses.push({ key: request.messages[0].content, status: answer.status, body: answer.body, ms: 1 })
      return answer
    }
    await runConfig(CONFIG, SENTENCES, transport)
    writeFileSync(transcriptPath, JSON.stringify({ version: 1, runs: [{ config: CONFIG, responses }] }))

    // A member's work: corrections recorded, markers not set.
    const theirWork = JSON.stringify({
      entries: [{ key: 'k', config: CONFIG.label, id: 'cap-1', kind: 'capacity', corrections: [{ class: 'refusal' }] }],
    })
    writeFileSync(sheetPath, theirWork)
    await expect(
      main(['--input', inputPath, '--transcript', transcriptPath, '--sheet', sheetPath]),
    ).rejects.toThrow(/REFUSING to regenerate/)
    expect(readFileSync(sheetPath, 'utf8'), 'their file must be untouched').toBe(theirWork)
  })

  it('refuses a sheet naming a configuration the run does not carry', () => {
    const sheet = reviewedSheet()
    sheet.entries[0].config = 'some-other-model'
    expect(() => ratesFromSheet(sheet, results)).toThrow(/which this run does not carry/)
  })
})
