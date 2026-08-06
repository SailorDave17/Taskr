import { useState } from 'react'
import PropTypes from 'prop-types'
import { JOIN_CODE_LENGTH, isPlausibleJoinCode, normalizeJoinCode } from '../lib/joinCode.js'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../lib/pin.js'

// The two ways into a household — AC 1 (create, and learn the credential) and
// AC 5 (join with it, from a phone with no email account).
//
// Deliberately one screen with two choices rather than a wizard. The organizer
// does the left-hand thing once; everyone else does the right-hand thing once.
// Nobody in this app is onboarded twice, so there is no flow to remember.

export default function Onboarding({ onCreate, onJoin, busy }) {
  const [name, setName] = useState('')
  const [organizerName, setOrganizerName] = useState('')
  const [organizerPin, setOrganizerPin] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)

  async function run(action) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err.message)
    }
  }

  const codeReady = isPlausibleJoinCode(code)
  const pinReady =
    organizerPin.trim().length >= PIN_MIN_LENGTH && organizerPin.trim().length <= PIN_MAX_LENGTH
  const createReady = Boolean(name.trim()) && Boolean(organizerName.trim()) && pinReady

  return (
    <div className="onboarding">
      <section className="card" aria-labelledby="create-heading">
        <h2 id="create-heading" className="card__heading">
          Start a household
        </h2>
        <p className="card__body">
          You will get a join code to read out to everyone else&rsquo;s phone. Your
          PIN is how you prove it is you &mdash; it is also the only way to reset
          anyone else&rsquo;s, so it cannot be recovered if you forget it.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => onCreate(name, { organizerName, organizerPin }))
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
          <label className="field">
            <span className="field__label">Your PIN</span>
            <input
              className="field__input field__input--code"
              type="password"
              value={organizerPin}
              onChange={(e) => setOrganizerPin(e.target.value)}
              placeholder="4 digits or more"
              inputMode="numeric"
              autoComplete="new-password"
              minLength={PIN_MIN_LENGTH}
              maxLength={PIN_MAX_LENGTH}
            />
          </label>
          <button className="button" type="submit" disabled={busy || !createReady}>
            Create household
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="join-heading">
        <h2 id="join-heading" className="card__heading">
          Join a household
        </h2>
        <p className="card__body">
          Type the {JOIN_CODE_LENGTH}-character code from the phone that started it.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => onJoin(code))
          }}
        >
          <label className="field">
            <span className="field__label">Join code</span>
            <input
              className="field__input field__input--code"
              value={code}
              // Normalised as you type, so the box shows exactly what will be
              // sent. A parent reading a code aloud says it in fours and types
              // it with a space; that must not become a different code.
              onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
              placeholder="ABCD2345"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={JOIN_CODE_LENGTH}
            />
          </label>
          <button className="button" type="submit" disabled={busy || !codeReady}>
            Join household
          </button>
        </form>
      </section>

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
  onJoin: PropTypes.func.isRequired,
  busy: PropTypes.bool,
}
