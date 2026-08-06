import { useState } from 'react'
import PropTypes from 'prop-types'
import { JOIN_CODE_LENGTH, isPlausibleJoinCode, normalizeJoinCode } from '../lib/joinCode.js'

// The two ways into a household — AC 1 (create, and learn the credential) and
// AC 5 (join with it, from a phone with no email account).
//
// Deliberately one screen with two choices rather than a wizard. The organizer
// does the left-hand thing once; everyone else does the right-hand thing once.
// Nobody in this app is onboarded twice, so there is no flow to remember.

export default function Onboarding({ onCreate, onJoin, busy }) {
  const [name, setName] = useState('')
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

  return (
    <div className="onboarding">
      <section className="card" aria-labelledby="create-heading">
        <h2 id="create-heading" className="card__heading">
          Start a household
        </h2>
        <p className="card__body">
          You will get a join code to read out to everyone else&rsquo;s phone.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => onCreate(name))
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
          <button className="button" type="submit" disabled={busy || !name.trim()}>
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
