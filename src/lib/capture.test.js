import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The capture layer — story #210.
//
// Both halves in one file. The PURE half (`proposeCapacity`) is exercised
// against RECORDED endpoint responses — AC 5 — and the IMPURE half
// (`extractCapacity`) against an injected transport, so each of the three
// failure outcomes AC 2 names is forced on its own with no network, no
// service and no credential.
//
// WHERE THE FIXTURES COME FROM. Every response marked RECORDED is the parsed
// answer text of a real model call in docs/extraction-run-2026-08-31.transcript.json
// (#206), keyed by the corpus description that produced it, with the model and
// the elapsed time noted. The endpoint (#208) returns exactly the contract
// shape the adapter parsed those into, so a parsed recorded answer IS a
// recorded endpoint response. The ones marked SYNTHETIC are shapes no recorded
// call produced — an out-of-range number, an empty map — written in the
// contract's own shape so the validation has something to refuse.
//
// Names are the corpus cast and the placeholder roster — see #19.

const invoke = vi.fn()

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => ({ functions: { invoke: (...args) => invoke(...args) } }),
}))

const {
  CAPTURE_OUTCOMES,
  CLIENT_WAIT_MS,
  EXTRACTION_FUNCTION,
  extractCapacity,
  isFirstPerson,
  proposeCapacity,
} = await import('./capture.js')
const { DEPLOYED_LATENCY_BUDGET_MS, KILL_CONDITIONS } = await import('./extractionThresholds.js')
const { MAX_CAPACITY_MINUTES, MIN_CAPACITY_MINUTES, capacitiesFor } = await import('./capacity.js')
const { allocate } = await import('./allocation.js')

// RECORDED — claude-opus-5 effort-low, 2275 ms:
//   "Alex has five hours this week and Robin has three."
const TWO_PEOPLE = { kind: 'capacity', minutesByPerson: { Alex: 300, Robin: 180 } }
// RECORDED — claude-opus-5 effort-low, 1984 ms: "Sam only has half an hour this week."
const ONE_PERSON = { kind: 'capacity', minutesByPerson: { Sam: 30 } }
// RECORDED — claude-opus-5 effort-low, 2030 ms:
//   "Sam is away all week so nothing from Sam, and Alex has four hours."
const WITH_ZERO = { kind: 'capacity', minutesByPerson: { Sam: 0, Alex: 240 } }
// RECORDED — claude-opus-5 effort-low, 3060 ms: "everyone is pretty busy this week."
// Prose containing no number at all: the model refused rather than invented.
const REFUSAL_NO_NUMBER = {
  kind: 'refusal',
  reason: 'The message gives no specific times or people, only a vague statement of busyness.',
}
// RECORDED — claude-haiku-4-5, 1125 ms: "Sam has about the same as last week."
const REFUSAL_NO_BASELINE = {
  kind: 'refusal',
  reason: "The message references last week's capacity but does not state what that baseline was.",
}
// RECORDED IN FORM — the adapter's own refusal-with-prefix for the five Opus
// answers it could not parse (extraction-run.md, "the failure the headline
// hides"); the prefix is `ADAPTER_OUTCOMES.UNPARSEABLE`.
const WIRE_FAILURE = { kind: 'refusal', reason: 'unparseable-response: answer text is not a JSON object' }
// SYNTHETIC — no recorded call produced a figure outside the range, an empty
// map, or a fraction, so these are written in the contract's shape.
const TOO_MANY = { kind: 'capacity', minutesByPerson: { Alex: MAX_CAPACITY_MINUTES + 1 } }
const NEGATIVE = { kind: 'capacity', minutesByPerson: { Alex: -30 } }
const FRACTION = { kind: 'capacity', minutesByPerson: { Alex: 90.5 } }
const NOBODY = { kind: 'capacity', minutesByPerson: {} }
const FIRST_PERSON = { kind: 'capacity', minutesByPerson: { me: 180 } }

const ALEX = { id: 'm1', display_name: 'Alex', weekly_minutes: 300 }
const ROBIN = { id: 'm2', display_name: 'Robin', weekly_minutes: 120 }
const SAM = { id: 'm3', display_name: 'Sam', weekly_minutes: 60 }
const ROSTER = [ALEX, ROBIN, SAM]

afterEach(() => {
  invoke.mockReset()
  vi.useRealTimers()
})

