import { beforeEach, describe, expect, it, vi } from 'vitest'

// The chore data layer's IMPURE half, exercised against a fake Supabase client.
//
// This file exists because review-fanout found that `listChores`, `addChore`,
// `updateChore`, `removeChore` and `unwrap` were tested at NO level:
// chores.test.js covers only the three pure validators, App.test.jsx replaces
// all four with `vi.fn()` stubs, and chores.pglite.test.js issues raw SQL
// without ever importing the module. The mutation pass could not have caught
// that — mutation proves the tests you have can fail, and says nothing about
// code no test reaches.
//
// Separate file from chores.test.js on purpose. That one is pure functions and
// imports nothing; the moment a `vi.mock('./supabase.js')` lands in it, every
// test in the file depends on a fake client it does not use.
//
// What this does NOT test, and cannot: the access rules. A fake client returns
// whatever this file tells it to. The rules live in Postgres and are exercised
// by src/test/chores.pglite.test.js. Same division household.test.js states.
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
    order(column, opts) {
      calls.push({ op: 'order', table, column, ascending: opts?.ascending })
      return q
    },
    eq(column, value) {
      calls.push({ op: 'eq', table, column, value })
      return q
    },
    insert(row) {
      calls.push({ op: 'insert', table, row })
      return q
    },
    update(patch) {
      calls.push({ op: 'update', table, patch })
      return q
    },
    delete() {
      calls.push({ op: 'delete', table })
      return q
    },
    single: () => Promise.resolve(result()),
    maybeSingle: () => Promise.resolve(result()),
    then: (onOk, onErr) => Promise.resolve(result()).then(onOk, onErr),
  }
  return q
}

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => ({ from: (table) => makeQuery(table) }),
}))

// currentHousehold is household.js's, and addChore depends on it. Mocked here
// rather than driven through the fake client, so a failure in this file is
// always about chores.js.
const currentHousehold = vi.fn()
vi.mock('./household.js', async () => {
  const actual = await vi.importActual('./household.js')
  return { ...actual, currentHousehold: (...a) => currentHousehold(...a) }
})

const { CHORE_COLUMNS, addChore, listChores, removeChore, updateChore } = await import('./chores.js')

const HOUSEHOLD = { id: 'h1', name: 'Placeholder Household' }
const ROW = {
  id: 'c1',
  title: 'Dishes',
  expected_minutes: 20,
  due_on: '2026-08-10',
  created_at: '2026-08-08T00:00:00Z',
}

const opsOn = (table) => calls.filter((c) => c.table === table)

beforeEach(() => {
  calls.length = 0
  results = {}
  currentHousehold.mockReset()
  currentHousehold.mockResolvedValue(HOUSEHOLD)
})

describe('listChores', () => {
  it('asks for the granted columns by name, never a wildcard', async () => {
    results.chores = { data: [ROW], error: null }
    await listChores()

    const select = opsOn('chores').find((c) => c.op === 'select')
    expect(select.cols).toBe(CHORE_COLUMNS)
    // A wildcard is not a style preference here: 0003 withholds household_id
    // from the select grant, so `select('*')` fails outright at the server.
    expect(select.cols).not.toContain('*')
  })

  it('orders by due date then creation, so the list does not reshuffle between refreshes', async () => {
    results.chores = { data: [ROW], error: null }
    await listChores()

    const orders = opsOn('chores').filter((c) => c.op === 'order')
    expect(orders.map((o) => o.column)).toEqual(['due_on', 'created_at'])
    expect(orders.every((o) => o.ascending === true)).toBe(true)
  })

  it('returns an empty array when the table is empty, not null', async () => {
    // Supabase answers a no-rows select with data: null. Handing that to the
    // component would crash on .map rather than render an empty list.
    results.chores = { data: null, error: null }
    expect(await listChores()).toEqual([])
  })

  it('throws with what we were doing when the read fails', async () => {
    results.chores = { data: null, error: { message: 'permission denied for table chores' } }
    await expect(listChores()).rejects.toThrow(/loading the chores: permission denied/i)
  })
})

