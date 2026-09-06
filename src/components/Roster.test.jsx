import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Roster from './Roster.jsx'

// ACs 2 and 4 (people with budgets, edited and removed) and the "pick yourself"
// half of AC 5. Names are synthetic — see #19.

const household = { id: 'h1', name: 'Placeholder Household' }

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
    onRefresh: vi.fn(),
    onSignOut: vi.fn().mockResolvedValue(undefined),
    // #46. The parameter this function already calls `overrides` is the PROP
    // BAG; the Roster prop of the same name is the capacity override list, and
    // `setup({ overrides: [...] })` sets exactly that. Confusing on first read
    // and left alone rather than renamed, because renaming the parameter would
    // touch every existing call in this file for no behavioural gain.
    onSetCapacity: vi.fn().mockResolvedValue(undefined),
    onClearCapacity: vi.fn().mockResolvedValue(undefined),
    // #87 — provisioning. A spy rather than a stub returning undefined: the
    // control chains `.then(close)` off it, so a non-promise would close the
    // form for the wrong reason and hide a broken call.
    onProvision: vi.fn().mockResolvedValue(undefined),
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

describe('the household header — #62', () => {
  // Two whole describes stood here: one asserting the join code was on screen
  // for the organizer to read out, and one covering the share sheet and
  // clipboard fallbacks behind AC 1's "read out OR SEND".
  //
  // Both went with the code itself. Admission is an account provisioned for one
  // named person, so there is nothing to read out and nothing to send. The
  // screen's remaining job here is to say what it cannot yet do.

  it('shows no join code, because there is none', () => {
    setup()
    expect(screen.queryByTestId('join-code')).not.toBeInTheDocument()
    // The old note conceded the code was "deterrence, not a lock". That
    // concession is what #62 removed; asserting its absence keeps a copy-paste
    // from quietly reinstating a claim that is no longer true.
    expect(screen.queryByText(/deterrence, not\s+a lock/i)).not.toBeInTheDocument()
  })

  it('tells the organizer how to give somebody a sign-in — #87', () => {
    // Was "tells the organizer that provisioning is not built yet", asserting
    // the note said `not built yet`. #87 built it, so that assertion is now the
    // wrong way round and is REPLACED rather than deleted: the note still has a
    // job, and an organizer who is told nothing here has to guess whether the
    // button on each row is the thing that fixes "No sign-in yet".
    setup({ isOrganizer: true })
    expect(screen.getByTestId('provisioning-note')).toHaveTextContent(/sign-in from their row/i)
  })

  it('no longer claims provisioning is unbuilt — the placeholder must not outlive the gap', () => {
    // #87 AC 6 names this explicitly. An honest placeholder that survives the
    // thing it apologised for becomes a false statement that reads as
    // documentation, and this one would send an organizer hunting for a tool
    // that is now sitting on the row in front of them.
    setup({ isOrganizer: true })
    expect(screen.queryByText(/not built yet/i)).not.toBeInTheDocument()
  })

  it('does not say it to anyone who cannot act on it', () => {
    setup({ isOrganizer: false })
    expect(screen.queryByTestId('provisioning-note')).not.toBeInTheDocument()
  })

  it('offers a way to sign out, which device auth never needed', () => {
    // A session is a PERSON now. On a shared tablet this is the only way to
    // stop being them, and the only way to undo signing in as the wrong one.
    //
    // #291 — the name is EXACT now rather than /sign out/i. There are two
    // sign-out controls on this row and a substring match would have taken
    // either, which is a test that cannot tell apart the two things this story
    // exists to separate.
    const { onSignOut } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledWith({ everywhere: false })
  })

  // #291 — the lost-or-stolen-device route. The assertions are on the OPTION
  // each control passes, because "a sign-out happened" is satisfied by both and
  // is the assertion that let a `global` default ship unnoticed.
  it('offers a second, confirmed route that ends every session for the account', () => {
    const { onSignOut } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out on every device?' }))
    expect(onSignOut).toHaveBeenCalledWith({ everywhere: true })
  })

  it('does not end every session on the first tap of it', () => {
    // The confirm is the point: this control ends sessions on devices the
    // person is not holding, so a mis-tap on the button beside the ordinary
    // one must not be enough.
    const { onSignOut } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    expect(onSignOut).not.toHaveBeenCalled()
  })

  it('backs out of the confirm without signing out at all', () => {
    const { onSignOut } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }))
    expect(onSignOut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument()
  })

  it('leaves the ordinary sign-out local while the confirm is open', () => {
    // Both controls are on screen at once in the confirming state. The
    // ordinary one must still mean this device only.
    const { onSignOut } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledWith({ everywhere: false })
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

describe('who you are, and who can get in — #62', () => {
  // This block used to be "picking who you are on this device": a "This is me"
  // button on every unclaimed row, because a phone had an identity and a person
  // did not. You no longer pick yourself off a list — you sign in, and you
  // arrive already being somebody. What the row still reports is whether an
  // account exists for a person, which is the part an organizer can act on.

  it('offers nobody a way to pick themselves off the roster', () => {
    setup()
    expect(screen.queryByRole('button', { name: /this is me/i })).not.toBeInTheDocument()
  })

  it('says who has a way in and who does not', () => {
    setup()
    expect(within(rowFor('Placeholder One')).getByTestId('access-m1')).toHaveTextContent(
      /no sign-in yet/i,
    )
    expect(within(rowFor('Placeholder Two')).getByTestId('access-m2')).toHaveTextContent(
      /signed in/i,
    )
  })

  it('marks which person this phone is signed in as', () => {
    setup({ me: roster[0] })
    expect(within(rowFor('Placeholder One')).getByText(/· you/)).toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).queryByText(/· you/)).not.toBeInTheDocument()
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

    expect(onAdd).toHaveBeenCalledWith({
      displayName: 'Placeholder Three',
      weeklyMinutes: '90',
      email: '',
    })
  })

  // #242 — the field that makes the sign-in usable. Asserted as the WHOLE
  // payload rather than with `objectContaining`, deliberately: this call is the
  // only place the typed address becomes a write, and a partial match would
  // still pass if the field were wired to the wrong key.
  it('adds the email address that was typed, which is what the sign-in needs', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    fireEvent.change(within(form).getByLabelText(/email address/i), {
      target: { value: 'placeholder.three@example.com' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({
      displayName: 'Placeholder Three',
      weeklyMinutes: 0,
      email: 'placeholder.three@example.com',
    })
  })

  it('clears the address too, so the next person does not inherit it', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    fireEvent.change(within(form).getByLabelText(/email address/i), {
      target: { value: 'placeholder.three@example.com' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalled()
    expect(within(form).getByLabelText(/email address/i)).toHaveValue('')
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

    expect(onAdd).toHaveBeenCalledWith({
      displayName: 'Placeholder Three',
      weeklyMinutes: 0,
      email: '',
    })
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
      email: '',
    })
  })

  // #242 — `0007` granted `members.email` as updatable and argued for exactly
  // this ("an organizer correcting a typo in an address is ordinary roster
  // maintenance"); nothing has ever written through that grant. This is also
  // the only route for a member added before the field existed, which is every
  // member on the live project.
  it('saves a corrected email address, which is what the grant was written for', async () => {
    const { onSave } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /^edit$/i }))

    fireEvent.change(screen.getByLabelText(/email address for placeholder one/i), {
      target: { value: 'placeholder.one@example.com' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith('m1', {
      displayName: 'Placeholder One',
      weeklyMinutes: '120',
      email: 'placeholder.one@example.com',
    })
  })

  it('starts the address field at what the row already holds, so a save is not a wipe', () => {
    setup({ members: [{ ...roster[0], email: 'placeholder.one@example.com' }] })
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    expect(screen.getByLabelText(/email address for placeholder one/i)).toHaveValue(
      'placeholder.one@example.com',
    )
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
    const { onRemove } = setup({ isOrganizer: true })
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /remove placeholder one/i }))
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('removes only after the confirmation is tapped', async () => {
    const { onRemove } = setup({ isOrganizer: true })
    const row = rowFor('Placeholder One')
    fireEvent.click(within(row).getByRole('button', { name: /remove placeholder one/i }))
    await clickAndSettle(within(row).getByRole('button', { name: /remove placeholder one\?/i }))
    expect(onRemove).toHaveBeenCalledWith('m1')
  })

  it('can be backed out of after the first tap', () => {
    const { onRemove } = setup({ isOrganizer: true })
    const row = rowFor('Placeholder One')
    fireEvent.click(within(row).getByRole('button', { name: /remove placeholder one/i }))
    fireEvent.click(within(row).getByRole('button', { name: /^keep$/i }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
  })
})

// #152 — removing a member is the organizer's alone.
//
// Before this, every member saw Remove on every row, and the database agreed:
// `members_delete_same_household` refused only SELF-removal. So any second
// claimed member could remove the organizer, which sets
// `households.organizer_member_id` to NULL — and `create_household` is the only
// thing that ever writes it, so provisioning ended for that household for good.
//
// These are the CLIENT half. The guard is the policy (0016), asserted over a
// real Postgres in `organizer-removal.pglite.test.js`; nothing here would stop
// a crafted request and nothing here is meant to.
describe('only the organizer may remove a member — #152', () => {
  it('offers Remove on no row at all to a member who is not the organizer', () => {
    setup({ isOrganizer: false })
    // Every row, not just somebody else's: a non-organizer may not remove
    // themselves either, which 0007's clause already refused server-side.
    expect(screen.queryAllByRole('button', { name: /^remove/i })).toHaveLength(0)
  })

  it('offers Remove on every OTHER row to the organizer', () => {
    setup({ isOrganizer: true })
    expect(
      within(rowFor('Placeholder One')).getByRole('button', { name: /remove placeholder one/i }),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Placeholder Two')).getByRole('button', { name: /remove placeholder two/i }),
    ).toBeInTheDocument()
  })

  it('does not offer the organizer Remove on their OWN row', () => {
    // 0007 refuses self-removal from every caller, the organizer included — so a
    // Remove here is a control the database will always turn down. Same rule as
    // hiding it from a non-organizer, applied to the other clause of the same
    // policy, and the reason `me` is passed into the row at all.
    setup({ isOrganizer: true, me: { id: 'm1', display_name: 'Placeholder One' } })
    expect(
      within(rowFor('Placeholder One')).queryByRole('button', { name: /remove placeholder one/i }),
    ).toBeNull()
    // POSITIVE CONTROL: the other row still offers it, so this is about WHOSE
    // row it is and not about the organizer having lost the control entirely.
    expect(
      within(rowFor('Placeholder Two')).getByRole('button', { name: /remove placeholder two/i }),
    ).toBeInTheDocument()
  })

  it('still offers Edit to a member who is not the organizer', () => {
    // The asymmetry is deliberate and is the thing most likely to be "tidied"
    // later by somebody gating both on one flag. Editing a name or a minutes
    // figure is ordinary maintenance with an undo; removing a person is not.
    setup({ isOrganizer: false })
    expect(
      within(rowFor('Placeholder One')).getByRole('button', { name: /^edit$/i }),
    ).toBeInTheDocument()
  })

  it('says so plainly when the household has no organizer at all', () => {
    // 0016 stops this state being created; it cannot repair one that exists.
    // Rendering an ordinary roster with the organizer's tools silently missing
    // reads as a permissions bug and sends somebody hunting the wrong fault.
    setup({ isOrganizer: false, household: { id: 'h1', name: 'Placeholder Household' } })
    expect(screen.getByTestId('no-organizer-note')).toBeInTheDocument()
    expect(screen.getByTestId('no-organizer-note')).toHaveAttribute('role', 'status')
  })

  it('says nothing about a missing organizer when there is one', () => {
    // POSITIVE CONTROL for the test above: without it, a note that never renders
    // and a note that always renders are indistinguishable from a passing suite.
    setup({
      isOrganizer: true,
      household: { id: 'h1', name: 'Placeholder Household', organizer_member_id: 'm1' },
    })
    expect(screen.queryByTestId('no-organizer-note')).toBeNull()
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

// `per-member credentials — story #23` stood here: seventeen tests over the
// organizer's Set PIN control, the PIN sign-in form, and the rule about which
// rows offered which. All of it tested UI for RPCs that 0007 drops, so there is
// no version of it that could be repaired rather than removed.
//
// What replaced the coverage, so this is a move rather than a loss:
//   - that the old route is gone from the CLIENT — household.test.js, "exports
//     no wrapper for any dropped RPC", with a positive control;
//   - that it is gone from the DATABASE — migrations.pglite.test.js, "every
//     retired function is absent from the catalog", also with a positive
//     control;
//   - that the new route is reachable at all — gate.test.js, which reads
//     App.jsx, because no behavioural test can see whether a person has a path
//     to the code;
//   - that a member's access state is visible — the block above.
//
// What is NOT replaced, and is the honest gap: nothing here exercises an
// organizer GIVING somebody access, because nothing does that yet. It needs the
// Edge Function.

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

// #87 AC 6 — the row stops merely reporting "No sign-in yet" and gains the
// control that fixes it.
describe('#87 — giving somebody a sign-in', () => {
  it('offers the control to an organizer, on the row of somebody who has none', () => {
    setup({ isOrganizer: true })
    const control = screen.getByTestId('provision-m1')
    expect(control).toHaveTextContent(/give a sign-in/i)
  })

  it('offers a RESET on the row of somebody who already has one', () => {
    // Same control, different verb. The discriminator is `claimed_by`, which is
    // the only thing that says whether an account exists — m2 has one.
    setup({ isOrganizer: true })
    expect(screen.getByTestId('provision-m2')).toHaveTextContent(/reset sign-in/i)
  })

  it('does NOT offer it to a non-organizer, who the function would refuse anyway', () => {
    // Manners, not security: the Edge Function checks `is_household_organizer`
    // as the caller and refuses. Rendering a control that is always refused
    // promises something the app cannot deliver.
    setup({ isOrganizer: false })
    expect(screen.queryByTestId('provision-m1')).not.toBeInTheDocument()
  })

  it('sends the typed credential, and says whether it is a reset', async () => {
    const handlers = setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m1'))
    fireEvent.change(screen.getByTestId('provision-input-m1'), {
      target: { value: 'kid-secret-1' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /give the sign-in/i }))
    })
    // Third argument is the reset flag — false here, because m1 has no account.
    expect(handlers.onProvision).toHaveBeenCalledWith('m1', 'kid-secret-1', false)
  })

  it('sends the reset flag for somebody who already has an account', async () => {
    const handlers = setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m2'))
    fireEvent.change(screen.getByTestId('provision-input-m2'), {
      target: { value: 'kid-secret-2' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset it/i }))
    })
    expect(handlers.onProvision).toHaveBeenCalledWith('m2', 'kid-secret-2', true)
  })

  it('refuses a short credential WITHOUT calling the server', async () => {
    // The floor is enforced in three places and this is the cheapest one. It is
    // not the boundary — the Edge Function refuses too — but a round trip to be
    // told "too short" is a worse experience than being told immediately.
    const handlers = setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m1'))
    fireEvent.change(screen.getByTestId('provision-input-m1'), { target: { value: 'abc' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /give the sign-in/i }))
    })
    expect(handlers.onProvision).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 6 characters/i)
  })

  it('tells the organizer to pass the credential on, because no email is sent', async () => {
    // The one thing an organizer cannot discover by trying it: a provisioned
    // member has a synthetic `.invalid` address, so nothing is ever delivered
    // and the PIN exists nowhere else once this form closes.
    setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m1'))
    // Scoped to the row's form, and asserted on the half that appears ONLY
    // there. The header note says "no email is sent" too, so a bare text query
    // matches both and passes whether or not the form says anything — the
    // assertion would have been about the wrong element.
    expect(
      within(rowFor('Placeholder One')).getByText(/nobody can look the pin up later/i),
    ).toBeInTheDocument()
  })

  // #242 — the two halves of the credential, on the screen where the organizer
  // decides what to say. Until this story the sentence here named the person's
  // NAME, which no sign-in has ever accepted: `signIn` is `signInWithPassword`,
  // so without the address the organizer hands over half a credential and the
  // member cannot get in.
  //
  // Each case is its own assertion because they fail differently and for
  // different people — a real address is a typo away from working, and a
  // synthetic one is unguessable, so an organizer who is shown neither has no
  // route at all.
  it('#242: names the synthetic address a PIN member will actually sign in with', () => {
    setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m1'))

    expect(screen.getByTestId('provision-address-m1')).toHaveTextContent(
      'm1@taskr.invalid',
    )
  })

  it('#242: names the real address instead, once the row has one', () => {
    setup({
      isOrganizer: true,
      members: [{ ...roster[0], email: 'placeholder.one@example.com' }],
    })
    fireEvent.click(screen.getByTestId('provision-m1'))

    const note = screen.getByTestId('provision-address-m1')
    expect(note).toHaveTextContent('placeholder.one@example.com')
    expect(note).not.toHaveTextContent('taskr.invalid')
  })

  it('#242: no screen tells the organizer that a name is what gets typed', () => {
    setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m1'))

    // The DENIAL, not the subject. The corrected sentences say "address"; a
    // reader restoring the old model would write "name" again, and only this
    // catches that. Asserted over the whole rendered screen rather than one
    // element, because the false claim lived in TWO places and a per-element
    // assertion would have covered one of them.
    expect(document.body.textContent).not.toMatch(/sign in with (their|your) (own )?name/i)
  })
})

