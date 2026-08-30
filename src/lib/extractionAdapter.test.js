// The provider adapter — #203 AC 1, AC 2, AC 3, AC 6, AC 8.
//
// Every transport here is injected, and every provider response is a FIXTURE
// IN THE PROVIDER'S DOCUMENTED WIRE SHAPE — constructed, not captured, because
// capturing one takes the paid key no session holds. That limit is stated
// rather than implied (cairn: a fake cannot disagree with its author): if the
// live envelope differs from the documented shape, these tests cannot see it.
// What closes that loop is #206, whose live run records real envelopes into a
// transcript and replays them through this same adapter — the first live run
// is the test of these fixtures as much as of the model.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADAPTER_OUTCOMES,
  DEFAULT_CONFIGS,
  DEFAULT_PROMPT,
  attemptExtraction,
  buildRequest,
  createExtractor,
  userMessage,
} from './extractionAdapter.js'
import { entitiesOf, gradeItem, normalizeEntity } from './extraction.js'
import { CORPUS } from './extraction.corpus.js'

/** Strip comments, so prose about a hazard is not read as the hazard. */
const codeOf = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const ADAPTER_SOURCE = readFileSync(resolve(process.cwd(), 'src/lib/extractionAdapter.js'), 'utf8')

/** A config that shares nothing with the defaults, so a test passing on it
 * cannot be passing on a module constant. */
const CONFIG = Object.freeze({
  label: 'fixture-config',
  model: 'claude-fixture-model',
  prompt: 'answer as a single JSON object.',
})

/** A Messages API response envelope, in the documented wire shape. */
function envelope(text, extra = {}) {
  return {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model: 'claude-fixture-model',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
    ...extra,
  }
}

const ok = (body) => async () => ({ status: 200, body })

