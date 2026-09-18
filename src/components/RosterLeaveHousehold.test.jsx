// #431 — leaving the household from the Who tab, and the organizer's hand-over.
//
// Its own file, beside RosterDeleteHousehold.test.jsx, with the same setup
// narrowed to what this card needs. Values are synthetic — see #19.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

const leaveButton = () => screen.queryByRole('button', { name: /^leave this household$/i })

describe('leaving the household from the Who tab (#431)', () => {
  it('offers a member the control', () => {
    setup()
    expect(leaveButton()).toBeInTheDocument()
  })

  it('renders nothing new when the handler is not wired, the #166 shape', () => {
    setup({ onLeaveHousehold: null })
    expect(leaveButton()).toBeNull()
  })

  it('leaves nothing on the first tap', () => {
    const { onLeaveHousehold } = setup()
    fireEvent.click(leaveButton())
    expect(onLeaveHousehold).not.toHaveBeenCalled()
  })

  it('says what leaving does before asking again', () => {
    setup()
    fireEvent.click(leaveButton())
    const warning = screen.getByTestId('leave-household-warning')
    expect(warning).toHaveTextContent(household.name)
    // #180 AC 3 — the five outcomes the foreign keys produce, each its own
    // assertion, in the confirm's own words; the pglite suite reads each back.
    // One list item per loss (design-bar, 2026-09-16), so a person can scan it.
    expect(within(warning).getAllByRole('listitem')).toHaveLength(6)
    expect(warning).toHaveTextContent(/chores dealt to you go to the others; any placed on you by hand become unassigned/)
    // The sixth is the review's: attribution edges added after #180 was filed.
    expect(warning).toHaveTextContent(/shopping lists, invitations you sent, and calendar imports you made stay, without your name/)
    expect(warning).toHaveTextContent(/chores you finished stay finished, but no longer carry your name/i)
    expect(warning).toHaveTextContent(/your weekly minutes here are removed/i)
    expect(warning).toHaveTextContent(/marked as ones you cannot do forget that/)
    expect(warning).toHaveTextContent(/calendar connection here is disconnected/)
    expect(warning).toHaveTextContent(/your sign-in is deleted too/)
  })

  it('leaves the household on screen, as the person signed in, when confirmed', () => {
    const { onLeaveHousehold } = setup()
    fireEvent.click(leaveButton())
    fireEvent.click(screen.getByRole('button', { name: /^leave placeholder household\?$/i }))
    expect(onLeaveHousehold).toHaveBeenCalledWith('h1', 'm2')
    expect(onLeaveHousehold).toHaveBeenCalledTimes(1)
  })

  it('backs out on Stay without leaving', () => {
    const { onLeaveHousehold } = setup()
    fireEvent.click(leaveButton())
    fireEvent.click(screen.getByRole('button', { name: /^stay$/i }))
    expect(onLeaveHousehold).not.toHaveBeenCalled()
    expect(leaveButton()).toBeInTheDocument()
  })
})