describe('proposeCapacity — the pure half, against recorded responses (AC 5)', () => {
  it('proposes the named member’s figure, and says what it was read from (AC 1)', () => {
    expect(proposeCapacity(TWO_PEOPLE, { member: ALEX, members: ROSTER })).toEqual({
      outcome: CAPTURE_OUTCOMES.PROPOSAL,
      minutes: 300,
      derivedFrom: { who: 'Alex', minutes: 300 },
    })
    expect(proposeCapacity(TWO_PEOPLE, { member: ROBIN, members: ROSTER })).toMatchObject({
      outcome: CAPTURE_OUTCOMES.PROPOSAL,
      minutes: 180,
      derivedFrom: { who: 'Robin' },
    })
  })

  it('a zero is a proposal, not an absence — the case capacity most exists for', () => {
    expect(proposeCapacity(WITH_ZERO, { member: SAM, members: ROSTER })).toMatchObject({
      outcome: CAPTURE_OUTCOMES.PROPOSAL,
      minutes: 0,
    })
  })

  it('matches the member under the grader’s own key, so case and spacing do not defeat it', () => {
    const spelledOddly = { ...ALEX, display_name: '  alex ' }
    expect(proposeCapacity(ONE_PERSON, { member: SAM, members: ROSTER })).toMatchObject({ minutes: 30 })
    expect(proposeCapacity(TWO_PEOPLE, { member: spelledOddly, members: ROSTER })).toMatchObject({
      minutes: 300,
    })
  })

  it('a single entry is this member’s however the text spelled them', () => {
    // "I have three hours" comes back keyed as the model chose; there is
    // nobody else it could be about.
    expect(proposeCapacity(FIRST_PERSON, { member: ALEX, members: ROSTER })).toEqual({
      outcome: CAPTURE_OUTCOMES.PROPOSAL,
      minutes: 180,
      derivedFrom: { who: 'me', minutes: 180 },
    })
  })

  it('a first-person key beside a NAME is still this member’s — "I have three hours, Robin has two"', () => {
    // SYNTHETIC in the contract's shape; the first version classified this
    // as describing two other people (review-fanout, 2026-09-04).
    const result = proposeCapacity(
      { kind: 'capacity', minutesByPerson: { I: 180, Robin: 120 } },
      { member: ALEX, members: ROSTER },
    )
    expect(result).toEqual({
      outcome: CAPTURE_OUTCOMES.PROPOSAL,
      minutes: 180,
      derivedFrom: { who: 'I', minutes: 180 },
    })
  })

  it('the member’s NAME beats a first-person key when an answer carries both', () => {
    const result = proposeCapacity(
      { kind: 'capacity', minutesByPerson: { me: 100, Alex: 300 } },
      { member: ALEX, members: ROSTER },
    )
    expect(result).toMatchObject({ outcome: CAPTURE_OUTCOMES.PROPOSAL, minutes: 300 })
  })

  it('a figure keyed by nobody — an empty or blank name — is unusable, as the grader would refuse it', () => {
    for (const map of [{ '': 180 }, { '  ': 180 }, { ' ': 100, Robin: 30 }]) {
      const result = proposeCapacity({ kind: 'capacity', minutesByPerson: map }, { member: ALEX, members: ROSTER })
      expect(result.outcome).toBe(CAPTURE_OUTCOMES.UNUSABLE)
      expect(result.sentence).toMatch(/nobody’s name/)
    }
  })

  it('a single entry naming ANOTHER roster member is a question, not their figure on this row', () => {
    const result = proposeCapacity(ONE_PERSON, { member: ALEX, members: ROSTER })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.QUESTION)
    expect(result.sentence).toMatch(/Sam/)
    expect(result.sentence).toMatch(/not you/)
    expect(result.minutes).toBeUndefined()
  })

  it('an answer that names other people and not this member is a question', () => {
    const result = proposeCapacity(TWO_PEOPLE, { member: SAM, members: ROSTER })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.QUESTION)
    expect(result.sentence).toMatch(/Alex, Robin/)
  })

  it('a recorded refusal asks a question carrying the endpoint’s reason (AC 4)', () => {
    for (const refusal of [REFUSAL_NO_NUMBER, REFUSAL_NO_BASELINE]) {
      const result = proposeCapacity(refusal, { member: SAM, members: ROSTER })
      expect(result.outcome).toBe(CAPTURE_OUTCOMES.QUESTION)
      expect(result.sentence).toContain(refusal.reason)
      expect(result.minutes, 'a question must never carry a number').toBeUndefined()
    }
  })

  it('AC 4: a refusal and a malformed answer produce DIFFERENT sentences', () => {
    // A confident wrong number and a wide one damage trust differently, so the
    // two must not be told apart only by which button appears.
    const refused = proposeCapacity(REFUSAL_NO_NUMBER, { member: SAM, members: ROSTER })
    const malformed = proposeCapacity({ kind: 'capacity', minutesByPerson: 'nope' }, { member: SAM })
    expect(refused.outcome).toBe(CAPTURE_OUTCOMES.QUESTION)
    expect(malformed.outcome).toBe(CAPTURE_OUTCOMES.UNUSABLE)
    expect(refused.sentence).not.toBe(malformed.sentence)
    expect(refused.sentence).toMatch(/One more detail/)
    expect(malformed.sentence).toMatch(/did not come back as a minutes figure/)
  })

  it('the adapter’s wire-failure refusal is a FAILURE, not a question to answer', () => {
    const result = proposeCapacity(WIRE_FAILURE, { member: SAM, members: ROSTER })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.FAILED)
    expect(result.sentence).toContain('unparseable-response')
  })

  it('an out-of-range number is unusable, and the sentence names the bound', () => {
    const result = proposeCapacity(TOO_MANY, { member: ALEX, members: ROSTER })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.UNUSABLE)
    expect(result.sentence).toContain(String(MAX_CAPACITY_MINUTES))
    expect(proposeCapacity(NEGATIVE, { member: ALEX })).toMatchObject({
      outcome: CAPTURE_OUTCOMES.UNUSABLE,
    })
    expect(proposeCapacity(FRACTION, { member: ALEX })).toMatchObject({
      outcome: CAPTURE_OUTCOMES.UNUSABLE,
    })
  })

  it('a figure for nobody is unusable', () => {
    expect(proposeCapacity(NOBODY, { member: ALEX })).toMatchObject({
      outcome: CAPTURE_OUTCOMES.UNUSABLE,
    })
  })

  it('anything that is not the contract is unusable, and never throws', () => {
    for (const junk of [
      null,
      undefined,
      'three hours',
      42,
      [],
      { kind: 'chores', chores: [] },
      { kind: 'capacity' },
      { kind: 'capacity', minutesByPerson: [] },
      { kind: 'capacity', minutesByPerson: { Alex: '300' } },
      { kind: 'somethingelse' },
    ]) {
      expect(proposeCapacity(junk, { member: ALEX, members: ROSTER })).toMatchObject({
        outcome: CAPTURE_OUTCOMES.UNUSABLE,
      })
    }
  })

  it('knows which keys mean the writer, so the roster can drop a provenance line that repeats the headline', () => {
    for (const who of ['me', 'ME', ' I ', 'myself', 'my']) expect(isFirstPerson(who)).toBe(true)
    for (const who of ['Alex', 'Robin', '', undefined, 'meg']) expect(isFirstPerson(who)).toBe(false)
  })

  it('PROPERTY: no figure outside the range, or not a whole number, ever becomes a proposal — for any member, under any key', () => {
    // The first version of this test walked the RECORDED fixtures, every one
    // of which is already in range, so the three guards it named never
    // decided it (review-fanout, 2026-09-04). These maps are SYNTHETIC and
    // every one of them must be refused whichever attribution rule reaches it:
    // the member's own name, a first-person key, a lone unknown key.
    const bad = [MAX_CAPACITY_MINUTES + 1, MIN_CAPACITY_MINUTES - 1, 90.5, 1e9, -0.5]
    for (const minutes of bad) {
      for (const member of ROSTER) {
        for (const who of [member.display_name, 'me', 'somebody']) {
          const result = proposeCapacity(
            { kind: 'capacity', minutesByPerson: { [who]: minutes } },
            { member, members: ROSTER },
          )
          expect(result.outcome, `${who}: ${minutes} for ${member.display_name}`).toBe(
            CAPTURE_OUTCOMES.UNUSABLE,
          )
        }
      }
    }
    // And the boundary values themselves ARE proposals, so the guards sit at
    // the range and not inside it.
    for (const minutes of [MIN_CAPACITY_MINUTES, MAX_CAPACITY_MINUTES]) {
      expect(
        proposeCapacity({ kind: 'capacity', minutesByPerson: { me: minutes } }, { member: ALEX }),
      ).toMatchObject({ outcome: CAPTURE_OUTCOMES.PROPOSAL, minutes })
    }
  })
})

