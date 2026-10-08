// App's tests for the Shop tab. Split out of `App.test.jsx` by #553; every
// describe below moved verbatim with the comment above it. The fakes, the
// `vi.mock` calls and the shared `beforeEach` are in
// `src/test/support/appHarness.jsx`, which must stay the FIRST import.
import { api, shoppingApi, SHOPPING_CLIENT, EMPTY_SHOPPING, renderApp } from './test/support/appHarness.jsx'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// #353 — the Shop tab: the write path, the re-read, and WHICH household.
//
// What the surface DRAWS is Shopping.test.jsx's. These cover what only App can
// answer: that the create, add and remove go through the data layer and are
// followed by a re-read; that a refused write reaches the strip and patches
// nothing; and that the household on screen is the one the read names.
// ---------------------------------------------------------------------------
describe('#353 — the Shop tab, from App', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
  }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const list = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const run = {
    id: 'r1',
    list_id: 'l1',
    household_id: 'h1',
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  }
  const milk = {
    id: 'i1',
    run_id: 'r1',
    household_id: 'h1',
    name: 'Milk',
    note: null,
    added_by_member_id: 'm2',
    added_at: '2026-09-05T01:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  }
  const emptyList = { lists: [list], runs: [run], items: [] }
  const withMilk = { lists: [list], runs: [run], items: [milk] }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  const shop = () => screen.getByRole('region', { name: 'Shop' })

  it('AC 3: with no list, opening the tab writes nothing; Create goes through createList in the household on screen, then re-reads', async () => {
    await renderApp('Shop')
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('Groceries')
    expect(shoppingApi.createList).not.toHaveBeenCalled()

    // The next read returns the list the tap made, with its empty open run.
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/create list/i)

    expect(shoppingApi.createList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.createList).toHaveBeenCalledWith(SHOPPING_CLIENT, household.id, 'Groceries')
    // Written, then re-read — the full refresh, not a patch from the answer.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.createList.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(1)
    // And the screen is what the re-read said: the list, empty, above its form.
    expect(screen.queryByLabelText(/^list name$/i)).not.toBeInTheDocument()
    const empty = within(shop()).getByText(/nothing to buy yet/i)
    const form = screen.getByLabelText(/^item$/i).closest('form')
    expect(empty.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('AC 4: adding an item goes through addItem with the run, the name and null for an omitted note, re-reads, clears the form, and names the adder from the roster', async () => {
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    await renderApp('Shop')
    expect(within(shop()).getByText(/nothing to buy yet/i)).toBeInTheDocument()

    shoppingApi.readShopping.mockResolvedValue(withMilk)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await tab(/add item/i)

    expect(shoppingApi.addItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.addItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'r1', 'Milk', null)
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.addItem.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )
    // The item is on screen from the RE-READ (its adder is m2, which the form
    // never knew), the form is clear, and the adder is the roster's word.
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('added by Robin')
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 4: an empty item name is refused with a sentence before any call', async () => {
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/add item/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(shoppingApi.addItem).not.toHaveBeenCalled()
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
  })

  it('AC 5: Remove goes through removeItem with the item, then re-reads, and the item is gone', async () => {
    shoppingApi.readShopping.mockResolvedValue(withMilk)
    await renderApp('Shop')
    expect(within(shop()).getByText('Milk')).toBeInTheDocument()

    shoppingApi.readShopping.mockResolvedValue(emptyList)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/remove milk/i)

    expect(shoppingApi.removeItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.removeItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(within(shop()).queryByText('Milk')).not.toBeInTheDocument()
    expect(within(shop()).getByText(/nothing to buy yet/i)).toBeInTheDocument()
  })

  it('AC 5: bought on another phone between render and tap — the delete affects nothing, the re-read shows it bought, and no error is shown', async () => {
    shoppingApi.readShopping.mockResolvedValue(withMilk)
    await renderApp('Shop')
    expect(within(shop()).getByRole('button', { name: /remove milk/i })).toBeInTheDocument()

    // The policy admits only an unbought item, so the delete resolves having
    // touched zero rows — which is what a resolved `removeItem` IS here — and
    // the re-read returns the row with the other phone's stamp on it.
    shoppingApi.readShopping.mockResolvedValue({
      ...withMilk,
      items: [{ ...milk, purchased_at: '2026-09-05T02:00:00Z', purchased_by_member_id: 'm1' }],
    })
    await tab(/remove milk/i)

    expect(shoppingApi.removeItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent(/bought/)
    expect(within(row).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 6: a refused add reaches the strip outside the list, and nothing local is patched', async () => {
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    await renderApp('Shop')
    shoppingApi.addItem.mockRejectedValue(new Error('adding the item: run already closed'))
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await tab(/add item/i)

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('adding the item: run already closed')
    expect(alert.closest('ul, li, form')).toBeNull()
    // No re-read followed a failed write, the item is not on the list, and the
    // form still holds what was typed — the two-arm handler patched nothing.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(within(shop()).queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('Milk')
    expect(within(shop()).getByText(/nothing to buy yet/i)).toBeInTheDocument()
  })

  it('AC 7: with the seeded person in two households, the Shop tab shows only the ACTIVE household’s lists and items', async () => {
    // The #160 fixture shape: person-a holds a member row in both, and each
    // household has its own list with its own item. The fake scopes by the
    // household id it is handed — so an App that named the wrong household,
    // or none, draws the wrong list or nothing.
    const householdA = { id: 'household-a', name: 'Placeholder Household', timezone: 'America/New_York' }
    const householdB = { id: 'household-b', name: 'Placeholder Other Household', timezone: 'America/New_York' }
    const shopA = {
      lists: [{ ...list, id: 'la', household_id: 'household-a', name: 'Groceries' }],
      runs: [{ ...run, id: 'ra', list_id: 'la', household_id: 'household-a' }],
      items: [{ ...milk, id: 'ia', run_id: 'ra', household_id: 'household-a', name: 'Milk' }],
    }
    const shopB = {
      lists: [{ ...list, id: 'lb', household_id: 'household-b', name: 'Hardware' }],
      runs: [{ ...run, id: 'rb', list_id: 'lb', household_id: 'household-b' }],
      items: [{ ...milk, id: 'ib', run_id: 'rb', household_id: 'household-b', name: 'Bread' }],
    }
    api.listMembers.mockImplementation(async (id) =>
      id === householdA.id
        ? [{ id: 'm-a1', household_id: 'household-a', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }]
        : id === householdB.id
          ? [{ id: 'm-b1', household_id: 'household-b', display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' }]
          : [],
    )
    shoppingApi.readShopping.mockImplementation(async (_client, id) =>
      id === householdA.id ? shopA : id === householdB.id ? shopB : EMPTY_SHOPPING,
    )

    api.listHouseholds.mockResolvedValue([householdA])
    await renderApp('Shop')
    expect(within(shop()).getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    expect(within(shop()).getByText('Milk')).toBeInTheDocument()
    expect(within(shop()).queryByText('Bread')).not.toBeInTheDocument()
    expect(within(shop()).queryByText('Hardware')).not.toBeInTheDocument()

    // The active household changes; the next re-read (arriving on the tab
    // again) must draw B's list and nothing of A's.
    api.listHouseholds.mockResolvedValue([householdB])
    await tab('Shop')
    expect(within(shop()).getByRole('heading', { level: 3 })).toHaveTextContent('Hardware')
    expect(within(shop()).getByText('Bread')).toBeInTheDocument()
    expect(within(shop()).queryByText('Milk')).not.toBeInTheDocument()
    expect(within(shop()).queryByText('Groceries')).not.toBeInTheDocument()
    expect(shoppingApi.readShopping).toHaveBeenLastCalledWith(SHOPPING_CLIENT, householdB.id)
  })

  it('AC 8 (#35 AC 9): nothing on the surface counts, ranks or scores who added what', async () => {
    shoppingApi.readShopping.mockResolvedValue({
      ...withMilk,
      items: [milk, { ...milk, id: 'i2', name: 'Eggs' }, { ...milk, id: 'i3', name: 'Bread', added_by_member_id: 'm1' }],
    })
    await renderApp('Shop')
    const text = shop().textContent
    expect(text).not.toMatch(/streak|rank|score|points|leaderboard|best|winner|most/i)
    expect(text).not.toMatch(/\b\d+\s+(items?|added|by)\b/i)
    expect(shop()).not.toHaveTextContent(/m1|m2/)
  })
})

// ---------------------------------------------------------------------------
// #355 — the tick, from App: which RPC, with which item, and what the screen
// does with the answer.
//
// This is the story's own re-read decision made visible. Every other write on
// this surface goes through `mutate()` and re-reads everything; the tick does
// not, because #351 measured that route at 6.5 s on Slow 4G against a 1 s bar.
// So the assertions here are in two halves: the happy path must NOT re-read
// (one round trip, the RPC's own row) and the refusal path MUST (the one
// moment this phone knows its picture is stale).
// ---------------------------------------------------------------------------
describe('#355 — the tick, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const list = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const run = {
    id: 'r1',
    list_id: 'l1',
    household_id: 'h1',
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  }
  const milk = {
    id: 'i1',
    run_id: 'r1',
    household_id: 'h1',
    name: 'Milk',
    note: null,
    added_by_member_id: 'm2',
    added_at: '2026-09-05T01:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  }
  const eggs = { ...milk, id: 'i2', name: 'Eggs', added_at: '2026-09-05T02:00:00Z' }
  /** What `purchase_shopping_item` returns: the same row, stamped. */
  const milkBought = {
    ...milk,
    purchased_at: '2026-09-05T05:00:00Z',
    purchased_by_member_id: 'm1',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue({ lists: [list], runs: [run], items: [milk, eggs] })
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  const shop = () => screen.getByRole('region', { name: 'Shop' })
  const rowNames = () =>
    Array.from(shop().querySelectorAll('.shopping-item__name')).map((node) => node.textContent)

  it('AC 8 + AC 9: a tick sends purchaseItem with THAT item id, and the RPC’s own row is the re-read — one round trip, no readShopping', async () => {
    await renderApp('Shop')
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    shoppingApi.purchaseItem.mockResolvedValue(milkBought)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    const rosterReadsBefore = api.listMembers.mock.calls.length

    await tab(/mark milk bought/i)

    // The RPC, named, with the item — not the run, not the first row on screen.
    expect(shoppingApi.purchaseItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.purchaseItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    // ONE round trip. The owner's decision at this story's pickup: a full
    // refresh per tick measured 6.5 s at Slow 4G against a 1 s bar.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(api.listMembers.mock.calls.length).toBe(rosterReadsBefore)
    // And the screen is what the RPC answered: the row sank below Eggs and
    // carries the stamp the SERVER wrote (m1, 05:00 UTC → 1:00 AM in New York),
    // neither of which this phone knew before the call.
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('bought by Placeholder · 1:00 AM')
    expect(row).toHaveClass('shopping-item--bought')
    expect(within(shop()).getByText('1 left to buy')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 8 + AC 4: untick sends unpurchaseItem with that item, and the cleared row it returns goes back into added order', async () => {
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [run],
      items: [milkBought, eggs],
    })
    await renderApp('Shop')
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
    shoppingApi.unpurchaseItem.mockResolvedValue(milk)
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    const boughtRow = within(shop()).getByText('Milk').closest('li')
    await act(async () =>
      void fireEvent.click(within(boughtRow).getByRole('button', { name: /not bought after all/i })),
    )

    expect(shoppingApi.unpurchaseItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.unpurchaseItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    expect(shoppingApi.purchaseItem).not.toHaveBeenCalled()
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    // Milk was added before Eggs, so it goes back ABOVE it, and the stamp is
    // gone because the row the server returned has no stamp on it.
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    expect(within(shop()).getByText('Milk').closest('li')).not.toHaveTextContent(/bought by/)
    expect(within(shop()).getByText('2 left to buy')).toBeInTheDocument()
  })

  it('AC 8: another phone got there first — the refusal reaches the strip OUTSIDE the list, and the full re-read shows their stamp with the row in the bought half', async () => {
    await renderApp('Shop')
    shoppingApi.purchaseItem.mockRejectedValue(
      new Error('marking it bought: item already bought'),
    )
    // What the full re-read returns: the OTHER phone's stamp (m2, Robin), which
    // this phone could not have invented from its own tap.
    const theirs = { ...milk, purchased_at: '2026-09-05T04:30:00Z', purchased_by_member_id: 'm2' }
    shoppingApi.readShopping.mockResolvedValue({ lists: [list], runs: [run], items: [theirs, eggs] })
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/mark milk bought/i)

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('marking it bought: item already bought')
    expect(alert.closest('ul, li')).toBeNull()
    // The refusal is the one moment the picture is known to be stale, so THIS
    // path re-reads everything — the opposite of the happy path above.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('bought by Robin · 12:30 AM')
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
    // The refusal's own sentence is still what is on screen after the re-read.
    expect(within(shop()).getByRole('alert')).toHaveTextContent('item already bought')
  })

  it('AC 7: a second tap while the first tick is in flight sends nothing', async () => {
    await renderApp('Shop')
    let finish
    shoppingApi.purchaseItem.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )

    await tab(/mark milk bought/i)
    // In flight: every control on the surface is disabled, which is what makes
    // the second tap impossible rather than merely unlikely.
    expect(screen.getByRole('button', { name: /mark eggs bought/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove milk/i })).toBeDisabled()
    await tab(/mark eggs bought/i)
    expect(shoppingApi.purchaseItem).toHaveBeenCalledTimes(1)

    await act(async () => finish(milkBought))
    expect(screen.getByRole('button', { name: /mark eggs bought/i })).not.toBeDisabled()
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
  })
})

// ---------------------------------------------------------------------------
// #357 — finishing the run, from App: which RPC with which argument, that it
// goes through `mutate()` (unlike the tick above), and what the screen shows
// after the re-read.
//
// The confirm itself is Shopping.test.jsx's. What only this level can answer is
// that the write is followed by a FULL re-read and that the screen is then the
// server's answer — a DIFFERENT run, carrying the items that were not bought —
// rather than anything this phone patched. The refusal half is the mirror: the
// one rejection `0033` is built to raise means another phone finished first, so
// the picture is stale and this path re-reads too.
// ---------------------------------------------------------------------------
describe('#357 — finishing a run, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const list = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const run = {
    id: 'r1',
    list_id: 'l1',
    household_id: 'h1',
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  }
  const milk = {
    id: 'i1',
    run_id: 'r1',
    household_id: 'h1',
    name: 'Milk',
    note: null,
    added_by_member_id: 'm2',
    added_at: '2026-09-05T01:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  }
  const eggs = { ...milk, id: 'i2', name: 'Eggs', added_at: '2026-09-05T02:00:00Z' }
  /** Bought on this trip, so it stays on the run being closed. */
  const boughtBread = {
    ...milk,
    id: 'i3',
    name: 'Bread',
    added_at: '2026-09-05T03:00:00Z',
    purchased_at: '2026-09-05T04:00:00Z',
    purchased_by_member_id: 'm1',
  }

  /** What `finish_shopping_run` returns and opens: the list's NEXT run. */
  const nextRun = { ...run, id: 'r2', opened_at: '2026-09-05T06:00:00Z' }
  /**
   * What the re-read then finds on it — `0033`'s copies. New ids, the
   * ORIGINAL's adder and `added_at` (which is why they are at the top), the
   * purchase columns null, and `carried_from_item_id` pointing back.
   */
  const carriedMilk = { ...milk, id: 'i4', run_id: 'r2', carried_from_item_id: 'i1' }
  const carriedEggs = { ...eggs, id: 'i5', run_id: 'r2', carried_from_item_id: 'i2' }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [run],
      items: [milk, eggs, boughtBread],
    })
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  const shop = () => screen.getByRole('region', { name: 'Shop' })
  const rowNames = () =>
    Array.from(shop().querySelectorAll('.shopping-item__name')).map((node) => node.textContent)

  /** Open the confirm and take the confirming tap. */
  const finishTheRun = async () => {
    await tab(/done shopping/i)
    await tab(/^finish$/i)
  }

  it('AC 1: the first tap calls no RPC at all — the io fake records zero calls', async () => {
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/done shopping/i)

    expect(shoppingApi.finishRun).not.toHaveBeenCalled()
    // Not the read either: a question is not a round trip.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(within(shop()).getByText(/2 items not bought will carry over/)).toBeInTheDocument()
  })

  it('AC 3: the confirming tap sends finishRun with the run on screen, once, then re-reads — and the screen is the NEW run', async () => {
    await renderApp('Shop')
    expect(rowNames()).toEqual(['Milk', 'Eggs', 'Bread'])
    shoppingApi.finishRun.mockResolvedValue(nextRun)
    // The re-read the server's answer produces: the next run, holding only the
    // two that were not bought.
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [nextRun],
      items: [carriedMilk, carriedEggs],
    })
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await finishTheRun()

    expect(shoppingApi.finishRun).toHaveBeenCalledTimes(1)
    // The RUN, and the client — never the list id, which is what a second
    // phone resolving afresh would have closed.
    expect(shoppingApi.finishRun).toHaveBeenCalledWith(SHOPPING_CLIENT, 'r1')
    // Through mutate(): written, THEN re-read. Unlike the tick, which does not.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.finishRun.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )

    // The two unbought items carried, on top, unpurchased and marked; the
    // bought one is gone with the run it was bought on. #359 is where that run
    // becomes readable again — this tab does not fetch it.
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    for (const name of ['Milk', 'Eggs']) {
      const row = within(shop()).getByText(name).closest('li')
      expect(row).toHaveTextContent('from last run')
      expect(row).not.toHaveClass('shopping-item--bought')
      expect(row).not.toHaveTextContent(/bought by/)
    }
    expect(within(shop()).queryByText('Bread')).not.toBeInTheDocument()
    expect(within(shop()).getByText('2 left to buy')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The confirm is gone with the run it was about, and the tab offers the
    // next trip's control against the new run.
    expect(screen.queryByText(/carry over to the next list/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /done shopping/i })).toBeInTheDocument()
  })

  it('AC 5: another phone finished first — the refusal reaches the strip OUTSIDE the list, and the re-read shows THEIR run', async () => {
    await renderApp('Shop')
    shoppingApi.finishRun.mockRejectedValue(
      new Error('finishing the run: run already closed'),
    )
    // What the re-read finds: the run the OTHER phone opened, with the items
    // it carried — neither of which this phone could have invented.
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [nextRun],
      items: [carriedMilk, carriedEggs],
    })
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await finishTheRun()

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('finishing the run: run already closed')
    // Outside the list, like every other refused write on this surface.
    expect(alert.closest('ul, li')).toBeNull()
    // `mutate()` does not re-read after a failure; this path does, because a
    // refusal here means the run on screen no longer exists.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    expect(within(shop()).getByText('Milk').closest('li')).toHaveTextContent('from last run')
    // The refusal's own sentence is still what is on screen after the re-read.
    expect(within(shop()).getByRole('alert')).toHaveTextContent('run already closed')
  })

  it('AC 5: any other rejection leaves the run open with its items intact, and patches nothing', async () => {
    await renderApp('Shop')
    shoppingApi.finishRun.mockRejectedValue(new Error('finishing the run: not authenticated'))
    // The server state did not move, so the re-read returns what was there.
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await finishTheRun()

    expect(within(shop()).getByRole('alert')).toHaveTextContent('not authenticated')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Same run, same three rows, same order, and the bought one still bought.
    expect(rowNames()).toEqual(['Milk', 'Eggs', 'Bread'])
    expect(within(shop()).getByText('Bread').closest('li')).toHaveClass('shopping-item--bought')
    expect(within(shop()).getByText('2 left to buy')).toBeInTheDocument()
    // Nothing was marked as carried: a client that patched a finish locally
    // would have had to invent the copies.
    expect(shop()).not.toHaveTextContent(/from last run/)
  })

  it('AC 5: a re-read that itself fails leaves the refusal on screen rather than replacing it', async () => {
    await renderApp('Shop')
    shoppingApi.finishRun.mockRejectedValue(
      new Error('finishing the run: run already closed'),
    )
    shoppingApi.readShopping.mockRejectedValue(new Error('loading shopping lists: network down'))

    await finishTheRun()

    // The refusal explains what happened; a complaint about a read the person
    // did not ask for would replace the answer with a symptom.
    expect(within(shop()).getByRole('alert')).toHaveTextContent('run already closed')
    expect(screen.queryByText(/network down/)).not.toBeInTheDocument()
  })

  it('AC 1 + AC 7: every control on the surface is disabled while the finish is in flight', async () => {
    await renderApp('Shop')
    let settle
    shoppingApi.finishRun.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )

    await finishTheRun()
    expect(screen.getByRole('button', { name: /mark milk bought/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^finish$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /keep shopping/i })).toBeDisabled()
    // A second confirming tap while the first is in flight sends nothing.
    await tab(/^finish$/i)
    expect(shoppingApi.finishRun).toHaveBeenCalledTimes(1)

    await act(async () => settle(nextRun))
  })
})

