import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    // #87 — the PIN reset (`onProvision` until #191, when the mint half went).
    // A spy rather than a stub returning undefined: the control chains
    // `.then(close)` off it, so a non-promise would close the form for the
    // wrong reason and hide a broken call.
    onResetPin: vi.fn().mockResolvedValue(undefined),
    // #341 — the two email paths. Promise-returning for the same reason
    // `onResetPin` is: the control chains a `.then()` that puts the
    // confirmation note on screen, so a non-promise would throw inside the
    // click handler and the missing note would read as the note being broken.
    onInvite: vi.fn().mockResolvedValue(undefined),
    onSendReset: vi.fn().mockResolvedValue(undefined),
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

  it('tells the organizer how to give somebody a sign-in — #87, rewritten by #341', () => {
    // Was "tells the organizer that provisioning is not built yet", asserting
    // the note said `not built yet`. #87 built it, so that assertion is now the
    // wrong way round and is REPLACED rather than deleted: the note still has a
    // job, and an organizer who is told nothing here has to guess whether the
    // button on each row is the thing that fixes "No sign-in yet".
    //
    // #341 replaced it a second time, and the reason is worth separating from
    // the reason above. This test did not break because it was wrong; it broke
    // because the THING IT DESCRIBES changed under it — the organizer no longer
    // gives anybody a sign-in from their row, they send an invitation and the
    // person makes their own. That is the ordinary shape of a rule change
    // reddening a test that was about something else, and the repair is to
    // assert the new fact rather than to loosen the matcher until both pass.
    setup({ isOrganizer: true })
    // #191 — "an invitation from their row" until then; the invitation is part
    // of the add now, and the note says so.
    expect(screen.getByTestId('provisioning-note')).toHaveTextContent(/invitation as you add them/i)
    expect(screen.getByTestId('provisioning-note')).not.toHaveTextContent(/from their row/i)
    // The half worth asserting positively, because it is the story: nothing on
    // this screen asks the organizer for somebody else's credential.
    expect(screen.getByTestId('provisioning-note')).toHaveTextContent(/never set one/i)
  })

  it('#341 AC 5 — the PIN sentence is gone from the roster note', () => {
    // The criterion names the sentence by quotation, so it is asserted by its
    // own words rather than by the note's new ones. Separate from the test above
    // deliberately: that one would go on passing if the old sentence were
    // appended BELOW the new one, which is exactly how a reversal half-lands.
    setup({ isOrganizer: true })
    const note = screen.getByTestId('provisioning-note')
    expect(note).not.toHaveTextContent(/PIN/i)
    expect(note).not.toHaveTextContent(/no email is sent/i)
    expect(note).not.toHaveTextContent(/tell them/i)
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
  /** Fill the three fields; every submit path below needs an address since #191. */
  const fillAdd = (form, { name = 'Placeholder Three', minutes, email = 'placeholder.three@example.com' } = {}) => {
    fireEvent.change(within(form).getByLabelText(/^name$/i), { target: { value: name } })
    if (minutes !== undefined) {
      fireEvent.change(within(form).getByLabelText(/available minutes per week/i), {
        target: { value: minutes },
      })
    }
    fireEvent.change(within(form).getByLabelText(/email address/i), { target: { value: email } })
  }

  it('will not add a person with no name', () => {
    setup()
    expect(screen.getByRole('button', { name: /add to household/i })).toBeDisabled()
  })

  // #191 AC 1 — an address is required. The submit stays disabled with a name
  // alone, because the invitation is part of the add and there is nowhere to
  // send one. The positive half is the test after it: the same form with an
  // address enables.
  it('#191: will not add a person with no email address, because there is nowhere to invite them', () => {
    setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')
    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    expect(screen.getByRole('button', { name: /add to household/i })).toBeDisabled()
    expect(within(form).getByLabelText(/email address/i)).toBeRequired()

    fireEvent.change(within(form).getByLabelText(/email address/i), {
      target: { value: 'placeholder.three@example.com' },
    })
    expect(screen.getByRole('button', { name: /add to household/i })).toBeEnabled()
  })

  // #191 AC 6 — "a test asserts no credential field is present and reddens
  // when one is restored". Asserted as an exact CENSUS of the form's inputs
  // rather than as the absence of a password type, because the field this
  // story retired never was a password input on THIS form (the 2026-08-26
  // comment on the issue measured that): the PIN lived on the row. An exact
  // list reddens on any field restored under any name or type, and the
  // sibling test on the row (`#191 AC 3`, below) covers the row's half.
  it('#191 AC 6: the form asks for a name, minutes and an address, and nothing that takes a credential', () => {
    setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')
    const inputs = [...form.querySelectorAll('input')].map((input) => input.type)
    expect(inputs).toEqual(['text', 'number', 'email'])
    expect(within(form).queryByLabelText(/pin|password/i)).not.toBeInTheDocument()
    expect(within(form).queryByText(/\bPIN\b/)).not.toBeInTheDocument()
  })

  it('adds the name and budget that were typed', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form, { minutes: '90' })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({
      displayName: 'Placeholder Three',
      weeklyMinutes: '90',
      email: 'placeholder.three@example.com',
    })
  })

  // #191 AC 1 — "submitting sends an email invitation". Two calls in one
  // submit, and the ORDER and the ID are the claims: the invitation is sent for
  // the row the add returned, after the add resolved. Asserted with the id the
  // add handed back rather than any id on the fixture, so a form that invited
  // the wrong row — or invited before the row existed — reddens.
  it('#191 AC 1: adding somebody sends their invitation, for the row the add created', async () => {
    const onAdd = vi.fn().mockResolvedValue({ id: 'm9', email: 'placeholder.three@example.com' })
    const handlers = setup({ onAdd })
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form)
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(handlers.onInvite).toHaveBeenCalledTimes(1)
    expect(handlers.onInvite).toHaveBeenCalledWith('m9')
    expect(onAdd.mock.invocationCallOrder[0]).toBeLessThan(
      handlers.onInvite.mock.invocationCallOrder[0],
    )
    expect(screen.getByTestId('add-note')).toHaveTextContent(
      'Added. Invitation sent to placeholder.three@example.com.',
    )
  })

  it('#191 AC 1: a refused send leaves the person added, the form cleared and no "sent" claim', async () => {
    // The mailer allows two an hour (#341). The row exists — that write
    // resolved — so the form must clear rather than invite a second add of the
    // same person, and the confirmation must NOT appear: the refusal is on the
    // shell's error strip, and "Invitation sent" beside it would be a lie the
    // organizer acts on by waiting.
    const onAdd = vi.fn().mockResolvedValue({ id: 'm9' })
    const onInvite = vi.fn().mockRejectedValue(new Error('the mail service refused it'))
    setup({ onAdd, onInvite })
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form)
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onInvite).toHaveBeenCalledWith('m9')
    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('')
    expect(screen.queryByTestId('add-note')).not.toBeInTheDocument()
    // design-bar, 2026-09-12: the refusal is said UNDER the button, in the
    // form, because the shell's strip is the roster's last element and at
    // 360×800 it sat 754px below the fold while the form had just emptied.
    // Both facts in one sentence — the person is on the roster, the send
    // failed — so the organizer neither retries the add nor waits for mail.
    const complaint = within(form).getByRole('alert')
    expect(complaint).toHaveTextContent(/Placeholder Three is on the roster, but no invitation went/i)
    expect(complaint).toHaveTextContent(/the mail service refused it/i)
  })

  it('#191 AC 1: the refusal clears at the next submit, so it never describes an older send', async () => {
    const onAdd = vi.fn().mockResolvedValue({ id: 'm9' })
    const onInvite = vi
      .fn()
      .mockRejectedValueOnce(new Error('the mail service refused it'))
      .mockResolvedValue(undefined)
    setup({ onAdd, onInvite })
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form)
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))
    expect(within(form).getByRole('alert')).toBeInTheDocument()

    fillAdd(form, { email: 'placeholder.four@example.com' })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('add-note')).toHaveTextContent('placeholder.four@example.com')
  })

  it('#191 AC 1: a failed add sends nothing', async () => {
    // The order's other half: no row, no invitation. A form that fired both
    // calls together would invite an id that does not exist.
    const onAdd = vi.fn().mockRejectedValue(new Error('network down'))
    const handlers = setup({ onAdd })
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form)
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(handlers.onInvite).not.toHaveBeenCalled()
    expect(screen.queryByTestId('add-note')).not.toBeInTheDocument()
  })

  it('adds without inviting when no invite handler is wired — the #242 shape', async () => {
    // Wired-optional like every handler on this screen. A roster rendered with
    // no `onInvite` (the older tests in this file) still adds, and the add's
    // `.then` must not throw on a handler that is not there.
    const onAdd = vi.fn().mockResolvedValue({ id: 'm9' })
    setup({ onAdd, onInvite: undefined })
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form)
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('')
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

    fillAdd(form)
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

    fillAdd(form)
    await clickAndSettle(within(form).getByRole('button', { name: /add to household/i }))

    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('Placeholder Three')
  })

  it('defaults an omitted budget to zero rather than sending nothing', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fillAdd(form)
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({
      displayName: 'Placeholder Three',
      weeklyMinutes: 0,
      email: 'placeholder.three@example.com',
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
    // The third argument arrived with #210: a typed figure is source 'manual',
    // and it is the SAME call a proposed figure makes with one word different.
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '120', 'manual')
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
// control that fixes it. #191 AC 3 then took the MINT half away: the control
// that gave an email-less member a sign-in at a PIN the organizer typed is
// gone, because the Edge Function action behind it is gone. What survives on
// an email-less row is the RESET of an account that already exists — m2 in
// the fixture — and m1, with neither an address nor an account, is the row
// this story leaves with no control at all.
describe('#87 — the PIN control, after #191', () => {
  it('offers a RESET on the row of a PIN member who already has a sign-in', () => {
    // Same control as before, one verb. The discriminator is `claimed_by`,
    // which is the only thing that says whether an account exists — m2 has one.
    setup({ isOrganizer: true })
    expect(screen.getByTestId('provision-m2')).toHaveTextContent(/reset sign-in/i)
  })

  it('#191 AC 3: offers NOTHING that mints on the row of a PIN member with no sign-in', () => {
    // m1 has no address and no account. Until #191 this row carried "Give a
    // sign-in"; the action it called no longer exists, so the control must not
    // either — a control that is always refused is worse than none (#87's own
    // rule). Asserted over the whole row: no control, no PIN input, no PIN
    // sentence. This is the row half of AC 6's "reddens when one is restored";
    // the Add form's census is the other half.
    setup({ isOrganizer: true })
    const row = rowFor('Placeholder One')
    expect(screen.queryByTestId('provision-m1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provision-input-m1')).not.toBeInTheDocument()
    // No `input[type="password"]` line here — the retired PIN field was
    // `type="text"`, so that assertion held on the old form too (review-fanout).
    expect(within(row).queryByText(/\bPIN\b/)).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /sign-in/i })).not.toBeInTheDocument()
  })

  it('#191 AC 3: tells the organizer the route is an address, on that row and only that row', () => {
    setup({ isOrganizer: true })
    const note = screen.getByTestId('no-address-m1')
    expect(note).toHaveTextContent(/no email address on their row/i)
    expect(note).toHaveTextContent(/edit the row to add one/i)
    // NOT on the row that has a sign-in: that one has a reset, not a gap.
    expect(screen.queryByTestId('no-address-m2')).not.toBeInTheDocument()
  })

  it('does NOT offer the reset to a non-organizer, who the function would refuse anyway', () => {
    // Manners, not security: the Edge Function checks `is_household_organizer`
    // as the caller and refuses. Rendering a control that is always refused
    // promises something the app cannot deliver. The note goes with it — it
    // names an edit only the organizer's roster offers.
    setup({ isOrganizer: false })
    expect(screen.queryByTestId('provision-m2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('no-address-m1')).not.toBeInTheDocument()
  })

  it('sends the typed credential as a reset, with no reset flag left to get wrong', async () => {
    // Two arguments now. The third used to say whether this was a reset; every
    // call is one, and a flag that can only take one value is the kind of spare
    // that reads as a choice.
    const handlers = setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m2'))
    fireEvent.change(screen.getByTestId('provision-input-m2'), {
      target: { value: 'kid-secret-2' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset it/i }))
    })
    expect(handlers.onResetPin).toHaveBeenCalledWith('m2', 'kid-secret-2')
  })

  it('refuses a short credential WITHOUT calling the server', async () => {
    // The floor is enforced in three places and this is the cheapest one. It is
    // not the boundary — the Edge Function refuses too — but a round trip to be
    // told "too short" is a worse experience than being told immediately.
    const handlers = setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m2'))
    fireEvent.change(screen.getByTestId('provision-input-m2'), { target: { value: 'abc' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset it/i }))
    })
    expect(handlers.onResetPin).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 6 characters/i)
  })

  it('tells the organizer to pass the credential on, because no email is sent', async () => {
    // The one thing an organizer cannot discover by trying it: a PIN account
    // has a synthetic `.invalid` address, so nothing is ever delivered and the
    // PIN exists nowhere else once this form closes. Still true after #191 for
    // exactly this row, and for no new row ever again.
    setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m2'))
    // Scoped to the row's form, and asserted on the half that appears ONLY
    // there. A bare text query would match a header note too and pass whether
    // or not the form says anything — the assertion would have been about the
    // wrong element.
    expect(
      within(rowFor('Placeholder Two')).getByText(/nobody can look the pin up later/i),
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
    fireEvent.click(screen.getByTestId('provision-m2'))

    expect(screen.getByTestId('provision-address-m2')).toHaveTextContent(
      'm2@taskr.invalid',
    )
  })

  it('#242 under #341: a row with a real address is invited, and shows no form at all', async () => {
    // This case USED to open the provision form and assert the note named the
    // real address rather than the synthetic one. #341 removed that form for
    // exactly these rows, so the old assertion could only be made to pass by
    // reaching for an element that no longer exists.
    //
    // What #242 protects is unchanged and is still asserted: the organizer is
    // never shown an address that is not the one the account is reached at. The
    // address just moved from a note about what to say out loud to the target of
    // an email, so the assertion follows it there.
    setup({
      isOrganizer: true,
      members: [{ ...roster[0], email: 'placeholder.one@example.com' }],
    })

    expect(screen.queryByTestId('provision-m1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provision-address-m1')).not.toBeInTheDocument()

    await clickAndSettle(screen.getByTestId('invite-m1'))
    expect(screen.getByTestId('invite-note-m1')).toHaveTextContent(
      'placeholder.one@example.com',
    )
    expect(screen.getByTestId('invite-note-m1')).not.toHaveTextContent('taskr.invalid')
  })

  it('#341 AC 1 — no credential control anywhere on a row that has an address', () => {
    // The criterion's own words: "nothing that takes a credential — no PIN box,
    // no password field". Asserted as an ABSENCE over the whole row rather than
    // by the testid above, because the testid only proves THAT form is gone and
    // the criterion is about any of them.
    setup({
      isOrganizer: true,
      members: [{ ...roster[0], email: 'placeholder.one@example.com' }],
    })

    const row = rowFor('Placeholder One')
    expect(within(row).queryByText(/PIN/i)).not.toBeInTheDocument()
    expect(row.querySelector('input[type="password"]')).toBeNull()
    // The positive half, so this cannot pass on a row that renders nothing.
    expect(within(row).getByRole('button', { name: /email .* an invitation/i })).toBeInTheDocument()
  })

  it('#242: no screen tells the organizer that a name is what gets typed', () => {
    setup({ isOrganizer: true })
    fireEvent.click(screen.getByTestId('provision-m2'))

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
  // `onDisconnectCalendar` is required by `CalendarControl` since #99 — an exit
  // with no handler behind it is the state that story exists to prevent, so the
  // prop is required rather than optional and every render of this control
  // supplies one.
  const connectHandlers = { onConnectCalendar: vi.fn(), onDisconnectCalendar: vi.fn() }

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
      onDisconnectCalendar: vi.fn(),
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
      onDisconnectCalendar: vi.fn(),
    })
    expect(
      within(rowFor('Placeholder One')).getByRole('button', {
        name: /connect google calendar/i,
      }),
    ).toBeInTheDocument()
  })
})

