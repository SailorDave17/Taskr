// #207 — the verdict assembler, tested against the committed artefacts it
// assembles rather than against fixtures shaped like them.
//
// The whole authority of `docs/extraction-verdict.md` is that it quotes no
// figure a reader cannot reproduce, so the tests that matter here run the real
// transcript and the real TSV and check the outputs against numbers recorded
// on #205 and #206 BEFORE this code existed. A fixture would test the
// arithmetic; only the real artefact tests the reading of it — and the reading
// is where this file's one real defect was (see the model-echo block below).

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { DEPLOYED_LATENCY_BUDGET_MS } from '../src/lib/extractionThresholds.js'
import {
  PRICES_USD_PER_MTOK,
  USAGE_MODEL,
  costFromRun,
  verdictLines,
  headlineTransportMs,
  latencyMatrix,
  phoneLatency,
  priceFor,
  servedAsRequested,
} from './extraction-verdict.mjs'
import { runFromTranscript } from './extraction-run.mjs'

const repo = resolve(import.meta.dirname, '..')
const transcript = JSON.parse(
  readFileSync(resolve(repo, 'docs/extraction-run-2026-08-31.transcript.json'), 'utf8'),
)
const runFor = (label) => transcript.runs.find((run) => run.config.label === label)

describe('cost, against the figures #206 reconciled with the provider console', () => {
  // These four numbers are #206's, recorded in docs/extraction-run.md on
  // 2026-08-31, derived BY HAND from the same transcript and reconciled against
  // the console's $0.30 for the day. Reproducing them from code written a week
  // later is the positive control: two independent derivations of a figure that
  // was checked against a real bill.
  it('reproduces the per-extraction cost for claude-opus-5 effort low', () => {
    const cost = costFromRun(runFor('claude-opus-5 effort-low'))
    expect(cost.perExtraction.capacity).toBeCloseTo(0.004271, 6)
    expect(cost.perExtraction.chores).toBeCloseTo(0.004456, 6)
  })

  it('reproduces the per-extraction cost for claude-haiku-4-5', () => {
    const cost = costFromRun(runFor('claude-haiku-4-5'))
    expect(cost.perExtraction.capacity).toBeCloseTo(0.000593, 6)
    expect(cost.perExtraction.chores).toBeCloseTo(0.000659, 6)
  })

  it('reproduces both per-household-per-year projections', () => {
    expect(costFromRun(runFor('claude-opus-5 effort-low')).perYear).toBeCloseTo(0.2265, 4)
    expect(costFromRun(runFor('claude-haiku-4-5')).perYear).toBeCloseTo(0.0315, 4)
  })

  it('reconciles the whole run against the $0.2994 #206 recorded for 120 calls', () => {
    const total = transcript.runs.reduce((sum, run) => sum + costFromRun(run).total, 0)
    expect(total).toBeCloseTo(0.2994, 4)
    expect(transcript.runs.reduce((n, run) => n + costFromRun(run).calls, 0)).toBe(120)
  })

  it('projects against the stated usage model rather than an implicit one', () => {
    const cost = costFromRun(runFor('claude-haiku-4-5'))
    expect(cost.perYear).toBeCloseTo(
      cost.perExtraction.capacity * USAGE_MODEL.capacityExtractionsPerYear +
        cost.perExtraction.chores * USAGE_MODEL.choresExtractionsPerYear,
      10,
    )
  })
})

