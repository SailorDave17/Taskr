// The verdict on the extraction bet — #207.
//
//     npm run extraction:verdict
//     npm run extraction:verdict -- --members <input> --members-transcript <t> --sheet <s>
//
// Every other command in this family measures ONE axis. This one assembles the
// whole sheet from the three stories that measured the parts, and its only job
// is to make the assembly re-derivable — so that `docs/extraction-verdict.md`
// quotes no figure that a reader cannot reproduce from artefacts committed in
// this repository, and quotes nothing at all from another document's prose.
//
//     #206  a graded live run          docs/extraction-run-2026-08-31.transcript.json
//     #205  a phone's round trip       docs/phone-latency-2026-09-07.tsv
//     #207  the member sentences       a path, given on the command line
//
// THE LATENCY AXIS IS THE REASON THIS COMMAND EXISTS
//
// Neither #205 nor #206 can print it. #205 timed a phone to a TRIVIAL function
// and never called a provider; #206 timed a desk to the provider and never
// touched a phone. The kill number is named on the deployed path, which is both
// legs in one request — and no such request has ever been made, because the
// extraction endpoint (#208) does not exist. So this command combines them and
// labels the result an ESTIMATE, which `extractionThresholds.js` carries
// through to a PROVISIONAL verdict rather than a pass (#207 AC 3).
//
// THE COST AXIS IS FILLED IN HERE TOO
//
// `docs/extraction-run.md` records the gap in as many words: "the runner still
// prints cost as not measured, because nothing feeds costPerHouseholdPerYearUsd
// into extractionThresholds.js. The projection lives in the document and can
// drift from the instrument." The verdict sheet is the one place every axis has
// to carry a figure or the verdict is taken over an incomplete sheet, so the
// projection is computed here from the transcript's own usage blocks. #206's
// hand figures are the positive control: `--check-cost` asserts this
// computation reproduces them, which is what makes it an instrument rather than
// a second, differently-wrong copy of the same arithmetic.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { DEPLOYED_LATENCY_BUDGET_MS } from '../src/lib/extractionThresholds.js'
import { killConditionSection, pct } from './extraction-report-format.mjs'
import { percentile, runFromTranscript } from './extraction-run.mjs'
import { main as membersMain, readInput, ratesFromSheet, replay, withheldTallies } from './extraction-members.mjs'

class Refusal extends Error {}

const DEFAULTS = {
  corpusTranscript: 'docs/extraction-run-2026-08-31.transcript.json',
  phone: 'docs/phone-latency-2026-09-07.tsv',
}

/**
 * Provider list prices, US dollars per million tokens, as published 2026-06-24
 * and recorded in `docs/extraction-run.md` alongside the console reconciliation
 * that confirmed the basis. Written here rather than fetched: a price that
 * changed under a committed figure would silently restate a decided verdict.
 */
