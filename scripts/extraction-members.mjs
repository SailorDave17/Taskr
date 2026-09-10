// Run the extractor over sentences a REAL HOUSEHOLD MEMBER wrote — #207 AC 1.
//
//     npm run extraction:members -- --input <file> --record <transcript>
//     npm run extraction:members -- --input <file> --transcript <transcript>
//     npm run extraction:members -- --input <file> --sheet <file>
//
// This is the corpus runner's sibling and deliberately not the same command.
// `extraction:run` GRADES: every description carries an expected value written
// by hand in advance, and the score is arithmetic. Nothing here has an expected
// value, because nothing here was written by anybody who knew what the
// extractor does. The ground truth is the member's judgement, recorded AFTER
// they see what came back, and the only figure this produces is the correction
// rate `src/lib/memberCorrections.js` defines.
//
// WHY BOTH CONFIGURATIONS, AGAIN
//
// #206's central finding was that a headline hid a failure mode: `claude-opus-5`
// at effort low scored 88% while returning five responses the adapter could not
// parse, and Haiku scored 86% returning none. The two invert per kind. A trust
// measurement taken against one configuration would inherit exactly that blind
// spot, so every sentence goes to both and the review sheet puts the two
// answers side by side — which is also the cheapest way to ask whether the
// member's corrections land on the same sentences for both.
//
// THE SENTENCES MAY NEVER REACH THIS REPOSITORY
//
// They are real messages about a real household, and #19's rule — no real name
// in version control — is why the corpus casts `Alex`, `Robin` and `Sam`. So
// `--input` takes a PATH and defaults to nothing: the file can live outside the
// tree for the whole run, and whether any of it is ever committed is #207 AC 8,
// a decision for the owner once they can see exactly what would land. Nothing
// in this script writes to `src/` or `docs/`.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import {
  ALL_CLASSES,
  correctionRates,
  proposedFigures,
} from '../src/lib/memberCorrections.js'
import { DEFAULT_CONFIGS, createExtractor } from '../src/lib/extractionAdapter.js'
import { liveTransport, recordingTransport, replayTransport, transcriptKeyOf } from './extraction-run.mjs'

/** Refusals print their message and nothing else; see extraction-run.mjs. */
class Refusal extends Error {}

const KINDS = ['capacity', 'chores']

/** Read and validate the member's sentence file, refusing anything unscoreable. */
export function readInput(path) {
  const input = JSON.parse(readFileSync(path, 'utf8'))
  const sentences = input.sentences ?? []
  if (!sentences.length) throw new Refusal(`${path} carries no sentences`)
  const seen = new Set()
  for (const sentence of sentences) {
    if (!sentence.id) throw new Refusal(`a sentence in ${path} has no id`)
    if (seen.has(sentence.id)) throw new Refusal(`duplicate sentence id "${sentence.id}" in ${path}`)
    seen.add(sentence.id)
    if (!KINDS.includes(sentence.kind)) {
      throw new Refusal(`sentence "${sentence.id}" has kind "${sentence.kind}" — expected one of: ${KINDS.join(', ')}`)
    }
    if (!String(sentence.text ?? '').trim()) throw new Refusal(`sentence "${sentence.id}" has no text`)
  }
  // AC 1 names a floor of ten of each kind. It is reported rather than
  // enforced: a run of nine is still evidence, and refusing to look at it would
  // lose the measurement instead of qualifying it.
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, sentences.filter((s) => s.kind === kind).length]))
  return { ...input, sentences, counts }
}

/** Every sentence through one configuration, answers keyed by sentence id. */
export async function runConfig(config, sentences, transport) {
  const answers = {}
  const extractor = createExtractor(config, transport)
  for (const sentence of sentences) {
    // One at a time, in file order, so a transcript replays deterministically
    // and a rate limit degrades into a slow run rather than a burst of errors.
    answers[sentence.id] = await extractor({ kind: sentence.kind, text: sentence.text })
  }
  return { config, answers }
}

/** A live run over both configurations, recording every exchange. */
export async function recordLive(sentences, { apiKey, fetchImpl } = {}) {
  const runs = []
  const results = []
  for (const config of DEFAULT_CONFIGS) {
    const responses = []
    const transport = recordingTransport(liveTransport({ apiKey, fetchImpl }), responses)
    results.push(await runConfig(config, sentences, transport))
    runs.push({ config, responses })
  }
  return {
    results,
    transcript: {
      version: 1,
      kind: 'member-sentences',
      recordedAt: new Date().toISOString(),
      sentenceCount: sentences.length,
      runs,
    },
  }
}

/**
 * Replay a recorded member run.
 *
 * A miss REFUSES the whole report, for the reason the corpus runner states: a
 * transport that answered "not found" would be classified as a refusal, and a
 * correction rate computed over fabricated refusals would be plausible and
 * about nothing.
 */
