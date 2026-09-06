import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Shopping from './Shopping.jsx'

// #353 — the Shop tab: what a person sees and which handler a gesture reaches.
//
// Everything about WHICH household is read, the re-read on arrival and the
// error strip's wiring is App's and lives in App.test.jsx; what the DATABASE
// refuses (a delete of a bought item affecting zero rows) is
// shopping.pglite.test.js's. This file proves the surface: the empty state is
// a form and not a write, the add form refuses before calling, the item row
// names its adder from the roster, a bought item offers no Remove, and nothing
// here counts anybody. Names are synthetic — see #19.

const members = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'device-a' },
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
const eggs = {
  ...milk,
  id: 'i2',
  name: 'Eggs',
  note: 'a dozen',
  added_by_member_id: 'm1',
  added_at: '2026-09-05T02:00:00Z',
}
/** Bought on another phone between this one's read and its next tap. */
const boughtBread = {
  ...milk,
  id: 'i3',
  name: 'Bread',
  added_at: '2026-09-05T03:00:00Z',
  purchased_at: '2026-09-05T04:00:00Z',
  purchased_by_member_id: 'm1',
}

function setup(overrides = {}) {
  const handlers = {
    onCreateList: vi.fn().mockResolvedValue(undefined),
    onAddItem: vi.fn().mockResolvedValue(undefined),
    onRemoveItem: vi.fn().mockResolvedValue(undefined),
    onPurchaseItem: vi.fn().mockResolvedValue(undefined),
    onUnpurchaseItem: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Shopping
      lists={[list]}
      runs={[run]}
      items={[milk, eggs]}
      members={members}
      timezone="America/New_York"
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

/** The rendered rows, top to bottom, as the names they show — #355. */
const rowNames = () =>
  Array.from(screen.getByRole('list').querySelectorAll('.shopping-item__name')).map(
    (node) => node.textContent,
  )

const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

/** The whole surface: the region the h2 names. */
const surface = () => screen.getByRole('region', { name: 'Shop' })

describe('#353 AC 3 — the empty state is a form, and nothing is written without a tap', () => {
  it('offers a name field prefilled Groceries and a Create control when there is no list', () => {
    const { onCreateList } = setup({ lists: [], runs: [], items: [] })
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('Groceries')
    expect(screen.getByRole('button', { name: /create list/i })).toBeInTheDocument()
    // Rendering is a read. The write is the tap.
    expect(onCreateList).not.toHaveBeenCalled()
    // And the add form is not offered: there is no run to add to yet.
    expect(screen.queryByLabelText(/^item$/i)).not.toBeInTheDocument()
  })

  it('creates the list with the name in the field, once, on the tap', async () => {
    const { onCreateList } = setup({ lists: [], runs: [], items: [] })
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: ' Hardware ' } })
    await clickAndSettle(screen.getByRole('button', { name: /create list/i }))
    expect(onCreateList).toHaveBeenCalledTimes(1)
    expect(onCreateList).toHaveBeenCalledWith('Hardware')
  })

  it('refuses an empty list name with a sentence before any call', async () => {
    const { onCreateList } = setup({ lists: [], runs: [], items: [] })
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: '   ' } })
    await clickAndSettle(screen.getByRole('button', { name: /create list/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onCreateList).not.toHaveBeenCalled()
  })

  it('a list with an empty open run reads "Nothing to buy yet" ABOVE the add form', () => {
    setup({ items: [] })
    expect(screen.queryByLabelText(/^list name$/i)).not.toBeInTheDocument()
    const empty = screen.getByText(/nothing to buy yet/i)
    const form = screen.getByLabelText(/^item$/i).closest('form')
    expect(empty.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The list's own name is the heading the items sit under.
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
  })

  it('a list whose run is closed (none open) says so rather than vanishing, and offers no add form', () => {
    setup({ runs: [], items: [] })
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    expect(screen.getByText(/no open run/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^item$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nothing to buy yet/i)).not.toBeInTheDocument()
  })
})

