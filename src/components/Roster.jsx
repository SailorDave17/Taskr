import { useState } from 'react'
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, isValidPin } from '../lib/pin.js'
import PropTypes from 'prop-types'
import { formatMinutes } from '../lib/household.js'
import {
  MAX_CAPACITY_MINUTES,
  MIN_CAPACITY_MINUTES,
  effectiveCapacity,
  normalizeCapacityMinutes,
} from '../lib/capacity.js'

// The roster — ACs 2 and 4 (a person with a budget, edited or removed, and the
// change is what every other device shows on next load) and the "pick yourself"
// half of AC 5.
//
// Minutes are entered as minutes, not hours, because that is the unit the whole
// app reasons in: chores are minutes of work and a budget is minutes available.
// Showing "2h 0m" beside the field is a reading aid; the stored value is the
// number that was typed.

/**
 * This week's capacity for one person — story #46.
 *
 * The charter's complaint about every competitor is that they treat capacity as
 * a constant. `members.weekly_minutes` is the BASELINE — what a person usually
 * has — and this is where a household says "not this week". The baseline stays
 * visible beside it on purpose: an override that hid what it was overriding
 * would make the number impossible to sanity-check, and the whole product claim
 * is that the fairness figure is one anybody can check.
 *
 * Two things it deliberately is not:
 *
 * - **Not a form that has to be submitted to see the effect.** The effective
 *   number is what the row shows, so setting 120 against a 300 baseline changes
 *   the line the person is already reading.
 * - **Not dependent on anything but the database.** No model, no network
 *   service, no credential beyond the one the app already holds. #46 AC 6 makes
 *   that a test rather than a promise, because the manual road in is the floor
 *   the charter requires on day one and the extraction bet (#57) is an
 *   accelerator on top of it, never the only way in.
 *
 * `effectiveCapacity` is called rather than reimplemented — #44 AC 7's rule, and
 * `capacity.test.js` asserts there is exactly one implementation across all of
 * `src/`. The same call is what makes the chore screen's load figures follow
 * this week without any change there.
 */
function CapacityControl({ member, override, busy, onSet, onClear }) {
  const [editing, setEditing] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [complaint, setComplaint] = useState(null)

  const effective = effectiveCapacity(member, override)
  const isOverridden = Boolean(override)

  /**
   * Seed from the CURRENT effective value every time the editor opens, not from
   * a `useState` initialiser. The row never unmounts while the household is on
   * screen, so an initialiser would keep offering the value this device saw at
   * first render — and after another phone changed it, saving would write the
   * stale number back over their edit. Same fault, same fix, as the chore
   * editor in Chores.jsx.
   */
  function open() {
    setMinutes(String(effective))
    setComplaint(null)
    setEditing(true)
  }

  function close() {
    setComplaint(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="member__week">
        <span className="member__week-figure" data-testid={`week-${member.id}`}>
          This week: {effective} min
          <span className="member__budget-human"> ({formatMinutes(effective)})</span>
          {isOverridden ? (
            <span className="member__week-mark"> · set for this week</span>
          ) : (
            <span className="member__week-mark"> · usual</span>
          )}
        </span>
        <button
          className="button button--quiet"
          type="button"
          onClick={open}
          disabled={busy}
          aria-label={`Set this week for ${member.display_name}`}
        >
          This week
        </button>
      </div>
    )
  }

  return (
    <form
      className="stack member__week-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        // Validate with the data layer's own normalizer rather than restating
        // its bounds, so the sentence a person reads is the one the module
        // owns and cannot drift from the check constraint 0005 enforces.
        try {
          normalizeCapacityMinutes(minutes)
        } catch (err) {
          setComplaint(err.message)
          return
        }
        setComplaint(null)
        onSet(member.id, minutes).then(close, () => {})
      }}
    >
      <label className="field">
        <span className="field__label">Minutes this week</span>
        <input
          className="field__input"
          type="number"
          min={MIN_CAPACITY_MINUTES}
          max={MAX_CAPACITY_MINUTES}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-label={`Minutes this week for ${member.display_name}`}
        />
      </label>
      {complaint ? (
        <p className="error" role="alert">
          {complaint}
        </p>
      ) : null}
      <div className="row">
        <button className="button" type="submit" disabled={busy}>
          Save
        </button>
        {isOverridden ? (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onClear(member.id).then(close, () => {})}
            disabled={busy}
            aria-label={`Use the usual weekly minutes for ${member.display_name}`}
          >
            Use my usual
          </button>
        ) : null}
        <button className="button button--quiet" type="button" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

