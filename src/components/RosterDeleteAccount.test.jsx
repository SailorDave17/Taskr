// #432 — "Delete your account" on the Who tab, which from inside a household is
// a route into Leave and never a delete.
//
// Its own file, beside RosterLeaveHousehold.test.jsx, with the same setup
// narrowed to what this card needs. Values are synthetic — see #19.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Roster from './Roster.jsx'

const household = { id: 'h1', name: 'Placeholder Household', organizer_member_id: 'm1' }
const organizerRow = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'device-a' }
const signedIn = { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'device-b' }
const roster = [organizerRow, signedIn]

function setup(overrides = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    onSetCapacity: vi.fn().mockResolvedValue(undefined),
    onClearCapacity: vi.fn().mockResolvedValue(undefined),
    onResetPin: vi.fn().mockResolvedValue(undefined),
    onInvite: vi.fn().mockResolvedValue(undefined),
    onSendReset: vi.fn().mockResolvedValue(undefined),
    onDeleteHousehold: vi.fn().mockResolvedValue(undefined),
    onLeaveHousehold: vi.fn().mockResolvedValue(undefined),
    onHandOverAndLeave: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Roster
      household={household}
      members={roster}
      me={signedIn}
      isOrganizer={false}
      periodStart="2026-08-10"
      deletionGraceDays={5}
      accountDeletionOffered
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

const deleteButton = () => screen.queryByRole('button', { name: /^delete my account$/i })
const note = () => screen.queryByTestId('delete-account-note')

// #97 — jsdom has no layout, so the scroll the confirm asks for is spied on
// rather than measured; the measurement is in #431's design-bar record.
let scrollIntoView
beforeEach(() => {
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
})
afterEach(() => {
  delete Element.prototype.scrollIntoView
})

describe('deleting your account from the Who tab (#432)', () => {
  it('offers the control, last of the ways out', () => {
    setup()
    expect(deleteButton()).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.indexOf('Delete your account')).toBeGreaterThan(headings.indexOf('Leave this household'))
  })

  it('renders nothing new when the app does not offer it, the #166 shape', () => {
    setup({ accountDeletionOffered: false })
    expect(deleteButton()).toBeNull()
  })

  it('renders nothing without a Leave to route into, because the route is the whole card', () => {
    setup({ onLeaveHousehold: null })
    expect(deleteButton()).toBeNull()
  })

  it('touches nothing on the first tap, and says when the sign-in goes', () => {
    const { onLeaveHousehold, onDeleteHousehold } = setup()
    fireEvent.click(deleteButton())
    expect(onLeaveHousehold).not.toHaveBeenCalled()
    expect(onDeleteHousehold).not.toHaveBeenCalled()
    expect(note()).toHaveTextContent(/your sign-in is deleted when you leave your last household\./i)
    expect(note()).toHaveTextContent(/leave placeholder household first/i)
    expect(note()).toHaveTextContent(/taskr cannot remove a google sign-in permission/i)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
  })

  it('counts the households when there is more than one, so "last" is not read as "this"', () => {
    setup({ householdCount: 2 })
    fireEvent.click(deleteButton())
    expect(note()).toHaveTextContent(/and you are in 2\./)
  })

  it('routes into the Leave confirm rather than deleting anything', () => {
    const { onLeaveHousehold } = setup()
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: /^leave this household first$/i }))
    expect(note()).toBeNull()
    // The member's leave confirm is open: its losses list and its danger button.
    expect(screen.getByTestId('leave-household-warning')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^leave placeholder household\?$/i })).toBeInTheDocument()
    expect(onLeaveHousehold).not.toHaveBeenCalled()
  })

  it("tells the organizer their leave is a hand-over or a delete, and opens that confirm", () => {
    setup({ me: organizerRow, isOrganizer: true })
    fireEvent.click(deleteButton())
    expect(note()).toHaveTextContent(/you organize placeholder household, so leaving it means handing it to somebody or deleting it/i)
    fireEvent.click(screen.getByRole('button', { name: /^leave this household first$/i }))
    expect(screen.getByTestId('leave-household-warning')).toHaveTextContent(/somebody has to take it on, or it is deleted/i)
    expect(screen.getByRole('button', { name: /^hand it to placeholder two and leave$/i })).toBeInTheDocument()
  })

  it('can be kept, closing the confirm with nothing changed', () => {
    setup()
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: /^keep my account$/i }))
    expect(note()).toBeNull()
    expect(deleteButton()).toBeInTheDocument()
  })

  it('is disabled while the roster is busy', () => {
    setup({ busy: true })
    expect(deleteButton()).toBeDisabled()
  })
})