// #99 — the way back out, beside the sentence that says there is something to
// get out of.
//
// What this file cannot see: whether the rows are actually deleted. That is
// supabase/functions/calendar-disconnect/handler.test.js, which asserts the
// three deletions and their order against a fake client. This is the control —
// who is offered it, how many taps it takes, and what is said afterwards.
describe('#99 — disconnecting a calendar', () => {
  const withEmail = { ...roster[0], email: 'placeholder.one@example.test' }
  const housemateWithEmail = { ...roster[1], email: 'placeholder.two@example.test' }
  const connection = {
    id: 'conn-1',
    member_id: 'm1',
    scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    connected_at: '2026-08-24T10:00:00Z',
  }

  const renderConnected = (props = {}) =>
    setup({
      members: [withEmail, housemateWithEmail],
      me: withEmail,
      connections: [connection],
      onConnectCalendar: vi.fn(),
      onDisconnectCalendar: vi.fn().mockResolvedValue({ ok: true, revoked: true }),
      ...props,
    })

  const disconnectIn = (row) => within(row).getByRole('button', { name: /^disconnect$/i })

  it('offers Disconnect beside "Calendar connected", on the member’s own row', () => {
    // The charter's trust half: an input a member cannot switch off erodes
    // exactly the trust the connection is asking for, so "Calendar connected"
    // must not be a state with no exit next to it.
    renderConnected()
    const row = rowFor('Placeholder One')
    expect(within(row).getByText(/calendar connected/i)).toBeInTheDocument()
    expect(disconnectIn(row)).toBeInTheDocument()
  })

  it('does NOT offer it on a housemate’s row, even one who could connect', () => {
    // The mirror of #95 AC 1's routing, and the housemate has a real address on
    // purpose: with `roster[1]`'s missing email the absence would be satisfied
    // by the real-email check and `isMe` would never be exercised — the exact
    // spare-guard fault a mutation pass caught on #95.
    renderConnected({ connections: [connection, { ...connection, id: 'c2', member_id: 'm2' }] })
    expect(
      within(rowFor('Placeholder Two')).queryByRole('button', { name: /^disconnect$/i }),
    ).not.toBeInTheDocument()
  })

  it('POSITIVE CONTROL: that same housemate IS offered it on their own device', () => {
    // Which makes the absence above a fact about WHOSE row it is rather than a
    // fact about that person or that fixture.
    setup({
      members: [withEmail, housemateWithEmail],
      me: housemateWithEmail,
      connections: [{ ...connection, id: 'c2', member_id: 'm2' }],
      onConnectCalendar: vi.fn(),
      onDisconnectCalendar: vi.fn().mockResolvedValue({ ok: true, revoked: true }),
    })
    expect(disconnectIn(rowFor('Placeholder Two'))).toBeInTheDocument()
  })

  it('is absent for a member who has not connected one — there is nothing to disconnect', () => {
    renderConnected({ connections: [] })
    const row = rowFor('Placeholder One')
    expect(within(row).queryByRole('button', { name: /^disconnect$/i })).not.toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: /connect google calendar/i }),
    ).toBeInTheDocument()
  })

  it('takes TWO taps, and the first one writes nothing', async () => {
    // Owner decision at pickup, 2026-09-08: the idiom Remove-a-member,
    // Remove-a-chore and the second sign-out already use on this screen. Not
    // because disconnecting is dangerous but because it is irreversible in one
    // direction — every derived figure goes, and getting them back is a fresh
    // consent at Google.
    const onDisconnectCalendar = vi.fn().mockResolvedValue({ ok: true, revoked: true })
    renderConnected({ onDisconnectCalendar })
    await clickAndSettle(disconnectIn(rowFor('Placeholder One')))
    expect(onDisconnectCalendar).not.toHaveBeenCalled()

    const row = rowFor('Placeholder One')
    expect(within(row).getByRole('button', { name: /disconnect google calendar\?/i })).toBeTruthy()
    await clickAndSettle(
      within(row).getByRole('button', { name: /disconnect google calendar\?/i }),
    )
    expect(onDisconnectCalendar).toHaveBeenCalledTimes(1)
  })

  it('can be backed out of with Keep, and writes nothing on the way', async () => {
    const onDisconnectCalendar = vi.fn().mockResolvedValue({ ok: true, revoked: true })
    renderConnected({ onDisconnectCalendar })
    await clickAndSettle(disconnectIn(rowFor('Placeholder One')))
    await clickAndSettle(within(rowFor('Placeholder One')).getByRole('button', { name: /^keep$/i }))
    expect(onDisconnectCalendar).not.toHaveBeenCalled()
    // Back to the one-tap state, so the exit is still there to take.
    expect(disconnectIn(rowFor('Placeholder One'))).toBeInTheDocument()
  })

  it('does not let the rejection escape as an unhandled promise', async () => {
    // `onDisconnectCalendar` routes through App's `mutate()`, which RETHROWS
    // after recording the message. A bare call in the handler would escape, and
    // the Remove arms in this file and in Chores.jsx take the same two-arm
    // shape for exactly this reason.
    const onDisconnectCalendar = vi.fn().mockRejectedValue(new Error('nope'))
    renderConnected({ onDisconnectCalendar })
    await clickAndSettle(disconnectIn(rowFor('Placeholder One')))
    await clickAndSettle(
      within(rowFor('Placeholder One')).getByRole('button', { name: /disconnect google calendar\?/i }),
    )
    expect(onDisconnectCalendar).toHaveBeenCalledTimes(1)
  })

  it('AC 4 — draws the revoke note where a DISCONNECTED member can see it', () => {
    // The note exists only after a disconnect has succeeded, at which point the
    // connection row is gone and this control is rendering its Connect arm. A
    // note that lived inside the connected branch could never be seen, which is
    // why this fixture has NO connection.
    renderConnected({
      connections: [],
      calendarRevokeNote: 'Taskr has forgotten this calendar. Google may still list Taskr.',
    })
    expect(within(rowFor('Placeholder One')).getByTestId('calendar-note')).toHaveTextContent(
      /google may still list taskr/i,
    )
  })

  it('says nothing when there is nothing to add', () => {
    renderConnected({ connections: [] })
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('shows the note on the member’s OWN row and nobody else’s', () => {
    // It reports what a call THIS device made came back with, and a housemate's
    // phone learnt nothing about it.
    //
    // WHAT MAKES THIS TRUE is `CalendarControl`'s own `isMe` gate and not a
    // second test beside the prop — a first draft had both, and a mutation
    // pass measured the second one as reddening NOTHING, which is the spare
    // guard this file already records costing #95 a silent hole. So this
    // asserts the consequence and the `isMe` tests above are what defend it.
    renderConnected({
      connections: [],
      calendarRevokeNote: 'Taskr has forgotten this calendar. Google may still list Taskr.',
    })
    expect(
      within(rowFor('Placeholder Two')).queryByTestId('calendar-note'),
    ).not.toBeInTheDocument()
  })
})

