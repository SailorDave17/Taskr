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

describe('continuing with Google — #304', () => {
  const googleButton = () => screen.getByRole('button', { name: /continue with google/i })

  it('AC 1: sits beside the password form, on the sign-in card, as a button', () => {
    // A button of equal weight rather than a link like "Start a household":
    // for the member it applies to this is a primary route. It is NOT a form —
    // gate.test.js counts three forms on this screen and this is not a fourth —
    // and the password form is still there beside it, untouched.
    setup({ onSignInWithGoogle: vi.fn() })
    expect(googleButton()).toBeInTheDocument()
    expect(googleButton()).toHaveClass('button')
    // Full width, like the Sign in above it — design-bar measured 192px against
    // 278px without this, and the field renders a social sign-in at the
    // primary's width. The class is the claim; index.css carries the rule and
    // gate.test.js holds the two together.
    expect(googleButton()).toHaveClass('button--block')
    expect(googleButton()).not.toHaveClass('button--link')
    expect(googleButton()).toHaveAttribute('type', 'button')
    expect(signInButton()).toBeInTheDocument()
    expect(screen.getByLabelText(/password or pin/i)).toBeInTheDocument()
  })

  it('starts the Google flow, and nothing else — no credential is read or sent', async () => {
    const onSignInWithGoogle = vi.fn().mockResolvedValue(undefined)
    const { onSignIn } = setup({ onSignInWithGoogle })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    await clickAndSettle(googleButton())

    expect(onSignInWithGoogle).toHaveBeenCalledTimes(1)
    expect(onSignInWithGoogle).toHaveBeenCalledWith()
    expect(onSignIn).not.toHaveBeenCalled()
  })

  it('is enabled with the boxes empty — it needs no password', () => {
    setup({ onSignInWithGoogle: vi.fn() })
    expect(signInButton()).toBeDisabled()
    expect(googleButton()).toBeEnabled()
  })

  it('is disabled while a request is in flight, like every other control here', () => {
    setup({ onSignInWithGoogle: vi.fn(), busy: true })
    expect(googleButton()).toBeDisabled()
  })

  it('shows the reason when the flow cannot start', async () => {
    setup({
      onSignInWithGoogle: vi
        .fn()
        .mockRejectedValue(new Error('Could not start signing in with Google: provider is not enabled')),
    })
    fireEvent.click(googleButton())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/provider is not enabled/i)
  })

  it('is not offered to somebody already signed in', () => {
    setup({ onSignInWithGoogle: vi.fn(), signedIn: true })
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })

  it('AC 5: shows what the last attempt came back with, above the form, as an alert', () => {
    // The sentence is App’s (describeSignInReturn); this screen’s job is to put
    // it where the person who just came back from Google is looking, and to
    // let them try the password box underneath it.
    setup({
      onSignInWithGoogle: vi.fn(),
      signInNotice:
        'Google did not sign you in. If Google said this app has not been opened to your account, the organizer is the one who can add it — ask them.',
    })
    const note = screen.getByTestId('sign-in-return')
    expect(note).toHaveAttribute('role', 'alert')
    expect(note).toHaveTextContent(/organizer/i)
    expect(signInButton()).toBeInTheDocument()
    // The cold-arrival paragraph steps aside for the notice: design-bar measured
    // the two together pushing Continue with Google 3–47px below the fold at
    // 360×800, and the notice already says what to do.
    expect(screen.queryByText(/use the email and password the organizer set up/i)).not.toBeInTheDocument()
    expect(googleButton()).toBeInTheDocument()
  })

  it('shows no such notice on an ordinary load, and the cold-arrival paragraph instead', () => {
    setup({ onSignInWithGoogle: vi.fn() })
    expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/use the email and password the organizer set up/i)).toBeInTheDocument()
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

// ---------------------------------------------------------------------------
// #173 — joining with an invitation code, from this screen
// ---------------------------------------------------------------------------

describe('#173 — signed out, holding a code', () => {
  const joinLink = () => screen.getByRole('button', { name: /join a household/i })
  const keepButton = () => screen.getByRole('button', { name: /keep this code/i })
  const codeField = () => screen.getByLabelText(/invitation code/i)
  const nameField = () => screen.getByLabelText(/join as/i)

  it('is not offered at all when no handler is wired — the #154 screen exactly', () => {
    setup()
    expect(screen.queryByRole('button', { name: /join a household/i })).not.toBeInTheDocument()
  })

  it('offers the route as a link under the sign-in form, not a second button of equal weight', () => {
    setup({ onHoldInvitation: vi.fn().mockResolvedValue(undefined) })
    expect(joinLink()).toHaveClass('button--link')
    expect(signInButton()).toBeInTheDocument()
  })

  it('takes the code and the name FIRST, on their own card', () => {
    setup({ onHoldInvitation: vi.fn().mockResolvedValue(undefined) })
    fireEvent.click(joinLink())
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(codeField()).toBeInTheDocument()
    expect(nameField()).toBeInTheDocument()
    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument()
    expect(keepButton()).toBeDisabled()
  })

  it('needs BOTH the code and the name before it will keep anything', () => {
    setup({ onHoldInvitation: vi.fn().mockResolvedValue(undefined) })
    fireEvent.click(joinLink())
    fireEvent.change(codeField(), { target: { value: 'k7m3qp4rwn' } })
    expect(keepButton()).toBeDisabled()
    fireEvent.change(nameField(), { target: { value: 'Placeholder Three' } })
    expect(keepButton()).toBeEnabled()
    fireEvent.change(codeField(), { target: { value: '   ' } })
    expect(keepButton()).toBeDisabled()
  })

  it('hands the code and the name to the holder as typed — normalisation is the data layer’s', async () => {
    // A tab and spaces, not a newline: a single-line `<input>` strips CR and
    // LF from its value by the platform's own sanitisation (jsdom and every
    // browser alike), so a newline can never reach this handler from this
    // field — it reaches the server from a textarea or another client, which
    // is why `0041` widened the SERVER rather than trusting the field.
    const onHoldInvitation = vi.fn().mockResolvedValue(undefined)
    setup({ onHoldInvitation })
    fireEvent.click(joinLink())
    fireEvent.change(codeField(), { target: { value: '  K7M3QP4RWN\t' } })
    fireEvent.change(nameField(), { target: { value: ' Placeholder Three ' } })
    await clickAndSettle(keepButton())
    expect(onHoldInvitation).toHaveBeenCalledWith('  K7M3QP4RWN\t', { name: ' Placeholder Three ' })
  })

  it('returns to the sign-in card once the code is held', async () => {
    setup({ onHoldInvitation: vi.fn().mockResolvedValue(undefined) })
    fireEvent.click(joinLink())
    fireEvent.change(codeField(), { target: { value: 'k7m3qp4rwn' } })
    fireEvent.change(nameField(), { target: { value: 'Placeholder Three' } })
    await clickAndSettle(keepButton())
    expect(signInButton()).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /join with a code/i })).not.toBeInTheDocument()
  })

  it('shows a refused hold beside the field, and stays on the card', async () => {
    setup({ onHoldInvitation: vi.fn().mockRejectedValue(new Error('Type the invitation code first.')) })
    fireEvent.click(joinLink())
    fireEvent.change(codeField(), { target: { value: 'x' } })
    fireEvent.change(nameField(), { target: { value: 'Placeholder Three' } })
    await clickAndSettle(keepButton())
    expect(screen.getByRole('alert')).toHaveTextContent(/type the invitation code first/i)
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
  })

  it('has a way back to sign in without holding anything', () => {
    const onHoldInvitation = vi.fn()
    setup({ onHoldInvitation })
    fireEvent.click(joinLink())
    fireEvent.click(screen.getByRole('button', { name: /sign in instead/i }))
    expect(signInButton()).toBeInTheDocument()
    expect(onHoldInvitation).not.toHaveBeenCalled()
  })

  describe('with a code held on this device', () => {
    it('says so on the sign-in card, and where', () => {
      setup({ onHoldInvitation: vi.fn(), heldInvitation: true })
      expect(screen.getByTestId('held-invitation-note')).toHaveTextContent(/saved on this device/i)
      expect(screen.getByTestId('held-invitation-note')).toHaveAttribute('role', 'status')
    })

    it('no longer offers the join link — the note has taken its place', () => {
      setup({ onHoldInvitation: vi.fn(), heldInvitation: true })
      expect(screen.queryByRole('button', { name: /join a household/i })).not.toBeInTheDocument()
    })

    it('words the account route as creating an account, not starting a household', () => {
      setup({ onHoldInvitation: vi.fn(), heldInvitation: true })
      fireEvent.click(screen.getByRole('button', { name: /create an account/i }))
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Start a household' })).not.toBeInTheDocument()
      // The organizer paragraph would say there is nobody above them; wrong here.
      expect(screen.queryByText(/nobody above you/i)).not.toBeInTheDocument()
      expect(screen.getByText(/confirm the join with one tap as soon as you are in/i)).toBeInTheDocument()
    })

    it('the confirmation note promises the code, not a household to name', async () => {
      setup({ onHoldInvitation: vi.fn(), heldInvitation: true })
      fireEvent.click(screen.getByRole('button', { name: /create an account/i }))
      fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: 'kid@example.com' } })
      fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'longenough' } })
      await clickAndSettle(createAccountButton())
      const note = screen.getByTestId('confirmation-note')
      expect(note).toHaveTextContent(/invitation code is saved on this device/i)
      expect(note).not.toHaveTextContent(/name your household/i)
    })

    it('POSITIVE CONTROL: without a held code the confirmation note still promises the household', async () => {
      setup({ onHoldInvitation: vi.fn() })
      fillAccountForm()
      await clickAndSettle(createAccountButton())
      expect(screen.getByTestId('confirmation-note')).toHaveTextContent(/name your household/i)
    })
  })
})

