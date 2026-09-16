import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIVE_SCHEMA, LIVE_TABLES } from './liveSchema.js'
import {
  REFRESH_DEBOUNCE_MS,
  UNWATCHED_TABLES,
  WATCHED_TABLES,
  WATCHED_TABLE_NAMES,
  attachVisibilityRefresh,
  changeBindingsFor,
  channelNameFor,
  createReadQueue,
  describePublicationError,
  probePublication,
  reconnectDetector,
  subscribeToHousehold,
} from './realtime.js'

// #342. Names are synthetic — see #19. Ids are uuids because the server parses
// them out of a filter string, and the module refuses anything else.
const HOUSEHOLD = '11111111-1111-4111-8111-111111111111'
const MEMBER_A = '22222222-2222-4222-8222-222222222222'
const MEMBER_B = '33333333-3333-4333-8333-333333333333'

const columnsOf = (table) => {
  const { columns } = LIVE_SCHEMA.find((e) => e.table === table)
  return columns === '*' ? ['*'] : columns.split(',').map((c) => c.trim())
}

describe('#342 — the watched list is derived from what the client reads', () => {
  it('watches every table the client reads, or names why it does not', () => {
    const unaccounted = LIVE_TABLES.filter(
      (t) => !WATCHED_TABLE_NAMES.includes(t) && !(t in UNWATCHED_TABLES),
    )
    expect(
      unaccounted,
      `read by the client, neither watched nor excused in UNWATCHED_TABLES: ${unaccounted.join(', ')}`,
    ).toEqual([])
  })

  it('watches nothing the client does not read', () => {
    const extra = WATCHED_TABLE_NAMES.filter((t) => !LIVE_TABLES.includes(t))
    expect(extra, `watched but in no LIVE_SCHEMA entry: ${extra.join(', ')}`).toEqual([])
  })

  it('has tables to watch, so an empty pass is impossible', () => {
    // Eleven at #342. A floor against a vacuous pass, not a target.
    expect(WATCHED_TABLE_NAMES.length).toBeGreaterThanOrEqual(11)
    expect(WATCHED_TABLE_NAMES).toContain('chores')
  })

  it('every excused table carries a reason, and the excuses are real tables', () => {
    for (const [table, reason] of Object.entries(UNWATCHED_TABLES)) {
      expect(LIVE_TABLES, `${table} is excused but the client does not read it`).toContain(table)
      expect(reason.length).toBeGreaterThan(20)
    }
    // #172 added the second, for the owner's reason at pickup: `invitations` is
    // read by the organizer's device alone, and publishing it would put the row
    // — `token_hash` among its columns — on a channel with no other reader.
    expect(Object.keys(UNWATCHED_TABLES)).toEqual(['member_split_seen', 'invitations'])
  })

  it('scopes each table by a column its OWN client column list carries', () => {
    // The server refuses a filter on a column the role cannot select
    // ("invalid column for filter"), so the scope has to come from the same
    // string the data layer passes to `.select()` — never from the schema.
    for (const { table, scope } of WATCHED_TABLES) {
      const cols = columnsOf(table)
      if (scope === 'household') expect(cols, table).toContain('household_id')
      if (scope === 'member') {
        expect(cols, table).toContain('member_id')
        expect(cols, table).not.toContain('household_id')
      }
      if (scope === 'rls') {
        expect(cols, table).not.toContain('household_id')
        expect(cols, table).not.toContain('member_id')
      }
      if (scope === 'self') expect(table).toBe('households')
    }
  })

  it('names the scope of every table, so a change of scope is a visible edit', () => {
    const scopes = Object.fromEntries(WATCHED_TABLES.map((w) => [w.table, w.scope]))
    expect(scopes).toEqual({
      households: 'self',
      members: 'household',
      chores: 'household',
      member_capacity: 'member',
      chore_exclusions: 'member',
      calendar_connections: 'member',
      chore_repeat_exceptions: 'rls',
      calendar_busy: 'member',
      shopping_lists: 'household',
      shopping_runs: 'household',
      shopping_items: 'household',
      // #101 — the import ledger is read BY HOUSEHOLD (`0038` grants
      // `household_id`, the shopping tables' route), so its changes are filtered
      // the same way and a delete carries only the id like every other table.
      calendar_imports: 'household',
    })
  })
})

