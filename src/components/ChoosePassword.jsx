import PropTypes from 'prop-types'
import { useState } from 'react'

/**
 * The screen an invitation lands on — #341 AC 2.
 *
 * One field and one button, which is the criterion's own shape and worth
 * honouring literally: the person arriving here has just clicked a link in their
 * email and has no idea what this app is. Anything else on the screen is
 * something to read before they can finish.
 *
 * They are ALREADY SIGNED IN when they get here. The invite link carries a
 * session in the fragment and supabase-js consumes it at client construction, so
 * this is not a sign-in form — it is the one credential write a client may make
 * about itself (`setOwnPassword`), and there is nothing to authenticate.
 *
 * BUILT ONCE FOR TWO ARRIVALS, which AC 2 asks for in as many words. `invite` is
 * #341's; `recovery` is #155's forgotten-password return, and it lands on the
 * same fragment shape with a different `type`. Only the words differ, and they
 * differ because the two arrivals are genuinely different events: one person has
 * never had a password and the other is replacing one they lost. A single set of
 * words would have to be vague enough to fit both, and vague is the one thing
 * this screen cannot afford.
 *
 * #155 is NOT delivered by this file. What it still owes is the way IN — a
 * "forgotten your password" control that asks GoTrue to send the recovery
 * email. This is only the landing.
 */

/** The floor Supabase itself enforces, restated so the refusal arrives without a round trip. */
export const PASSWORD_FLOOR = 6

const COPY = {
  invite: {
    heading: 'Choose your password',
    body: 'You have been added to a household on Taskr. Pick a password and you are in.',
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
  const [complaint, setComplaint] = useState(null)
  const copy = COPY[type] ?? COPY.invite

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
            if (password.length < PASSWORD_FLOOR) {
              setComplaint(
                `Use at least ${PASSWORD_FLOOR} characters, so it is not guessable.`,
              )
              return
            }
            setComplaint(null)
            onChoose(password).catch(() => {})
          }}
        >
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
              autoFocus
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