// ---------------------------------------------------------------------------
// #358 — several named lists, from App.
//
// What the surface DRAWS is Shopping.test.jsx's, and which SQLSTATE the
// database raises is shopping.pglite.test.js's. These cover what only App can
// answer: that the two list writes go through the data layer with the right
// arguments and are followed by a re-read, that a refused one reaches the strip
// and patches nothing, and — the criterion no other level can reach — that the
// chosen list survives a tab switch and falls back when it names nothing.
// ---------------------------------------------------------------------------
describe('#358 — several named lists, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const other = { id: 'h2', name: 'Placeholder Other Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const groceries = {
    id: 'l1',
    household_id: 'h1',
    name: 'Groceries',
    created_at: '2026-09-05T00:00:00Z',
  }
  const hardware = {
    id: 'l2',
    household_id: 'h1',
    name: 'Hardware',
    created_at: '2026-09-06T00:00:00Z',
  }
  const runOf = (list, id) => ({
    id,
    list_id: list.id,
    household_id: list.household_id,
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  })
  const runA = runOf(groceries, 'r1')
  const runB = runOf(hardware, 'r2')
  // Read order is `created_at`, so the read hands them over oldest-first and
  // App is what sorts by name. Kept that way on purpose: a fixture already in
  // name order could not tell the ordering from the read.
  /**
   * One item per list, so a test can ask WHICH LIST WAS DRAWN and not only
   * which button is pressed. The picker's pressed state comes from the
   * preference; the rows come from the list on screen, and the mutation that
   * drew the wrong list moved the rows while leaving the button alone.
   */
  const item = (id, runId, name) => ({
    id,
    run_id: runId,
    household_id: 'h1',
    name,
    note: null,
    added_by_member_id: 'm1',
    added_at: '2026-09-06T10:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  })
  const twoLists = {
    lists: [groceries, hardware],
    runs: [runA, runB],
    items: [item('i1', 'r1', 'Milk'), item('i2', 'r2', 'Bread')],
  }
  const oneList = { lists: [groceries], runs: [runA], items: [item('i1', 'r1', 'Milk')] }
  /** The item names on screen, top to bottom — the list the tab actually drew. */
  const rowsOnScreen = () =>
    Array.from(document.querySelectorAll('.shopping-item__name')).map((n) => n.textContent)

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue(twoLists)
  })

  const tab = (name) => act(async () => void fireEvent.click(screen.getByRole('button', { name })))
  const picker = () =>
    Array.from(
      screen.getByRole('group', { name: /which list/i }).querySelectorAll('button'),
    ).map((b) => [b.querySelector('.shopping-picker__name').textContent, b.getAttribute('aria-pressed')])
  /**
   * The list on screen. With a picker up the heading stands down (the owner's
   * call at the design pass), so the pressed button is what names it; with one
   * list there is no picker and the heading is the name.
   */
  const heading = () => {
    const group = screen.queryByRole('group', { name: /which list/i })
    if (!group) return screen.getByRole('heading', { level: 3 }).textContent
    return group
      .querySelector('button[aria-pressed="true"]')
      .querySelector('.shopping-picker__name').textContent
  }
  /** Tap a picker button by its list NAME — its accessible name carries the count too. */
  const choose = (name) =>
    act(async () =>
      void fireEvent.click(
        Array.from(
          screen.getByRole('group', { name: /which list/i }).querySelectorAll('button'),
        ).find((b) => b.querySelector('.shopping-picker__name').textContent === name),
      ),
    )

  it('AC 1: orders the picker by NAME, whatever order the read returned', async () => {
    // Both of the read's own orders point the other way: `created_at` ascending
    // AND the id tie-break `orderShoppingLists` falls back on. The ids agreed
    // with the names in the first draft, and a mutation deleting the name
    // comparison outright still produced this expectation from the tie-break.
    const early = { ...hardware, id: 'la', created_at: '2026-09-01T00:00:00Z' }
    const late = { ...groceries, id: 'lb' }
    shoppingApi.readShopping.mockResolvedValue({
      lists: [early, late],
      runs: [runOf(early, 'r1'), runOf(late, 'r2')],
      items: [],
    })
    await renderApp('Shop')
    expect(picker().map(([name]) => name)).toEqual(['Groceries', 'Hardware'])
  })

  it('AC 1: creates the list through the data layer, re-reads, and lands the picker on the NEW one', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneList)
    await renderApp('Shop')
    expect(heading()).toBe('Groceries')

    // The write returns the row it made; the next read holds both lists.
    shoppingApi.createList.mockResolvedValue(hardware)
    shoppingApi.readShopping.mockResolvedValue(twoLists)
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/new list/i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'Hardware' } })
    await tab(/create list/i)

    expect(shoppingApi.createList).toHaveBeenCalledWith(SHOPPING_CLIENT, household.id, 'Hardware')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // The write is before the read, which is what makes the id resolvable.
    expect(shoppingApi.createList.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )
    // Second by name, and it is the one on screen — a list somebody just named
    // is the list they want to be looking at.
    await waitFor(() => expect(heading()).toBe('Hardware'))
    expect(picker()).toEqual([
      ['Groceries', 'false'],
      ['Hardware', 'true'],
    ])
  })

  it('AC 4: renames through the data layer with the list id, then re-reads', async () => {
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    shoppingApi.readShopping.mockResolvedValue({
      ...twoLists,
      lists: [{ ...groceries, name: 'Bakery' }, hardware],
    })

    await tab(/^rename /i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'Bakery' } })
    await tab(/save name/i)

    expect(shoppingApi.renameList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.renameList).toHaveBeenCalledWith(SHOPPING_CLIENT, 'l1', 'Bakery')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // The heading comes from the RE-READ, not from the field: the id did not
    // move, so the same list is on screen under its new name.
    await waitFor(() => expect(heading()).toBe('Bakery'))
  })

  it('AC 5: a refused rename puts the data layer’s sentence on the strip and changes nothing on screen', async () => {
    // WHICH sentence is shopping.js's, keyed on SQLSTATE 23505 and proved in
    // shopping.io.test.js; what only this level can say is that the refusal
    // reaches the strip and that nothing on the screen moved with it.
    shoppingApi.renameList.mockRejectedValue(
      new Error('You already have a list called Hardware.'),
    )
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/^rename /i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'Hardware' } })
    await tab(/save name/i)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You already have a list called Hardware.'),
    )
    // No re-read: `mutate()` re-reads only what it wrote, and nothing was
    // written. The editor is still open with the name that was refused.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('Hardware')
    expect(picker().map(([name]) => name)).toEqual(['Groceries', 'Hardware'])
  })

  it('AC 5: a refused create leaves the household on the list it had', async () => {
    shoppingApi.createList.mockRejectedValue(new Error('You already have a list called Hardware.'))
    await renderApp('Shop')

    await tab(/new list/i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'HARDWARE' } })
    await tab(/create list/i)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You already have a list called Hardware.'),
    )
    expect(heading()).toBe('Groceries')
    expect(picker()).toEqual([
      ['Groceries', 'true'],
      ['Hardware', 'false'],
    ])
  })

  it('AC 3: finishing names the chosen list’s run, and the other list comes back untouched', async () => {
    shoppingApi.finishRun.mockResolvedValue({ ...runB, id: 'r3' })
    await renderApp('Shop')
    await choose('Hardware')

    // The re-read after the finish: Hardware on a NEW run with nothing on it,
    // and Groceries exactly as it was — same run, same item.
    const fresh = { ...runB, id: 'r3' }
    shoppingApi.readShopping.mockResolvedValue({
      lists: [groceries, hardware],
      runs: [runA, fresh],
      items: [item('i1', 'r1', 'Milk')],
    })
    await tab(/done shopping/i)
    await tab(/^finish$/i)

    // The RUN, never the list — 0033's whole design, and what the fake records.
    expect(shoppingApi.finishRun).toHaveBeenCalledTimes(1)
    expect(shoppingApi.finishRun).toHaveBeenCalledWith(SHOPPING_CLIENT, 'r2')

    // And the other list is untouched by it: switch back and its row is there.
    await waitFor(() => expect(heading()).toBe('Hardware'))
    expect(rowsOnScreen()).toEqual([])
    await choose('Groceries')
    expect(rowsOnScreen()).toEqual(['Milk'])
  })

  it('AC 6: the chosen list survives a visit to another tab, in the same session', async () => {
    await renderApp('Shop')
    expect(heading()).toBe('Groceries')
    await choose('Hardware')
    expect(heading()).toBe('Hardware')

    // The component unmounts on the way out and mounts again on the way back —
    // which is the whole reason the choice is not held inside it.
    await tab('Chores')
    expect(screen.queryByRole('region', { name: 'Shop' })).not.toBeInTheDocument()
    await tab('Shop')
    expect(heading()).toBe('Hardware')
    expect(picker()).toEqual([
      ['Groceries', 'false'],
      ['Hardware', 'true'],
    ])
    // The BODY, not only the button: the rows on screen are the chosen list's.
    expect(rowsOnScreen()).toEqual(['Bread'])
  })

  it('AC 6: nothing is written for a choice — not to the server, not to storage', async () => {
    const wrote = []
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((...args) => void wrote.push(args))
    try {
      await renderApp('Shop')
      const reads = shoppingApi.readShopping.mock.calls.length
      await choose('Hardware')
      expect(heading()).toBe('Hardware')
      expect(shoppingApi.readShopping.mock.calls.length).toBe(reads)
      expect(wrote).toEqual([])
      for (const fn of [shoppingApi.createList, shoppingApi.renameList, shoppingApi.addItem]) {
        expect(fn).not.toHaveBeenCalled()
      }
    } finally {
      spy.mockRestore()
    }
  })

  it('AC 6: a list that is gone after a re-read falls back to the first by name', async () => {
    await renderApp('Shop')
    await choose('Hardware')
    expect(heading()).toBe('Hardware')

    // Another phone removed the list this one was looking at. The next re-read
    // — here the one an add drags behind it — no longer holds l2.
    shoppingApi.readShopping.mockResolvedValue(oneList)
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await tab(/add item/i)

    await waitFor(() => expect(heading()).toBe('Groceries'))
    expect(screen.queryByRole('group', { name: /which list/i })).not.toBeInTheDocument()
  })

  it('AC 6: the active household changing resets the choice to that household’s first list', async () => {
    await renderApp('Shop')
    await choose('Hardware')
    expect(heading()).toBe('Hardware')

    // The household on screen changes under the choice. Its lists are other
    // rows entirely, so the preference names nothing — one rule, three causes.
    const bakery = { id: 'l9', household_id: 'h2', name: 'Bakery', created_at: '2026-09-06T00:00:00Z' }
    api.listHouseholds.mockResolvedValue([other])
    shoppingApi.readShopping.mockResolvedValue({
      lists: [bakery],
      runs: [runOf(bakery, 'r9')],
      items: [],
    })
    await tab('Chores')
    await tab('Shop')

    await waitFor(() => expect(heading()).toBe('Bakery'))
  })
})

