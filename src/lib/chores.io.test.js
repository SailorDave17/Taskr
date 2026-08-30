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
  // An ARRAY is a queue, consumed one result per resolution — #220's batch
  // tests need call N to succeed while call N+1 is refused, which a single
  // shared result cannot express. An object behaves as it always has.
  const result = () => {
    const r = results[table]
    if (Array.isArray(r)) return r.shift() ?? { data: null, error: null }
    return r ?? { data: null, error: null }
  }
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
  getSupabase: () => ({
    from: (table) => makeQuery(table),
    rpc: (name, args) => {
      calls.push({ op: 'rpc', name, args })
      return Promise.resolve(results[name] ?? { data: null, error: null })
    },
  }),
}))

// #159 — the currentHousehold mock is gone with the dependency. addChore no
// longer resolves a household for itself; the caller names the one it is
// showing, which is the whole point of the story.

const {
  CHORE_COLUMNS,
  addChore,
  addChores,
  assignChore,
  catchUpRepeats,
  completeChore,
  listChores,
  recordActualMinutes,
  removeChore,
  unassignChore,
  uncompleteChore,
  updateChore,
} = await import('./chores.js')

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
})

describe('listChores', () => {
  it('asks for the granted columns by name, never a wildcard', async () => {
    results.chores = { data: [ROW], error: null }
    await listChores(HOUSEHOLD.id)

    const select = opsOn('chores').find((c) => c.op === 'select')
    expect(select.cols).toBe(CHORE_COLUMNS)
    // A wildcard is not a style preference here, and 0014 does NOT change that
    // on this table: 0012 withholds repeat_since and repeat_caught_up_through as
    // well, so `select('*')` on chores still fails outright at the server. That
    // asymmetry with `members` is #157's measured finding and the reason 0014 is
    // free here.
    expect(select.cols).not.toContain('*')
    // #159 AC 1 — one named household, not "whatever RLS returns".
    expect(opsOn('chores')).toContainEqual(
      expect.objectContaining({ op: 'eq', column: 'household_id', value: HOUSEHOLD.id }),
    )
  })

  it('orders by due date then creation, so the list does not reshuffle between refreshes', async () => {
    results.chores = { data: [ROW], error: null }
    await listChores(HOUSEHOLD.id)

    const orders = opsOn('chores').filter((c) => c.op === 'order')
    expect(orders.map((o) => o.column)).toEqual(['due_on', 'created_at'])
    expect(orders.every((o) => o.ascending === true)).toBe(true)
  })

  it('returns an empty array when the table is empty, not null', async () => {
    // Supabase answers a no-rows select with data: null. Handing that to the
    // component would crash on .map rather than render an empty list.
    results.chores = { data: null, error: null }
    expect(await listChores(HOUSEHOLD.id)).toEqual([])
  })

  it('throws with what we were doing when the read fails', async () => {
    results.chores = { data: null, error: { message: 'permission denied for table chores' } }
    await expect(listChores(HOUSEHOLD.id)).rejects.toThrow(/loading the chores: permission denied/i)
  })
})

