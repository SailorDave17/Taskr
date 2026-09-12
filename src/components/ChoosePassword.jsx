import PropTypes from 'prop-types'
import { useState } from 'react'

/**
 * The screen an invitation lands on — #341 AC 2, and since #191 AC 2 the place
 * the invited person names themselves.
 *
 * One field and one button was the criterion's own shape when #341 built it,
 * and it is still the shape for a RECOVERY: the person arriving here has just
 * clicked a link in their email, and anything else on the screen is something
 * to read before they can finish. An INVITE arrival carries one more field, and
 * it is there for a reason rather than for completeness — #191's owner decision
 * (2026-08-26) is that the organizer stops being the author of other people's
 * names: what the organizer typed personalises the invitation email only, and
 * the display name on the row is the recipient's own. The code path (#173)
 * asks "Your name in it" beside the code; this is the email path's copy of the
 * same question, asked at the same moment — the first time the person is in
 * front of the app. Blank rather than prefilled with the organizer's word,
 * because a prefill the person taps through leaves that word on the row.
 *
 * They are ALREADY SIGNED IN when they get here. The invite link carries a
 * session in the fragment and supabase-js consumes it at client construction, so
 * this is not a sign-in form — it is the one credential write a client may make
 * about itself (`setOwnPassword`), and there is nothing to authenticate. The
 * name follows the password, through the ordinary `updateMember` grant, and
 * App owns that order and its failure sentence.
 *
 * BUILT ONCE FOR TWO ARRIVALS, which #341 AC 2 asks for in as many words.
 * `invite` is #341's; `recovery` is #155's forgotten-password return, and it
 * lands on the same fragment shape with a different `type`. The words differ
 * because the two arrivals are genuinely different events: one person has never
 * had a password and the other is replacing one they lost. A single set of words
 * would have to be vague enough to fit both, and vague is the one thing this
 * screen cannot afford. The name field differs for the same reason — somebody
 * replacing a lost password already has a name on their row.
 *
 * The way IN for a recovery — the "Forgot your password?" control on the
 * sign-in screen that asks GoTrue to send the mail — is `Onboarding.jsx`'s
 * (#155). This is only the landing.
 */

/** The floor Supabase itself enforces, restated so the refusal arrives without a round trip. */
export const PASSWORD_FLOOR = 6

const COPY = {
  invite: {
    heading: 'Choose your password',
    body: 'You have been added to a household on Taskr. Say what to call you, pick a password, and you are in.',
    submit: 'Set my password',
  },
  recovery: {
    heading: 'Choose a new password',
    body: 'Pick a new password for your Taskr sign-in.',
    submit: 'Save my password',
  },
}

export default function ChoosePassword({ type, busy, onChoose }) {
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [complaint, setComplaint] = useState(null)
  const copy = COPY[type] ?? COPY.invite
  // The name is asked on an INVITE only. Keyed on the resolved copy rather than
  // on `type` so an unknown type — which falls back to the invite words — also
  // asks for it, rather than showing invite copy over a form with no name.
  const asksName = copy === COPY.invite

  return (
    <div className="onboarding">
      <section className="card" aria-labelledby="choose-password-heading">
        <h2 id="choose-password-heading" className="card__heading">
          {copy.heading}
        </h2>
        <p className="card__body">{copy.body}</p>
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            // Checked here so the person gets the sentence before a round trip,
            // not instead of the server check — GoTrue still refuses a short
            // one. `noValidate` plus an explicit check rather than `minLength`,
            // deliberately: a browser constraint applies to a DIRTY value, so it
            // is inert while the box is empty and fires the moment somebody
            // types (cairn's browser-constraint-validation note).
            if (asksName && !name.trim()) {
              setComplaint('Say what the household should call you.')
              return
            }
            if (password.length < PASSWORD_FLOOR) {
              setComplaint(
                `Use at least ${PASSWORD_FLOOR} characters, so it is not guessable.`,
              )
              return
            }
            setComplaint(null)
            onChoose(password, asksName ? name.trim() : undefined).catch(() => {})
          }}
        >
          {asksName ? (
            <label className="field">
              <span className="field__label">Your name in the household</span>
              <input
                className="field__input"
                value={name}
                maxLength={40}
                autoComplete="name"
                autoFocus
                data-testid="choose-name-input"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              type="password"
              value={password}
              // `new-password` rather than `current-password`: this is a value
              // being set, so a password manager should offer to generate and
              // store one rather than autofilling something that does not exist
              // yet.
              autoComplete="new-password"
              autoFocus={!asksName}
              data-testid="choose-password-input"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {complaint ? (
            <p className="error" role="alert">
              {complaint}
            </p>
          ) : null}
          <button className="button" type="submit" disabled={busy}>
            {copy.submit}
          </button>
        </form>
      </section>
    </div>
  )
}

ChoosePassword.propTypes = {
  type: PropTypes.oneOf(['invite', 'recovery']).isRequired,
  busy: PropTypes.bool,
  onChoose: PropTypes.func.isRequired,
}
