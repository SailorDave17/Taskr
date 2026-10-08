// App's tests for signing in, the session, and the page before a household.
// Split out of `App.test.jsx` by #553; every describe below moved verbatim with
// the comment above it. The fakes, the `vi.mock` calls and the shared
// `beforeEach` are in `src/test/support/appHarness.jsx`, which must stay the
// FIRST import.
import { backend, api, signedOutListeners, unsubscribeSignedOut, choresApi, calendarApi, authSettingsApi, renderApp, HOUSEHOLD_ONE, HOUSEHOLD_TWO } from './test/support/appHarness.jsx'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('when the build has no backend', () => {
  it('says so, instead of a network error that reads like an outage', async () => {
    backend.hasSupabaseConfig = false
    await renderApp()

    expect(await screen.findByRole('region', { name: /no backend configured/i })).toBeInTheDocument()
    // And it does not attempt a session read it cannot possibly complete.
    expect(api.currentSession).not.toHaveBeenCalled()
  })
})

describe('when nobody is signed in', () => {
  // #154 — the first screen a session-less person gets is a SIGN-IN screen.
  // Until this story it was two cards of equal weight, "Start a household" on
  // the left, and every returning housemate on a new phone was offered a
  // household they already had. Starting one is now a link under the sign-in
  // form, and the create-account half of it is its own submit.

  const startLink = () => screen.getByRole('button', { name: /start a household/i })

  /** Take the secondary route and fill the organizer's own credential. */
  const fillAccountForm = () => {
    fireEvent.click(startLink())
    fireEvent.change(screen.getByLabelText(/your email/i), {
      target: { value: 'alex@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/your password/i), {
      target: { value: 'longenough' },
    })
  }
  const submitAccount = () =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name: /create account/i })))
  const nameTheHousehold = async () => {
    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /create household/i })),
    )
  }

  it('asks for an email and a password first, and offers to start a household as a link', async () => {
    // AC 1. The household form is NOT on this screen — a person with no
    // session is not shown a household-name box, which is the defect this
    // story is named for.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(startLink()).toHaveClass('button--link')
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
  })

  it('asks the server nothing at all — signed out is a state, not a failure', async () => {
    // #62's reversal. This test used to assert the opposite shape: that the app
    // signed the DEVICE in anonymously BEFORE reading, so boot always ended with
    // an identity. Now there is no identity to mint, and the reads are skipped
    // rather than attempted-and-empty.
    //
    // Skipped deliberately, not incidentally: a signed-out read would be
    // REFUSED since 0017 (#186), and before that it would have succeeded and
    // returned nothing — so "signed out" and "your household disappeared"
    // would render identically, and the second reading is both wrong and the
    // more alarming one.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(api.currentSession).toHaveBeenCalled()
    expect(api.listHouseholds).not.toHaveBeenCalled()
    expect(api.listMembers).not.toHaveBeenCalled()
  })

  it('creating an account creates no household in the same submit, and says the account needs confirming', async () => {
    // AC 3 and AC 5. `mailer_autoconfirm: false` on the live project means the
    // signup returns no session — the ORDINARY outcome, not a fault — and a
    // household created in the same submit would be created by nobody, since
    // `create_household` claims the organizer's row to `auth.uid()`.
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockResolvedValue({ session: null, needsConfirmation: true })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    fillAccountForm()
    await submitAccount()

    expect(api.signUpOrganizer).toHaveBeenCalledWith({
      email: 'alex@example.com',
      password: 'longenough',
    })
    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirmation-note')).toHaveTextContent(/account exists/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // And NO re-read as `anon`: there is no session to read with, 0017 would
    // refuse it, and the refusal would have been reported over the top of a
    // signup that succeeded. This is why the signup does not go through
    // `mutate`.
    expect(api.listHouseholds).not.toHaveBeenCalled()
    // Back on the sign-in form, which is where the confirmed person goes next.
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  it('an account that arrives already signed in is offered the household half next, in its own submit', async () => {
    // Confirmation OFF (a local stack, not the live project): `signUp` returns
    // a session, so the app re-reads and finds a person with no household.
    // The household is still a SEPARATE submit — AC 5 holds whichever way the
    // signup came back.
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockResolvedValue({
      session: { user: { id: 'person-a' } },
      needsConfirmation: false,
    })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    fillAccountForm()
    await submitAccount()

    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()

    await nameTheHousehold()

    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
    expect(api.signUpOrganizer).toHaveBeenCalledTimes(1)
  })

  it('a refused signup shows its reason and creates nothing', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockRejectedValue(new Error('User already registered'))
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    fillAccountForm()
    await submitAccount()

    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i)
  })

  it('signed in with no household is offered the household half, and never the signup again', async () => {
    // AC 4 and AC 6. Account made, household not: two durable steps with no
    // transaction, and since #154 the state every confirmed organizer passes
    // through on the live project. The household form, the signed-in copy and
    // Sign out — and no signup, because calling `signUp` again for an address
    // that now exists is the dead end #62 found.
    api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
    api.listHouseholds.mockResolvedValue([])
    api.currentUserId.mockResolvedValue('person-a')
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })
    expect(screen.getByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()

    await nameTheHousehold()

    expect(api.signUpOrganizer).not.toHaveBeenCalled()
    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
  })

  it('signs an existing member in and shows their household without asking anything further', async () => {
    // AC 2. The sign-in is the whole of it: the re-read after it finds the one
    // household and the person is looking at it — no second screen, nothing
    // typed twice. The fake sign-in flips the fixtures the way a real one
    // flips the server's answers.
    api.currentSession.mockResolvedValue(null)
    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.listHouseholds.mockResolvedValue([{
        id: 'h1',
        name: 'Placeholder Household',
        timezone: 'America/New_York',
      }])
      api.listMembers.mockResolvedValue([
        { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
      ])
      return { user: { id: 'person-a' } }
    })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign in$/i })))

    expect(api.signIn).toHaveBeenCalledWith({ email: 'kid@example.com', password: '4821', trusted: true })
    // The household's surfaces are up, and nothing onboarding-shaped remains.
    expect(await screen.findByRole('navigation', { name: /household surfaces/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
  })
})

