// #430 — the organizer's "Delete this household" control on the Who tab.
//
// Its own file rather than a block in Roster.test.jsx, which is long enough
// already; the setup below is that file's `setup()` narrowed to what this
// control needs. Values are synthetic — see #19.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Roster from './Roster.jsx'

const household = { id: 'h1', name: 'Placeholder Household' }
const roster = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: null },
  { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'device-b' },
]

function setup(overrides = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    onSetCapacity: vi.fn().mockResolvedValue(undefined),
    onClearCapacity: vi.fn().mockResolvedValue(undefined),
    onProvision: vi.fn().mockResolvedValue(undefined),
    onInvite: vi.fn().mockResolvedValue(undefined),
    onSendReset: vi.fn().mockResolvedValue(undefined),
    onDeleteHousehold: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Roster
      household={household}
      members={roster}
      me={null}
      periodStart="2026-08-10"
      isOrganizer
      // 5, not the product's 7: a Roster that printed a hardcoded 7 would pass
      // a fixture of 7 (#430 review). App.test proves App passes the real one.
      deletionGraceDays={5}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

const deleteButton = () => screen.queryByRole('button', { name: /^delete this household$/i })

describe('deleting the household from the Who tab (#430)', () => {
  it('offers the organizer the control', () => {
    setup()
    expect(deleteButton()).toBeInTheDocument()
  })

  it('offers it to nobody else, and not at all when no handler is wired', () => {
    setup({ isOrganizer: false })
    expect(deleteButton()).toBeNull()
  })

  it('renders nothing new when the handler is not wired, the #166 shape', () => {
    setup({ onDeleteHousehold: null })
    expect(deleteButton()).toBeNull()
  })

  it('deletes nothing on the first tap', () => {
    const { onDeleteHousehold } = setup()
    fireEvent.click(deleteButton())
    expect(onDeleteHousehold).not.toHaveBeenCalled()
  })

  it('says what goes and that it can be undone for the grace period, before asking again', () => {
    setup()
    fireEvent.click(deleteButton())
    const warning = screen.getByTestId('delete-household-warning')
    expect(warning).toHaveTextContent(household.name)
    expect(warning).toHaveTextContent(/people, chores/)
    expect(warning).toHaveTextContent(/calendar connections/)
    expect(warning).toHaveTextContent(/restore it for 5 days/)
  })

  it('deletes the household on screen when confirmed', () => {
    const { onDeleteHousehold } = setup()
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: /^delete placeholder household\?$/i }))
    expect(onDeleteHousehold).toHaveBeenCalledWith('h1')
    expect(onDeleteHousehold).toHaveBeenCalledTimes(1)
  })

  it('backs out of the confirm without deleting', () => {
    const { onDeleteHousehold } = setup()
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: /^keep it$/i }))
    expect(onDeleteHousehold).not.toHaveBeenCalled()
    expect(deleteButton()).toBeInTheDocument()
  })
})

describe('the confirm scrolls itself into view as it opens (#431 design-bar, 2026-09-11)', () => {
  // Measured on #431's prototype at 360×800: tapped from the bottom of the Who
  // tab, "Delete …?" opened at y=801 in an 800px viewport — shipped that way in
  // #430. jsdom has no layout, so the request is what can be asserted here.
  const original = Element.prototype.scrollIntoView
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })

  it('requests one scroll, to the confirm, when it opens', () => {
    setup()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    fireEvent.click(deleteButton())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollIntoView.mock.instances[0]).toBe(
      screen.getByTestId('delete-household-warning').parentElement,
    )
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
  })

  it('POSITIVE CONTROL: the confirm still opens in a browser with no scrollIntoView at all', () => {
    Element.prototype.scrollIntoView = undefined
    setup()
    fireEvent.click(deleteButton())
    expect(screen.getByRole('button', { name: /^delete placeholder household\?$/i })).toBeInTheDocument()
  })
})