describe('#173 — signed in with no household, joining with a code', () => {
  const joinButton = () => screen.getByRole('button', { name: /join household/i })
  const codeField = () => screen.getByLabelText(/invitation code/i)
  const nameField = () => screen.getByLabelText(/join as/i)
  const fillJoin = (code = 'k7m3qp4rwn', name = 'Placeholder Three') => {
    fireEvent.change(codeField(), { target: { value: code } })
    fireEvent.change(nameField(), { target: { value: name } })
  }

  it('is not offered at all when no handler is wired — the #154 card alone', () => {
    setup({ signedIn: true })
    expect(screen.queryByRole('heading', { name: /join with a code/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start a household' })).toBeInTheDocument()
  })

  it('sits ABOVE the household form, and the household form is unchanged', () => {
    // Owner decision at the design pass, 2026-09-11: built below, the join
    // card's button sat at y=926 on an 800px viewport.
    setup({ signedIn: true, onJoin: vi.fn().mockResolvedValue(undefined) })
    const join = screen.getByRole('heading', { name: /join with a code/i })
    const start = screen.getByRole('heading', { name: 'Start a household' })
    expect(join.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(createButton()).toBeInTheDocument()
    expect(screen.getByLabelText(/household name/i)).toBeInTheDocument()
    expect(joinButton()).toBeDisabled()
  })

  it('needs both the code and the name', () => {
    setup({ signedIn: true, onJoin: vi.fn() })
    fireEvent.change(codeField(), { target: { value: 'k7m3qp4rwn' } })
    expect(joinButton()).toBeDisabled()
    fireEvent.change(nameField(), { target: { value: 'Placeholder Three' } })
    expect(joinButton()).toBeEnabled()
  })

  it('redeems the code with the name as typed, and clears both fields on success', async () => {
    const onJoin = vi.fn().mockResolvedValue({ id: 'm9', household_id: 'h2' })
    setup({ signedIn: true, onJoin })
    fillJoin()
    await clickAndSettle(joinButton())
    expect(onJoin).toHaveBeenCalledWith('k7m3qp4rwn', { name: 'Placeholder Three' })
    expect(codeField()).toHaveValue('')
    expect(nameField()).toHaveValue('')
  })

  it('keeps a refused code in the field, beside the sentence that refused it', async () => {
    setup({
      signedIn: true,
      onJoin: vi
        .fn()
        .mockRejectedValue(new Error('You are already in that household, so the code was left unused.')),
    })
    fillJoin()
    await clickAndSettle(joinButton())
    expect(screen.getByRole('alert')).toHaveTextContent(/left unused/)
    expect(codeField()).toHaveValue('k7m3qp4rwn')
    expect(nameField()).toHaveValue('Placeholder Three')
  })

  it('shows an error handed in from outside — the held code refused at boot — as ONE strip', () => {
    setup({ signedIn: true, onJoin: vi.fn(), error: 'That code cannot be used — ask for a fresh one.' })
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent(/cannot be used/)
  })

  it('disables Join household while a request is in flight', () => {
    setup({ signedIn: true, onJoin: vi.fn(), busy: true })
    fillJoin()
    expect(joinButton()).toBeDisabled()
  })
})

describe('#173 — an error handed in from App is answered by the next act on this screen', () => {
  // Review finding: the prop has no setter here, so without a latch a held
  // code refused at boot stood over the join view while the next code was
  // typed.
  const sentence = 'That code cannot be used — ask for a fresh one.'

  it('shows the App error until the person moves to another card', () => {
    setup({ onHoldInvitation: vi.fn(), error: sentence })
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be used/)
    fireEvent.click(screen.getByRole('button', { name: /join a household/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a NEW App error after the old one was answered', () => {
    const onHoldInvitation = vi.fn()
    const onCreate = vi.fn()
    const onSignIn = vi.fn()
    const onSignUp = vi.fn()
    const { rerender } = render(
      <Onboarding onCreate={onCreate} onSignIn={onSignIn} onSignUp={onSignUp} onHoldInvitation={onHoldInvitation} error={sentence} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /join a household/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(
      <Onboarding onCreate={onCreate} onSignIn={onSignIn} onSignUp={onSignUp} onHoldInvitation={onHoldInvitation} error="Sign in first, then enter the code." />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in first/i)
  })

  it('a submit on this screen answers the App error too', async () => {
    setup({ signedIn: true, onJoin: vi.fn().mockResolvedValue({ id: 'm9' }), error: sentence })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/invitation code/i), { target: { value: 'k7m3qp4rwn' } })
    fireEvent.change(screen.getByLabelText(/join as/i), { target: { value: 'Placeholder Three' } })
    await clickAndSettle(screen.getByRole('button', { name: /join household/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('#155 — a forgotten password, from the sign-in screen', () => {
  const forgotLink = () => screen.getByRole('button', { name: /forgot your password\?/i })
  const sendButton = () => screen.getByRole('button', { name: /email me a reset link/i })
  const resetField = () => screen.getByLabelText(/^email$/i)
  // Neither outcome may say whether the address has an account. GoTrue answers
  // a reset for an unknown address exactly as it answers a known one, on
  // purpose, and a sentence here that guessed would undo that. Asserted as an
  // absence on BOTH branches rather than trusted to the wording.
  const REVEALS = /no account|not found|unknown|does not exist|no such|not registered|recognis/i
  const accepted = () => vi.fn().mockResolvedValue(undefined)
  const refused = () =>
    vi.fn().mockRejectedValue(new Error('Could not send that reset email: over_email_send_rate_limit'))

  it('is not offered at all when no handler is wired — the #154 screen exactly', () => {
    setup()
    expect(screen.queryByRole('button', { name: /forgot/i })).not.toBeInTheDocument()
  })

  it('AC 1: offers ONE control, as a link under the sign-in form, and looks nothing up on the way', () => {
    const onForgotPassword = accepted()
    setup({ onForgotPassword })
    expect(screen.getAllByRole('button', { name: /forgot/i })).toHaveLength(1)
    expect(forgotLink()).toHaveClass('button--link')
    expect(forgotLink()).not.toHaveClass('button')
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.click(forgotLink())

    // The card is up, the address came with them, and nothing has been asked
    // of anybody yet — a lookup here is the thing AC 1 forbids.
    expect(screen.getByRole('heading', { name: /forgotten your password/i })).toBeInTheDocument()
    expect(resetField()).toHaveValue('kid@example.com')
    expect(onForgotPassword).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password or pin/i)).not.toBeInTheDocument()
  })

  it('will not send without an address', () => {
    setup({ onForgotPassword: accepted() })
    fireEvent.click(forgotLink())
    expect(sendButton()).toBeDisabled()
    fireEvent.change(resetField(), { target: { value: '   ' } })
    expect(sendButton()).toBeDisabled()
    fireEvent.change(resetField(), { target: { value: 'kid@example.com' } })
    expect(sendButton()).toBeEnabled()
  })

  it('AC 3: an ACCEPTED request says a link is on its way if the address is known, and where to turn if nothing arrives', async () => {
    const onForgotPassword = accepted()
    setup({ onForgotPassword })
    fireEvent.click(forgotLink())
    fireEvent.change(resetField(), { target: { value: '  kid@example.com ' } })
    await clickAndSettle(sendButton())

    expect(onForgotPassword).toHaveBeenCalledWith('kid@example.com')
    const note = screen.getByTestId('reset-note')
    expect(note).toHaveAttribute('role', 'status')
    expect(note).toHaveTextContent(
      /if that address has a taskr account, a link to set a new password is on its way/i,
    )
    expect(note).toHaveTextContent(/ask your household organizer/i)
    expect(note).not.toHaveTextContent(REVEALS)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 2: a REFUSED request tells the person to ask their organizer, in words that do not say whether the address has an account', async () => {
    setup({ onForgotPassword: refused() })
    fireEvent.click(forgotLink())
    fireEvent.change(resetField(), { target: { value: 'kid@example.com' } })
    await clickAndSettle(sendButton())

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/could not send that reset email/i)
    expect(alert).toHaveTextContent(/ask your household organizer/i)
    expect(alert).not.toHaveTextContent(REVEALS)
    expect(screen.queryByTestId('reset-note')).not.toBeInTheDocument()
    // Still on the card with the address in the box, so a retry is one tap.
    expect(resetField()).toHaveValue('kid@example.com')
  })

  it('a refusal is answered by the next request, and an acceptance replaces it', async () => {
    const onForgotPassword = refused()
    setup({ onForgotPassword })
    fireEvent.click(forgotLink())
    fireEvent.change(resetField(), { target: { value: 'kid@example.com' } })
    await clickAndSettle(sendButton())
    expect(screen.getByRole('alert')).toBeInTheDocument()

    onForgotPassword.mockResolvedValue(undefined)
    await clickAndSettle(sendButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('reset-note')).toBeInTheDocument()
  })

  it('has a way back to sign in, and the note does not follow', async () => {
    setup({ onForgotPassword: accepted() })
    fireEvent.click(forgotLink())
    fireEvent.change(resetField(), { target: { value: 'kid@example.com' } })
    await clickAndSettle(sendButton())
    fireEvent.click(screen.getByRole('button', { name: /sign in instead/i }))
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.queryByTestId('reset-note')).not.toBeInTheDocument()
    // Taking the link again starts clean: no stale acceptance over a new address.
    fireEvent.click(forgotLink())
    expect(screen.queryByTestId('reset-note')).not.toBeInTheDocument()
  })

  it('is disabled while a request is in flight, like every other control here', () => {
    setup({ onForgotPassword: accepted(), busy: true })
    expect(forgotLink()).toBeDisabled()
  })

  it('AC 6: the organizer paragraph no longer says the password cannot be reset from inside the app', () => {
    setup({ onForgotPassword: accepted() })
    fireEvent.click(startLink())
    // The root claim stays — there IS nobody above the organizer — and the
    // consequence it used to draw is the one this story made false.
    expect(screen.getByText(/nobody above you/i)).toBeInTheDocument()
    expect(screen.queryByText(/cannot be reset from inside the app/i)).not.toBeInTheDocument()
    expect(screen.getByText(/sign-in screen can email you a link to set a new one/i)).toBeInTheDocument()
  })
})