export async function replay(transcript, sentences) {
  const results = []
  for (const run of transcript.runs) {
    const { transport, misses } = replayTransport(run)
    results.push(await runConfig(run.config, sentences, transport))
    if (misses.length) {
      throw new Refusal(
        `REFUSING to report: ${misses.length} of ${sentences.length} sentences are not in the ` +
          `transcript for "${run.config.label}".\n\nThe transcript was recorded against a different ` +
          `sentence file.\nFirst miss:\n  ${JSON.stringify(misses[0])}`,
      )
    }
  }
  return results
}

/** One answer, spelled for a person to check against the sentence they wrote. */
export function answerLines(answer) {
  if (!answer || typeof answer !== 'object') return ['        (no answer of any recognised shape)']
  if (answer.kind === 'refusal') return [`        REFUSED — ${answer.reason ?? '(no reason given)'}`]
  if (answer.kind === 'capacity') {
    const entries = Object.entries(answer.minutesByPerson ?? {})
    if (!entries.length) return ['        (capacity answer naming nobody)']
    return entries.map(([person, minutes]) => `        ${person}: ${minutes} min`)
  }
  if (answer.kind === 'chores') {
    const chores = answer.chores ?? []
    if (!chores.length) return ['        (chores answer listing nothing)']
    return chores.map(
      (chore) =>
        `        ${chore.title}: ${chore.expectedMinutes} min` +
        (chore.dueDate === undefined || chore.dueDate === null ? ', no date' : `, due "${chore.dueDate}"`),
    )
  }
  return [`        (unrecognised answer kind "${answer.kind}")`]
}

/**
 * The review sheet: what the member has to fill in, and nothing else.
 *
 * Emitted as JSON rather than as prose because it is read back and scored. The
 * member edits `corrections` in place; `_answer` and `_text` are there to be
 * read and are ignored on the way back, so a sheet that has drifted from its
 * transcript is caught by `scoreSentence`'s markup check rather than silently
 * scored against the wrong run.
 */
export function reviewSheet(input, results, onlyConfig) {
  // The sheet may cover fewer configurations than the run. Both are always
  // recorded — a transcript is cheap and re-running costs the owner's money —
  // but the REVIEW is a person's time, and on a large sentence set narrowing it
  // to the configuration that can actually ship is the difference between a
  // measurement taken and one abandoned half done. A configuration left out of
  // the sheet simply has no correction rate; it is never scored as if it had.
  const covered = onlyConfig ? results.filter((r) => r.config.label === onlyConfig) : results
  if (onlyConfig && !covered.length) {
    throw new Refusal(
      `--sheet-config "${onlyConfig}" matches no configuration in this run.\n` +
        `This run carries: ${results.map((r) => r.config.label).join(', ')}`,
    )
  }
  const entries = []
  for (const { config, answers } of covered) {
    for (const sentence of input.sentences) {
      const answer = answers[sentence.id]
      entries.push({
        key: `${config.label} / ${sentence.id}`,
        config: config.label,
        id: sentence.id,
        kind: sentence.kind,
        ...(sentence.variantOf ? { variantOf: sentence.variantOf } : {}),
        _text: sentence.text,
        _answer: answerLines(answer),
        _figuresProposed: proposedFigures(answer),
        // An explicit marker, because "reviewed and needed nothing" and "never
        // looked at" are otherwise BYTE-IDENTICAL — both an empty corrections
        // array. Inferring the difference from whether any correction exists
        // makes the best possible outcome on this axis (a review that found
        // nothing to fix) unreachable, and scores an abandoned review as a
        // complete one, always in the direction of clearing the kill number.
        reviewed: false,
        corrections: [],
      })
    }
  }
  return {
    _howToFill:
      'Set `"reviewed": true` on every entry you have checked — that is what says you looked, and ' +
      'an entry left false is never scored. Then, for each entry, add one object to `corrections` ' +
      'for every figure you had to fix, including every figure you had to type yourself because it ' +
      'is not in `_answer`. Each object is { "class": "<one of _classes>", "note": "<what was ' +
      'wrong>" }. Leave `corrections` empty where the answer needed nothing — a reviewed entry with ' +
      'no corrections is the best possible result, not a blank one.',
    _doNotEdit:
      '`variantOf` marks a sentence as a re-framing of another one in the same set — an experiment ' +
      'arm, not new evidence — and entries carrying it are tallied separately so the same member ' +
      'language is not counted twice. Removing it changes the rate. `key`, `config`, `id` and ' +
      '`kind` identify the entry; changing any of them scores it as something else.',
    _classes: ALL_CLASSES,
    _note:
      'A figure is one person\'s minutes, or one chore\'s minutes, or one chore\'s due date. ' +
      'A refused sentence costs one "refusal" correction per figure you then typed by hand.',
    entries,
  }
}