describe('#342 — the bindings one household channel asks the server for', () => {
  const bindings = changeBindingsFor({ householdId: HOUSEHOLD, memberIds: [MEMBER_A, MEMBER_B] })
  const of = (table) => bindings.filter((b) => b.table === table)

  it('filters every household-scoped table to the household, and adds an unfiltered DELETE', () => {
    for (const { table, scope } of WATCHED_TABLES.filter((w) => w.scope === 'household')) {
      expect(of(table), `${table} (${scope})`).toEqual([
        { event: '*', schema: 'public', table, filter: `household_id=eq.${HOUSEHOLD}` },
        { event: 'DELETE', schema: 'public', table },
      ])
    }
  })

  it('filters every member-scoped table to the roster, and adds an unfiltered DELETE', () => {
    for (const { table } of WATCHED_TABLES.filter((w) => w.scope === 'member')) {
      expect(of(table), table).toEqual([
        { event: '*', schema: 'public', table, filter: `member_id=in.(${MEMBER_A},${MEMBER_B})` },
        { event: 'DELETE', schema: 'public', table },
      ])
    }
  })

  it('filters the household row by its own id, with no second binding', () => {
    // The primary key is the one column a delete's old record always carries,
    // so the filtered binding hears the delete too.
    expect(of('households')).toEqual([
      { event: '*', schema: 'public', table: 'households', filter: `id=eq.${HOUSEHOLD}` },
    ])
  })

  it('leaves an rls-scoped table to its policies, one unfiltered binding', () => {
    expect(of('chore_repeat_exceptions')).toEqual([
      { event: '*', schema: 'public', table: 'chore_repeat_exceptions' },
    ])
  })

  it('covers every watched table and nothing else', () => {
    expect(new Set(bindings.map((b) => b.table))).toEqual(new Set(WATCHED_TABLE_NAMES))
  })

  it('every filter names a column the subscriber may select', () => {
    for (const b of bindings.filter((b) => b.filter)) {
      const column = b.filter.split('=')[0]
      const cols = columnsOf(b.table)
      expect(cols.includes(column) || cols[0] === '*', `${b.table}: ${b.filter}`).toBe(true)
    }
  })

  it('with no roster yet, a member-scoped table falls back to its policies', () => {
    const early = changeBindingsFor({ householdId: HOUSEHOLD, memberIds: [] })
    expect(early.filter((b) => b.table === 'member_capacity')).toEqual([
      { event: '*', schema: 'public', table: 'member_capacity' },
    ])
    // And the household-scoped ones are unchanged by the roster.
    expect(early.filter((b) => b.table === 'chores')).toEqual(of('chores'))
  })

  it('refuses an id that is not a uuid, because a filter is a string the server parses', () => {
    expect(() => changeBindingsFor({ householdId: 'abc' })).toThrow(/householdId must be a uuid/)
    expect(() =>
      changeBindingsFor({ householdId: HOUSEHOLD, memberIds: [MEMBER_A, `${MEMBER_B}),x=eq.1`] }),
    ).toThrow(/memberIds must be a uuid/)
    expect(() => channelNameFor('household:1')).toThrow(/householdId must be a uuid/)
  })

  it('names the channel after the household', () => {
    expect(channelNameFor(HOUSEHOLD)).toBe(`household:${HOUSEHOLD}`)
  })
})

describe('#342 — a publication probe is classified, never guessed', () => {
  const refusal =
    'Unable to subscribe to changes with given parameters. Please check Realtime is enabled ' +
    'for the given connect parameters: [event: *, schema: public, table: chores]'

  it('is null only when the server said the subscription took', () => {
    expect(
      describePublicationError('chores', { status: 'PUBLISHED', message: 'Subscribed to PostgreSQL' }),
    ).toBeNull()
  })

  it('does NOT read the acknowledged join as a pass — the server acknowledges any table name', () => {
    // The first draft did, and read 61 of 62 green against an empty publication.
    const line = describePublicationError('chores', { status: 'SUBSCRIBED', message: null })
    expect(line).toContain('chores')
    expect(line).toContain('not a verdict')
  })

  it('names the table, the migration and the command when the table is unpublished', () => {
    const line = describePublicationError('chores', { status: 'CHANNEL_ERROR', message: refusal })
    expect(line).toContain('chores')
    expect(line).toContain('NOT PUBLISHED')
    expect(line).toContain('0037')
    expect(line).toContain('npm run migrate:live')
    expect(line).toContain(refusal)
  })

  it('does NOT blame the migration for a refusal with another reason', () => {
    const line = describePublicationError('chores', {
      status: 'CHANNEL_ERROR',
      message: 'mismatch between server and client bindings for postgres changes',
    })
    expect(line).toContain('chores')
    expect(line).not.toContain('NOT PUBLISHED')
    expect(line).toContain('mismatch between server and client bindings')
  })

  it('reports a timeout as no evidence either way', () => {
    for (const status of ['TIMED_OUT', 'NO_ANSWER']) {
      const line = describePublicationError('chores', { status, message: null })
      expect(line).toContain('chores')
      expect(line).toContain('not evidence')
      expect(line).not.toContain('NOT PUBLISHED')
    }
  })

  it('never returns null for a status it has not seen', () => {
    expect(describePublicationError('chores', { status: 'CLOSED', message: null })).toContain('CLOSED')
  })
})

