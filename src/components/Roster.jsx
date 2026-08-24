import { useState } from 'react'
import PropTypes from 'prop-types'
import { formatMinutes } from '../lib/household.js'
import {
  MAX_CAPACITY_MINUTES,
  MIN_CAPACITY_MINUTES,
  effectiveCapacity,
  normalizeCapacityMinutes,
} from '../lib/capacity.js'
import { connectionFor, isRealEmailMember } from '../lib/calendar.js'

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

/**
 * Connect a Google Calendar, or say that one is connected — #95 AC 1 and AC 5.
 *
 * WHO SEES IT, WHICH IS THE WHOLE OF AC 1
 *
 * Only the signed-in member's OWN row, and only when that member has a real
 * email address. Both halves matter and they fail differently:
 *
 * - Somebody else's row would offer to connect a calendar the person holding the
 *   phone cannot consent to. Google would sign THEM in and attach THEIR calendar
 *   to a housemate's roster entry, which is a wrong answer that looks like a
 *   right one all the way to the end.
 * - A PIN member — `members.email` null, the discriminator `0007` established —
 *   has no Google identity to consent with. There is no version of this that
 *   could work for them, so the control is ABSENT rather than disabled: a
 *   disabled button is a promise the app cannot keep, and it invites a household
 *   to go looking for the setting that would enable it.
 *
 * The Edge Function refuses a PIN member as well, and that refusal is the real
 * boundary. This is manners — the same relationship `SignInControl` has to the
 * organizer check below it.
 *
 * Connected state is read from the SERVER (`calendar_connections`, through
 * App's refresh), never remembered locally, so a second phone shows it too.
 */
function CalendarControl({ member, connection, busy, onConnect }) {
  if (!isRealEmailMember(member)) return null

  if (connection) {
    return (
      <span className="member__calendar" data-testid={`calendar-${member.id}`}>
        Calendar connected
      </span>
    )
  }

  return (
    <span className="member__calendar" data-testid={`calendar-${member.id}`}>
      <button className="button button--quiet" type="button" onClick={onConnect} disabled={busy}>
        Connect Google Calendar
      </button>
    </span>
  )
}

CalendarControl.propTypes = {
  member: PropTypes.object.isRequired,
  connection: PropTypes.object,
  busy: PropTypes.bool,
  onConnect: PropTypes.func.isRequired,
}

/**
 * Give somebody a way to sign in, or replace the one they forgot — #87 AC 6.
 *
 * Organizer-only, because the Edge Function refuses anybody else and a control
 * that renders for a person who will always be refused is a promise the app
 * cannot keep. The refusal is still the real boundary; this is manners.
 *
 * The organizer types the credential and tells the person out loud (owner
 * decision, #87): a household already understands "your PIN is 1234", and the
 * alternative — generating one and showing it once — needs a surface that
 * displays a secret exactly once and a recovery path for the organizer who
 * looks away. Reset uses this identical control, which is why the copy is the
 * only thing that changes between the two states.
 */