// The six recorded provider responses AC 2 names, one per row. The capacity
// answer is the corpus's own first item's expected answer, so the grader
// integration test below can score it without a matcher written for the test.
const RECORDED = {
  capacity: ok(envelope(JSON.stringify({ kind: 'capacity', minutesByPerson: { 'Alex': 300, 'Robin': 180 } }))),
  chores: ok(
    envelope(
      JSON.stringify({
        kind: 'chores',
        chores: [
          { title: 'clean the bathroom', expectedMinutes: 30 },
          { title: 'take the bins out', expectedMinutes: 5, dueDate: 'Tuesday' },
        ],
      }),
    ),
  ),
  // Prose containing no number: the model's right answer is a refusal.
  refusal: ok(envelope(JSON.stringify({ kind: 'refusal', reason: 'no quantity is stated anywhere in the text' }))),
  // A body that is not the contract: the model wrote prose despite the prompt.
  unparseable: ok(envelope('sure - it sounds like the bathroom needs about half an hour of work.')),
  // The provider's own error envelope, on a non-200 status.
  httpError: async () => ({
    status: 529,
    body: { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
  }),
  // A timeout is recorded as the thrown name AbortSignal.timeout produces.
  timeout: async () => {
    const error = new Error('the operation was aborted due to timeout')
    error.name = 'TimeoutError'
    return Promise.reject(error)
  },
}

const INPUT = { kind: 'capacity', text: 'Alex has five hours this week and Robin has three.' }

describe('#203 AC 2 — each recorded response maps to a distinct named outcome', () => {
  it.each([
    ['capacity', ADAPTER_OUTCOMES.CAPACITY],
    ['chores', ADAPTER_OUTCOMES.CHORES],
    ['refusal', ADAPTER_OUTCOMES.REFUSAL],
    ['unparseable', ADAPTER_OUTCOMES.UNPARSEABLE],
    ['httpError', ADAPTER_OUTCOMES.HTTP_ERROR],
    ['timeout', ADAPTER_OUTCOMES.TIMEOUT],
  ])('the recorded %s response is named %s', async (fixture, outcome) => {
    const kind = fixture === 'chores' ? 'chores' : 'capacity'
    const attempt = await attemptExtraction(CONFIG, RECORDED[fixture], { kind, text: INPUT.text })
    expect(attempt.outcome).toBe(outcome)
  })

  it('and the six outcomes are six, not one generic failure wearing labels', () => {
    const named = [
      ADAPTER_OUTCOMES.CAPACITY,
      ADAPTER_OUTCOMES.CHORES,
      ADAPTER_OUTCOMES.REFUSAL,
      ADAPTER_OUTCOMES.UNPARSEABLE,
      ADAPTER_OUTCOMES.HTTP_ERROR,
      ADAPTER_OUTCOMES.TIMEOUT,
    ]
    expect(new Set(named).size).toBe(6)
  })

  it('a transport that throws something other than a timeout is its own outcome too', async () => {
    const attempt = await attemptExtraction(
      CONFIG,
      async () => Promise.reject(new Error('socket hung up')),
      INPUT,
    )
    expect(attempt.outcome).toBe(ADAPTER_OUTCOMES.TRANSPORT_ERROR)
    expect(attempt.detail).toContain('socket hung up')
  })

  it('the http-error detail names the status and the provider message, for the tally line', async () => {
    const attempt = await attemptExtraction(CONFIG, RECORDED.httpError, INPUT)
    expect(attempt.detail).toContain('529')
    expect(attempt.detail).toContain('overloaded')
  })
})

describe('#203 AC 1 — the extractor returns one of the three documented shapes, always', () => {
  // Asserted through entitiesOf and normalizeEntity — the corpus's own
  // machinery — never through a matcher written for this test. A Map coming
  // back is the grader itself vouching that the shape is the contract's.
  it('a capacity answer parses through entitiesOf under the corpus normaliser', async () => {
    const answer = await createExtractor(CONFIG, RECORDED.capacity)(INPUT)
    const entities = entitiesOf(answer, 'capacity')
    expect(entities).toBeInstanceOf(Map)
    expect(entities.get(normalizeEntity('Alex'))).toBe(300)
    expect(entities.get(normalizeEntity('Robin'))).toBe(180)
  })

  it('a chores answer parses through entitiesOf, stated due date included', async () => {
    const answer = await createExtractor(CONFIG, RECORDED.chores)({ kind: 'chores', text: 'x' })
    const entities = entitiesOf(answer, 'chores')
    expect(entities).toBeInstanceOf(Map)
    expect(entities.get(normalizeEntity('clean the bathroom'))).toBe(30)
    expect(answer.chores.find((chore) => chore.title === 'take the bins out').dueDate).toBe('Tuesday')
  })

  it('a refusal is the contract refusal shape, reason and all', async () => {
    const answer = await createExtractor(CONFIG, RECORDED.refusal)(INPUT)
    expect(answer.kind).toBe('refusal')
    expect(typeof answer.reason).toBe('string')
    expect(answer.reason.length).toBeGreaterThan(0)
  })

  it.each(['unparseable', 'httpError', 'timeout'])(
    'a %s failure still arrives at the grader as a refusal naming its outcome',
    async (fixture) => {
      const answer = await createExtractor(CONFIG, RECORDED[fixture])(INPUT)
      expect(answer.kind).toBe('refusal')
      const attempt = await attemptExtraction(CONFIG, RECORDED[fixture], INPUT)
      expect(answer.reason).toContain(attempt.outcome)
    },
  )

  it('end to end: the recorded capacity answer scores within tolerance on the corpus item it answers', async () => {
    // The corpus's own first capacity item, graded by the corpus's own grader.
    // This is the whole pipe — adapter out, gradeItem in — with nothing
    // test-local deciding what counts as right.
    const item = CORPUS.find((candidate) => candidate.text === INPUT.text)
    expect(item, 'the corpus no longer carries the item this fixture answers').toBeTruthy()
    const answer = await createExtractor(CONFIG, RECORDED.capacity)(INPUT)
    expect(gradeItem(item, answer).outcome).toBe('within-tolerance')
  })

  it('an answer whose kind the contract does not name is unparseable, not passed through', async () => {
    const attempt = await attemptExtraction(
      CONFIG,
      ok(envelope(JSON.stringify({ kind: 'banana', minutesByPerson: {} }))),
      INPUT,
    )
    expect(attempt.outcome).toBe(ADAPTER_OUTCOMES.UNPARSEABLE)
    expect(attempt.answer.kind).toBe('refusal')
  })
})

describe('#203 — parsing tolerates exactly what a real model produces', () => {
  it('skips thinking blocks and reads the text block', async () => {
    const body = envelope('ignored')
    body.content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify({ kind: 'refusal', reason: 'r' }) },
    ]
    const attempt = await attemptExtraction(CONFIG, ok(body), INPUT)
    expect(attempt.outcome).toBe(ADAPTER_OUTCOMES.REFUSAL)
  })

  it('accepts one code fence around the object, and nothing cleverer', async () => {
    const fenced = '```json\n' + JSON.stringify({ kind: 'capacity', minutesByPerson: { 'Sam': 30 } }) + '\n```'
    const attempt = await attemptExtraction(CONFIG, ok(envelope(fenced)), INPUT)
    expect(attempt.outcome).toBe(ADAPTER_OUTCOMES.CAPACITY)
  })

  it('a provider safety refusal (200, stop_reason refusal) is a refusal, not a parse error', async () => {
    const body = envelope('')
    body.content = []
    body.stop_reason = 'refusal'
    body.stop_details = { type: 'refusal', category: 'other' }
    const attempt = await attemptExtraction(CONFIG, ok(body), INPUT)
    expect(attempt.outcome).toBe(ADAPTER_OUTCOMES.REFUSAL)
  })

  it('a 200 whose body is not an envelope at all is unparseable', async () => {
    const attempt = await attemptExtraction(CONFIG, ok('<html>a gateway page</html>'), INPUT)
    expect(attempt.outcome).toBe(ADAPTER_OUTCOMES.UNPARSEABLE)
  })
})

