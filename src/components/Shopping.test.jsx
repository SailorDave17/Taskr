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
  }
  render(
    <Shopping
      lists={[list]}
      runs={[run]}
      items={[milk, eggs]}
      members={members}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

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