function SignInControl({ member, busy, onProvision }) {
  const [editing, setEditing] = useState(false)
  const [secret, setSecret] = useState('')
  const [complaint, setComplaint] = useState(null)

  const hasSignIn = Boolean(member.claimed_by)

  function open() {
    setSecret('')
    setComplaint(null)
    setEditing(true)
  }

  function close() {
    setComplaint(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        className="button button--quiet"
        type="button"
        onClick={open}
        disabled={busy}
        data-testid={`provision-${member.id}`}
        aria-label={
          hasSignIn
            ? `Reset the sign-in for ${member.display_name}`
            : `Give ${member.display_name} a way to sign in`
        }
      >
        {hasSignIn ? 'Reset sign-in' : 'Give a sign-in'}
      </button>
    )
  }

  return (
    <form
      className="stack member__signin-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        // The same floor the Edge Function enforces and the data layer restates.
        // Checked here so the person gets the sentence before a round trip, not
        // instead of the server check — the server is still what refuses.
        if (secret.length < 6) {
          setComplaint('Use at least 6 characters, so it is not guessable.')
          return
        }
        setComplaint(null)
        onProvision(member.id, secret, hasSignIn).then(close, () => {})
      }}
    >
      <label className="field">
        <span className="field__label">
          {hasSignIn ? `New PIN for ${member.display_name}` : `PIN for ${member.display_name}`}
        </span>
        <input
          className="field__input"
          type="text"
          value={secret}
          autoComplete="off"
          data-testid={`provision-input-${member.id}`}
          onChange={(e) => setSecret(e.target.value)}
        />
      </label>
      {/* Said once, here, rather than in a note somewhere else on the screen:
          this is the moment the organizer needs to know the person never sees
          an email, because it is the moment they decide what to tell them. */}
      <p className="card__note">
        Tell {member.display_name} this — they sign in with their name and this
        PIN. No email is sent, and nobody can look it up later.
      </p>
      {complaint ? (
        <p className="error" role="alert">
          {complaint}
        </p>
      ) : null}
      {/* Plain `.row`, deliberately WITHOUT the button-stretch opt-in the
          action rows carry. gate.test.js counts that class and requires exactly
          one per screen, because it was measured on a single row at phone width
          (#82); taking it here would inherit a treatment nobody measured for
          this form. The class is not named in this comment on purpose — the
          check counts raw occurrences in the source, so writing it here would
          trip the very guard being explained. */}
      <div className="row">
        <button className="button button--quiet" type="button" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className="button" type="submit" disabled={busy}>
          {hasSignIn ? 'Reset it' : 'Give the sign-in'}
        </button>
      </div>
    </form>
  )
}

SignInControl.propTypes = {
  member: PropTypes.object.isRequired,
  busy: PropTypes.bool,
  onProvision: PropTypes.func.isRequired,
}

function MemberRow({
  member,
  override,
  isMe,
  busy,
  isOrganizer,
  onSave,
  onRemove,
  onProvision,
  onSetCapacity,
  onClearCapacity,
  connection,
  onConnectCalendar,
}) {
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
        {/* Whether this person can get in yet — #62.

            `claimed_by` is now identity rather than "which phone is holding
            this row", so its absence means something a household can act on: no
            account exists for them, and until one does they are a name on a
            roster who cannot sign in. Saying so on the row is the honest version
            of a screen that used to offer a "Set PIN" button here; the button is
            gone because the thing behind it is gone, and hiding the state
            entirely would leave the organizer wondering why nothing happens. */}
        <span className="member__access" data-testid={`access-${member.id}`}>
          {member.claimed_by ? 'Signed in' : 'No sign-in yet'}
        </span>
        {/* #87 — the row stops merely REPORTING the gap and gains the thing
            that closes it. Organizer-only: the Edge Function refuses anybody
            else, and offering a control that is always refused is worse than
            not offering one. */}
        {isOrganizer && onProvision ? (
          <SignInControl member={member} busy={busy} onProvision={onProvision} />
        ) : null}
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
        {/* #95 — the calendar sits directly under this week's minutes, because
            that is the number it exists to inform (#96 turns the connection into
            a suggested busy figure here). Own row only, and only for a member
            who has an address to consent with; the control returns null
            otherwise, so a PIN member's row is unchanged rather than showing a
            disabled affordance. */}
        {isMe && onConnectCalendar ? (
          <CalendarControl
            member={member}
            connection={connection}
            busy={busy}
            onConnect={onConnectCalendar}
          />
        ) : null}
      </div>

      <div className="row row--end row--actions">
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

      {/* The sign-in and Set-PIN forms stood here until #62.
          
          Both are gone with the RPCs behind them. A member no longer proves who
          they are to the ROSTER — they sign in on the sign-in screen, as
          themselves, and arrive already being that person. The status line above
          is what is left: it reports whether an account exists, which is the only
          part of this a household member can act on. */}
    </li>
  )
}