describe('addChore', () => {
  it('writes the normalized values, not the raw form strings', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({ title: '  Dishes  ', expectedMinutes: '20', dueOn: '2026-08-10', householdId: HOUSEHOLD.id })

    const insert = opsOn('chores').find((c) => c.op === 'insert')
    expect(insert.row).toEqual({
      household_id: 'h1',
      title: 'Dishes',
      expected_minutes: 20,
      due_on: '2026-08-10',
      // #53 — a caller that says nothing about repeating writes 'none'
      // explicitly, so the row's schedule is stated rather than inherited.
      repeat_kind: 'none',
      repeat_weekdays: null,
      // #211 — and a caller that says nothing about where the chore came from
      // writes 'manual' explicitly, for the same reason. The column's DEFAULT
      // would supply the identical value, which is exactly why this is asserted
      // on the outgoing ROW rather than on a row read back: only the payload can
      // tell "the client stated it" apart from "the database filled it in".
      source: 'manual',
    })
    // Written out rather than derived from the input, so the implementation
    // cannot quietly redefine what "normalized" means.
    expect(typeof insert.row.expected_minutes).toBe('number')
  })

  // #159 — rewritten, not deleted, and it is the test whose SUBJECT the story
  // reverses. It asserted household_id came "from this device membership, never
  // from the caller", which was correct while one unordered read could stand in
  // for the answer. The caller names it now.
  //
  // The narrower property that survives is the one this test was really
  // protecting: THE ROW IS BUILT HERE, FIELD BY FIELD, never spread from caller
  // input — so a stray snake_case `household_id` in the payload cannot smuggle a
  // household past the named argument. That, plus 0003's with-check refusing any
  // id outside current_household_ids(), is what stops a caller writing anywhere
  // it likes (#159 AC 5).
  // #211 AC 4 — the default is what keeps every existing call site meaning what
  // it meant. App.jsx spreads a form object that names no source, so if this
  // parameter were required rather than defaulted the story would have had to
  // edit a call site it has no business touching.
  it('records an extracted chore as extraction when the caller says so', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({
      title: 'Dishes',
      expectedMinutes: 20,
      dueOn: '2026-08-10',
      householdId: HOUSEHOLD.id,
      source: 'extraction',
    })

    const insert = opsOn('chores').find((c) => c.op === 'insert')
    expect(insert.row.source).toBe('extraction')
  })

  it('reads the chore back with source among the columns, or the write is unverifiable', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({ title: 'Dishes', expectedMinutes: 20, dueOn: '2026-08-10', householdId: HOUSEHOLD.id })

    const select = opsOn('chores').find((c) => c.op === 'select')
    // SPLIT, never a substring test on the joined string, and the reason is
    // measured rather than stylistic: this assertion was written as
    // `expect(select.cols).toContain('source')` and a mutation removing `source`
    // from CHORE_COLUMNS reddened 2 tests against a predicted 3 — this one
    // stayed green, because `assigned_source` is always in the list and the
    // string 'source' is a substring of it. The list contains two names where
    // one ends with the other, so only membership of the parsed list means
    // anything here.
    const requested = select.cols.split(',').map((c) => c.trim())
    expect(requested).toContain('source')
    // And the neighbour that made the loose form vacuous, asserted alongside so
    // a future reader can see why the split is not fussiness.
    expect(requested).toContain('assigned_source')
    // What the assertion is FOR: the INSERT's own returning list has to carry
    // the column, which is the clause 0023's select grant exists to satisfy — a
    // RETURNING naming an ungranted column is refused with a message naming the
    // TABLE, so the failure would read as the insert being rejected rather than
    // as a missing read grant.
  })

  it('builds the row itself, so a stray household_id in the payload is ignored', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({
      title: 'Dishes',
      expectedMinutes: 20,
      dueOn: '2026-08-10',
      householdId: 'h1',
      household_id: 'somebody-elses-household',
    })

    const insert = opsOn('chores').find((c) => c.op === 'insert')
    expect(insert.row.household_id).toBe('h1')
  })

  // #159 — rewritten, not deleted. The old property was "a device that resolved
  // no household issues no request". addChore resolves nothing now, so the
  // property that survives and still matters is that an UNNAMED household issues
  // no request either — the failure is loud and local rather than a write landing
  // wherever an unordered read pointed.
  it('refuses before any request when no household is named', async () => {
    await expect(
      addChore({ title: 'Dishes', expectedMinutes: 20, dueOn: '2026-08-10', householdId: undefined }),
    ).rejects.toThrow(/which household/i)
    expect(opsOn('chores')).toHaveLength(0)
  })

  // #159 AC 4 — proven by reading the written row back.
  it('files the chore in the household it was given, not one it resolved', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({ title: 'Dishes', expectedMinutes: 20, dueOn: '2026-08-10', householdId: 'h2' })

    const insert = opsOn('chores').find((c) => c.op === 'insert')
    expect(insert.row.household_id).toBe('h2')
  })

  it('validates the value before anything else, so a bad one costs no round trip', async () => {
    await expect(
      addChore({ title: 'Dishes', expectedMinutes: 0, dueOn: '2026-08-10', householdId: HOUSEHOLD.id }),
    ).rejects.toThrow(/at least a minute/i)
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('throws with what we were doing when the insert is refused', async () => {
    results.chores = { data: null, error: { message: 'new row violates row-level security policy' } }
    await expect(
      addChore({ title: 'Dishes', expectedMinutes: 20, dueOn: '2026-08-10', householdId: HOUSEHOLD.id }),
    ).rejects.toThrow(/adding the chore: new row violates row-level security/i)
  })
})