// ===========================================================================
// #96 — the calendar's suggestion, beside the number it informs
// ===========================================================================
//
// A READOUT, and every assertion below is really about that: it renders a
// figure and it writes nothing. Since #97 it carries the one tap that applies
// the figure as a PREFILL; the write is still the editor's Save, and that
// story's describe below is where the tap is exercised.
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

  it('AC 4 — the readout writes nothing: its one control (#97) prefills, and only Save writes', async () => {
    // Until #97 this asserted there was NO control here at all, which was the
    // thinnest proof that nothing is written to `member_capacity`. There is one
    // now, and the property survives in a sharper form: tapping it opens the
    // editor with a figure in the field and calls no handler. The write is the
    // editor's Save, exercised in the #97 describe below.
    const handlers = setup({ household: zoned, busyWeeks: [busyRow] })
    const row = rowFor('Placeholder One')
    await clickAndSettle(within(row).getByRole('button', { name: /use the calendar’s figure/i }))
    expect(within(row).getByLabelText(/minutes this week for placeholder one/i)).toBeInTheDocument()
    expect(handlers.onSetCapacity).not.toHaveBeenCalled()
    expect(handlers.onClearCapacity).not.toHaveBeenCalled()
  })

  it('says WHEN it was read, because a figure can outlive the day it describes', () => {
    // #96 fetched a week once; #98 refreshes a figure older than twelve hours
    // on app open, and a phone left open or a Google that keeps refusing still
    // draws the last read. Either way a number shown without its age would be
    // claiming a freshness it does not have.
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

// #97 — the calendar's suggestion, taken into the week's capacity. The busy
// row is what #96 draws; what is tested here is the tap that turns it into a
// prefill, the two words a save can carry, and the mark a confirmed week
// shows. The arithmetic itself is capacity.calendar.test.js.
describe('applying the calendar suggestion — #97', () => {
  const zoned = { ...household, timezone: 'America/New_York' }
  const name = roster[0].display_name
  // 120 usual, 45 busy: a prefill of 75, chosen so the field can be told apart
  // from the baseline, from the busy figure and from zero at a glance.
  const busyRow = {
    id: 'busy-1',
    member_id: 'm1',
    period_start: PERIOD,
    busy_minutes: 45,
    event_count: 3,
    computed_at: '2026-08-12T01:00:00Z',
  }
  const useIt = (who = name) =>
    clickAndSettle(
      screen.getByRole('button', { name: new RegExp(`use the calendar’s figure for ${who}`, 'i') }),
    )
  const minutesField = (who = name) =>
    screen.getByLabelText(new RegExp(`minutes this week for ${who}`, 'i'))
  const save = () => clickAndSettle(screen.getByRole('button', { name: /^save$/i }))
  // `me` is the first row, so the source line's "your" is exercised on the
  // row where it is true; the housemate case below is the row where it is not.
  const withBusy = (extra = {}) =>
    setup({ household: zoned, me: roster[0], busyWeeks: [busyRow], ...extra })
  const openFor = (who = name) =>
    clickAndSettle(screen.getByRole('button', { name: new RegExp(`set this week for ${who}`, 'i') }))
  const calendarRow = (minutes, source = 'calendar') => ({
    id: 'o1',
    member_id: 'm1',
    period_start: PERIOD,
    minutes,
    note: null,
    source,
  })

  it('names WHOSE calendar on a housemate’s row, and "your" only on the member’s own', async () => {
    // review-fanout, 2026-09-05: the tap is offered on every row, so "From
    // your calendar" on Placeholder Two's row attributed Two's free/busy to
    // the person holding the phone.
    withBusy({ busyWeeks: [busyRow, { ...busyRow, id: 'busy-2', member_id: 'm2' }] })
    await useIt('Placeholder Two')
    expect(screen.getByTestId('week-source-m2')).toHaveTextContent(/from placeholder two’s calendar/i)
    expect(screen.getByTestId('week-source-m2')).not.toHaveTextContent(/your/i)
  })

  it('tapping Use this over a standing description proposal clears the proposal card', async () => {
    // review-fanout, 2026-09-05 (correctness + edge-paths): the shell owns its
    // result and exposes no reset, so without a remount the extraction card,
    // its "from your description" submit and "From your calendar" sat on one
    // screen at the confirm tap — two provenance claims for one field.
    const { onSetCapacity } = withBusy({
      onProposeCapacity: vi.fn().mockResolvedValue({
        outcome: 'proposal',
        minutes: 180,
        derivedFrom: { who: 'me', minutes: 180 },
      }),
    })
    await openFor()
    fireEvent.change(screen.getByLabelText(new RegExp(`describe this week for ${name}`, 'i')), {
      target: { value: 'I have three hours this week' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /work out the minutes/i }))
    expect(screen.getByTestId('proposal-m1')).toHaveTextContent('180')
    await useIt()
    expect(screen.queryByTestId('proposal-m1')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: new RegExp(`save the proposed figure for ${name}`, 'i') }),
    ).not.toBeInTheDocument()
    expect(minutesField()).toHaveValue(75)
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
    await save()
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '75', 'calendar')
  })

  it('an EMPTIED field is not the calendar’s figure, even when the calendar suggested zero', async () => {
    // review-fanout, 2026-09-05: Number('') is 0, and 0 is a legal suggestion,
    // so clearing the field over a zero prefill kept the calendar line on over
    // nothing. The save is refused by the normalizer either way; this is the
    // sentence above the field.
    const { onSetCapacity } = withBusy({ busyWeeks: [{ ...busyRow, busy_minutes: 320 }] })
    await useIt()
    expect(minutesField()).toHaveValue(0)
    expect(screen.getByTestId('week-source-m1')).toBeInTheDocument()
    fireEvent.change(minutesField(), { target: { value: '' } })
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    await save()
    expect(onSetCapacity).not.toHaveBeenCalled()
  })

  describe('the tap scrolls the field it filled into view (design-bar, 2026-09-05)', () => {
    // Measured on the prototype at 360×800: from a closed editor the tap put the
    // description shell between the button and the field, landing the field at
    // y=892 and Save at y=1005. jsdom has no layout and no scrollIntoView, so the
    // request is what can be asserted here; the prototype is where it was seen.
    const original = Element.prototype.scrollIntoView
    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn()
    })
    afterEach(() => {
      Element.prototype.scrollIntoView = original
    })

    it('requests a scroll to the minutes field once per tap', async () => {
      withBusy()
      await useIt()
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
      expect(Element.prototype.scrollIntoView.mock.instances[0]).toBe(minutesField())
    })

    it('and a plain "This week" open requests none — the field is where the tap was', async () => {
      withBusy()
      await openFor()
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    })

    it('POSITIVE CONTROL: the control survives a browser with no scrollIntoView at all', async () => {
      Element.prototype.scrollIntoView = undefined
      withBusy()
      await useIt()
      expect(minutesField()).toHaveValue(75)
    })
  })

  describe('the editor opens on what the row says (owner, at the review escalation, 2026-09-05)', () => {
    it('re-opening a calendar week shows its source, and an unedited Save keeps it', async () => {
      // Before this, open() seeded 'manual' whatever the row carried, so a
      // member who looked and pressed Save turned a calendar week into a typed
      // one — provenance lost by a tap that changed nothing.
      const { onSetCapacity } = withBusy({ overrides: [calendarRow(75)] })
      await openFor()
      expect(minutesField()).toHaveValue(75)
      expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
      await save()
      expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '75', 'calendar')
    })

    it('and editing it first applies the calendar rule — it saves as manual', async () => {
      const { onSetCapacity } = withBusy({ overrides: [calendarRow(75)] })
      await openFor()
      fireEvent.change(minutesField(), { target: { value: '60' } })
      expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
      await save()
      expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '60', 'manual')
    })

    it('a description week re-opens as one and keeps its word edited or not (#210 AC 6)', async () => {
      const { onSetCapacity } = withBusy({ overrides: [calendarRow(180, 'extraction')] })
      await openFor()
      expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your description/i)
      fireEvent.change(minutesField(), { target: { value: '150' } })
      await save()
      expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '150', 'extraction')
    })

    it('REGRESSION: a typed week and a week with no row still open as manual with no source line', async () => {
      withBusy({ overrides: [calendarRow(60, 'manual')] })
      await openFor()
      expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
      await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))
      await openFor('Placeholder Two')
      expect(screen.queryByTestId('week-source-m2')).not.toBeInTheDocument()
    })
  })

  // #106 — a week the calendar set with nobody tapping. The write is App's
  // (App.test.jsx); what this file owes is what the person SEES for such a
  // row (AC 4) and what their Save on it means.
  describe('a week set automatically from the calendar — #106', () => {
    const autoRow = (minutes, previous) => ({ ...calendarRow(minutes, 'calendar_auto'), previous_minutes: previous })

    it('AC 4: the roster says the week was set automatically AND what it was before', () => {
      withBusy({ overrides: [autoRow(75, 120)] })
      const row = rowFor(name)
      expect(within(row).getByTestId('week-m1')).toHaveTextContent('This week: 75 min')
      expect(within(row).getByTestId('week-auto-m1')).toHaveTextContent(
        /set from calendar automatically \(was 120 min\)/,
      )
      // Not the tap-confirmed mark: the difference is the whole of AC 4.
      expect(within(row).getByTestId('week-m1')).not.toHaveTextContent(/· set from calendar$/)
    })

    it('AC 4: without a recorded previous figure the mark still says automatically, and claims no number', () => {
      withBusy({ overrides: [autoRow(75, null)] })
      const mark = within(rowFor(name)).getByTestId('week-auto-m1')
      expect(mark).toHaveTextContent(/set from calendar automatically/)
      expect(mark).not.toHaveTextContent(/was/)
    })

    it('REGRESSION: a tap-confirmed week reads as it did, with no "automatically" and no "was"', () => {
      withBusy({ overrides: [calendarRow(75)] })
      const figure = within(rowFor(name)).getByTestId('week-m1')
      expect(figure).toHaveTextContent(/· set from calendar/)
      expect(figure).not.toHaveTextContent(/automatically|was/)
      expect(screen.queryByTestId('week-auto-m1')).not.toBeInTheDocument()
    })

    it('opens as the calendar’s figure, and an unedited Save is the confirm the person never tapped', async () => {
      const { onSetCapacity } = withBusy({ overrides: [autoRow(75, 120)] })
      await openFor()
      expect(minutesField()).toHaveValue(75)
      expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
      await save()
      // `calendar`, not `calendar_auto`: the row becomes a confirmed one, and
      // setCapacity's null default clears the previous figure with it.
      expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '75', 'calendar')
    })

    it('and editing it first applies #97’s rule — it saves as manual', async () => {
      const { onSetCapacity } = withBusy({ overrides: [autoRow(75, 120)] })
      await openFor()
      fireEvent.change(minutesField(), { target: { value: '60' } })
      expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
      await save()
      expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '60', 'manual')
    })
  })

  it('AC 1: one tap opens the editor with max(0, baseline − busy) in the field, named as the calendar’s, and writes nothing', async () => {
    const { onSetCapacity } = withBusy()
    expect(screen.queryByLabelText(/minutes this week/i)).not.toBeInTheDocument()
    await useIt()
    expect(minutesField()).toHaveValue(75)
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
    expect(onSetCapacity).not.toHaveBeenCalled()
  })

  it('AC 1: floors at zero when the calendar says the week is spoken for', async () => {
    withBusy({ busyWeeks: [{ ...busyRow, busy_minutes: 320 }] })
    await useIt()
    expect(minutesField()).toHaveValue(0)
  })

  it('AC 1: the tap is offered wherever the figure is shown — a housemate’s row too (owner, 2026-09-05)', async () => {
    // Same reach as the editor it feeds, which has never gated who may set:
    // the household reads the figure since #96, and this editor lets anybody
    // type any number. The confirm tap is what makes the figure defensible.
    withBusy({ busyWeeks: [{ ...busyRow, member_id: 'm2' }] })
    await useIt('Placeholder Two')
    // 45 usual − 45 busy.
    expect(minutesField('Placeholder Two')).toHaveValue(0)
    expect(screen.getByTestId('week-source-m2')).toHaveTextContent(/placeholder two’s calendar/i)
  })

  it('offers no tap without a figure, and none for a foreign week', () => {
    setup({ household: zoned, busyWeeks: [{ ...busyRow, period_start: '2026-08-03' }] })
    expect(screen.queryByRole('button', { name: /use the calendar’s figure/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/calendar suggests:/i)).not.toBeInTheDocument()
  })

  it('AC 2: saving the prefilled figure unedited writes it with source calendar', async () => {
    const { onSetCapacity } = withBusy()
    await useIt()
    await save()
    expect(onSetCapacity).toHaveBeenCalledTimes(1)
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '75', 'calendar')
  })

  it('AC 2: editing the figure first saves it as manual, and the calendar line goes quiet as soon as it is edited', async () => {
    // The mirror of #210 AC 6, on purpose: a calendar figure is arithmetic the
    // member can see, so a changed one is no longer the calendar's. The source
    // line follows the field rather than the tap.
    const { onSetCapacity } = withBusy()
    await useIt()
    fireEvent.change(minutesField(), { target: { value: '60' } })
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    await save()
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '60', 'manual')
  })

  it('AC 2: restoring the exact figure after an edit is a confirm again', async () => {
    const { onSetCapacity } = withBusy()
    await useIt()
    fireEvent.change(minutesField(), { target: { value: '60' } })
    fireEvent.change(minutesField(), { target: { value: '75' } })
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
    await save()
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '75', 'calendar')
  })

  it('the tap works from an editor that is already open, replacing what was typed', async () => {
    withBusy()
    await clickAndSettle(screen.getByRole('button', { name: new RegExp(`set this week for ${name}`, 'i') }))
    fireEvent.change(minutesField(), { target: { value: '99' } })
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    await useIt()
    expect(minutesField()).toHaveValue(75)
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
  })

  it('cancelling after the tap writes nothing, and the next open starts clean', async () => {
    const { onSetCapacity } = withBusy()
    await useIt()
    await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onSetCapacity).not.toHaveBeenCalled()
    expect(rowFor(name)).toHaveTextContent(`This week: ${roster[0].weekly_minutes} min`)
    await clickAndSettle(screen.getByRole('button', { name: new RegExp(`set this week for ${name}`, 'i') }))
    expect(minutesField()).toHaveValue(roster[0].weekly_minutes)
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
  })

  it('a rejected save keeps the editor open with the figure to retry', async () => {
    const onSetCapacity = vi.fn().mockRejectedValue(new Error('refused'))
    withBusy({ onSetCapacity })
    await useIt()
    await save()
    expect(minutesField()).toHaveValue(75)
  })

  it('is disabled while the roster is busy, like every other control on the row', () => {
    withBusy({ busy: true })
    expect(screen.getByRole('button', { name: /use the calendar’s figure/i })).toBeDisabled()
  })

  it('AC 6: a calendar-sourced week says so where the figure is read', () => {
    withBusy({
      overrides: [{ id: 'o1', member_id: 'm1', period_start: PERIOD, minutes: 75, source: 'calendar' }],
    })
    const figure = within(rowFor(name)).getByTestId('week-m1')
    expect(figure).toHaveTextContent('This week: 75 min')
    expect(figure).toHaveTextContent(/set from calendar/i)
    expect(figure).not.toHaveTextContent(/set for this week/i)
  })

  it('AC 6 — REGRESSION: a typed week still reads "set for this week", and no row still reads "usual"', () => {
    withBusy({
      overrides: [{ id: 'o1', member_id: 'm1', period_start: PERIOD, minutes: 60, source: 'manual' }],
    })
    expect(within(rowFor(name)).getByTestId('week-m1')).toHaveTextContent(/set for this week/i)
    expect(within(rowFor(name)).getByTestId('week-m1')).not.toHaveTextContent(/from calendar/i)
    expect(within(rowFor('Placeholder Two')).getByTestId('week-m2')).toHaveTextContent(/usual/i)
  })

  it('AC 6: the mark survives with no busy row on screen — provenance is the override’s, not the readout’s', () => {
    // The derived row can be gone (a housemate opened the app on another
    // week, the read failed, the connection was revoked) while the confirmed
    // capacity stands. What the week was set FROM is a fact about the
    // capacity row, and it is read from there.
    setup({
      household: zoned,
      overrides: [{ id: 'o1', member_id: 'm1', period_start: PERIOD, minutes: 75, source: 'calendar' }],
    })
    expect(within(rowFor(name)).getByTestId('week-m1')).toHaveTextContent(/set from calendar/i)
    expect(screen.queryByText(/calendar suggests:/i)).not.toBeInTheDocument()
  })
})