CapacityControl.propTypes = {
  member: PropTypes.object.isRequired,
  override: PropTypes.object,
  busy: PropTypes.bool,
  onSet: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
}

function MemberRow({
  member,
  override,
  isMe,
  canClaim,
  canSignIn,
  canSetPin,
  busy,
  onSave,
  onRemove,
  onClaim,
  onSetPin,
  onSignIn,
  onSetCapacity,
  onClearCapacity,
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.display_name)
  const [minutes, setMinutes] = useState(String(member.weekly_minutes))
  const [pin, setPin] = useState('')
  const [settingPin, setSettingPin] = useState(false)
  const [signInPin, setSignInPin] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  function cancel() {
    setName(member.display_name)
    setMinutes(String(member.weekly_minutes))
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="member member--editing">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            onSave(member.id, { displayName: name, weeklyMinutes: minutes }).then(
              () => setEditing(false),
              () => {},
            )
          }}
        >
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              aria-label={`Name for ${member.display_name}`}
            />
          </label>
          <label className="field">
            <span className="field__label">Available minutes per week</span>
            <input
              className="field__input"
              type="number"
              min="0"
              max="10080"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-label={`Weekly minutes for ${member.display_name}`}
            />
          </label>
          <div className="row">
            <button className="button" type="submit" disabled={busy}>
              Save
            </button>
            <button className="button button--quiet" type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="member">
      <div className="member__identity">
        <span className="member__name">
          {member.display_name}
          {isMe ? <span className="member__badge"> · you</span> : null}
        </span>
        <span className="member__budget">
          {member.weekly_minutes} min/week
          <span className="member__budget-human"> ({formatMinutes(member.weekly_minutes)})</span>
        </span>
        {/* The baseline above stays visible beside this week's number on
            purpose: an override that hid what it was overriding would make the
            figure impossible to sanity-check, and the product's claim is that
            the fairness number is one anybody can check. */}
        <CapacityControl
          member={member}
          override={override}
          busy={busy}
          onSet={onSetCapacity}
          onClear={onClearCapacity}
        />
      </div>

      <div className="row row--end">
        {canClaim ? (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onClaim(member.id)}
            disabled={busy}
          >
            This is me
          </button>
        ) : null}
        {canSignIn ? (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setSigningIn((open) => !open)}
            disabled={busy}
            aria-label={`Sign in as ${member.display_name}`}
          >
            This is me — I have a PIN
          </button>
        ) : null}
        <button
          className="button button--quiet"
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
        >
          Edit
        </button>
        {canSetPin ? (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setSettingPin((open) => !open)}
            disabled={busy}
            aria-label={`${member.has_pin ? 'Reset' : 'Set'} PIN for ${member.display_name}`}
          >
            {member.has_pin ? 'Reset PIN' : 'Set PIN'}
          </button>
        ) : null}
        {confirmingRemove ? (
          <>
            <button
              className="button button--danger"
              type="button"
              onClick={() => onRemove(member.id)}
              disabled={busy}
            >
              Remove {member.display_name}?
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={busy}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
            aria-label={`Remove ${member.display_name}`}
          >
            Remove
          </button>
        )}
      </div>

      {signingIn ? (
        <form
          className="row row--end"
          onSubmit={(e) => {
            e.preventDefault()
            onSignIn(member.id, signInPin).then(
              () => {
                setSignInPin('')
                setSigningIn(false)
              },
              // Leave the form open and the digits in place on a refusal. The
              // database deliberately will not say whether the person or the PIN
              // was wrong, so the only useful thing this can do is let them try
              // again without retyping from scratch.
              () => {},
            )
          }}
        >
          <label className="field">
            <span className="field__label">PIN for {member.display_name}</span>
            <input
              className="field__input field__input--code"
              type="password"
              value={signInPin}
              onChange={(e) => setSignInPin(e.target.value)}
              placeholder="4 digits or more"
              inputMode="numeric"
              autoComplete="current-password"
              minLength={PIN_MIN_LENGTH}
              maxLength={PIN_MAX_LENGTH}
              aria-label={`Enter PIN to sign in as ${member.display_name}`}
            />
          </label>
          <button className="button" type="submit" disabled={busy || !isValidPin(signInPin)}>
            Sign in
          </button>
        </form>
      ) : null}

      {settingPin ? (
        <form
          className="row row--end"
          onSubmit={(e) => {
            e.preventDefault()
            onSetPin(member.id, pin).then(
              () => {
                setPin('')
                setSettingPin(false)
              },
              () => {},
            )
          }}
        >
          <label className="field">
            <span className="field__label">
              {member.has_pin ? 'New PIN' : 'PIN'} for {member.display_name}
            </span>
            <input
              className="field__input field__input--code"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4 digits or more"
              inputMode="numeric"
              autoComplete="new-password"
              minLength={PIN_MIN_LENGTH}
              maxLength={PIN_MAX_LENGTH}
              aria-label={`PIN for ${member.display_name}`}
            />
          </label>
          <button className="button" type="submit" disabled={busy || !isValidPin(pin)}>
            Save PIN
          </button>
        </form>
      ) : null}
    </li>
  )
}

