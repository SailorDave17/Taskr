// Plain-language capacity capture — the client half of the extraction bet, story #210.
//
// The charter's one deliberate bet is that a member will keep their capacity
// current if doing so costs a sentence rather than arithmetic. This module is
// the thin layer between the sentence and the number: it sends a description to
// the extraction endpoint and turns whatever comes back into exactly one of
// five OUTCOMES the capture screen can act on. Nothing here writes capacity.
// The write is `setCapacity`, reached only through the same Save a typed figure
// uses (AC 6, AC 9) — a proposal is a prefill the member confirms, never a
// figure the app applied on its own (AC 1).
//
// THE ENDPOINT, AND WHY IT IS NAMED HERE BEFORE IT EXISTS
//
// `EXTRACTION_FUNCTION` is the Edge Function #208 stands up, invoked with the
// grader's own `{ kind, text }` contract (extraction.js documents it) plus the
// household the request is for, which #208 AC 3 needs to scope the caller.
// Owner decision at #210's pickup, 2026-09-04: build this flow ahead of the
// endpoint and wire it to the name. Until #209 deploys the function, the
// gateway answers 404, `extractCapacity` reports FAILED, and the member gets
// the manual field — which is the fallback AC 2 requires and #214 later proves
// in production. `scripts/deploy-function.mjs` carries the name as PENDING so
// a bare `npm run deploy:function` does not try to deploy a directory that is
// not there; `LIVE_EDGE_FUNCTIONS` carries it as invoked, so `check:live`
// reads one honest red until the deploy lands.
//
// THE FIVE OUTCOMES, AND WHY A REFUSAL IS NOT A FAILURE
//
//   proposal  — a minutes figure for THIS member, with what it was read from.
//   question  — the endpoint refused (the contract's own refusal shape, which
//               the grader separates from an error), or the answer described
//               somebody else. The flow asks for more rather than showing a
//               number (AC 4): a confident wrong figure damages trust in a way
//               a question never does.
//   unusable  — the answer came back but does not parse to a minutes figure
//               inside the capacity range: wrong shape, an empty map, a
//               negative or fractional number, or more minutes than a week has.
//   failed    — the call did not produce an answer: the function refused, the
//               gateway 404'd, the network dropped, or the endpoint reported a
//               provider-side failure through the adapter's refusal-with-prefix
//               form.
//   timeout   — no answer inside the budget.
//
// A refusal and a malformed answer produce DIFFERENT sentences on purpose, and
// a test asserts they differ (AC 4). The sentences are written here rather than
// in the component so the chore flow (#213) inherits the same voice.
//
// THE WAIT IS DERIVED FROM THE KILL NUMBER, AND IS NOT THE KILL NUMBER
//
// The wait is `CLIENT_WAIT_MS`, imported from the thresholds module and never
// restated (AC 2). It is twice the deployed-path p95 kill number rather than
// the kill number itself — a first version bound the two together, and the
// review caught what that meant: a p95 is a ceiling one answer in twenty is
// expected to exceed even when the bet passes, and one of this file's own
// recorded fixtures is a correct refusal at 3060 ms provider-only, which a
// 3000 ms abort would have turned into a timeout. The reasoning and the
// margin live beside the constant. The interaction model is SYNCHRONOUS
// propose-then-confirm — the member waits, the figure appears in place, they
// confirm — chosen because the provider-only p95 is 1.7–3.1 s (#206): a
// proposal that arrives within a breath or two belongs in the editor the
// member is already holding, and an asynchronous proposal would need a stored
// pending figure, which is a write AC 1 forbids before confirm. That choice
// rests on a proxy: #205's deployed round-trip figure, not yet measured, is
// what AC 10 conditions it on, and it can reverse it.
//
// WHAT THE PURE HALF IS
//
// `proposeCapacity(response, { member, members })` is a pure function from a
// recorded endpoint response to an outcome (AC 5). Its tests run against
// recorded fixtures with no service and no credential; the impure half,
// `extractCapacity`, takes its transport as an injectable so the three
// failure outcomes can each be forced separately (AC 2).

import { getSupabase } from './supabase.js'
import { MAX_CAPACITY_MINUTES, MIN_CAPACITY_MINUTES } from './capacity.js'
import { normalizeEntity } from './extraction.js'
import { ADAPTER_OUTCOMES } from './extractionAdapter.js'
import { CLIENT_WAIT_MS } from './extractionThresholds.js'

export { CLIENT_WAIT_MS }

/**
 * The Edge Function this flow calls. A const rather than a literal at the call
 * site because `liveSchema.test.js` resolves it from here into the list
 * `check:live` probes — and because #208 will spell it in three more places.
 */
export const EXTRACTION_FUNCTION = 'extract-description'

