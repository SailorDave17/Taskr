import { beforeEach, describe, expect, it } from 'vitest'

// The shopping data layer's IMPURE half, exercised against a recording fake —
// story #352.
//
// The same division chores.io.test.js states: this file proves WHICH calls the
// module issues and with WHAT — the column constant, the filter, the RPC name
// and its argument object — and it cannot prove the access rules, because a
// fake returns whatever this file tells it to. The rules live in Postgres and
// are exercised by src/test/shopping.pglite.test.js. Neither half is
// sufficient alone.
//
// EVERY RPC IS ASSERTED BY NAME AND BY ARGUMENT OBJECT, and the fake records
// the argument rather than the fact of the call. cairn's
// `a-fake-that-drops-an-argument-makes-two-behaviours-one` is the record of
// what a fake that takes no parameter costs: a month of `signOut()` revoking
// every device's session while a green test asserted that sign-out was called.
// Here the argument object IS the contract — PostgREST resolves an overload by
// the SET of argument names — so a fake that dropped it could not tell
// `create_shopping_list({ household, name })` from a call with the names
// misspelled.
//
// `readShopping` takes the client as a parameter, so no module is mocked: the
// fake is handed in. That is also why there is no `vi.mock` in this file.
//
// Names are synthetic — see #19.

import {
  SHOPPING_ITEM_COLUMNS,
  SHOPPING_LIST_COLUMNS,
  SHOPPING_RUN_COLUMNS,
  addItem,
  createList,
  finishRun,
  normalizeName,
  purchaseItem,
  readShopping,
  removeItem,
  renameList,
  unpurchaseItem,
} from './shopping.js'

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
    in(column, values) {
      calls.push({ op: 'in', table, column, values })
      return q
    },
    is(column, value) {
      calls.push({ op: 'is', table, column, value })
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
    then: (onOk, onErr) => Promise.resolve(result()).then(onOk, onErr),
  }
  return q
}

const client = {
  from: (table) => makeQuery(table),
  rpc: (name, args) => {
    // The ARGUMENT is recorded, not merely the name. See the header.
    calls.push({ op: 'rpc', name, args })
    return Promise.resolve(results[name] ?? { data: null, error: null })
  },
}

const HOUSEHOLD = 'h1'
const LIST = { id: 'l1', household_id: HOUSEHOLD, name: 'Placeholder List', created_at: '2026-09-05T00:00:00Z' }
const RUN = { id: 'r1', list_id: 'l1', household_id: HOUSEHOLD, opened_at: '2026-09-05T00:00:00Z', closed_at: null, closed_by_member_id: null }
const ITEM = { id: 'i1', run_id: 'r1', household_id: HOUSEHOLD, name: 'Placeholder Item', note: null }

const opsOn = (table) => calls.filter((c) => c.table === table)
const rpcs = () => calls.filter((c) => c.op === 'rpc')

beforeEach(() => {
  calls.length = 0
  results = {}
})

describe('the column constants', () => {
  it('name every column 0032 grants, household_id included, and no wildcard', () => {
    for (const cols of [SHOPPING_LIST_COLUMNS, SHOPPING_RUN_COLUMNS, SHOPPING_ITEM_COLUMNS]) {
      expect(cols).not.toContain('*')
      expect(cols.split(',').map((c) => c.trim())).toContain('household_id')
    }
    expect(SHOPPING_LIST_COLUMNS).toBe('id, household_id, name, created_at')
    expect(SHOPPING_RUN_COLUMNS).toBe('id, list_id, household_id, opened_at, closed_at, closed_by_member_id')
    expect(SHOPPING_ITEM_COLUMNS).toBe(
      'id, run_id, household_id, name, note, added_by_member_id, added_at, purchased_at, purchased_by_member_id, carried_from_item_id',
    )
  })
})

