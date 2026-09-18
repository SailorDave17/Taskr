// #179 — the organizer hands the role to another member and stays.
//
// Its own file, beside RosterLeaveHousehold.test.jsx (#431's hand-over, which
// leaves as well), with the same setup narrowed to what this control needs.
// Values are synthetic — see #19.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Roster from './Roster.jsx'

const household = { id: 'h1', name: 'Placeholder Household' }
const organizerRow = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'device-a' }
const signedIn = { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'device-b' }
const neverSignedIn = { id: 'm3', display_name: 'Placeholder Three', weekly_minutes: 30, claimed_by: null }
const roster = [organizerRow, signedIn, neverSignedIn]

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
    onTransferHousehold: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Roster
      household={household}
      members={roster}
      me={organizerRow}
      isOrganizer
      periodStart="2026-08-10"
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

const rowFor = (name) => screen.getByText(name).closest('li')
const makeOrganizerIn = (row) => within(row).queryByRole('button', { name: /^make .* the organizer$/i })

describe('handing the organizer role over from the roster (#179)', () => {
  it('AC 1 — offers it on each OTHER row whose member has signed in', () => {
    setup()
    expect(makeOrganizerIn(rowFor('Placeholder Two'))).toHaveAccessibleName('Make Placeholder Two the organizer')
    expect(makeOrganizerIn(rowFor('Placeholder Two'))).toHaveTextContent('Make organizer')
  })

  it('never offers it on the organizer’s own row, which the RPC would refuse', () => {
    setup()
    expect(makeOrganizerIn(rowFor('Placeholder One'))).toBeNull()
  })

  it('never offers it on a row with no sign-in, which the RPC would refuse (0016’s dead end)', () => {
    setup()
    expect(makeOrganizerIn(rowFor('Placeholder Three'))).toBeNull()
  })

  it('is the organizer’s alone: an ordinary member sees no such control on any row', () => {
    setup({ me: signedIn, isOrganizer: false })
    expect(screen.queryByRole('button', { name: /^make .* the organizer$/i })).toBeNull()
  })

  it('renders nothing new when the handler is not wired, the #166 shape', () => {
    setup({ onTransferHousehold: null })
    expect(screen.queryByRole('button', { name: /^make .* the organizer$/i })).toBeNull()
  })

  it('hands nothing over on the first tap', () => {
    const { onTransferHousehold } = setup()
    fireEvent.click(makeOrganizerIn(rowFor('Placeholder Two')))
    expect(onTransferHousehold).not.toHaveBeenCalled()
    expect(
      within(rowFor('Placeholder Two')).getByRole('button', { name: /^make placeholder two the organizer\?$/i }),
    ).toBeInTheDocument()
  })

  it('AC 2 — hands the household to that member, and only that member, when confirmed', () => {
    const { onTransferHousehold } = setup()
    fireEvent.click(makeOrganizerIn(rowFor('Placeholder Two')))
    fireEvent.click(
      within(rowFor('Placeholder Two')).getByRole('button', { name: /^make placeholder two the organizer\?$/i }),
    )
    expect(onTransferHousehold).toHaveBeenCalledWith('h1', 'm2')
    expect(onTransferHousehold).toHaveBeenCalledTimes(1)
  })

  it('backs out on Not now without handing over, and the control is still there to take', () => {
    const { onTransferHousehold } = setup()
    fireEvent.click(makeOrganizerIn(rowFor('Placeholder Two')))
    fireEvent.click(within(rowFor('Placeholder Two')).getByRole('button', { name: /^not now$/i }))
    expect(onTransferHousehold).not.toHaveBeenCalled()
    expect(makeOrganizerIn(rowFor('Placeholder Two'))).toBeInTheDocument()
  })

  it('does not let the rejection escape as an unhandled promise', async () => {
    // `onTransferHousehold` routes through App's `mutate()`, which RETHROWS after
    // putting the message on screen. A bare call in the handler would escape —
    // the Remove arm above it and #431's hand-over take the same shape.
    const onTransferHousehold = vi.fn().mockRejectedValue(new Error('nope'))
    setup({ onTransferHousehold })
    fireEvent.click(makeOrganizerIn(rowFor('Placeholder Two')))
    fireEvent.click(
      within(rowFor('Placeholder Two')).getByRole('button', { name: /^make placeholder two the organizer\?$/i }),
    )
    await Promise.resolve()
    expect(onTransferHousehold).toHaveBeenCalledTimes(1)
  })

  it('leaves Remove where it was: the two controls sit side by side on the same row', () => {
    setup()
    const row = rowFor('Placeholder Two')
    expect(within(row).getByRole('button', { name: /^remove placeholder two$/i })).toBeInTheDocument()
    expect(makeOrganizerIn(row)).toBeInTheDocument()
  })
})

// #467 — `claimed_by` is set when an invitation is SENT (#341), so a claimed
// row may be somebody who has never opened it. `signInStates` (0045) is what
// tells the two apart, and 0048 refuses the hand-over to anyone who has not
// accepted. Stamps are relative to the real clock: one minute ago is a live
// link, two days ago an expired one.
describe('#467 — the role is offered only to somebody who has accepted', () => {
  const MINUTE = 60 * 1000
  const invited = { id: 'm4', display_name: 'Placeholder Second', weekly_minutes: 20, claimed_by: 'device-d' }
  const withInvited = [organizerRow, signedIn, neverSignedIn, invited]
  const states = (invitedAt) => [
    { member_id: 'm1', invited_at: null, confirmed_at: '2026-09-01T00:00:00Z' },
    { member_id: 'm2', invited_at: '2026-09-01T00:00:00Z', confirmed_at: '2026-09-01T00:05:00Z' },
    { member_id: 'm4', invited_at: new Date(Date.now() - invitedAt).toISOString(), confirmed_at: null },
  ]

  it('AC 1 — never on a row whose invitation is outstanding', () => {
    setup({ members: withInvited, signInStates: states(MINUTE) })
    expect(screen.getByTestId('access-m4')).toHaveTextContent(/not joined yet/)
    expect(makeOrganizerIn(rowFor('Placeholder Second'))).toBeNull()
  })

  it('AC 1 — never on a row whose invitation expired unaccepted', () => {
    setup({ members: withInvited, signInStates: states(2 * 24 * 60 * MINUTE) })
    expect(screen.getByTestId('access-m4')).toHaveTextContent(/Invitation expired/)
    expect(makeOrganizerIn(rowFor('Placeholder Second'))).toBeNull()
  })

  it('AC 3 — a member who has accepted is offered it exactly as before', () => {
    const { onTransferHousehold } = setup({ members: withInvited, signInStates: states(MINUTE) })
    fireEvent.click(makeOrganizerIn(rowFor('Placeholder Two')))
    fireEvent.click(
      within(rowFor('Placeholder Two')).getByRole('button', { name: /^make placeholder two the organizer\?$/i }),
    )
    expect(onTransferHousehold).toHaveBeenCalledWith('h1', 'm2')
  })

  it('with no sign-in read yet, a claimed row is offered as before #458 — the function is the boundary then', () => {
    setup({ members: withInvited, signInStates: null })
    expect(makeOrganizerIn(rowFor('Placeholder Second'))).toBeInTheDocument()
  })
})
