// Grade the extraction corpus through the provider adapter — #203 AC 3, AC 4.
//
//     npm run extraction:run -- --transcript <file>     replay a recorded run
//     npm run extraction:run -- --record <file>         live run, writes <file>
//
// This is the local runner the verdict stories drive. It grades with THE SAME
// GRADER the corpus report uses (`gradeExtraction`, the only implementation of
// the score in the tree) and prints through THE SAME formatter
// (`extraction-report-format.mjs`), so its figures are readable against the
// floor and ceiling `npm run extraction:corpus` prints — same rows, same
// spellings, labelled by which CONFIGURATION produced them.
//
// TWO MODES, ONE PIPE
//
// A LIVE run (`--record`) needs `ANTHROPIC_API_KEY` in the environment, sends
// one Messages API request per corpus item per configuration, and writes every
// response — status, body, elapsed ms — into a transcript file as it grades.
// A REPLAY run (`--transcript`) reads that file and grades through a transport
// that answers from it: same adapter, same grader, same report, no network, no
// key. The transcript is what makes a graded run REPRODUCIBLE — #206 records
// its live runs and the figures it reports can be re-derived by anyone from
// the committed transcript, the way every other corpus figure here is.
//
// The transcript keys responses on the request's user message, which embeds
// the input kind and the description — unique across the corpus, asserted by
// the corpus's own tests. A replay against a corpus that has changed since the
// recording therefore MISSES rather than mismatches, and a miss REFUSES the
// whole report: the adapter would otherwise score each miss as a
// transport-error refusal, and a report quietly graded over those would be
// plausible and wrong, which is the worst way for an instrument to fail.
//
// The API key is read from the environment, sent in one header, and stored
// NOWHERE: not in the transcript (which holds responses, never requests or
// headers) and not in the report. #206 AC 6 searches the recorded outputs for
// it; this is the design that makes that search come back empty.

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { gradeExtraction, INPUT_KINDS } from '../src/lib/extraction.js'
import { CORPUS } from '../src/lib/extraction.corpus.js'
import {
  ADAPTER_OUTCOMES,
  DEFAULT_CONFIGS,
  createExtractor,
} from '../src/lib/extractionAdapter.js'
import { pct, scoreLines, shapeLine } from './extraction-report-format.mjs'

/** Refusals print their message and nothing else; see check-deployed.mjs. */
class Refusal extends Error {}

const API_URL = 'https://api.anthropic.com/v1/messages'

/** The transcript key of one built request: its user message, verbatim. */
export function transcriptKeyOf(request) {
  return request.messages[0].content
}

/** A short stable name for a prompt's exact text, for the report and the
 * transcript — two runs whose figures differ must be attributable to WHICH
 * prompt, and printing the whole prompt per config would bury the figures. */
export function promptFingerprint(prompt) {
  return createHash('sha256').update(String(prompt), 'utf8').digest('hex').slice(0, 12)
}

/**
 * A transport that answers from one recorded run.
 *
 * Returns `{ transport, misses }`. A request whose key or model the recording
 * does not carry lands in `misses` AND throws — the throw keeps the adapter's
 * classification honest (a transport that fabricated a 404 would be lying),
 * and `misses` is what lets the caller refuse the report afterwards, because
 * an adapter-level refusal is exactly what a real dead wire produces and the
 * two must not be conflated silently.
 */
export function replayTransport(run) {
  const byKey = new Map(run.responses.map((entry) => [entry.key, entry]))
  const misses = []
  const transport = async (request) => {
    const entry = byKey.get(transcriptKeyOf(request))
    if (!entry || request.model !== run.config.model) {
      misses.push(transcriptKeyOf(request))
      throw new Error('not in the transcript this replay was built from')
    }
    if (entry.timeout) {
      const error = new Error(`recorded timeout after ${entry.ms ?? '?'} ms`)
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }
    return { status: entry.status, body: entry.body }
  }
  return { transport, misses }
}

/**
 * The live transport: the ONE place a URL, a header and the key exist.
 * Everything above this line works identically with it and without it.
 */
export function liveTransport({ apiKey, timeoutMs = 60_000, fetchImpl = globalThis.fetch }) {
  return async (request) => {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      // A body that is not JSON is still evidence — hand it through and let
      // the adapter call it unparseable, rather than flattening it to null.
      body = text
    }
    return { status: response.status, body }
  }
}

/** Wrap a transport so every exchange lands in `responses`, transcript-shaped. */
export function recordingTransport(inner, responses) {
  return async (request) => {
    const key = transcriptKeyOf(request)
    const started = Date.now()
    try {
      const response = await inner(request)
      responses.push({ key, status: response.status, body: response.body, ms: Date.now() - started })
      return response
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      if (timedOut) responses.push({ key, timeout: true, ms: Date.now() - started })
      throw error
    }
  }
}

/**
 * Grade the corpus once, through the adapter, under one config and transport.
 * Tallies the adapter's own outcome per attempt beside the grader's figures —
 * the grader sees three shapes; WHICH failure produced a refusal lives here.
 */
export async function gradeConfig(config, transport) {
  const tally = Object.fromEntries(Object.values(ADAPTER_OUTCOMES).map((outcome) => [outcome, 0]))
  const extractor = createExtractor(config, transport, (attempt) => {
    tally[attempt.outcome] += 1
  })
  const graded = await gradeExtraction(extractor, CORPUS)
  return { config, graded, tally }
}

/** p-th percentile of a list, nearest-rank. */
export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/**
 * The printed report for a set of graded runs — the corpus-report rows, per
 * configuration, each block headed by the label, model, effort and prompt
 * fingerprint that produced it (AC 3: the report names WHICH configuration
 * produced WHICH figures).
 */
