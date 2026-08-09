import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Roster from './Roster.jsx'

// ACs 2 and 4 (people with budgets, edited and removed) and the "pick yourself"
// half of AC 5. Names are synthetic — see #19.

const household = { id: 'h1', name: 'Placeholder Household', join_code: 'ABCD2345' }

const PERIOD = '2026-08-10'

const roster = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: null },
  { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'device-b' },
]

function setup(overrides = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onClaim: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    onSetPin: vi.fn().mockResolvedValue(undefined),
    // #46. The parameter this function already calls `overrides` is the PROP
    // BAG; the Roster prop of the same name is the capacity override list, and
    // `setup({ overrides: [...] })` sets exactly that. Confusing on first read
    // and left alone rather than renamed, because renaming the parameter would
    // touch every existing call in this file for no behavioural gain.
    onSetCapacity: vi.fn().mockResolvedValue(undefined),
    onClearCapacity: vi.fn().mockResolvedValue(undefined),
  }
  // The week the fixture override belongs to. Passed explicitly rather than
  // defaulted, because an override is only an override OF a period — matching on
  // the person alone was a real bug this file's fixture caught.
  const props = { periodStart: PERIOD, ...handlers }
  render(<Roster household={household} members={roster} me={null} {...props} {...overrides} />)
  return handlers
}

const rowFor = (name) => screen.getByText(name).closest('li')

/**
 * Click, and let the handler's promise settle inside act().
 *
 * The submit handlers clear their fields in a `.then()`, so the state update
 * lands a microtask after the click. Without this the assertion races it and
 * React warns — and the warning is the honest signal, not noise to silence.
 */
const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

describe('the join credential', () => {
  it('shows the code so the organizer can read it out — AC 1', () => {
    setup()
    expect(screen.getByTestId('join-code')).toHaveTextContent('ABCD2345')
  })

  it('states plainly that the code is deterrence, not a lock', () => {
    setup()
    expect(screen.getByText(/deterrence, not\s+a lock/i)).toBeInTheDocument()
  })
})

describe('sending the code — AC 1’s "or send"', () => {
  const shareButton = () => screen.getByRole('button', { name: /copy or send code/i })

  afterEach(() => {
    delete navigator.share
    delete navigator.clipboard
  })

  it('shares through the OS share sheet where one exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    navigator.share = share
    setup()

    await clickAndSettle(shareButton())

    // The message must carry the code itself, not just a link: the receiving
    // phone types it into the join box.
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('ABCD2345') }))
  })

  it('falls back to the clipboard, copying the bare code and nothing else', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }
    setup()

    await clickAndSettle(shareButton())

    // The bare code, because it is pasted into a field that expects exactly it.
    expect(writeText).toHaveBeenCalledWith('ABCD2345')
    expect(await screen.findByText(/code copied/i)).toBeInTheDocument()
  })

  it('says what to do instead when neither is available, rather than failing silently', async () => {
    setup()
    await clickAndSettle(shareButton())
    expect(await screen.findByText(/select the code above/i)).toBeInTheDocument()
  })

  it('treats a cancelled share as a non-event, not an error', async () => {
    navigator.share = vi.fn().mockRejectedValue(new Error('AbortError'))
    setup()

    await clickAndSettle(shareButton())

    // Cancelling a share sheet is the commonest outcome of opening one by
    // accident. It must not read as a failure.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('join-code')).toHaveTextContent('ABCD2345')
  })
})

describe('showing the roster', () => {
  it('lists each person with the budget that was stored', () => {
    setup()
    expect(within(rowFor('Placeholder One')).getByText(/120 min\/week/)).toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).getByText(/45 min\/week/)).toBeInTheDocument()
  })

  // 120 + 45. Written out rather than summed from the fixture, so the assertion
  // is a statement about what the total should be and not a restatement of how
  // the component computes it.
  it('totals the household budget', () => {
    setup()
    expect(screen.getByTestId('roster-total')).toHaveTextContent('165 min/week')
    expect(screen.getByTestId('roster-total')).toHaveTextContent('2 people')
  })

  it('says the roster is empty rather than showing an empty list', () => {
    setup({ members: [] })
    expect(screen.getByText(/nobody yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('roster-total')).not.toBeInTheDocument()
  })
})

