// The extraction prompt and provider adapter — #203.
//
// This is the half of the AI bet that talks to a real model: it turns the
// grader's `{ kind, text }` contract (documented at the head of extraction.js)
// into an Anthropic Messages API request, and turns whatever comes back into
// exactly one of the three contract shapes. The PROVIDER IS ANTHROPIC — owner
// decision at pickup, 2026-08-30. The wire shape this module builds and parses
// is `POST /v1/messages` (anthropic-version 2023-06-01); switching providers
// means rewriting `buildRequest` and `attemptExtraction`, and that cost was
// stated when the decision was taken.
//
// NO SDK, AND NO NETWORK CODE, ON PURPOSE
//
// Everything here deals in request and response BODIES. The transport — the
// function that actually moves a body across the network — is a required
// parameter, and this module never names `fetch`, a URL, a header or a
// credential. Three things depend on that seam, and each is an acceptance
// criterion rather than a preference:
//
//   - CI runs the adapter's tests inside `npm test` with no network access, no
//     provider account and no credential (AC 6) — possible only because the
//     tests inject the transport and this module cannot call out around it.
//   - #208's Edge Function runs on Deno, where a Node SDK dependency is a
//     porting problem and a raw request body is not. The endpoint imports this
//     module and supplies its own transport, so the prompt and the parser are
//     written once.
//   - The credential stays wherever the transport lives — the runner reads it
//     from the environment, the Edge Function from its secrets — and no code
//     path under src/ ever holds it. `src/lib/keyShape.js` refuses an
//     Anthropic-shaped value in any client-visible variable (#203 AC 5,
//     pulling #56 AC 5 forward into the story that first gives the key a
//     reason to exist), and the #87 boundary scan in gate.test.js refuses this
//     module ever naming the key — which is why this comment does not spell
//     its prefix.
//
// WHAT THE TRANSPORT IS
//
//     async (requestBody) => ({ status, body })
//
// `requestBody` is the JSON-serialisable Messages API body this module built.
// `status` is the HTTP status; `body` is the response JSON, already parsed
// (or whatever the wire returned, if it was not JSON — this module treats a
// non-envelope body as unparseable rather than trusting the transport to have
// validated it). A transport that times out throws an error whose `name` is
// `TimeoutError` or `AbortError` — which is what `fetch` under
// `AbortSignal.timeout()` throws, so the live transport gets the right
// classification for free.
//
// EVERY ATTEMPT HAS A NAMED OUTCOME (AC 2)
//
// #56 AC 3's requirement, carried forward into #208 AC 5: a provider error, a
// timeout and an unparseable response each map to a DISTINCT named outcome
// rather than to one generic failure. The outcome is the adapter's own tally —
// the grader never sees it. What the grader sees is the contract: the extractor
// built by `createExtractor` returns one of the three documented shapes for
// EVERY attempt (AC 1), so a transport-level failure arrives at the grader as a
// refusal whose reason names the outcome. The grader then scores it as a
// refusal-on-answerable — a miss — which is the honest reading: the denominator
// is what was answerable, not what the transport managed to deliver. The
// runner reports the adapter tally BESIDE the grader's figures, so "the model
// refused" and "the wire failed" stay separable in the report while staying
// one contract at the seam.
//
// THE PROMPT AND THE MODEL ARE PARAMETERS (AC 3)
//
// `attemptExtraction` and `createExtractor` take a CONFIG — `{ label, model,
// prompt, effort?, maxTokens? }` — and build the request from it alone.
// `DEFAULT_PROMPT` and `DEFAULT_CONFIGS` are defaults, not constants the code
// reaches for: grading the corpus at two configurations is two configs handed
// to the same functions, and the report names which one produced which figures.

/**
 * Every outcome one extraction attempt can have. The first three are the
 * contract's own vocabulary; the last four are the ways a live call fails
 * before there is a contract shape to speak of — each named so the runner's
 * tally can say WHICH happened, which is the whole of AC 2.
 */
export const ADAPTER_OUTCOMES = Object.freeze({
  CAPACITY: 'capacity',
  CHORES: 'chores',
  REFUSAL: 'refusal',
  UNPARSEABLE: 'unparseable-response',
  HTTP_ERROR: 'http-error',
  TIMEOUT: 'timeout',
  TRANSPORT_ERROR: 'transport-error',
})