// #210 — this week's capacity, described in plain language. The proposer is
// a spy handed in as `onProposeCapacity`; what it answers is the capture
// layer's outcome vocabulary, tested against recorded responses in
// src/lib/capture.test.js. What is tested HERE is the confirm surface: a
// proposal lands in the field and is not written, accepting it is one tap of
// a submit that is the same write a typed figure makes, and the source
// travels with it.
describe('this week’s capacity, described in plain language — #210', () => {
  const PROPOSAL = {
    outcome: 'proposal',
    minutes: 180,
    derivedFrom: { who: 'me', minutes: 180 },
  }
  const name = roster[0].display_name

  const openFor = () =>
    clickAndSettle(screen.getByRole('button', { name: new RegExp(`set this week for ${name}`, 'i') }))

  const describeIt = async (text) => {
    fireEvent.change(screen.getByLabelText(new RegExp(`describe this week for ${name}`, 'i')), {
      target: { value: text },
    })
    await clickAndSettle(screen.getByRole('button', { name: /work out the minutes/i }))
  }

  const minutesField = () =>
    screen.getByLabelText(new RegExp(`minutes this week for ${name}`, 'i'))

  const saveProposed = () =>
    clickAndSettle(
      screen.getByRole('button', { name: new RegExp(`save the proposed figure for ${name}`, 'i') }),
    )

  const save = () => clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

  const withProposer = (outcome = PROPOSAL) => {
    const onProposeCapacity = vi.fn().mockResolvedValue(outcome)
    const handlers = setup({ onProposeCapacity })
    return { ...handlers, onProposeCapacity }
  }

  it('AC 1: shows the proposed figure, lands it in the field with its source named, and writes nothing', async () => {
    const { onSetCapacity, onProposeCapacity } = withProposer()
    await openFor()
    await describeIt('I have three hours this week')

    expect(onProposeCapacity).toHaveBeenCalledWith(roster[0], 'I have three hours this week')
    expect(screen.getByTestId('proposal-m1')).toHaveTextContent('Proposed: 180 min')
    // Prefilled, not applied: the field holds the proposal, the source line
    // says where it came from, and nothing has been written.
    expect(minutesField()).toHaveValue(180)
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your description/i)
    expect(onSetCapacity).not.toHaveBeenCalled()
  })

  it('AC 1: a figure read as the writer’s own carries no provenance line that repeats the headline', async () => {
    // The named case is the describe below this one.
    withProposer()
    await openFor()
    await describeIt('I have three hours this week')
    expect(screen.getByTestId('capture-proposal')).not.toHaveTextContent(/read as/i)
  })

  it('AC 1 / AC 9: accepting is ONE tap, a submit that writes once with source extraction', async () => {
    const { onSetCapacity } = withProposer()
    await openFor()
    await describeIt('I have three hours this week')

    const button = screen.getByRole('button', {
      name: new RegExp(`save the proposed figure for ${name}`, 'i'),
    })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveTextContent(/save 180 min from your description/i)

    await saveProposed()
    expect(onSetCapacity).toHaveBeenCalledTimes(1)
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '180', 'extraction')
  })

  it('AC 9: the plain Save below the field is the same write, not a second one', async () => {
    const { onSetCapacity } = withProposer()
    await openFor()
    await describeIt('I have three hours this week')
    await save()
    expect(onSetCapacity).toHaveBeenCalledTimes(1)
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '180', 'extraction')
  })

  it('AC 9: names the source on screen once a proposal arrives, and not before', async () => {
    withProposer()
    await openFor()
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    await describeIt('I have three hours this week')
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your description/i)
  })

  it('AC 6: editing the proposed figure before saving keeps source extraction, and the button says what it will save', async () => {
    const { onSetCapacity } = withProposer()
    await openFor()
    await describeIt('I have three hours this week')
    fireEvent.change(minutesField(), { target: { value: '150' } })
    expect(
      screen.getByRole('button', { name: new RegExp(`save the proposed figure for ${name}`, 'i') }),
    ).toHaveTextContent(/save 150 min/i)
    await saveProposed()
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '150', 'extraction')
  })

  it('AC 3: cancelling after a proposal writes nothing, and the next open starts clean', async () => {
    const { onSetCapacity } = withProposer()
    await openFor()
    await describeIt('I have three hours this week')
    await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))

    expect(onSetCapacity).not.toHaveBeenCalled()
    expect(rowFor(name)).toHaveTextContent(`This week: ${roster[0].weekly_minutes} min`)

    await openFor()
    expect(minutesField()).toHaveValue(roster[0].weekly_minutes)
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('capture-proposal')).not.toBeInTheDocument()
  })

  it('AC 2: when extraction fails, the typed field is in the same flow, focused, and a typed save is manual', async () => {
    const { onSetCapacity } = withProposer({
      outcome: 'failed',
      sentence: 'The extraction service could not answer: not deployed.',
    })
    await openFor()
    await describeIt('I have three hours this week')

    const failure = screen.getByTestId('capture-failure')
    expect(failure).toHaveTextContent(/could not answer/)
    expect(failure).toHaveTextContent('Type the minutes instead.')
    expect(minutesField()).toHaveFocus()
    expect(minutesField(), 'a failure must not prefill anything').toHaveValue(roster[0].weekly_minutes)

    fireEvent.change(minutesField(), { target: { value: '90' } })
    await save()
    expect(onSetCapacity).toHaveBeenCalledTimes(1)
    expect(onSetCapacity).toHaveBeenCalledWith(roster[0].id, '90', 'manual')
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
  })

  it('AC 4: a question shows the sentence and no number, prefills nothing, and the description stays', async () => {
    const { onSetCapacity } = withProposer({
      outcome: 'question',
      sentence: 'One more detail is needed. The message gives no amount of time.',
    })
    await openFor()
    await describeIt('busy this week')

    expect(screen.getByTestId('capture-question')).toHaveTextContent(/one more detail/i)
    expect(screen.queryByTestId('proposal-m1')).not.toBeInTheDocument()
    expect(minutesField()).toHaveValue(roster[0].weekly_minutes)
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    expect(screen.getByLabelText(new RegExp(`describe this week for ${name}`, 'i'))).toHaveValue(
      'busy this week',
    )
    expect(onSetCapacity).not.toHaveBeenCalled()
  })

  it('a rejected save after a proposal does not escape, and the editor stays open with the figure to retry', async () => {
    const onSetCapacity = vi.fn().mockRejectedValue(new Error('refused'))
    setup({ onSetCapacity, onProposeCapacity: vi.fn().mockResolvedValue(PROPOSAL) })
    await openFor()
    await describeIt('I have three hours this week')
    await saveProposed()
    expect(minutesField()).toBeInTheDocument()
    expect(minutesField()).toHaveValue(180)
  })

  it('the manual floor (AC 7): with no proposer wired, the editor is exactly the #46 form', async () => {
    setup()
    await openFor()
    expect(
      screen.queryByLabelText(new RegExp(`describe this week for ${name}`, 'i')),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('capture-shell')).not.toBeInTheDocument()
    expect(minutesField()).toBeInTheDocument()
  })
})