describe('picking who you are on this device — AC 5', () => {
  it('offers unclaimed people when this device is nobody yet', () => {
    setup()
    expect(within(rowFor('Placeholder One')).getByRole('button', { name: /this is me/i })).toBeInTheDocument()
  })

  it('does not offer someone already claimed on another device', () => {
    setup()
    expect(
      within(rowFor('Placeholder Two')).queryByRole('button', { name: /this is me/i }),
    ).not.toBeInTheDocument()
  })

  it('offers nobody once this device already is someone', () => {
    setup({ me: roster[0] })
    expect(screen.queryByRole('button', { name: /this is me/i })).not.toBeInTheDocument()
  })

  it('marks which person this device is acting as', () => {
    setup({ me: roster[0] })
    expect(within(rowFor('Placeholder One')).getByText(/· you/)).toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).queryByText(/· you/)).not.toBeInTheDocument()
  })

  it('claims by member id, not by name', async () => {
    const { onClaim } = setup()
    await clickAndSettle(
      within(rowFor('Placeholder One')).getByRole('button', { name: /this is me/i }),
    )
    expect(onClaim).toHaveBeenCalledWith('m1')
  })
})

describe('adding someone — AC 2', () => {
  it('will not add a person with no name', () => {
    setup()
    expect(screen.getByRole('button', { name: /add to household/i })).toBeDisabled()
  })

  it('adds the name and budget that were typed', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    fireEvent.change(within(form).getByLabelText(/available minutes per week/i), {
      target: { value: '90' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({ displayName: 'Placeholder Three', weeklyMinutes: '90' })
  })

  it('clears the form after a person is added, so the next one starts empty', async () => {
    setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('')
  })

  it('keeps what was typed when the add fails, so nothing has to be retyped', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('network down'))
    render(
      <Roster
        household={household}
        members={roster}
        me={null}
        onAdd={onAdd}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClaim={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    const form = screen.getAllByRole('button', { name: /add to household/i })[0].closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    await clickAndSettle(within(form).getByRole('button', { name: /add to household/i }))

    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('Placeholder Three')
  })

  it('defaults an omitted budget to zero rather than sending nothing', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({ displayName: 'Placeholder Three', weeklyMinutes: 0 })
  })
})

describe('editing and removing — AC 4', () => {
  it('saves the edited name and budget against the right person', async () => {
    const { onSave } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /^edit$/i }))

    fireEvent.change(screen.getByLabelText(/name for placeholder one/i), {
      target: { value: 'Placeholder One Renamed' },
    })
    fireEvent.change(screen.getByLabelText(/weekly minutes for placeholder one/i), {
      target: { value: '200' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith('m1', {
      displayName: 'Placeholder One Renamed',
      weeklyMinutes: '200',
    })
  })

  it('abandons an edit without saving it', () => {
    const { onSave } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /^edit$/i }))
    fireEvent.change(screen.getByLabelText(/name for placeholder one/i), {
      target: { value: 'Discard me' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
  })

  // Removing a person is destructive and there is no undo, so it takes two
  // deliberate taps. One tap on a phone in a pocket is not a decision.
  it('does not remove anyone on the first tap', () => {
    const { onRemove } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /remove placeholder one/i }))
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('removes only after the confirmation is tapped', async () => {
    const { onRemove } = setup()
    const row = rowFor('Placeholder One')
    fireEvent.click(within(row).getByRole('button', { name: /remove placeholder one/i }))
    await clickAndSettle(within(row).getByRole('button', { name: /remove placeholder one\?/i }))
    expect(onRemove).toHaveBeenCalledWith('m1')
  })

  it('can be backed out of after the first tap', () => {
    const { onRemove } = setup()
    const row = rowFor('Placeholder One')
    fireEvent.click(within(row).getByRole('button', { name: /remove placeholder one/i }))
    fireEvent.click(within(row).getByRole('button', { name: /^keep$/i }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
  })
})

describe('seeing another phone’s changes — AC 2', () => {
  // The agreed bar is "visible on next load/refresh", not live push, so the
  // refresh has to be reachable without closing the app.
  it('offers a refresh that re-reads from the server', () => {
    const { onRefresh } = setup()
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe('per-member credentials — story #23', () => {
  const organizerId = 'm1'
  const withPins = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 0, claimed_by: 'device-a', has_pin: true },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: null, has_pin: false },
    { id: 'm3', display_name: 'Placeholder Three', weekly_minutes: 60, claimed_by: null, has_pin: true },
  ]
  const asOrganizer = {
    members: withPins,
    me: withPins[0],
    isOrganizer: true,
    household: { ...household, organizer_member_id: organizerId },
  }

  it('offers the organizer a control on every person', () => {
    setup(asOrganizer)
    expect(screen.getByLabelText(/set pin for Placeholder Two/i)).toBeInTheDocument()
    // Already has one, so it is a reset — the wording has to say which, because
    // a parent needs to know they are about to invalidate a child's PIN.
    expect(screen.getByLabelText(/reset pin for Placeholder Three/i)).toBeInTheDocument()
  })

  it('offers it to nobody else, because the database would refuse them anyway', () => {
    setup({ ...asOrganizer, isOrganizer: false, me: withPins[1] })
    expect(screen.queryByLabelText(/set pin for/i)).toBeNull()
    expect(screen.queryByLabelText(/reset pin for/i)).toBeNull()
  })

  it('sends the PIN for the person whose row it was typed in', async () => {
    const { onSetPin } = setup(asOrganizer)
    fireEvent.click(screen.getByLabelText(/set pin for Placeholder Two/i))
    fireEvent.change(screen.getByLabelText(/^PIN for Placeholder Two$/i), {
      target: { value: '4821' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /save pin/i }))
    expect(onSetPin).toHaveBeenCalledWith('m2', '4821')
  })

  it('will not send one too short to be a credential', () => {
    const { onSetPin } = setup(asOrganizer)
    fireEvent.click(screen.getByLabelText(/set pin for Placeholder Two/i))
    fireEvent.change(screen.getByLabelText(/^PIN for Placeholder Two$/i), { target: { value: '12' } })
    expect(screen.getByRole('button', { name: /save pin/i })).toBeDisabled()
    expect(onSetPin).not.toHaveBeenCalled()
  })

  // #63 — the other half of that sentence. Until this existed, "that is the
  // sign-in flow" pointed at nothing: `claimMemberWithPin` was exported, unit
  // tested, and called by no component, so it was tree-shaken out of the
  // deployed bundle. Setting someone's PIN released their phone and left them
  // no way back in.
  //
  // Every test below that asserts the control is ABSENT passed before the fix
  // too. Only the ones asserting it is PRESENT could have caught the bug, which
  // is the lesson rather than the coverage.
  it('offers a sign-in control to a person who has a PIN and is claimed by nobody', () => {
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn: vi.fn() })
    expect(screen.getByLabelText(/sign in as Placeholder Three/i)).toBeInTheDocument()
  })

  it('does not offer it to a person with no PIN — for them it is "this is me"', () => {
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn: vi.fn() })
    expect(screen.queryByLabelText(/sign in as Placeholder Two/i)).not.toBeInTheDocument()
  })

  it('does not offer it for someone already claimed on another device', () => {
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn: vi.fn() })
    expect(screen.queryByLabelText(/sign in as Placeholder One/i)).not.toBeInTheDocument()
  })

  it('does not offer it once this device is already someone', () => {
    setup({ members: withPins, me: withPins[0], isOrganizer: false, onSignIn: vi.fn() })
    expect(screen.queryByLabelText(/sign in as Placeholder Three/i)).not.toBeInTheDocument()
  })

  it('sends the PIN for the person whose row it was typed in', async () => {
    const onSignIn = vi.fn().mockResolvedValue(undefined)
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn })
    await clickAndSettle(screen.getByLabelText(/sign in as Placeholder Three/i))
    fireEvent.change(screen.getByLabelText(/enter PIN to sign in as Placeholder Three/i), {
      target: { value: '4821' },
    })
    await clickAndSettle(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalledWith('m3', '4821')
  })

  it('will not send one too short to be a credential', async () => {
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn: vi.fn() })
    await clickAndSettle(screen.getByLabelText(/sign in as Placeholder Three/i))
    fireEvent.change(screen.getByLabelText(/enter PIN to sign in as Placeholder Three/i), {
      target: { value: '12' },
    })
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('keeps the digits and the form open when the PIN is refused, so nothing is retyped', async () => {
    const onSignIn = vi.fn().mockRejectedValue(new Error('that was not the right PIN'))
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn })
    await clickAndSettle(screen.getByLabelText(/sign in as Placeholder Three/i))
    const field = screen.getByLabelText(/enter PIN to sign in as Placeholder Three/i)
    fireEvent.change(field, { target: { value: '9999' } })
    await clickAndSettle(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSignIn).toHaveBeenCalled()
    expect(screen.getByLabelText(/enter PIN to sign in as Placeholder Three/i)).toHaveValue('9999')
  })

  it('invents no message of its own about WHY a PIN was refused', async () => {
    // The database deliberately will not say whether the person or the PIN was
    // wrong. A helpful-looking component message would undo that at the only
    // layer the attacker can see.
    const onSignIn = vi.fn().mockRejectedValue(new Error('that was not the right PIN'))
    setup({ members: withPins, me: null, isOrganizer: false, onSignIn })
    await clickAndSettle(screen.getByLabelText(/sign in as Placeholder Three/i))
    fireEvent.change(screen.getByLabelText(/enter PIN to sign in as Placeholder Three/i), {
      target: { value: '9999' },
    })
    await clickAndSettle(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.queryByText(/wrong PIN|no such person|incorrect PIN|not a member/i)).not.toBeInTheDocument()
  })

  it('does not offer "this is me" for a person with a PIN — that is the sign-in flow', () => {
    // claim_member() refuses a PIN-protected member outright, so the button's
    // only possible outcome would be an error message.
    setup({ members: withPins, me: null, isOrganizer: false })
    const three = rowFor('Placeholder Three')
    expect(within(three).queryByRole('button', { name: /this is me/i })).toBeNull()

    const two = rowFor('Placeholder Two')
    expect(within(two).getByRole('button', { name: /this is me/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #46 — this week's capacity, on the roster row.
//
// The row is where it belongs: capacity is a fact about a PERSON, and the
// baseline is already here. capacity.test.js's allowlist comment said so before
// this story existed — "Roster.jsx renders the BASELINE ... #46 is where that
// screen starts showing this week's number, and it will come through
// effectiveCapacity."
// ---------------------------------------------------------------------------

describe('this week’s capacity — #46', () => {
  const override = {
    id: 'c1',
    member_id: roster[0].id,
    period_start: PERIOD,
    // Deliberately NOT roster[0]'s 120-minute baseline. An override equal to the
    // baseline is a fixture on which "shows the override" and "ignores the
    // override entirely" give the same answer, so the test would pass with the
    // whole feature deleted. Same shape prove-tests records as: the constraint
    // and the unconstrained rule agreeing on the chosen fixture.
    minutes: 200,
    source: 'manual',
  }

  const openFor = (name) =>
    clickAndSettle(screen.getByRole('button', { name: new RegExp(`set this week for ${name}`, 'i') }))

  it('shows the usual number when nobody has said anything about this week', () => {
    setup()
    const row = rowFor(roster[0].display_name)
    expect(row).toHaveTextContent(`This week: ${roster[0].weekly_minutes} min`)
    expect(row).toHaveTextContent(/· usual/)
  })

  it('shows the override when there is one, and marks it as set', () => {
    setup({ overrides: [override] })
    const row = rowFor(roster[0].display_name)
    expect(row).toHaveTextContent('This week: 200 min')
    expect(row).toHaveTextContent(/set for this week/)
  })

  it('keeps the BASELINE visible beside it, so the override can be checked', () => {
    // An override that hid what it was overriding would make the figure
    // impossible to sanity-check, and the product's whole claim is a fairness
    // number anybody can check.
    setup({ overrides: [override] })
    const row = rowFor(roster[0].display_name)
    expect(row).toHaveTextContent(`${roster[0].weekly_minutes} min/week`)
    expect(row).toHaveTextContent('This week: 200 min')
  })

  it('an override of ZERO shows as zero, not as the baseline', () => {
    // The case the feature most exists for, and the one a truthiness check
    // silently breaks — `override?.minutes || baseline` returns the baseline for
    // somebody who has just said they have no time at all this week.
    setup({ overrides: [{ ...override, minutes: 0 }] })
    expect(rowFor(roster[0].display_name)).toHaveTextContent('This week: 0 min')
  })


  it('AC 2: an override for ANOTHER week does not show — it expires with its period', async () => {
    // The assertion that makes the period check load-bearing. Every other test
    // in this describe uses an override whose period MATCHES, so matching on the
    // person alone gives the same answer on all of them — the constraint and the
    // unconstrained rule agreeing on the fixture, which is a test that cannot
    // fail on the property it names.
    //
    // Measured: without the period comparison this row reads "This week: 200
    // min" from a week nobody said anything about, while the chore screen's load
    // figures read the baseline, because capacitiesFor filters again. Two
    // answers to one question on one screen, both plausible.
    setup({ overrides: [{ ...override, period_start: '2026-08-03' }] })
    const row = rowFor(roster[0].display_name)
    expect(row).toHaveTextContent(`This week: ${roster[0].weekly_minutes} min`)
    expect(row).toHaveTextContent(/· usual/)
    expect(row).not.toHaveTextContent('This week: 200 min')

    // And nothing is offered to clear, because from this week's point of view
    // there is nothing set.
    await openFor(roster[0].display_name)
    expect(
      screen.queryByRole('button', {
        name: new RegExp(`use the usual weekly minutes for ${roster[0].display_name}`, 'i'),
      }),
    ).not.toBeInTheDocument()
  })

  it("does not apply one person's override to anybody else", () => {
    setup({ overrides: [override] })
    expect(rowFor(roster[1].display_name)).toHaveTextContent(
      `This week: ${roster[1].weekly_minutes} min`,
    )
    expect(rowFor(roster[1].display_name)).toHaveTextContent(/· usual/)
  })

  it('saves what was typed, through the handler', async () => {
    const { onSetCapacity } = setup()
    await openFor(roster[0].display_name)
    fireEvent.change(
      screen.getByLabelText(new RegExp(`minutes this week for ${roster[0].display_name}`, 'i')),
      { target: { value: '120' } },
    )
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '120')
  })

  it('seeds the editor from the CURRENT value every time it opens', async () => {
    // The row never unmounts while the household is on screen, so a useState
    // initialiser would keep offering what this device saw at first render —
    // and saving would write that stale number back over another phone's edit.
    // Same fault and same fix as the chore editor.
    setup({ overrides: [override] })
    await openFor(roster[0].display_name)
    expect(
      screen.getByLabelText(new RegExp(`minutes this week for ${roster[0].display_name}`, 'i')),
    ).toHaveValue(200)
  })

  it('refuses a value the database would refuse, with a sentence, before calling the handler', async () => {
    const { onSetCapacity } = setup()
    await openFor(roster[0].display_name)
    fireEvent.change(
      screen.getByLabelText(new RegExp(`minutes this week for ${roster[0].display_name}`, 'i')),
      { target: { value: '-5' } },
    )
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be negative/i)
    expect(onSetCapacity, 'a refused value must never become a request').not.toHaveBeenCalled()
  })

  it('offers "use my usual" only when there is something to clear', async () => {
    setup()
    await openFor(roster[0].display_name)
    expect(
      screen.queryByRole('button', {
        name: new RegExp(`use the usual weekly minutes for ${roster[0].display_name}`, 'i'),
      }),
      'nothing is overridden, so there is nothing to undo',
    ).not.toBeInTheDocument()
  })

  it('and clears through the handler when there is', async () => {
    const { onClearCapacity } = setup({ overrides: [override] })
    await openFor(roster[0].display_name)
    await clickAndSettle(
      screen.getByRole('button', {
        name: new RegExp(`use the usual weekly minutes for ${roster[0].display_name}`, 'i'),
      }),
    )
    expect(onClearCapacity).toHaveBeenCalledWith(roster[0].id)
  })

  it('disables the controls while a write is in flight', async () => {
    setup({ overrides: [override], busy: true })
    expect(
      screen.getByRole('button', {
        name: new RegExp(`set this week for ${roster[0].display_name}`, 'i'),
      }),
    ).toBeDisabled()
  })

  it('a rejected save does not escape as an unhandled rejection', async () => {
    let handlerAttached = false
    const rejecting = () => {
      const p = Promise.reject(new Error('refused'))
      const then = p.then.bind(p)
      p.then = (...a) => {
        if (a[1]) handlerAttached = true
        return then(...a)
      }
      return p
    }
    setup({ onSetCapacity: rejecting })
    await openFor(roster[0].display_name)
    fireEvent.change(
      screen.getByLabelText(new RegExp(`minutes this week for ${roster[0].display_name}`, 'i')),
      { target: { value: '120' } },
    )
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))
    expect(handlerAttached, 'the save ignored the promise it was given').toBe(true)
  })

  // -------------------------------------------------------------------------
  // AC 5 — a 360px phone.
  //
  // Stated as what this instrument CAN and CANNOT see, because the difference
  // matters. jsdom applies no stylesheet and computes no layout, so "no
  // horizontal overflow at 360px" is not measurable here and no assertion in
  // this file should pretend otherwise — a green run would be evidence about
  // jsdom, not about a phone.
  //
  // What is checkable here: the control is REACHABLE and OPERABLE — it exists,
  // it has an accessible name, it is a real button and a real labelled input —
  // and the stylesheet carries the rules that make wrapping rather than
  // overflowing true. The visual confirmation belongs to #48, which looks at
  // this surface on a real phone.
  // -------------------------------------------------------------------------

  describe('AC 5 — reachable and operable, with the overflow rules in place', () => {
    it('the control is reachable by name and operable as a button', () => {
      setup()
      const trigger = screen.getByRole('button', {
        name: new RegExp(`set this week for ${roster[0].display_name}`, 'i'),
      })
      expect(trigger).toBeInTheDocument()
      expect(trigger).toBeEnabled()
      expect(trigger.tagName).toBe('BUTTON')
    })

    it('the editor is a labelled numeric field, not a bare box', async () => {
      setup()
      await openFor(roster[0].display_name)
      const field = screen.getByLabelText(
        new RegExp(`minutes this week for ${roster[0].display_name}`, 'i'),
      )
      expect(field).toHaveAttribute('type', 'number')
      // The bounds are on the element for assistive tech and the spinner; the
      // REFUSAL is ours, in the submit handler, so the sentence is one wording
      // on every browser. Chores.jsx records the measurement behind that.
      expect(field).toHaveAttribute('min', '0')
      expect(field).toHaveAttribute('max', '10080')
    })

    it('the stylesheet wraps the row rather than letting it overflow sideways', () => {
      // A property of the CSS, not of the render — jsdom would pass this
      // identically with no rules at all, which is exactly why it is asserted
      // against the stylesheet text instead.
      const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
      const block = css.slice(css.indexOf('.member__week {'), css.indexOf('.member__week-form'))
      expect(block, 'the .member__week rules are no longer where this test looks').toContain(
        'flex-wrap: wrap',
      )
      expect(block).toContain('min-width: 0')
    })

    it('POSITIVE CONTROL: the stylesheet slice is real, so the assertion above is not vacuous', () => {
      const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
      expect(css).toContain('.member__week {')
      expect(css.indexOf('.member__week {')).toBeLessThan(css.indexOf('.member__week-form'))
    })
  })
})