describe('the model echo — the defect this file was written after finding', () => {
  // MEASURED on the committed transcript: the provider answers a request naming
  // `claude-haiku-4-5` with `claude-haiku-4-5-20251001`, and one naming
  // `claude-opus-5` with `claude-opus-5`. A dated id for one and a bare alias
  // for the other, in the same run.
  it('the response body really does echo a dated id for one config and not the other', () => {
    const echoed = (label) => new Set(runFor(label).responses.map((r) => r.body?.model).filter(Boolean))
    expect([...echoed('claude-haiku-4-5')]).toEqual(['claude-haiku-4-5-20251001'])
    expect([...echoed('claude-opus-5 effort-low')]).toEqual(['claude-opus-5'])
  })

  it('that echoed id has no price, which is why pricing must key on what was REQUESTED', () => {
    // The rejected design, stated as the failure it produced: keyed on the
    // echo, Haiku's entire cost vanished and the axis printed "not measured" —
    // the absence of evidence reported as the absence of a bill.
    expect(PRICES_USD_PER_MTOK['claude-haiku-4-5-20251001']).toBeUndefined()
    expect(() => priceFor('claude-haiku-4-5-20251001')).toThrow(/no price recorded/)
    expect(priceFor('claude-haiku-4-5')).toEqual({ input: 1.0, output: 5.0 })
  })

  it('refuses an unpriced model loudly instead of returning nothing', () => {
    expect(() => priceFor('claude-something-new')).toThrow(/no price recorded/)
  })

  it('accepts a dated id as the requested model, and rejects a different one', () => {
    expect(servedAsRequested('claude-haiku-4-5', 'claude-haiku-4-5-20251001')).toBe(true)
    expect(servedAsRequested('claude-opus-5', 'claude-opus-5')).toBe(true)
    expect(servedAsRequested('claude-opus-5', 'claude-haiku-4-5')).toBe(false)
    expect(servedAsRequested('claude-opus-5', undefined)).toBe(false)
  })

  it('refuses a run whose responses came back from a different model', () => {
    const run = structuredClone(runFor('claude-opus-5 effort-low'))
    run.responses[3].body.model = 'claude-haiku-4-5'
    expect(() => costFromRun(run)).toThrow(/came back from/)
  })
})

describe('the phone transport, against #205\'s committed table', () => {
  const phone = phoneLatency(resolve(repo, 'docs/phone-latency-2026-09-07.tsv'))

  it('reproduces the warm fresh-socket rows exactly', () => {
    expect(phone.wifi.warm).toEqual({ n: 64, p50: 479, p95: 967 })
    expect(phone.cellular.warm).toEqual({ n: 64, p50: 430, p95: 586 })
  })

  it('reports the cold rows as maxima over three samples and quotes no p95', () => {
    // At n=3 the nearest-rank p95 IS the maximum. #205 states this and reports
    // maxima; a "p95" here would be the worst thing that happened wearing a
    // distribution's name.
    expect(phone.wifi.cold).toEqual({ n: 3, max: 1397 })
    expect(phone.cellular.cold).toEqual({ n: 3, max: 797 })
    expect(phone.wifi.cold.p95).toBeUndefined()
  })

  it('takes the headline at the WORSE network, which #205 measured to be wifi', () => {
    // Not assumed: cellular beat wifi on every percentile in that run, so a
    // reading that assumed cellular was the pessimistic case would take the
    // kill number at the friendlier condition.
    expect(headlineTransportMs(phone)).toBe(967)
    expect(headlineTransportMs(phone)).toBe(phone.wifi.warm.p95)
    expect(headlineTransportMs(phone)).toBeGreaterThan(phone.cellular.warm.p95)
  })
})

describe('an empty sample is not a measurement of zero', () => {
  const tsvWithout = (network) => {
    const raw = readFileSync(resolve(repo, 'docs/phone-latency-2026-09-07.tsv'), 'utf8')
    const lines = raw.split(/\r?\n/)
    const header = lines.findIndex((l) => l.startsWith('pass\t'))
    return lines
      .filter((l, i) => i <= header || l.startsWith('#') || !l.split('\t')[2]?.startsWith(network))
      .join('\n')
  }

  it('refuses a TSV with no rows for a network it should carry', () => {
    // `percentile([])` is null, `Math.round(null)` is 0, and `isFigure(0)` is
    // true by design because a real zero IS a measurement — so an empty sample
    // reported a 0 ms transport leg and the latency axis cleared the kill number
    // on the provider call alone, which is the substitution the axis exists to
    // prevent. Caught at the source rather than at the axis.
    const path = join(mkdtempSync(join(tmpdir(), 'taskr-207-tsv-')), 'phone.tsv')
    writeFileSync(path, tsvWithout('wifi'))
    expect(() => phoneLatency(path)).toThrow(/no warm rows matched for network "wifi"/)
  })

  it('POSITIVE CONTROL: the same builder leaves a readable TSV readable', () => {
    // Without this, the test above passes on a builder that produces garbage.
    const path = join(mkdtempSync(join(tmpdir(), 'taskr-207-tsv-')), 'phone.tsv')
    writeFileSync(path, tsvWithout('nothing-matches-this'))
    expect(phoneLatency(path).wifi.warm).toEqual({ n: 64, p50: 479, p95: 967 })
  })
})

