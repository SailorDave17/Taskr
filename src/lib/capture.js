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
// in production. `scripts/deploy-function.mjs` carried the name as PENDING so
// a bare `npm run deploy:function` did not try to deploy a directory that was
// not there; #208 wrote the function (2026-09-07) and moved the name into the
// deployable list. `LIVE_EDGE_FUNCTIONS` carries it as invoked, so
// `check:live` reads one honest red until the deploy lands. The endpoint
// defaults the SPEAKER to the caller's own roster name (#207's third contract
// gap) and accepts a `speaker` in the body; this flow does not send one yet,
// which is #210's to decide.
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
//
// THE CHORE HALF — story #213
//
// `proposeChores(response, { todayIso })` is the same shape for the other
// input kind: a pure function from a recorded `kind: 'chores'` response to an
// outcome whose proposal is a LIST of draft rows rather than one figure (#213
// AC 8). `extractChores` is its impure half. The two kinds share ONE endpoint
// call — `askEndpoint`, below — so the wait, the abort, the failure sentences
// and the gateway-body reading exist once; a second copy of that machinery
// would be a second place for the fallback to rot (#213 AC 3's reason, one
// layer down from the shell it names).
//
// A proposed row is the FORM's strings, not normalised values — the same
// shape `ChoreDraftList` takes from the batch panel (#220) — and every row is
// validated here by the data layer's OWN normalisers rather than by rules
// restated beside them (#213 AC 4, AC 7): `normalizeTitle`'s 80 characters,
// `normalizeExpectedMinutes`' bounds, and `normalizeDueDate` against today —
// the one the grader uses, imported from the leaf it lives in. A row that
// fails arrives marked with that normaliser's own sentence and cannot be
// confirmed as it stands; the member edits it in place.
//
// Two rulings from #207's verdict land here rather than in the component:
//
//   - `expectedMinutes: 0` is an EMPTY field, never a value to accept. The
//     model answers 0 for a chore whose sentence stated no duration — seven
//     times in twelve cold sentences — and a chore at zero minutes is free
//     work that makes the split read level while one person does all of it.
//     The owner ruled that zero an honest blank, and that ruling is what puts
//     the chore correction rate at 29.6% rather than 55.6%; it holds only if a
//     member never has to treat the zero as a number they proposed.
//   - a stated due date the normaliser refuses — `every week`, `once a week`,
//     eleven of twelve cold sentences — is an empty date field carrying the
//     phrase in its sentence, so the member sees what was read and picks a
//     day. The contract carries `repeat` and `assignee` since #208, and both
//     are shown in the row's derivation line and written nowhere: the row the
//     batch write takes has no field for either, and inventing a schedule
//     from a phrase is the extractor's job, not this layer's.

import { getSupabase } from './supabase.js'
import { MAX_CAPACITY_MINUTES, MIN_CAPACITY_MINUTES } from './capacity.js'
import { normalizeExpectedMinutes, normalizeTitle } from './chores.js'
import { normalizeDueDate } from './dueDates.js'
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

/**
 * Ends a sentence the endpoint wrote, whatever punctuation it chose. Exported
 * since #213 for the shell, which sets a failure sentence beside the manual
 * hint — a gateway body or a thrown error carries no full stop, and the
 * prototype read "network down Type them in below instead". The sentences
 * themselves are kept verbatim (a #210 test asserts the gateway's own words).
 */
