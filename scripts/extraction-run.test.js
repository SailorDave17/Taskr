// The transcript runner — #203 AC 3, AC 4.
//
// The strongest assertion here is a ROUND TRIP: a transcript built from the
// corpus's own oracle, replayed through the real adapter and the real grader,
// must land on exactly the ceiling `npm run extraction:corpus` records — every
// figure, every axis. That is what "the same report, from the same grader,
// with no second implementation of the score" means as a test rather than as
// a sentence: any drift between the runner's pipe and the corpus report's
// shows up as two summaries disagreeing about one extractor.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gradeExtraction, oracleExtractorFor, zeroExtractor } from '../src/lib/extraction.js'
import { CORPUS } from '../src/lib/extraction.corpus.js'
import { userMessage } from '../src/lib/extractionAdapter.js'
import { scoreLines } from './extraction-report-format.mjs'
import {
  gradeConfig,
  liveTransport,
  main,
  percentile,
  promptFingerprint,
  recordLive,
  replayTransport,
  runFromTranscript,
  runReportLines,
  transcriptKeyOf,
} from './extraction-run.mjs'

const ORACLE_CONFIG = Object.freeze({ label: 'oracle-config', model: 'model-oracle', prompt: 'prompt one' })
const ZERO_CONFIG = Object.freeze({ label: 'zero-config', model: 'model-zero', prompt: 'prompt two' })

/** A provider envelope whose answer text is the given contract answer. */
function envelopeFor(answer) {
  return {
    id: 'msg_replay',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: JSON.stringify(answer) }],
    stop_reason: 'end_turn',
  }
}

/** A recorded run answering every corpus item with `extractorFn`'s answer. */
function runFor(config, extractorFn) {
  return {
    config,
    responses: CORPUS.map((item) => ({
      key: userMessage({ kind: item.kind, text: item.text }),
      status: 200,
      body: envelopeFor(extractorFn({ kind: item.kind, text: item.text })),
      ms: 7,
    })),
  }
}

describe('#203 AC 4 — a replayed transcript grades through the one grader', () => {
  it('an oracle transcript reproduces the recorded ceiling, figure for figure', async () => {
    const transcript = { version: 1, runs: [runFor(ORACLE_CONFIG, oracleExtractorFor(CORPUS))] }
    const [result] = await runFromTranscript(transcript)
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    expect(result.graded.overall).toEqual(ceiling.overall)
    expect(result.graded.byKind).toEqual(ceiling.byKind)
  })

  it('a do-nothing transcript reproduces the recorded floor', async () => {
    const transcript = { version: 1, runs: [runFor(ZERO_CONFIG, zeroExtractor)] }
    const [result] = await runFromTranscript(transcript)
    const floor = await gradeExtraction(zeroExtractor, CORPUS)
    expect(result.graded.overall).toEqual(floor.overall)
  })

  it('REFUSES the whole report when the transcript misses an item, rather than grading the hole', async () => {
    // A miss would otherwise be scored as a transport failure — a plausible
    // figure measuring nothing, which is the absent-result shape this repo
    // keeps finding. The refusal is the design, so it is the assertion.
    const run = runFor(ORACLE_CONFIG, oracleExtractorFor(CORPUS))
    run.responses = run.responses.slice(1)
    await expect(runFromTranscript({ version: 1, runs: [run] })).rejects.toThrow(/REFUSING to report/)
  })

  it('a recorded timeout replays as a timeout, into the adapter tally', async () => {
    const run = runFor(ORACLE_CONFIG, oracleExtractorFor(CORPUS))
    run.responses[0] = { key: run.responses[0].key, timeout: true, ms: 9 }
    const [result] = await runFromTranscript({ version: 1, runs: [run] })
    expect(result.tally.timeout).toBe(1)
  })

  it('replayTransport answers by the request user message and refuses a stranger', async () => {
    const run = runFor(ORACLE_CONFIG, oracleExtractorFor(CORPUS))
    const { transport, misses } = replayTransport(run)
    const request = {
      model: ORACLE_CONFIG.model,
      messages: [{ role: 'user', content: run.responses[0].key }],
    }
    expect(transcriptKeyOf(request)).toBe(run.responses[0].key)
    await expect(transport(request)).resolves.toEqual({ status: 200, body: run.responses[0].body })
    await expect(
      transport({ model: ORACLE_CONFIG.model, messages: [{ role: 'user', content: 'never recorded' }] }),
    ).rejects.toThrow(/not in the transcript/)
    expect(misses).toEqual(['never recorded'])
  })
})

