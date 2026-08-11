import { beforeEach, describe, expect, it, vi } from 'vitest'

// The capacity data layer's IMPURE half, exercised against a fake Supabase client.
//
// This file exists for the same reason chores.io.test.js does, and it is the
// second instance of the same gap: `listCapacity`, `setCapacity` and
// `clearCapacity` shipped with #44 and were tested at NO LEVEL until #46 gave
// them a caller. capacity.test.js covers only the pure half (the period
// boundary, effectiveCapacity, capacitiesFor, the normalizer);
// capacity.pglite.test.js issues raw SQL without ever importing the module; and
// App.test.jsx now stubs all three.
//
// A mutation pass could not have found that — mutation proves the tests you have
// can fail and says nothing about code no test reaches
// (cairn: a-mutation-cannot-see-what-no-test-reaches).
//
// What this does NOT test, and cannot: the access rules or the check
// constraints. A fake client returns whatever this file tells it to, so it can
// neither refuse nor enforce a range. Those live in Postgres and are exercised
// by src/test/capacity.pglite.test.js. Same division household.js and chores.js
// state.
//
// Names are synthetic — see #19.

const calls = []
let results = {}

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
    upsert(row, options) {
      calls.push({ op: 'upsert', table, row, options })
      return q
    },
    delete() {
      calls.push({ op: 'delete', table })
      return q
    },
    single: () => Promise.resolve(result()),
    then: (onOk, onErr) => Promise.resolve(result()).then(onOk, onErr),
  }
  return q
}

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => ({ from: (table) => makeQuery(table) }),
}))

const currentHousehold = vi.fn()
vi.mock('./household.js', async () => {
  const actual = await vi.importActual('./household.js')
  return { ...actual, currentHousehold: (...a) => currentHousehold(...a) }
})

const {
  CAPACITY_COLUMNS,
  capacitiesFor,
  clearCapacity,
  effectiveCapacity,
  listCapacity,
  setCapacity,
} = await import('./capacity.js')

const HOUSEHOLD = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
const MONDAY = '2026-08-10'
const ROW = {
  id: 'cap1',
  member_id: 'm1',
  period_start: MONDAY,
  minutes: 120,
  note: null,
  source: 'manual',
  created_at: '2026-08-10T00:00:00Z',
}

const opsOn = (table) => calls.filter((c) => c.table === table)

beforeEach(() => {
  calls.length = 0
  results = {}
  currentHousehold.mockReset()
  currentHousehold.mockResolvedValue(HOUSEHOLD)
})

describe('listCapacity', () => {
  it('reads only this period, and only the granted columns', async () => {
    results.member_capacity = { data: [ROW], error: null }
    const rows = await listCapacity(MONDAY)

    expect(rows).toEqual([ROW])
    const select = opsOn('member_capacity').find((c) => c.op === 'select')
    // `select('*')` FAILS on this table — household_id is withheld from the
    // grant — so the explicit list is load-bearing rather than tidy.
    expect(select.cols).toBe(CAPACITY_COLUMNS)
    expect(select.cols).not.toContain('*')
    expect(opsOn('member_capacity')).toContainEqual(
      expect.objectContaining({ op: 'eq', column: 'period_start', value: MONDAY }),
    )
  })

  it('returns an empty list rather than null when nobody has said anything', async () => {
    results.member_capacity = { data: null, error: null }
    // A null here would reach capacitiesFor and throw on .filter, blanking the
    // screen for the most common state there is: a week nobody has adjusted.
    expect(await listCapacity(MONDAY)).toEqual([])
  })

  it('reports a refusal with what we were doing', async () => {
    results.member_capacity = { data: null, error: { message: 'permission denied' } }
    await expect(listCapacity(MONDAY)).rejects.toThrow(/loading this week/i)
  })
})

