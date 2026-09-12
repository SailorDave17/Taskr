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
// (everybody else is INVITED from the roster and sets their own — #341, and
// #191 made that the only way in; nobody is provisioned server-side now). Until
// #154 that signup and `create_household` ran inside ONE submit, and the pair
// could only ever succeed on a project with email confirmation OFF. The live
// project has it ON (`mailer_autoconfirm: false`, measured 2026-08-26), so
// `signUp` returns no session, the RPC that followed ran unauthenticated and
// was refused, and every first signup against production ended in an error
// with an account already created underneath it. Now the account is one
// submit, the confirmation email is the next step, and naming the household
// is a form this screen shows only to somebody who is signed in.
//
// So there are five cards in this file and a person sees at most two:
//
//   signed out, view 'sign-in'   → Sign in, with the start-a-household link
//                                  and the have-a-code link under it
//   signed out, view 'sign-up'   → Create your account (email + password)
//   signed out, view 'join'      → Join with a code (#173): the code is held
//                                  on this device, then sign in or sign up
//   signed in, no household      → Name the household, or sign out — AND,
//                                  beside it, join one with a code (#173)
//
// The half-finished state — account made, household not — is no longer an
// edge case reached by a failure. It is the ordinary state every organizer
// passes through between confirming their email and naming the household,
// and since #173 it is ALSO where an invited person lands after confirming:
// the join card is what they came for, and the household form is the
// organizer's route beside it.
//
// WHY THE CODE IS TAKEN BEFORE THE ACCOUNT, NOT AFTER (#173 AC 4). With
// confirmation on, "create your account" ends with the person leaving this
// app for their inbox. If the code were asked for on their return, everybody
// who arrived holding one would have to remember it across that round trip —
// and the ordinary case is a code pasted out of a message on the same phone,
// which is gone from the clipboard by then. So the join view asks for the code
// FIRST, `onHoldInvitation` keeps it on this device, and the sign-in and
// sign-up cards then say so; App applies it on the first signed-in boot in
// this browser. The mechanism and what it guarantees are
// `src/lib/pendingInvitation.js`'s.

