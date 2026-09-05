import { useState } from 'react'
import PropTypes from 'prop-types'
import { formatMinutes, signInAddressFor } from '../lib/household.js'
import {
  MAX_CAPACITY_MINUTES,
  MIN_CAPACITY_MINUTES,
  effectiveCapacity,
  normalizeCapacityMinutes,
} from '../lib/capacity.js'
import { busyComputedLabel, busyWeekFor, connectionFor, isRealEmailMember } from '../lib/calendar.js'
import CaptureShell from './CaptureShell.jsx'
import { CAPTURE_OUTCOMES, isFirstPerson } from '../lib/capture.js'

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
 *   the charter requires on day one and the extraction bet (#210) is an
 *   accelerator on top of it, never the only way in.
 *
 * `effectiveCapacity` is called rather than reimplemented — #44 AC 7's rule, and
 * `capacity.test.js` asserts there is exactly one implementation across all of
 * `src/`. The same call is what makes the chore screen's load figures follow
 * this week without any change there.
 *
 * #210 PUTS A SENTENCE IN FRONT OF THE NUMBER, AND CHANGES NOTHING BEHIND IT.
 *
 * The editor gains a description box (the shared `CaptureShell`) ABOVE the
 * minutes field, and a proposal is a PREFILL of that field — never a write.
 * The write is still this form's one submit, `onSet`, and the only thing
 * that travels with it now is where the figure came from (`source`), so a
 * proposed and a typed capacity reach `setCapacity` through the same call
 * with one word different (AC 6, AC 9). Nothing is stored between the
 * proposal and the save: cancel, leave, or reload, and the period's capacity
 * is whatever it was (AC 3).
 *
 * `onPropose` is OPTIONAL, and that is the fallback proof made structural
 * (AC 7): a roster rendered without it is exactly the #46 editor, and every
 * #46 test renders it that way. The manual field is inside the shell as its
 * children, so it is on screen before, during and after any description —
 * a failure moves the box out of the way and focuses the field; it never
 * reveals it.
 *
 * `takeProposal` is the one seam the calendar proposer (#97) reads: a figure,
 * a source, and what it was derived from. Whichever proposer ships second
 * arrives here rather than adding a second write path — owner decision at
 * the filing gate, 2026-08-26.
 */
function CapacityControl({ member, override, busy, onSet, onClear, onPropose }) {
  const [editing, setEditing] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [complaint, setComplaint] = useState(null)
  // #210 — where the figure in the field came from. 'manual' until a proposal
  // is taken, and reset on every open like the minutes are. Travels with the
  // write (AC 6) and is named on screen (AC 9).
  const [source, setSource] = useState('manual')

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
    setSource('manual')
    setComplaint(null)
    setEditing(true)
  }

  function close() {
    setComplaint(null)
    setEditing(false)
  }

  /**
   * Take a proposal into the field — #210 AC 1. A prefill and a source, and
   * deliberately not a write: the member is looking at a number they have
   * not yet agreed to, and a submit is where they agree. Editing it first
   * keeps the source (AC 6): a figure the member corrected is still a figure
   * the description produced, and allocate never sees the difference.
   *
   * Called the moment a proposal ARRIVES, not on a separate tap — design-bar
   * verdict at #210's step 6 (owner, 2026-09-04): accepting was two taps,
   * and the source line appearing between them moved Save 54px under the
   * thumb. Now the figure lands in the field with its source named, the
   * card's button is a second submit of this same form reading the live
   * figure, and one tap accepts. The layout settles while the member is
   * reading, not while they are pressing.
   */
  function takeProposal({ minutes: proposed, source: from }) {
    setMinutes(String(proposed))
    setSource(from)
    setComplaint(null)
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

  // The #46 field, unchanged. Rendered inside the shell when there is a
  // proposer and bare when there is not, so the manual road in is the same
  // element either way.
  const manualField = (
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
  )

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
        onSet(member.id, minutes, source).then(close, () => {})
      }}
    >
      {onPropose ? (
        <CaptureShell
          label={`Describe this week for ${member.display_name}`}
          placeholder="About three hours, mostly at the weekend"
          describeLabel="Work out the minutes"
          manualHint="Type the minutes instead."
          busy={busy}
          onDescribe={async (text) => {
            const result = await onPropose(member, text)
            if (result?.outcome === CAPTURE_OUTCOMES.PROPOSAL) {
              takeProposal({ minutes: result.minutes, source: 'extraction' })
            }
            return result
          }}
          renderProposal={(proposal) => (
            <>
              <p className="capture__figure" data-testid={`proposal-${member.id}`}>
                Proposed: {proposal.minutes} min
                <span className="member__budget-human"> ({formatMinutes(proposal.minutes)})</span>
              </p>
              {/* What it was derived from (AC 1): the person the endpoint read
                  the figure for. Shown only when that is a NAME — "me: 180
                  min" under "Proposed: 180 min" told the member nothing twice
                  (design-bar, 2026-09-04). The contract carries a number per
                  person and no phrase, so this is the whole of the provenance
                  a phone can show today; #208 is asked to carry the phrase. */}
              {isFirstPerson(proposal.derivedFrom.who) ? null : (
                <p className="capture__derived">
                  Read as “{proposal.derivedFrom.who}: {proposal.derivedFrom.minutes} min” from
                  what you wrote.
                </p>
              )}
              {/* A SUBMIT of the enclosing form — the same onSubmit the Save
                  below runs, so accepting is one tap and still one write path
                  (AC 9). The label reads the FIELD, not the proposal: edit the
                  figure first and the button says what it will save. */}
              <button
                className="button"
                type="submit"
                disabled={busy}
                aria-label={`Save the proposed figure for ${member.display_name}`}
              >
                Save {minutes} min from your description
              </button>
            </>
          )}
        >
          {manualField}
        </CaptureShell>
      ) : (
        manualField
      )}
      {source === 'manual' ? null : (
        <p className="member__week-source" data-testid={`week-source-${member.id}`}>
          {sourceLabel(source)} Change the number if it is wrong, then save.
        </p>
      )}
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
  onPropose: PropTypes.func,
}