describe('the provenance line — #210, design-bar', () => {
  it('is shown when the endpoint attributed the figure to a name', async () => {
    const onProposeCapacity = vi.fn().mockResolvedValue({
      outcome: 'proposal',
      minutes: 285,
      derivedFrom: { who: 'Placeholder One', minutes: 285 },
    })
    setup({ onProposeCapacity })
    await clickAndSettle(
      screen.getByRole('button', { name: /set this week for placeholder one/i }),
    )
    fireEvent.change(screen.getByLabelText(/describe this week for placeholder one/i), {
      target: { value: 'Placeholder One has four and three-quarter hours' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /work out the minutes/i }))
    expect(screen.getByTestId('capture-proposal')).toHaveTextContent(
      /read as “placeholder one: 285 min” from what you wrote/i,
    )
  })
})

// #166 — the "Start another household" card.
//
// These exist because review-fanout found the idiom copied and its proof left
// behind: the clear-on-success / keep-on-failure `.then(ok, () => {})` sixty
// lines above this card in Roster.jsx carries THREE named tests in this file,
// and the card copied the construct into a file nobody opened. None of the nine
// App-level #166 cases reads either field back after a submit, and none drives
// a failing create — so both arms could have been broken with nothing red.
describe('#166 — starting another household', () => {
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'me' }

  /**
   * `setup()` above renders and returns its handlers; this one keeps the prop
   * bag so a test can change ONE prop and re-render, which is what the
   * follows-a-rename case needs — the roster re-reads and `me` comes back
   * carrying a different display name.
   */
  const renderRoster = (overrides = {}) => {
    let props = {
      household,
      members: roster,
      me: null,
      periodStart: PERIOD,
      onAdd: vi.fn().mockResolvedValue(undefined),
      onSave: vi.fn().mockResolvedValue(undefined),
      onRemove: vi.fn().mockResolvedValue(undefined),
      onRefresh: vi.fn(),
      onSignOut: vi.fn().mockResolvedValue(undefined),
      onSetCapacity: vi.fn().mockResolvedValue(undefined),
      onClearCapacity: vi.fn().mockResolvedValue(undefined),
      onResetPin: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
    const r = render(<Roster {...props} />)
    return {
      rerender: (next) => {
        props = { ...props, ...next }
        r.rerender(<Roster {...props} />)
      },
    }
  }

  const cardForm = () =>
    screen.getByRole('button', { name: 'Create household' }).closest('form')

  const fillAndSubmit = async (name = 'Placeholder Other Household') => {
    const form = cardForm()
    fireEvent.change(within(form).getByLabelText(/household name/i), { target: { value: name } })
    await clickAndSettle(screen.getByRole('button', { name: 'Create household' }))
    return form
  }

  it('is not offered at all when no handler is wired — the state before this story', () => {
    setup({ me })
    expect(
      screen.queryByRole('region', { name: /start another household/i }),
    ).not.toBeInTheDocument()
  })

  it('prefills this person’s name from their own member row', () => {
    setup({ me, onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }) })
    expect(within(cardForm()).getByLabelText(/your name in it/i)).toHaveValue('Placeholder One')
  })

  // THE PREFILL FOLLOWS A RENAME. It froze at mount until review-fanout caught
  // it, and this is the reproduction that needs one household and one screen:
  // the roster re-reads, `me` carries the new name, and the field below must
  // follow it rather than offering the name the person just stopped using.
  it('follows a rename, rather than freezing at mount', () => {
    const { rerender } = renderRoster({
      me,
      onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }),
    })
    expect(within(cardForm()).getByLabelText(/your name in it/i)).toHaveValue('Placeholder One')

    rerender({ me: { ...me, display_name: 'Renamed Placeholder' } })

    expect(within(cardForm()).getByLabelText(/your name in it/i)).toHaveValue('Renamed Placeholder')
  })

  it('stops following once the person types their own answer', () => {
    const { rerender } = renderRoster({
      me,
      onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }),
    })
    fireEvent.change(within(cardForm()).getByLabelText(/your name in it/i), {
      target: { value: 'Housemate' },
    })

    rerender({ me: { ...me, display_name: 'Renamed Placeholder' } })

    expect(within(cardForm()).getByLabelText(/your name in it/i)).toHaveValue('Housemate')
  })

  it('names the household and the organizer it was given', async () => {
    const onCreateHousehold = vi.fn().mockResolvedValue({ id: 'h2' })
    setup({ me, onCreateHousehold })
    await fillAndSubmit()

    expect(onCreateHousehold).toHaveBeenCalledWith('Placeholder Other Household', {
      organizerName: 'Placeholder One',
    })
  })

  it('clears the household name after one is created, so the next starts empty', async () => {
    setup({ me, onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }) })
    const form = await fillAndSubmit()

    expect(within(form).getByLabelText(/household name/i)).toHaveValue('')
  })

  // The organizer field is the one that must NOT clear to blank: it goes back
  // to the live prefill, so a second household can be created without retyping
  // a name the app already knows.
  it('puts the organizer field back to the prefill rather than blanking it', async () => {
    setup({ me, onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }) })
    const form = await fillAndSubmit()

    expect(within(form).getByLabelText(/your name in it/i)).toHaveValue('Placeholder One')
  })

  // THE REJECTION ARM, and it is more than tidiness: App's `mutate` sets the
  // error and RETHROWS, so this handler really does reject on a failed create.
  // Without the `() => {}` arm the typed values would be cleared by the thrown
  // promise going unhandled, and the person would retype everything under an
  // error strip.
  it('keeps what was typed when the create fails, so nothing has to be retyped', async () => {
    const onCreateHousehold = vi.fn().mockRejectedValue(new Error('network down'))
    setup({ me, onCreateHousehold })
    const form = cardForm()
    fireEvent.change(within(form).getByLabelText(/household name/i), {
      target: { value: 'Placeholder Other Household' },
    })
    fireEvent.change(within(form).getByLabelText(/your name in it/i), {
      target: { value: 'Housemate' },
    })
    await clickAndSettle(screen.getByRole('button', { name: 'Create household' }))

    expect(onCreateHousehold).toHaveBeenCalled()
    expect(within(form).getByLabelText(/household name/i)).toHaveValue(
      'Placeholder Other Household',
    )
    expect(within(form).getByLabelText(/your name in it/i)).toHaveValue('Housemate')
  })

  it('refuses to submit until both fields carry something', () => {
    setup({ me, onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }) })
    const form = cardForm()
    expect(screen.getByRole('button', { name: 'Create household' })).toBeDisabled()

    fireEvent.change(within(form).getByLabelText(/household name/i), { target: { value: 'Ours' } })
    expect(screen.getByRole('button', { name: 'Create household' })).toBeEnabled()

    fireEvent.change(within(form).getByLabelText(/your name in it/i), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Create household' })).toBeDisabled()
  })
})