describe('addChore', () => {
  it('writes the normalized values, not the raw form strings', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({ title: '  Dishes  ', expectedMinutes: '20', dueOn: '2026-08-10' })

    const insert = opsOn('chores').find((c) => c.op === 'insert')
    expect(insert.row).toEqual({
      household_id: 'h1',
      title: 'Dishes',
      expected_minutes: 20,
      due_on: '2026-08-10',
    })
    // Written out rather than derived from the input, so the implementation
    // cannot quietly redefine what "normalized" means.
    expect(typeof insert.row.expected_minutes).toBe('number')
  })

  it('takes household_id from this device membership, never from the caller', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({
      title: 'Dishes',
      expectedMinutes: 20,
      dueOn: '2026-08-10',
      household_id: 'somebody-elses-household',
    })

    const insert = opsOn('chores').find((c) => c.op === 'insert')
    expect(insert.row.household_id).toBe('h1')
  })

  it('refuses before any request when the device has joined nothing', async () => {
    currentHousehold.mockResolvedValue(null)
    await expect(addChore({ title: 'Dishes', expectedMinutes: 20, dueOn: '2026-08-10' })).rejects.toThrow(
      /has not joined a household/i,
    )
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('validates before it looks the household up, so a bad value costs no round trip', async () => {
    await expect(addChore({ title: 'Dishes', expectedMinutes: 0, dueOn: '2026-08-10' })).rejects.toThrow(
      /at least a minute/i,
    )
    expect(currentHousehold).not.toHaveBeenCalled()
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('throws with what we were doing when the insert is refused', async () => {
    results.chores = { data: null, error: { message: 'new row violates row-level security policy' } }
    await expect(
      addChore({ title: 'Dishes', expectedMinutes: 20, dueOn: '2026-08-10' }),
    ).rejects.toThrow(/adding the chore: new row violates row-level security/i)
  })
})

describe('updateChore', () => {
  it('sends only the fields it was given', async () => {
    results.chores = { data: ROW, error: null }
    await updateChore('c1', { expectedMinutes: '30' })

    const update = opsOn('chores').find((c) => c.op === 'update')
    expect(update.patch).toEqual({ expected_minutes: 30 })
    expect(opsOn('chores').find((c) => c.op === 'eq')).toMatchObject({ column: 'id', value: 'c1' })
  })

  it('normalizes each field it does send', async () => {
    results.chores = { data: ROW, error: null }
    await updateChore('c1', { title: '  Dishes and counters ', dueOn: '2026-08-11' })

    const update = opsOn('chores').find((c) => c.op === 'update')
    expect(update.patch).toEqual({ title: 'Dishes and counters', due_on: '2026-08-11' })
  })

  it('refuses an empty patch rather than issuing `update chores set`', async () => {
    // Postgres answers that with a syntax error, which unwrap would report as
    // "saving the change: ..." — reading as though the row were rejected.
    await expect(updateChore('c1', {})).rejects.toThrow(/nothing to change/i)
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('refuses a bad value before any request', async () => {
    await expect(updateChore('c1', { expectedMinutes: 1441 })).rejects.toThrow(/smaller chores/i)
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('throws with what we were doing when the update fails', async () => {
    results.chores = { data: null, error: { message: 'permission denied for column household_id' } }
    await expect(updateChore('c1', { title: 'Dishes' })).rejects.toThrow(
      /saving the change: permission denied/i,
    )
  })
})

describe('removeChore', () => {
  it('deletes the row it names', async () => {
    results.chores = { data: null, error: null }
    await removeChore('c1')

    expect(opsOn('chores').some((c) => c.op === 'delete')).toBe(true)
    expect(opsOn('chores').find((c) => c.op === 'eq')).toMatchObject({ column: 'id', value: 'c1' })
  })

  it('throws with what we were doing when the delete fails', async () => {
    results.chores = { data: null, error: { message: 'permission denied for table chores' } }
    await expect(removeChore('c1')).rejects.toThrow(/removing the chore: permission denied/i)
  })
})

describe('unwrap, through its callers', () => {
  it('carries the original error as `cause`, so the Supabase detail is not lost', async () => {
    const original = { message: 'permission denied', code: '42501' }
    results.chores = { data: null, error: original }

    await listChores().then(
      () => expect.unreachable('listChores should have thrown'),
      (err) => {
        expect(err.cause).toBe(original)
        expect(err.message).toContain('loading the chores')
      },
    )
  })
})