export function sentenceOf(reason) {
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

// ---------------------------------------------------------------------------
// The chore half — #213
// ---------------------------------------------------------------------------

/** The first sentence a normaliser refuses `value` with, or null. */
function complaintOf(normalise, value) {
  try {
    normalise(value)
    return null
  } catch (error) {
    return error.message
  }
}

/**
 * One sentence saying what a proposed row was read from — #213 AC 1's "what
 * it was derived from", in this module so the chore flow and any later
 * reader share one voice. The stated forms are quoted VERBATIM: the member is
 * being shown what the model read, not what this layer made of it, and the
 * unparsed date phrase is the thing they most need to see when the date field
 * beside it is empty.
 */
export function describeDerivation(derivedFrom) {
  if (!derivedFrom) return ''
  const parts = [`“${derivedFrom.title}”`]
  parts.push(
    derivedFrom.expectedMinutes >= 1 ? `${derivedFrom.expectedMinutes} min` : 'no time stated',
  )
  parts.push(derivedFrom.dueDate ? `due “${derivedFrom.dueDate}”` : 'no date stated')
  if (derivedFrom.repeat) parts.push(`repeats “${derivedFrom.repeat}”`)
  if (derivedFrom.assignee) parts.push(`for ${derivedFrom.assignee}`)
  return `Read as ${parts.join(', ')}.`
}

/**
 * Is `answer` a `kind: 'chores'` response of the contract's shape? The same
 * type rules the grader's `entitiesOf` applies — one rule per field, refusing
 * a wrong TYPE and nothing else — stated here rather than borrowed, because
 * the grader also refuses two chores of one title (its oracle keys on the
 * title) and a member who described the dishes twice should see two rows to
 * prune, not an unusable answer.
 */
function isChoresShape(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false
  if (answer.kind !== 'chores' || !Array.isArray(answer.chores)) return false
  return answer.chores.every(
    (chore) =>
      chore &&
      typeof chore === 'object' &&
      !Array.isArray(chore) &&
      typeof chore.title === 'string' &&
      Number.isFinite(chore.expectedMinutes) &&
      ['dueDate', 'repeat', 'assignee'].every(
        (field) => chore[field] === undefined || chore[field] === null || typeof chore[field] === 'string',
      ),
  )
}

/**
 * The outcome of one endpoint response for a chore description — the pure
 * half (#213 AC 8).
 *
 * @param {unknown} response what the endpoint answered
 * @param {{todayIso: string}} context today on the household's calendar,
 *   `YYYY-MM-DD` — the reference a stated date is resolved against, exactly
 *   as the grader resolves the corpus's against `DUE_REFERENCE`. Required
 *   whenever the answer states a date at all, and refused when missing
 *   rather than defaulted: "tomorrow" resolved against the wrong zone is the
 *   fault dueDates.js exists to keep out.
 *
 * A PROPOSAL carries `rows`, one per chore the answer named, each in the shape
 * `ChoreDraftList` renders and the batch write consumes — `{ key, title,
 * minutes, dueOn, problem, note, derivedFrom }`, the first four the form's
 * strings. A row's `problem` is the FIRST normaliser complaint in the order
 * the form's own validator checks them (title, minutes, date), or null; the
 * component re-runs the same validators on confirm, so a row that arrives
 * marked cannot be written until the member has changed it (AC 5, AC 7).
 *
 * An answer naming NO chores is a question, not a proposal of nothing: the
 * box stays and the member is asked to say what needs doing (AC 8's "prose
 * describing no chores at all"). A refusal is a question carrying the
 * endpoint's reason, a wire failure is a failure, and anything that is not
 * the contract is unusable — the same three classifications the capacity
 * half makes, with the sentences naming a list rather than a figure.
 */
export function proposeChores(response, { todayIso } = {}) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return unusable('That did not come back as a list of chores.')
  }

  if (response.kind === 'refusal') {
    const reason = String(response.reason ?? '')
    if (WIRE_FAILURE_PREFIXES.some((prefix) => reason.startsWith(prefix))) {
      return failed(`The extraction service could not answer (${reason}).`)
    }
    return question(
      `One more detail is needed. ${sentenceOf(reason) || 'Say what needs doing and how long each one takes.'}`,
    )
  }

  if (!isChoresShape(response)) {
    return unusable('That did not come back as a list of chores.')
  }

  if (response.chores.length === 0) {
    return question('No chores were found in that. Say what needs doing, and how long each one takes.')
  }

  const rows = response.chores.map((chore, index) => {
    const title = chore.title.trim()
    const derivedFrom = {
      title: chore.title,
      expectedMinutes: chore.expectedMinutes,
      dueDate: typeof chore.dueDate === 'string' && chore.dueDate.trim() ? chore.dueDate.trim() : null,
      repeat: typeof chore.repeat === 'string' && chore.repeat.trim() ? chore.repeat.trim() : null,
      assignee: typeof chore.assignee === 'string' && chore.assignee.trim() ? chore.assignee.trim() : null,
    }

    // #207 ruling 2: below the floor is a BLANK — the field is empty and the
    // complaint is the normaliser's own empty-field question, not "0 is too
    // few". Above the ceiling the figure stays in the field so the member
    // can split it, with the normaliser's own sentence beside it.
    const minutes =
      Number.isInteger(chore.expectedMinutes) && chore.expectedMinutes >= 1
        ? String(chore.expectedMinutes)
        : ''

    let dueOn = ''
    let dateProblem = null
    if (derivedFrom.dueDate) {
      try {
        dueOn = normalizeDueDate(derivedFrom.dueDate, todayIso)
      } catch {
        // `normalizeDueDate` throws for a phrase it will not resolve AND for a
        // missing reference; the member's sentence is the same either way,
        // and the phrase is quoted so they see what was read (AC 8's
        // "unparseable date", distinct from AC 5's "no date").
        dateProblem = `Could not read “${derivedFrom.dueDate}” as a date — pick one.`
      }
    }

    const problem =
      complaintOf(normalizeTitle, title) ??
      complaintOf(normalizeExpectedMinutes, minutes) ??
      dateProblem ??
      complaintOf(normalizeDueDate, dueOn)

    return {
      key: `proposed-${index + 1}`,
      title,
      minutes,
      dueOn,
      problem,
      note: describeDerivation(derivedFrom),
      derivedFrom,
    }
  })

  return { outcome: CAPTURE_OUTCOMES.PROPOSAL, rows }
}