describe('readShopping — lists by household, open runs by list, items by run', () => {
  beforeEach(() => {
    results.shopping_lists = { data: [LIST], error: null }
    results.shopping_runs = { data: [RUN], error: null }
    results.shopping_items = { data: [ITEM], error: null }
  })

  it('selects each table with its imported constant, never a wildcard', async () => {
    await readShopping(client, HOUSEHOLD)
    expect(opsOn('shopping_lists').find((c) => c.op === 'select').cols).toBe(SHOPPING_LIST_COLUMNS)
    expect(opsOn('shopping_runs').find((c) => c.op === 'select').cols).toBe(SHOPPING_RUN_COLUMNS)
    expect(opsOn('shopping_items').find((c) => c.op === 'select').cols).toBe(SHOPPING_ITEM_COLUMNS)
    for (const c of calls.filter((c) => c.op === 'select')) expect(c.cols).not.toContain('*')
  })

  it('names the household on the lists read — #159’s rule, not "whatever RLS returns"', async () => {
    await readShopping(client, HOUSEHOLD)
    expect(opsOn('shopping_lists')).toContainEqual(
      expect.objectContaining({ op: 'eq', column: 'household_id', value: HOUSEHOLD }),
    )
  })

  it('reads the OPEN runs by the list ids — `.in` on list_id and `.is` null on closed_at, never an embed', async () => {
    await readShopping(client, HOUSEHOLD)
    const runOps = opsOn('shopping_runs')
    expect(runOps).toContainEqual(expect.objectContaining({ op: 'in', column: 'list_id', values: ['l1'] }))
    expect(runOps).toContainEqual(expect.objectContaining({ op: 'is', column: 'closed_at', value: null }))
    // The predicate is `closed_at is null` — NOT an order-by-opened_at-and-take-
    // the-last, which would come to mean two things once #354 closes runs.
    expect(runOps.find((c) => c.op === 'order')).toBeUndefined()
    // And no select on any table names an embedded resource.
    for (const c of calls.filter((c) => c.op === 'select')) expect(c.cols).not.toMatch(/\(/)
  })

  it('reads the items by the run ids', async () => {
    await readShopping(client, HOUSEHOLD)
    expect(opsOn('shopping_items')).toContainEqual(
      expect.objectContaining({ op: 'in', column: 'run_id', values: ['r1'] }),
    )
  })

  it('orders lists by creation then id, and items by added_at then id, so nothing reshuffles between reads', async () => {
    await readShopping(client, HOUSEHOLD)
    expect(opsOn('shopping_lists').filter((c) => c.op === 'order').map((c) => c.column)).toEqual([
      'created_at',
      'id',
    ])
    expect(opsOn('shopping_items').filter((c) => c.op === 'order').map((c) => c.column)).toEqual([
      'added_at',
      'id',
    ])
  })

  it('returns the three sets under their names', async () => {
    expect(await readShopping(client, HOUSEHOLD)).toEqual({ lists: [LIST], runs: [RUN], items: [ITEM] })
  })

  it('issues the reads in order — lists, then runs, then items — because each names the ids the last returned', async () => {
    await readShopping(client, HOUSEHOLD)
    const tables = calls.filter((c) => c.op === 'select').map((c) => c.table)
    expect(tables).toEqual(['shopping_lists', 'shopping_runs', 'shopping_items'])
  })

  it('with no lists, issues ONE read and returns three empty arrays — not null, and no `.in([])`', async () => {
    results.shopping_lists = { data: [], error: null }
    expect(await readShopping(client, HOUSEHOLD)).toEqual({ lists: [], runs: [], items: [] })
    expect(calls.filter((c) => c.op === 'select').map((c) => c.table)).toEqual(['shopping_lists'])
  })

  it('with lists but no open run, issues TWO reads and returns no items', async () => {
    results.shopping_runs = { data: [], error: null }
    expect(await readShopping(client, HOUSEHOLD)).toEqual({ lists: [LIST], runs: [], items: [] })
    expect(calls.filter((c) => c.op === 'select').map((c) => c.table)).toEqual([
      'shopping_lists',
      'shopping_runs',
    ])
  })

  it('treats a null data as empty rather than crashing on `.map`', async () => {
    results.shopping_lists = { data: null, error: null }
    expect(await readShopping(client, HOUSEHOLD)).toEqual({ lists: [], runs: [], items: [] })
  })

  it('refuses before any request when no household is named', async () => {
    await expect(readShopping(client, undefined)).rejects.toThrow(/Which household/)
    expect(calls).toEqual([])
  })

  it('throws with what we were doing when a read fails, carrying the cause', async () => {
    results.shopping_runs = { data: null, error: { message: 'permission denied', code: '42501' } }
    const failure = await readShopping(client, HOUSEHOLD).catch((e) => e)
    expect(failure.message).toBe('loading shopping runs: permission denied')
    expect(failure.cause).toEqual({ message: 'permission denied', code: '42501' })
  })
})

describe('the writers go through the RPCs, by name AND argument object', () => {
  it('createList calls create_shopping_list with { household, name }, the name trimmed', async () => {
    results.create_shopping_list = { data: LIST, error: null }
    const made = await createList(client, HOUSEHOLD, '  Placeholder List ')
    expect(rpcs()).toEqual([
      { op: 'rpc', name: 'create_shopping_list', args: { household: HOUSEHOLD, name: 'Placeholder List' } },
    ])
    expect(made).toEqual(LIST)
  })

  it('addItem calls add_shopping_item with { run, name, note }, note null when blank, and NO timestamp', async () => {
    results.add_shopping_item = { data: ITEM, error: null }
    await addItem(client, 'r1', ' Placeholder Item ', '   ')
    expect(rpcs()).toEqual([
      { op: 'rpc', name: 'add_shopping_item', args: { run: 'r1', name: 'Placeholder Item', note: null } },
    ])
    // The stamp is the database's: nothing named `added_at`, nothing that looks
    // like a time, is sent.
    expect(Object.keys(rpcs()[0].args)).toEqual(['run', 'name', 'note'])
  })

  it('addItem sends a trimmed note when one is given', async () => {
    await addItem(client, 'r1', 'Placeholder Item', ' two ')
    expect(rpcs()[0].args).toEqual({ run: 'r1', name: 'Placeholder Item', note: 'two' })
  })

  it('purchaseItem and unpurchaseItem each call their own function with { item }', async () => {
    await purchaseItem(client, 'i1')
    await unpurchaseItem(client, 'i1')
    expect(rpcs()).toEqual([
      { op: 'rpc', name: 'purchase_shopping_item', args: { item: 'i1' } },
      { op: 'rpc', name: 'unpurchase_shopping_item', args: { item: 'i1' } },
    ])
  })

  it('#355: both return the STAMPED ROW, which is the whole re-read the tick performs', async () => {
    // Under #355's one-round-trip decision the answer is not a receipt — it is
    // the data the screen redraws from. A version of these that returned
    // nothing would still pass the argument test above and leave the tab
    // showing a row that never changed, so the pass-through is asserted here
    // and the item id is NOT sent back as a stamp: the time and the buyer are
    // the database's, like every stamp since 0004.
    const stamped = { ...ITEM, purchased_at: '2026-09-05T05:00:00Z', purchased_by_member_id: 'm1' }
    results.purchase_shopping_item = { data: stamped, error: null }
    expect(await purchaseItem(client, 'i1')).toEqual(stamped)

    results.unpurchase_shopping_item = { data: ITEM, error: null }
    expect(await unpurchaseItem(client, 'i1')).toEqual(ITEM)

    for (const call of rpcs()) {
      expect(Object.keys(call.args)).toEqual(['item'])
      expect(JSON.stringify(call.args)).not.toMatch(/purchased|member|_at/)
    }
  })

  it('#355: a refused tick carries what we were doing and the cause, so App can show it and re-read', async () => {
    results.purchase_shopping_item = {
      data: null,
      error: { message: 'item already bought', code: 'P0001' },
    }
    const failure = await purchaseItem(client, 'i1').catch((e) => e)
    expect(failure.message).toBe('marking it bought: item already bought')
    expect(failure.cause.code).toBe('P0001')
  })

  it('finishRun calls finish_shopping_run with { run_id } — the RUN, never the list — and returns the new run', async () => {
    // #354. The argument NAME is the contract, and the io test is where a
    // misspelling is caught before the live probe: PostgREST resolves by the
    // set of names, so `{ run: … }` here would resolve nothing on the project.
    const next = { ...RUN, id: 'r2', opened_at: '2026-09-06T00:00:00Z' }
    results.finish_shopping_run = { data: next, error: null }
    const opened = await finishRun(client, 'r1')
    expect(rpcs()).toEqual([{ op: 'rpc', name: 'finish_shopping_run', args: { run_id: 'r1' } }])
    expect(Object.keys(rpcs()[0].args)).toEqual(['run_id'])
    expect(opened).toEqual(next)
    // No timestamp and no member is sent: closed_at, closed_by and the new
    // run's opened_at are the database's, as every stamp since 0004.
    expect(JSON.stringify(rpcs()[0].args)).not.toMatch(/closed|opened|member|_at/)
  })

  it('finishRun refuses a missing run before any request', async () => {
    await expect(finishRun(client, null)).rejects.toThrow(/Which run/)
    await expect(finishRun(client, '')).rejects.toThrow(/Which run/)
    expect(calls).toEqual([])
  })

  it('finishRun reports a refusal with what we were doing, carrying the cause — the stale-screen case', async () => {
    results.finish_shopping_run = { data: null, error: { message: 'run already closed', code: 'P0001' } }
    const failure = await finishRun(client, 'r1').catch((e) => e)
    expect(failure.message).toBe('finishing the run: run already closed')
    expect(failure.cause.code).toBe('P0001')
  })

  it('never issues an insert or an update to write a stamp — the RPC is the only writer', async () => {
    await createList(client, HOUSEHOLD, 'Placeholder List')
    await addItem(client, 'r1', 'Placeholder Item')
    await purchaseItem(client, 'i1')
    await unpurchaseItem(client, 'i1')
    await finishRun(client, 'r1')
    expect(calls.filter((c) => c.op === 'insert' || c.op === 'update')).toEqual([])
  })

  it('refuses an empty name before any request, for a list and for an item', async () => {
    await expect(createList(client, HOUSEHOLD, '   ')).rejects.toThrow(/name is required/)
    await expect(addItem(client, 'r1', '')).rejects.toThrow(/name is required/)
    expect(calls).toEqual([])
  })

  it('refuses a missing household, run or item before any request', async () => {
    await expect(createList(client, null, 'Placeholder List')).rejects.toThrow(/Which household/)
    await expect(addItem(client, null, 'Placeholder Item')).rejects.toThrow(/Which run/)
    await expect(purchaseItem(client, null)).rejects.toThrow(/Which item/)
    await expect(unpurchaseItem(client, null)).rejects.toThrow(/Which item/)
    expect(calls).toEqual([])
  })

  it('reports a refusal with what we were doing, carrying the cause', async () => {
    results.purchase_shopping_item = { data: null, error: { message: 'item already bought', code: 'P0001' } }
    const failure = await purchaseItem(client, 'i1').catch((e) => e)
    expect(failure.message).toBe('marking it bought: item already bought')
    expect(failure.cause.code).toBe('P0001')
  })
})

describe('the two direct writes the client holds', () => {
  it('removeItem deletes the row it names, and nothing else', async () => {
    await removeItem(client, 'i1')
    expect(opsOn('shopping_items')).toEqual([
      { op: 'delete', table: 'shopping_items' },
      { op: 'eq', table: 'shopping_items', column: 'id', value: 'i1' },
    ])
    expect(rpcs()).toEqual([])
  })

  it('renameList updates only `name`, trimmed, on the row it names, and reads the row back with the constant', async () => {
    results.shopping_lists = { data: { ...LIST, name: 'Placeholder List Renamed' }, error: null }
    const renamed = await renameList(client, 'l1', '  Placeholder List Renamed ')
    expect(opsOn('shopping_lists')).toEqual([
      { op: 'update', table: 'shopping_lists', patch: { name: 'Placeholder List Renamed' } },
      { op: 'eq', table: 'shopping_lists', column: 'id', value: 'l1' },
      { op: 'select', table: 'shopping_lists', cols: SHOPPING_LIST_COLUMNS },
    ])
    expect(renamed.name).toBe('Placeholder List Renamed')
  })

  it('renameList refuses an empty name before any request', async () => {
    await expect(renameList(client, 'l1', ' ')).rejects.toThrow(/name is required/)
    expect(calls).toEqual([])
  })

  it('throws with what we were doing when the delete is refused', async () => {
    results.shopping_items = { data: null, error: { message: 'permission denied' } }
    await expect(removeItem(client, 'i1')).rejects.toThrow('removing the item: permission denied')
  })
})

describe('normalizeName', () => {
  it('trims, and refuses blank, null and undefined', () => {
    expect(normalizeName('  Placeholder List  ')).toBe('Placeholder List')
    for (const bad of ['', '   ', null, undefined]) {
      expect(() => normalizeName(bad)).toThrow(/name is required/)
    }
  })
})

// ---------------------------------------------------------------------------
// #358 AC 5 — a name the household already uses, on either writer.
//
// The unique index is `(household_id, lower(name))` in 0032, and BOTH writers
// reach it: the `create_shopping_list` RPC's insert and `renameList`'s update.
// What this file can prove is the translation and what it is keyed on; that
// the index actually refuses the second name, in any case, is
// shopping.pglite.test.js's.
// ---------------------------------------------------------------------------

/** What PostgREST hands back when the index refuses a write. */
const duplicate = (message) => ({
  data: null,
  error: {
    code: '23505',
    message:
      message ??
      'duplicate key value violates unique constraint "shopping_lists_household_name_key"',
  },
})

describe('a duplicate list name is translated, and only that', () => {
  it('createList says the name that was typed, not the constraint that refused it', async () => {
    results.create_shopping_list = duplicate()
    await expect(createList(client, HOUSEHOLD, '  Placeholder List  ')).rejects.toThrow(
      'You already have a list called Placeholder List.',
    )
  })

  it('renameList says the same sentence, from the same code', async () => {
    results.shopping_lists = duplicate()
    await expect(renameList(client, 'l1', 'Placeholder List')).rejects.toThrow(
      'You already have a list called Placeholder List.',
    )
  })

  it('is keyed on the CODE: a 23505 whose message says nothing about duplicates still maps', async () => {
    // Postgres is free to reword its own sentence and a translated server would
    // not produce that one at all, so the message must not be what decides.
    results.create_shopping_list = duplicate('something else entirely')
    await expect(createList(client, HOUSEHOLD, 'Placeholder List')).rejects.toThrow(
      'You already have a list called Placeholder List.',
    )
  })

  it('is keyed on the code: a DIFFERENT code whose message mentions a duplicate key does not map', async () => {
    // The other half of the pair, and the one that would pass if the check were
    // a `/duplicate key/` test: this error is not the unique index, so the
    // person must not be told their list already exists.
    results.create_shopping_list = {
      data: null,
      error: { code: '42501', message: 'permission denied — not a duplicate key violation' },
    }
    await expect(createList(client, HOUSEHOLD, 'Placeholder List')).rejects.toThrow(
      'creating the list: permission denied — not a duplicate key violation',
    )
  })

  it('is confined to the two writers of a LIST: an item write keeps its own wording', async () => {
    // `shopping_items` has unique constraints of its own reach, and nothing
    // about them is a sentence about a list.
    results.add_shopping_item = duplicate('duplicate key value violates unique constraint')
    await expect(addItem(client, 'r1', 'Placeholder Item')).rejects.toThrow(
      /^adding the item: duplicate key/,
    )
    results.shopping_items = duplicate('duplicate key value violates unique constraint')
    await expect(removeItem(client, 'i1')).rejects.toThrow(/^removing the item: duplicate key/)
  })
})