describe('#304 — Continue with Google, from the sign-in screen', () => {
  it('AC 1: the control is on the sign-in screen and starts the Google flow through the data layer', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signInWithGoogle.mockResolvedValue(undefined)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /continue with google/i })),
    )

    expect(api.signInWithGoogle).toHaveBeenCalledTimes(1)
    // Not routed through the password path, and no re-read as `anon`: the page
    // is leaving for Google, and a refresh here would be refused by 0017 and
    // painted over a sign-in that is working.
    expect(api.signIn).not.toHaveBeenCalled()
    expect(api.listHouseholds).not.toHaveBeenCalled()
  })

  it('AC 3: a Google account matching nobody lands signed in with no household, and nothing is minted', async () => {
    // What the app does with the session Supabase hands back for a Google
    // address that is nobody's sign-in address: a fresh auth user, no roster
    // row, no household. That is #154's signed-in-with-no-household state,
    // and invitation redemption (#173/#191) is what later attaches it — not
    // this screen, which offers to START one and creates nothing unasked.
    api.currentSession.mockResolvedValue({
      user: { id: 'google-person', app_metadata: { provider: 'google', providers: ['google'] } },
    })
    api.currentUserId.mockResolvedValue('google-person')
    api.listHouseholds.mockResolvedValue([])
    api.listMembers.mockResolvedValue([])
    await renderApp()

    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create household/i })).toBeInTheDocument()
    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(api.addMember).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })
})