/**
 * The extraction prompt. A parameter everywhere it is used — this is the
 * default configuration's text, and #206 grades alternatives against it.
 *
 * Two rules in it are product decisions, not phrasing:
 *   - A due date is copied AS STATED, never resolved and never invented
 *     (#202, filing gate). Date arithmetic belongs to dueDates.js, where it is
 *     deterministic and timezone-pinned; a model resolving "Tuesday" would put
 *     the corpus's hardest failure mode — an invented fact — inside the field
 *     that exists to avoid one.
 *   - Refusal beats guessing. The corpus counts a confident answer to an
 *     undecidable description as overconfidence, separately from mere error,
 *     because the charter's kill condition is trust.
 */
export const DEFAULT_PROMPT = [
  'You extract structured facts from one short household message. The message describes',
  'either weekly time capacity or chores, and the input names which. Answer with a single',
  'JSON object and nothing else: no prose, no explanation, no code fences.',
  '',
  'For kind "capacity" answer:',
  '  {"kind":"capacity","minutesByPerson":{"<person>":<minutes>}}',
  '- One entry per person the text gives time for, spelled exactly as the text spells them.',
  '- Convert every duration to whole minutes for the week, summing parts the text splits',
  '  across days.',
  '- A person the text says has no time gets 0. A person the text never mentions gets no entry.',
  '',
  'For kind "chores" answer:',
  '  {"kind":"chores","chores":[{"title":"<job>","expectedMinutes":<minutes>,"dueDate":"<as stated>"}]}',
  '- One entry per job, titled with the job as the text states it.',
  '- expectedMinutes is how long the job takes, in whole minutes.',
  '- dueDate is the due date EXACTLY as the text states it: copy the phrase, whether it is a',
  '  weekday, a relative word, a spelled-out date or a numeric date. Do not resolve it to a',
  '  calendar date and do not reword it. Where the text states no date for a job, omit',
  '  dueDate entirely. Never invent one.',
  '',
  'When the message cannot be answered - it names no usable quantity, refers to a baseline',
  'it does not state, or offers figures too far apart to choose between - answer:',
  '  {"kind":"refusal","reason":"<one sentence saying what is missing>"}',
  'Refuse rather than guess: a confident number for an undecidable message is worse than a',
  'refusal.',
  '',
  'For an explicit range, answer the midpoint. Amounts may be written as words - half an',
  'hour is 30 minutes.',
].join('\n')

/**
 * The two configurations #206 grades. The two ends of the plausible range:
 * the most capable current model at low effort (extraction is a small task
 * with a 3000 ms deployed-path latency kill number), and the small fast model
 * that the $5-per-household-per-year cost kill number most plausibly buys.
 * Haiku predates the effort parameter, so its config carries none and
 * `buildRequest` sends none.
 */
export const DEFAULT_CONFIGS = Object.freeze([
  Object.freeze({
    label: 'claude-opus-5 effort-low',
    model: 'claude-opus-5',
    prompt: DEFAULT_PROMPT,
    effort: 'low',
  }),
  Object.freeze({
    label: 'claude-haiku-4-5',
    model: 'claude-haiku-4-5',
    prompt: DEFAULT_PROMPT,
  }),
])

/**
 * The user message for one extraction. Deterministic and injective over the
 * corpus — descriptions are unique (the corpus asserts it), so this string
 * identifies the item, which is what lets a recorded transcript key its
 * responses on it.
 */
export function userMessage({ kind, text }) {
  return `input kind: ${kind}\ndescription: ${text}`
}

/**
 * The Messages API request body for one extraction under one config.
 *
 * `output_config.effort` is sent only when the config carries one — the
 * parameter exists on the Opus/Sonnet 4.6+ family and errors on Haiku 4.5.
 * `thinking` is never sent: models that think by default (Opus 5) run
 * adaptively, and effort is the lever the config owns.
 */
export function buildRequest(config, { kind, text }) {
  const body = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    system: config.prompt,
    messages: [{ role: 'user', content: userMessage({ kind, text }) }],
  }
  if (config.effort) body.output_config = { effort: config.effort }
  return body
}

/**
 * The answer text of a Messages API response envelope: every `text` content
 * block, joined. Thinking blocks (present by default on models that think,
 * with their text omitted) are skipped rather than tripped over.
 */
function answerTextOf(envelope) {
  if (!Array.isArray(envelope?.content)) return null
  const texts = envelope.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
  return texts.length ? texts.join('') : null
}

/**
 * Parse a model's answer text as the contract JSON. Tolerates exactly one
 * decoration the prompt forbids but models still produce: a code fence around
 * the object. Anything else that does not parse is the caller's unparseable
 * branch — this module does not get cleverer than that, because every
 * salvaging heuristic is a way for a malformed answer to reach the grader
 * looking confident.
 */