MemberRow.propTypes = {
  isOrganizer: PropTypes.bool,
  onProvision: PropTypes.func,
  member: PropTypes.object.isRequired,
  override: PropTypes.object,
  isMe: PropTypes.bool,
  busy: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onSetCapacity: PropTypes.func.isRequired,
  onClearCapacity: PropTypes.func.isRequired,
  connection: PropTypes.object,
  onConnectCalendar: PropTypes.func,
}

// `ShareCode` stood here until #62 — a button that copied or sent the household's
// eight-character join code, because AC 1 asked for a credential the organizer
// could "read out or send".
//
// It went with the credential. There is no code to send: admission is an account
// the organizer provisions for one named person, not a secret that works for
// whoever repeats it. The affordance was real and the reasoning behind it still
// holds for anything code-shaped — selecting eight monospace characters by
// long-press on a phone is exactly the interaction that produces a typo — so it
// is recorded here rather than deleted silently, in case a shareable invite ever
// comes back.

export default function Roster({
  household,
  members,
  me,
  isOrganizer,
  busy,
  error,
  onAdd,
  onSave,
  onRemove,
  onProvision,
  onRefresh,
  onSignOut,
  overrides = [],
  periodStart = null,
  onSetCapacity,
  onClearCapacity,
  connections = [],
  onConnectCalendar,
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
      <section className="card" aria-labelledby="household-heading">
        <div className="row row--between">
          <h2 id="household-heading" className="card__heading">
            {household.name}
          </h2>
          {/* A way out, which device auth never needed: the session WAS the
              phone, so signing out of it meant nothing and there was nothing to
              sign back in as. Now the session is a person, and a family sharing
              one tablet needs to hand it over without handing over an identity.
              Also the only way to correct a sign-in as the wrong person. */}
          {onSignOut ? (
            <button
              className="button button--quiet"
              type="button"
              onClick={onSignOut}
              disabled={busy}
            >
              Sign out
            </button>
          ) : null}
        </div>
        {/* The join code lived here, with a note conceding it was "deterrence,
            not a lock". #62 is what replaced it: everyone signs in as
            themselves, so a household is no longer only as private as the least
            careful person holding a shared code.

            That note conceded provisioning was not built and told the organizer
            to expect "No sign-in yet" with no way to fix it. #87 built it, so
            the note is GONE rather than reworded: an honest placeholder that
            outlives the gap it describes becomes a lie that reads as
            documentation, and this one would have sent an organizer looking for
            a tool that is now sitting on the row in front of them. The
            replacement is not prose — it is the control itself. */}
        {isOrganizer ? (
          <p className="card__note" data-testid="provisioning-note">
            Add people here, then give each of them a sign-in from their row.
            They sign in with their own name and a PIN you set — tell them what
            it is, because no email is sent.
          </p>
        ) : null}
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
                // "This is me", "I have a PIN" and "Set PIN" were all passed in
                // here until #62, each gated on a different combination of
                // `claimed_by` and `has_pin`. None survives: you do not pick
                // yourself off a list any more, you sign in, and you arrive
                // already being somebody. The row's only remaining say in
                // identity is reporting whether an account exists.
                busy={busy}
                isOrganizer={isOrganizer}
                onSave={onSave}
                onRemove={onRemove}
                onProvision={onProvision}
                override={overrideFor(member.id)}
                onSetCapacity={onSetCapacity}
                onClearCapacity={onClearCapacity}
                // #95 — resolved through `connectionFor` rather than by a local
                // `find`, so the roster and any later consumer agree on what
                // "connected" means by construction. The unique constraint in
                // `0011` is what makes at most one row exact rather than a
                // first-match approximation, the same argument as `overrideFor`
                // above.
                connection={connectionFor(connections, member.id)}
                onConnectCalendar={onConnectCalendar}
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
  busy: PropTypes.bool,
  error: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onProvision: PropTypes.func,
  onRefresh: PropTypes.func.isRequired,
  onSignOut: PropTypes.func,
  overrides: PropTypes.array,
  periodStart: PropTypes.string,
  onSetCapacity: PropTypes.func.isRequired,
  onClearCapacity: PropTypes.func.isRequired,
  connections: PropTypes.array,
  onConnectCalendar: PropTypes.func,
}
