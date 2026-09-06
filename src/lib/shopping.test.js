import { describe, expect, it } from 'vitest'
import {
  firstNameOf,
  orderShoppingItems,
  orderShoppingLists,
  purchasedLabel,
  replaceShoppingItem,
  resolveSelectedListId,
} from './shopping.js'

// The shopping data layer's PURE half — story #353 opens the file with the one
// helper the Shop tab needs; #355's `orderShoppingItems` lands beside it. The
// impure half (what the module sends, and with what) is shopping.io.test.js.

/**
 * An item, named by what it is FOR in the ordering rather than by a fixture
 * name: these tests are about position, so the assertions read on ids.
 */
const item = (id, addedAt, purchasedAt = null) => ({
  id,
  run_id: 'r1',
  household_id: 'h1',
  name: `item ${id}`,
  note: null,
  added_by_member_id: 'm1',
  added_at: addedAt,
  purchased_at: purchasedAt,
  purchased_by_member_id: purchasedAt ? 'm1' : null,
  carried_from_item_id: null,
})

const idsOf = (rows) => rows.map((row) => row.id)

describe('firstNameOf', () => {
  it('takes the first word of a display name', () => {
    expect(firstNameOf('Placeholder One')).toBe('Placeholder')
    expect(firstNameOf('Robin')).toBe('Robin')
  })

  it('trims, and collapses the whitespace a person typed', () => {
    expect(firstNameOf('  Placeholder   One ')).toBe('Placeholder')
  })

  it('returns null for nothing, so a caller can leave the line out rather than print "added by"', () => {
    for (const bad of ['', '   ', null, undefined]) expect(firstNameOf(bad)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// #355 AC 1 — the ordering rule, which is the moment the epic protects.
// ---------------------------------------------------------------------------
describe('orderShoppingItems', () => {
  it('puts every unbought item above every bought one, whatever order they arrive in', () => {
    const rows = [
      item('bought-early', '2026-09-05T01:00:00Z', '2026-09-05T10:00:00Z'),
      item('unbought-late', '2026-09-05T04:00:00Z'),
      item('bought-late', '2026-09-05T02:00:00Z', '2026-09-05T11:00:00Z'),
      item('unbought-early', '2026-09-05T03:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(rows))).toEqual([
      'unbought-early',
      'unbought-late',
      'bought-early',
      'bought-late',
    ])
  })

  it('keeps the unbought half in added order, oldest first — the order the read already used', () => {
    const rows = [
      item('third', '2026-09-05T03:00:00Z'),
      item('first', '2026-09-05T01:00:00Z'),
      item('second', '2026-09-05T02:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(rows))).toEqual(['first', 'second', 'third'])
  })

  it('orders the bought half by purchase time, so the thing just ticked is at the VERY bottom', () => {
    // Added in one order and bought in another, which is the ordinary case in
    // a store: you find things in the order the aisles are laid out. Without
    // this the bought half would still be in added order and the row that just
    // moved would land in the middle of the cart.
    const rows = [
      item('bought-second', '2026-09-05T01:00:00Z', '2026-09-05T12:00:00Z'),
      item('bought-first', '2026-09-05T02:00:00Z', '2026-09-05T11:00:00Z'),
      item('bought-third', '2026-09-05T03:00:00Z', '2026-09-05T13:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(rows))).toEqual([
      'bought-first',
      'bought-second',
      'bought-third',
    ])
  })

  it('an empty list orders to an empty list, and a missing one to the same', () => {
    expect(orderShoppingItems([])).toEqual([])
    expect(orderShoppingItems(null)).toEqual([])
    expect(orderShoppingItems(undefined)).toEqual([])
  })

  it('all bought, and all unbought, each keep their own order and nothing is dropped', () => {
    const allUnbought = [
      item('b', '2026-09-05T02:00:00Z'),
      item('a', '2026-09-05T01:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(allUnbought))).toEqual(['a', 'b'])

    const allBought = [
      item('b', '2026-09-05T01:00:00Z', '2026-09-05T12:00:00Z'),
      item('a', '2026-09-05T02:00:00Z', '2026-09-05T11:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(allBought))).toEqual(['a', 'b'])
  })

  it('equal stamps keep the order they arrived in — the read already broke that tie by id', () => {
    // Two items added in the same transaction share `added_at` to the
    // microsecond. `readShopping` orders by `added_at, id`, so the caller's
    // order IS the tie-break and this must not invent a different one.
    const rows = [
      item('second-by-id', '2026-09-05T01:00:00Z'),
      item('first-by-id', '2026-09-05T01:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(rows))).toEqual(['second-by-id', 'first-by-id'])

    const bought = [
      item('ticked-second', '2026-09-05T01:00:00Z', '2026-09-05T12:00:00Z'),
      item('ticked-first', '2026-09-05T02:00:00Z', '2026-09-05T12:00:00Z'),
    ]
    expect(idsOf(orderShoppingItems(bought))).toEqual(['ticked-second', 'ticked-first'])
  })

  it('a carried item, whose added_at predates the run it is on, sorts to the TOP of the unbought half', () => {
    // #354 copies `added_at` forward when it carries an unbought item into the
    // next run, so a carried item's stamp is older than that run's opened_at.
    // Nothing here compares a stamp with the run, which is why the rule falls
    // out rather than needing a case: what was missed last week is what you
    // came for this week, and it is at the top of the screen.
    const carried = item('carried', '2026-09-01T09:00:00Z')
    const addedToday = item('added-today', '2026-09-05T09:00:00Z')
    expect(idsOf(orderShoppingItems([addedToday, carried]))).toEqual(['carried', 'added-today'])
  })

  it('reads the same instant spelled two ways as the same instant', () => {
    // PostgREST spells a timestamptz with an offset; a lexical compare would
    // order `…+00:00` before `…Z` on punctuation alone and move a row for it.
    const zulu = item('zulu', '2026-09-05T01:00:00Z')
    const offset = item('offset', '2026-09-05T01:00:00+00:00')
    expect(idsOf(orderShoppingItems([zulu, offset]))).toEqual(['zulu', 'offset'])
    expect(idsOf(orderShoppingItems([offset, zulu]))).toEqual(['offset', 'zulu'])
  })

  it('an unreadable stamp leaves the row where it was rather than moving it on a value nothing could read', () => {
    const broken = item('broken', 'not a timestamp')
    const good = item('good', '2026-09-05T01:00:00Z')
    expect(idsOf(orderShoppingItems([good, broken]))).toEqual(['good', 'broken'])
    expect(idsOf(orderShoppingItems([broken, good]))).toEqual(['broken', 'good'])
  })

  it('does not mutate what it was handed — the caller keeps the read it holds', () => {
    const rows = [
      item('bought', '2026-09-05T01:00:00Z', '2026-09-05T12:00:00Z'),
      item('unbought', '2026-09-05T02:00:00Z'),
    ]
    const before = idsOf(rows)
    orderShoppingItems(rows)
    expect(idsOf(rows)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// #355 AC 9 — the one-round-trip re-read: the RPC's own answer IS the re-read.
// ---------------------------------------------------------------------------
describe('replaceShoppingItem', () => {
  it('swaps the row the server returned for the one on screen, and touches nothing else', () => {
    const rows = [item('a', '2026-09-05T01:00:00Z'), item('b', '2026-09-05T02:00:00Z')]
    const stamped = { ...rows[1], purchased_at: '2026-09-05T12:00:00Z', purchased_by_member_id: 'm2' }
    const next = replaceShoppingItem(rows, stamped)
    expect(next).toHaveLength(2)
    expect(next[0]).toBe(rows[0])
    expect(next[1]).toBe(stamped)
    // And the array handed in is untouched.
    expect(rows[1].purchased_at).toBeNull()
  })

  it('an id the list does not hold returns the SAME array — a response is not a licence to invent a row', () => {
    const rows = [item('a', '2026-09-05T01:00:00Z')]
    expect(replaceShoppingItem(rows, item('elsewhere', '2026-09-05T02:00:00Z'))).toBe(rows)
    expect(replaceShoppingItem(rows, null)).toBe(rows)
    expect(replaceShoppingItem(rows, {})).toBe(rows)
  })

  it('survives a missing list', () => {
    expect(replaceShoppingItem(null, item('a', '2026-09-05T01:00:00Z'))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// #355 AC 3 — what a bought row says, off the row and never off the clock.
// ---------------------------------------------------------------------------
describe('purchasedLabel', () => {
  it('reads "bought by <first name> · <time>" in the household’s zone', () => {
    // 22:02 UTC is 6:02 PM in New York, and the zone is the household's for the
    // same reason every other date on this app is spelled in it.
    expect(purchasedLabel('2026-09-05T22:02:00Z', 'Robin', 'America/New_York')).toBe(
      'bought by Robin · 6:02 PM',
    )
  })

  it('the SAME stamp reads differently in a different household zone — the stamp is the instant, not the wall clock', () => {
    expect(purchasedLabel('2026-09-05T22:02:00Z', 'Robin', 'UTC')).toBe('bought by Robin · 10:02 PM')
  })

  it('a buyer the roster no longer holds still gets the time, without inventing a name', () => {
    expect(purchasedLabel('2026-09-05T22:02:00Z', null, 'UTC')).toBe('bought · 10:02 PM')
  })

  it('returns null for a missing or unreadable stamp, so the caller leaves the line out', () => {
    for (const bad of [null, undefined, '', 'whenever']) {
      expect(purchasedLabel(bad, 'Robin', 'UTC')).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// #358 — the two rules the picker rests on, both pure and both here rather than
// in the component: WHAT ORDER the lists are drawn in, and WHICH one is on
// screen. The component is handed both answers, which is why it can be tested
// by rendering a list and an id rather than by simulating a household change.
// ---------------------------------------------------------------------------

/** A list row, named by what the ordering is about. */
const listRow = (id, name) => ({
  id,
  household_id: 'h1',
  name,
  created_at: '2026-09-05T00:00:00Z',
})

describe('orderShoppingLists', () => {
  it('orders by name, whatever order the read returned them in', () => {
    // The ids DISAGREE with the name order on purpose. They agreed in the first
    // draft, and a mutation that deleted the name comparison outright still
    // produced this expectation from the id tie-break alone — the test could
    // not tell the ordering it is named after from the fallback under it.
    const rows = [listRow('l1', 'Hardware'), listRow('l2', 'Bakery'), listRow('l3', 'Groceries')]
    expect(idsOf(orderShoppingLists(rows))).toEqual(['l2', 'l3', 'l1'])
  })

  it('ignores case, the way the unique index that keeps the names apart does', () => {
    // A lower-case name that sorts FIRST, which is the only pair that can tell
    // a case-insensitive collation from a code-unit compare: 'B' is 66 and 'a'
    // is 97, so a naive `<` puts Bakery first. The first draft used
    // 'hardware'/'Groceries', where both answers agree.
    const rows = [listRow('l1', 'apples'), listRow('l2', 'Bakery')]
    expect(idsOf(orderShoppingLists(rows))).toEqual(['l1', 'l2'])
    expect(idsOf(orderShoppingLists([listRow('l1', 'hardware'), listRow('l2', 'Groceries')]))).toEqual([
      'l2',
      'l1',
    ])
  })

  it('is TOTAL: two rows that compare equal by name still order by id, every time', () => {
    // The unique index makes this unreachable through the app, which is exactly
    // why it is asserted — a comparator returning 0 here would leave the order
    // to the read, and the read's order is not one this function chose.
    const rows = [listRow('l2', 'Groceries'), listRow('l1', 'groceries')]
    expect(idsOf(orderShoppingLists(rows))).toEqual(['l1', 'l2'])
    expect(idsOf(orderShoppingLists([...rows].reverse()))).toEqual(['l1', 'l2'])
  })

  it('copies rather than sorting the read in place', () => {
    const rows = [listRow('l2', 'Hardware'), listRow('l1', 'Groceries')]
    orderShoppingLists(rows)
    expect(idsOf(rows)).toEqual(['l2', 'l1'])
  })

  it('survives nothing to order and a row with no name', () => {
    expect(orderShoppingLists(null)).toEqual([])
    expect(orderShoppingLists([])).toEqual([])
    expect(idsOf(orderShoppingLists([listRow('l1', undefined), listRow('l2', 'Groceries')]))).toEqual(
      ['l1', 'l2'],
    )
  })
})

describe('resolveSelectedListId', () => {
  const lists = [listRow('l1', 'Groceries'), listRow('l2', 'Hardware')]

  it('honours a preference that names a list on screen', () => {
    expect(resolveSelectedListId(lists, 'l2')).toBe('l2')
  })

  it('falls back to the FIRST of the order it is given, not to the read order', () => {
    // The caller hands over ordered lists, so "first by name" is settled before
    // this function sees them — and a caller that ordered differently gets its
    // own first, which is what makes the two rules composable.
    expect(resolveSelectedListId(lists, null)).toBe('l1')
    expect(resolveSelectedListId([...lists].reverse(), null)).toBe('l2')
  })

  it('falls back for all three of AC 6’s cases, which it cannot tell apart', () => {
    // Nothing chosen yet; a household change (a preference from the other
    // household's lists); a list that is gone after a re-read.
    for (const stale of [null, undefined, 'l9', '']) {
      expect(resolveSelectedListId(lists, stale)).toBe('l1')
    }
  })

  it('answers null when there is no list at all, rather than inventing one', () => {
    expect(resolveSelectedListId([], 'l1')).toBeNull()
    expect(resolveSelectedListId(null, 'l1')).toBeNull()
  })
})