describe('#342 AC 5 — one read in flight, and a second request schedules exactly one more', () => {
  /** A read whose completion the test controls. */
  function controlledRead() {
    const pending = []
    const read = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject })
        }),
    )
    return { read, pending, settle: (i, value) => pending[i].resolve(value) }
  }

  it('runs a lone request at once and hands back its result', async () => {
    const { read, settle } = controlledRead()
    const queue = createReadQueue(read)
    const p = queue.request()
    expect(read).toHaveBeenCalledTimes(1)
    expect(queue.inFlight).toBe(true)
    settle(0, 'found')
    await expect(p).resolves.toBe('found')
    expect(queue.inFlight).toBe(false)
  })

  it('coalesces every request made during a read into ONE more read after it', async () => {
    const { read, settle } = controlledRead()
    const queue = createReadQueue(read)
    const first = queue.request()
    // An own write's echo, a focus event and a second echo, all mid-read.
    const echo1 = queue.request()
    const focus = queue.request()
    const echo2 = queue.request()
    expect(read).toHaveBeenCalledTimes(1)
    settle(0, 'first')
    await expect(first).resolves.toBe('first')
    // The queued read has started, once, and nothing else.
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    settle(1, 'second')
    await expect(Promise.all([echo1, focus, echo2])).resolves.toEqual(['second', 'second', 'second'])
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('a request that arrives while the queued read is running queues one more again', async () => {
    const { read, settle } = controlledRead()
    const queue = createReadQueue(read)
    const first = queue.request()
    const second = queue.request()
    // MEASURED during the mutation pass: without the two "still N" lines, a
    // queue that ran every request at once passed this test — the counts it
    // asserted after each settle happened to coincide with the uncoalesced
    // timeline. What tells the two apart is the count BEFORE a settle.
    expect(read).toHaveBeenCalledTimes(1)
    settle(0, 1)
    await first
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    const third = queue.request()
    expect(read).toHaveBeenCalledTimes(2)
    settle(1, 2)
    await second
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(3)
    settle(2, 3)
    await expect(third).resolves.toBe(3)
  })

  it('a request after a read has finished is a new read, not a coalesced one', async () => {
    const { read, settle } = controlledRead()
    const queue = createReadQueue(read)
    const first = queue.request()
    settle(0, 'a')
    await first
    const later = queue.request()
    expect(read).toHaveBeenCalledTimes(2)
    settle(1, 'b')
    await expect(later).resolves.toBe('b')
  })

  it('a failed read rejects its requesters and leaves the queue usable', async () => {
    const { read, pending, settle } = controlledRead()
    const queue = createReadQueue(read)
    const first = queue.request()
    const during = queue.request()
    pending[0].reject(new Error('offline'))
    await expect(first).rejects.toThrow('offline')
    // The queued read still runs — a failure is not a reason to drop a request.
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    settle(1, 'back')
    await expect(during).resolves.toBe('back')
    expect(queue.inFlight).toBe(false)
  })
})

