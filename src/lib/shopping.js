// The shopping data layer — story #352.
//
// Same contract as chores.js and household.js: nothing in this file is a
// security boundary. The rules that protect the data are the row-level policies
// and the column grants in supabase/migrations/0032_shopping_lists_runs_items.sql,
// and the four RPCs there plus `finish_shopping_run` (0033, #354),
// `remove_shopping_item` (0034, #368) and the archive pair (0035, #360) are the
// only writers of a list, a run, an item or a stamp. What this file does is
// name the household it means, ask for the granted columns by name, and turn a
// refusal into a sentence.
//
// A LIST IS PUT AWAY, NEVER DELETED (#360). `archived_at` is a stamp the client
// reads and cannot write, and `partitionShoppingLists` is the whole of the
// rule: an archived list leaves the picker and keeps every run it ever had.
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
// HISTORY IS READ WHEN SOMEBODY ASKS FOR IT, not on arrival — `readClosedRuns`
// (#359) is the same two tables under the other half of the same predicate, and
// it is the one read on this surface that `refresh()` does not perform. The
// reason is unbounded growth: what is open is bounded by the week a household is
// having, and what is closed grows by one run per trip forever. The freshness
// that buys is stated in that function's own docblock.
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
function unwrap({ data, error }, whatWeWereDoing, duplicateName = null) {
  if (error) {
    // #358 — the ONE refusal on this surface a person can act on, translated.
    //
    // 23505 is `unique_violation`, and the only unique constraint a client can
    // reach on `shopping_lists` is `shopping_lists_household_name_key`
    // (`household_id, lower(name)` in 0032): a household cannot hold two lists
    // whose names differ only in case. It arrives from BOTH writers — the
    // `create_shopping_list` RPC's insert and `renameList`'s update — so the
    // sentence is here rather than in either caller.
    //
    // KEYED ON THE CODE, NEVER ON THE MESSAGE. Postgres's own text is
    // "duplicate key value violates unique constraint …", a sentence about an
    // index where the person wants one about their household, and matching it
    // would be matching a string the database is free to reword and that a
    // translated server would not produce at all. `duplicateName` is what the
    // caller ASKED for, so the sentence names the name they typed rather than
    // the one already on the list.
    if (duplicateName && error.code === '23505') {
      throw new Error(`You already have a list called ${duplicateName}.`)
    }
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
//
// `archived_at` joined it with `0035` (#360). Read-only here like every other
// column on this table bar `name`: the two RPCs below are its only writers, so
// a client cannot put a list away by writing to it directly.
export const SHOPPING_LIST_COLUMNS = 'id, household_id, name, created_at, archived_at'

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
 * The household's lists in the order the picker draws them — #358.
 *
 * By NAME, not by `created_at`: the read orders lists oldest-first, which is a
 * fact about when somebody set them up and nothing a shopper knows. A picker
 * whose buttons move when a list is renamed, or whose order can only be learned
 * by using it, is a row of controls a person has to read every time; by name it
 * is a row they learn once.
 *
 * Case-insensitive, matching the unique index (`household_id, lower(name)` in
 * 0032) — two lists in one household can never differ only in case, so this
 * comparison can never be the thing that decides an order. The tie-break on id
 * is there for totality anyway: a comparator that returns 0 for two different
 * rows leaves them in the read's order, which is stable but is not an order
 * this function chose.
 *
 * Pure and total, and it copies rather than sorting in place — App holds the
 * read's own shape in state and the tab does the folding where it draws.
 */
export function orderShoppingLists(lists) {
  return [...(lists ?? [])].sort((a, b) => {
    const byName = String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'en', {
      sensitivity: 'base',
    })
    if (byName !== 0) return byName
    return String(a?.id ?? '') < String(b?.id ?? '') ? -1 : 1
  })
}

/**
 * Split the household's lists into the ones on the picker and the ones put
 * away — #360.
 *
 * `archived_at` is the whole rule and the database is its only writer, so this
 * asks the row rather than remembering anything: a list is archived when it
 * carries a stamp. Pure, total, and it PRESERVES THE INPUT ORDER within each
 * half, which is what lets the caller sort once (`orderShoppingLists`) and split
 * afterwards — sorting each half separately would be a second copy of the
 * ordering rule and could fall out of step with the first.
 *
 * Both halves are always arrays, so a caller can count them without a guard.
 * The archived half is a count and a set to reveal, never a second list to
 * draw: what the Shop tab does with it is #360's own decision, not this
 * function's.
 */
export function partitionShoppingLists(lists) {
  const active = []
  const archived = []
  for (const list of lists ?? []) {
    if (list?.archived_at) archived.push(list)
    else active.push(list)
  }
  return { active, archived }
}

/**
 * Which list the Shop tab is showing, given what the person last chose — #358.
 *
 * The rule AC 6 asks for, in one place and pure, rather than as an effect that
 * writes state after a read: a preference that still names a list on screen is
 * honoured, and anything else falls back to the FIRST list by name. "Anything
 * else" is three situations that a client cannot tell apart and does not need
 * to — nothing chosen yet, the active household changed under the choice, or
 * the list was renamed away or removed between one read and the next.
 *
 * Deriving it at render rather than syncing it in a `useEffect` is what makes
 * the stale window impossible: an effect would draw one frame against a list id
 * the current read does not hold, which on this surface is a frame with an add
 * form aimed at a run that is not on screen.
 *
 * Takes the lists in the order they will be DRAWN, so "first by name" is the
 * caller's ordering and not a second copy of it here.
 */
export function resolveSelectedListId(orderedLists, preferredId) {
  const lists = orderedLists ?? []
  if (preferredId && lists.some((list) => list?.id === preferredId)) return preferredId
  return lists[0]?.id ?? null
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
 * "Finished Sep 5, 2026 by Robin" — the heading on one closed run, #359.
 *
 * The date is the DATABASE's `closed_at` in the household's zone, for
 * `purchasedLabel`'s reason: two phones reading the same history read the same
 * sentence, and a phone whose clock is wrong says nothing wrong. The year is
 * always spelled rather than dropped when it happens to be this one — a
 * history view is exactly where "Sep 5" stops being enough, and deciding
 * whether to print it would mean asking this pure function what today is.
 *
 * The date only, and no time: a run is a trip, and the trip's own items carry
 * the times (`purchasedLabel`). Two trips finished on one day therefore share a
 * heading, which the counts beside it tell apart.
 *
 * A name it is not given is left out rather than replaced here — the phrase for
 * a member the roster no longer holds is `groupClosedRuns`'s, which is where
 * the null arrives from, so there is one place that decides what to call
 * somebody who is gone.
 */
export function finishedLabel(closedAt, closedByName, timeZone) {
  const at = new Date(closedAt ?? '')
  const date = Number.isNaN(at.getTime())
    ? null
    : new Intl.DateTimeFormat('en-US', {
        ...(timeZone ? { timeZone } : {}),
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(at)
  const finished = date ? `Finished ${date}` : 'Finished'
  return closedByName ? `${finished} by ${closedByName}` : finished
}

/**
 * The closed runs of one or more lists, grouped by list and newest first — the
 * arithmetic behind the Past runs disclosure (#359 AC 3).
 *
 * Pure, and it is the only place the history's shape is decided: which run
 * belongs to which list, what order they read in, how many items were bought
 * and how many went forward, and which member's name goes on each stamp. The
 * component is handed the answer and formats it, so a test of the rule needs no
 * DOM and a test of the screen needs no roster arithmetic.
 *
 * NEWEST FIRST, by `closed_at` — the run a person is looking for is the one
 * they just finished, and `Done.jsx` made the same choice about weeks for the
 * same reason. Ties break on id, which the app cannot produce (one open run per
 * list, closed one at a time) and which is asserted anyway: a comparator that
 * returned 0 for two different rows would leave the order to the read, and the
 * read's order is not one this function chose.
 *
 * A RUN'S closer resolves to 'a former member' where the roster no longer holds
 * them (`0032`'s `on delete set null`), and an ITEM's buyer resolves to null.
 * That asymmetry is deliberate rather than an oversight: "Finished Sep 5, 2026
 * by …" needs a subject or it dangles, while a bought item already has #355's
 * wording for a buyer who has left ("bought · 4:02 PM"), and inventing a second
 * sentence for it here would say the same thing two ways.
 *
 * Items keep the READ's order — added, oldest first — because a closed run is
 * the record of what the household put on that list, in the order it put it
 * there. #355's sink-the-bought-rows ordering is about a person standing in a
 * shop, and there is nobody standing in a shop here.
 */
export function groupClosedRuns(runs, items, members) {
  const roster = new Map((members ?? []).filter((m) => m?.id).map((m) => [m.id, m]))
  const firstName = (memberId) => {
    const member = memberId ? roster.get(memberId) : null
    return member ? firstNameOf(member.display_name) : null
  }

  const byList = new Map()
  for (const run of runs ?? []) {
    // `closed_at` is the predicate everywhere in this feature, so a caller that
    // handed over an open run gets it dropped rather than drawn as history.
    if (!run?.closed_at) continue
    const rows = (items ?? []).filter((item) => item?.run_id === run.id)
    const listId = run.list_id ?? null
    if (!byList.has(listId)) byList.set(listId, [])
    byList.get(listId).push({
      id: run.id,
      listId,
      closedAt: run.closed_at,
      closedByName: firstName(run.closed_by_member_id) ?? 'a former member',
      bought: rows.filter((item) => item.purchased_at).length,
      carried: rows.filter((item) => !item.purchased_at).length,
      items: rows.map((item) => ({ ...item, boughtByName: firstName(item.purchased_by_member_id) })),
    })
  }

  // The groups are returned in the order the runs arrived, because the caller
  // looks its own list up by id — one list is on screen at a time (#358) and no
  // screen shows two histories. The order WITHIN a group is the rule above.
  return [...byList.entries()].map(([listId, group]) => ({
    listId,
    runs: group.sort((a, b) => {
      const byStamp = stampOrder(b.closedAt, a.closedAt)
      if (byStamp !== 0) return byStamp
      return String(a.id) < String(b.id) ? -1 : 1
    }),
  }))
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
 * admitting more states. #359's `readClosedRuns` is the other half of exactly
 * this predicate, and it is deliberately not called from here: see its own
 * docblock for why history is read on a disclosure rather than on arrival.
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
 * The CLOSED runs of the named lists, and their items — #359.
 *
 * The mirror image of `readShopping`'s middle read (`.is('closed_at', null)`),
 * against the same tables with the same column constants, so nothing here is a
 * new grant, a new table or a new migration: history is the rows the client
 * already reads, asked for by the other half of one predicate.
 *
 * NOT part of `refresh()`, and that is the story's one deliberate departure
 * from this app's read-on-arrival discipline. Every other read on this surface
 * runs on every arrival because what it returns is bounded by what a household
 * is doing this week; closed runs are bounded by nothing and grow by one per
 * trip forever, so paying for them on every tab press would make the Shop tab
 * slower every week whether or not anybody ever looks. It is read when the Past
 * runs disclosure is OPENED, which is the moment somebody asked.
 *
 * The freshness that costs is stated rather than hidden: a run another phone
 * finished after this disclosure was opened is not here until it is opened
 * again — the same thing decision 3 (re-read on open, no Realtime) already says
 * about every other row on this surface, one level down.
 *
 * Two reads and never an embed, for the reason the docblock at the head of this
 * file gives: a filter written against an embedded resource is applied to the
 * EMBED, so the parent row comes back with the embed nulled and the count never
 * moves.
 */
export async function readClosedRuns(client, listIds) {
  const ids = (listIds ?? []).filter(Boolean)
  if (ids.length === 0) throw new Error('Which list? A history read must name one.')

  const runs = unwrap(
    await client
      .from('shopping_runs')
      .select(SHOPPING_RUN_COLUMNS)
      .in('list_id', ids)
      .not('closed_at', 'is', null),
    'loading finished runs',
  ) ?? []

  const runIds = runs.map((run) => run.id)
  if (runIds.length === 0) return { runs: [], items: [] }

  const items = unwrap(
    await client
      .from('shopping_items')
      .select(SHOPPING_ITEM_COLUMNS)
      .in('run_id', runIds)
      .order('added_at', { ascending: true })
      .order('id', { ascending: true }),
    'loading finished run items',
  ) ?? []

  return { runs, items }
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
    listName,
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
 * Remove an unbought item from an open run — an RPC since #368, and no longer
 * a delete this client is allowed to issue.
 *
 * It was `from('shopping_items').delete().eq('id', …)` under `0032`'s
 * `shopping_items_delete_unbought_on_open_run` policy, which refused a bought
 * item or a closed run by matching zero rows. What a policy cannot do is take
 * a LOCK: a remove that arrived while a finish held the item as a carry source
 * waited for the finish and then deleted the original under a predicate
 * evaluated on its own older snapshot, so the closed run lost its record of an
 * item while the copy survived on the next run with `carried_from_item_id`
 * nulled. `0034` makes this the fourth `security definer` writer of
 * `shopping_items`, taking the run row `for key share` first like the other
 * three, and withdraws the client's DELETE grant and the policy in the same
 * file.
 *
 * It REFUSES BY NAME rather than affecting nothing (owner decision at this
 * story's gate): `run already closed` and `item already bought`, the family's
 * own sentences, which App's `mutate()` puts on the error strip. The caller
 * still re-reads on success, as it did before.
 */
export async function removeItem(client, itemId) {
  if (!itemId) throw new Error('Which item?')
  unwrap(await client.rpc('remove_shopping_item', { item: itemId }), 'removing the item')
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
    listName,
  )
}

/**
 * Put a list away — #360. Nothing is deleted and nothing is closed: the list
 * keeps its empty open run and every finished run it ever had, and the picker
 * stops drawing it.
 *
 * An RPC rather than an update, and the client holds no update grant on
 * `archived_at` at all — because the stamp is only safe to write once
 * somebody has checked the list's open run is empty, and that check has to
 * happen under the run's lock (`0035`). A client `update` could not take one.
 *
 * The refusal a person can act on is `finish or clear this run first`, and both
 * ways out are already on the screen they are looking at.
 */
export async function archiveList(client, listId) {
  if (!listId) throw new Error('Which list?')
  return unwrap(
    await client.rpc('archive_shopping_list', { list: listId }),
    'archiving the list',
  )
}

/** Bring an archived list back. Clears the stamp and moves nothing else. */
export async function unarchiveList(client, listId) {
  if (!listId) throw new Error('Which list?')
  return unwrap(
    await client.rpc('unarchive_shopping_list', { list: listId }),
    'bringing the list back',
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