export function runReportLines(results) {
  const lines = []
  lines.push('Extraction run — #203 (the same grader and rows as npm run extraction:corpus)')
  lines.push('='.repeat(78))
  const first = results[0]
  if (first) {
    lines.push('Corpus shape')
    for (const kind of INPUT_KINDS) lines.push(`  ${kind.padEnd(10)} ${shapeLine(first.graded.byKind[kind])}`)
    lines.push(`  ${'all'.padEnd(10)} ${shapeLine(first.graded.overall)}`)
  }
  for (const { config, graded, tally, latenciesMs } of results) {
    lines.push('')
    lines.push(
      `CONFIGURATION ${config.label} — model ${config.model}` +
        `${config.effort ? `, effort ${config.effort}` : ''}, prompt ${promptFingerprint(config.prompt)}`,
    )
    for (const kind of INPUT_KINDS) lines.push(...scoreLines(kind, graded.byKind[kind]))
    lines.push(...scoreLines('all', graded.overall))
    const failures = Object.entries(tally)
      .filter(([outcome, count]) => count > 0 && outcome !== 'capacity' && outcome !== 'chores')
      .map(([outcome, count]) => `${outcome} ${count}`)
    lines.push(`    adapter outcomes      ${failures.length ? failures.join(', ') : 'every attempt answered in shape'}`)
    if (latenciesMs?.length) {
      lines.push(
        `    latency               p50 ${percentile(latenciesMs, 50)} ms, p95 ${percentile(
          latenciesMs,
          95,
        )} ms over ${latenciesMs.length} calls`,
      )
    }
  }
  const scale = results
    .map(
      ({ config, graded }) =>
        `${config.label} ${pct(graded.overall.withinTolerance, graded.overall.answerable)}`,
    )
    .join(' · ')
  lines.push('')
  lines.push('='.repeat(78))
  lines.push(`Within tolerance, per configuration: ${scale}`)
  return lines
}

/** Replay every run in a transcript file and report, refusing on any miss. */
export async function runFromTranscript(transcript) {
  const results = []
  for (const run of transcript.runs) {
    const { transport, misses } = replayTransport(run)
    const result = await gradeConfig(run.config, transport)
    if (misses.length) {
      throw new Refusal(
        `REFUSING to report: ${misses.length} of ${CORPUS.length} corpus items are not in the ` +
          `transcript for "${run.config.label}".\n\nA missing entry would otherwise be graded as a ` +
          `transport failure — a plausible figure measuring nothing. The transcript was recorded ` +
          `against a different corpus or config.\nFirst miss:\n  ${JSON.stringify(misses[0])}`,
      )
    }
    const latenciesMs = run.responses.map((entry) => entry.ms).filter((ms) => Number.isFinite(ms))
    results.push({ ...result, latenciesMs })
  }
  return results
}

/** One live graded run per config, recording as it goes. Returns { results, transcript }. */
export async function recordLive(configs, { apiKey, fetchImpl } = {}) {
  const runs = []
  const results = []
  for (const config of configs) {
    const responses = []
    const transport = recordingTransport(liveTransport({ apiKey, fetchImpl }), responses)
    const result = await gradeConfig(config, transport)
    const latenciesMs = responses.map((entry) => entry.ms).filter((ms) => Number.isFinite(ms))
    runs.push({ config, responses })
    results.push({ ...result, latenciesMs })
  }
  const transcript = {
    version: 1,
    recordedAt: new Date().toISOString(),
    corpusSize: CORPUS.length,
    runs,
  }
  return { results, transcript }
}

const USAGE =
  'Usage:\n' +
  '  npm run extraction:run -- --transcript <file>   grade a recorded transcript (no network, no key)\n' +
  '  npm run extraction:run -- --record <file>       grade live and write the transcript (needs ANTHROPIC_API_KEY)'

export async function main(argv, env = process.env) {
  const transcriptAt = argv.indexOf('--transcript')
  const recordAt = argv.indexOf('--record')

  if (transcriptAt !== -1) {
    const path = argv[transcriptAt + 1]
    if (!path) throw new Refusal(USAGE)
    const transcript = JSON.parse(readFileSync(path, 'utf8'))
    const results = await runFromTranscript(transcript)
    for (const line of runReportLines(results)) console.log(line)
    return
  }

  if (recordAt !== -1) {
    const path = argv[recordAt + 1]
    if (!path) throw new Refusal(USAGE)
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Refusal(
        'REFUSING to run live: ANTHROPIC_API_KEY is not set.\n\n' +
          'A live run sends every corpus description to the provider and bills the owner-held\n' +
          'account. Set the key (an sk-ant-… value from console.anthropic.com) in the\n' +
          'environment for this one command; it is never written to the transcript or the\n' +
          'report, and it must never get a VITE_ prefix — the build refuses one that does.\n' +
          'To grade without a key, replay a recorded transcript:\n' +
          '  npm run extraction:run -- --transcript <file>',
      )
    }
    const { results, transcript } = await recordLive(DEFAULT_CONFIGS, { apiKey })
    writeFileSync(path, `${JSON.stringify(transcript, null, 2)}\n`)
    console.log(`transcript written to ${path}\n`)
    for (const line of runReportLines(results)) console.log(line)
    return
  }

  throw new Refusal(USAGE)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isMain) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    // `process.exitCode`, never `process.exit()` — a live run has made real
    // fetches by the time anything throws, and on Windows/Node 24 an exit
    // after a completed fetch can abort inside libuv (cairn:
    // node-process-exit-after-fetch-2026-08-23).
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}
