import { beforeEach, describe, expect, it, vi } from 'vitest'

// The re-assignment orchestrator's IMPURE half, exercised against a fake
// Supabase client — the same division chores.io.test.js and
// capacity.io.test.js state: the planner's arithmetic is reassign.test.js, the
// database's rules are src/test/reassignment.pglite.test.js, and this file
// covers the part neither can — which reads happen, in which order, what the
// RPC is handed, and what a version refusal makes the orchestrator do.
//
// What this does NOT test, and cannot: whether the RPC actually refuses a
// stale version. A fake client returns whatever this file tells it to; the
// CAS lives in Postgres and is exercised by the pglite suite.
//
// Names are synthetic — see #19.

const calls = []
let results = {}
let rpcResults = []

/** Chainable, thenable stand-in for supabase-js's query builder. */
function makeQuery(table) {
  const result = () => results[table] ?? { data: null, error: null }
  const q = {
    select(cols) {
      calls.push({ op: 'select', table, cols })
      return q
    },
    eq(column, value) {
      calls.push({ op: 'eq', table, column, value })
      return q
    },
    in(column, value) {
      calls.push({ op: 'in', table, column, value })
      return q
    },
    order(column, opts) {
      calls.push({ op: 'order', table, column, ascending: opts?.ascending })
      return q
    },
    single: () => Promise.resolve(result()),
    then: (onOk, onErr) => Promise.resolve(result()).then(onOk, onErr),
  }
  return q
}

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => ({
    from: (table) => makeQuery(table),
    rpc: (name, args) => {
      calls.push({ op: 'rpc', name, args })
      return Promise.resolve(rpcResults.shift() ?? { data: null, error: null })
    },
  }),
}))

const { reassignHousehold, REASSIGN_MAX_ATTEMPTS } = await import('./reassign.js')

const household = {
  id: 'hh-1',
  timezone: 'UTC',
  assignments_version: 7,
  last_rebalance: null,
}

function seedHappyReads() {
  results = {
    households: { data: household, error: null },
    members: { data: [{ id: 'm-1', weekly_minutes: 100, display_name: 'alex' }], error: null },
    chores: {
      data: [
        {
          id: 'c-1',
          expected_minutes: 30,
          assigned_member_id: null,
          assigned_source: null,
          completed_at: null,
          actual_minutes: null,
        },
      ],
      error: null,
    },
    member_capacity: { data: [], error: null },
    chore_exclusions: { data: [], error: null },
  }
}

beforeEach(() => {
  calls.length = 0
  rpcResults = []
  seedHappyReads()
})

describe('reassignHousehold', () => {
  it('refuses to run without a household id', async () => {
    await expect(reassignHousehold({ householdId: null })).rejects.toThrow(/name one/)
    expect(calls).toEqual([])
  })

  it('reads the version FIRST, then every allocator input, then applies', async () => {
    rpcResults = [{ data: { applied: 1, assignments_version: 12 }, error: null }]

    const outcome = await reassignHousehold({ householdId: 'hh-1' })

    // The household (carrying the version) must be the first read — the
    // ordering the module's header calls load-bearing: read the version after
    // the inputs and a write landing between them is silently accepted.
    const tables = calls.filter((c) => c.op === 'select').map((c) => c.table)
    expect(tables[0]).toBe('households')
    expect(tables).toEqual(
      expect.arrayContaining(['households', 'members', 'chores', 'member_capacity', 'chore_exclusions']),
    )

    const rpc = calls.find((c) => c.op === 'rpc')
    expect(rpc.name).toBe('apply_assignments')
    expect(rpc.args.household_id).toBe('hh-1')
    // The version handed to the CAS is the one that was read, verbatim.
    expect(rpc.args.expected_version).toBe(7)
    expect(rpc.args.placements).toEqual([{ chore_id: 'c-1', member_id: 'm-1' }])
    expect(rpc.args.verdict).toMatchObject({ level: expect.any(Boolean) })

    expect(outcome).toEqual({ applied: 1, assignments_version: 12 })
  })

  it('re-reads and recomputes when the RPC refuses the version (TA049)', async () => {
    rpcResults = [
      { data: null, error: { code: 'TA049', message: 'the household changed' } },
      { data: { applied: 1, assignments_version: 15 }, error: null },
    ]

    const outcome = await reassignHousehold({ householdId: 'hh-1' })

    const rpcs = calls.filter((c) => c.op === 'rpc')
    expect(rpcs).toHaveLength(2)
    // A retry is a FULL fresh cycle, not a resend: the household is re-read
    // before the second apply, so the recomputation sees what moved it.
    const householdReads = calls.filter((c) => c.op === 'select' && c.table === 'households')
    expect(householdReads).toHaveLength(2)
    expect(outcome).toEqual({ applied: 1, assignments_version: 15 })
  })

  it('gives up after bounded attempts, surfacing the refusal', async () => {
    rpcResults = Array.from({ length: REASSIGN_MAX_ATTEMPTS }, () => ({
      data: null,
      error: { code: 'TA049', message: 'the household changed' },
    }))

    await expect(reassignHousehold({ householdId: 'hh-1' })).rejects.toThrow(/household changed/)
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(REASSIGN_MAX_ATTEMPTS)
  })

  it('does not retry an error that is not the version refusal', async () => {
    rpcResults = [{ data: null, error: { code: '42501', message: 'permission denied' } }]

    await expect(reassignHousehold({ householdId: 'hh-1' })).rejects.toThrow(/permission denied/)
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(1)
  })

  it('surfaces a failed read rather than applying from half a picture', async () => {
    results.chores = { data: null, error: { message: 'network down' } }

    await expect(reassignHousehold({ householdId: 'hh-1' })).rejects.toThrow(/network down/)
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(0)
  })
})