describe('#342 AC 3 — a re-join is told from the first join', () => {
  it('is quiet on the first SUBSCRIBED and speaks on every later one', () => {
    const rejoined = reconnectDetector()
    expect(rejoined('SUBSCRIBED')).toBe(false)
    expect(rejoined('CLOSED')).toBe(false)
    expect(rejoined('SUBSCRIBED')).toBe(true)
    expect(rejoined('CHANNEL_ERROR')).toBe(false)
    expect(rejoined('SUBSCRIBED')).toBe(true)
  })

  it('a timeout before the first success is not a re-join either', () => {
    const rejoined = reconnectDetector()
    expect(rejoined('TIMED_OUT')).toBe(false)
    expect(rejoined('SUBSCRIBED')).toBe(false)
    expect(rejoined('SUBSCRIBED')).toBe(true)
  })
})

describe('#342 AC 1 — the visibility read is debounced', () => {
  let visibility
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('a flurry of focus and visibility events is ONE read, after the debounce', () => {
    const onRefresh = vi.fn()
    const detach = attachVisibilityRefresh(onRefresh)
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1)
    expect(onRefresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 4)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    detach()
  })

  it('the window restarts on each event, so the read waits for the flurry to end', () => {
    const onRefresh = vi.fn()
    const detach = attachVisibilityRefresh(onRefresh)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 50)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 50)
    expect(onRefresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    detach()
  })

  it('a tab going HIDDEN reads nothing', () => {
    const onRefresh = vi.fn()
    const detach = attachVisibilityRefresh(onRefresh)
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2)
    expect(onRefresh).not.toHaveBeenCalled()
    detach()
  })

  it('detaching cancels a pending read and stops listening', () => {
    const onRefresh = vi.fn()
    const detach = attachVisibilityRefresh(onRefresh)
    window.dispatchEvent(new Event('focus'))
    detach()
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('the debounce is a short window, not a rate limit', () => {
    expect(REFRESH_DEBOUNCE_MS).toBeGreaterThanOrEqual(100)
    expect(REFRESH_DEBOUNCE_MS).toBeLessThanOrEqual(1000)
  })
})

/**
 * The REAL client over a fake wire — cairn's `a-fake-cannot-disagree-with-its-
 * author`. Everything above the socket is `@supabase/supabase-js` and
 * `@supabase/realtime-js` as shipped: channel naming, the `phx_join` payload,
 * the binding reconciliation, the event dispatch, the reconnect. Only the
 * WebSocket is ours, so what these tests assert is what the server would
 * actually receive and how the client actually reacts to what it sends back —
 * not what this file believes about either.
 */
class FakeSocket {
  static instances = []
  /** Tables the fake server refuses, the way the real one refuses an unpublished table. */
  static unpublished = new Set()

  constructor(url, protocols) {
    this.url = url
    this.protocols = protocols
    this.readyState = 0
    this.sent = []
    this.binaryType = 'arraybuffer'
    FakeSocket.instances.push(this)
    setTimeout(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.onopen?.({})
    }, 0)
  }

  send(raw) {
    const msg = JSON.parse(raw)
    this.sent.push(msg)
    const [joinRef, ref, topic, event, payload] = msg
    const reply = (response) =>
      setTimeout(
        () => this.receive([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]),
        0,
      )
    if (event === 'phx_join') {
      const asked = payload.config.postgres_changes ?? []
      // What the live server does, MEASURED 2026-09-08: the join is
      // acknowledged for any table name, and the verdict follows as a
      // `system` frame for the postgres_changes extension.
      reply({ postgres_changes: asked.map((b, i) => ({ id: i + 1, ...b })) })
      const refused = asked.find((b) => FakeSocket.unpublished.has(b.table))
      const system = refused
        ? {
            status: 'error',
            extension: 'postgres_changes',
            channel: topic.replace(/^realtime:/, ''),
            message:
              'Unable to subscribe to changes with given parameters. Please check Realtime is ' +
              `enabled for the given connect parameters: [event: ${refused.event}, schema: ` +
              `${refused.schema}, table: ${refused.table}, filters: [], select: nil]`,
          }
        : {
            status: 'ok',
            extension: 'postgres_changes',
            channel: topic.replace(/^realtime:/, ''),
            message: 'Subscribed to PostgreSQL',
          }
      if (asked.length) {
        setTimeout(() => this.receive([null, null, topic, 'system', system]), 0)
      }
    } else {
      // heartbeat, access_token, phx_leave
      reply({})
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.({ code, reason, wasClean: true })
  }

  /** Server-side helpers. */
  receive(msg) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: 'dropped', wasClean: false })
  }
  joinFor(topic) {
    return this.sent.find((m) => m[3] === 'phx_join' && m[2] === topic)
  }
}

