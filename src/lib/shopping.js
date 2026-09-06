// The shopping data layer — story #352.
//
// Same contract as chores.js and household.js: nothing in this file is a
// security boundary. The rules that protect the data are the row-level policies
// and the column grants in supabase/migrations/0032_shopping_lists_runs_items.sql,
// and the four RPCs there plus `finish_shopping_run` (0033, #354) are the only
// writers of a list, a run, an item or a stamp. What this file does is name the
// household it means, ask for the granted columns by name, and turn a refusal
// into a sentence.
//
// The Shop tab (`src/components/Shopping.jsx`, #353) renders it; App's
// `refresh()` calls `readShopping` on every re-read, and the three writes the
// tab offers — create a list, add an item, remove an unbought one — go through
// App's `mutate()` like every other write. The module landed one story ahead
// of the tab (#352) because `liveSchema.test.js` refuses a `LIVE_SCHEMA` or
// `LIVE_RPCS` entry with no call site in `src/`, so the tables, their RPCs and
// the code that calls them had to arrive together.
//
// THE READ IS THREE PLAIN FILTERS AND NEVER AN EMBED FILTER. `readShopping`
// asks for the household's lists by naming the household, then the open runs
// by naming the list ids, then the items by naming the run ids. A PostgREST
// filter written against an embedded resource (`lists.select('*, runs!inner(…)')
// .is('runs.closed_at', null)`) is applied to the EMBED, not the parent — the
// list row still comes back with the embed nulled, and the row count never
// moves — which is the shape cairn's `postgrest-filtering-on-an-embedded-resource`
// note measured. Three round trips is the cost, and #351 has already priced
// what a round trip costs; #355 owns the shape of the tick.

import { getSupabase } from './supabase.js'

/**
 * Unwrap a Supabase `{ data, error }` result.
 *
 * A third copy of the eight-line helper household.js and chores.js each carry,
 * for the reason chores.js gives: a module about shopping is not the home of a
 * generic utility, and the duplication is cheaper than the coupling.
 */
function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

// The columns a client is allowed to read, matching the select grants in 0032
// exactly. These are the same strings `LIVE_SCHEMA` carries, imported rather
// than restated, so a column added to a query cannot drift away from the thing
// that checks it (#78 AC 3).
//
// `household_id` is in every list — the 0014 route. The client scopes lists by
// naming the household, and a withheld column here would force the embed
// filter the docblock above rules out.
export const SHOPPING_LIST_COLUMNS = 'id, household_id, name, created_at'

export const SHOPPING_RUN_COLUMNS =
  'id, list_id, household_id, opened_at, closed_at, closed_by_member_id'

export const SHOPPING_ITEM_COLUMNS =
  'id, run_id, household_id, name, note, added_by_member_id, added_at, purchased_at, purchased_by_member_id, carried_from_item_id'

/**
 * Trim a name the way the database will, so an empty one costs no round trip.
 *
 * The database is the authority — `create_shopping_list` and `add_shopping_item`
 * both trim and both raise on empty — and this only turns the refusal into a
 * sentence before the request is sent. Deleting it changes what a person is
 * told, never what is stored.
 */
export function normalizeName(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) throw new Error('A name is required.')
  return trimmed
}

/**
 * The first word of a display name, or null for nothing — #353.
 *
 * An item row says "added by Robin", not "added by Robin Placeholder": the
 * household knows its own members by first name, and a row is a line on a
 * phone. Pure, and here rather than in the component so that #355's "bought
 * by" reads the same word off the same roster row.
 */
export function firstNameOf(displayName) {
  const first = String(displayName ?? '').trim().split(/\s+/)[0]
  return first || null
}

/**
 * Everything the Shop tab draws for one household, in one call: the lists, the
 * OPEN run of each, and the items on those runs.
 *
 * Takes the client rather than reaching for `getSupabase()`, so the caller that
 * already holds one hands it in — and so the io test can hand in a recording
 * fake without mocking a module.
 *
 * "Open" is `closed_at is null`, never the latest `opened_at` — the predicate
 * the migration writes everywhere, and the one that survives #354 and #359
 * admitting more states.
 */