/** Every entry a person has actually marked as looked at. */
export const isReviewed = (entry) => entry.reviewed === true

/**
 * The withheld sentences' tallies, composed into the one object the scorer
 * validates — `count` sits beside the human-readable reason and the figures sit
 * under `tallies`, and the validation needs both.
 *
 * Composed here rather than at each call site: there are two callers, and a
 * hand-built object at each is how one of them ends up passing a block the
 * other does not. Returns undefined where a record withholds nothing, which is
 * the ordinary case for every future run.
 */
export function withheldTallies(input) {
  if (!input?.withheld?.tallies) return undefined
  return { ...input.withheld.tallies, count: input.withheld.count }
}

/**
 * Score a filled-in sheet, per configuration.
 *
 * REFUSES a sheet with any unreviewed entry rather than scoring what is there.
 * An unreviewed entry contributes its proposed figures to the denominator and
 * no corrections to the numerator, so a partial review always reads BETTER than
 * a complete one — and a wholly blank sheet reads 0%, the best possible value on
 * a kill axis, produced by nobody having looked. Both are false passes on the
 * one axis that can stop this bet, and neither announces itself.
 */
export function ratesFromSheet(sheet, results, { withheld } = {}) {
  const answersByConfig = new Map(results.map(({ config, answers }) => [config.label, answers]))
  const unreviewed = sheet.entries.filter((entry) => !isReviewed(entry))
  if (unreviewed.length) {
    throw new Refusal(
      `REFUSING to score: ${unreviewed.length} of ${sheet.entries.length} sheet entries are not marked reviewed.\n\n` +
        `An unreviewed entry adds its proposed figures to the denominator and no corrections to the\n` +
        `numerator, so a partial review reads better than a complete one and a blank sheet reads 0%.\n` +
        `Set "reviewed": true on each entry as it is checked — an empty "corrections" array then means\n` +
        `the answer needed nothing, which is a result rather than an absence.\n` +
        `First unreviewed: ${unreviewed[0].key}`,
    )
  }
  const byConfig = {}
  for (const entry of sheet.entries) {
    const answers = answersByConfig.get(entry.config)
    if (!answers) throw new Refusal(`the sheet names configuration "${entry.config}", which this run does not carry`)
    ;(byConfig[entry.config] ??= []).push({
      id: entry.id,
      kind: entry.kind,
      variantOf: entry.variantOf,
      answer: answers[entry.id],
      corrections: entry.corrections ?? [],
    })
  }
  return Object.fromEntries(
    Object.entries(byConfig).map(([label, reviews]) => [label, correctionRates(reviews, { withheld })]),
  )
}

