import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Onboarding, { ENTRY, entryStateFor } from './Onboarding.jsx'

/** Click, and let the submit handler's promise settle inside act(). */
const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

// #154 — the first screen is a sign-in screen, starting a household is a link
// under it, and the organizer's account and the household are two submits.
// Names and addresses are synthetic — see #19, and `example.com` is reserved
// by RFC 2606 so a fixture address can never reach a real inbox.

function setup(overrides = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onSignIn = vi.fn().mockResolvedValue(undefined)
  // The live project's answer: confirmation is on, so a signup returns no
  // session. Tests about the other answer override this.
  const onSignUp = vi.fn().mockResolvedValue({ session: null, needsConfirmation: true })
  render(<Onboarding onCreate={onCreate} onSignIn={onSignIn} onSignUp={onSignUp} {...overrides} />)
  return { onCreate, onSignIn, onSignUp }
}

const signInButton = () => screen.getByRole('button', { name: /^sign in$/i })
const startLink = () => screen.getByRole('button', { name: /start a household/i })
const createAccountButton = () => screen.getByRole('button', { name: /create account/i })
const createButton = () => screen.getByRole('button', { name: /create household/i })

/** Take the secondary route and fill the organizer's own credential. */
function fillAccountForm({ email = 'organizer@example.com', password = 'longenough' } = {}) {
  fireEvent.click(startLink())
  fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: password } })
}

describe('which screen a person gets — the entry decision', () => {
  // AC 7: three states, one function, and each branch is a line that can be
  // deleted on its own. App.jsx picks its status from this and nowhere else,
  // so a branch removed here is a branch removed from the app.

  it('no session → the sign-in screen', () => {
    expect(entryStateFor({ session: null, household: null })).toBe(ENTRY.SIGNED_OUT)
  })

  it('a session with no household → start one', () => {
    expect(entryStateFor({ session: { user: { id: 'person-a' } }, household: null })).toBe(
      ENTRY.NO_HOUSEHOLD,
    )
  })

  it('a session with a household → the household, and no onboarding at all', () => {
    expect(
      entryStateFor({ session: { user: { id: 'person-a' } }, household: { id: 'h1' } }),
    ).toBe(ENTRY.JOINED)
  })

  it('a household with no session behind it is still signed out — the session decides first', () => {
    // The order of the two checks is the claim. Reversed, a stale household
    // read would put a signed-out person in front of a household screen.
    expect(entryStateFor({ session: null, household: { id: 'h1' } })).toBe(ENTRY.SIGNED_OUT)
  })
})

