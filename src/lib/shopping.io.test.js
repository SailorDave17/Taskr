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
  archiveList,
  createList,
  finishRun,
  normalizeName,
  purchaseItem,
  readClosedRuns,
  readShopping,
  removeItem,
  renameList,
  unarchiveList,
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
    // #359 — the negation of `.is`, and the reason the fake carries all three
    // arguments: `not('closed_at', 'is', null)` and `is('closed_at', null)` are
    // one character apart at the call site and are opposite reads.
    not(column, operator, value) {
      calls.push({ op: 'not', table, column, operator, value })
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
    // #360 — `archived_at` joined the list's constant with `0035`, which grants
    // exactly this column and no other. The pairing is what liveSchema.test.js
    // holds: a column asked for here and not granted there answers `42703`.
    expect(SHOPPING_LIST_COLUMNS).toBe('id, household_id, name, created_at, archived_at')
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

// ---------------------------------------------------------------------------
// #359 AC 4 — the history read: the same two tables, the same two column
// constants, and the OTHER half of the one predicate. No new table, no new
// grant, no migration; what this file can prove is that it asks for exactly
// that, which is the claim "no new grant" rests on.
// ---------------------------------------------------------------------------

const CLOSED_RUN = {
  ...RUN,
  id: 'r0',
  closed_at: '2026-09-05T18:00:00Z',
  closed_by_member_id: 'm1',
}

describe('readClosedRuns — closed runs by list, then their items by run', () => {
  beforeEach(() => {
    results.shopping_runs = { data: [CLOSED_RUN], error: null }
    results.shopping_items = { data: [ITEM], error: null }
  })

  it('selects both tables with the SAME imported constants the open read uses, never a wildcard', () => {
    // The claim in the story is that history needs no new grant. It holds only
    // because these are the same column lists `LIVE_SCHEMA` already carries — a
    // read that named one more column would need one.
    return readClosedRuns(client, ['l1']).then(() => {
      expect(opsOn('shopping_runs').find((c) => c.op === 'select').cols).toBe(SHOPPING_RUN_COLUMNS)
      expect(opsOn('shopping_items').find((c) => c.op === 'select').cols).toBe(SHOPPING_ITEM_COLUMNS)
      for (const c of calls.filter((c) => c.op === 'select')) {
        expect(c.cols).not.toContain('*')
        expect(c.cols).not.toMatch(/\(/)
      }
    })
  })

  it('asks for the runs that are CLOSED — `.not(closed_at, is, null)` — and names the lists', async () => {
    await readClosedRuns(client, ['l1', 'l2'])
    const runOps = opsOn('shopping_runs')
    expect(runOps).toContainEqual(
      expect.objectContaining({ op: 'in', column: 'list_id', values: ['l1', 'l2'] }),
    )
    expect(runOps).toContainEqual(
      expect.objectContaining({ op: 'not', column: 'closed_at', operator: 'is', value: null }),
    )
    // And it is NOT the open read's predicate. The two differ by one call and
    // return disjoint sets, so asserting the absence is asserting the direction.
    expect(runOps.some((c) => c.op === 'is')).toBe(false)
  })

  it('reads the items by the run ids the first read returned, in added order', async () => {
    await readClosedRuns(client, ['l1'])
    expect(opsOn('shopping_items')).toContainEqual(
      expect.objectContaining({ op: 'in', column: 'run_id', values: ['r0'] }),
    )
    expect(opsOn('shopping_items').filter((c) => c.op === 'order').map((c) => c.column)).toEqual([
      'added_at',
      'id',
    ])
  })

  it('leaves the ORDER of the runs to groupClosedRuns rather than asking the database twice', async () => {
    // The rule is one pure function with its own tests (`closed_at` descending,
    // total on id). A second copy of it in the query would be a second thing to
    // keep in step, and the read's order is not what the screen renders.
    await readClosedRuns(client, ['l1'])
    expect(opsOn('shopping_runs').filter((c) => c.op === 'order')).toEqual([])
  })

  it('issues the reads in order, and returns the two sets under their names', async () => {
    expect(await readClosedRuns(client, ['l1'])).toEqual({ runs: [CLOSED_RUN], items: [ITEM] })
    expect(calls.filter((c) => c.op === 'select').map((c) => c.table)).toEqual([
      'shopping_runs',
      'shopping_items',
    ])
  })

  it('with no closed run, issues ONE read and returns two empty arrays — no `.in([])`', async () => {
    results.shopping_runs = { data: [], error: null }
    expect(await readClosedRuns(client, ['l1'])).toEqual({ runs: [], items: [] })
    expect(calls.filter((c) => c.op === 'select').map((c) => c.table)).toEqual(['shopping_runs'])
  })

  it('treats a null data as empty rather than crashing on `.map`', async () => {
    results.shopping_runs = { data: null, error: null }
    expect(await readClosedRuns(client, ['l1'])).toEqual({ runs: [], items: [] })
  })

  it('refuses before any request when it is named no list — including an array of nothing', async () => {
    // `.in('list_id', [])` is a query that can only ever return nothing, and
    // sending one would spend a round trip to be told so.
    for (const bad of [undefined, null, [], [null], ['']]) {
      await expect(readClosedRuns(client, bad)).rejects.toThrow(/Which list/)
    }
    expect(calls).toEqual([])
  })

  it('throws with what we were doing when either read fails, carrying the cause', async () => {
    results.shopping_runs = { data: null, error: { message: 'permission denied', code: '42501' } }
    const refused = await readClosedRuns(client, ['l1']).catch((e) => e)
    expect(refused.message).toBe('loading finished runs: permission denied')
    expect(refused.cause.code).toBe('42501')

    results.shopping_runs = { data: [CLOSED_RUN], error: null }
    results.shopping_items = { data: null, error: { message: 'permission denied', code: '42501' } }
    await expect(readClosedRuns(client, ['l1'])).rejects.toThrow(
      'loading finished run items: permission denied',
    )
  })

  it('issues no DML at all — history is a read, and this client may not write a closed run', async () => {
    await readClosedRuns(client, ['l1'])
    expect(calls.filter((c) => ['insert', 'update', 'delete', 'rpc'].includes(c.op))).toEqual([])
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

describe('the ONE direct write the client holds, and the remove that stopped being one', () => {
  // #368 — removeItem was a `delete().eq('id', …)` under 0032's policy until
  // 0034 made it the fourth definer function and withdrew the grant. These two
  // assertions were written against the DELETE and are rewritten rather than
  // deleted: what they were protecting — that the client names one row and
  // touches nothing else, and that a refusal reaches the caller — is still
  // true and still checkable, and it is the shape of empty pass this file
  // keeps finding to leave an assertion standing over a subject that has left.
  it('removeItem calls the RPC by name with the item, and issues no table DML at all', async () => {
    await removeItem(client, 'i1')
    expect(rpcs()).toEqual([
      { op: 'rpc', name: 'remove_shopping_item', args: { item: 'i1' } },
    ])
    // The point of the story, asserted where a reader will look for it: after
    // 0034 there is no client DML on shopping_items, so a delete here would be
    // a call the live project no longer grants.
    expect(opsOn('shopping_items')).toEqual([])
    expect(calls.filter((c) => c.op === 'delete')).toEqual([])
  })

  it('refuses an item it cannot name before any request', async () => {
    await expect(removeItem(client, '')).rejects.toThrow(/which item/i)
    expect(calls).toEqual([])
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

  it('carries the RPC’s own refusal to the caller, by its sentence', async () => {
    // #368 — the two the function raises by name, and the reason the sentence
    // matters: the owner took "refuse by name" over the DELETE's silence at
    // this story's gate, so these strings are what a person reads on the error
    // strip when another phone got there first.
    for (const message of ['run already closed', 'item already bought']) {
      results.remove_shopping_item = { data: null, error: { message } }
      await expect(removeItem(client, 'i1')).rejects.toThrow(`removing the item: ${message}`)
    }
  })

  // -------------------------------------------------------------------------
  // #360 — putting a list away and bringing it back.
  //
  // Both are RPCs and NEITHER writes `shopping_lists` directly, which is the
  // property worth asserting here rather than in prose: the client holds
  // `update (name)` and nothing else on that table, so an implementation that
  // reached for `.update({ archived_at: … })` would be refused by the live
  // project and pass every pure test in this repo. The absence of a table op
  // is what this file can see and the pglite suite cannot.
  // -------------------------------------------------------------------------

  it('archiveList calls the RPC by name with the list, and writes no column itself', async () => {
    results.archive_shopping_list = { data: { ...LIST, archived_at: '2026-09-06T12:00:00Z' }, error: null }
    const away = await archiveList(client, 'l1')
    expect(rpcs()).toEqual([{ op: 'rpc', name: 'archive_shopping_list', args: { list: 'l1' } }])
    expect(opsOn('shopping_lists')).toEqual([])
    expect(away.archived_at).toBe('2026-09-06T12:00:00Z')
  })

  it('unarchiveList calls the RPC by name with the list, and writes no column itself', async () => {
    results.unarchive_shopping_list = { data: { ...LIST, archived_at: null }, error: null }
    const back = await unarchiveList(client, 'l1')
    expect(rpcs()).toEqual([{ op: 'rpc', name: 'unarchive_shopping_list', args: { list: 'l1' } }])
    expect(opsOn('shopping_lists')).toEqual([])
    expect(back.archived_at).toBeNull()
  })

  it('both refuse a list they cannot name before any request', async () => {
    await expect(archiveList(client, '')).rejects.toThrow(/which list/i)
    await expect(unarchiveList(client, null)).rejects.toThrow(/which list/i)
    expect(calls).toEqual([])
  })

  it('carries each archive refusal to the caller, by its sentence', async () => {
    // The one a person can act on is the first, and both ways out of it are on
    // the screen that raised it: Done shopping under the list, Remove on every
    // unbought row. The other two are what a second phone reads.
    for (const message of ['finish or clear this run first', 'this list is archived']) {
      results.archive_shopping_list = { data: null, error: { message } }
      await expect(archiveList(client, 'l1')).rejects.toThrow(`archiving the list: ${message}`)
    }
    results.unarchive_shopping_list = { data: null, error: { message: 'this list is not archived' } }
    await expect(unarchiveList(client, 'l1')).rejects.toThrow(
      'bringing the list back: this list is not archived',
    )
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
    // #368 moved the remove off the table and onto `remove_shopping_item`, so
    // the error now arrives from the RPC rather than from `shopping_items`.
    // What is asserted is unchanged: an ITEM writer keeps its own wording.
    results.remove_shopping_item = duplicate('duplicate key value violates unique constraint')
    await expect(removeItem(client, 'i1')).rejects.toThrow(/^removing the item: duplicate key/)
  })
})