describe('setCapacity', () => {
  it('upserts on (member_id, period_start), because a second entry is a correction', async () => {
    results.member_capacity = { data: ROW, error: null }
    await setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: 120 })

    const upsert = opsOn('member_capacity').find((c) => c.op === 'upsert')
    expect(upsert.row).toMatchObject({
      household_id: 'h1',
      member_id: 'm1',
      period_start: MONDAY,
      minutes: 120,
      source: 'manual',
    })
    // The client half of 0005's unique constraint. Without onConflict this is an
    // insert that fails the second time somebody corrects their week — which is
    // the ordinary case, not an edge one.
    expect(upsert.options).toEqual({ onConflict: 'member_id,period_start' })
  })

  it('defaults source to manual, so the extraction path stays distinguishable', async () => {
    results.member_capacity = { data: ROW, error: null }
    await setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: 120 })
    const upsert = opsOn('member_capacity').find((c) => c.op === 'upsert')
    // #43 and #58 can only judge extraction accuracy if the data says where a
    // number came from. A default of 'extraction' would silently inflate it.
    expect(upsert.row.source).toBe('manual')
  })

  it('refuses a value the column would refuse, BEFORE any request is sent', async () => {
    results.member_capacity = { data: ROW, error: null }
    await expect(setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: -1 })).rejects.toThrow(
      /cannot be negative/i,
    )
    await expect(
      setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: 10081 }),
    ).rejects.toThrow(/more than a week/i)
    // The point of "before": a rejected value must not reach the network at all.
    expect(opsOn('member_capacity')).toHaveLength(0)
  })

  it('accepts zero, which is the case the feature most exists for', async () => {
    results.member_capacity = { data: { ...ROW, minutes: 0 }, error: null }
    await setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: 0 })
    const upsert = opsOn('member_capacity').find((c) => c.op === 'upsert')
    // "I have no time this week" is a real statement and distinct from having no
    // row. A falsy-check anywhere on this path would turn it into the latter.
    expect(upsert.row.minutes).toBe(0)
  })

  it('will not write into a household this device has not joined', async () => {
    currentHousehold.mockResolvedValue(null)
    await expect(
      setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: 120 }),
    ).rejects.toThrow(/not signed in to a household/i)
    expect(opsOn('member_capacity')).toHaveLength(0)
  })

  it('reports a refusal with what we were doing', async () => {
    results.member_capacity = { data: null, error: { message: 'violates check constraint' } }
    await expect(
      setCapacity({ memberId: 'm1', periodStart: MONDAY, minutes: 120 }),
    ).rejects.toThrow(/saving this week.*violates check constraint/i)
  })
})

describe('clearCapacity', () => {
  it('deletes the row for that person and that week only', async () => {
    results.member_capacity = { data: null, error: null }
    await clearCapacity('m1', MONDAY)

    const ops = opsOn('member_capacity')
    expect(ops).toContainEqual(expect.objectContaining({ op: 'delete' }))
    // BOTH filters. Either one alone would clear more than was asked: without
    // period_start it removes every week that person ever recorded, and without
    // member_id it removes the whole household's week.
    expect(ops).toContainEqual(
      expect.objectContaining({ op: 'eq', column: 'member_id', value: 'm1' }),
    )
    expect(ops).toContainEqual(
      expect.objectContaining({ op: 'eq', column: 'period_start', value: MONDAY }),
    )
  })

  it('reports a refusal with what we were doing', async () => {
    results.member_capacity = { data: null, error: { message: 'permission denied' } }
    await expect(clearCapacity('m1', MONDAY)).rejects.toThrow(/clearing this week/i)
  })
})

describe('#46 AC 1 — a second client reads back the effective capacity', () => {
  it('set 120 against a 300 baseline, and a fresh read resolves 120', async () => {
    const member = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300 }

    results.member_capacity = { data: ROW, error: null }
    await setCapacity({ memberId: member.id, periodStart: MONDAY, minutes: 120 })

    // "A second client constructed against the same backend": a separate read,
    // resolved through the same single definition the allocator and the chore
    // screen use, rather than by inspecting the row this file just wrote.
    results.member_capacity = { data: [ROW], error: null }
    const overrides = await listCapacity(MONDAY)

    expect(effectiveCapacity(member, overrides.find((o) => o.member_id === member.id))).toBe(120)
    expect(capacitiesFor([member], overrides, MONDAY)).toEqual([
      { id: 'm1', capacityMinutes: 120 },
    ])
    // And the baseline is untouched — the override is a delta, not a rewrite.
    // The database half of this is asserted in capacity.pglite.test.js; here it
    // is about the module never mutating the row it was handed.
    expect(member.weekly_minutes).toBe(300)
  })

  it('AC 2: an override for the PREVIOUS period leaves the baseline standing', async () => {
    const member = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300 }
    results.member_capacity = { data: [{ ...ROW, period_start: '2026-08-03' }], error: null }
    const overrides = await listCapacity(MONDAY)

    // listCapacity queries by period, so this row should not have come back at
    // all — the fake returns it anyway, which is the point: capacitiesFor
    // filters again rather than trusting the caller, so an override applied to
    // the wrong week is impossible rather than merely unlikely.
    expect(capacitiesFor([member], overrides, MONDAY)).toEqual([
      { id: 'm1', capacityMinutes: 300 },
    ])
  })
})
