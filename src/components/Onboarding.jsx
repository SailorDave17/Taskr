import { useState } from 'react'
import PropTypes from 'prop-types'

// The three states a person can open this app in, and the ONE function that
// decides which (#154). App.jsx reads its status off this and renders the
// screen below for the first two; the third state is the household itself,
// and this component is not rendered at all.
//
// A pure function beside the screen rather than two `if`s inside App's boot
// effect, because AC 7 asks that the three entry states be covered here and
// that each branch redden on its own. A decision made inline in an effect has
// no test that names it.
export const ENTRY = Object.freeze({
  SIGNED_OUT: 'signed-out',
  NO_HOUSEHOLD: 'no-household',
  JOINED: 'joined',
})

export function entryStateFor({ session, household }) {
  // The session decides FIRST. A household read with no session behind it is
  // not a joined state whatever the read said — and since 0017 (#186) that
  // read could not have happened anyway, because `anon` holds nothing.
  if (!session) return ENTRY.SIGNED_OUT
  if (!household) return ENTRY.NO_HOUSEHOLD
  return ENTRY.JOINED
}

// The first screen. Since #154 it is a SIGN-IN screen: one form, asking for
// the email and password the person already has, with "Start a household"
// as a link underneath rather than a card of equal weight beside it.
//
// WHY THE WEIGHT MOVED. From #62 to #154 this was two cards side by side —
// start a household on the left, sign in on the right — and the left-hand one
// was the one a returning housemate on a new phone read first. Nearly every
// person who opens this app already belongs to a household; the organizer
// starts one exactly once. So the screen now leads with the thing almost
// everyone came to do, and the once-only thing is a link.
//
// WHY THE ACCOUNT AND THE HOUSEHOLD ARE TWO SUBMITS. The organizer's own
// account is created with `signUp`, which is the one signup a client is
// allowed to do, because the account being created is the caller's own
// (everybody else is provisioned server-side — see the roster screen). Until
// #154 that signup and `create_household` ran inside ONE submit, and the pair
// could only ever succeed on a project with email confirmation OFF. The live
// project has it ON (`mailer_autoconfirm: false`, measured 2026-08-26), so
// `signUp` returns no session, the RPC that followed ran unauthenticated and
// was refused, and every first signup against production ended in an error
// with an account already created underneath it. Now the account is one
// submit, the confirmation email is the next step, and naming the household
// is a form this screen shows only to somebody who is signed in.
//
// So there are three cards in this file and a person sees exactly one:
//
//   signed out, view 'sign-in'   → Sign in, with the start-a-household link
//   signed out, view 'sign-up'   → Create your account (email + password)
//   signed in, no household      → Name the household, or sign out
//
// The half-finished state — account made, household not — is no longer an
// edge case reached by a failure. It is the ordinary state every organizer
// passes through between confirming their email and naming the household.