describe('#203 AC 3 — the report names which configuration produced which figures', () => {
  async function twoConfigResults() {
    const transcript = {
      version: 1,
      runs: [runFor(ORACLE_CONFIG, oracleExtractorFor(CORPUS)), runFor(ZERO_CONFIG, zeroExtractor)],
    }
    return runFromTranscript(transcript)
  }

  it('each block is headed by its label, model and prompt fingerprint', async () => {
    const lines = runReportLines(await twoConfigResults())
    const text = lines.join('\n')
    expect(text).toContain(`CONFIGURATION oracle-config — model model-oracle, prompt ${promptFingerprint('prompt one')}`)
    expect(text).toContain(`CONFIGURATION zero-config — model model-zero, prompt ${promptFingerprint('prompt two')}`)
    // Two prompts, two fingerprints: the header can tell configurations apart
    // by every axis a configuration has.
    expect(promptFingerprint('prompt one')).not.toBe(promptFingerprint('prompt two'))
  })

  it('prints per-kind and per-axis rows through the corpus report’s own formatter', async () => {
    const results = await twoConfigResults()
    const lines = runReportLines(results)
    // The exact lines the corpus report prints for this summary — same
    // function, same spelling — must appear verbatim. This is "prints the
    // same report" as an equality, not a resemblance.
    for (const expected of scoreLines('all', results[0].graded.overall)) {
      expect(lines).toContain(expected)
    }
    for (const expected of scoreLines('chores', results[1].graded.byKind.chores)) {
      expect(lines).toContain(expected)
    }
  })

  it('reports recorded latency as percentiles beside the figures', async () => {
    const lines = runReportLines(await twoConfigResults()).join('\n')
    expect(lines).toContain('p50 7 ms')
    expect(lines).toContain(`over ${CORPUS.length} calls`)
  })

  it('percentile is nearest-rank and honest about an empty list', () => {
    expect(percentile([9, 1, 5], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([], 50)).toBeNull()
  })
})

describe('#203 — a live recording round-trips, and the key never enters the record', () => {
  function fakeProviderFetch(seenHeaders) {
    const oracle = oracleExtractorFor(CORPUS)
    return async (url, init) => {
      seenHeaders.push(init.headers)
      const request = JSON.parse(init.body)
      const match = request.messages[0].content.match(/^input kind: (\w+)\ndescription: ([\s\S]*)$/)
      const answer = oracle({ kind: match[1], text: match[2] })
      return { status: 200, text: async () => JSON.stringify(envelopeFor(answer)) }
    }
  }

  it('records a transcript whose replay reproduces the live figures exactly', async () => {
    const seenHeaders = []
    const { results, transcript } = await recordLive([ORACLE_CONFIG], {
      apiKey: 'fixture-key-value',
      fetchImpl: fakeProviderFetch(seenHeaders),
    })
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    expect(results[0].graded.overall).toEqual(ceiling.overall)

    const replayed = await runFromTranscript(transcript)
    expect(replayed[0].graded.overall).toEqual(results[0].graded.overall)
    expect(transcript.corpusSize).toBe(CORPUS.length)
    expect(transcript.runs[0].responses.every((entry) => Number.isFinite(entry.ms))).toBe(true)
  })

  it('sends the key in the one header and stores it nowhere', async () => {
    const seenHeaders = []
    const { transcript } = await recordLive([ORACLE_CONFIG], {
      apiKey: 'fixture-key-value',
      fetchImpl: fakeProviderFetch(seenHeaders),
    })
    // Positive control first: the search target demonstrably exists on the
    // wire, so the absence below is an absence the search could have found.
    expect(seenHeaders[0]['x-api-key']).toBe('fixture-key-value')
    expect(JSON.stringify(transcript)).not.toContain('fixture-key-value')
  })

  it('liveTransport hands a non-JSON body through for the adapter to refuse', async () => {
    const transport = liveTransport({
      apiKey: 'fixture-key-value',
      fetchImpl: async () => ({ status: 200, text: async () => '<html>a gateway page</html>' }),
    })
    await expect(transport({ messages: [{ role: 'user', content: 'x' }] })).resolves.toEqual({
      status: 200,
      body: '<html>a gateway page</html>',
    })
  })

  it('gradeConfig tallies every adapter outcome it sees', async () => {
    const { tally } = await gradeConfig(ORACLE_CONFIG, async () => ({ status: 503, body: {} }))
    expect(tally['http-error']).toBe(CORPUS.length)
  })
})

describe('#203 — the command refuses to guess', () => {
  it('refuses a live run with no key, naming the variable and the replay alternative', async () => {
    await expect(main(['--record', 'ignored.json'], {})).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })

  it('prints usage when asked for neither mode', async () => {
    await expect(main([], {})).rejects.toThrow(/Usage/)
  })
})

describe('#203 AC 4 — one formatter, one grader, pinned on source', () => {
  const runner = readFileSync(resolve(process.cwd(), 'scripts/extraction-run.mjs'), 'utf8')
  const report = readFileSync(resolve(process.cwd(), 'scripts/extraction-corpus-report.mjs'), 'utf8')

  it('both commands import the shared formatter', () => {
    expect(runner).toMatch(/from '\.\/extraction-report-format\.mjs'/)
    expect(report).toMatch(/from '\.\/extraction-report-format\.mjs'/)
  })

  it('neither spells a report row itself — the spelling lives in the formatter alone', () => {
    for (const source of [runner, report]) {
      expect(source).not.toContain('within tolerance ')
      expect(source).not.toContain('due dates exact')
    }
  })

  it('the runner grades with the grader the corpus report grades with', () => {
    expect(runner).toMatch(/from '\.\.\/src\/lib\/extraction\.js'/)
    expect(runner).toContain('gradeExtraction')
    expect(runner).not.toMatch(/proportionWithinTolerance\s*=/)
  })
})