describe('verdictLines — the figures both documents print', () => {
  // This function was imported by no test at all, so the 2,626 ms deployed-path
  // estimate in docs/extraction-verdict.md and docs/refresh-charter.md was held
  // to the committed transcript by nothing executable: changing the 95 to a 50
  // moved it to 1,932 ms with the whole suite green.
  it('derives the provider p95 from the transcript, not from a literal', async () => {
    const corpusResults = await runFromTranscript(
      JSON.parse(readFileSync(resolve(repo, 'docs/extraction-run-2026-08-31.transcript.json'), 'utf8')),
    )
    const phone = phoneLatency(resolve(repo, 'docs/phone-latency-2026-09-07.tsv'))
    const costByConfig = Object.fromEntries(
      JSON.parse(readFileSync(resolve(repo, 'docs/extraction-run-2026-08-31.transcript.json'), 'utf8')).runs.map(
        (run) => [run.config.label, costFromRun(run)],
      ),
    )
    const lines = verdictLines({ phone, corpusResults, costByConfig }).join('\n')

    expect(lines, 'the haiku provider p95 the documents quote').toContain('provider p95, claude-haiku-4-5')
    expect(lines).toContain('1659 ms')
    expect(lines).toContain('3060 ms')
    // The row both documents cite as the deployed-path estimate.
    expect(lines).toMatch(/wifi, warm p95\s+967 \+\s+1659\s+=\s+2626 ms/)
  })
})

describe('the latency estimate', () => {
  const phone = phoneLatency(resolve(repo, 'docs/phone-latency-2026-09-07.tsv'))
  const matrix = latencyMatrix(phone, { opus: 3060, haiku: 1659 })
  const cell = (transport, config) =>
    matrix.find((row) => row.transport === transport && row.config === config)

  it('crosses every transport reading with every provider p95', () => {
    expect(matrix).toHaveLength(8)
  })

  it('puts the expensive configuration over the kill number on every condition measured', () => {
    for (const row of matrix.filter((r) => r.config === 'opus')) {
      expect(row.totalMs, `${row.transport} should exceed the budget`).toBeGreaterThan(3000)
    }
  })

  it('labels the matrix from the module\'s budget, not from a literal of its own', () => {
    // The literal `3000` lived in this file and escaped extractionThresholds'
    // single-source-of-truth scan entirely, so moving the kill number would
    // have left every row here labelled against the retired one. Asserting the
    // module is the source, rather than that the current number is 3000.
    expect(DEPLOYED_LATENCY_BUDGET_MS).toBe(3000)
    const source = readFileSync(resolve(repo, 'scripts/extraction-verdict.mjs'), 'utf8')
    const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code, 'the budget is spelled here as well as in the module').not.toMatch(/\b3000\b/)
    expect(code).toContain('DEPLOYED_LATENCY_BUDGET_MS')
  })

  it('puts the cheap one under it warm on both networks, and over it on the worst cold wifi', () => {
    expect(cell('wifi, warm p95', 'haiku').totalMs).toBe(2626)
    expect(cell('cellular, warm p95', 'haiku').totalMs).toBe(2245)
    // 3056 against a 3000 budget — inside the estimate's own error, which is
    // why the document reports it as marginal rather than as a failure.
    expect(cell('wifi, worst cold', 'haiku').totalMs).toBe(3056)
  })
})