describe('#343 — the website’s link opens on start-your-household', () => {
  // `https://taskr.madcowhq.com/?start` — a query flag on the root, because
  // `/start` is a 404 on the deployed site (no router, no rewrite; #175/#176
  // dropped). Read once at boot, stripped at once, acted on only when the URL
  // carried nothing else the app reads.
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' }
  const ORIGIN = 'https://taskr.example.test'

  let replaceState
  let realLocation
  let realHistory

  /**
   * A URL to boot on, and a `replaceState` that MOVES the URL the way a
   * browser's does. The harnesses above use a recording `vi.fn()` and read its
   * calls; that is not enough here, because the claim under test is that the
   * readers running AFTER the strip see a URL without the flag — and a fake
   * that records the strip while leaving `location.search` as it was would let
   * a strip placed after those reads pass every assertion below.
   */
  const atUrl = (search = '', hash = '') => {
    const location = { origin: ORIGIN, pathname: '/', search, hash }
    replaceState = vi.fn((_state, _title, url) => {
      const next = new URL(url, ORIGIN)
      location.pathname = next.pathname
      location.search = next.search
      location.hash = next.hash
    })
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: location,
    })
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      writable: true,
      value: { replaceState },
    })
  }

  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    realHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
    atUrl('')
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
    if (realHistory) Object.defineProperty(globalThis, 'history', realHistory)
  })

  // "Start a household" is a BUTTON on the sign-in card (the link under the
  // form), a HEADING on the account card — and, signed in, the HEADING of the
  // household card too. So the heading alone names the account card only while
  // signed out; its absence is asserted by the fields only it carries.
  const accountHeading = () => screen.findByRole('heading', { name: /start a household/i })
  const signInButton = () => screen.findByRole('button', { name: /^sign in$/i })
  const noAccountCard = () => {
    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()
  }

  it('POSITIVE CONTROL: the bare root, signed out, still opens on sign-in and touches the URL not at all', async () => {
    // Without this, every "the account card is shown" assertion below passes
    // against an app that always shows it, and every strip assertion against
    // one that strips on every boot.
    api.currentSession.mockResolvedValue(null)
    await renderApp()

    expect(await signInButton()).toBeInTheDocument()
    noAccountCard()
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('AC 1: `?start` with no session opens on the account card, framed as starting a household, with sign-in one link away', async () => {
    api.currentSession.mockResolvedValue(null)
    atUrl('?start')
    await renderApp()

    expect(await accountHeading()).toBeInTheDocument()
    expect(screen.getByText(/first, your own account/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    // Not the sign-in form — the inversion of #154's weights, for this arrival.
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^sign in$/i })).not.toBeInTheDocument()

    // The way back, for a visitor who has an account after all.
    fireEvent.click(screen.getByRole('button', { name: /sign in instead/i }))
    expect(await signInButton()).toBeInTheDocument()
  })

  it('AC 1: the flag is read once and stripped, so a reload does not re-arm it', async () => {
    api.currentSession.mockResolvedValue(null)
    atUrl('?start')
    await renderApp()
    await accountHeading()

    // ONE strip, to the bare root — nothing else was on the URL to keep.
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    // And what the address bar now holds is what the next boot would read.
    expect(globalThis.location.search).toBe('')
    expect(globalThis.location.hash).toBe('')
  })

  it('AC 2: a member who opens the link lands in their household, exactly as without it', async () => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    atUrl('?start')
    await renderApp('Who')

    await screen.findByRole('region', { name: /who is in the household/i })
    noAccountCard()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
    // Never signed out, never a second household — #166 is the deliberate path
    // for that, and this flag is not it.
    expect(api.signOut).not.toHaveBeenCalled()
    expect(api.createHousehold).not.toHaveBeenCalled()
    // Stripped all the same: the flag is spent whoever opened it.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('AC 2: a signed-in person with no household lands on Name the household, flag or no flag', async () => {
    api.listHouseholds.mockResolvedValue([])
    atUrl('?start')
    await renderApp()

    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByLabelText(/household name/i)).toBeInTheDocument()
    noAccountCard()
    expect(api.signOut).not.toHaveBeenCalled()
    expect(api.createHousehold).not.toHaveBeenCalled()
  })

  it('AC 3: the return leg needs no flag — a signed-in person with no household gets Name the household on the bare root', async () => {
    // The confirmation link lands on the origin (`confirmationRedirectTo`
    // reads the origin and nothing else), so this boot is what a person gets
    // after following it from ANY device: a session, no household, no flag.
    api.listHouseholds.mockResolvedValue([])
    atUrl('')
    await renderApp()

    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByLabelText(/household name/i)).toBeInTheDocument()
    noAccountCard()
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('AC 4: a sign-in return in the FRAGMENT beside the flag is handled first, and the flag is dropped', async () => {
    api.currentSession.mockResolvedValue(null)
    atUrl(
      '?start',
      '#error=access_denied&error_code=provider_refused&error_description=the+user+denied+access',
    )
    await renderApp()

    // The sign-in screen, with the return's own sentence — not the account card.
    expect(await signInButton()).toBeInTheDocument()
    expect(screen.getByText(/google did not sign you in/i)).toBeInTheDocument()
    noAccountCard()
    // Two strips, in order: the flag alone, leaving the fragment for the reader
    // that owns it; then the fragment, once read.
    expect(replaceState.mock.calls).toEqual([
      [
        null,
        '',
        '/#error=access_denied&error_code=provider_refused&error_description=the+user+denied+access',
      ],
      [null, '', '/'],
    ])
  })

  it('AC 4: a bad-flow-state return in the QUERY beside the flag is handled first, and the flag is dropped', async () => {
    api.currentSession.mockResolvedValue(null)
    atUrl('?start&error=invalid_request&error_code=bad_oauth_state')
    await renderApp()

    expect(await signInButton()).toBeInTheDocument()
    expect(screen.getByText(/took too long or was already used/i)).toBeInTheDocument()
    noAccountCard()
    // The sign-in reader saw its return whole: the first strip took only the flag.
    expect(replaceState.mock.calls).toEqual([
      [null, '', '/?error=invalid_request&error_code=bad_oauth_state'],
      [null, '', '/'],
    ])
  })

  it('AC 4: a calendar return beside the flag is handled first — the code reaches the exchange, and the flag is dropped', async () => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    calendarApi.completeConnect.mockResolvedValue({ ok: true })
    atUrl('?start&code=the-code&state=the-state')
    await renderApp()

    await waitFor(() => expect(calendarApi.completeConnect).toHaveBeenCalledTimes(1))
    // Exactly what Google sent — `readConsentReturn` never saw the flag.
    expect(calendarApi.completeConnect).toHaveBeenCalledWith({
      code: 'the-code',
      error: null,
      state: 'the-state',
    })
    noAccountCard()
    expect(replaceState.mock.calls).toEqual([
      [null, '', '/?code=the-code&state=the-state'],
      [null, '', '/'],
    ])
  })

  it('AC 4: a calendar return beside the flag with NO session still yields to the return', async () => {
    // A consent that came back to an expired session. The signed-out boot does
    // not exchange the code (it reads nothing), and the account card is still
    // not the answer: this person was connecting a calendar, not arriving from
    // the website. Only the flag is stripped — the consent stays on the URL for
    // the reader that owns it, as it always has on a signed-out boot.
    api.currentSession.mockResolvedValue(null)
    atUrl('?start&code=the-code&state=the-state')
    await renderApp()

    expect(await signInButton()).toBeInTheDocument()
    noAccountCard()
    expect(calendarApi.completeConnect).not.toHaveBeenCalled()
    expect(replaceState.mock.calls).toEqual([[null, '', '/?code=the-code&state=the-state']])
  })

  it('AC 4: an auth link beside the flag is not a website arrival, even when it left no session', async () => {
    // `readAuthCallback` finds the token in the fragment whatever the session
    // did; a person following an invitation is not a visitor from the website,
    // so the flag yields to it and the sign-in screen is what they get.
    api.currentSession.mockResolvedValue(null)
    atUrl('?start', '#access_token=t&refresh_token=r&expires_in=3600&token_type=bearer&type=invite')
    await renderApp()

    expect(await signInButton()).toBeInTheDocument()
    noAccountCard()
  })
})

