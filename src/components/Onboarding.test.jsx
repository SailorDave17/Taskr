import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Onboarding from './Onboarding.jsx'

/** Click, and let the submit handler's promise settle inside act(). */
const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

// AC 1 (start a household) and #62 (sign in as yourself, which replaced joining
// with a shared code). Names and addresses are synthetic — see #19, and
// `example.com` is reserved by RFC 2606 so a fixture address can never reach a
// real inbox.

function setup(overrides = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onSignIn = vi.fn().mockResolvedValue(undefined)
  render(<Onboarding onCreate={onCreate} onSignIn={onSignIn} {...overrides} />)
  return { onCreate, onSignIn }
}

/** Fill the create form. Every field, because the button is disabled until all are. */
function fillCreateForm({
  name = 'Placeholder Household',
  organizer = 'Placeholder Organizer',
  email = 'organizer@example.com',
  password = 'longenough',
} = {}) {
  fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: name } })
  fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: organizer } })
  fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: password } })
}

const createButton = () => screen.getByRole('button', { name: /create household/i })
const signInButton = () => screen.getByRole('button', { name: /^sign in$/i })

describe('starting a household', () => {
  it('will not submit an unnamed household', () => {
    setup()
    expect(createButton()).toBeDisabled()
  })

  it('will not submit without the organizer’s own credential', () => {
    // The order matters and this is why the button is gated on all four: the
    // organizer's account has to exist BEFORE `create_household` runs, because
    // that function refuses an unauthenticated caller and claims their member
    // row in the same statement. A household created first would be visible to
    // nobody at all.
    setup()
    fillCreateForm({ email: '', password: '' })
    expect(createButton()).toBeDisabled()
  })

  it('will not submit a password the auth endpoint would refuse anyway', () => {
    // Supabase's own floor is 6. Checked here only to avoid spending a round
    // trip on a refusal; the endpoint remains the authority.
    setup()
    fillCreateForm({ password: 'short' })
    expect(createButton()).toBeDisabled()
  })

  it('creates the household with the name and the credential that were typed', async () => {
    const { onCreate } = setup()
    fillCreateForm()
    await clickAndSettle(createButton())
    expect(onCreate).toHaveBeenCalledWith('Placeholder Household', {
      organizerName: 'Placeholder Organizer',
      email: 'organizer@example.com',
      password: 'longenough',
    })
  })

  it('shows the reason when the backend refuses, instead of failing silently', async () => {
    render(
      <Onboarding
        onCreate={vi.fn().mockRejectedValue(new Error('User already registered'))}
        onSignIn={vi.fn()}
      />,
    )
    fillCreateForm()
    fireEvent.click(createButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i)
  })
})

describe('signed in, but not in a household yet — the half-finished state', () => {
  // Reachable whenever the account is created and the household is not: two
  // durable steps, no transaction. Against a project without 0007 applied the
  // second fails EVERY time, so this is the normal state there, not an edge one.
  // Before #62's review it was a dead end — the only Create button called signUp
  // again for an address that now existed, and Sign in succeeded, found no
  // household, and came straight back here.

  it('asks only for the half that is missing', () => {
    setup({ signedIn: true })
    expect(screen.getByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/your password/i)).not.toBeInTheDocument()
  })

  it('enables Create on the household fields alone', () => {
    setup({ signedIn: true })
    expect(createButton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    expect(createButton()).toBeEnabled()
  })

  it('offers a way out, so the state is not a trap', () => {
    const onSignOut = vi.fn()
    render(<Onboarding onCreate={vi.fn()} onSignIn={vi.fn()} onSignOut={onSignOut} signedIn />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    // #291 — the option, not just the call. This screen's sign-out is the
    // half-finished-signup escape hatch and must never revoke the person's
    // other devices; there is no sign-out-everywhere here, deliberately,
    // because somebody stuck without a household is not reporting a theft.
    expect(onSignOut).toHaveBeenCalledWith({ everywhere: false })
  })

  it('does not offer to sign in somebody already signed in', () => {
    // That was the loop: Sign in succeeded, currentHousehold returned nothing,
    // and the app routed back to this screen looking unchanged.
    setup({ signedIn: true })
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
  })

  it('and the signed-OUT screen is unchanged', () => {
    // POSITIVE CONTROL: without this, `signedIn` defaulting wrong would hide the
    // credential fields for everybody and every assertion above would still pass.
    setup()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })
})

describe('signing in', () => {
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
    render(
      <Onboarding
        onCreate={vi.fn()}
        onSignIn={vi.fn().mockRejectedValue(new Error('That email and password did not match.'))}
      />,
    )
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: 'wrong' } })
    fireEvent.click(signInButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/did not match/i)
    expect(alert).not.toHaveTextContent(/no such|unknown|not found|wrong password/i)
  })
})

describe('while a request is in flight', () => {
  it('disables both actions, so a double tap cannot sign up twice', () => {
    setup({ busy: true })
    fillCreateForm()
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })

    expect(createButton()).toBeDisabled()
    expect(signInButton()).toBeDisabled()
  })
})