/** Every outcome a description can have, as values rather than loose strings. */
export const CAPTURE_OUTCOMES = Object.freeze({
  PROPOSAL: 'proposal',
  QUESTION: 'question',
  UNUSABLE: 'unusable',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
})

/**
 * The adapter (extractionAdapter.js) folds a wire failure into the contract's
 * refusal shape with the outcome as a prefix — `unparseable-response: …`,
 * `http-error: …` — so the grader can score it as a miss. On a phone that is
 * not a refusal to be asked about; it is the service failing, and the member
 * should be told so and handed the manual field. Recognised here by the exact
 * prefixes the adapter writes, so #208 can pass the adapter's answer through
 * unchanged.
 */
const WIRE_FAILURE_PREFIXES = Object.freeze(
  [
    ADAPTER_OUTCOMES.UNPARSEABLE,
    ADAPTER_OUTCOMES.HTTP_ERROR,
    ADAPTER_OUTCOMES.TIMEOUT,
    ADAPTER_OUTCOMES.TRANSPORT_ERROR,
  ].map((outcome) => `${outcome}:`),
)

/**
 * The words a description uses for its own writer. A proposal keyed by one of
 * these was read as the member's own week, and a provenance line saying so
 * would repeat the headline (design-bar, 2026-09-04) — so the roster shows the
 * derivation only for a NAME. Compared under the grader's own key.
 */
export const FIRST_PERSON = Object.freeze(['i', 'me', 'my', 'myself', 'mine', 'you'])

export function isFirstPerson(who) {
  return FIRST_PERSON.includes(normalizeEntity(who ?? ''))
}

const question = (sentence) => ({ outcome: CAPTURE_OUTCOMES.QUESTION, sentence })
const unusable = (sentence) => ({ outcome: CAPTURE_OUTCOMES.UNUSABLE, sentence })
const failed = (sentence) => ({ outcome: CAPTURE_OUTCOMES.FAILED, sentence })

/** Ends a sentence the endpoint wrote, whatever punctuation it chose. */
function sentenceOf(reason) {
  const text = String(reason ?? '').trim()
  if (!text) return ''
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/**
 * The outcome of one endpoint response, for one member — the pure half.
 *
 * @param {unknown} response what the endpoint answered: one of the contract's
 *   three shapes, or anything else, which is unusable rather than an exception
 * @param {{member: {display_name?: string}, members?: Array<{id: string, display_name?: string}>}} context
 *   `member` is whose week is being described. `members` is the roster, used
 *   for exactly one judgement: a figure the answer attributes to a DIFFERENT
 *   household member is a question, not a proposal — "Robin has two hours"
 *   typed on Alex's row must not become Alex's week.
 *
 * ATTRIBUTION. The contract answers `minutesByPerson`, keyed by whatever the
 * text called the person: a name, "I", "me". The rule, in order:
 *   1. an entry whose key is this member's name (under the grader's own
 *      `normalizeEntity`, so "alex" and "Alex " agree) is theirs;
 *   2. otherwise, a SINGLE entry is theirs — "I have three hours" comes back
 *      keyed however the model spelled it, and there is nobody else it could
 *      be — unless that single key names another roster member;
 *   3. otherwise the answer describes other people, and the flow asks.
 */
export function proposeCapacity(response, { member, members = [] } = {}) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return unusable('That did not come back as a minutes figure.')
  }

  if (response.kind === 'refusal') {
    const reason = String(response.reason ?? '')
    if (WIRE_FAILURE_PREFIXES.some((prefix) => reason.startsWith(prefix))) {
      return failed(`The extraction service could not answer (${reason}).`)
    }
    return question(`One more detail is needed. ${sentenceOf(reason) || 'Say how much time you have.'}`)
  }

  if (response.kind !== 'capacity') {
    return unusable('That did not come back as a minutes figure.')
  }

  const map = response.minutesByPerson
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return unusable('That did not come back as a minutes figure.')
  }
  const entries = Object.entries(map)
  if (entries.length === 0) {
    return unusable('No figure came back for anybody.')
  }
  // A figure for nobody-in-particular. The grader's own `entitiesOf` refuses a
  // key that normalises to nothing, and so does this — before attribution,
  // because the single-entry rule below would otherwise adopt it and the
  // roster would read "Read as “: 180 min”" (review-fanout, 2026-09-04).
  if (entries.some(([who]) => !normalizeEntity(who))) {
    return unusable('That answer gave a figure with nobody’s name on it.')
  }

  const mine = normalizeEntity(member?.display_name ?? '')
  const rosterKeys = new Map(
    members
      .filter((m) => m && m.display_name)
      .map((m) => [normalizeEntity(m.display_name), m]),
  )

  // Rule 1, two halves: this member's NAME wins, and failing that a
  // first-person key is theirs — "I have three hours, Robin has two" comes
  // back keyed `I` beside `Robin`, and the writer is the one on this row. The
  // first version reached first-person keys only through the single-entry
  // rule, so that answer read as describing two other people (review-fanout,
  // 2026-09-04). The name is tried first so a description that names the
  // member AND says "me" cannot pick the wrong figure.
  let chosen = mine ? entries.find(([who]) => normalizeEntity(who) === mine) : undefined
  if (!chosen) chosen = entries.find(([who]) => isFirstPerson(who))
  if (!chosen && entries.length === 1) {
    const [who] = entries[0]
    const other = rosterKeys.get(normalizeEntity(who))
    if (!other || other === member || other.id === member?.id) chosen = entries[0]
  }
  if (!chosen) {
    const names = entries.map(([who]) => String(who).trim()).filter(Boolean)
    return question(
      `That describes ${names.join(', ')}, not you. Say how much time you have this week.`,
    )
  }

  const [who, minutes] = chosen
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return unusable('That did not come back as a whole number of minutes.')
  }
  if (minutes < MIN_CAPACITY_MINUTES) {
    return unusable(`That came back as ${minutes} minutes, which is less than none.`)
  }
  if (minutes > MAX_CAPACITY_MINUTES) {
    return unusable(
      `That came back as ${minutes} minutes, which is more than a week has (${MAX_CAPACITY_MINUTES}).`,
    )
  }

  return {
    outcome: CAPTURE_OUTCOMES.PROPOSAL,
    minutes,
    derivedFrom: { who: String(who).trim(), minutes },
  }
}