// #95 — connecting a Google Calendar, from the capacity screen.
//
// The whole of AC 1 is a ROUTING question — who is shown the action — and it has
// two independent halves that fail differently, so each gets its own assertion
// rather than one test that happens to cover both.
//
// What this file cannot see, and does not claim to: whether the Edge Function
// would accept the call. It refuses a PIN member on the server as well, and that
// refusal is the real boundary; this is manners, the same relationship
// `SignInControl` has to the organizer check. The server half is proven in
// supabase/functions/calendar-connect/handler.test.js.
describe('#95 AC 1 — who is offered a calendar connection', () => {
  const withEmail = { ...roster[0], email: 'placeholder.one@example.test' }
  const pinMember = { ...roster[0], email: null }

  // The housemate has a REAL ADDRESS TOO, and that is the whole reason this
  // fixture is written out rather than reusing `roster[1]`.
  //
  // Found by a mutation pass, round 1, and it is the most expensive thing the
  // pass caught. `roster[1]` carries no `email`, so with it as the housemate the
  // "not on somebody else's row" test below was satisfied by the REAL-EMAIL
  // check inside `CalendarControl` and never exercised the `isMe` guard at all.
  // *Measured*: deleting `isMe` from Roster.jsx reddened ZERO against a
  // predicted 1 — every row in the household would have offered to connect a
  // calendar to whoever was holding the phone, and the suite stayed green.
  //
  // Two guards producing one observable are one guard with a spare, and the
  // spare is what keeps it green. Giving the housemate an address leaves `isMe`
  // as the only thing that can be doing the work.
  const housemateWithEmail = { ...roster[1], email: 'placeholder.two@example.test' }
  const connectHandlers = { onConnectCalendar: vi.fn() }

  const renderRoster = (props) =>
    setup({
      members: [withEmail, housemateWithEmail],
      me: withEmail,
      ...connectHandlers,
      ...props,
    })

  it('offers it to a signed-in member with a real address, on their own row', () => {
    renderRoster()
    expect(
      within(rowFor('Placeholder One')).getByRole('button', {
        name: /connect google calendar/i,
      }),
    ).toBeInTheDocument()
  })

  it('does NOT offer it on somebody else’s row, even when they COULD connect one', () => {
    // Google would sign in whoever is holding the phone and attach THEIR
    // calendar to a housemate's roster entry — a wrong answer that looks like a
    // right one all the way to the end.
    //
    // The housemate has a real address on purpose (see the fixture above), so
    // the only thing that can be keeping the control off their row is `isMe`.
    renderRoster()
    expect(
      within(rowFor('Placeholder Two')).queryByRole('button', {
        name: /connect google calendar/i,
      }),
    ).not.toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).queryByTestId('calendar-m2')).not.toBeInTheDocument()
  })

  it('POSITIVE CONTROL: that same housemate IS offered it on their own device', () => {
    // Which is what makes the absence above a fact about WHOSE row it is rather
    // than a fact about that person. Without it the assertion passes just as
    // happily against a fixture the control could never render for.
    setup({
      members: [withEmail, housemateWithEmail],
      me: housemateWithEmail,
      ...connectHandlers,
    })
    expect(
      within(rowFor('Placeholder Two')).getByRole('button', {
        name: /connect google calendar/i,
      }),
    ).toBeInTheDocument()
  })

  it('does NOT offer it to a PIN member — the action is ABSENT, not disabled', () => {
    // `members.email` null is `0007`'s discriminator, and there is no Google
    // identity behind an address with no mailbox. A disabled button is a promise
    // the app cannot keep and sends a household looking for the setting that
    // would enable it, so the control renders nothing at all.
    //
    // `me` IS this member, so `isMe` is true and the real-email check is the
    // only guard left that can refuse — the mirror of the pairing above.
    setup({ members: [pinMember, housemateWithEmail], me: pinMember, ...connectHandlers })
    const row = rowFor('Placeholder One')
    expect(row.textContent).not.toMatch(/google calendar/i)
    expect(within(row).queryByTestId('calendar-m1')).not.toBeInTheDocument()
  })

  it('POSITIVE CONTROL: the same fixture DOES offer it once the address is there', () => {
    // Without this, the absence above is satisfied by a control that never
    // renders — a prop threaded wrong, a typo in a name — and the assertion
    // would report the routing as correct while the feature was simply missing.
    renderRoster()
    expect(within(rowFor('Placeholder One')).getByTestId('calendar-m1')).toBeInTheDocument()
  })

  it('hands the press straight to App, which is what leaves for Google', () => {
    // A fresh spy rather than the shared one above: `setup` returns only the
    // handlers it made itself, so reading the shared `connectHandlers` would
    // also carry every click from every earlier test in this describe.
    const onConnectCalendar = vi.fn()
    renderRoster({ onConnectCalendar })
    fireEvent.click(
      within(rowFor('Placeholder One')).getByRole('button', { name: /connect google calendar/i }),
    )
    expect(onConnectCalendar).toHaveBeenCalledTimes(1)
  })
})