export async function readShopping(client, householdId) {
  if (!householdId) throw new Error('Which household? A shopping read must name one.')

  const lists = unwrap(
    await client
      .from('shopping_lists')
      .select(SHOPPING_LIST_COLUMNS)
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    'loading shopping lists',
  ) ?? []

  const listIds = lists.map((list) => list.id)
  if (listIds.length === 0) return { lists: [], runs: [], items: [] }

  const runs = unwrap(
    await client
      .from('shopping_runs')
      .select(SHOPPING_RUN_COLUMNS)
      .in('list_id', listIds)
      .is('closed_at', null),
    'loading shopping runs',
  ) ?? []

  const runIds = runs.map((run) => run.id)
  if (runIds.length === 0) return { lists, runs: [], items: [] }

  const items = unwrap(
    await client
      .from('shopping_items')
      .select(SHOPPING_ITEM_COLUMNS)
      .in('run_id', runIds)
      .order('added_at', { ascending: true })
      .order('id', { ascending: true }),
    'loading shopping items',
  ) ?? []

  return { lists, runs, items }
}

/**
 * Create a list — and, inside the same transaction, its first open run.
 *
 * An RPC rather than an insert, and the client holds no insert grant on
 * `shopping_lists` at all: a list with no open run is a state the Shop tab could
 * not draw, and `create_shopping_list` is what makes that state unreachable.
 */
export async function createList(client, householdId, name) {
  if (!householdId) throw new Error('Which household? A list must belong to one.')
  const listName = normalizeName(name)
  return unwrap(
    await client.rpc('create_shopping_list', { household: householdId, name: listName }),
    'creating the list',
  )
}

/**
 * Add an item to an open run. The adder and the time are the database's — no
 * timestamp is sent and no member is named; the function resolves both from
 * the caller.
 */
export async function addItem(client, runId, name, note = null) {
  if (!runId) throw new Error('Which run? An item must be added to one.')
  const itemName = normalizeName(name)
  const itemNote = String(note ?? '').trim() || null
  return unwrap(
    await client.rpc('add_shopping_item', { run: runId, name: itemName, note: itemNote }),
    'adding the item',
  )
}

/** Bought. Refused by the database if somebody else got there first. */
export async function purchaseItem(client, itemId) {
  if (!itemId) throw new Error('Which item?')
  return unwrap(
    await client.rpc('purchase_shopping_item', { item: itemId }),
    'marking it bought',
  )
}

/** Not bought after all. Any member of the household may take a purchase back. */
export async function unpurchaseItem(client, itemId) {
  if (!itemId) throw new Error('Which item?')
  return unwrap(
    await client.rpc('unpurchase_shopping_item', { item: itemId }),
    'marking it not bought',
  )
}

/**
 * Finish a run — #354. Closes the run this screen is showing and opens the
 * list's next one with every unbought item carried forward, in one transaction
 * on the server, and returns the NEW run row.
 *
 * The argument is the run and never the list, and that is the whole design:
 * a second phone whose screen still shows the old run names THAT run, finds it
 * closed, and is refused — it can never finish the fresh run a first phone just
 * opened. The caller re-reads the list afterwards, as with every write here;
 * #357 is the confirmed tap that calls this.
 */
export async function finishRun(client, runId) {
  if (!runId) throw new Error('Which run? Finishing needs the run this screen shows.')
  return unwrap(
    await client.rpc('finish_shopping_run', { run_id: runId }),
    'finishing the run',
  )
}

/**
 * Remove an item. A plain delete, under a policy that admits only an unbought
 * item on an open run — so a delete of anything else affects zero rows and
 * raises nothing, which is how row-level security refuses. The caller reads
 * the list back rather than trusting this to have removed anything.
 */
export async function removeItem(client, itemId) {
  if (!itemId) throw new Error('Which item?')
  unwrap(await client.from('shopping_items').delete().eq('id', itemId), 'removing the item')
}

/** Rename a list. The one direct write the client holds on `shopping_lists`. */
export async function renameList(client, listId, name) {
  if (!listId) throw new Error('Which list?')
  const listName = normalizeName(name)
  return unwrap(
    await client
      .from('shopping_lists')
      .update({ name: listName })
      .eq('id', listId)
      .select(SHOPPING_LIST_COLUMNS)
      .single(),
    'renaming the list',
  )
}

/**
 * The client this module uses when a caller does not hand one in — the same
 * `getSupabase()` every other data-layer module reads, exported so App can
 * pass it without importing supabase.js itself.
 */
export function shoppingClient() {
  return getSupabase()
}