// ---------------------------------------------------------------------------
// The endpoint call, shared by both kinds
// ---------------------------------------------------------------------------

/** `functions.invoke` against the real client; the injectable's default. */
function defaultInvoke(options) {
  return getSupabase().functions.invoke(EXTRACTION_FUNCTION, options)
}

/**
 * Send one description to the endpoint and either hand back its answer or
 * the FAILURE outcome that stands in for one — the transport half both
 * `extractCapacity` and `extractChores` share.
 *
 * @param {{householdId: string, kind: 'capacity'|'chores', text: string, speaker?: string}} request
 * @param {{budgetMs?: number, invoke?: (options: object) => Promise<{data: unknown, error: unknown}>}} [deps]
 *   `invoke` is the transport, injectable so the tests force each failure
 *   outcome without a network; `budgetMs` defaults to the kill number and is
 *   overridable so a test can prove the budget is what times the wait out,
 *   not something else.
 * @returns {Promise<{failure: object} | {data: unknown}>}
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
 * `{ code, message }` — which is what a 404 looked like before #209 deployed
 * the function, and is measured through the SDK's real error class in
 * capture.test.js rather than modelled (review-fanout, 2026-09-04: the first
 * fixture was a shape the SDK cannot emit). Only when there is no body at all
 * does the SDK's own message stand.
 *
 * The SPEAKER is #207's third contract gap: the endpoint names nobody when it
 * is omitted, so this is the line that tells the model who "I" is. Sent only
 * when it is a name — an empty string would be a speaker line with nothing
 * after it — and which name is the caller's business: the capacity flow sends
 * the ROW's, the chore flow the person typing.
 */
async function askEndpoint(
  { householdId, kind, text, speaker },
  { budgetMs = CLIENT_WAIT_MS, invoke = defaultInvoke } = {},
) {
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

  const who = String(speaker ?? '').trim()
  let result
  try {
    result = await Promise.race([
      invoke({
        body: { householdId, kind, text, ...(who ? { speaker: who } : {}) },
        signal: controller.signal,
      }),
      budget,
    ])
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return {
        failure: {
          outcome: CAPTURE_OUTCOMES.TIMEOUT,
          sentence: `No answer came back within ${Math.round(budgetMs / 1000)} seconds.`,
        },
      }
    }
    return {
      failure: failed(`The extraction service could not be reached: ${String(error?.message ?? error)}`),
    }
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
    return {
      failure: failed(
        detail ? String(detail) : `The extraction service could not answer: ${result.error.message}`,
      ),
    }
  }

  return { data: result?.data }
}

/**
 * Describe a week to the endpoint and classify the answer — the impure half.
 *
 * @param {{householdId: string, text: string, member: object, members?: Array<object>}} input
 * @param {{budgetMs?: number, invoke?: Function}} [deps] see `askEndpoint`
 *
 * The speaker is the ROW this description is for — the owner's call at #208's
 * review escalation (2026-09-07). The row's name rather than the caller's,
 * because an organizer can type on another member's row and
 * `proposeCapacity`'s first rule then attributes the figure by this name.
 */
export async function extractCapacity({ householdId, text, member, members = [] }, deps) {
  if (!householdId) throw new Error('Which household? A description must name one.')
  const description = String(text ?? '').trim()
  if (!description) throw new Error('Describe your week first.')

  const asked = await askEndpoint(
    { householdId, kind: 'capacity', text: description, speaker: member?.display_name },
    deps,
  )
  if (asked.failure) return asked.failure
  return proposeCapacity(asked.data, { member, members })
}

/**
 * Describe the week's chores to the endpoint and classify the answer — the
 * chore flow's impure half (#213).
 *
 * @param {{householdId: string, text: string, todayIso: string, speaker?: string}} input
 *   `todayIso` is today on the household's calendar, the reference every
 *   stated date resolves against; `speaker` is the person TYPING — there is
 *   no row here, and "I'll do the bins" is theirs — sent so the endpoint can
 *   name an assignee rather than an "I" no roster row matches.
 * @param {{budgetMs?: number, invoke?: Function}} [deps] see `askEndpoint`
 */
export async function extractChores({ householdId, text, todayIso, speaker }, deps) {
  if (!householdId) throw new Error('Which household? A description must name one.')
  const description = String(text ?? '').trim()
  if (!description) throw new Error('Say what needs doing first.')

  const asked = await askEndpoint({ householdId, kind: 'chores', text: description, speaker }, deps)
  if (asked.failure) return asked.failure
  return proposeChores(asked.data, { todayIso })
}