describe('the organizer leaving: hand it over or delete it, in one confirm (#431)', () => {
  const asOrganizer = (overrides = {}) => setup({ me: organizerRow, isOrganizer: true, ...overrides })

  it('offers to hand it only to somebody else who has signed in', () => {
    asOrganizer()
    fireEvent.click(leaveButton())
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Placeholder Two'])
  })

  it('hands it to the chosen person and leaves, naming them on the button', () => {
    const { onHandOverAndLeave, onLeaveHousehold } = asOrganizer()
    fireEvent.click(leaveButton())
    fireEvent.click(screen.getByRole('button', { name: /^hand it to placeholder two and leave$/i }))
    expect(onHandOverAndLeave).toHaveBeenCalledWith('h1', 'm2', 'm1')
    expect(onLeaveHousehold).not.toHaveBeenCalled()
  })

  it('offers deleting it instead, through #430’s path, and says it can be restored', () => {
    const { onDeleteHousehold } = asOrganizer()
    fireEvent.click(leaveButton())
    expect(screen.getByTestId('leave-household-warning')).toHaveTextContent(/restore it for 5 days/)
    fireEvent.click(screen.getByRole('button', { name: /^delete placeholder household instead$/i }))
    expect(onDeleteHousehold).toHaveBeenCalledWith('h1')
  })

  it('never offers the organizer the plain leave, which the database would refuse', () => {
    asOrganizer()
    fireEvent.click(leaveButton())
    expect(screen.queryByRole('button', { name: /^leave placeholder household\?$/i })).toBeNull()
  })

  // #467 — `claimed_by` is set when an invitation is SENT (#341); 0048 refuses
  // a hand-over to anyone who has not accepted, so the list reads the sign-in
  // state (0045) rather than the claim. Stamps are relative to the real clock.
  describe('#467 — only somebody who has accepted is offered as a successor', () => {
    const MINUTE = 60 * 1000
    const invited = { id: 'm4', display_name: 'Placeholder Second', weekly_minutes: 20, claimed_by: 'device-d' }
    const states = (invitedAt) => [
      { member_id: 'm1', invited_at: null, confirmed_at: '2026-09-01T00:00:00Z' },
      { member_id: 'm2', invited_at: '2026-09-01T00:00:00Z', confirmed_at: '2026-09-01T00:05:00Z' },
      { member_id: 'm4', invited_at: new Date(Date.now() - invitedAt).toISOString(), confirmed_at: null },
    ]
    const optionsShown = () => screen.getAllByRole('option').map((o) => o.textContent)

    it('AC 1 and AC 3 — leaves out an outstanding invitation and offers the member who accepted', () => {
      asOrganizer({ members: [organizerRow, invited, signedIn, neverSignedIn], signInStates: states(MINUTE) })
      fireEvent.click(leaveButton())
      expect(optionsShown()).toEqual(['Placeholder Two'])
    })

    it('AC 1 — leaves out an invitation that expired unaccepted', () => {
      asOrganizer({
        members: [organizerRow, invited, signedIn, neverSignedIn],
        signInStates: states(2 * 24 * 60 * MINUTE),
      })
      fireEvent.click(leaveButton())
      expect(optionsShown()).toEqual(['Placeholder Two'])
    })

    it('AC 1 — with only an unaccepted invitation left, says it cannot be handed over and offers delete', () => {
      const { onHandOverAndLeave } = asOrganizer({
        members: [organizerRow, invited, neverSignedIn],
        signInStates: states(MINUTE),
      })
      fireEvent.click(leaveButton())
      expect(screen.getByText(/nobody else here has signed in yet/i)).toBeInTheDocument()
      expect(screen.queryByRole('option')).toBeNull()
      expect(screen.queryByRole('button', { name: /and leave$/i })).toBeNull()
      expect(screen.getByRole('button', { name: /instead$/i })).toBeInTheDocument()
      expect(onHandOverAndLeave).not.toHaveBeenCalled()
    })
  })

  it('with nobody else signed in, says it cannot be handed over and still offers delete', () => {
    asOrganizer({ members: [organizerRow, neverSignedIn] })
    fireEvent.click(leaveButton())
    expect(screen.getByText(/nobody else here has signed in yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /and leave$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /instead$/i })).toBeInTheDocument()
  })

  it('#180 AC 3 — says what the hand-over-and-leave costs, the same losses a member reads', () => {
    asOrganizer()
    fireEvent.click(leaveButton())
    const losses = screen.getByTestId('leave-household-losses')
    expect(losses).toHaveTextContent(/once it is handed on and you leave/i)
    expect(within(losses).getAllByRole('listitem')).toHaveLength(6)
    expect(losses).toHaveTextContent(/no longer carry your name/)
    expect(losses).toHaveTextContent(/your weekly minutes here are removed/i)
    expect(losses).toHaveTextContent(/calendar connection here is disconnected/)
    expect(losses).toHaveTextContent(/your sign-in is deleted too/)
  })

  it('#180 AC 3 — with nobody to hand it to, lists no losses: deleting it takes everything anyway', () => {
    asOrganizer({ members: [organizerRow, neverSignedIn] })
    fireEvent.click(leaveButton())
    expect(screen.queryByTestId('leave-household-losses')).toBeNull()
  })
})

describe('the confirm scrolls itself into view as it opens (design-bar, 2026-09-11)', () => {
  // Measured on the prototype at 360×800: tapped from the bottom of the Who
  // tab, the member's "Leave …?" opened at y=821 and the organizer's hand-over
  // at 742–802, below an 800px viewport, with nothing moving on screen. jsdom
  // has no layout and no scrollIntoView, so the request is what can be asserted
  // here; the prototype is where the fold was seen and the fix re-measured.
  const original = Element.prototype.scrollIntoView
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })
  const confirmBlock = () => screen.getByTestId('leave-household-warning').parentElement

  it('requests one scroll, to the member confirm, moving the page only as far as it needs', () => {
    setup()
    fireEvent.click(leaveButton())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollIntoView.mock.instances[0]).toBe(confirmBlock())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
  })

  it('and to the organizer confirm, picker and all', () => {
    setup({ me: organizerRow, isOrganizer: true })
    fireEvent.click(leaveButton())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollIntoView.mock.instances[0]).toBe(confirmBlock())
  })

  it('requests none before the tap, and none more when Stay closes it', () => {
    setup()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    fireEvent.click(leaveButton())
    fireEvent.click(screen.getByRole('button', { name: /^stay$/i }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('POSITIVE CONTROL: the confirm still opens in a browser with no scrollIntoView at all', () => {
    Element.prototype.scrollIntoView = undefined
    setup()
    fireEvent.click(leaveButton())
    expect(screen.getByRole('button', { name: /^leave placeholder household\?$/i })).toBeInTheDocument()
  })
})