describe('#342 — the real client over a fake wire', () => {
  let client
  let clients = 0
  beforeEach(() => {
    FakeSocket.instances = []
    FakeSocket.unpublished = new Set()
    client = createClient('http://127.0.0.1:54321', 'sb_publishable_placeholder_key', {
      // A distinct storage key per client, or GoTrue warns about two instances
      // sharing one — noise, but noise that hides a real warning.
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `t${++clients}` },
      realtime: {
        transport: FakeSocket,
        timeout: 2_000,
        heartbeatIntervalMs: 60_000,
        reconnectAfterMs: () => 5,
      },
    })
  })
  afterEach(async () => {
    await client.removeAllChannels()
    client.realtime.disconnect()
  })

  const TOPIC = `realtime:household:${HOUSEHOLD}`

  it('joins one channel per household carrying exactly the derived bindings, and reports SUBSCRIBED', async () => {
    const statuses = []
    const live = subscribeToHousehold(
      { householdId: HOUSEHOLD, memberIds: [MEMBER_A], onStatus: (s) => statuses.push(s) },
      client,
    )
    await vi.waitFor(() => expect(statuses).toContain('SUBSCRIBED'))
    const ws = FakeSocket.instances[0]
    const join = ws.joinFor(TOPIC)
    expect(join, 'no phx_join for the household topic').toBeTruthy()
    // The wire carries the bindings verbatim — the same objects the server
    // stores as one `realtime.subscription` row each.
    expect(join[4].config.postgres_changes).toEqual(
      changeBindingsFor({ householdId: HOUSEHOLD, memberIds: [MEMBER_A] }),
    )
    // The apikey rides the URL, as it does in production.
    expect(ws.url).toContain('apikey=sb_publishable_placeholder_key')
    live.close()
  })

  it('a change the server pushes reaches onChange, INSERT/UPDATE through the filtered binding and DELETE through the unfiltered one', async () => {
    const statuses = []
    const changes = []
    const live = subscribeToHousehold(
      {
        householdId: HOUSEHOLD,
        memberIds: [MEMBER_A],
        onChange: (p) => changes.push(p),
        onStatus: (s) => statuses.push(s),
      },
      client,
    )
    await vi.waitFor(() => expect(statuses).toContain('SUBSCRIBED'))
    const ws = FakeSocket.instances[0]
    const asked = ws.joinFor(TOPIC)[4].config.postgres_changes
    const updateId = asked.findIndex((b) => b.table === 'chores' && b.event === '*') + 1
    const deleteId = asked.findIndex((b) => b.table === 'chores' && b.event === 'DELETE') + 1
    expect(updateId).toBeGreaterThan(0)
    expect(deleteId).toBeGreaterThan(0)

    // The wire's column descriptor is `{ name, type }`; the key is written
    // through a constant because #19's POSITION scan reads any `name: '…'`
    // literal in a test as a person's name.
    const ID_COLUMN = 'id'
    const push = (ids, type, record) =>
      ws.receive([
        null,
        null,
        TOPIC,
        'postgres_changes',
        {
          ids,
          data: {
            schema: 'public',
            table: 'chores',
            type,
            commit_timestamp: '2026-09-08T12:00:00Z',
            columns: [{ name: ID_COLUMN, type: 'uuid' }],
            record: type === 'DELETE' ? null : record,
            old_record: type === 'DELETE' ? record : null,
            errors: null,
          },
        },
      ])
    push([updateId], 'UPDATE', { id: MEMBER_B })
    await vi.waitFor(() => expect(changes).toHaveLength(1))
    expect(changes[0]).toMatchObject({ eventType: 'UPDATE', table: 'chores', new: { id: MEMBER_B } })
    // A delete carries only the id, and arrives on the DELETE binding's id.
    push([deleteId], 'DELETE', { id: MEMBER_B })
    await vi.waitFor(() => expect(changes).toHaveLength(2))
    expect(changes[1]).toMatchObject({ eventType: 'DELETE', table: 'chores', old: { id: MEMBER_B } })
    // An event for a binding this channel does not hold is ignored.
    push([999], 'UPDATE', { id: MEMBER_B })
    await new Promise((r) => setTimeout(r, 20))
    expect(changes).toHaveLength(2)
    live.close()
  })

  it('AC 3 — a dropped socket reconnects, re-joins, and onReconnect fires once', async () => {
    const statuses = []
    let reconnects = 0
    const live = subscribeToHousehold(
      {
        householdId: HOUSEHOLD,
        memberIds: [MEMBER_A],
        onReconnect: () => reconnects++,
        onStatus: (s) => statuses.push(s),
      },
      client,
    )
    await vi.waitFor(() => expect(statuses).toContain('SUBSCRIBED'))
    expect(reconnects).toBe(0)
    FakeSocket.instances[0].drop()
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2))
    await vi.waitFor(() => expect(reconnects).toBe(1))
    expect(FakeSocket.instances[1].joinFor(TOPIC), 'the channel did not re-join').toBeTruthy()
    expect(statuses.filter((s) => s === 'SUBSCRIBED')).toHaveLength(2)
    live.close()
  })

  it('close() leaves the channel', async () => {
    const statuses = []
    const live = subscribeToHousehold(
      { householdId: HOUSEHOLD, memberIds: [], onStatus: (s) => statuses.push(s) },
      client,
    )
    await vi.waitFor(() => expect(statuses).toContain('SUBSCRIBED'))
    await live.close()
    const ws = FakeSocket.instances[0]
    expect(ws.sent.some((m) => m[3] === 'phx_leave' && m[2] === TOPIC)).toBe(true)
    expect(client.getChannels()).toHaveLength(0)
  })

  it('AC 6 — the publication probe reads the system frame: refused is red, subscribed is ok', async () => {
    FakeSocket.unpublished = new Set(['member_split_seen'])
    const ok = await probePublication(client, 'chores')
    expect(ok.status).toBe('PUBLISHED')
    expect(describePublicationError('chores', ok)).toBeNull()
    const refused = await probePublication(client, 'member_split_seen')
    expect(refused.status).toBe('CHANNEL_ERROR')
    expect(refused.message).toContain('Unable to subscribe')
    expect(describePublicationError('member_split_seen', refused)).toContain('NOT PUBLISHED')
    // Both probes removed their channel; nothing is left listening.
    expect(client.getChannels()).toHaveLength(0)
  })

  it('AC 6 — a join that is acknowledged and then followed by silence is NO_ANSWER, not a pass', async () => {
    // The live failure shape: `phx_reply ok`, `SUBSCRIBED`, and no system
    // frame. A transport that acknowledges joins and says nothing more.
    class MuteSocket extends FakeSocket {
      send(raw) {
        const msg = JSON.parse(raw)
        this.sent.push(msg)
        const [joinRef, ref, topic, event, payload] = msg
        const response =
          event === 'phx_join'
            ? { postgres_changes: (payload.config.postgres_changes ?? []).map((b, i) => ({ id: i + 1, ...b })) }
            : {}
        setTimeout(() => this.receive([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]), 0)
      }
    }
    const mute = createClient('http://127.0.0.1:54321', 'sb_publishable_placeholder_key', {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'mute' },
      realtime: { transport: MuteSocket, timeout: 2_000, heartbeatIntervalMs: 60_000 },
    })
    try {
      const verdict = await probePublication(mute, 'chores', { timeoutMs: 300 })
      expect(verdict.status).toBe('NO_ANSWER')
      expect(describePublicationError('chores', verdict)).toContain('not evidence')
    } finally {
      await mute.removeAllChannels()
      mute.realtime.disconnect()
    }
  })

  it('AC 6 — a server that never answers is a timeout, not a pass', async () => {
    // A transport that opens and swallows every join.
    class DeafSocket extends FakeSocket {
      send(raw) {
        this.sent.push(JSON.parse(raw))
      }
    }
    const deaf = createClient('http://127.0.0.1:54321', 'sb_publishable_placeholder_key', {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'deaf' },
      realtime: { transport: DeafSocket, timeout: 50, heartbeatIntervalMs: 60_000 },
    })
    try {
      const verdict = await probePublication(deaf, 'chores', { timeoutMs: 500 })
      expect(['TIMED_OUT', 'NO_ANSWER']).toContain(verdict.status)
      expect(describePublicationError('chores', verdict)).toContain('not evidence')
    } finally {
      await deaf.removeAllChannels()
      deaf.realtime.disconnect()
    }
  })
})