MemberRow.propTypes = {
  member: PropTypes.object.isRequired,
  override: PropTypes.object,
  isMe: PropTypes.bool,
  canClaim: PropTypes.bool,
  canSignIn: PropTypes.bool,
  onSignIn: PropTypes.func,
  canSetPin: PropTypes.bool,
  onSetPin: PropTypes.func,
  busy: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onClaim: PropTypes.func.isRequired,
  onSetCapacity: PropTypes.func.isRequired,
  onClearCapacity: PropTypes.func.isRequired,
}

/**
 * AC 1 asks for a credential the organizer can "read out **or send**".
 *
 * Reading it out is the paper case and needs no affordance. Sending it does:
 * on a phone, selecting eight monospace characters by long-press is exactly the
 * interaction that produces a typo, and a typo here is indistinguishable from a
 * wrong code because the server deliberately refuses both identically.
 *
 * Web Share is offered where it exists, since it reaches the messaging app the
 * family actually uses; clipboard is the fallback, and where neither exists the
 * code is still on screen and selectable, so nothing is lost.
 */
function ShareCode({ household }) {
  const [said, setSaid] = useState(null)

  const message = `Join our Taskr household "${household.name}" with code ${household.join_code}`

  async function share() {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text: message })
        return
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(household.join_code)
        setSaid('Code copied.')
        return
      }
      setSaid('Select the code above to copy it.')
    } catch {
      // A cancelled share rejects, and so does a clipboard blocked by
      // permissions. Neither is an error worth a red banner — the code is on
      // screen either way.
      setSaid('Select the code above to copy it.')
    }
  }

  return (
    <>
      <button className="button button--quiet" type="button" onClick={share}>
        Copy or send code
      </button>
      {/* Polite, so it is announced without interrupting whatever is being read. */}
      <span className="card__note" role="status">
        {said}
      </span>
    </>
  )
}

ShareCode.propTypes = {
  household: PropTypes.object.isRequired,
}