describe('#95 AC 5 — a connected member sees so on reload', () => {
  const withEmail = { ...roster[0], email: 'placeholder.one@example.test' }
  const connection = {
    id: 'conn-1',
    member_id: 'm1',
    scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    connected_at: '2026-08-24T10:00:00Z',
  }

  it('says Calendar connected, from a row the SERVER supplied', () => {
    // Not from anything this device remembers. A locally held flag would show
    // connected on the phone that pressed the button and nothing on the phone
    // that reloads — which is the state AC 5 is written against.
    setup({
      members: [withEmail, roster[1]],
      me: withEmail,
      connections: [connection],
      onConnectCalendar: vi.fn(),
    })
    const row = rowFor('Placeholder One')
    expect(within(row).getByText(/calendar connected/i)).toBeInTheDocument()
    expect(
      within(row).queryByRole('button', { name: /connect google calendar/i }),
      'an already-connected member should not be asked again',
    ).not.toBeInTheDocument()
  })

  it('ignores a connection belonging to somebody else', () => {
    // The rows arrive as a household-wide list, so matching on the person is the
    // whole of what makes this right. Matching on nothing — taking the first row
    // — would light up the wrong member the moment two people connect.
    setup({
      members: [withEmail, roster[1]],
      me: withEmail,
      connections: [{ ...connection, member_id: 'm2' }],
      onConnectCalendar: vi.fn(),
    })
    expect(
      within(rowFor('Placeholder One')).getByRole('button', {
        name: /connect google calendar/i,
      }),
    ).toBeInTheDocument()
  })
})

