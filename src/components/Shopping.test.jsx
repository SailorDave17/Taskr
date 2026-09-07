import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

// #358 — the tab draws ONE list, the one `selectedListId` names, and App is
// what resolves that id from the read. So every render here names it too; a
// default of the single fixture list keeps the #353/#355/#357 arrangements
// saying what they said, and the picker tests below override it.
/**
 * #359 — nobody has opened the Past runs disclosure, which is every render
 * above this story's own tests. App holds this state; the component is handed
 * it, so a test of the history hands over rows rather than mocking a read.
 */
const NO_PAST = { loading: false, loaded: false, runs: [], items: [] }

function setup(overrides = {}) {
  const handlers = {
    onSelectList: vi.fn(),
    onCreateList: vi.fn().mockResolvedValue(undefined),
    onRenameList: vi.fn().mockResolvedValue(undefined),
    onAddItem: vi.fn().mockResolvedValue(undefined),
    onRemoveItem: vi.fn().mockResolvedValue(undefined),
    onPurchaseItem: vi.fn().mockResolvedValue(undefined),
    onUnpurchaseItem: vi.fn().mockResolvedValue(undefined),
    onFinishRun: vi.fn().mockResolvedValue(undefined),
    onOpenPastRuns: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Shopping
      lists={[list]}
      runs={[run]}
      items={[milk, eggs]}
      members={members}
      past={NO_PAST}
      timezone="America/New_York"
      selectedListId="l1"
      {...handlers}
      {...overrides}
    />,
  )
  // Handlers ONLY. Several tests below assert that a gesture wrote nothing by
  // walking `Object.values(...)`, so anything else returned here would be
  // asserted against as though it were a spy.
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

  // #353 asserted that EVERY list the read returns is drawn, each under its own
  // name — the honest shape while nothing could choose between them. #358
  // reverses it deliberately: one list is on screen and the picker is how the
  // others are reached. The claim underneath is the one that survives, and it
  // is the one worth keeping — an item belongs to exactly one list and is
  // never drawn under another.
  it('draws only the chosen list, and never another list’s items under its name', () => {
    const hardware = { ...list, id: 'l2', name: 'Hardware' }
    const hardwareRun = { ...run, id: 'r2', list_id: 'l2' }
    const screws = { ...milk, id: 'i9', run_id: 'r2', name: 'Bread' }
    setup({
      lists: [list, hardware],
      runs: [run, hardwareRun],
      items: [milk, screws],
      selectedListId: 'l2',
    })
    const other = screen.getByRole('region', { name: 'Hardware' })
    expect(within(other).getByText('Bread')).toBeInTheDocument()
    expect(within(other).queryByText('Milk')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Groceries' })).not.toBeInTheDocument()
    // No create FORM: the household has lists, so what it is offered is the
    // control that opens one.
    expect(screen.queryByRole('button', { name: /create list/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new list/i })).toBeInTheDocument()
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

// ---------------------------------------------------------------------------
// #357 — finishing the run: the one irreversible control on this surface.
//
// What only this level can answer is the two-step shape — that the first tap
// writes NOTHING and replaces the button with a sentence naming what carries
// over, that the way out restores the button having written nothing either,
// and that the confirming tap reaches the handler with the run THIS SCREEN is
// showing. What happens after the write — the re-read, the new run, the
// refusal path — is App.test.jsx's, because this component never sees it.
// ---------------------------------------------------------------------------

const doneShopping = () => screen.getByRole('button', { name: /done shopping/i })
const openConfirm = async () => clickAndSettle(doneShopping())

describe('#357 AC 1 — the first tap is a question, not a write', () => {
  it('offers "Done shopping" between the list and the add form when the run has items', () => {
    setup()
    const control = doneShopping()
    expect(control).toBeInTheDocument()
    // Directly under the list it is about, and ABOVE the add form — the owner's
    // call at this story's design pass, on a measurement: a bought row sinks,
    // so the last row a shopper ticks is near the top, and with this under the
    // two-field form a twelve-item trip meant 1,700px of scrolling back down.
    const items = screen.getByRole('list')
    const form = screen.getByLabelText(/^item$/i).closest('form')
    expect(items.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(control.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('replaces the button with a confirm naming the consequence, and calls nothing', async () => {
    const handlers = setup()
    await openConfirm()

    // Two unbought items, so two carry over. The number is the LIST's, and the
    // sentence says what happens to them rather than asking "are you sure".
    expect(
      within(surface()).getByText(
        'Finish this run? 2 items not bought will carry over to the next list.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^finish$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep shopping/i })).toBeInTheDocument()
    // REPLACES: the control that opened it is gone, so there is no second tap
    // on the same spot that would mean something different.
    expect(screen.queryByRole('button', { name: /done shopping/i })).not.toBeInTheDocument()
    // Nothing has been written — not the finish, and not anything else.
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('counts only the UNBOUGHT items, which is what the RPC carries', async () => {
    // Three items, one already in the cart. A component that counted rows
    // would say three, and the sentence would promise to carry something the
    // household has already bought.
    setup({ items: [milk, eggs, boughtBread] })
    await openConfirm()
    expect(
      within(surface()).getByText(
        'Finish this run? 2 items not bought will carry over to the next list.',
      ),
    ).toBeInTheDocument()
  })

  it('says one ITEM, singular, when exactly one is left', async () => {
    setup({ items: [milk, boughtBread] })
    await openConfirm()
    expect(
      within(surface()).getByText(
        'Finish this run? 1 item not bought will carry over to the next list.',
      ),
    ).toBeInTheDocument()
  })

  it('says nothing carries over when everything on the run is bought', async () => {
    setup({ items: [boughtBread] })
    await openConfirm()
    expect(within(surface()).getByText('Finish this run? Nothing carries over.')).toBeInTheDocument()
    // And the control is still offered: a run of bought items is a trip that
    // is finished, which is exactly when a person taps this.
    expect(screen.getByRole('button', { name: /^finish$/i })).toBeInTheDocument()
  })
})

describe('#357 AC 2 — keep shopping', () => {
  it('restores the button and writes nothing', async () => {
    const handlers = setup()
    await openConfirm()
    await clickAndSettle(screen.getByRole('button', { name: /keep shopping/i }))

    expect(doneShopping()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^finish$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/carry over to the next list/)).not.toBeInTheDocument()
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
    // The run is untouched: the same rows, in the same order.
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
  })
})

describe('#357 AC 3 — the confirming tap', () => {
  it('sends onFinishRun with the run on screen, once, and nothing else', async () => {
    const handlers = setup()
    await openConfirm()
    await clickAndSettle(screen.getByRole('button', { name: /^finish$/i }))

    expect(handlers.onFinishRun).toHaveBeenCalledTimes(1)
    // The RUN, never the list and never an item — `0033`'s whole design, and
    // what stops a stale screen closing a run it has not seen.
    expect(handlers.onFinishRun).toHaveBeenCalledWith('r1')
    expect(handlers.onFinishRun).not.toHaveBeenCalledWith('l1')
    for (const [name, handler] of Object.entries(handlers)) {
      if (name !== 'onFinishRun') expect(handler).not.toHaveBeenCalled()
    }
  })

  it('a carried item says so, from carried_from_item_id and not from its stamps', () => {
    // The mark is the COLUMN. A row whose `added_at` predates the run reads
    // identically to one that does not, and only the copy carries this.
    const carried = { ...milk, carried_from_item_id: 'i0' }
    setup({ items: [carried, eggs] })
    const carriedRow = screen.getByText('Milk').closest('li')
    expect(carriedRow).toHaveTextContent('from last run')
    // It rides beside the adder rather than replacing them: `0033` copies the
    // original's `added_by_member_id`, so the row still knows who wanted it.
    expect(carriedRow).toHaveTextContent('from last run · added by Robin')
    // SYNTHETIC CONTROL: the neighbour is an ordinary item and says nothing.
    // Without it, a component that printed the mark on every row would pass.
    expect(screen.getByText('Eggs').closest('li')).not.toHaveTextContent(/from last run/)
  })
})

describe('#357 AC 4 — an empty run offers no way to finish', () => {
  it('draws no "Done shopping" when the run has no items', () => {
    setup({ items: [] })
    expect(screen.queryByRole('button', { name: /done shopping/i })).not.toBeInTheDocument()
    // The empty state is unchanged — this is an absence, not a replacement.
    expect(within(surface()).getByText(/nothing to buy yet/i)).toBeInTheDocument()
  })

  it('draws none for a list with no open run either', () => {
    setup({ runs: [], items: [] })
    expect(screen.queryByRole('button', { name: /done shopping/i })).not.toBeInTheDocument()
  })

  // Written against two lists drawn at once (#353's shape). #358 draws one, so
  // the claim is now about the list ON SCREEN — and it is the sharper version
  // of the same thing: the control follows the choice rather than sitting under
  // whichever list happens to have items.
  it('is per LIST: the chosen list decides, so the empty one on screen offers none', () => {
    const hardware = { ...list, id: 'l2', name: 'Hardware' }
    const hardwareRun = { ...run, id: 'r2', list_id: 'l2' }
    const two = { lists: [list, hardware], runs: [run, hardwareRun], items: [milk] }
    setup({ ...two, selectedListId: 'l1' })
    expect(
      within(screen.getByRole('region', { name: 'Groceries' })).getByRole('button', {
        name: /done shopping/i,
      }),
    ).toBeInTheDocument()
    cleanup()
    setup({ ...two, selectedListId: 'l2' })
    expect(screen.getByRole('region', { name: 'Hardware' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /done shopping/i })).not.toBeInTheDocument()
  })
})

describe('#357 AC 6 — the confirm on a keyboard', () => {
  it('lands focus on "Keep shopping", so an accidental Enter does not finish', async () => {
    const handlers = setup()
    await openConfirm()
    const keep = screen.getByRole('button', { name: /keep shopping/i })
    expect(document.activeElement).toBe(keep)
    // And the armed key really is the way out: pressing it here backs out.
    await clickAndSettle(document.activeElement)
    expect(handlers.onFinishRun).not.toHaveBeenCalled()
    expect(doneShopping()).toBeInTheDocument()
  })

  it('both controls are real buttons, so tab reaches them and Enter activates them', async () => {
    setup()
    await openConfirm()
    for (const control of [
      screen.getByRole('button', { name: /^finish$/i }),
      screen.getByRole('button', { name: /keep shopping/i }),
    ]) {
      expect(control.tagName).toBe('BUTTON')
      expect(control).not.toBeDisabled()
      // Nothing takes them out of the tab order or hides them from the
      // accessibility tree — the two ways a visible control stops being one.
      expect(control).not.toHaveAttribute('tabindex', '-1')
      expect(control).not.toHaveAttribute('aria-hidden')
    }
  })

  it('the confirming control is not styled as a destruction — nothing is destroyed', async () => {
    // `button--danger` is Remove's and sign-out-everywhere's. A finish moves
    // the unbought items forward and leaves the bought ones on the closed run,
    // so the red would be saying something untrue.
    setup()
    await openConfirm()
    expect(screen.getByRole('button', { name: /^finish$/i })).not.toHaveClass('button--danger')
    expect(within(surface()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('#357 — a write in flight', () => {
  it('disables both confirm controls while busy, and a tap sends nothing', async () => {
    const { onFinishRun } = setup({ busy: true })
    // The opening control is disabled too, so the confirm is unreachable while
    // another write is in flight.
    expect(doneShopping()).toBeDisabled()
    await openConfirm()
    expect(screen.queryByRole('button', { name: /^finish$/i })).not.toBeInTheDocument()
    expect(onFinishRun).not.toHaveBeenCalled()
  })

  it('a finish that is still in flight leaves the confirm on screen', async () => {
    let settle
    const pending = new Promise((resolve) => {
      settle = resolve
    })
    setup({ onFinishRun: vi.fn().mockReturnValue(pending) })
    await openConfirm()
    await clickAndSettle(screen.getByRole('button', { name: /^finish$/i }))
    // Nothing is patched from the answer, so until App re-reads there is still
    // a run on screen and still a way to see what is happening.
    expect(screen.getByRole('button', { name: /^finish$/i })).toBeInTheDocument()
    await act(async () => settle())
  })
})

// ---------------------------------------------------------------------------
// #358 — several named lists, and the one on screen.
//
// What only this level can answer: which list's rows are drawn, that the add
// form and the finish control aim at THAT list's run, that the picker says
// which one is chosen in the attribute a screen reader reads, and that a
// rename is an edit on the heading and not a form somewhere else. WHICH list is
// chosen after a re-read, and whether the choice survives a tab switch, is
// App's and lives in App.test.jsx — this component is handed the id.
// ---------------------------------------------------------------------------

/** Two lists, each with its own open run and its own items. */
const hardware = { ...list, id: 'l2', name: 'Hardware', created_at: '2026-09-06T00:00:00Z' }
const hardwareRun = { ...run, id: 'r2', list_id: 'l2' }
const screws = {
  ...milk,
  id: 'i9',
  run_id: 'r2',
  name: 'Bread',
  added_at: '2026-09-06T01:00:00Z',
}
/** Bought on the hardware run, so its count and its rows differ from l1's. */
const boughtNails = {
  ...screws,
  id: 'i10',
  name: 'Butter',
  purchased_at: '2026-09-06T02:00:00Z',
  purchased_by_member_id: 'm1',
}

/** App orders by name before it renders; these fixtures arrive in that order. */
const twoLists = {
  lists: [list, hardware],
  runs: [run, hardwareRun],
  items: [milk, eggs, screws, boughtNails],
}

const pickerButtons = () =>
  Array.from(screen.getByRole('group', { name: /which list/i }).querySelectorAll('button'))

describe('#358 AC 1 — a second list, and the picker that appears with it', () => {
  it('offers "New list" to a household that already has one, and no picker', () => {
    setup()
    expect(screen.getByRole('button', { name: /new list/i })).toBeInTheDocument()
    // One list is not a choice, so there is no control offering one.
    expect(screen.queryByRole('group', { name: /which list/i })).not.toBeInTheDocument()
  })

  it('opens an EMPTY name field on the tap, and writes nothing until it is submitted', async () => {
    const handlers = setup()
    await clickAndSettle(screen.getByRole('button', { name: /new list/i }))
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('')
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('refuses an empty name with a sentence BEFORE the call', async () => {
    const { onCreateList } = setup()
    await clickAndSettle(screen.getByRole('button', { name: /new list/i }))
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: '   ' } })
    await clickAndSettle(screen.getByRole('button', { name: /create list/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onCreateList).not.toHaveBeenCalled()
  })

  it('creates the list with the trimmed name, once', async () => {
    const { onCreateList } = setup()
    await clickAndSettle(screen.getByRole('button', { name: /new list/i }))
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: ' Hardware ' } })
    await clickAndSettle(screen.getByRole('button', { name: /create list/i }))
    expect(onCreateList).toHaveBeenCalledTimes(1)
    expect(onCreateList).toHaveBeenCalledWith('Hardware')
  })

  it('backs out with Cancel, writing nothing and leaving the list on screen', async () => {
    const handlers = setup()
    await clickAndSettle(screen.getByRole('button', { name: /new list/i }))
    await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByLabelText(/^list name$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new list/i })).toBeInTheDocument()
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('draws one button per list in the order given, with its OWN count', () => {
    setup({ ...twoLists, selectedListId: 'l1' })
    expect(pickerButtons().map((b) => b.textContent)).toEqual([
      'Groceries2 left to buy',
      'Hardware1 left to buy',
    ])
  })

  it('says which one is chosen with aria-pressed, and only that one', () => {
    setup({ ...twoLists, selectedListId: 'l2' })
    expect(pickerButtons().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('draws the count ONCE: in the picker where there is one, under the heading where there is not', () => {
    setup({ ...twoLists, selectedListId: 'l1' })
    // The chosen list has two unbought items, and the sentence appears exactly
    // once — inside its own picker button.
    expect(screen.getAllByText('2 left to buy')).toHaveLength(1)
    expect(document.querySelector('.shopping-count')).toBeNull()
    cleanup()
    setup()
    expect(document.querySelector('.shopping-count')).toHaveTextContent('2 left to buy')
  })
})

describe('#358 AC 2 — the chosen list is the list, and the form aims at its run', () => {
  it('sends the id to onSelectList and writes nothing else', async () => {
    const handlers = setup({ ...twoLists, selectedListId: 'l1' })
    await clickAndSettle(pickerButtons()[1])
    expect(handlers.onSelectList).toHaveBeenCalledTimes(1)
    expect(handlers.onSelectList).toHaveBeenCalledWith('l2')
    for (const [name, handler] of Object.entries(handlers)) {
      if (name !== 'onSelectList') expect(handler).not.toHaveBeenCalled()
    }
  })

  it('renders that list’s rows and no other list’s', () => {
    setup({ ...twoLists, selectedListId: 'l2' })
    expect(rowNames()).toEqual(['Bread', 'Butter'])
  })

  it('aims the add form at the chosen list’s open run', async () => {
    const { onAddItem } = setup({ ...twoLists, selectedListId: 'l2' })
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await clickAndSettle(screen.getByRole('button', { name: /add item/i }))
    expect(onAddItem).toHaveBeenCalledWith('r2', 'Milk', null)
  })
})

describe('#358 AC 3 — finishing names the chosen list’s run and no other', () => {
  it('sends r2 when the second list is on screen', async () => {
    const { onFinishRun } = setup({ ...twoLists, selectedListId: 'l2' })
    await clickAndSettle(screen.getByRole('button', { name: /done shopping/i }))
    await clickAndSettle(screen.getByRole('button', { name: /^finish$/i }))
    expect(onFinishRun).toHaveBeenCalledTimes(1)
    expect(onFinishRun).toHaveBeenCalledWith('r2')
  })
})

describe('#358 AC 4 — renaming, on the heading', () => {
  const openRename = async () => {
    await clickAndSettle(screen.getByRole('button', { name: /^rename /i }))
    return screen.getByLabelText(/^list name$/i)
  }

  it('names the list it would rename, so the control is unambiguous with the name absent', () => {
    setup({ ...twoLists, selectedListId: 'l2' })
    // Owner decision at the design pass: with a picker on screen the pressed
    // button carries the name, so the heading stands down — and the control's
    // accessible name is then the only thing that says WHICH list.
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Hardware' })).toBeInTheDocument()
  })

  it('draws the name at subject weight beside it when there is no picker', () => {
    setup()
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    expect(screen.getByRole('heading', { level: 3 })).toHaveClass('shopping-heading__name')
  })

  it('offers a field holding the name the server has, and writes nothing on opening', async () => {
    const handlers = setup()
    expect(await openRename()).toHaveValue('Groceries')
    // The heading is gone while the editor is open — the name is being edited,
    // not shown twice.
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('saves the trimmed name against the list’s id, once', async () => {
    const { onRenameList } = setup()
    fireEvent.change(await openRename(), { target: { value: '  Hardware ' } })
    await clickAndSettle(screen.getByRole('button', { name: /save name/i }))
    expect(onRenameList).toHaveBeenCalledTimes(1)
    expect(onRenameList).toHaveBeenCalledWith('l1', 'Hardware')
  })

  it('closes on a save that lands, so the heading comes back from the re-read', async () => {
    setup()
    fireEvent.change(await openRename(), { target: { value: 'Hardware' } })
    await clickAndSettle(screen.getByRole('button', { name: /save name/i }))
    expect(screen.queryByLabelText(/^list name$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^rename /i })).toBeInTheDocument()
  })

  it('leaves the editor open with the text still in it when the write is refused', async () => {
    const refused = vi.fn().mockRejectedValue(new Error('You already have a list called Hardware.'))
    setup({ onRenameList: refused })
    fireEvent.change(await openRename(), { target: { value: 'Hardware' } })
    await clickAndSettle(screen.getByRole('button', { name: /save name/i }))
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('Hardware')
  })

  it('writes nothing on Cancel, and puts the server’s name back', async () => {
    const handlers = setup()
    fireEvent.change(await openRename(), { target: { value: 'Hardware' } })
    await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
    // And re-opening shows the server's name, not the abandoned edit.
    expect(await openRename()).toHaveValue('Groceries')
  })

  it('refuses an empty name with a sentence BEFORE the call', async () => {
    const { onRenameList } = setup()
    fireEvent.change(await openRename(), { target: { value: '  ' } })
    await clickAndSettle(screen.getByRole('button', { name: /save name/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(onRenameList).not.toHaveBeenCalled()
  })

  it('is unreachable while another write is in flight', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: /^rename /i })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// #359 — the record of what the household already bought.
//
// The arithmetic (which run, what order, how many, whose name) is
// groupClosedRuns's and is tested in shopping.test.js; the read and its trigger
// are App's and are tested in App.test.jsx. What is proved here is the SCREEN:
// the disclosure is closed until somebody opens it, opening asks for this list's
// history, only the newest run is open, a row is one compact line with no
// affordance on it, and nothing counts a person.
// ---------------------------------------------------------------------------

/** A finished run of the fixture list, closed by a member the roster holds. */
const closedRun = (id, closedAt, closedBy = 'm2') => ({
  id,
  list_id: 'l1',
  household_id: 'h1',
  opened_at: '2026-09-01T00:00:00Z',
  closed_at: closedAt,
  closed_by_member_id: closedBy,
})

/** An item on a closed run: bought by somebody, or carried into the next one. */
const pastItem = (id, runId, name, { boughtBy = null, at = null, note = null } = {}) => ({
  id,
  run_id: runId,
  household_id: 'h1',
  name,
  note,
  added_by_member_id: 'm1',
  added_at: '2026-09-01T01:00:00Z',
  purchased_at: at,
  purchased_by_member_id: boughtBy,
  carried_from_item_id: null,
})

/** Three trips, ids deliberately not in the order they were finished. */
const threeRuns = {
  loading: false,
  loaded: true,
  runs: [
    closedRun('r-mid', '2026-09-04T22:00:00Z'),
    closedRun('r-new', '2026-09-05T22:00:00Z', 'm1'),
    closedRun('r-old', '2026-09-03T22:00:00Z'),
  ],
  items: [
    pastItem('p1', 'r-new', 'Milk', { boughtBy: 'm2', at: '2026-09-05T21:02:00Z', note: 'a dozen' }),
    pastItem('p2', 'r-new', 'Bread'),
    pastItem('p3', 'r-mid', 'Eggs', { boughtBy: 'm1', at: '2026-09-04T21:00:00Z' }),
  ],
}

const pastDisclosure = () => screen.getByText('Past runs').closest('details')
const runDisclosures = () => Array.from(document.querySelectorAll('.shopping-past__run'))

/**
 * Open (or close) the disclosure the way a person does — a tap on the summary.
 *
 * The wait is not decoration and it is the whole reason this is a helper.
 * *Measured on this jsdom*: a click on a `<summary>` flips the `open` attribute
 * synchronously and fires the `toggle` event on a QUEUED TASK, so a
 * microtask-only flush (`await Promise.resolve()`, which is what `act` gives an
 * async callback that awaits nothing else) reads zero toggles and the read looks
 * as though it never fired. A `setTimeout(0)` is what lets the platform's own
 * event arrive, and the gesture under test is then the real one: click, the
 * browser's toggle, the handler. Nothing here is a synthetic stand-in for an
 * event the platform would have to send.
 */
const openPast = async (summary = screen.getByText('Past runs')) => {
  fireEvent.click(summary)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('#359 AC 4 — the history is read when it is opened, and never on arrival', () => {
  it('renders the disclosure closed, and asks for nothing', () => {
    const { onOpenPastRuns } = setup()
    expect(pastDisclosure()).not.toHaveAttribute('open')
    expect(onOpenPastRuns).not.toHaveBeenCalled()
  })

  it('asks for THIS list’s history on the tap, once, naming the list', async () => {
    const { onOpenPastRuns } = setup()
    await openPast()
    expect(onOpenPastRuns).toHaveBeenCalledTimes(1)
    expect(onOpenPastRuns).toHaveBeenCalledWith('l1')
  })

  it('asks again on a re-open, and asks nothing when it is closed', async () => {
    // A person asking twice wants the current answer, not the one this device
    // happened to keep. Closing is not a question.
    const { onOpenPastRuns } = setup()
    const summary = screen.getByText('Past runs')
    await openPast(summary)
    await openPast(summary)
    expect(onOpenPastRuns).toHaveBeenCalledTimes(1)
    await openPast(summary)
    expect(onOpenPastRuns).toHaveBeenCalledTimes(2)
  })

  it('a RUN’s own disclosure opening does not re-read — the toggle that is not this one’s', async () => {
    // `toggle` does not bubble, so React attaches it at the root and simulates
    // bubbling: a run's disclosure opening arrives at the outer handler as
    // though this element had been toggled. Measured in Chrome at 360x800
    // BEFORE the target check: one tap on Past runs produced 55 toggle events
    // in 1.5 s — the newest run mounting with `open` re-read, which remounted
    // the runs, which fired another — and the screen sat on "Reading the
    // finished runs…" forever.
    //
    // IT CAN FAIL, and the prediction that said otherwise was wrong. This test
    // was written expecting jsdom to be blind to the inner toggle — the #359
    // App test records exactly one call while a run mounts open, which looked
    // like the same evidence — so the mutation was predicted at 0 and *measured
    // at 1 of 268*: deleting the target check from Shopping.jsx reddens this
    // row and nothing else. What the earlier count actually shows is that a run
    // mounting open inside the same commit does not reach the handler, while a
    // person opening one later does; the browser hit the first case 55 times in
    // 1.5 s and jsdom hits the second here.
    const { onOpenPastRuns } = setup({ past: threeRuns })
    await openPast()
    expect(onOpenPastRuns).toHaveBeenCalledTimes(1)

    const older = runDisclosures()[1]
    fireEvent.click(older.querySelector('summary'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(older).toHaveAttribute('open')
    expect(onOpenPastRuns).toHaveBeenCalledTimes(1)
  })

  it('names the list the picker is on, not the first list of the household', async () => {
    const { onOpenPastRuns } = setup({
      lists: [list, { ...list, id: 'l2', name: 'Hardware' }],
      runs: [run, { ...run, id: 'r2', list_id: 'l2' }],
      selectedListId: 'l2',
    })
    await openPast()
    expect(onOpenPastRuns).toHaveBeenCalledWith('l2')
  })

  it('says it is reading while the read is in flight, and writes nothing', async () => {
    const handlers = setup({ past: { ...NO_PAST, loading: true } })
    expect(screen.getByText(/reading the finished runs/i)).toBeInTheDocument()
    // Not the empty-state sentence: "reading" and "there are none" are different
    // answers and the first must not read as the second.
    expect(screen.queryByText(/no finished runs yet/i)).not.toBeInTheDocument()
    for (const [name, handler] of Object.entries(handlers)) {
      if (name !== 'onOpenPastRuns') expect(handler).not.toHaveBeenCalled()
    }
  })
})

describe('#359 AC 1 — one disclosure per finished run, newest first and newest open', () => {
  it('orders the runs newest first and heads each with when and who, then how much', async () => {
    setup({ past: threeRuns })
    await openPast()
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual([
      'Finished Sep 5, 2026 by Placeholder',
      'Finished Sep 4, 2026 by Robin',
      'Finished Sep 3, 2026 by Robin',
    ])
    // The counts are the run's own — items, and never a person (#35 AC 9).
    expect(runDisclosures()[0]).toHaveTextContent('1 bought, 1 carried over')
    expect(runDisclosures()[1]).toHaveTextContent('1 bought, 0 carried over')
  })

  it('opens the NEWEST and leaves every earlier run collapsed', async () => {
    setup({ past: threeRuns })
    await openPast()
    expect(runDisclosures().map((node) => node.hasAttribute('open'))).toEqual([true, false, false])
  })

  it('a closer the roster no longer holds is "a former member" rather than a blank', async () => {
    setup({
      past: { ...threeRuns, runs: [closedRun('r-new', '2026-09-05T22:00:00Z', null)], items: [] },
    })
    await openPast()
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent(
      'Finished Sep 5, 2026 by a former member',
    )
  })

  it('draws the history of THIS list even while App still holds another list’s rows', async () => {
    // The window is real: the read names one list, and a switch between two
    // lists while it is in flight would otherwise draw the other list's trips
    // under this list's name.
    setup({
      lists: [list, { ...list, id: 'l2', name: 'Hardware' }],
      runs: [run, { ...run, id: 'r2', list_id: 'l2' }],
      selectedListId: 'l2',
      past: threeRuns,
    })
    await openPast()
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument()
    expect(screen.getByText(/no finished runs yet/i)).toBeInTheDocument()
  })
})

describe('#359 AC 2 — a closed row is one compact line, not the working row struck through', () => {
  it('carries the name, the note, and who bought it and when', async () => {
    setup({ past: threeRuns })
    await openPast()
    // Scoped to the history: the open run is showing an item of the same name,
    // which is the ordinary case — a household buys milk most weeks.
    const row = within(pastDisclosure()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('a dozen')
    // #355's own sentence, reused rather than reworded: 21:02 UTC is 5:02 PM in
    // New York, and the zone is the household's.
    expect(row).toHaveTextContent('bought by Robin · 5:02 PM')
  })

  it('says "carried over" for an item the trip did not buy', async () => {
    setup({ past: threeRuns })
    await openPast()
    const row = within(pastDisclosure()).getByText('Bread').closest('li')
    expect(row).toHaveTextContent('carried over')
    expect(row).not.toHaveTextContent(/bought by/i)
  })

  it('offers no tick, no remove and no undo anywhere in the history', async () => {
    setup({ past: threeRuns })
    await openPast()
    const history = pastDisclosure()
    expect(history.querySelectorAll('button')).toHaveLength(0)
    for (const forbidden of [/^mark /i, /^remove /i, /not bought after all/i]) {
      expect(within(history).queryByRole('button', { name: forbidden })).not.toBeInTheDocument()
    }
    // And it is not the working row: the classes that carry the tap target and
    // the controls appear nowhere inside it.
    expect(history.querySelectorAll('.shopping-item__tick')).toHaveLength(0)
    expect(history.querySelectorAll('.shopping-item__actions')).toHaveLength(0)
  })

  it('leaves the working list alone — the open run’s controls are all still there', async () => {
    setup({ past: threeRuns })
    await openPast()
    expect(screen.getByRole('button', { name: 'Mark Milk bought' })).toBeInTheDocument()
    // Two rows called Milk are on screen now: one on the open run and one in the
    // history. The tap target is the open run's, and only the open run's.
    expect(screen.getAllByText('Milk')).toHaveLength(2)
  })
})

describe('#359 AC 5 and AC 6 — nothing finished yet, and nothing about anybody', () => {
  it('reads "No finished runs yet" once the read has landed and found none', async () => {
    setup({ past: { loading: false, loaded: true, runs: [], items: [] } })
    await openPast()
    expect(screen.getByText(/no finished runs yet/i)).toBeInTheDocument()
  })

  it('says nothing about an empty history before anybody has asked', () => {
    // `loaded` is what distinguishes them, which is why App's state is an object
    // and not an array: an unasked question is not an answer of "none".
    setup()
    expect(screen.queryByText(/no finished runs yet/i)).not.toBeInTheDocument()
  })

  it('carries no per-person total, no rank, and nothing styled as an error', async () => {
    setup({ past: threeRuns })
    await openPast()
    const history = pastDisclosure()
    for (const forbidden of [/most/i, /rank/i, /streak/i, /score/i, /leader/i, /total/i]) {
      expect(within(history).queryByText(forbidden)).not.toBeInTheDocument()
    }
    expect(within(history).queryByRole('alert')).not.toBeInTheDocument()
    expect(history.querySelectorAll('.error')).toHaveLength(0)
  })
})

describe('#358 AC 8 — nothing on this tab deletes or archives a list', () => {
  it('offers no such control, on several lists, with an editor open or a form open', async () => {
    setup({ ...twoLists, selectedListId: 'l1' })
    const forbidden = /delete|archive|remove list|close list/i
    expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument()
    await clickAndSettle(screen.getByRole('button', { name: /^rename /i }))
    expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument()
    await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))
    await clickAndSettle(screen.getByRole('button', { name: /new list/i }))
    expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument()
    // The only Remove on the surface is an item's, which #353 already holds.
    expect(screen.getAllByRole('button', { name: /^remove /i }).length).toBeGreaterThan(0)
  })
})