describe('extractCapacity — the impure half, with the transport injected (AC 2)', () => {
  const input = { householdId: 'h1', text: '  Sam only has half an hour this week. ', member: SAM, members: ROSTER }

  it('names the function through the client, with the household, the kind and the trimmed text', async () => {
    invoke.mockResolvedValue({ data: ONE_PERSON, error: null })
    const result = await extractCapacity(input)
    expect(result).toMatchObject({ outcome: CAPTURE_OUTCOMES.PROPOSAL, minutes: 30 })
    expect(invoke).toHaveBeenCalledTimes(1)
    const [name, options] = invoke.mock.calls[0]
    expect(name).toBe(EXTRACTION_FUNCTION)
    expect(options.body).toEqual({
      householdId: 'h1',
      kind: 'capacity',
      text: 'Sam only has half an hour this week.',
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('FAILURE 1 — the function refuses: its own sentence, not the SDK’s', async () => {
    // #112's lesson, the same as fetchBusyWeek: the SDK says "non-2xx" and
    // names nothing; the handler says what is wrong.
    const transport = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'You are not a member of that household.' }) },
      },
    })
    const result = await extractCapacity(input, { invoke: transport })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.FAILED)
    expect(result.sentence).toBe('You are not a member of that household.')
  })

  it('FAILURE 1, before #209 deploys it — the gateway 404 through the SDK’s REAL error class, reading the body’s own sentence', async () => {
    // MEASURED shape, not modelled: a first version of this test faked the
    // 404 as a `FunctionsFetchError` with a throwing `json()`, a combination
    // the SDK cannot emit (review-fanout, 2026-09-04). The gateway answers a
    // real HTTP 404 with a JSON body keyed `message`, and supabase-js wraps
    // that as `FunctionsHttpError` whose `context` IS the Response. So the
    // transport here is the real client over a stubbed fetch, and the
    // assertion is the sentence a member would read before the deploy.
    const { createClient } = await import('@supabase/supabase-js')
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 404, message: 'Requested function was not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = createClient('https://placeholder.supabase.co', 'placeholder-anon-key', {
      global: { fetch: fetchImpl },
    })
    const transport = (options) => client.functions.invoke(EXTRACTION_FUNCTION, options)
    const result = await extractCapacity(input, { invoke: transport })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toContain(`/functions/v1/${EXTRACTION_FUNCTION}`)
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.FAILED)
    expect(result.sentence).toBe('Requested function was not found')
    expect(result.sentence, 'the naming-nothing SDK sentence #112 exists to avoid').not.toMatch(/non-2xx/)
  })

  it('FAILURE 1 — only when there is no body at all does the SDK’s own sentence stand', async () => {
    const transport = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'Failed to send a request to the Edge Function',
        context: {
          json: async () => {
            throw new SyntaxError('not json')
          },
        },
      },
    })
    const result = await extractCapacity(input, { invoke: transport })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.FAILED)
    expect(result.sentence).toMatch(/Failed to send a request/)
  })

  it('FAILURE 1 — a transport that throws is a failure, not an unhandled rejection', async () => {
    const transport = vi.fn().mockRejectedValue(new TypeError('network down'))
    const result = await extractCapacity(input, { invoke: transport })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.FAILED)
    expect(result.sentence).toMatch(/network down/)
  })

  it('FAILURE 2 — no answer inside the budget is a timeout, timed by the kill number', async () => {
    vi.useFakeTimers()
    let signal
    const transport = vi.fn((options) => {
      signal = options.signal
      return new Promise(() => {})
    })
    let settled = null
    const pending = extractCapacity(input, { invoke: transport }).then((r) => {
      settled = r
      return r
    })

    await vi.advanceTimersByTimeAsync(CLIENT_WAIT_MS - 1)
    expect(settled, 'gave up before the wait was spent').toBeNull()
    expect(signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const result = await pending
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.TIMEOUT)
    expect(result.sentence).toContain(`${Math.round(CLIENT_WAIT_MS / 1000)} seconds`)
    expect(signal.aborted, 'the request the member gave up on must be cancelled').toBe(true)
  })

  it('FAILURE 2 — the budget is the argument, so a shorter one times out sooner', async () => {
    vi.useFakeTimers()
    const transport = vi.fn(() => new Promise(() => {}))
    const pending = extractCapacity(input, { invoke: transport, budgetMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    expect((await pending).outcome).toBe(CAPTURE_OUTCOMES.TIMEOUT)
  })

  it('FAILURE 3 — an answer that does not parse to a figure in range is unusable, over a healthy wire', async () => {
    for (const body of [TOO_MANY, NOBODY, 'not even json', { kind: 'chores', chores: [] }]) {
      const transport = vi.fn().mockResolvedValue({ data: body, error: null })
      const result = await extractCapacity({ ...input, member: ALEX }, { invoke: transport })
      expect(result.outcome).toBe(CAPTURE_OUTCOMES.UNUSABLE)
    }
  })

  it('a recorded refusal over a healthy wire is a question', async () => {
    const transport = vi.fn().mockResolvedValue({ data: REFUSAL_NO_NUMBER, error: null })
    const result = await extractCapacity(input, { invoke: transport })
    expect(result.outcome).toBe(CAPTURE_OUTCOMES.QUESTION)
  })

  it('refuses to ask without a household or a description, before any request', async () => {
    const transport = vi.fn()
    await expect(extractCapacity({ ...input, householdId: null }, { invoke: transport })).rejects.toThrow(
      /Which household/,
    )
    await expect(extractCapacity({ ...input, text: '   ' }, { invoke: transport })).rejects.toThrow(
      /Describe your week/,
    )
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('the wait is one named constant, derived from the kill number and read rather than restated (AC 2)', () => {
  it('is twice the deployed-path latency kill number the thresholds module carries — not the kill number itself', () => {
    // A p95 ceiling is not an abort: one answer in twenty is expected to
    // exceed it when the bet PASSES, and one recorded fixture in this file
    // (REFUSAL_NO_NUMBER, 3060 ms) already does. Owner decision 2026-09-04.
    const latency = KILL_CONDITIONS.find((axis) => axis.key === 'latency')
    expect(latency.thresholds.all).toBe(DEPLOYED_LATENCY_BUDGET_MS)
    expect(CLIENT_WAIT_MS).toBe(2 * DEPLOYED_LATENCY_BUDGET_MS)
    expect(CLIENT_WAIT_MS).toBeGreaterThan(3060)
  })

  it('capture.js writes no millisecond literal of its own', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capture.js'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(code).not.toMatch(/\b3000\b|\b6000\b/)
    expect(code).toMatch(/CLIENT_WAIT_MS/)
    expect(code, 'the kill number is the verdict’s, not this flow’s').not.toMatch(/DEPLOYED_LATENCY_BUDGET_MS/)
  })
})

describe('AC 5 — the layer needs no live service and no credential', () => {
  it('imports exactly the modules it is allowed to, and names no transport of its own', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capture.js'), 'utf8')
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort()
    expect(imports).toEqual(
      [
        './supabase.js',
        './capacity.js',
        './extraction.js',
        './extractionAdapter.js',
        './extractionThresholds.js',
      ].sort(),
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const forbidden of [/fetch\(/, /XMLHttpRequest/, /https:\/\//, /authorization/i, /apikey/i]) {
      expect(code, `capture.js reaches for ${forbidden}`).not.toMatch(forbidden)
    }
  })
})

describe('AC 6 — a proposed and a typed capacity are indistinguishable to the allocator', () => {
  const PERIOD = '2026-08-10'
  const members = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300 },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 120 },
  ]
  const chores = [
    { id: 'c1', expectedMinutes: 90 },
    { id: 'c2', expectedMinutes: 60 },
    { id: 'c3', expectedMinutes: 30 },
  ]
  const override = (source, minutes = 60) => [
    { id: 'cap1', member_id: 'm1', period_start: PERIOD, minutes, source },
  ]

  it('flipping ONLY the source leaves the capacities and the allocation unchanged', () => {
    const typed = capacitiesFor(members, override('manual'), PERIOD)
    const proposed = capacitiesFor(members, override('extraction'), PERIOD)
    expect(proposed).toEqual(typed)
    expect(allocate({ members: proposed, chores })).toEqual(allocate({ members: typed, chores }))
  })

  it('POSITIVE CONTROL: flipping the MINUTES does change the allocation, so the equality above is not vacuous', () => {
    const sixty = allocate({ members: capacitiesFor(members, override('manual', 60), PERIOD), chores })
    const full = allocate({ members: capacitiesFor(members, override('manual', 300), PERIOD), chores })
    expect(sixty).not.toEqual(full)
  })
})