/**
 * The source, named on screen — #210 AC 9. One sentence per proposer, so a
 * member reads where the number in the field came from before they save it.
 * `calendar` is #97's; it is here so that story adds a proposer and not a
 * second confirm surface.
 */
function sourceLabel(source) {
  if (source === 'extraction') return 'From your description.'
  if (source === 'calendar') return 'From your calendar.'
  return `From ${source}.`
}

/**
 * What the calendar says about this week, beside the number it informs — #96.
 *
 * A READOUT AND NOTHING ELSE. It has no control, writes nothing, and sits next
 * to the manual input rather than inside it: AC 4 says nothing is written to
 * `member_capacity`, and the thinnest way to be sure of that is a component with
 * no handler to call. Applying the suggestion is #97's story and arrives here as
 * a prefill on the editor above.
 *
 * The date is always shown, not only when something went wrong. This story
 * fetches a week ONCE — staleness is #98's — so a figure read on Monday is still
 * on screen on Friday, and a number presented without its age would be claiming
 * a freshness it does not have.
 *
 * AC 5 is the second branch: when Google could not be read, the last figure
 * stays exactly where it was with its date, and the sentence goes underneath.
 * Nothing is cleared and nothing is zeroed — a confident zero is the harmful
 * version of handling this error, because zero busy minutes is a perfectly
 * plausible week and nobody would question it.
 *
 * THE SENTENCE IS RENDERED UNCHANGED, and that is a decision the design-bar pass
 * of 2026-09-04 reversed. It was prefixed with "Couldn’t read that calendar — ",
 * which read on a 360px screen as *"Couldn’t read that calendar — That calendar
 * connection is no longer valid. Connect it again."*: one fact told twice, three
 * wrapped lines, and the only actionable clause at the end of the third. Every
 * sentence that reaches here already names the calendar or Google — the Edge
 * Function distinguishes a revoked connection from an unreachable Google from a
 * missing configuration, and `fetchBusyWeek` reads that sentence off the
 * function's own body rather than the SDK's generic one. A wrapper around a
 * sentence chosen that carefully is a wrapper that can only blur it.
 *
 * `role="status"` is a POLITE live region, which is right for a sentence that
 * appears after the screen has settled — and it is deliberately not the only way
 * to find this element. The roster already carries a `role="status"` (the
 * no-organizer note), so a document-wide query by role is ambiguous on this
 * screen: the testid is what lets a test name THIS one. Found by a test that
 * asserted the absence of any status region and matched the other one instead.
 */
function BusyReadout({ busyWeek, complaint, timeZone }) {
  if (!busyWeek && !complaint) return null
  const read = busyWeek ? busyComputedLabel(busyWeek.computed_at, timeZone) : null

  return (
    <div className="member__busy">
      {busyWeek ? (
        <span className="member__busy-figure" data-testid={`busy-${busyWeek.member_id}`}>
          Calendar suggests: {busyWeek.busy_minutes} min busy
          <span className="member__budget-human"> ({formatMinutes(busyWeek.busy_minutes)})</span>
          {read ? <span className="member__busy-read"> · read {read}</span> : null}
        </span>
      ) : null}
      {complaint ? (
        <span className="member__busy-complaint" role="status" data-testid="busy-complaint">
          {complaint}
        </span>
      ) : null}
    </div>
  )
}