describe('#353 AC 4 — adding an item', () => {
  it('sends the run id, the trimmed name and null for an omitted note', async () => {
    const { onAddItem } = setup()
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: '  Bread ' } })
    await clickAndSettle(screen.getByRole('button', { name: /add item/i }))
    expect(onAddItem).toHaveBeenCalledTimes(1)
    expect(onAddItem).toHaveBeenCalledWith('r1', 'Bread', null)
  })

  it('sends the note, trimmed, when one is given', async () => {
    const { onAddItem } = setup()
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Bread' } })
    fireEvent.change(screen.getByLabelText(/note or quantity/i), { target: { value: ' two ' } })
    await clickAndSettle(screen.getByRole('button', { name: /add item/i }))
    expect(onAddItem).toHaveBeenCalledWith('r1', 'Bread', 'two')
  })

  it('refuses an empty name with a sentence before any call', async () => {
    const { onAddItem } = setup()
    fireEvent.change(screen.getByLabelText(/note or quantity/i), { target: { value: 'two' } })
    await clickAndSettle(screen.getByRole('button', { name: /add item/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onAddItem).not.toHaveBeenCalled()
  })

  it('clears the form once the handler resolves, and not before', async () => {
    let finish
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    setup({ onAddItem: vi.fn().mockReturnValue(pending) })
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Bread' } })
    fireEvent.change(screen.getByLabelText(/note or quantity/i), { target: { value: 'two' } })
    await clickAndSettle(screen.getByRole('button', { name: /add item/i }))
    // Still pending — the write and the re-read have not landed.
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('Bread')
    expect(screen.getByLabelText(/note or quantity/i)).toHaveValue('two')
    await act(async () => finish())
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('')
    expect(screen.getByLabelText(/note or quantity/i)).toHaveValue('')
  })

  it('keeps the typed text when the handler rejects — nothing is patched locally', async () => {
    setup({ onAddItem: vi.fn().mockRejectedValue(new Error('adding the item: run already closed')) })
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Bread' } })
    await clickAndSettle(screen.getByRole('button', { name: /add item/i }))
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('Bread')
    // The message is App's to show, through the `error` prop; the form itself
    // raises no alert of its own for a server refusal.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Bread')).not.toBeInTheDocument()
  })

  it('names who added each item, by first name, resolved from the roster by added_by_member_id', () => {
    setup()
    const milkRow = screen.getByText('Milk').closest('li')
    const eggsRow = screen.getByText('Eggs').closest('li')
    // m2 is Robin; m1 is "Placeholder One", whose first name is Placeholder.
    expect(milkRow).toHaveTextContent('added by Robin')
    expect(eggsRow).toHaveTextContent('added by Placeholder')
    expect(eggsRow).not.toHaveTextContent('added by Placeholder One')
    // The note rides on the row.
    expect(eggsRow).toHaveTextContent('a dozen')
    // And the id itself never surfaces.
    expect(surface()).not.toHaveTextContent(/m1|m2/)
  })

  it('SYNTHETIC CONTROL: an adder the roster no longer holds gets no "added by" line', () => {
    // The FK nulls the stamp when a member is removed; the row survives with
    // nobody to name. Without this, the assertion above would also pass on a
    // component that named the first member of the roster for every item.
    setup({ items: [{ ...milk, added_by_member_id: null }] })
    const row = screen.getByText('Milk').closest('li')
    expect(row).not.toHaveTextContent(/added by/)
  })
})

describe('#353 AC 5 — removing an item', () => {
  it('Remove on an unbought item calls the handler with that item, and nothing else', async () => {
    const { onRemoveItem, onAddItem, onCreateList } = setup()
    await clickAndSettle(screen.getByRole('button', { name: /remove milk/i }))
    expect(onRemoveItem).toHaveBeenCalledTimes(1)
    expect(onRemoveItem).toHaveBeenCalledWith('i1')
    expect(onAddItem).not.toHaveBeenCalled()
    expect(onCreateList).not.toHaveBeenCalled()
  })

  it('a bought item renders no Remove control, and reads as bought', () => {
    setup({ items: [milk, boughtBread] })
    const breadRow = screen.getByText('Bread').closest('li')
    expect(within(breadRow).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(breadRow).toHaveTextContent(/bought/)
    expect(breadRow).toHaveClass('shopping-item--bought')
    // The unbought neighbour still offers its Remove — the absence is per row.
    const milkRow = screen.getByText('Milk').closest('li')
    expect(within(milkRow).getByRole('button', { name: /remove milk/i })).toBeInTheDocument()
    expect(milkRow).not.toHaveTextContent(/bought/)
    expect(milkRow).not.toHaveClass('shopping-item--bought')
  })

  it('the controls are disabled while a write is in flight', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: /remove milk/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /add item/i })).toBeDisabled()
  })
})