function parseAnswer(text) {
  let candidate = String(text).trim()
  const fenced = candidate.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  if (fenced) candidate = fenced[1].trim()
  try {
    const parsed = JSON.parse(candidate)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** A refusal in the contract's shape, from a failure the model never saw. */
function refusalFor(outcome, detail) {
  return { kind: 'refusal', reason: `${outcome}: ${detail}` }
}

/**
 * One extraction attempt: build the request, hand it to the transport,
 * classify what came back.
 *
 * Returns `{ outcome, answer, detail }`. `answer` is ALWAYS one of the three
 * contract shapes (AC 1) — for the four failure outcomes it is a refusal whose
 * reason names the outcome, so the grader scores the attempt as a miss on an
 * answerable item rather than being handed something it cannot read. `detail`
 * says what a tally line should say: the HTTP status, the parse problem, the
 * thrown message.
 */
export async function attemptExtraction(config, transport, { kind, text }) {
  const request = buildRequest(config, { kind, text })

  let response
  try {
    response = await transport(request)
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    const outcome = timedOut ? ADAPTER_OUTCOMES.TIMEOUT : ADAPTER_OUTCOMES.TRANSPORT_ERROR
    const detail = String(error?.message ?? error)
    return { outcome, answer: refusalFor(outcome, detail), detail }
  }

  if (!response || typeof response !== 'object') {
    const detail = 'transport returned no response object'
    return {
      outcome: ADAPTER_OUTCOMES.TRANSPORT_ERROR,
      answer: refusalFor(ADAPTER_OUTCOMES.TRANSPORT_ERROR, detail),
      detail,
    }
  }

  if (response.status !== 200) {
    const providerMessage = response.body?.error?.message
    const detail = `status ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`
    return {
      outcome: ADAPTER_OUTCOMES.HTTP_ERROR,
      answer: refusalFor(ADAPTER_OUTCOMES.HTTP_ERROR, detail),
      detail,
    }
  }

  // The API can decline a request at the safety layer: HTTP 200 with
  // `stop_reason: "refusal"` and no usable content. That is a refusal by the
  // provider rather than by the model's reading of the text, but the contract
  // has one refusal shape and the reason string carries which this was.
  if (response.body?.stop_reason === 'refusal') {
    const detail = `provider safety refusal${response.body?.stop_details?.category ? ` (${response.body.stop_details.category})` : ''}`
    return { outcome: ADAPTER_OUTCOMES.REFUSAL, answer: { kind: 'refusal', reason: detail }, detail }
  }

  const answerText = answerTextOf(response.body)
  if (answerText === null) {
    const detail = 'response carried no text content block'
    return {
      outcome: ADAPTER_OUTCOMES.UNPARSEABLE,
      answer: refusalFor(ADAPTER_OUTCOMES.UNPARSEABLE, detail),
      detail,
    }
  }

  const parsed = parseAnswer(answerText)
  if (!parsed) {
    const detail = 'answer text is not a JSON object'
    return {
      outcome: ADAPTER_OUTCOMES.UNPARSEABLE,
      answer: refusalFor(ADAPTER_OUTCOMES.UNPARSEABLE, detail),
      detail,
    }
  }

  if (parsed.kind === 'refusal') {
    return {
      outcome: ADAPTER_OUTCOMES.REFUSAL,
      answer: { kind: 'refusal', reason: String(parsed.reason ?? '') },
      detail: String(parsed.reason ?? ''),
    }
  }

  if (parsed.kind === 'capacity' || parsed.kind === 'chores') {
    // The OUTER kind is the adapter's to check; the inner shape is the
    // grader's. `entitiesOf` refuses a wrong-kind or malformed answer and
    // scores it, which is exactly the distinct-stated-failure pipe the grader
    // was built with — re-validating it here would be a second implementation
    // of that judgement.
    return { outcome: parsed.kind, answer: parsed, detail: '' }
  }

  const detail = `answer JSON has kind "${String(parsed.kind)}", which the contract does not name`
  return {
    outcome: ADAPTER_OUTCOMES.UNPARSEABLE,
    answer: refusalFor(ADAPTER_OUTCOMES.UNPARSEABLE, detail),
    detail,
  }
}

/**
 * The contract-shaped extractor the grader consumes: `({ kind, text })` in,
 * one of the three documented shapes out — `gradeExtraction` can await it
 * directly. `onAttempt`, when given, sees every attempt's full classification
 * (outcome, detail, input), which is how the runner tallies adapter outcomes
 * without a second grading pass.
 */
export function createExtractor(config, transport, onAttempt) {
  return async ({ kind, text }) => {
    const attempt = await attemptExtraction(config, transport, { kind, text })
    if (onAttempt) onAttempt(attempt, { kind, text })
    return attempt.answer
  }
}