BusyReadout.propTypes = {
  busyWeek: PropTypes.object,
  complaint: PropTypes.string,
  timeZone: PropTypes.string,
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
          this is the moment the organizer decides what to tell them, so it is
          the moment they need BOTH halves of the credential.

          Until #242 this sentence said they sign in with their NAME and this
          PIN. That was false from the day #62 landed — `signIn` is
          `signInWithPassword`, so the address is half the credential and no
          name-based lookup has ever existed. An organizer following it handed
          over a name and a PIN, and the person could not get in: the address
          the account was minted at is a UUID that appeared on no screen. */}
      <p className="card__note" data-testid={`provision-address-${member.id}`}>
        Tell {member.display_name} both of these — they sign in with{' '}
        <strong>{signInAddressFor(member)}</strong> and this PIN. No email is
        sent, and nobody can look the PIN up later.
      </p>
      {isRealEmailMember(member) ? null : (
        <p className="card__note">
          That address is one Taskr made up, because {member.display_name} has no
          email on their row. It works, and it is long — give them an address
          above and this becomes something they can type.
        </p>
      )}
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
  onProposeCapacity,
  connection,
  onConnectCalendar,
  busyWeek,
  busyComplaint,
  timeZone,
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.display_name)
  const [minutes, setMinutes] = useState(String(member.weekly_minutes))
  const [email, setEmail] = useState(member.email ?? '')
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  function cancel() {
    setName(member.display_name)
    setMinutes(String(member.weekly_minutes))
    setEmail(member.email ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="member member--editing">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            onSave(member.id, {
              displayName: name,
              weeklyMinutes: minutes,
              email,
            }).then(
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
          {/* #242 — `0007` granted this column as updatable and argued for it in
              as many words ("an organizer correcting a typo in an address is
              ordinary roster maintenance"); nothing has ever been able to write
              through that grant. It is here as well as on the add form because
              the row that most needs an address is one added before there was a
              field to type it into.

              On a member who already has a sign-in this changes the ROSTER, not
              the account: `provision-member` reads this column when it mints and
              refuses once `claimed_by` is set, so an address already in use is
              only movable in the Supabase dashboard. The note below says so
              rather than leaving the organizer to find out by being locked
              out. */}
          <label className="field">
            <span className="field__label">Email address</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="Leave blank if they have none"
              aria-label={`Email address for ${member.display_name}`}
            />
          </label>
          {member.claimed_by ? (
            <p className="card__note">
              {member.display_name} already has a sign-in, so changing this does
              not change the address they sign in with — that one is fixed at the
              moment the sign-in was given.
            </p>
          ) : null}
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
          onPropose={onProposeCapacity}
        />
        {/* #96 — directly under this week's minutes, which is the number it
            exists to inform. Own row only for the COMPLAINT (it is about a read
            this device attempted), household-wide for the FIGURE: the derived
            rows are readable by everybody `0030`'s policy scopes them to, the
            same way a housemate's weekly minutes have always been. */}
        <BusyReadout
          busyWeek={busyWeek}
          complaint={isMe ? busyComplaint : null}
          timeZone={timeZone}
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
        {/* #152 — Remove is the organizer's alone, and Edit deliberately is not.
            That asymmetry is a decision, not an oversight, so it is stated here
            rather than left for a reader to infer from the absence of a gate:
            editing a name or a weekly-minutes figure is ordinary household
            maintenance anybody may do and anybody can undo, while removing a
            member is destructive, has no undo, and — when the member removed is
            the organizer — ends provisioning for that household permanently,
            because `create_household` is the only thing that ever writes
            `organizer_member_id`.

            This is NOT the guard. `members_delete_same_household` (0016) is,
            and it refuses the same delete with no client involved. Offering a
            control that the database would refuse is the thing #87 already
            decided against one gate up, on the sign-in control at the top of
            this row: a control that is always refused is worse than no control.

            `isMe` is part of the same rule for that reason, not a separate one.
            0007 refuses SELF-removal from every caller including the organizer,
            so a Remove on your own row is a button the database will always
            turn down. Hiding it is the same decision as hiding it from a
            non-organizer, applied to the other clause of the same policy. */}
        {!isOrganizer || isMe ? null : confirmingRemove ? (
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
  onProposeCapacity: PropTypes.func,
  connection: PropTypes.object,
  onConnectCalendar: PropTypes.func,
  busyWeek: PropTypes.object,
  busyComplaint: PropTypes.string,
  timeZone: PropTypes.string,
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
  onProposeCapacity,
  connections = [],
  onConnectCalendar,
  busyWeeks = [],
  busyComplaint = null,
}) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState('')
  const [email, setEmail] = useState('')
  // #291 — the second sign-out is two taps, matching the Remove idiom below.
  // Not because it is destructive to data (it is not) but because it is
  // destructive to a session you are not holding: the point of pressing it is
  // to end a session on a device that is not in front of you, and a mis-tap
  // ends one that is.
  const [confirmingSignOutAll, setConfirmingSignOutAll] = useState(false)

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
          {/* #291 put a second control beside it, so the pair sits in a bare
              `.row` — deliberately WITHOUT #82's wrapped-line stretch opt-in.
              That class is a measured decision, held by gate.test.js to one
              row per screen (which is why it is not spelled in this comment:
              the guard is a raw text scan). This header was never part of that
              measurement, and borrowing the opt-in would widen a stretch rule
              onto a row nobody measured — the thing #82's own comment refuses.
              Plain `.row` already gives flex, wrap and the gap. */}
          {onSignOut ? (
            <div className="row">
              <button
                className="button button--quiet"
                type="button"
                onClick={() => onSignOut({ everywhere: false })}
                disabled={busy}
              >
                Sign out
              </button>
              {/* #291 — the lost-or-stolen-device answer, and the ONLY control
                  in the app that ends a session on a device the person is not
                  holding. It sits beside the ordinary one rather than behind a
                  settings screen because the moment somebody needs it they are
                  not browsing; they have just realised where their phone is
                  not. Confirm-in-place, like Remove: the mistake this guards
                  against is pressing the wrong one of two adjacent buttons. */}
              {confirmingSignOutAll ? (
                <>
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={() => onSignOut({ everywhere: true })}
                    disabled={busy}
                  >
                    Sign out on every device?
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => setConfirmingSignOutAll(false)}
                    disabled={busy}
                  >
                    Keep them
                  </button>
                </>
              ) : (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => setConfirmingSignOutAll(true)}
                  disabled={busy}
                >
                  Sign out everywhere
                </button>
              )}
            </div>
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
            Add people here with their email address, then give each of them a
            sign-in from their row. They sign in with that address and a PIN you
            set — tell them the PIN yourself, because no email is sent.
          </p>
        ) : null}
        {/* #152 — a household whose organizer row is gone. 0016 stops this being
            created from now on; it cannot repair one that already exists,
            because `create_household` is the only thing that ever writes
            `organizer_member_id` and there is no route to it from any client.

            Said plainly rather than left to be inferred from controls quietly
            not appearing. Without this the screen renders as an ordinary roster
            with the organizer's tools missing, which reads as a permissions bug
            in the app — so somebody would go looking for the fault in the wrong
            place. `role="status"`, not `alert`: nothing is happening right now,
            it is a standing condition. */}
        {household && !household.organizer_member_id ? (
          <p className="card__note" role="status" data-testid="no-organizer-note">
            This household has no organizer, so nobody can be given a sign-in or
            have one reset. That cannot be fixed from inside the app — it needs
            somebody with database access to name an organizer again.
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
                // #210 — optional, and its absence is the manual floor: a
                // roster with no proposer wired renders the #46 editor exactly.
                onProposeCapacity={onProposeCapacity}
                // #95 — resolved through `connectionFor` rather than by a local
                // `find`, so the roster and any later consumer agree on what
                // "connected" means by construction. The unique constraint in
                // `0011` is what makes at most one row exact rather than a
                // first-match approximation, the same argument as `overrideFor`
                // above.
                connection={connectionFor(connections, member.id)}
                onConnectCalendar={onConnectCalendar}
                // #96 — resolved here for the reason `override` is: at most one
                // row per person per week (`0030`'s unique constraint), matched
                // on the PERIOD as well as the person so a figure from another
                // week cannot appear beside this week's minutes. That is the
                // exact fault a first version of `overrideFor` had.
                busyWeek={busyWeekFor(busyWeeks, member.id, periodStart)}
                busyComplaint={busyComplaint}
                timeZone={household.timezone}
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
            onAdd({ displayName: name, weeklyMinutes: minutes || 0, email }).then(
              () => {
                setName('')
                setMinutes('')
                setEmail('')
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
          {/* #242 — the field the sign-in has always needed and nothing ever
              collected. Optional, because a young child with no inbox is a real
              member of a real household and the synthetic address still works
              for them; the note says what leaving it blank costs, at the moment
              it is being decided.

              #191 makes an address mandatory and retires this whole add path in
              favour of an invitation. This is the interim, and it is deliberate:
              #191 lands behind #171, #172, #177 and the router in #175, and
              until then nobody can be admitted at all. */}
          <label className="field">
            <span className="field__label">Email address</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              autoComplete="off"
            />
          </label>
          <p className="card__note">
            This is what they type to sign in. Leave it blank only for somebody
            with no email of their own — Taskr will make an address up for them,
            and it is long and awkward to pass on.
          </p>
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
  onProposeCapacity: PropTypes.func,
  connections: PropTypes.array,
  onConnectCalendar: PropTypes.func,
  busyWeeks: PropTypes.array,
  busyComplaint: PropTypes.string,
}