describe('when the backend cannot be reached', () => {
  it('shows the reason rather than an empty household', async () => {
    api.currentSession.mockRejectedValue(new Error('Failed to fetch'))
    await renderApp()

    expect(await screen.findByRole('region', { name: /could not reach the household/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to fetch/i)
    // Critically, not the sign-in screen: offering "create a household" against
    // a backend that is refusing would send the organizer round a loop. The
    // distinction is sharper since #62, because a signed-out phone ALSO shows
    // that screen — so an unreachable backend must not be mistaken for one.
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
  })
})

describe('#339 — the sign-in screen reads the provider switch before offering Google', () => {
  const googleControl = () => screen.queryByRole('button', { name: /continue with google/i })

  beforeEach(() => {
    api.currentSession.mockResolvedValue(null)
    api.signInWithGoogle.mockResolvedValue(undefined)
  })

  it('AC 1: switched off → no control, the organizer named, and nothing starts the flow', async () => {
    authSettingsApi.readGoogleSignIn.mockResolvedValue(false)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(await screen.findByTestId('google-sign-in-off')).toHaveTextContent(/organizer/i)
    expect(googleControl()).not.toBeInTheDocument()
    expect(authSettingsApi.readGoogleSignIn).toHaveBeenCalledTimes(1)
    expect(api.signInWithGoogle).not.toHaveBeenCalled()
  })

  it('AC 2: switched on → the control, and it starts the flow as #304 shipped it', async () => {
    authSettingsApi.readGoogleSignIn.mockResolvedValue(true)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(screen.queryByTestId('google-sign-in-off')).not.toBeInTheDocument()
    await act(async () => void fireEvent.click(googleControl()))
    expect(api.signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('AC 1: a failed read keeps the control — sign-in is not refused over a network blip', async () => {
    // `readGoogleSignIn` answers null for every failure (authSettings.test.js).
    authSettingsApi.readGoogleSignIn.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(screen.queryByTestId('google-sign-in-off')).not.toBeInTheDocument()
    await act(async () => void fireEvent.click(googleControl()))
    expect(api.signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('AC 1: a press while the read is still in flight waits for it, and does not leave for an off switch', async () => {
    // The control is on screen while the answer is unknown, so this is the
    // one press the render gate cannot stop.
    let answer
    authSettingsApi.readGoogleSignIn.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(googleControl()).toBeInTheDocument()

    await act(async () => void fireEvent.click(googleControl()))
    expect(api.signInWithGoogle).not.toHaveBeenCalled()
    await act(async () => answer(false))

    expect(api.signInWithGoogle).not.toHaveBeenCalled()
    expect(await screen.findByTestId('google-sign-in-off')).toBeInTheDocument()
    expect(googleControl()).not.toBeInTheDocument()
    // And the screen is usable afterwards: the press released `busy`.
    expect(screen.getByRole('button', { name: /start a household/i })).toBeEnabled()
  })

  it('an unconfigured build asks nothing', async () => {
    backend.hasSupabaseConfig = false
    await renderApp()
    expect(authSettingsApi.readGoogleSignIn).not.toHaveBeenCalled()
  })
})

describe('#440 — a session that ends here lands on the sign-in form, and nothing is read after it', () => {
  // #431's fixture: person-a is m1, an ordinary member; m9 organizes.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' }
  const organizerRow = { id: 'm9', display_name: 'Placeholder Organizer', weekly_minutes: 60, claimed_by: 'person-z' }

  // THE GRANT LAYER, as the live project has had it since `0017` (#186): a
  // household read with no session is REFUSED, not empty, in the words
  // `unwrap` puts on PostgREST's 42501. The suite's default `listHouseholds`
  // answers whoever asks — which is exactly why every sign-out test was green
  // while production kept the household on screen behind this sentence.
  const REFUSED = 'loading your households: permission denied for table households'
  let session
  let inHousehold
  // auth-js's third state: offline past the access token's expiry, the refresh
  // fails retryably, `getSession()` answers a null session WITH an error, and
  // the refresh token is still stored. `currentSession()` reads it as null;
  // `sessionIsGone()` must not read it as gone.
  let sessionUnknown

  beforeEach(() => {
    session = { user: { id: 'person-a' } }
    inHousehold = true
    sessionUnknown = false
    api.sessionIsGone.mockImplementation(async () => !session && !sessionUnknown)
    api.currentSession.mockImplementation(async () => session)
    api.currentUserId.mockImplementation(async () => session?.user.id ?? null)
    api.listHouseholds.mockImplementation(async () => {
      if (!session) throw new Error(REFUSED)
      return inHousehold ? [household] : []
    })
    api.listMembers.mockResolvedValue([organizerRow, me])
    // auth-js on success: the local session is gone.
    api.signOut.mockImplementation(async () => {
      session = null
    })
  })

  const click = async (element) => act(async () => void fireEvent.click(element))
  /**
   * Every household read made after `mock`'s first call. Throws when `mock` was
   * never called, so "no reads after it" cannot pass on an act that never ran.
   */
  const readsAfter = (mock) => {
    const at = mock.mock.invocationCallOrder[0]
    if (at === undefined) throw new Error('readsAfter: that call never happened')
    return api.listHouseholds.mock.invocationCallOrder.filter((order) => order > at)
  }
  /** The reads #440 is about: any household read after the (first) sign-out. */
  const readsAfterSignOut = () => readsAfter(api.signOut)
  const expectSignedOutScreen = async () => {
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    // Nothing of the household the last person was looking at.
    expect(screen.queryByRole('region', { name: /who is in the household/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Placeholder One')).not.toBeInTheDocument()
    expect(screen.queryByText('Placeholder Organizer')).not.toBeInTheDocument()
  }
  const leave = async () => {
    await click(screen.getByRole('button', { name: /^leave this household$/i }))
    await click(screen.getByRole('button', { name: /^leave placeholder household\?$/i }))
  }

  it('the fixture refuses a signed-out household read the way the live grant layer does', async () => {
    // The control every test below leans on: without it, "no refusal on screen"
    // could mean the fake would never have refused anything.
    await expect(api.listHouseholds()).resolves.toEqual([household])
    session = null
    await expect(api.listHouseholds()).rejects.toThrow('permission denied for table households')
  })

  it('AC 1 / AC 3: Sign out lands on the sign-in form with no refusal, no household, and no read after it', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()

    await click(screen.getByRole('button', { name: /^sign out$/i }))

    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    await expectSignedOutScreen()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(readsAfterSignOut()).toEqual([])
  })

  it('AC 2: Sign out everywhere, once confirmed, lands the same way', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await click(screen.getByRole('button', { name: /^sign out everywhere$/i }))
    expect(api.signOut).not.toHaveBeenCalled()
    await click(screen.getByRole('button', { name: /^sign out on every device\?$/i }))

    expect(api.signOut).toHaveBeenCalledWith({ everywhere: true })
    await expectSignedOutScreen()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(readsAfterSignOut()).toEqual([])
  })

  it('the signed-in-but-no-household screen signs out to the sign-in form too', async () => {
    inHousehold = false
    await renderApp()
    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()

    await click(screen.getByRole('button', { name: /^sign out$/i }))

    await expectSignedOutScreen()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(readsAfterSignOut()).toEqual([])
  })

  it('a logout the server refused still lands, because auth-js ended the local session anyway — and lands clean', async () => {
    // auth-js 2.112.1 `_signOut`: anything but a 401/403/404 still removes the
    // local session, THEN returns the error. The fake does both, in that order.
    api.signOut.mockImplementation(async () => {
      session = null
      throw Object.assign(new Error('Could not sign out: Failed to fetch'), {
        cause: { message: 'Failed to fetch' },
      })
    })
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await click(screen.getByRole('button', { name: /^sign out$/i }))

    await expectSignedOutScreen()
    // The design pass's verdict (2026-09-13): the device IS signed out and
    // nothing on it holds the token, so a sentence saying the server did not
    // confirm it is an alarm with nothing to act on. It lands clean.
    expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(readsAfterSignOut()).toEqual([])
  })

  it('a refused Sign out everywhere lands too, and names the devices that may still be signed in', async () => {
    api.signOut.mockImplementation(async () => {
      session = null
      throw Object.assign(new Error('Could not sign out: Internal Server Error'), {
        cause: { message: 'Internal Server Error' },
      })
    })
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await click(screen.getByRole('button', { name: /^sign out everywhere$/i }))
    await click(screen.getByRole('button', { name: /^sign out on every device\?$/i }))

    await expectSignedOutScreen()
    const said = screen.getByTestId('sign-in-return')
    expect(said).toHaveTextContent(/your other devices may still be signed in/i)
    expect(said).toHaveTextContent(/choose sign out everywhere again/i)
    // The library's own reason, not the data layer's wrapper around it: the
    // wrapper begins "Could not sign out", which beside "This device is
    // signed out" contradicts itself (review-fanout, 2026-09-13).
    expect(said).toHaveTextContent('(Internal Server Error)')
    expect(said).not.toHaveTextContent(/could not sign out/i)
    expect(readsAfterSignOut()).toEqual([])
  })

  it('a refused logout that left the session in place changes nothing, and says why', async () => {
    api.signOut.mockRejectedValue(new Error('Could not sign out: Failed to fetch'))
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await click(screen.getByRole('button', { name: /^sign out$/i }))

    // Still signed in, still here. A remount would have taken this sentence
    // with it — the fresh instance's state starts empty — so the complaint
    // being here is also the proof that nothing was remounted.
    const complaint = await screen.findByTestId('sign-out-complaint')
    expect(complaint).toHaveTextContent('Could not sign out: Failed to fetch')
    // BESIDE the control that was pressed, in the card that holds it — not on
    // the shared strip at the foot of the tab (review-fanout, 2026-09-13).
    expect(
      within(screen.getByRole('region', { name: /^placeholder household$/i })).getByTestId('sign-out-complaint'),
    ).toBe(complaint)
    expect(screen.getByRole('region', { name: /who is in the household/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    // Nothing was carried either: the sentence that says "this device is
    // signed out" would be false here.
    expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
  })

  it('offline past the token expiry, a refused logout whose session is still stored lands nowhere, and says so beside the control', async () => {
    // auth-js fails the refresh inside `_useSession` retryably, removes
    // nothing, and `getSession()` answers a null session WITH an error. The
    // first draft read that null as gone and said "signed out"; measured on
    // #440, a reload once online came back signed in as the same person.
    api.signOut.mockImplementation(async () => {
      session = null
      sessionUnknown = true
      throw Object.assign(new Error('Could not sign out: Failed to fetch'), {
        cause: { message: 'Failed to fetch' },
      })
    })
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await click(screen.getByRole('button', { name: /^sign out$/i }))

    expect(await screen.findByTestId('sign-out-complaint')).toHaveTextContent('Could not sign out: Failed to fetch')
    expect(screen.getByRole('region', { name: /who is in the household/i })).toBeInTheDocument()
    expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
  })

  it('the leave that deleted the account lands on the sign-in form, carrying what the leave owes them', async () => {
    api.leaveHousehold.mockImplementation(async () => {
      inHousehold = false
      return { accountDeleted: true, warning: null, revokeFailed: true }
    })
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await leave()

    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    await expectSignedOutScreen()
    // #99's sentence, true of a leave that SUCCEEDED, on the screen they are
    // now on rather than lost with the refused re-read.
    expect(screen.getByTestId('sign-in-return')).toHaveTextContent(/Google may still list Taskr/)
    expect(screen.queryByText(REFUSED)).not.toBeInTheDocument()
    expect(readsAfterSignOut()).toEqual([])
    // Nor between the leave and the sign-out: the account is gone, so there is
    // nothing this device may read, and `mutate` skips its re-read.
    expect(readsAfter(api.leaveHousehold)).toEqual([])
  })

  it('the leave that deleted the account and owes nothing lands on a clean sign-in form', async () => {
    api.leaveHousehold.mockImplementation(async () => {
      inHousehold = false
      return { accountDeleted: true, warning: null }
    })
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await leave()

    await expectSignedOutScreen()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(readsAfterSignOut()).toEqual([])
    expect(readsAfter(api.leaveHousehold)).toEqual([])
  })

  it('a leave whose sign-out left the session in place shows what the leave did, and says both', async () => {
    // `revokeFailed` so the notes are not empty: with none, keeping or dropping
    // them from the sentence is the same string and the test could not tell.
    api.leaveHousehold.mockImplementation(async () => {
      inHousehold = false
      return { accountDeleted: true, warning: null, revokeFailed: true }
    })
    api.signOut.mockRejectedValue(new Error('Could not sign out: Failed to fetch'))
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await leave()

    // The household they left is not left on screen: the read `mutate` skipped
    // for a session that was meant to be over runs here instead.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not sign out: Failed to fetch')
    expect(alert).toHaveTextContent(/Google may still list Taskr/)
    expect(screen.queryByRole('region', { name: /who is in the household/i })).not.toBeInTheDocument()
    expect(readsAfterSignOut().length).toBeGreaterThan(0)
  })

  it('holds every control while the leave that deleted the account is signing out', async () => {
    let finishSignOut
    api.leaveHousehold.mockImplementation(async () => {
      inHousehold = false
      return { accountDeleted: true, warning: null, revokeFailed: true }
    })
    api.signOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSignOut = () => {
            session = null
            resolve()
          }
        }),
    )
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await leave()

    // The sign-out is in flight over the household just left, and nothing on
    // it may be pressed — Sign out above all, whose second `endSession` could
    // land last and replace the Google note this one carries.
    expect(api.signOut).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /^sign out$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^sign out everywhere$/i })).toBeDisabled()

    await act(async () => finishSignOut())
    await expectSignedOutScreen()
    expect(screen.getByTestId('sign-in-return')).toHaveTextContent(/Google may still list Taskr/)
  })

  it('a session ended somewhere else lands on the sign-in form and says so, with nothing read after it', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(signedOutListeners).toHaveLength(1)
    const readsBefore = api.listHouseholds.mock.calls.length
    // A code held on this device, as #173 leaves one: the next person must not
    // inherit it, however the session ended.
    window.localStorage.setItem('taskr.pendingInvitation', JSON.stringify({ code: 'k7m3qp4rwn', name: 'Placeholder Three' }))

    // What auth-js does when another device's Sign out everywhere revokes this
    // one's refresh token: the stored session goes, and SIGNED_OUT is emitted.
    await act(async () => {
      session = null
      signedOutListeners[0]()
    })

    await expectSignedOutScreen()
    expect(screen.getByTestId('sign-in-return')).toHaveTextContent(/signed out from somewhere else/i)
    expect(window.localStorage.getItem('taskr.pendingInvitation')).toBeNull()
    expect(api.signOut).not.toHaveBeenCalled()
    expect(api.listHouseholds.mock.calls.length).toBe(readsBefore)
    expect(screen.queryByText(REFUSED)).not.toBeInTheDocument()
  })

  it("this device's own sign-out is not also read as a session ended somewhere else", async () => {
    // auth-js emits SIGNED_OUT from INSIDE its own sign-out, and the fake does
    // too — then lets a task pass before the sign-out resolves. In the same
    // task React batches the listener's landing with `endSession`'s and the
    // second simply wins, so no test could tell whether the listener stood
    // aside (measured on #440: removing the guard reddened nothing). With a
    // task between them the listener's landing RENDERS: a second remount, and a
    // moment of "signed out from somewhere else" on the screen of the person
    // who just pressed Sign out. One remount is what proves the guard held.
    api.signOut.mockImplementation(async () => {
      session = null
      signedOutListeners.at(-1)()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await click(screen.getByRole('button', { name: /^sign out$/i }))

    await expectSignedOutScreen()
    expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    // One subscription per mounted instance: the first, and exactly one remount.
    expect(signedOutListeners).toHaveLength(2)
  })

  it('a SIGNED_OUT while nobody is signed in changes nothing', async () => {
    // A boot that finds a dead session emits the event on its way to the
    // sign-in screen it is already showing; that must not remount it again.
    session = null
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    const bootsBefore = api.currentSession.mock.calls.length

    await act(async () => signedOutListeners.at(-1)())

    expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    expect(api.currentSession.mock.calls.length).toBe(bootsBefore)
  })

  it('the remounted app lets go of the old subscription and holds one of its own', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    // Counted as a DELTA: Testing Library unmounts the previous test's app
    // after this file's afterEach clears the spy, so the absolute count
    // carries one call over from whichever test ran before (measured: 2).
    const unsubscribedBefore = unsubscribeSignedOut.mock.calls.length

    await click(screen.getByRole('button', { name: /^sign out$/i }))
    await expectSignedOutScreen()

    expect(unsubscribeSignedOut.mock.calls.length - unsubscribedBefore).toBe(1)
    expect(signedOutListeners).toHaveLength(2)
  })

  it('the next person to sign in on this device inherits nothing the last one left in memory', async () => {
    // The skipped notice is set at boot and cleared by nothing but a new
    // instance — the shape of the state a hand-kept reset list would forget.
    choresApi.catchUpRepeats.mockResolvedValue({ created: 2, skipped: 3 })
    const SKIPPED = '3 repeat occurrences older than the catch-up window were skipped rather than piled onto this week.'
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(screen.getByText(SKIPPED)).toBeInTheDocument()

    await click(screen.getByRole('button', { name: /^sign out$/i }))
    await expectSignedOutScreen()

    api.signIn.mockImplementation(async () => {
      session = { user: { id: 'person-a' } }
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    // Joined again — the control that the screen below is a household at all.
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(screen.queryByText(SKIPPED)).not.toBeInTheDocument()
  })
})

describe('#482 — Trust this device, from App', () => {
  const FLAG = 'taskr.untrustedSession'
  const trustBox = () => screen.getByRole('checkbox', { name: /trust this device/i })

  beforeEach(() => {
    sessionStorage.clear()
  })

  it('AC 2: unticked, the data layer is asked for an untrusted password sign-in', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signIn.mockResolvedValue({ user: { id: 'person-a' } })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    fireEvent.click(trustBox())
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign in$/i })))

    expect(api.signIn).toHaveBeenCalledWith({ email: 'kid@example.com', password: '4821', trusted: false })
  })

  it('AC 3: unticked, Continue with Google reaches the data layer with the same choice', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signInWithGoogle.mockResolvedValue(undefined)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    fireEvent.click(trustBox())
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /continue with google/i })),
    )
    expect(api.signInWithGoogle).toHaveBeenCalledWith({ trusted: false })
  })

  it('AC 1: ticked by default, Google is asked for a trusted sign-in', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signInWithGoogle.mockResolvedValue(undefined)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(trustBox()).toBeChecked()
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /continue with google/i })),
    )
    expect(api.signInWithGoogle).toHaveBeenCalledWith({ trusted: true })
  })

  it('AC 5: booting an untrusted session still opens the household this device last chose', async () => {
    sessionStorage.setItem(FLAG, '1')
    window.localStorage.setItem('taskr.activeHousehold', HOUSEHOLD_TWO.id)
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])

    await renderApp()
    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
    expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(HOUSEHOLD_TWO.id)
  })

  it('AC 5: booting an untrusted session still offers the invitation this device is holding', async () => {
    sessionStorage.setItem(FLAG, '1')
    window.localStorage.setItem(
      'taskr.pendingInvitation',
      JSON.stringify({ code: 'k7m3qp4rwn', name: 'Placeholder Three' }),
    )
    await renderApp()
    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(confirm).toHaveTextContent(/Placeholder Three/)
    expect(window.localStorage.getItem('taskr.pendingInvitation')).not.toBeNull()
  })
})