// ===========================================================================
// #96 — the calendar's suggestion, beside the number it informs
// ===========================================================================
//
// A READOUT, and every assertion below is really about that: it renders a
// figure, it never offers to apply it, and it writes nothing. Applying is #97.
describe('#96 — calendar-suggested busy minutes', () => {
  const zoned = { ...household, timezone: 'America/New_York' }
  const busyRow = {
    id: 'busy-1',
    member_id: 'm1',
    period_start: PERIOD,
    busy_minutes: 320,
    event_count: 6,
    // 01:00 UTC on the 12th is 21:00 on the 11th in this fixture's zone. Chosen
    // so the date the readout shows DEPENDS on the zone reaching it: the first
    // fixture was 14:00Z, which formats identically in New York and UTC, so
    // hard-coding `timeZone="UTC"` in Roster.jsx reddened nothing
    // (review-fanout, 2026-09-04).
    computed_at: '2026-08-12T01:00:00Z',
  }

  it('AC 4 — shows the suggestion beside this week’s minutes', () => {
    setup({ household: zoned, busyWeeks: [busyRow] })
    const row = rowFor('Placeholder One')
    expect(within(row).getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')
    // Beside the manual input, not instead of it: the number the person owns is
    // still the one the split divides, and it is still on screen.
    expect(within(row).getByTestId('week-m1')).toBeInTheDocument()
  })

  it('AC 4 — offers no way to apply it, because that is #97', () => {
    // The thinnest proof that nothing is written to `member_capacity`: there is
    // no control here to write with. A test asserting "the handler was not
    // called" would pass just as well against a button nobody pressed.
    const handlers = setup({ household: zoned, busyWeeks: [busyRow] })
    const row = rowFor('Placeholder One')
    expect(within(row).queryByRole('button', { name: /calendar/i })).not.toBeInTheDocument()
    expect(handlers.onSetCapacity).not.toHaveBeenCalled()
    expect(handlers.onClearCapacity).not.toHaveBeenCalled()
  })

  it('says WHEN it was read, because this story fetches a week once', () => {
    // Staleness is #98's story, so a figure read on Monday is still on screen on
    // Friday. A number shown without its age would be claiming a freshness it
    // does not have.
    setup({ household: zoned, busyWeeks: [busyRow] })
    // 'Aug 11', not 'Aug 12': the household's zone, not UTC, decides which day
    // the read happened on. This is the assertion that fails when the roster
    // stops passing the household's timezone through.
    expect(within(rowFor('Placeholder One')).getByText(/calendar suggests:/i)).toHaveTextContent(
      'Aug 11',
    )
    expect(within(rowFor('Placeholder One')).getByText(/calendar suggests:/i)).not.toHaveTextContent(
      'Aug 12',
    )
  })

  it('renders no readout for a member with no figure', () => {
    setup({ household: zoned, busyWeeks: [busyRow] })
    expect(
      within(rowFor('Placeholder Two')).queryByText(/calendar suggests:/i),
    ).not.toBeInTheDocument()
  })

  it('ignores a figure belonging to somebody else', () => {
    setup({ household: zoned, busyWeeks: [{ ...busyRow, member_id: 'm2' }] })
    expect(
      within(rowFor('Placeholder One')).queryByText(/calendar suggests:/i),
    ).not.toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).getByText(/calendar suggests:/i)).toBeInTheDocument()
  })

  it('ignores a figure from ANOTHER WEEK', () => {
    // The fault `overrideFor` had, in a second table: a figure from a foreign
    // period beside this week's minutes is invisible, because every number on
    // screen stays plausible and only the arithmetic is wrong.
    setup({ household: zoned, busyWeeks: [{ ...busyRow, period_start: '2026-08-03' }] })
    expect(
      within(rowFor('Placeholder One')).queryByText(/calendar suggests:/i),
    ).not.toBeInTheDocument()
  })

  it('shows a zero rather than hiding it — an empty week is an answer', () => {
    // `0` is falsy, and a readout guarded on the FIGURE instead of the ROW would
    // silently drop the one week a member most wants to see confirmed.
    setup({ household: zoned, busyWeeks: [{ ...busyRow, busy_minutes: 0, event_count: 0 }] })
    expect(within(rowFor('Placeholder One')).getByText(/calendar suggests:/i)).toHaveTextContent(
      '0 min busy',
    )
  })

  it('AC 5 — keeps the last figure and says the calendar could not be read', () => {
    const withEmail = { ...roster[0], email: 'placeholder.one@example.test' }
    setup({
      household: zoned,
      members: [withEmail, roster[1]],
      me: withEmail,
      busyWeeks: [busyRow],
      busyComplaint: 'That calendar connection is no longer valid.',
    })
    const row = rowFor('Placeholder One')
    expect(within(row).getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')
    // The server's sentence, rendered UNCHANGED. Asserted as an exact match
    // rather than a substring, because the fault the design-bar pass found was a
    // wrapper around it: any prefix restates a sentence the Edge Function
    // already worded to distinguish a revoked connection from an unreachable
    // Google, and this is what refuses one.
    expect(within(row).getByTestId('busy-complaint')).toHaveTextContent(
      /^That calendar connection is no longer valid\.$/,
    )
    // Untouched, which is the half of AC 5 that matters: a calendar that cannot
    // be read costs a suggestion and never the way the person sets their week.
    expect(within(row).getByRole('button', { name: /set this week/i })).toBeEnabled()
  })

  it('AC 5 — says it even when there is no figure to fall back to', () => {
    const withEmail = { ...roster[0], email: 'placeholder.one@example.test' }
    setup({
      household: zoned,
      members: [withEmail, roster[1]],
      me: withEmail,
      busyWeeks: [],
      busyComplaint: 'Could not reach Google. Try again in a moment.',
    })
    const row = rowFor('Placeholder One')
    expect(within(row).getByTestId('busy-complaint')).toHaveTextContent(
      /^Could not reach Google\. Try again in a moment\.$/,
    )
    expect(within(row).queryByText(/calendar suggests:/i)).not.toBeInTheDocument()
  })

  it('puts the complaint on the OWN row only, never on a housemate’s', () => {
    // It is about a read THIS device attempted with THIS member's credential.
    // On somebody else's row it would read as a statement about their calendar,
    // which this device knows nothing about.
    const withEmail = { ...roster[0], email: 'placeholder.one@example.test' }
    setup({
      household: zoned,
      members: [withEmail, roster[1]],
      me: withEmail,
      busyWeeks: [{ ...busyRow, member_id: 'm2' }],
      busyComplaint: 'Could not reach Google. Try again in a moment.',
    })
    expect(within(rowFor('Placeholder Two')).queryByTestId('busy-complaint')).not.toBeInTheDocument()
    expect(within(rowFor('Placeholder One')).getByTestId('busy-complaint')).toBeInTheDocument()
  })

  it('renders nothing at all when there is neither a figure nor a complaint', () => {
    setup({ household: zoned })
    expect(screen.queryByText(/calendar suggests:/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('busy-complaint')).not.toBeInTheDocument()
  })
})
