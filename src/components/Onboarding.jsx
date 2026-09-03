import { useState } from 'react'
import PropTypes from 'prop-types'

// The two ways into a household — AC 1 (start one) and #62 (sign in as
// yourself).
//
// Deliberately one screen with two choices rather than a wizard. The organizer
// does the left-hand thing once; everyone else does the right-hand thing once.
// Nobody in this app is onboarded twice, so there is no flow to remember. That
// shape survived #62 even though both halves changed underneath it.
//
// WHAT CHANGED, and why the right-hand side is not the same screen with new
// words: it used to be "join a household" with a shared code, and holding that
// code was the whole of admission. Anyone who overheard it was in. Now the
// right-hand side is a sign-in — you already have an account or you do not, and
// the organizer is who creates it. That moves admission from a secret anybody
// can repeat to an account somebody had to be given.
//
// The organizer's own account is created here with `signUp`, which is the ONE
// signup a client is allowed to do, because the account being created is the
// caller's own. Provisioning anybody else needs the `service_role` key and lives
// in an Edge Function — see the note on the roster screen.

export default function Onboarding({ onCreate, onSignIn, onSignOut, signedIn = false, busy }) {
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

  // Signed in already: the account half is done, so the credential fields are
  // neither shown nor required. This is the state a half-finished create leaves
  // behind — account made, household not — and before #62's review it was a dead
  // end, because the only Create button called signUp again for an address that
  // now existed.
  const createReady =
    Boolean(name.trim()) &&
    Boolean(organizerName.trim()) &&
    (signedIn || (Boolean(email.trim()) && password.length >= PASSWORD_MIN_LENGTH))
  const signInReady = Boolean(signInEmail.trim()) && Boolean(signInPassword)

  return (
    <div className="onboarding">
      <section className="card" aria-labelledby="create-heading">
        <h2 id="create-heading" className="card__heading">
          Start a household
        </h2>
        {signedIn ? (
          <p className="card__body" data-testid="signed-in-note">
            You are signed in, but you are not in a household yet. Name one below
            and you will be its organizer &mdash; or sign out if you meant to use
            a different account.
          </p>
        ) : (
          <p className="card__body">
            You sign in with your own email and password, and you are the organizer
            &mdash; the person who adds everyone else and gives them their way in.
            There is nobody above you, so if you lose this password it cannot be
            reset from inside the app.
          </p>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => onCreate(name, { organizerName, email, password }))
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
          {signedIn ? null : (
            <>
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
            </>
          )}
          <div className="row">
            <button className="button" type="submit" disabled={busy || !createReady}>
              Create household
            </button>
            {/* The other way out of the half-finished state, and the reason this
                screen is no longer a dead end: an account exists, so the person
                needs either the household they are missing or a way to stop
                being this account. Both are here now; before, neither was. */}
            {signedIn && onSignOut ? (
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

      {/* Hidden once signed in: offering to sign in to somebody already signed in
          is the loop that made this state feel unrecoverable — Sign in succeeded,
          found no household, and returned to this very screen. */}
      {signedIn ? null : (
      <section className="card" aria-labelledby="signin-heading">
        <h2 id="signin-heading" className="card__heading">
          Sign in
        </h2>
        <p className="card__body">
          Use the email and password the organizer set up for you. If you have a
          PIN rather than a password, type the PIN here &mdash; it is the same
          box.
        </p>
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
      </section>
      )}

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
  onSignOut: PropTypes.func,
  signedIn: PropTypes.bool,
  busy: PropTypes.bool,
}