/** `functions.invoke` against the real client; the injectable's default. */
function defaultInvoke(options) {
  return getSupabase().functions.invoke(EXTRACTION_FUNCTION, options)
}

/**
 * Describe a week to the endpoint and classify the answer — the impure half.
 *
 * @param {{householdId: string, text: string, member: object, members?: Array<object>}} input
 * @param {{budgetMs?: number, invoke?: (options: object) => Promise<{data: unknown, error: unknown}>}} [deps]
 *   `invoke` is the transport, injectable so the tests force each failure
 *   outcome without a network; `budgetMs` defaults to the kill number and is
 *   overridable so a test can prove the budget is what times the wait out,
 *   not something else.
 *
 * THE TIMEOUT IS A RACE, AND THE SIGNAL IS A COURTESY. `Promise.race` against
 * the budget is what decides the outcome — the classification must not depend
 * on how the SDK surfaces an aborted fetch, which differs between versions and
 * which no test here could pin. The `AbortSignal` is passed anyway so the
 * request the member gave up on is actually cancelled rather than left to
 * finish and be thrown away.
 *
 * The failure sentence is read off the FUNCTION's own body for #112's reason —
 * the SDK collapses every non-2xx into "Edge Function returned a non-2xx
 * status code", which names nothing. Two keys, because two writers: a handler
 * this repo wrote answers `{ error }`, and the functions GATEWAY answers
 * `{ code, message }` — which is what a 404 looks like before #209 deploys
 * the function, and is measured through the SDK's real error class in
 * capture.test.js rather than modelled (review-fanout, 2026-09-04: the first
 * fixture was a shape the SDK cannot emit). Only when there is no body at all
 * does the SDK's own message stand.
 */
export async function extractCapacity(
  { householdId, text, member, members = [] },
  { budgetMs = CLIENT_WAIT_MS, invoke = defaultInvoke } = {},
) {
  if (!householdId) throw new Error('Which household? A description must name one.')
  const description = String(text ?? '').trim()
  if (!description) throw new Error('Describe your week first.')

  const controller = new AbortController()
  let timer
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error(`no answer within ${budgetMs} ms`)
      error.name = 'TimeoutError'
      reject(error)
    }, budgetMs)
  })

  let result
  try {
    result = await Promise.race([
      invoke({
        body: { householdId, kind: 'capacity', text: description },
        signal: controller.signal,
      }),
      budget,
    ])
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return {
        outcome: CAPTURE_OUTCOMES.TIMEOUT,
        sentence: `No answer came back within ${Math.round(budgetMs / 1000)} seconds.`,
      }
    }
    return failed(`The extraction service could not be reached: ${String(error?.message ?? error)}`)
  } finally {
    clearTimeout(timer)
  }

  if (result?.error) {
    let detail = ''
    try {
      const body = await result.error.context?.json?.()
      detail = body?.error ?? body?.message ?? ''
    } catch {
      detail = ''
    }
    return failed(
      detail ? String(detail) : `The extraction service could not answer: ${result.error.message}`,
    )
  }

  return proposeCapacity(result?.data, { member, members })
}