describe('#203 AC 3 — the prompt and the model are parameters, not module constants', () => {
  function capturing(responses) {
    const requests = []
    const transport = async (request) => {
      requests.push(request)
      return { status: 200, body: envelope(JSON.stringify({ kind: 'refusal', reason: 'r' })) }
    }
    return { requests, transport, responses }
  }

  it('the request carries the config model and the config prompt, verbatim', async () => {
    const { requests, transport } = capturing()
    await createExtractor({ ...CONFIG, model: 'model-a', prompt: 'prompt text a' }, transport)(INPUT)
    await createExtractor({ ...CONFIG, model: 'model-b', prompt: 'prompt text b' }, transport)(INPUT)
    expect(requests.map((request) => request.model)).toEqual(['model-a', 'model-b'])
    expect(requests.map((request) => request.system)).toEqual(['prompt text a', 'prompt text b'])
  })

  it('the user message is the deterministic kind-and-description form', () => {
    const request = buildRequest(CONFIG, { kind: 'chores', text: 'mow the lawn takes an hour.' })
    expect(request.messages).toEqual([
      { role: 'user', content: 'input kind: chores\ndescription: mow the lawn takes an hour.' },
    ])
    expect(userMessage({ kind: 'chores', text: 'x' })).toBe('input kind: chores\ndescription: x')
  })

  it('effort is sent only when the config carries one, because not every model takes it', () => {
    const withEffort = buildRequest({ ...CONFIG, effort: 'low' }, INPUT)
    const without = buildRequest(CONFIG, INPUT)
    expect(withEffort.output_config).toEqual({ effort: 'low' })
    expect(without).not.toHaveProperty('output_config')
  })

  it('ships two default configurations sharing the default prompt, distinctly labelled', () => {
    expect(DEFAULT_CONFIGS).toHaveLength(2)
    const labels = DEFAULT_CONFIGS.map((config) => config.label)
    expect(new Set(labels).size).toBe(2)
    for (const config of DEFAULT_CONFIGS) {
      expect(config.prompt).toBe(DEFAULT_PROMPT)
      expect(config.model).toBeTruthy()
    }
  })

  it('the default prompt states the two product rules the corpus grades against', () => {
    // Not a wording pin — the prompt is free to be rewritten. What must
    // survive any rewrite is the pair of decisions #202's filing gate took:
    // a date is copied as stated and never invented, and refusal beats
    // guessing. A prompt that dropped either would grade well on nothing.
    expect(DEFAULT_PROMPT).toMatch(/EXACTLY as the text states it/i)
    expect(DEFAULT_PROMPT).toMatch(/Never invent one/i)
    expect(DEFAULT_PROMPT).toMatch(/Refuse rather than guess/i)
  })
})

describe('#203 AC 6 — the adapter can run where CI runs: no network, no account, no credential', () => {
  it('imports nothing at all, so the no-network wall has no transitive holes', () => {
    const imports = [...ADAPTER_SOURCE.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual([])
  })

  it('never calls out and never reads the environment, by any of the names that would have', () => {
    const code = codeOf(ADAPTER_SOURCE)
    for (const name of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'process.env', 'import.meta.env', 'import(']) {
      expect(code, `the adapter names ${name}`).not.toContain(name)
    }
  })

  it('POSITIVE CONTROL: the call scan can find a call when there is one', () => {
    expect(codeOf("const r = await fetch('https://example.invalid')")).toContain('fetch(')
  })

  it('this file is matched by none of the exclusion patterns in vite.config.js', () => {
    // The suite that proves the adapter is only proof while npm test runs it.
    const config = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8')
    const patterns = [...config.matchAll(/'\*\*\/(\*[^']+)'/g)].map((m) => m[1])
    expect(patterns.length).toBeGreaterThan(1)
    for (const pattern of patterns) {
      const suffix = pattern.replace(/^\*/, '')
      expect('extractionAdapter.test.js'.endsWith(suffix), `excluded by ${pattern}`).toBe(false)
    }
  })
})

describe('#203 AC 8 — the corpus report cannot be taken down by deleting the adapter', () => {
  // The instrument must be independent of the thing it measures: a stop
  // verdict deletes the adapter and the floor and ceiling must still grade.
  // The experiment itself — adapter moved aside, report run — was performed at
  // verification; this is the property that keeps it true, pinned on source.
  it('the report script imports the grader, the corpus and the formatter — and nothing else', () => {
    const report = readFileSync(resolve(process.cwd(), 'scripts/extraction-corpus-report.mjs'), 'utf8')
    const imports = [...report.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual([
      '../src/lib/extraction.corpus.js',
      '../src/lib/extraction.js',
      './extraction-report-format.mjs',
    ])
  })

  it('POSITIVE CONTROL: the import scan sees the adapter where it IS imported', () => {
    const runner = readFileSync(resolve(process.cwd(), 'scripts/extraction-run.mjs'), 'utf8')
    expect(runner).toMatch(/from '\.\.\/src\/lib\/extractionAdapter\.js'/)
  })
})