describe('addChores — #220, several chores through the single-add path', () => {
  const inserts = () => opsOn('chores').filter((c) => c.op === 'insert')

  // AC 4's "indistinguishable from singly-added ones", asserted on the wire:
  // the same raw form input goes once through addChore and once through
  // addChores, and the two insert payloads must be byte-equal — normalization
  // included, which is why the fixture arrives unnormalized.
  it('lands a row as the identical insert a single add makes', async () => {
    results.chores = { data: ROW, error: null }
    await addChore({ title: '  Dishes  ', expectedMinutes: '20', dueOn: '2026-08-10', householdId: 'h1' })
    const single = inserts()[0].row

    calls.length = 0
    await addChores([{ title: '  Dishes  ', expectedMinutes: '20', dueOn: '2026-08-10' }], {
      householdId: 'h1',
    })
    expect(inserts()[0].row).toEqual(single)
  })

  it('issues one ordinary insert per row — never a bulk payload, never an RPC', async () => {
    results.chores = { data: ROW, error: null }
    const outcomes = await addChores(
      [
        { title: 'wash the towels', expectedMinutes: 20, dueOn: '2026-08-10' },
        { title: 'water the plants', expectedMinutes: 5, dueOn: '2026-08-11' },
        { title: 'sweep the porch', expectedMinutes: 15, dueOn: '2026-08-12' },
      ],
      { householdId: 'h1' },
    )

    expect(inserts()).toHaveLength(3)
    // Each insert carries ONE row object. supabase-js accepts an array for a
    // bulk insert, and that shape appearing here would be the second write
    // route the issue rules out.
    inserts().forEach((c) => expect(Array.isArray(c.row)).toBe(false))
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(0)
    expect(outcomes.map((o) => o.ok)).toEqual([true, true, true])
  })

  it('AC 5: reports per-row outcomes in entry order, and a refusal does not stop the rows behind it', async () => {
    // A queue: first insert lands, second is refused by the server, third lands.
    results.chores = [
      { data: ROW, error: null },
      { data: null, error: { message: 'new row violates row-level security policy' } },
      { data: ROW, error: null },
    ]
    const outcomes = await addChores(
      [
        { title: 'wash the towels', expectedMinutes: 20, dueOn: '2026-08-10' },
        { title: 'water the plants', expectedMinutes: 5, dueOn: '2026-08-11' },
        { title: 'sweep the porch', expectedMinutes: 15, dueOn: '2026-08-12' },
      ],
      { householdId: 'h1' },
    )

    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true])
    expect(outcomes[1].message).toMatch(/adding the chore: new row violates/i)
    expect(inserts()).toHaveLength(3)
  })

  it('a row the validators refuse costs no request and fails only itself', async () => {
    results.chores = { data: ROW, error: null }
    const outcomes = await addChores(
      [
        { title: '', expectedMinutes: 20, dueOn: '2026-08-10' },
        { title: 'fold the laundry', expectedMinutes: 20, dueOn: '2026-08-10' },
      ],
      { householdId: 'h1' },
    )

    expect(outcomes[0].ok).toBe(false)
    expect(outcomes[0].message).toMatch(/needs a name/i)
    expect(outcomes[1].ok).toBe(true)
    expect(inserts()).toHaveLength(1)
  })

  it('a stray householdId inside a row cannot override the one the caller is showing', async () => {
    results.chores = { data: ROW, error: null }
    await addChores(
      [{ title: 'walk the dog', expectedMinutes: 10, dueOn: '2026-08-10', householdId: 'smuggled-h9' }],
      { householdId: 'h1' },
    )

    expect(inserts()[0].row.household_id).toBe('h1')
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

describe('recordActualMinutes — #12', () => {
  it('writes only actual_minutes, normalized, to the row it names', async () => {
    results.chores = { data: ROW, error: null }
    await recordActualMinutes('c1', '35')

    const update = opsOn('chores').find((c) => c.op === 'update')
    expect(update.patch).toEqual({ actual_minutes: 35 })
    expect(opsOn('chores').find((c) => c.op === 'eq')).toMatchObject({ column: 'id', value: 'c1' })
  })

  it('never touches expected_minutes — the two fields cannot overwrite one another here', async () => {
    results.chores = { data: ROW, error: null }
    await recordActualMinutes('c1', 35)

    const update = opsOn('chores').find((c) => c.op === 'update')
    expect(Object.keys(update.patch)).toEqual(['actual_minutes'])
  })

  it('refuses a bad value before any request', async () => {
    await expect(recordActualMinutes('c1', -5)).rejects.toThrow(/negative/i)
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('accepts zero — "it was already done" is a value, not an error', async () => {
    results.chores = { data: ROW, error: null }
    await recordActualMinutes('c1', 0)

    const update = opsOn('chores').find((c) => c.op === 'update')
    expect(update.patch).toEqual({ actual_minutes: 0 })
  })

  it('throws with what we were doing when the update is refused', async () => {
    results.chores = { data: null, error: { message: 'permission denied for table chores' } }
    await expect(recordActualMinutes('c1', 35)).rejects.toThrow(
      /recording how long it took: permission denied/i,
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

    await listChores(HOUSEHOLD.id).then(
      () => expect.unreachable('listChores should have thrown'),
      (err) => {
        expect(err.cause).toBe(original)
        expect(err.message).toContain('loading the chores')
      },
    )
  })
})

describe('completion goes through the RPC, never an update — #35', () => {
  const rpcs = () => calls.filter((c) => c.op === 'rpc')

  it('completeChore calls the function and sends NO timestamp', async () => {
    results.complete_chore = { data: { ...ROW, completed_at: '2026-08-08T10:00:00Z' }, error: null }
    await completeChore('c1')

    expect(rpcs()).toEqual([{ op: 'rpc', name: 'complete_chore', args: { chore_id: 'c1' } }])
    // The clock is the server's. If a timestamp ever appears in these args, a
    // phone with the wrong date can move work between weeks.
    expect(JSON.stringify(rpcs()[0].args)).not.toMatch(/completed_at|202\d-/)
    // And it must not go near the table directly — the column grant refuses it,
    // so an update here would be a runtime error rather than a silent bug.
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('uncompleteChore calls its own function', async () => {
    results.uncomplete_chore = { data: { ...ROW, completed_at: null }, error: null }
    await uncompleteChore('c1')
    expect(rpcs()).toEqual([{ op: 'rpc', name: 'uncomplete_chore', args: { chore_id: 'c1' } }])
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('reports a refusal with what we were doing', async () => {
    results.complete_chore = { data: null, error: { message: 'no such chore in your household' } }
    await expect(completeChore('c1')).rejects.toThrow(/marking it done: no such chore/i)
  })

  it('and the undo does too', async () => {
    results.uncomplete_chore = { data: null, error: { message: 'no such chore in your household' } }
    await expect(uncompleteChore('c1')).rejects.toThrow(/putting it back on the list: no such chore/i)
  })
})

describe('assignment goes through the RPC, never an update — #36', () => {
  const rpcs = () => calls.filter((c) => c.op === 'rpc')

  it('assignChore calls assign_chore with the chore and the member', async () => {
    results.assign_chore = { data: { ...ROW, assigned_member_id: 'm1' }, error: null }
    const row = await assignChore('c1', 'm1')

    expect(rpcs()).toEqual([
      { op: 'rpc', name: 'assign_chore', args: { chore_id: 'c1', member_id: 'm1' } },
    ])
    expect(row.assigned_member_id).toBe('m1')
    // The column has no update grant, so a direct write would be a runtime
    // permission error rather than a silent bug — but the point of asserting it
    // here is that the ONLY write path is the function, checked on this side too.
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('unassignChore calls its own function and names no member', async () => {
    results.unassign_chore = { data: { ...ROW, assigned_member_id: null }, error: null }
    await unassignChore('c1')

    expect(rpcs()).toEqual([{ op: 'rpc', name: 'unassign_chore', args: { chore_id: 'c1' } }])
    // Not `assign_chore(chore, null)`. That call is refused by the database, and
    // routing an unassign through it would turn a dropped variable into a
    // deliberate-looking act the moment somebody relaxed the refusal.
    expect(JSON.stringify(rpcs()[0].args)).not.toMatch(/member_id/)
    expect(opsOn('chores')).toHaveLength(0)
  })

  it('reports a refusal with what we were doing', async () => {
    results.assign_chore = { data: null, error: { message: 'that person is not in this household' } }
    await expect(assignChore('c1', 'm9')).rejects.toThrow(
      /giving the chore to that person: that person is not in this household/i,
    )
  })

  it('and the unassign does too', async () => {
    results.unassign_chore = { data: null, error: { message: 'no such chore in your household' } }
    await expect(unassignChore('c1')).rejects.toThrow(
      /taking the chore off that person: no such chore/i,
    )
  })
})

describe('catchUpRepeats — #53', () => {
  it('calls the RPC with no arguments, so the server owns the clock entirely', async () => {
    results.catch_up_repeats = { data: [{ created_count: 2, skipped_count: 0 }], error: null }
    await catchUpRepeats()

    const rpc = calls.find((c) => c.op === 'rpc' && c.name === 'catch_up_repeats')
    expect(rpc).toBeDefined()
    // Nothing time-shaped may travel: a phone with the wrong date must not be
    // able to move an occurrence between days. The instant-taking form exists
    // and is granted to no client role — 0012's split.
    expect(rpc.args).toBeUndefined()
  })

  it('unwraps the single row a table-returning function arrives as', async () => {
    results.catch_up_repeats = { data: [{ created_count: 3, skipped_count: 28 }], error: null }
    expect(await catchUpRepeats()).toEqual({ created: 3, skipped: 28 })
  })

  it('reads an empty answer as nothing to do, not as a crash', async () => {
    results.catch_up_repeats = { data: [], error: null }
    expect(await catchUpRepeats()).toEqual({ created: 0, skipped: 0 })
  })

  it('reports a failure in its own words, so boot can show it beside the work', async () => {
    results.catch_up_repeats = {
      data: null,
      error: { message: 'function public.catch_up_repeats does not exist' },
    }
    await expect(catchUpRepeats()).rejects.toThrow(/catching up repeats/)
  })
})