describe('#353 AC 8 — no per-person count, rank or score of who added what; and the error strip', () => {
  it('carries no streak, rank, score, per-person total or per-person item count', () => {
    // Two items added by one person and one by another, and no figure
    // anywhere saying "2". The only number-shaped things on this surface are
    // in a note a person typed.
    setup({ items: [milk, eggs, { ...boughtBread, added_by_member_id: 'm2' }] })
    const text = surface().textContent
    expect(text).not.toMatch(/streak|rank|score|points|leaderboard|best|winner|most/i)
    expect(text).not.toMatch(/\b\d+\s+(items?|added|by)\b/i)
    expect(text).not.toMatch(/(added|items?)\s*[:×x]\s*\d+/i)
    expect(surface()).not.toHaveTextContent(/m1|m2/)
  })

  it('nothing in the list is styled as an error or an alert', () => {
    setup({ items: [milk, eggs, boughtBread] })
    expect(within(surface()).queryByRole('alert')).not.toBeInTheDocument()
    expect(surface().querySelector('.error')).toBeNull()
  })

  it('reports a failed write beside the list, outside it', () => {
    setup({ error: 'the server said no' })
    const alert = within(surface()).getByRole('alert')
    expect(alert).toHaveTextContent('the server said no')
    expect(alert.closest('ul, li, form')).toBeNull()
    const region = screen.getByRole('region', { name: 'Groceries' })
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('the count line is about the LIST and never about a person', () => {
    // Two items added by Robin and one by Placeholder, so a component that
    // counted per person would have "2" and "1" to print beside a name.
    setup({ items: [milk, { ...eggs, added_by_member_id: 'm2' }, boughtBread] })
    const count = within(surface()).getByText(/left to buy/)
    expect(count).toHaveTextContent('2 left to buy')
    // The figure names the LIST's remainder and nobody: no name of a person
    // appears on the line the number is on.
    expect(count).not.toHaveTextContent(/Robin|Placeholder/)
    expect(surface().textContent).not.toMatch(
      /streak|rank|score|points|leaderboard|best|winner|most/i,
    )
  })

  it('draws every list the read returns, each under its own name, so none is hidden', () => {
    const hardware = { ...list, id: 'l2', name: 'Hardware' }
    const hardwareRun = { ...run, id: 'r2', list_id: 'l2' }
    const screws = { ...milk, id: 'i9', run_id: 'r2', name: 'Bread' }
    setup({
      lists: [list, hardware],
      runs: [run, hardwareRun],
      items: [milk, screws],
    })
    const groceries = screen.getByRole('region', { name: 'Groceries' })
    const other = screen.getByRole('region', { name: 'Hardware' })
    expect(within(groceries).getByText('Milk')).toBeInTheDocument()
    expect(within(groceries).queryByText('Bread')).not.toBeInTheDocument()
    expect(within(other).getByText('Bread')).toBeInTheDocument()
    expect(within(other).queryByText('Milk')).not.toBeInTheDocument()
    // No create form: the household has lists.
    expect(screen.queryByRole('button', { name: /create list/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #355 — the tick, the order, and what a bought row says.
//
// The ORDERING RULE itself is shopping.test.js's (pure, exhaustive, and where
// the mutation lands). What only this level can answer is that the rendered
// DOM is in that order, that the row's primary control reaches the purchase
// handler with THIS item, and that a bought row offers the way back.
// ---------------------------------------------------------------------------

/** Bought earlier than boughtBread, so the two have an order between them. */
const boughtButter = {
  ...milk,
  id: 'i4',
  name: 'Butter',
  added_at: '2026-09-05T00:30:00Z',
  purchased_at: '2026-09-05T03:30:00Z',
  purchased_by_member_id: 'm2',
}

describe('#355 AC 5 — bought items sink, and the top of the screen is what is left to find', () => {
  it('renders unbought first in added order and bought last in purchase order', () => {
    // Handed in deliberately shuffled: the component may not lean on the order
    // the read happened to use.
    setup({ items: [boughtBread, eggs, boughtButter, milk] })
    expect(rowNames()).toEqual(['Milk', 'Eggs', 'Butter', 'Bread'])
  })

  it('SIX items of which THREE are bought — the AC’s own fixture, by row identity', () => {
    const rice = { ...milk, id: 'i5', name: 'Rice', added_at: '2026-09-05T05:00:00Z' }
    const boughtFlour = {
      ...milk,
      id: 'i6',
      name: 'Flour',
      added_at: '2026-09-05T06:00:00Z',
      purchased_at: '2026-09-05T02:00:00Z',
      purchased_by_member_id: 'm1',
    }
    setup({ items: [boughtBread, rice, boughtButter, milk, boughtFlour, eggs] })
    expect(rowNames()).toEqual(['Milk', 'Eggs', 'Rice', 'Flour', 'Butter', 'Bread'])
    const rows = screen.getByRole('list').querySelectorAll('li')
    expect(rows).toHaveLength(6)
    // Three bought, and they are the LAST three — by identity, not by count.
    for (const [index, row] of [...rows].entries()) {
      expect(row.classList.contains('shopping-item--bought')).toBe(index >= 3)
    }
  })

  it('the FIRST rendered row is an unbought one, asserted by identity and not by counting', () => {
    setup({ items: [boughtBread, milk] })
    const rows = screen.getByRole('list').querySelectorAll('li')
    // Which row, not how many: a component that dropped every bought item
    // would satisfy a count and fail this.
    expect(rows[0].querySelector('.shopping-item__name').textContent).toBe('Milk')
    expect(rows[0]).not.toHaveClass('shopping-item--bought')
    expect(rows[1].querySelector('.shopping-item__name').textContent).toBe('Bread')
    expect(rows[1]).toHaveClass('shopping-item--bought')
    // Nothing was hidden to achieve the order.
    expect(rows).toHaveLength(2)
  })

  it('the order is the DOM order, not the stylesheet’s — no row is reordered visually', () => {
    setup({ items: [boughtBread, milk] })
    for (const row of screen.getByRole('list').querySelectorAll('li')) {
      expect(row.style.order).toBe('')
    }
  })
})

describe('#355 AC 3 — the tick', () => {
  it('the row’s primary control is a button naming what a tap will do', () => {
    setup({ items: [milk] })
    const control = screen.getByRole('button', { name: /mark milk bought/i })
    expect(control).toHaveClass('shopping-item__tick')
    // The item's own text rides inside the control, so the tap target is the
    // row rather than a checkbox beside it.
    expect(control).toHaveTextContent('Milk')
    expect(control).toHaveTextContent('added by Robin')
  })

  it('a tap sends purchaseItem for THAT item, and nothing else', async () => {
    const { onPurchaseItem, onUnpurchaseItem, onRemoveItem } = setup()
    await clickAndSettle(screen.getByRole('button', { name: /mark eggs bought/i }))
    expect(onPurchaseItem).toHaveBeenCalledTimes(1)
    expect(onPurchaseItem).toHaveBeenCalledWith('i2')
    expect(onUnpurchaseItem).not.toHaveBeenCalled()
    expect(onRemoveItem).not.toHaveBeenCalled()
  })

  it('a bought row reads the buyer and the time from the row’s own stamp', () => {
    setup({ items: [boughtBread] })
    const row = screen.getByText('Bread').closest('li')
    // m1 is "Placeholder One"; 04:00 UTC is midnight in New York.
    expect(row).toHaveTextContent('bought by Placeholder · 12:00 AM')
    expect(row).not.toHaveTextContent('Placeholder One')
    expect(row).toHaveClass('shopping-item--bought')
  })

  it('the stamp is the row’s, not the phone’s: the same row in another zone reads another time', () => {
    // Without this, a component that formatted `new Date()` would pass every
    // assertion above on the day the test runs.
    setup({ items: [boughtBread], timezone: 'UTC' })
    expect(screen.getByText('Bread').closest('li')).toHaveTextContent(
      'bought by Placeholder · 4:00 AM',
    )
  })

  it('a buyer the roster no longer holds keeps the time and names nobody', () => {
    setup({ items: [{ ...boughtBread, purchased_by_member_id: null }] })
    const row = screen.getByText('Bread').closest('li')
    expect(row).toHaveTextContent(/bought · 12:00 AM/)
    expect(row).not.toHaveTextContent(/bought by/)
  })

  it('a bought row is not styled as an error or an alert — it is history, not a problem', () => {
    setup({ items: [milk, boughtBread] })
    expect(within(surface()).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Bread').closest('li').querySelector('.error')).toBeNull()
  })
})

describe('#355 AC 4 — not bought after all', () => {
  it('a bought row offers the reversal with no dialog, and it reaches unpurchaseItem with that item', async () => {
    const { onUnpurchaseItem, onPurchaseItem } = setup({ items: [milk, boughtBread] })
    const row = screen.getByText('Bread').closest('li')
    const back = within(row).getByRole('button', { name: /not bought after all/i })
    await clickAndSettle(back)
    // One tap, one call — no confirm step in between.
    expect(onUnpurchaseItem).toHaveBeenCalledTimes(1)
    expect(onUnpurchaseItem).toHaveBeenCalledWith('i3')
    expect(onPurchaseItem).not.toHaveBeenCalled()
  })

  it('an unbought row offers Remove and no reversal; a bought row the reversal and no Remove or tick', () => {
    setup({ items: [milk, boughtBread] })
    const milkRow = screen.getByText('Milk').closest('li')
    const breadRow = screen.getByText('Bread').closest('li')
    expect(within(milkRow).getByRole('button', { name: /remove milk/i })).toBeInTheDocument()
    expect(
      within(milkRow).queryByRole('button', { name: /not bought after all/i }),
    ).not.toBeInTheDocument()
    expect(within(breadRow).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(
      within(breadRow).queryByRole('button', { name: /mark .* bought/i }),
    ).not.toBeInTheDocument()
  })
})

describe('#355 AC 6 — how much is left', () => {
  it('counts the unbought items, and says so under the list’s name', () => {
    setup({ items: [milk, eggs, boughtBread] })
    expect(within(surface()).getByText('2 left to buy')).toBeInTheDocument()
  })

  it('says "Nothing left to buy" when every item is bought, and the list still shows them', () => {
    setup({ items: [boughtBread, boughtButter] })
    expect(within(surface()).getByText('Nothing left to buy')).toBeInTheDocument()
    expect(rowNames()).toEqual(['Butter', 'Bread'])
  })

  it('a run with no items at all keeps #353’s empty state and carries no count', () => {
    setup({ items: [] })
    expect(within(surface()).getByText(/nothing to buy yet/i)).toBeInTheDocument()
    expect(within(surface()).queryByText(/left to buy/)).not.toBeInTheDocument()
  })

  it('the list’s region is still named by the list alone, so a tick does not rename it', () => {
    setup({ items: [milk, boughtBread] })
    expect(screen.getByRole('region', { name: 'Groceries' })).toBeInTheDocument()
  })
})

describe('#355 AC 7 — a second tap while the first is in flight', () => {
  it('disables the tick, the reversal, Remove and the add form while busy', () => {
    setup({ items: [milk, boughtBread], busy: true })
    expect(screen.getByRole('button', { name: /mark milk bought/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /not bought after all/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove milk/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /add item/i })).toBeDisabled()
  })

  it('a disabled tick sends nothing when tapped', async () => {
    const { onPurchaseItem } = setup({ items: [milk], busy: true })
    await clickAndSettle(screen.getByRole('button', { name: /mark milk bought/i }))
    expect(onPurchaseItem).not.toHaveBeenCalled()
  })
})
