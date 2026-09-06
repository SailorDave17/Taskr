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
// `refresh()` calls `readShopping` on every re-read, and four of the writes the
// tab offers — create a list, add an item, remove an unbought one, finish a run
// (#357) — go through App's `mutate()` like every other write. The tick is the
// exception and says so below. The module landed one story ahead
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
// what a round trip costs; #355 settled the shape of the tick, below.
//
// THE TICK IS THE ONE WRITE HERE THAT DOES NOT RE-READ EVERYTHING. #351
// measured a full `refresh()` per tick at 6.5 s on Slow 4G against the 1 s bar
// a person taps at, and one round trip at 0.585 s; the owner chose the one
// round trip at #355's pickup, so `purchaseItem` and `unpurchaseItem` are
// called for their RETURN VALUE — the whole stamped row, which
// `replaceShoppingItem` swaps into the list on screen. Every other write in
// this module still goes through App's `mutate()` and re-reads. The cost of
// the departure is stated where it bites: another phone's ticks appear on the
// next arrival on the tab, which is what decision 3 (re-read on open, no
// Realtime) already says about every other row on this surface. A REFUSED tick
// is the one moment this phone knows its picture is stale, and falls back to
// the full re-read.

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
 * Compare two database stamps, with an unreadable one ordering EQUAL — #355.
 *
 * Numeric on parsed milliseconds rather than a string compare, because
 * PostgREST spells the same instant several ways (`…Z`, `…+00:00`) and a
 * lexical compare would order those two spellings by their punctuation. A
 * stamp that will not parse returns 0, which leaves the pair in the order the
 * read already put them rather than moving a row on the strength of a value
 * nothing could read.
 */
function stampOrder(left, right) {
  const a = Date.parse(left ?? '')
  const b = Date.parse(right ?? '')
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return 0
  return a < b ? -1 : 1
}

/**
 * The shopping list in the order a person walking a store wants it — #355.
 *
 * Everything still to find first, in the order it was added; everything in the
 * cart below it, oldest purchase first, so the thing just ticked is at the very
 * bottom and the next thing to look for is at the top of the screen. That
 * ordering IS the story: a list that reshuffled on every tick, or that left a
 * bought item sitting between two unbought ones, would be a to-do list with
 * checkboxes.
 *
 * Pure, and total: it reads `purchased_at` and `added_at` and nothing else, so
 * it does not need the run, the roster or a clock. A carried item (#354 copies
 * `added_at` forward) therefore sorts to the TOP of the next run's unbought
 * half by construction — its stamp predates the run it is on, and this
 * function never compares a stamp with `opened_at`.
 *
 * Ties are left alone rather than broken here. Two items added in the same
 * transaction sort equal, and the caller's order decides — which for the Shop
 * tab is `readShopping`'s `added_at, id`, an ordering the database already
 * made total. Sorting is stable in every engine this ships to, so "equal keeps
 * the read's order" is a property of the sort and not of the comparator.
 */
export function orderShoppingItems(items) {
  return [...(items ?? [])].sort((a, b) => {
    const aBought = Boolean(a?.purchased_at)
    const bBought = Boolean(b?.purchased_at)
    if (aBought !== bBought) return aBought ? 1 : -1
    return aBought
      ? stampOrder(a.purchased_at, b.purchased_at)
      : stampOrder(a?.added_at, b?.added_at)
  })
}

/**
 * Swap one item row for the version the server just returned — #355.
 *
 * The one-round-trip re-read: `purchase_shopping_item` and its reversal both
 * return the whole stamped row, so a tick costs one round trip instead of the
 * four a full `refresh()` spends here (three shopping reads plus the roster).
 * #351 measured a full refresh per tick at 6.5 s on Slow 4G against a 1 s bar
 * and one round trip at 0.585 s; the owner took the one-round-trip route at
 * this story's pickup.
 *
 * An id this list does not hold returns the SAME array, not a copy: the
 * response is then about an item this screen is not showing, and a caller that
 * appended it would be inventing a row from a picture it never read. Identity
 * is the signal React uses, so returning the input is also what stops a
 * needless render.
 */
export function replaceShoppingItem(items, row) {
  const list = items ?? []
  if (!row?.id) return list
  let found = false
  const next = list.map((item) => {
    if (item?.id !== row.id) return item
    found = true
    return row
  })
  return found ? next : list
}

/**
 * "bought by Robin · 4:02 PM" — the who and the when off the row itself, #355.
 *
 * Both halves come from the stamp the DATABASE wrote (`purchased_at`) and the
 * member it stamped (`purchased_by_member_id`, resolved against the roster by
 * the caller), never from the phone that happens to be drawing the row. Two
 * phones looking at the same list therefore read the same sentence, and a
 * phone whose clock is wrong says nothing wrong.
 *
 * The zone is the household's, for the reason every other date on this app is
 * formatted in it: an evening shop reads as an evening. A missing or
 * unreadable stamp yields null, and the caller leaves the line out rather than
 * printing "Invalid Date".
 */
export function purchasedLabel(purchasedAt, buyerFirstName, timeZone) {
  const at = new Date(purchasedAt ?? '')
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)
  return buyerFirstName ? `bought by ${buyerFirstName} · ${time}` : `bought · ${time}`
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
 * the confirmed tap that calls this is the Shop tab's "Done shopping" (#357),
 * and the run it names is the one that tab is showing.
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