export default function Onboarding({
  onCreate,
  onSignIn,
  onSignInWithGoogle,
  onSignUp,
  onSignOut,
  onJoin,
  onHoldInvitation,
  heldInvitation = false,
  // #173 — App's own error, for the one write on this screen that no form
  // here submits: a held code applied at boot and refused. Every other
  // failure on this screen is caught by `run()` below and shown from local
  // state; this is the one that arrives from outside. Rendered as ONE strip —
  // the local sentence wins when both are set, since they are the same
  // sentence for a submit made here.
  error = null,
  signedIn = false,
  signInNotice = null,
  busy,
}) {
  // Which of the three signed-out cards is showing. Irrelevant once signed in.
  const [view, setView] = useState('sign-in')
  // #173 — the code typed on the join card (signed out) or the join form
  // (signed in). One field serves both, since only one of them is ever on
  // screen.
  const [code, setCode] = useState('')
  // #173 — the name they will join under. Asked beside the code on both join
  // forms (owner decision at the design pass, 2026-09-11): the function
  // creates the row as a placeholder, and a person arriving under "New
  // member" had to find their own row and edit it before anybody could tell
  // who had joined.
  const [joinName, setJoinName] = useState('')
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
  const [localError, setError] = useState(null)
  // #173 — the App-side error this screen has already answered. The prop has
  // no setter here, so a boot-time refusal would otherwise stand over the join
  // view while the person types the next code (review finding): every act on
  // this screen latches the value it was showing, and the strip shows the
  // prop only until then. A NEW App error (a different sentence) shows again.
  const [dismissedError, setDismissedError] = useState(null)
  const shownError = localError ?? (error && error !== dismissedError ? error : null)

  async function run(action) {
    setError(null)
    setDismissedError(error)
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
  const joinReady = Boolean(code.trim()) && Boolean(joinName.trim())

  // #173 — the signed-out half: keep the code and the name on this device,
  // then move to the sign-in card, which says the code is held. The person
  // signs in with the account they have, or takes the create-an-account link
  // to make one — and both paths end with App applying the code once a
  // session exists.
  async function submitHold() {
    await onHoldInvitation(code, { name: joinName })
    setCode('')
    setJoinName('')
    switchTo('sign-in')
  }

  // #173 — the signed-in half: redeem now. Clears the fields on success only;
  // a refused code stays in the field so the person can see what they typed
  // against the sentence that refused it.
  async function submitJoin() {
    await onJoin(code, { name: joinName })
    setCode('')
    setJoinName('')
  }

  // The name field both join forms render. "Join as" rather than "Your
  // name", which is the household form's label on the same screen — and not
  // "Your name in it" either, which the #154 tests reach with a regex that
  // would then find two fields (measured: three App tests reddened on it).
  const nameField = (
    <label className="field">
      <span className="field__label">Join as</span>
      <input
        className="field__input"
        value={joinName}
        onChange={(e) => setJoinName(e.target.value)}
        placeholder="Sam"
        maxLength={40}
        autoComplete="off"
      />
    </label>
  )

  // The one field both join forms render. `autoCapitalize="none"` because the
  // code is shown in lower case and a phone keyboard would otherwise open with
  // shift on; `spellCheck={false}` because a ten-character code is exactly the
  // thing a spell-checker underlines. Casing and surrounding whitespace are
  // normalised by the data layer and the server alike (AC 8), so neither
  // attribute is load-bearing — they stop the keyboard fighting the person.
  const codeField = (
    <label className="field">
      <span className="field__label">Invitation code</span>
      <input
        className="field__input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={64}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
      />
    </label>
  )

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
    setDismissedError(error)
    setView(next)
  }

  return (
    <div className="onboarding">
      {/* #173 — the invited person's route out of the half-finished state.
          Optional in the wiring (`onJoin`), so the #154 tests render the
          household card alone as they always did; App always passes it.
          ABOVE the household form (owner decision at the design pass,
          2026-09-11): built below it, the prototype at 360×800 put this
          heading at y=731 and its button at y=926, so an invited person who
          confirmed in another browser landed on the organizer's form and had
          to scroll to find what they came for. Organizers start a household
          once; invited people arrive here every time. The household card
          keeps its #154 heading and form unchanged underneath. */}
      {signedIn && onJoin ? (
        <section className="card" aria-labelledby="join-heading">
          <h2 id="join-heading" className="card__heading">
            Join with a code
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              run(submitJoin)
            }}
          >
            <p className="card__note">
              Been given an invitation code? Type it here with the name you
              want to be called, and you join that household as yourself.
            </p>
            {codeField}
            {nameField}
            <button className="button" type="submit" disabled={busy || !joinReady}>
              Join household
            </button>
          </form>
        </section>
      ) : null}

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
            //
            // #173 — with a code held, the sentence after the link changes:
            // the next thing is joining the household, not naming one. Still
            // one paragraph and one `role="status"`, so the #154 tests that
            // read this note read the same element.
            <p className="card__body" data-testid="confirmation-note" role="status">
              Your account exists, but it needs its email confirmed before you
              can sign in. Open the link in the message sent to{' '}
              <strong>{pendingEmail}</strong>, then sign in here &mdash;{' '}
              {heldInvitation
                ? 'your invitation code is saved on this device and you confirm the join with one tap once you are in'
                : 'you will name your household after that'}
              . If you already had an account at that address, nothing has
              changed: sign in with the password you had.
            </p>
          ) : heldInvitation ? (
            // #173 — the person came through the join card and is now being
            // asked to sign in or sign up. Say the code is kept, and say WHERE,
            // because the guarantee is per device: opening the confirmation
            // link in another browser means typing the code again there
            // (pendingInvitation.js). `role="status"` like the note above,
            // and not the `.error` palette — nothing is wrong.
            <p className="card__body" data-testid="held-invitation-note" role="status">
              Your invitation code is saved on this device. Sign in with the
              account you have, or start with{' '}
              <strong>Create an account</strong> below, and you confirm the
              join with one tap as soon as you are signed in here.
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
            {heldInvitation ? 'No account yet?' : 'New household?'}{' '}
            <button
              className="button--link"
              type="button"
              onClick={() => switchTo('sign-up')}
              disabled={busy}
            >
              {heldInvitation ? 'Create an account' : 'Start a household'}
            </button>
          </p>
          {/* #173 — the third route in, and a link like the one above rather
              than a button: for the person it applies to it is a once-only
              act, and it must not compete with the sign-in form that nearly
              everyone came for. Hidden once a code is held, because the note
              above has taken its place and offering the card again would read
              as "the code you just typed was not kept". Optional in the
              wiring (`onHoldInvitation`) so the #154 tests render unchanged. */}
          {onHoldInvitation && !heldInvitation ? (
            <p className="card__note">
              Have an invitation code?{' '}
              <button
                className="button--link"
                type="button"
                onClick={() => switchTo('join')}
                disabled={busy}
              >
                Join a household
              </button>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* #173 — signed out, holding a code. The code is taken FIRST (see the
          file comment) and the account second, and the two are separate
          submits for #154's reason exactly: creating the account ends in the
          inbox, and this card's whole job is to have the code safe before
          that happens. */}
      {!signedIn && view === 'join' ? (
        <section className="card" aria-labelledby="join-heading">
          <h2 id="join-heading" className="card__heading">
            Join with a code
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              run(submitHold)
            }}
          >
            <p className="card__note">
              Type the code you were given and the name you want to be called.
              Both are kept on this device; next you sign in, or create an
              account if you do not have one, and you confirm the join with
              one tap the moment you are in. It works once, and only for a
              week, so do this on the phone you will use.
            </p>
            {codeField}
            {nameField}
            <button className="button" type="submit" disabled={busy || !joinReady}>
              Keep this code
            </button>
          </form>
          <p className="card__note">
            Changed your mind?{' '}
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

      {!signedIn && view === 'sign-up' ? (
        <section className="card" aria-labelledby="signup-heading">
          <h2 id="signup-heading" className="card__heading">
            {heldInvitation ? 'Create your account' : 'Start a household'}
          </h2>
          {heldInvitation ? (
            // #173 — the same form, a different reason. The person is not
            // the organizer of anything: they are making the account the held
            // code will be applied to. The organizer paragraph below would
            // tell them there is nobody above them, which is exactly wrong.
            <p className="card__body">
              Your own email and password, for the account your invitation
              code will join to the household. You will confirm the address
              from your inbox, sign in here, and confirm the join with one
              tap as soon as you are in.
            </p>
          ) : (
            <p className="card__body">
              First, your own account. You sign in with your own email and
              password, and you are the organizer &mdash; the person who adds
              everyone else and gives them their way in. There is nobody above
              you, so if you lose this password it cannot be reset from inside
              the app. You will name the household once you are signed in.
            </p>
          )}
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

      {shownError ? (
        <p className="error" role="alert">
          {shownError}
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
  // #173. Optional so the #154 tests render without a fixture edit; App
  // always passes all three, and gate.test.js says so.
  onJoin: PropTypes.func,
  onHoldInvitation: PropTypes.func,
  heldInvitation: PropTypes.bool,
  error: PropTypes.string,
  signedIn: PropTypes.bool,
  signInNotice: PropTypes.string,
  busy: PropTypes.bool,
}