export default function Roster({
  household,
  members,
  me,
  isOrganizer,
  onSetPin,
  onSignIn,
  busy,
  error,
  onAdd,
  onSave,
  onRemove,
  onClaim,
  onRefresh,
  overrides = [],
  periodStart = null,
  onSetCapacity,
  onClearCapacity,
}) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState('')

  // The BASELINE total, deliberately unchanged by #46. It answers "how much time
  // does this household usually have", which is a different question from what
  // it has this week — and the week's figure belongs beside each person, where
  // the override was set, rather than aggregated into a headline nobody set.
  const totalMinutes = members.reduce((sum, m) => sum + (m.weekly_minutes || 0), 0)

  // At most one override per person per period — the unique constraint in 0005
  // guarantees it, so `find` is exact rather than a first-match approximation.
  //
  // Matched on the PERIOD as well as the person, and that is not belt-and-braces.
  // `listCapacity` queries by period so every row here should already belong to
  // this week — but `capacitiesFor` filters again for exactly this reason, and a
  // first version of this line did not, which meant the roster showed an
  // override the load figures on the chore screen correctly ignored. Two answers
  // to one question on one screen, both plausible. That is the fault
  // capacity.js's own docstring calls invisible, and it was caught here by a
  // test whose fixture happened to name a different week.
  const overrideFor = (memberId) =>
    overrides.find((o) => o.member_id === memberId && o.period_start === periodStart)

  return (
    <div className="roster">
      <section className="card" aria-labelledby="code-heading">
        <h2 id="code-heading" className="card__heading">
          {household.name}
        </h2>
        <p className="card__body">
          Join code — read this out to a phone that needs to join.
        </p>
        <p className="joincode" data-testid="join-code">
          {household.join_code}
        </p>
        <ShareCode household={household} />
        <p className="card__note">
          Anyone with this code can see and change the household. It is deterrence, not
          a lock.
        </p>
      </section>

      <section className="card" aria-labelledby="roster-heading">
        <div className="row row--between">
          <h2 id="roster-heading" className="card__heading">
            Who is in the household
          </h2>
          <button className="button button--quiet" type="button" onClick={onRefresh} disabled={busy}>
            Refresh
          </button>
        </div>

        {members.length === 0 ? (
          <p className="card__body">
            Nobody yet. Add the first person below — everyone needs their real available
            minutes, because the split is proportional to them.
          </p>
        ) : (
          <ul className="member-list">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isMe={me?.id === member.id}
                // Only offer "this is me" when this device is not already
                // someone, and the person is unclaimed. The server refuses a
                // double claim regardless; this just avoids offering a button
                // whose only outcome is an error.
                // A person with a PIN is claimed by proving you are them, which
                // is the sign-in flow — claim_member refuses them outright, so
                // offering the button here would only produce an error.
                canClaim={!me && !member.claimed_by && !member.has_pin}
                // The other side of that coin, and its absence was the bug
                // (#63): a person WITH a PIN is claimed by proving you are
                // them. Without this the two conditions between them offered
                // nothing at all to anyone holding a credential.
                canSignIn={!me && !member.claimed_by && Boolean(member.has_pin) && Boolean(onSignIn)}
                onSignIn={onSignIn}
                canSetPin={Boolean(isOrganizer && onSetPin)}
                onSetPin={onSetPin}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
                onClaim={onClaim}
                override={overrideFor(member.id)}
                onSetCapacity={onSetCapacity}
                onClearCapacity={onClearCapacity}
              />
            ))}
          </ul>
        )}

        {members.length > 0 ? (
          <p className="card__note" data-testid="roster-total">
            {members.length} {members.length === 1 ? 'person' : 'people'} ·{' '}
            {totalMinutes} min/week between them
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="add-heading">
        <h2 id="add-heading" className="card__heading">
          Add someone
        </h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            onAdd({ displayName: name, weeklyMinutes: minutes || 0 }).then(
              () => {
                setName('')
                setMinutes('')
              },
              () => {},
            )
          }}
        >
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field__label">Available minutes per week</span>
            <input
              className="field__input"
              type="number"
              min="0"
              max="10080"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="120"
            />
          </label>
          <button className="button" type="submit" disabled={busy || !name.trim()}>
            Add to household
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

Roster.propTypes = {
  household: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
  me: PropTypes.object,
  isOrganizer: PropTypes.bool,
  onSetPin: PropTypes.func,
  onSignIn: PropTypes.func,
  busy: PropTypes.bool,
  error: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onClaim: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  overrides: PropTypes.array,
  periodStart: PropTypes.string,
  onSetCapacity: PropTypes.func.isRequired,
  onClearCapacity: PropTypes.func.isRequired,
}