describe('no session — the sign-in screen', () => {
  it('leads with sign in, and starting a household is a link under it', () => {
    // AC 1. The link is a button (it changes state, it does not navigate) that
    // reads as a link, and the class is what carries the weight difference.
    setup()
    expect(signInButton()).toBeInTheDocument()
    expect(startLink()).toHaveClass('button--link')
    expect(startLink()).not.toHaveClass('button')
    // The household is NOT on this screen, in any form: no name box, no
    // create button. That was the defect — a person with no session was
    // offered a household they already had.
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('stays disabled until there is both an address and a secret', () => {
    setup()
    expect(signInButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    expect(signInButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    expect(signInButton()).toBeEnabled()
  })

  it('passes the credential through as typed, without deciding which kind it is', async () => {
    // One box for both. A member with a real address types a password; a member
    // without one has a synthetic `<id>@taskr.invalid` address and their PIN is
    // the password. The client does not branch on which — `members.email` is the
    // only thing that differs and the server is what reads it.
    const { onSignIn } = setup()
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await clickAndSettle(signInButton())

    expect(onSignIn).toHaveBeenCalledWith({ email: 'kid@example.com', password: '4821' })
  })

  it('reports a refusal without hinting which half was wrong', async () => {
    // The vagueness is deliberate all the way up: the data layer collapses "no
    // such account" and "wrong password" into one sentence, and this asserts the
    // screen does not helpfully re-separate them.
    setup({ onSignIn: vi.fn().mockRejectedValue(new Error('That email and password did not match.')) })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: 'wrong' } })
    fireEvent.click(signInButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/did not match/i)
    expect(alert).not.toHaveTextContent(/no such|unknown|not found|wrong password/i)
  })
})

describe('starting a household — the account comes first, on its own', () => {
  it('the link opens the account form, and the sign-in form steps aside', () => {
    setup()
    fireEvent.click(startLink())
    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your password/i)).toBeInTheDocument()
    expect(createAccountButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    // The household fields are NOT here. Naming the household is a later
    // submit, on a screen shown only to somebody signed in (AC 5).
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
  })

  it('and a way back to sign in from there', () => {
    setup()
    fireEvent.click(startLink())
    fireEvent.click(screen.getByRole('button', { name: /sign in instead/i }))
    expect(signInButton()).toBeInTheDocument()
    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument()
  })

  it('will not submit without an address', () => {
    setup()
    fillAccountForm({ email: '' })
    expect(createAccountButton()).toBeDisabled()
  })

  it('will not submit a password the auth endpoint would refuse anyway', () => {
    // Supabase's own floor is 6. Checked here only to avoid spending a round
    // trip on a refusal; the endpoint remains the authority.
    setup()
    fillAccountForm({ password: 'short' })
    expect(createAccountButton()).toBeDisabled()
  })

  it('creates the account with the credential typed, and creates no household', async () => {
    const { onSignUp, onCreate } = setup()
    fillAccountForm()
    await clickAndSettle(createAccountButton())

    expect(onSignUp).toHaveBeenCalledWith({ email: 'organizer@example.com', password: 'longenough' })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('says the account exists and needs confirming, back on the sign-in form with the address filled', async () => {
    // AC 3. The live project has `mailer_autoconfirm: false`, so this is the
    // ORDINARY outcome of a signup, and it is reported as a state rather than
    // as an error: no alert, a sentence naming the inbox, and the sign-in
    // form ready with the address, because signing in is the next thing.
    const { onCreate } = setup()
    fillAccountForm()
    await clickAndSettle(createAccountButton())

    const note = screen.getByTestId('confirmation-note')
    expect(note).toHaveTextContent(/account exists/i)
    expect(note).toHaveTextContent(/confirm/i)
    expect(note).toHaveTextContent('organizer@example.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toHaveValue('organizer@example.com')
    expect(signInButton()).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('says nothing about confirmation when the account arrived already signed in', async () => {
    // Confirmation OFF (a local stack). The app re-reads and re-renders this
    // screen with `signedIn`; this component's part is to not claim an email
    // was sent when the person is already in.
    setup({
      onSignUp: vi
        .fn()
        .mockResolvedValue({ session: { user: { id: 'person-a' } }, needsConfirmation: false }),
    })
    fillAccountForm()
    await clickAndSettle(createAccountButton())

    expect(screen.queryByTestId('confirmation-note')).not.toBeInTheDocument()
  })

  it('shows the reason when the backend refuses, instead of failing silently', async () => {
    // Deliberately the opposite of the sign-in vagueness, and for a reason that
    // does not conflict: you are creating your OWN account, so "that address is
    // already registered" tells you nothing you did not know and is the only
    // thing that lets you act.
    setup({ onSignUp: vi.fn().mockRejectedValue(new Error('User already registered')) })
    fillAccountForm()
    fireEvent.click(createAccountButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i)
  })
})

describe('signed in, but not in a household yet — the state between confirming and naming', () => {
  // Since #154 this is the ORDINARY state every organizer passes through: the
  // account is made and confirmed, the household is not. Before, it was an
  // edge case reached only when the second of two steps in one submit failed.

  it('asks only for the half that is missing', () => {
    // AC 4 — the copy this screen already carried, reused rather than
    // re-derived, and no credential fields of either kind.
    setup({ signedIn: true })
    expect(screen.getByTestId('signed-in-note')).toHaveTextContent(
      /you are signed in, but you are not in a household yet/i,
    )
    expect(screen.getByLabelText(/household name/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/your password/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start a household/i })).not.toBeInTheDocument()
  })

  it('enables Create on the household fields alone', () => {
    setup({ signedIn: true })
    expect(createButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    expect(createButton()).toBeEnabled()
  })

  it('creates the household with the name and the organizer typed, and no credential', async () => {
    // AC 5 from this side: the create handler is handed the household and
    // nothing account-shaped. A caller that wanted the old pair back would
    // have to change this call.
    const { onCreate, onSignUp } = setup({ signedIn: true })
    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    await clickAndSettle(createButton())

    expect(onCreate).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
    expect(onSignUp).not.toHaveBeenCalled()
  })

  it('offers a way out, so the state is not a trap', () => {
    // AC 6. And #291 — the option, not just the call: this sign-out must never
    // revoke the person's other devices; there is no sign-out-everywhere here,
    // deliberately, because somebody between an email and a household is not
    // reporting a theft.
    const onSignOut = vi.fn()
    setup({ signedIn: true, onSignOut })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledWith({ everywhere: false })
  })

  it('does not offer to sign in somebody already signed in', () => {
    // That was the loop: Sign in succeeded, currentHousehold returned nothing,
    // and the app routed back to this screen looking unchanged.
    setup({ signedIn: true })
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
  })

  it('and the signed-OUT screen is unchanged', () => {
    // POSITIVE CONTROL: without this, `signedIn` defaulting wrong would show the
    // household form to everybody and every assertion above would still pass.
    setup()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
    expect(signInButton()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })
})

describe('while a request is in flight', () => {
  it('disables sign in and the route away from it', () => {
    setup({ busy: true })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })

    expect(signInButton()).toBeDisabled()
    expect(startLink()).toBeDisabled()
  })

  it('disables the account submit, so a double tap cannot sign up twice', () => {
    // Reach the form BEFORE the flag: the link is disabled while busy, so a
    // component mounted busy could never show this form. The view survives
    // the re-render, which is the point — a request in flight does not throw
    // the person back to the sign-in card.
    const onSignUp = vi.fn().mockResolvedValue({ session: null, needsConfirmation: true })
    const props = { onCreate: vi.fn(), onSignIn: vi.fn(), onSignUp }
    const { rerender } = render(<Onboarding {...props} busy={false} />)
    fillAccountForm()
    expect(createAccountButton()).toBeEnabled()

    rerender(<Onboarding {...props} busy />)
    expect(createAccountButton()).toBeDisabled()
  })

  it('disables Create household', () => {
    setup({ signedIn: true, busy: true })
    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    expect(createButton()).toBeDisabled()
  })
})