export const PRICES_USD_PER_MTOK = Object.freeze({
  'claude-opus-5': { input: 5.0, output: 25.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
})

/**
 * The usage model the per-year projection rests on, from #206 — one household
 * updating capacity weekly and capturing its chores once, at setup.
 *
 * It is an assumption, not a measurement, and it is stated as a named constant
 * so that a reader disagreeing with it can see exactly what to change. The cost
 * axis clears its kill number by more than a factor of twenty on the expensive
 * configuration, so no plausible disagreement about this reaches the verdict.
 */
export const USAGE_MODEL = Object.freeze({ capacityExtractionsPerYear: 52, choresExtractionsPerYear: 1 })

/**
 * The price for a model id, refusing rather than returning nothing.
 *
 * THE LOOKUP HAS TO BE ON THE CONFIGURATION'S MODEL, NOT THE RESPONSE'S.
 * *Measured on #206's committed transcript*: the provider echoes
 * `claude-haiku-4-5-20251001` for a request that named `claude-haiku-4-5`, and
 * `claude-opus-5` for one that named `claude-opus-5` — a dated id for one and a
 * bare alias for the other, in the same run. Keyed on the echo, Haiku's whole
 * cost silently disappeared and the axis printed "not measured", which reads as
 * NOBODY HAS MEASURED THIS rather than THE LOOKUP FAILED. It was invisible only
 * because the other configuration worked.
 *
 * So: price by what was ASKED FOR, which is a value in this repository, and
 * throw on an id with no price. A cost axis that degrades to "not measured" on
 * a typo is an axis that reports the absence of evidence as the absence of a
 * bill.
 */
export function priceFor(model) {
  const price = PRICES_USD_PER_MTOK[model]
  if (!price) {
    throw new Refusal(
      `no price recorded for model "${model}".\n\n` +
        `Add it to PRICES_USD_PER_MTOK with its published rates and the date they were read.\n` +
        `Known: ${Object.keys(PRICES_USD_PER_MTOK).join(', ')}`,
    )
  }
  return price
}

/**
 * Whether the model that actually served agrees with the one requested.
 *
 * A provider is entitled to resolve an alias to a dated id, and does — but a
 * response served by a DIFFERENT model would make every figure in this sheet
 * about something else, so the prefix is asserted rather than assumed.
 */
export function servedAsRequested(requested, served) {
  return typeof served === 'string' && served.startsWith(requested)
}

/** What one recorded response cost, priced at the requested model's rates. */
export function costOfResponse(entry, price) {
  const usage = entry?.body?.usage
  if (!usage || !price) return null
  // `cache_read_input_tokens` was zero throughout #206's run — every call paid
  // full input price, the conservative direction — so it is added at full rate
  // rather than discounted. A future run with cache hits would overstate here,
  // which is the safe way for a cost estimate to be wrong.
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
  const output = usage.output_tokens ?? 0
  return (input * price.input + output * price.output) / 1_000_000
}

/**
 * Mean cost per extraction, per kind, for one recorded run — and from those,
 * the per-household-per-year projection the kill number is named against.
 *
 * The kind is read off the transcript key, which embeds it verbatim
 * ("input kind: capacity\ndescription: …"), so nothing here has to be told
 * which responses were which.
 */
export function costFromRun(run) {
  const price = priceFor(run.config.model)
  const perKind = { capacity: [], chores: [] }
  const servedBy = new Set()
  for (const entry of run.responses) {
    if (entry?.body?.model) servedBy.add(entry.body.model)
    const cost = costOfResponse(entry, price)
    if (cost === null) continue
    const kind = entry.key.startsWith('input kind: chores') ? 'chores' : 'capacity'
    perKind[kind].push(cost)
  }
  const wrongModel = [...servedBy].filter((served) => !servedAsRequested(run.config.model, served))
  if (wrongModel.length) {
    throw new Refusal(
      `"${run.config.label}" requested ${run.config.model} but responses came back from ` +
        `${wrongModel.join(', ')}.\n\nEvery figure attributed to this configuration would be about a ` +
        `different model.`,
    )
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const capacity = mean(perKind.capacity)
  const chores = mean(perKind.chores)
  const total = [...perKind.capacity, ...perKind.chores].reduce((a, b) => a + b, 0)
  if (capacity === null || chores === null) return { total, perYear: null }
  return {
    perExtraction: { capacity, chores },
    calls: perKind.capacity.length + perKind.chores.length,
    total,
    perYear:
      capacity * USAGE_MODEL.capacityExtractionsPerYear + chores * USAGE_MODEL.choresExtractionsPerYear,
  }
}

/**
 * #205's committed rows, re-derived rather than quoted.
 *
 * "Fresh socket, warm" is the `warm` phase plus each pass's opening
 * `first-after-idle` call, which is how #205's own table reaches n=64 per
 * network — the connection is new in both cases, and the isolate is warm.
 * `reused` rows are excluded: they share one curl process, so only their
 * aggregate is captured, and a member's first tap opens a socket.
 */
export function phoneLatency(path) {
  const rows = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
  const header = rows[0].split('\t')
  const parsed = rows.slice(1).map((line) => Object.fromEntries(line.split('\t').map((v, i) => [header[i], v])))
  const ms = (predicate) => parsed.filter(predicate).map((row) => Number(row.total_s) * 1000)

  const freshWarm = (network) =>
    ms(
      (row) =>
        row.network === network &&
        row.reached === 'function' &&
        row.num_connects === '1' &&
        (row.phase === 'warm' || row.phase === 'first-after-idle'),
    )
  const cold = (network) => ms((row) => row.network === network && row.phase === 'cold')

  const byNetwork = {}
  for (const network of ['wifi', 'cellular']) {
    const warm = freshWarm(network)
    const coldMs = cold(network)
    // AN EMPTY SAMPLE IS NOT A MEASUREMENT OF ZERO. `percentile([])` returns
    // null, `Math.round(null)` is 0, and `Math.round(Math.max(...[]))` is
    // -Infinity — so a TSV whose rows stop matching these filters (a renamed
    // column, a network labelled `wifi-5g`, changed phase names) yielded a
    // transport p95 of 0 ms, and the latency axis then reported the PROVIDER
    // LEG ALONE as a cleared deployed-path estimate. That is precisely the
    // substitution `extractionThresholds.js` says the axis exists to prevent,
    // and `isFigure(0)` is true by design because a real zero would be a
    // measurement. So the emptiness has to be caught here, at the source.
    if (!warm.length || !coldMs.length) {
      throw new Refusal(
        `no ${!warm.length ? 'warm' : 'cold'} rows matched for network "${network}" in ${path}.\n\n` +
          `A phone TSV with no rows for a network it is supposed to carry is a malformed artefact,\n` +
          `not a measurement of zero. Reporting it as one would put the provider leg alone into the\n` +
          `deployed-path axis and clear a kill number with half the path missing.`,
      )
    }
    byNetwork[network] = {
      warm: { n: warm.length, p50: Math.round(percentile(warm, 50)), p95: Math.round(percentile(warm, 95)) },
      // NO p95 IS QUOTED FOR THE COLD ROWS. There are three per network, and at
      // n=3 the nearest-rank p95 IS the maximum — a distribution's name on the
      // worst thing that happened. #205 states this and reports maxima; so does
      // this. (cairn: a-percentile-over-a-small-sample-is-an-order-statistic)
      cold: { n: coldMs.length, max: Math.round(Math.max(...coldMs)) },
    }
  }
  return byNetwork
}

/** The estimate matrix: every transport reading against every provider p95. */
export function latencyMatrix(phone, providerP95ByConfig) {
  const transports = [
    { label: 'wifi, warm p95', ms: phone.wifi.warm.p95 },
    { label: 'cellular, warm p95', ms: phone.cellular.warm.p95 },
    { label: 'wifi, worst cold', ms: phone.wifi.cold.max },
    { label: 'cellular, worst cold', ms: phone.cellular.cold.max },
  ]
  return transports.flatMap((transport) =>
    Object.entries(providerP95ByConfig).map(([label, providerCallP95Ms]) => ({
      transport: transport.label,
      transportMs: transport.ms,
      config: label,
      providerCallP95Ms,
      totalMs: transport.ms + providerCallP95Ms,
    })),
  )
}

/**
 * Which transport reading the headline sheet is taken at.
 *
 * The WORSE of the two networks' warm p95s — a kill number should not be read
 * at the friendlier of two measured conditions, and #205's finding that
 * cellular beat wifi on every percentile is exactly why this is chosen by
 * comparison rather than by assuming which network is pessimistic.
 *
 * Not the cold maxima: those are three samples each, one of them taken through
 * a link its own control showed was degraded, and a maximum is not a p95.
 */
export function headlineTransportMs(phone) {
  return Math.max(phone.wifi.warm.p95, phone.cellular.warm.p95)
}

export function verdictLines({ phone, corpusResults, costByConfig, correctionRateByConfig }) {
  const lines = []
  lines.push('The extraction bet — the verdict sheet (#207)')
  lines.push('='.repeat(78))
  lines.push('')
  lines.push('DEPLOYED-PATH LATENCY IS AN ESTIMATE, NOT A MEASUREMENT (AC 3)')
  lines.push('  #205 timed a phone to a trivial function; #206 timed a desk to the provider.')
  lines.push('  No request has ever carried both legs. The sum of two p95s is not the p95 of')
  lines.push('  the sum; under independence it overstates, which is the conservative direction.')
  lines.push('')
  for (const network of ['wifi', 'cellular']) {
    const reading = phone[network]
    lines.push(
      `  transport, ${network.padEnd(9)} warm p50 ${String(reading.warm.p50).padStart(5)} ms, ` +
        `p95 ${String(reading.warm.p95).padStart(5)} ms over ${reading.warm.n} calls` +
        `   ·   worst cold ${reading.cold.max} ms over ${reading.cold.n} (no p95 at n=${reading.cold.n})`,
    )
  }
  const providerP95 = Object.fromEntries(
    corpusResults.map(({ config, latenciesMs }) => [config.label, percentile(latenciesMs, 95)]),
  )
  lines.push('')
  for (const [label, ms] of Object.entries(providerP95)) {
    lines.push(`  provider p95, ${label.padEnd(26)} ${String(ms).padStart(5)} ms`)
  }
  lines.push('')
  lines.push('  ESTIMATED DEPLOYED p95 = transport + provider')
  for (const cell of latencyMatrix(phone, providerP95)) {
    // Read from the module, never spelled here. A literal in this file escaped
    // the single-source-of-truth scan entirely, so moving the kill number would
    // have left this matrix labelling every row against the retired one.
    const budget = DEPLOYED_LATENCY_BUDGET_MS
    const verdict = cell.totalMs <= budget ? `under ${budget}` : `OVER ${budget}`
    lines.push(
      `    ${cell.transport.padEnd(22)} ${String(cell.transportMs).padStart(5)} + ` +
        `${String(cell.providerCallP95Ms).padStart(5)}  =  ${String(cell.totalMs).padStart(5)} ms   ` +
        `${verdict.padEnd(11)} ${cell.config}`,
    )
  }
  const headline = headlineTransportMs(phone)
  lines.push('')
  lines.push(`  The sheet below is taken at ${headline} ms — the WORSE of the two networks' warm p95s.`)

  for (const { config, graded, latenciesMs } of corpusResults) {
    lines.push('')
    lines.push('='.repeat(78))
    lines.push(`CONFIGURATION ${config.label}`)
    lines.push(
      `  within tolerance      ${graded.overall.withinTolerance} of ${graded.overall.answerable}` +
        `   (${pct(graded.overall.withinTolerance, graded.overall.answerable)})`,
    )
    const cost = costByConfig[config.label]
    if (cost?.perYear !== null && cost?.perYear !== undefined) {
      lines.push(
        `  cost                  $${cost.perYear.toFixed(4)} per household per year ` +
          `(${USAGE_MODEL.capacityExtractionsPerYear} capacity + ${USAGE_MODEL.choresExtractionsPerYear} chores)`,
      )
    }
    lines.push('')
    lines.push(...killConditionSection({
      graded,
      latency: { transportP95Ms: headline, providerCallP95Ms: percentile(latenciesMs, 95) },
      costPerHouseholdPerYearUsd: cost?.perYear ?? undefined,
      correctionRate: correctionRateByConfig?.[config.label] ?? undefined,
    }))
  }
  return lines
}

const argAfter = (argv, flag) => {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

export async function main(argv) {
  const corpusPath = argAfter(argv, '--corpus-transcript') ?? DEFAULTS.corpusTranscript
  const phonePath = argAfter(argv, '--phone') ?? DEFAULTS.phone

  const corpusResults = await runFromTranscript(JSON.parse(readFileSync(corpusPath, 'utf8')))
  const transcript = JSON.parse(readFileSync(corpusPath, 'utf8'))
  const costByConfig = Object.fromEntries(transcript.runs.map((run) => [run.config.label, costFromRun(run)]))
  const phone = phoneLatency(phonePath)

  let correctionRateByConfig
  const membersPath = argAfter(argv, '--members')
  const membersTranscript = argAfter(argv, '--members-transcript')
  const sheetPath = argAfter(argv, '--sheet')
  if (membersPath && membersTranscript && sheetPath) {
    const input = readInput(membersPath)
    const memberResults = await replay(JSON.parse(readFileSync(membersTranscript, 'utf8')), input.sentences)
    const sheet = JSON.parse(readFileSync(sheetPath, 'utf8'))
    // The withheld tallies are handed to the scorer, not applied afterwards by
    // a reader. Their absence here is what made this command print a figure the
    // document it serves did not carry — 28.1% PASS against a recorded 30.3%
    // FAIL, inverting the run verdict in the reassuring direction, while the
    // only place the arithmetic happened was a hand-written test.
    const rates = ratesFromSheet(sheet, memberResults, { withheld: withheldTallies(input) })
    // Per scope, not just the run level — #207 measured the two kinds landing
    // on either side of the kill number, and handing the axis a bare number
    // would leave the capacity and chores rows reading "not measured" beside a
    // figure that exists. A scope the sheet did not cover stays absent rather
    // than inheriting the overall rate.
    correctionRateByConfig = Object.fromEntries(
      Object.entries(rates).map(([label, tallies]) => [
        label,
        Object.fromEntries(
          ['capacity', 'chores', 'all']
            .filter((scope) => tallies[scope].rate !== null)
            .map((scope) => [scope, tallies[scope].rate]),
        ),
      ]),
    )
  }

  for (const line of verdictLines({ phone, corpusResults, costByConfig, correctionRateByConfig })) {
    console.log(line)
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isMain) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}

export { Refusal, membersMain }