// #341 — the roster's sign-in control, rebuilt.
//
// The story's shape in one sentence: whether a row has an inbox decides whether
// the organizer is shown a button or a form. Both halves are asserted here,
// because the interesting failure is not "the button is missing" — it is the
// PIN form surviving for a row that should never see one, which no assertion
// about the button can catch.
describe('#341 — emailing a sign-in instead of setting one', () => {
  const WITH_EMAIL = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: null,
    email: 'placeholder.one@example.test',
  }
  const WITH_EMAIL_AND_SIGNIN = { ...WITH_EMAIL, claimed_by: 'person-a' }

  it('offers an invitation to a row with an address and no sign-in', async () => {
    const handlers = setup({ isOrganizer: true, members: [WITH_EMAIL] })

    await clickAndSettle(screen.getByTestId('invite-m1'))
    expect(handlers.onInvite).toHaveBeenCalledWith('m1')
    expect(handlers.onSendReset).not.toHaveBeenCalled()
    expect(screen.getByTestId('invite-note-m1')).toHaveTextContent(/invitation sent/i)
  })

  it('offers a RESET link to a row that already has a sign-in', async () => {
    // Owner decision at pickup, and the reason it is in this story at all: AC 5
    // requires the PIN copy gone from every row with an address, and a reset
    // form that asks the organizer for a credential carries every word of it.
    const handlers = setup({ isOrganizer: true, members: [WITH_EMAIL_AND_SIGNIN] })

    await clickAndSettle(screen.getByTestId('invite-m1'))
    expect(handlers.onSendReset).toHaveBeenCalledWith(WITH_EMAIL_AND_SIGNIN)
    expect(handlers.onInvite).not.toHaveBeenCalled()
    expect(handlers.onResetPin).not.toHaveBeenCalled()
  })

  // One note tells somebody to expect a fresh account, the other to expect a
  // reset. A single "Sent." for both would leave the organizer unable to say
  // which, so the two are asserted as SEPARATE tests over separate renders —
  // the first draft did both in one `it` and rendered twice into the same
  // container, where `getAllByTestId(...)[0]` reads the earlier render and the
  // assertion is about the wrong element.
  // EACH ASSERTS THE NOTE AND THE CALL TOGETHER, and that pairing is a repair
  // rather than a flourish. The first draft asserted the wording in one test and
  // the handler in another, and a mutation swapping ONLY the handler
  // (`hasSignIn ? onSendReset : onInvite` -> always `onInvite`) reddened 1 of a
  // predicted 2: the note kept saying "new password" because its wording is
  // driven by `hasSignIn` independently of which call was made. That is a real
  // hole rather than a bad prediction — in the mutated app the organizer reads
  // "they can set a new password from that email" while an INVITATION was sent,
  // and nothing was watching the pair.
  it('an invitation note names the address, and an invitation is what was sent', async () => {
    const handlers = setup({ isOrganizer: true, members: [WITH_EMAIL] })
    await clickAndSettle(screen.getByTestId('invite-m1'))
    expect(screen.getByTestId('invite-note-m1')).toHaveTextContent(WITH_EMAIL.email)
    expect(screen.getByTestId('invite-note-m1')).toHaveTextContent(/invitation sent/i)
    expect(handlers.onInvite).toHaveBeenCalledWith('m1')
    expect(handlers.onSendReset).not.toHaveBeenCalled()
  })

  it('a reset note promises a new password, and a reset is what was sent', async () => {
    const handlers = setup({ isOrganizer: true, members: [WITH_EMAIL_AND_SIGNIN] })
    await clickAndSettle(screen.getByTestId('invite-m1'))
    const note = screen.getByTestId('invite-note-m1')
    expect(note).toHaveTextContent(/new password/i)
    // The denial, so the two notes cannot converge on one sentence: this one
    // must not claim an invitation went to somebody who already has an account.
    expect(note).not.toHaveTextContent(/invitation sent/i)
    // The pair. Without this the sentence above is a claim about the SCREEN and
    // says nothing about what the app did.
    expect(handlers.onSendReset).toHaveBeenCalledWith(WITH_EMAIL_AND_SIGNIN)
    expect(handlers.onInvite).not.toHaveBeenCalled()
  })

  it('keeps the note off screen when the send is refused', async () => {
    // The refusal reaches the shell's error strip, which this component does not
    // own. What must NOT happen is a confirmation appearing anyway — an
    // organizer told "Invitation sent" for a send that failed will wait forever
    // rather than retry.
    const handlers = setup({
      isOrganizer: true,
      members: [WITH_EMAIL],
      onInvite: vi.fn().mockRejectedValue(new Error('the mail service refused it')),
    })

    await clickAndSettle(screen.getByTestId('invite-m1'))
    expect(handlers.onInvite ?? true).toBeTruthy()
    expect(screen.queryByTestId('invite-note-m1')).not.toBeInTheDocument()
  })

  it('a row with NO address and a sign-in keeps the PIN reset, because nothing can be emailed', async () => {
    // The half of the old path #191 kept. A synthetic `@taskr.invalid` address
    // has no mailbox, so a spoken credential is the only thing that reaches an
    // account minted at one — and deleting the reset for tidiness would leave
    // that member with no way back in. m2 is such an account.
    setup({ isOrganizer: true, members: [roster[1]] })

    expect(screen.queryByTestId('invite-m2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('provision-m2'))
    expect(screen.getByTestId('provision-input-m2')).toBeInTheDocument()
    expect(screen.getByTestId('provision-address-m2')).toHaveTextContent('m2@taskr.invalid')
  })

  it('#191: a row with NO address and NO sign-in gets no form at all — the mint is gone', async () => {
    // The other half, inverted by #191: until then this row rendered "Give a
    // sign-in" and the PIN form behind it. The action that form called no
    // longer exists, so the row carries the note and nothing that opens.
    setup({ isOrganizer: true, members: [roster[0]] })

    expect(screen.queryByTestId('invite-m1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provision-m1')).not.toBeInTheDocument()
    expect(screen.getByTestId('no-address-m1')).toHaveTextContent(/cannot invite them/i)
  })

  it('tells that member their address is one Taskr made up, and that it does not move', async () => {
    // The note used to be conditional on the row having no real address, which
    // is now the only way this form renders at all. Asserted so the branch's
    // removal is a fact rather than a tidy-up nobody checked.
    //
    // review-fanout on #191: the note promised that adding an address lets
    // Taskr "email them a reset link instead" (and, before #191, "an invitation
    // instead") — both false on a claimed row, because the auth user's address
    // never moves. The DENIAL is asserted as well as the sentence, so neither
    // promise can come back.
    setup({ isOrganizer: true, members: [roster[1]] })
    fireEvent.click(screen.getByTestId('provision-m2'))

    const row = rowFor('Placeholder Two')
    expect(within(row).getByText(/one Taskr made up/i)).toBeInTheDocument()
    expect(within(row).getByText(/stays at the made-up address/i)).toBeInTheDocument()
    expect(within(row).queryByText(/reset link instead|invitation instead/i)).not.toBeInTheDocument()
  })

  it('shows no sign-in control at all to somebody who is not the organizer', async () => {
    // Inherited from #87 and re-asserted on the NEW control, deliberately: the
    // gate lives on the caller in `MemberRow`, so a control added inside
    // `SignInControl` inherits it — and that is exactly the kind of thing that
    // is true until somebody moves the render.
    setup({ isOrganizer: false, members: [WITH_EMAIL] })
    expect(screen.queryByTestId('invite-m1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provision-m1')).not.toBeInTheDocument()
  })
})

// #172 — who sees the invitation card at all. The card's INNER gates (a code on
// screen, a list, the two-tap withdrawal) are Invitations.test.jsx's; this is
// the ROLE gate, which lives here because Roster holds the active household's
// organizer answer. Presence and absence are separate tests (AC 7), so removing
// `isOrganizer` from the render condition reddens the absence tests and
// removing the card reddens the presence one.
describe('#172 — the invitation card follows the organizer role', () => {
  const OUTSTANDING = [
    {
      id: 'inv-1',
      household_id: 'h1',
      created_by_member_id: 'm1',
      created_at: '2026-09-10T19:04:00.000Z',
      expires_at: '2099-09-17T19:04:00.000Z',
      withdrawn_at: null,
      redeemed_at: null,
      redeemed_by_member_id: null,
    },
  ]
  const wired = () => ({
    onMintInvitation: vi.fn(),
    onWithdrawInvitation: vi.fn(),
    onDismissMintedCode: vi.fn(),
  })

  it('AC 1 — offers the organizer a control to create an invitation', () => {
    setup({ isOrganizer: true, ...wired() })
    expect(screen.getByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create an invitation code/i })).toBeInTheDocument()
  })

  it('AC 1 — pressing it reaches the handler App wired', () => {
    const handlers = wired()
    setup({ isOrganizer: true, ...handlers })
    fireEvent.click(screen.getByRole('button', { name: /create an invitation code/i }))
    expect(handlers.onMintInvitation).toHaveBeenCalledTimes(1)
  })

  it('AC 3 — shows the organizer the outstanding list', () => {
    setup({ isOrganizer: true, invitations: OUTSTANDING, ...wired() })
    expect(screen.getByTestId('invitation-list')).toBeInTheDocument()
    expect(screen.getByTestId('invitation-inv-1')).toBeInTheDocument()
  })

  it('AC 5 — shows a member who is NOT the organizer no invitation control', () => {
    // Handlers wired and rows handed in, deliberately: the only thing standing
    // between this member and the card is the role, so this is the test that
    // reddens when `isOrganizer` is dropped from the render condition.
    setup({ isOrganizer: false, invitations: OUTSTANDING, ...wired() })
    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create an invitation code/i })).not.toBeInTheDocument()
  })

  it('AC 5 — and no invitation list, even when rows reach the component', () => {
    // App never reads them for a member (refresh() does not ask), but the
    // screen must not depend on that: a list handed to a non-organizer's roster
    // by any route is still not drawn.
    setup({ isOrganizer: false, invitations: OUTSTANDING, ...wired() })
    expect(screen.queryByTestId('invitation-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('invitation-inv-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw the code created/i })).not.toBeInTheDocument()
  })

  it('AC 5 — and no code, even if one is somehow held', () => {
    setup({ isOrganizer: false, mintedCode: 'k7m3qp4rwn', ...wired() })
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
    expect(screen.queryByText('k7m3qp4rwn')).not.toBeInTheDocument()
  })

  it('renders nothing new when no minter is wired — the #166 optional shape', () => {
    // The wiring half of the condition, and a different gate from the role: an
    // organizer's roster rendered by a caller that has not wired invitations is
    // exactly the roster that shipped before this story.
    setup({ isOrganizer: true, invitations: OUTSTANDING })
    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
  })

  it('design-bar — the invitation card comes BEFORE Add someone', () => {
    // Owner decision at the design-bar pass, 2026-09-10. At 360 wide the card
    // started 2.4 screens down (y 1919 of 2636), under the add-by-email form
    // #191 retires in favour of this one — so the forward path was the one a
    // person had to scroll furthest to reach.
    setup({ isOrganizer: true, ...wired() })
    const card = screen.getByTestId('invitations-card')
    const add = screen.getByRole('heading', { name: /add someone/i })
    expect(card.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('AC 6 — follows the ROLE it is handed, not the person: the same roster flips with it', () => {
    // At this level the "active household" is whatever `isOrganizer` says, so
    // the component half of AC 6 is that the card tracks the prop in both
    // directions on one mounted roster. App.test.jsx proves the prop itself is
    // computed within the active household.
    const handlers = wired()
    const props = {
      household: { id: 'h1', name: 'Placeholder Household' },
      members: roster,
      me: { id: 'm1', display_name: 'Placeholder One' },
      periodStart: PERIOD,
      onAdd: vi.fn(),
      onSave: vi.fn(),
      onRemove: vi.fn(),
      onRefresh: vi.fn(),
      onSetCapacity: vi.fn(),
      onClearCapacity: vi.fn(),
      ...handlers,
    }
    const { rerender } = render(<Roster {...props} isOrganizer />)
    expect(screen.getByTestId('invitations-card')).toBeInTheDocument()
    rerender(<Roster {...props} isOrganizer={false} />)
    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
    rerender(<Roster {...props} isOrganizer />)
    expect(screen.getByTestId('invitations-card')).toBeInTheDocument()
  })
})

// #173 — the "Join another household" card, the other half of #166's pair.
describe('#173 — joining another household with a code', () => {
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'me' }
  const card = () => within(screen.getByRole('region', { name: /join another household/i }))
  const fillAndSubmit = async (code = 'k7m3qp4rwn') => {
    fireEvent.change(card().getByLabelText(/invitation code/i), { target: { value: code } })
    await clickAndSettle(card().getByRole('button', { name: /join household/i }))
  }

  it('is not offered at all when no handler is wired — the state before this story', () => {
    setup({ me })
    expect(
      screen.queryByRole('region', { name: /join another household/i }),
    ).not.toBeInTheDocument()
  })

  it('sits after the start-another card, so the pair reads in order of likelihood', () => {
    setup({
      me,
      onCreateHousehold: vi.fn().mockResolvedValue({ id: 'h2' }),
      onJoinHousehold: vi.fn().mockResolvedValue({ id: 'm9' }),
    })
    const start = screen.getByRole('region', { name: /start another household/i })
    const join = screen.getByRole('region', { name: /join another household/i })
    expect(start.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('prefills this person’s name from their own member row, editable', () => {
    setup({ me, onJoinHousehold: vi.fn() })
    expect(card().getByLabelText(/join as/i)).toHaveValue('Placeholder One')
  })

  it('is disabled until a code is typed', () => {
    setup({ me, onJoinHousehold: vi.fn() })
    expect(card().getByRole('button', { name: /join household/i })).toBeDisabled()
    fireEvent.change(card().getByLabelText(/invitation code/i), { target: { value: '   ' } })
    expect(card().getByRole('button', { name: /join household/i })).toBeDisabled()
  })

  it('is disabled when the name is cleared, even with a code', () => {
    setup({ me, onJoinHousehold: vi.fn() })
    fireEvent.change(card().getByLabelText(/invitation code/i), { target: { value: 'k7m3qp4rwn' } })
    fireEvent.change(card().getByLabelText(/join as/i), { target: { value: '  ' } })
    expect(card().getByRole('button', { name: /join household/i })).toBeDisabled()
  })

  it('hands the code over as typed with the prefilled name — normalisation is the data layer’s', async () => {
    const onJoinHousehold = vi.fn().mockResolvedValue({ id: 'm9' })
    setup({ me, onJoinHousehold })
    await fillAndSubmit('  K7M3QP4RWN ')
    expect(onJoinHousehold).toHaveBeenCalledWith('  K7M3QP4RWN ', { name: 'Placeholder One' })
  })

  it('hands over a name the person typed instead', async () => {
    const onJoinHousehold = vi.fn().mockResolvedValue({ id: 'm9' })
    setup({ me, onJoinHousehold })
    fireEvent.change(card().getByLabelText(/join as/i), { target: { value: 'Housemate' } })
    await fillAndSubmit()
    expect(onJoinHousehold).toHaveBeenCalledWith('k7m3qp4rwn', { name: 'Housemate' })
  })

  it('clears the code once the join succeeds, and the name goes back to the prefill', async () => {
    setup({ me, onJoinHousehold: vi.fn().mockResolvedValue({ id: 'm9' }) })
    fireEvent.change(card().getByLabelText(/join as/i), { target: { value: 'Housemate' } })
    await fillAndSubmit()
    expect(card().getByLabelText(/invitation code/i)).toHaveValue('')
    expect(card().getByLabelText(/join as/i)).toHaveValue('Placeholder One')
  })

  it('keeps the code in the field when the join is refused', async () => {
    setup({ me, onJoinHousehold: vi.fn().mockRejectedValue(new Error('refused')) })
    await fillAndSubmit()
    expect(card().getByLabelText(/invitation code/i)).toHaveValue('k7m3qp4rwn')
  })

  it('is offered to a member who is NOT the organizer — joining is everybody’s act', () => {
    setup({ me, isOrganizer: false, onJoinHousehold: vi.fn() })
    expect(screen.getByRole('region', { name: /join another household/i })).toBeInTheDocument()
  })
})