export default function Onboarding({
  onCreate,
  onSignIn,
  onSignInWithGoogle,
  onSignUp,
  onSignOut,
  signedIn = false,
  signInNotice = null,
  busy,
}) {
  // Which of the two signed-out cards is showing. Irrelevant once signed in.
  const [view, setView] = useState('sign-in')
  // Set by a signup that came back needing email confirmation, and read by the
  // sign-in card so it can say so. Holds the address rather than a boolean
  // because the sentence names the inbox to look in.
  const [pendingEmail, setPendingEmail] = useState(null)
  const [name, setName] = useState('')
  const [organizerName, setOrganizerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signInEmail, setSignInEmail] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [error, setError] = useState(null)

  async function run(action) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err.message)
    }
  }

  // Supabase's own floor is 6 characters, and a shorter one is refused by the
  // auth endpoint rather than here. Named so the button can be disabled before a
  // round trip, not so the client can be the authority — it is not.
  const PASSWORD_MIN_LENGTH = 6

  const createReady = Boolean(name.trim()) && Boolean(organizerName.trim())
  const signUpReady = Boolean(email.trim()) && password.length >= PASSWORD_MIN_LENGTH
  const signInReady = Boolean(signInEmail.trim()) && Boolean(signInPassword)

  // The account submit, on its own. What happens next depends on what the
  // signup came back with, and both answers are ordinary:
  //
  //   needsConfirmation → the project wants the email confirmed first (the
  //     live project always does). Say so on the sign-in card, with the
  //     address filled in, because signing in is the next thing they do.
  //   a session → confirmation is off (a local stack). The app re-reads, finds
  //     a person with no household, and re-renders this screen with
  //     `signedIn`, which shows the household form. Nothing to do here.
  //
  // What never happens here is a household being created: that is a separate
  // form, shown only to somebody signed in (AC 5).
  async function submitSignUp() {
    const result = await onSignUp({ email: email.trim(), password })
    if (result?.needsConfirmation) {
      setPendingEmail(email.trim())
      setSignInEmail(email.trim())
      setPassword('')
      setView('sign-in')
    }
  }

  const switchTo = (next) => {
    setError(null)
    setView(next)
  }

  return (
    <div className="onboarding">
      {signedIn ? (
        <section className="card" aria-labelledby="create-heading">
          <h2 id="create-heading" className="card__heading">
            Start a household
          </h2>
          <p className="card__body" data-testid="signed-in-note">
            You are signed in, but you are not in a household yet. Name one below
            and you will be its organizer &mdash; or sign out if you meant to use
            a different account.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => onCreate(name, { organizerName }))
            }}
          >
            <label className="field">
              <span className="field__label">Household name</span>
              <input
                className="field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The Household"
                maxLength={60}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span className="field__label">Your name</span>
              <input
                className="field__input"
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                placeholder="Alex"
                maxLength={40}
                autoComplete="off"
              />
            </label>
            <div className="row">
              <button className="button" type="submit" disabled={busy || !createReady}>
                Create household
              </button>
              {/* The other way out of this state, and the reason it is not a
                  dead end: an account exists, so the person needs either the
                  household they are missing or a way to stop being this
                  account. Both are here. One device only (#291): somebody
                  between confirming an email and naming a household is not
                  reporting a stolen phone. */}
              {onSignOut ? (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => onSignOut({ everywhere: false })}
                  disabled={busy}
                >
                  Sign out
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      {!signedIn && view === 'sign-in' ? (
        <section className="card" aria-labelledby="signin-heading">
          <h2 id="signin-heading" className="card__heading">
            Sign in
          </h2>
          {/* #304 — what Supabase put on the URL when a sign-in did not
              complete, read at boot (App.jsx, readSignInReturn) and worded by
              describeSignInReturn. Above the form because it answers the thing
              the person just did, and cleared the moment they try again. */}
          {signInNotice ? (
            <p className="error" role="alert" data-testid="sign-in-return">
              {signInNotice}
            </p>
          ) : null}
          {pendingEmail ? (
            // Worded to fit BOTH readings of a no-session signup, because
            // GoTrue answers a signup for an address that already has an
            // account exactly like a fresh one when confirmations are on —
            // obfuscated user, no session, no error — so that the call cannot
            // be used to find out who has an account. This sentence must not
            // undo that by promising a message that may not have been sent.
            <p className="card__body" data-testid="confirmation-note" role="status">
              Your account exists, but it needs its email confirmed before you
              can sign in. Open the link in the message sent to{' '}
              <strong>{pendingEmail}</strong>, then sign in here &mdash; you will
              name your household after that. If you already had an account at
              that address, nothing has changed: sign in with the password you
              had.
            </p>
          ) : signInNotice ? null : (
            // Stepped aside while a return notice is showing (#304). design-bar
            // measured the notice at 122–170px at 360×800, and with these four
            // lines still under it the Continue with Google control the notice
            // points at sat 3–47px below the fold. The notice already says what
            // to do; this paragraph is for somebody arriving cold.
            <p className="card__body">
              Use the email and password the organizer set up for you. If you
              have a PIN rather than a password, type the PIN here &mdash; it is
              the same box.
            </p>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => onSignIn({ email: signInEmail, password: signInPassword }))
            }}
          >
            <label className="field">
              <span className="field__label">Email</span>
              <input
                className="field__input"
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span className="field__label">Password or PIN</span>
              <input
                className="field__input"
                type="password"
                value={signInPassword}
                onChange={(e) => setSignInPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="button" type="submit" disabled={busy || !signInReady}>
              Sign in
            </button>
          </form>
          {/* #304 — the other way in, for a member whose sign-in address is a
              Google account. A button, not a link like "Start a household":
              for the person it applies to this is a primary route, not a
              once-only one. Quiet rather than filled so the password form still
              leads — it is the route that works for EVERY member, PIN members
              included, where this one works only for a confirmed real address
              Google also knows. Pressing it leaves the page (Supabase's own
              flow); nothing here awaits a result, and the return is read at
              the next boot. Not a form: gate.test.js counts three forms on
              this screen and this is not a fourth. */}
          <p className="divider">or</p>
          <button
            className="button button--quiet button--block"
            type="button"
            onClick={() => run(() => onSignInWithGoogle?.())}
            disabled={busy}
          >
            Continue with Google
          </button>
          {/* The secondary route. A link, not a second button of equal weight
              (AC 1): the person opening this app on a new phone almost always
              has a household already, and the organizer starts one once. */}
          <p className="card__note">
            New household?{' '}
            <button
              className="button--link"
              type="button"
              onClick={() => switchTo('sign-up')}
              disabled={busy}
            >
              Start a household
            </button>
          </p>
        </section>
      ) : null}

      {!signedIn && view === 'sign-up' ? (
        <section className="card" aria-labelledby="signup-heading">
          <h2 id="signup-heading" className="card__heading">
            Start a household
          </h2>
          <p className="card__body">
            First, your own account. You sign in with your own email and
            password, and you are the organizer &mdash; the person who adds
            everyone else and gives them their way in. There is nobody above
            you, so if you lose this password it cannot be reset from inside
            the app. You will name the household once you are signed in.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              run(submitSignUp)
            }}
          >
            <label className="field">
              <span className="field__label">Your email</span>
              <input
                className="field__input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span className="field__label">Your password</span>
              <input
                className="field__input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
              />
            </label>
            <button className="button" type="submit" disabled={busy || !signUpReady}>
              Create account
            </button>
          </form>
          <p className="card__note">
            Already have an account?{' '}
            <button
              className="button--link"
              type="button"
              onClick={() => switchTo('sign-in')}
              disabled={busy}
            >
              Sign in instead
            </button>
          </p>
        </section>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

Onboarding.propTypes = {
  onCreate: PropTypes.func.isRequired,
  onSignIn: PropTypes.func.isRequired,
  // #304. Optional in the type so the #154 tests, which predate it, render
  // without a fixture edit; App always passes it, and gate.test.js says so.
  onSignInWithGoogle: PropTypes.func,
  onSignUp: PropTypes.func.isRequired,
  onSignOut: PropTypes.func,
  signedIn: PropTypes.bool,
  signInNotice: PropTypes.string,
  busy: PropTypes.bool,
}
