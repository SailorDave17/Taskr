import { useState } from 'react'
import PropTypes from 'prop-types'
import { formatMinutes } from '../lib/household.js'

// The roster — ACs 2 and 4 (a person with a budget, edited or removed, and the
// change is what every other device shows on next load) and the "pick yourself"
// half of AC 5.
//
// Minutes are entered as minutes, not hours, because that is the unit the whole
// app reasons in: chores are minutes of work and a budget is minutes available.
// Showing "2h 0m" beside the field is a reading aid; the stored value is the
// number that was typed.

function MemberRow({ member, isMe, canClaim, busy, onSave, onRemove, onClaim }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.display_name)
  const [minutes, setMinutes] = useState(String(member.weekly_minutes))
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
        <button
          className="button button--quiet"
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
        >
          Edit
        </button>
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
    </li>
  )
}

MemberRow.propTypes = {
  member: PropTypes.object.isRequired,
  isMe: PropTypes.bool,
  canClaim: PropTypes.bool,
  busy: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onClaim: PropTypes.func.isRequired,
}

export default function Roster({
  household,
  members,
  me,
  busy,
  error,
  onAdd,
  onSave,
  onRemove,
  onClaim,
  onRefresh,
}) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState('')

  const totalMinutes = members.reduce((sum, m) => sum + (m.weekly_minutes || 0), 0)

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
                canClaim={!me && !member.claimed_by}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
                onClaim={onClaim}
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
  busy: PropTypes.bool,
  error: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onClaim: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
}