// ---------------------------------------------------------------------------
// #359 AC 4 — the history read, and the discipline it deliberately departs from.
//
// Every other read on this surface runs on arrival; this one runs when the Past
// runs disclosure is opened, because history is unbounded. Only App can answer
// either half — what the disclosure DRAWS is Shopping.test.jsx's, and which
// filters the read sends is shopping.io.test.js's.
// ---------------------------------------------------------------------------
describe('#359 — past runs, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const groceries = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const hardware = { id: 'l2', household_id: 'h1', name: 'Hardware', created_at: '2026-09-06T00:00:00Z' }
  const openRun = (list, id) => ({
    id,
    list_id: list.id,
    household_id: 'h1',
    opened_at: '2026-09-06T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  })
  const item = (id, runId, name, purchased = null) => ({
    id,
    run_id: runId,
    household_id: 'h1',
    name,
    note: null,
    added_by_member_id: 'm1',
    added_at: '2026-09-06T10:00:00Z',
    purchased_at: purchased,
    purchased_by_member_id: purchased ? 'm2' : null,
    carried_from_item_id: null,
  })
  const oneList = {
    lists: [groceries],
    runs: [openRun(groceries, 'r-open')],
    items: [item('i1', 'r-open', 'Milk')],
  }
  const twoLists = {
    lists: [groceries, hardware],
    runs: [openRun(groceries, 'r-open'), openRun(hardware, 'r-open-2')],
    items: [item('i1', 'r-open', 'Milk'), item('i2', 'r-open-2', 'Bread')],
  }
  /** One finished trip on the Groceries list: one bought, one carried forward. */
  const finished = {
    runs: [
      {
        id: 'r-closed',
        list_id: 'l1',
        household_id: 'h1',
        opened_at: '2026-09-04T00:00:00Z',
        closed_at: '2026-09-05T22:00:00Z',
        closed_by_member_id: 'm2',
      },
    ],
    items: [item('p1', 'r-closed', 'Eggs', '2026-09-05T21:02:00Z'), item('p2', 'r-closed', 'Butter')],
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue(oneList)
  })

  const tab = (name) => act(async () => void fireEvent.click(screen.getByRole('button', { name })))
  /**
   * Open the disclosure with a real tap, then let the platform's own `toggle`
   * arrive — jsdom queues it as a task, so a microtask-only flush reads zero
   * toggles and the read looks as though it never fired. The measurement behind
   * that sentence is in Shopping.test.jsx's own helper.
   */
  const openPast = async () => {
    fireEvent.click(screen.getByText('Past runs'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const history = () => screen.getByText('Past runs').closest('details')

  it('does NOT read the history on arrival, on a re-arrival, or on a write — only on the disclosure', async () => {
    await renderApp('Shop')
    expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(0)
    expect(shoppingApi.readClosedRuns).not.toHaveBeenCalled()

    // A second arrival, which is a full re-read of everything else.
    await tab('Chores')
    await tab('Shop')
    expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(1)
    expect(shoppingApi.readClosedRuns).not.toHaveBeenCalled()

    // And a write, which drags a re-read behind it through mutate().
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Bread' } })
    await tab(/add item/i)
    expect(shoppingApi.addItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.readClosedRuns).not.toHaveBeenCalled()
  })

  it('reads it when the disclosure opens, naming the list on screen and its client', async () => {
    shoppingApi.readClosedRuns.mockResolvedValue(finished)
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await openPast()

    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(1)
    // The LIST, as an array of one — the read filters `.in('list_id', …)`, and
    // the household's other lists are not what somebody just asked about.
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledWith(SHOPPING_CLIENT, ['l1'])
    // It is a read: nothing goes through mutate(), so nothing else is re-read.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)

    // And what came back is on the screen, with the roster resolved and the
    // household's zone applied — 21:02 UTC is 5:02 PM in New York.
    expect(within(history()).getByRole('heading', { level: 4 })).toHaveTextContent(
      'Finished Sep 5, 2026 by Robin',
    )
    expect(within(history()).getByText('Eggs').closest('li')).toHaveTextContent(
      'bought by Robin · 5:02 PM',
    )
    expect(within(history()).getByText('Butter').closest('li')).toHaveTextContent('carried over')
  })

  it('reads the list the picker is on, not the household’s first', async () => {
    shoppingApi.readShopping.mockResolvedValue(twoLists)
    await renderApp('Shop')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Hardware/ })))
    await openPast()
    expect(shoppingApi.readClosedRuns).toHaveBeenLastCalledWith(SHOPPING_CLIENT, ['l2'])
  })

  it('a refused history read reports itself on the strip and shows no rows', async () => {
    shoppingApi.readClosedRuns.mockRejectedValue(
      new Error('loading finished runs: permission denied'),
    )
    await renderApp('Shop')
    await openPast()

    expect(
      within(screen.getByRole('region', { name: 'Shop' })).getByRole('alert'),
    ).toHaveTextContent(/loading finished runs: permission denied/)
    // Not "reading…" forever, and not the last answer either: a failure clears
    // the rows rather than leaving somebody looking at a history nothing here
    // can vouch for.
    expect(screen.queryByText(/reading the finished runs/i)).not.toBeInTheDocument()
    expect(within(history()).queryByRole('heading', { level: 4 })).not.toBeInTheDocument()
  })

  it('finishing a run closes the disclosure, so nobody reads a history from before the trip ended', async () => {
    await renderApp('Shop')
    await openPast()
    expect(history()).toHaveAttribute('open')
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(1)

    // One list draws ONE finish control. This is the assertion that caught the
    // duplicate React key — `PastRuns` and `FinishRun` are siblings, and while
    // both were keyed on the run id React rendered three of them.
    expect(document.querySelectorAll('.shopping-finish')).toHaveLength(1)

    // The trip ends: the RPC returns the new run and the re-read shows it.
    const nextRun = openRun(groceries, 'r-next')
    shoppingApi.finishRun.mockResolvedValue(nextRun)
    shoppingApi.readShopping.mockResolvedValue({ lists: [groceries], runs: [nextRun], items: [] })
    await tab(/done shopping/i)
    await tab(/^finish$/i)

    // Keyed on the open run, so a new run remounts it closed — and the run that
    // just closed is now part of the history, which the next open re-reads.
    await waitFor(() => expect(history()).not.toHaveAttribute('open'))
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(1)
    await openPast()
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// #360 — putting a list away, from App.
//
// The half only App can answer: that both writes go through `mutate()` (write,
// then a full re-read), and that the list the picker shows follows the read
// rather than a second copy of it. What the tab DRAWS for an archived list is
// Shopping.test.jsx's, what the module sends is shopping.io.test.js's, and what
// the database refuses is archive-shopping-list.pglite.test.js's.
//
// The fallback is the interesting one and it is asserted nowhere else:
// archiving the list on screen leaves `shoppingListId` naming a list the
// visible set no longer holds, and `resolveSelectedListId` is what turns that
// into "the first active list by name" rather than an empty tab.
// ---------------------------------------------------------------------------
describe('#360 — archiving a list, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const groceries = {
    id: 'l1',
    household_id: 'h1',
    name: 'Groceries',
    created_at: '2026-09-05T00:00:00Z',
    archived_at: null,
  }
  const hardware = {
    id: 'l2',
    household_id: 'h1',
    name: 'Hardware',
    created_at: '2026-09-06T00:00:00Z',
    archived_at: null,
  }
  const AWAY = '2026-09-06T12:00:00Z'
  const openRunOf = (list, id) => ({
    id,
    list_id: list.id,
    household_id: list.household_id,
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  })
  const runA = openRunOf(groceries, 'r1')
  const runB = openRunOf(hardware, 'r2')
  // Both runs are EMPTY, which is not a convenience: `0035` refuses an archive
  // while the open run holds anything, so a fixture with items on the list
  // being archived would be a state the database cannot produce.
  const twoLists = { lists: [groceries, hardware], runs: [runA, runB], items: [] }
  /** The same household after Hardware has been put away. */
  const oneAway = {
    lists: [groceries, { ...hardware, archived_at: AWAY }],
    runs: [runA, runB],
    items: [],
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue(twoLists)
  })

  const tab = (name) => act(async () => void fireEvent.click(screen.getByRole('button', { name })))
  const shop = () => screen.getByRole('region', { name: 'Shop' })
  const pickerNames = () => {
    const group = screen.queryByRole('group', { name: /which list/i })
    if (!group) return null
    return Array.from(group.querySelectorAll('.shopping-picker__name')).map((n) => n.textContent)
  }

  it('AC 3: Archive goes through archiveList with the list on screen, then re-reads', async () => {
    await renderApp('Shop')
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
    // Onto the SECOND list, so the id this asserts is the one on screen rather
    // than the first by name — which is what the tab lands on and what a
    // handler passing the wrong thing would most likely send.
    await tab(/^hardware/i)

    shoppingApi.readShopping.mockResolvedValue(oneAway)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/^archive hardware$/i)

    expect(shoppingApi.archiveList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.archiveList).toHaveBeenCalledWith(SHOPPING_CLIENT, 'l2')
    // Through mutate(): written, THEN re-read. The write is what changes which
    // lists exist, so a screen that did not re-read would be showing the answer
    // from before the tap.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.archiveList.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder.at(-1),
    )
  })

  it('AC 3: the archived list leaves the picker, and the tab falls back to the first active list', async () => {
    await renderApp('Shop')
    // Stand on Hardware, so the list being archived is the one on screen —
    // the only case where the fallback has anything to do.
    await tab(/^hardware/i)
    expect(screen.getByRole('button', { name: /^archive hardware$/i })).toBeInTheDocument()

    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await tab(/^archive hardware$/i)

    // One visible list, so #358's one-button rule takes the picker away and the
    // heading carries the name again.
    await waitFor(() => expect(pickerNames()).toBeNull())
    expect(within(shop()).getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    expect(within(shop()).queryByText(/put away/i)).not.toBeInTheDocument()
    // And the way back is offered, with the count.
    expect(screen.getByRole('button', { name: 'Show archived (1)' })).toBeInTheDocument()
  })

  it('AC 3: revealing the archived lists puts them back in the picker and lets one be chosen', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await renderApp('Shop')
    expect(pickerNames()).toBeNull()

    await tab('Show archived (1)')
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
    // Nothing was written to reveal them — it is a view change.
    expect(shoppingApi.archiveList).not.toHaveBeenCalled()
    expect(shoppingApi.unarchiveList).not.toHaveBeenCalled()

    await tab(/^hardware/i)
    expect(within(shop()).getByText(/put away/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive Hardware' })).toBeInTheDocument()
    // An archived list on screen offers none of the working controls.
    expect(within(shop()).queryByLabelText(/^item$/i)).not.toBeInTheDocument()
  })

  it('AC 3: Unarchive goes through unarchiveList, re-reads, and the list comes back working', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await renderApp('Shop')
    await tab('Show archived (1)')
    await tab(/^hardware/i)

    shoppingApi.readShopping.mockResolvedValue(twoLists)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/^unarchive hardware$/i)

    expect(shoppingApi.unarchiveList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.unarchiveList).toHaveBeenCalledWith(SHOPPING_CLIENT, 'l2')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Still the list on screen — it was in the visible set under both settings
    // of the toggle — and it works again.
    expect(within(shop()).queryByText(/put away/i)).not.toBeInTheDocument()
    expect(within(shop()).getByLabelText(/^item$/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument()
  })

  it('the toggle survives a tab switch, because which list this phone is looking at is not a fact about the household', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await renderApp('Shop')
    await tab('Show archived (1)')
    await tab(/^hardware/i)
    expect(within(shop()).getByText(/put away/i)).toBeInTheDocument()

    // `Shopping` unmounts on a tab switch, so a toggle held inside it would
    // last exactly as long as the person stayed on the screen.
    await tab(/^chores$/i)
    await tab(/^shop$/i)
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
    expect(within(shop()).getByText(/put away/i)).toBeInTheDocument()
  })

  it('AC 3: a refused archive reaches the strip outside the list, and nothing is re-read', async () => {
    await renderApp('Shop')
    await tab(/^hardware/i)
    shoppingApi.archiveList.mockRejectedValue(
      new Error('archiving the list: finish or clear this run first'),
    )
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/^archive hardware$/i)

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('archiving the list: finish or clear this run first')
    expect(alert.closest('ul, li, form')).toBeNull()
    // `mutate()` does not re-read after a failed write, and the picker is
    // exactly where it was.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
  })

  it('a household whose only list is archived is not told it has none', async () => {
    shoppingApi.readShopping.mockResolvedValue({
      lists: [{ ...groceries, archived_at: AWAY }],
      runs: [runA],
      items: [],
    })
    await renderApp('Shop')
    expect(within(shop()).queryByText(/no shopping list yet/i)).not.toBeInTheDocument()
    expect(within(shop()).getByText(/every list is put away/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show archived (1)' })).toBeInTheDocument()
  })
})