/** The printed report: the shape of the run, then the rate per configuration. */
export function reportLines(input, results, rates) {
  const lines = []
  lines.push('Member-sentence run — #207 (correction rate; no expected values, no grader)')
  lines.push('='.repeat(78))
  lines.push(`  collected             ${input.collectedAt ?? '(undated)'}`)
  lines.push(`  written by            ${input.author ?? '(unattributed)'}`)
  for (const kind of KINDS) {
    const floor = input.counts[kind] >= 10 ? 'meets the ten AC 1 asks for' : 'BELOW the ten AC 1 asks for'
    lines.push(`  ${kind.padEnd(21)} ${String(input.counts[kind]).padStart(3)} sentences — ${floor}`)
  }
  if (!rates) {
    lines.push('')
    lines.push('  No corrections recorded yet — write the review sheet, have the member fill it in,')
    lines.push('  and run again with --sheet pointing at the filled-in file.')
    return lines
  }
  for (const [label, tallies] of Object.entries(rates)) {
    lines.push('')
    lines.push(`CONFIGURATION ${label}`)
    for (const scope of ['capacity', 'chores', 'all']) {
      const tally = tallies[scope]
      const rate = tally.rate === null ? 'no figures' : `${(tally.rate * 100).toFixed(1)}%`
      lines.push(
        `  ${scope.padEnd(10)}  ${String(tally.corrections).padStart(3)} corrections of ` +
          `${String(tally.figures).padStart(3)} figures   ${rate.padStart(10)}` +
          `   (${tally.proposed} proposed, ${tally.supplied} the member supplied)`,
      )
    }
    const classes = Object.entries(tallies.all.byClass)
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name} ${count}`)
    lines.push(`  by class    ${classes.length ? classes.join(', ') : 'nothing was corrected'}`)
  }
  return lines
}

const USAGE =
  'Usage:\n' +
  '  npm run extraction:members -- --input <file> --record <transcript>      live run (needs ANTHROPIC_API_KEY)\n' +
  '  npm run extraction:members -- --input <file> --transcript <transcript>  replay, no network and no key\n' +
  '  ...either, plus --sheet <file>   write a blank review sheet there, or score a filled-in one'

const argAfter = (argv, flag) => {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

export async function main(argv, env = process.env) {
  const inputPath = argAfter(argv, '--input')
  const recordPath = argAfter(argv, '--record')
  const transcriptPath = argAfter(argv, '--transcript')
  const sheetPath = argAfter(argv, '--sheet')
  if (!inputPath || (!recordPath && !transcriptPath)) throw new Refusal(USAGE)

  const input = readInput(inputPath)

  let results
  if (recordPath) {
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Refusal(
        'REFUSING to run live: ANTHROPIC_API_KEY is not set.\n\n' +
          'A live run sends every member sentence to the provider and bills the owner-held\n' +
          'account. It is never written to the transcript or the report. To score without a\n' +
          'key, replay a recorded transcript with --transcript.',
      )
    }
    const live = await recordLive(input.sentences, { apiKey })
    writeFileSync(recordPath, `${JSON.stringify(live.transcript, null, 2)}\n`)
    console.log(`transcript written to ${recordPath}\n`)
    results = live.results
  } else {
    results = await replay(JSON.parse(readFileSync(transcriptPath, 'utf8')), input.sentences)
  }

  let rates
  if (sheetPath) {
    let existing
    try {
      existing = JSON.parse(readFileSync(sheetPath, 'utf8'))
    } catch (error) {
      // ENOENT is the legitimate first-run case — there is no sheet yet and one
      // is about to be written. EVERYTHING ELSE is refused rather than swallowed:
      // a bare catch here treats a member's trailing comma exactly like a missing
      // file, and the next line overwrites their finished review with a blank
      // sheet. Reproduced: a syntax error in a 43-entry sheet printed "review
      // sheet written to …" and reported "No corrections recorded yet".
      if (error?.code !== 'ENOENT') {
        throw new Refusal(
          `REFUSING to read the review sheet at ${sheetPath}:\n  ${error?.message ?? error}\n\n` +
            `The sheet exists but could not be read. It is NOT being regenerated, because doing so\n` +
            `would replace whatever a member has already recorded there. Fix the file, or move it\n` +
            `aside deliberately if you want a fresh one.`,
        )
      }
      existing = undefined
    }
    // NEVER REGENERATE OVER AN EXISTING SHEET. The marker keying below is
    // right for deciding whether to SCORE, and a first version of it made that
    // decision govern the overwrite too — so a sheet carrying a member's
    // corrections but no markers was silently replaced by a blank one.
    // Reproduced: nine corrections destroyed, exit 0, and the replacement
    // carried 86 entries rather than 43 because this branch re-reads
    // --sheet-config and the operator's narrowing went with the data.
    //
    // A file that exists is a file somebody may have worked in. The only safe
    // rule is that this command writes a sheet where there is none and refuses
    // everywhere else; deleting one is a deliberate act with the shell, not a
    // side effect of re-running a report.
    if (existing?.entries?.length > 0 && !existing.entries.some(isReviewed)) {
      throw new Refusal(
        `REFUSING to regenerate ${sheetPath}: it already holds ${existing.entries.length} entries, ` +
          `and none is marked reviewed.\n\n` +
          `That is either a sheet nobody has started, or one somebody has filled in without setting\n` +
          `"reviewed": true — and this command cannot tell those apart. It will not overwrite either.\n` +
          `Mark the entries you have checked, or delete the file deliberately to start again.`,
      )
    }
    // Keyed on the explicit marker, never on whether any correction exists: a
    // review that correctly found nothing to fix is the CEILING case, and
    // inferring it as "not started" would regenerate the sheet forever.
    const filled = existing?.entries?.length > 0 && existing.entries.some(isReviewed)
    if (filled) {
      rates = ratesFromSheet(existing, results, { withheld: withheldTallies(input) })
    } else {
      const onlyConfig = argAfter(argv, '--sheet-config')
      const sheet = reviewSheet(input, results, onlyConfig)
      writeFileSync(sheetPath, `${JSON.stringify(sheet, null, 2)}\n`)
      console.log(`review sheet written to ${sheetPath} — ${sheet.entries.length} entries\n`)
    }
  }

  for (const line of reportLines(input, results, rates)) console.log(line)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isMain) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    // `process.exitCode`, never `process.exit()` — a live run has made real
    // fetches by the time anything throws (cairn:
    // node-process-exit-after-fetch-2026-08-23).
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}

export { Refusal, transcriptKeyOf }
