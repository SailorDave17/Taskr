import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { formatMinutes, signInAddressFor } from '../lib/household.js'
import {
  MAX_CAPACITY_MINUTES,
  MIN_CAPACITY_MINUTES,
  calendarSuggestion,
  effectiveCapacity,
  normalizeCapacityMinutes,
} from '../lib/capacity.js'
import { busyComputedLabel, busyWeekFor, connectionFor, isRealEmailMember } from '../lib/calendar.js'
import CaptureShell from './CaptureShell.jsx'
import Invitations from './Invitations.jsx'
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
 *
 * #97 IS THAT SECOND PROPOSER, AND IT ARRIVED HERE. The calendar readout
 * (`BusyReadout`, #96) now renders INSIDE this control rather than beside
 * it, because its one control — "Use this" — has to open this editor with the
 * field prefilled, and the editor's open/closed state lives here. The tap is
 * `takeProposal` with `max(0, baseline − busy)` (`calendarSuggestion`, the
 * owner's formula) and source `calendar`: a prefill the member reviews, never
 * a write. Save is where they agree, exactly as for a description.
 *
 * Two rules differ from #210's on purpose, and both are the issue's own:
 *
 * - **Editing a calendar figure makes it manual** (#97 AC 2), where editing
 *   a description's figure keeps `extraction` (#210 AC 6). A calendar figure
 *   is arithmetic on a number the member can see, so a changed figure is no
 *   longer the calendar's; a description's figure is an interpretation of
 *   what they wrote, so a corrected one is still derived from it. The source
 *   line follows the same rule: it names the calendar while the field holds
 *   the calendar's figure and goes quiet once it does not.
 * - **Anybody who can see the figure can take it** (owner decision at pickup,
 *   2026-09-05), where connecting a calendar is own-row only (#95). The
 *   suggestion is household-readable since #96 for the reason a housemate's
 *   weekly minutes always were, and this editor has never had a who-may-set
 *   gate — a housemate can already type any number here. The confirm tap and
 *   the provenance mark are what make the figure defensible, whoever tapped.
 *   The source line names WHOSE calendar for that reason: "your" on the
 *   member's own row, their name on a housemate's (review-fanout, 2026-09-05).
 *
 * THE EDITOR OPENS ON WHAT THE ROW SAYS (owner decision at the review
 * escalation, 2026-09-05). Until then `open()` seeded `source = 'manual'`
 * whatever the stored row carried, so re-opening a calendar week and pressing
 * Save unedited rewrote its provenance to `manual` — a typed figure recorded
 * for a number nobody typed, which is exactly what #57 AC 5's accuracy
 * question would later read. Now `open()` seeds the source AND the proposed
 * figure from the override, so an unedited re-save keeps the word and an edit
 * applies each proposer's own rule: a calendar figure edited becomes manual,
 * a description's stays extraction. The source line therefore reads on every
 * open of such a week, which is the honest state — the number in the field
 * IS the calendar's until the member changes it.
 */
function CapacityControl({
  member,
  override,
  isMe,
  busy,
  onSet,
  onClear,
  onPropose,
  busyWeek,
  busyComplaint,
  timeZone,
}) {
  const [editing, setEditing] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [complaint, setComplaint] = useState(null)
  // #210 — where the figure in the field came from. 'manual' until a proposal
  // is taken; since #97, seeded from the stored row on open (see the
  // docblock). Travels with the write (AC 6) and is named on screen (AC 9).
  const [source, setSource] = useState('manual')
  // #97 — the figure a proposal put in the field, so an edit can be told from
  // a confirm. Only the calendar rule reads it; see the docblock.
  const [proposed, setProposed] = useState(null)
  // #97 — remount the description shell when the calendar's figure is taken,
  // so a proposal card the member described a moment ago does not stand
  // beside the calendar's source line claiming the same field (review-fanout,
  // 2026-09-05: two provenance sentences on one screen at the confirm tap).
  // The shell owns its result and exposes no reset; a key bump is the seam.
  const [shellKey, setShellKey] = useState(0)
  // #97 — the tap can open the editor from closed, and on a 360×800 phone the
  // description shell then sits between the tap and the field it filled:
  // measured on the prototype, the field landed at y=892 and Save at y=1005
  // in an 800px viewport (design-bar, 2026-09-05). So the field is scrolled
  // into view once it exists, rather than the member being left looking at
  // the button they just pressed.
  const fieldRef = useRef(null)
  const [scrollRequest, setScrollRequest] = useState(0)

  const effective = effectiveCapacity(member, override)
  const isOverridden = Boolean(override)
  const suggestion = calendarSuggestion(member, busyWeek)

  // The source the SAVE carries, which for a calendar figure depends on
  // whether the field still holds what the calendar put there (#97 AC 2).
  // Compared as numbers, so "75" and "075" are the same confirm — but an
  // EMPTY field is never the calendar's figure: `Number('')` is 0, which is a
  // legal suggestion, and without the first clause clearing the field over a
  // zero prefill kept "From your calendar" on over nothing (review-fanout,
  // 2026-09-05). Any other non-number is refused by the normalizer first.
  const sourceToSave =
    source === 'calendar' && (String(minutes).trim() === '' || Number(minutes) !== proposed)
      ? 'manual'
      : source

  useEffect(() => {
    if (scrollRequest === 0) return
    // Guarded: jsdom has no scrollIntoView, and a test that renders this
    // control must not need one to exist.
    fieldRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [scrollRequest])

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
    // Seeded from the row, not reset to manual — see the docblock. A row with
    // no override, or a typed one, opens as manual with nothing proposed.
    const stored = override?.source
    if (stored && stored !== 'manual') {
      // #106 — an automatic week opens as the CALENDAR'S figure: the field
      // holds what the calendar put there, the source line names it, and the
      // editor's own vocabulary stays three words. Save unedited is the confirm
      // tap the person never made — the row becomes `calendar`, and
      // `setCapacity`'s null default clears `previous_minutes` — and an edit
      // applies #97 AC 2's rule and makes it manual.
      setSource(stored === 'calendar_auto' ? 'calendar' : stored)
      setProposed(Number(override.minutes))
    } else {
      setSource('manual')
      setProposed(null)
    }
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
  function takeProposal({ minutes: figure, source: from }) {
    setMinutes(String(figure))
    setProposed(figure)
    setSource(from)
    setComplaint(null)
  }

  /**
   * "Use this" on the calendar readout — #97 AC 1. The same seam a description
   * arrives through, with one difference: it can be tapped while the editor is
   * CLOSED, so it opens it. From a closed editor the field and its source line
   * arrive together, so nothing moves after the tap; from an open one the
   * source line appears under the field, which is the layout #210 measured
   * and accepted for a description's arrival.
   */
  function takeCalendarFigure() {
    if (suggestion == null) return
    takeProposal({ minutes: suggestion, source: 'calendar' })
    setShellKey((k) => k + 1)
    setEditing(true)
    setScrollRequest((n) => n + 1)
  }

  // Rendered in BOTH states, at the same place under this week's figure, so
  // the suggestion is readable while the member is deciding whether to take
  // it and while they are reviewing what taking it produced.
  const readout = (
    <BusyReadout
      member={member}
      busyWeek={busyWeek}
      complaint={busyComplaint}
      timeZone={timeZone}
      onUse={suggestion == null ? null : takeCalendarFigure}
      busy={busy}
    />
  )

  if (!editing) {
    return (
      <>
        <div className="member__week">
          <span className="member__week-figure" data-testid={`week-${member.id}`}>
            This week: {effective} min
            <span className="member__budget-human"> ({formatMinutes(effective)})</span>
            {/* #97 AC 6 — a calendar-sourced week says so where the figure is
                read, not only in the editor that produced it: a figure nobody
                saw is a figure nobody can defend, and a housemate reading the
                roster saw no confirmation tap. The same quiet register as the
                other two marks, for `.member__week-mark`'s reason. */}
            {isOverridden ? (
              override.source === 'calendar_auto' ? (
                // #106 AC 4 — nobody tapped, so the mark carries what a tap
                // would have shown the person: the provenance AND the figure
                // the week had before, from the row itself (`0039`). The same
                // quiet register; the word "automatically" is the difference.
                <span className="member__week-mark" data-testid={`week-auto-${member.id}`}>
                  {' '}
                  · set from calendar automatically
                  {override.previous_minutes == null
                    ? null
                    : ` (was ${override.previous_minutes} min)`}
                </span>
              ) : override.source === 'calendar' ? (
                <span className="member__week-mark"> · set from calendar</span>
              ) : (
                <span className="member__week-mark"> · set for this week</span>
              )
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
        {readout}
      </>
    )
  }

  // The #46 field, unchanged. Rendered inside the shell when there is a
  // proposer and bare when there is not, so the manual road in is the same
  // element either way.
  const manualField = (
    <label className="field">
      <span className="field__label">Minutes this week</span>
      <input
        ref={fieldRef}
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
        onSet(member.id, minutes, sourceToSave).then(close, () => {})
      }}
    >
      {readout}
      {onPropose ? (
        <CaptureShell
          key={shellKey}
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
      {sourceToSave === 'manual' ? null : (
        <p className="member__week-source" data-testid={`week-source-${member.id}`}>
          {sourceLabel(sourceToSave, member, isMe)} Change the number if it is wrong, then save.
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
  isMe: PropTypes.bool,
  busy: PropTypes.bool,
  onSet: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
  onPropose: PropTypes.func,
  busyWeek: PropTypes.object,
  busyComplaint: PropTypes.string,
  timeZone: PropTypes.string,
}

/**
 * The source, named on screen — #210 AC 9. One sentence per proposer, so a
 * member reads where the number in the field came from before they save it.
 * `calendar` is #97's; it is here so that story adds a proposer and not a
 * second confirm surface.
 */
function sourceLabel(source, member, isMe) {
  if (source === 'extraction') return 'From your description.'
  // Whose calendar: the tap is offered on every row (#97), and "your" on a
  // housemate's row would attribute their free/busy to the person holding the
  // phone. The description line keeps "your" because it is #210's and the
  // same question there is that story's to answer.
  if (source === 'calendar') {
    return isMe ? 'From your calendar.' : `From ${member.display_name}’s calendar.`
  }
  return `From ${source}.`
}

/**
 * What the calendar says about this week, beside the number it informs — #96.
 *
 * A READOUT WITH ONE CONTROL, AND THE CONTROL WRITES NOTHING. #96 shipped this
 * with no handler at all, which was the thinnest proof its AC 4 asked for —
 * nothing is written to `member_capacity` — and #97 adds "Use this", which
 * PREFILLS the capacity editor above and still writes nothing: the write is
 * that editor's Save, the same one a typed figure uses. `onUse` is null when
 * there is nothing to offer (no row, or a figure that is not a number), and
 * the button goes with it rather than offering a zero. The figure it will
 * prefill is `calendarSuggestion`'s arithmetic on the member's baseline; the
 * button says "Use this" rather than the number because the number is what
 * the field shows the moment it is tapped, with its source named beside it.
 *
 * The date is always shown, not only when something went wrong. #96 fetched a
 * week ONCE, so a figure read on Monday was still on screen on Friday; since
 * #98 an app open refreshes a figure older than twelve hours, which narrows the
 * gap and does not close it — a phone left open all week, or a Google that
 * keeps refusing, keeps drawing the last read. A number presented without its
 * age would be claiming a freshness it does not have, in either story.
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
function BusyReadout({ member, busyWeek, complaint, timeZone, onUse, busy }) {
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
      {busyWeek && onUse ? (
        <button
          className="button button--quiet"
          type="button"
          onClick={onUse}
          disabled={busy}
          aria-label={`Use the calendar’s figure for ${member.display_name}`}
        >
          Use this
        </button>
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
  member: PropTypes.object.isRequired,
  busyWeek: PropTypes.object,
  complaint: PropTypes.string,
  timeZone: PropTypes.string,
  onUse: PropTypes.func,
  busy: PropTypes.bool,
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
 *
 * WHAT #99 ADDED, AND WHY IT IS TWO TAPS
 *
 * A way back out, beside the sentence that says there is something to get out
 * of. It is the charter's trust half: an input a member cannot switch off erodes
 * exactly the trust the connection is asking for, so "Calendar connected" must
 * not be a state with no exit next to it.
 *
 * Two taps — `Disconnect`, then `Disconnect Google Calendar?` beside `Keep` —
 * which is the idiom Remove-a-member, Remove-a-chore and the second sign-out
 * already use on this screen (owner decision at #99's pickup, 2026-09-08, over
 * one tap). The reason is not that disconnecting is dangerous but that it is
 * IRREVERSIBLE IN ONE DIRECTION: every derived figure goes, and getting them
 * back is a fresh consent at Google and a fresh read, so a mis-tap costs a round
 * trip nobody asked for. The confirm arm is the only control here drawn as
 * `button--danger`, for the reason the Remove arms are.
 *
 * `revokeNote` is drawn in BOTH states, and that is what makes it reachable at
 * all: the note exists only after a disconnect has SUCCEEDED, at which point
 * the connection row is gone and this component is rendering its Connect arm.
 * A note that lived inside the connected branch could never be seen.
 */
function CalendarControl({ member, connection, busy, onConnect, onDisconnect, revokeNote }) {
  // Declared before the early return below, because a hook after a conditional
  // return is a hook that is not always called.
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  if (!isRealEmailMember(member)) return null

  // #99 AC 4 — said once, quietly, and only for the one outcome Taskr cannot
  // vouch for. `revokeNoteFor` in calendar.js owns which outcome that is; this
  // draws whatever it produced.
  const note = revokeNote ? (
    <span className="member__calendar-note" role="status" data-testid="calendar-note">
      {revokeNote}
    </span>
  ) : null

  if (connection) {
    return (
      <span className="member__calendar" data-testid={`calendar-${member.id}`}>
        Calendar connected
        {confirmingDisconnect ? (
          <>
            <button
              className="button button--danger"
              type="button"
              // The two-arm handler is not decoration: onDisconnect routes
              // through App's mutate(), which RETHROWS after recording the
              // message, so a bare call here escapes as an unhandled promise
              // rejection. The Remove arms in this file and in Chores.jsx do
              // the same.
              onClick={() => onDisconnect().then(() => {}, () => {})}
              disabled={busy}
            >
              Disconnect Google Calendar?
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirmingDisconnect(false)}
              disabled={busy}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setConfirmingDisconnect(true)}
            disabled={busy}
            // No `aria-label`, matching the Connect button below rather than
            // the Remove and This-week controls above. Those carry one because
            // they repeat down the roster and "Remove" alone names nobody; this
            // control renders on the signed-in member's own row only, so the
            // word is already unambiguous and a label would only be a second
            // spelling to keep in step.
          >
            Disconnect
          </button>
        )}
        {note}
      </span>
    )
  }

  return (
    <span className="member__calendar" data-testid={`calendar-${member.id}`}>
      <button className="button button--quiet" type="button" onClick={onConnect} disabled={busy}>
        Connect Google Calendar
      </button>
      {note}
    </span>
  )
}

CalendarControl.propTypes = {
  member: PropTypes.object.isRequired,
  connection: PropTypes.object,
  busy: PropTypes.bool,
  onConnect: PropTypes.func.isRequired,
  onDisconnect: PropTypes.func.isRequired,
  revokeNote: PropTypes.string,
}

/**
 * Email somebody their invitation or reset link, or reset a PIN account minted
 * before #191 — #87 AC 6 ("give somebody a way to sign in", until the mint
 * went), rebuilt by #341, narrowed by #191.
 *
 * Organizer-only, because the Edge Function refuses anybody else and a control
 * that renders for a person who will always be refused is a promise the app
 * cannot keep. The refusal is still the real boundary; this is manners.
 *
 * TWO SHAPES NOW, DECIDED BY WHETHER THE ROW HAS AN INBOX.
 *
 * A member with a real address gets a single button and no form at all: an
 * invitation if they have no sign-in, a reset link if they do. The organizer
 * never chooses, types or reads a credential for another adult — which is what
 * #341 is, stated three times by the owner before it was filed.
 *
 * A member with NO address is one of two things now, and #191 is what split
 * them. Until #191 the organizer could ADD a person with no address and then
 * mint them a sign-in at `<id>@taskr.invalid` with a PIN they chose; that add
 * path is retired (an address is required on the form below, and
 * `provision-member` no longer has a `provision` action at all). What survives
 * is the accounts it already created: a PIN member who HAS a sign-in keeps the
 * reset form, because `.invalid` has no mailbox by construction and a spoken
 * credential is still the only thing that can reach them. A PIN member who
 * never got one gets no control — there is nothing left that can mint it — and
 * a note saying the route is to give them an address, after which the ordinary
 * invitation applies. Retirement is of the ADD path, not of the accounts it
 * created (owner decision, #191).
 *
 * What the old docblock argued is worth keeping, because it is the decision that
 * was reversed rather than a detail: "the organizer types the credential and
 * tells the person out loud (owner decision, #87) — a household already
 * understands 'your PIN is 1234', and the alternative needs a surface that
 * displays a secret exactly once and a recovery path for the organizer who looks
 * away." That was true of a household of children. It stopped being the right
 * default the moment the people being added were other adults, and the
 * alternative it rejected is not the one #341 took: nothing displays a secret,
 * because nobody but the person ever knows one.
 */
function SignInControl({ member, busy, onResetPin, onInvite, onSendReset }) {
  const [editing, setEditing] = useState(false)
  const [secret, setSecret] = useState('')
  const [complaint, setComplaint] = useState(null)

  const hasSignIn = Boolean(member.claimed_by)
  const byEmail = isRealEmailMember(member)

  function open() {
    setSecret('')
    setComplaint(null)
    setEditing(true)
  }

  function close() {
    setComplaint(null)
    setEditing(false)
  }

  // #341 AC 1 — one button, no form, nothing that takes a credential.
  //
  // Returned before `editing` is consulted at all, rather than as a branch
  // inside the form: there is no editing state on this path, and leaving the
  // form reachable behind a flag is how a password field survives a story whose
  // whole subject is removing it.
  if (byEmail) {
    return (
      <div className="stack">
        <button
          className="button button--quiet"
          type="button"
          disabled={busy}
          data-testid={`invite-${member.id}`}
          aria-label={
            hasSignIn
              ? `Email ${member.display_name} a link to set a new password`
              : `Email ${member.display_name} an invitation`
          }
          onClick={() => {
            setComplaint(null)
            const run = hasSignIn ? onSendReset(member) : onInvite(member.id)
            run.then(
              () =>
                setComplaint(
                  hasSignIn
                    ? `Sent. ${member.display_name} can set a new password from that email.`
                    : `Invitation sent to ${member.email}.`,
                ),
              // The refusal is already on the shell's error strip — the Edge
              // Function's sentences are surfaced verbatim — so this only has to
              // avoid an unhandled rejection and NOT clear the note, or a
              // failure would read as nothing having happened.
              () => {},
            )
          }}
        >
          {hasSignIn ? 'Email a reset link' : 'Email an invitation'}
        </button>
        {complaint ? (
          // role="status", not role="alert": this is a confirmation, and the
          // .error palette stays reserved for faults.
          <p className="card__note" role="status" data-testid={`invite-note-${member.id}`}>
            {complaint}
          </p>
        ) : null}
      </div>
    )
  }

  // #191 AC 3 — a member with no address and no sign-in has NO control. The
  // thing that used to sit here was "Give a sign-in": a PIN form whose submit
  // minted an account at `<id>@taskr.invalid`, and that is the create-a-sign-in
  // action this story removes from the Edge Function. Nothing on the client can
  // reach it now, so offering the form would be a promise the app cannot keep —
  // the same rule that hides the whole control from a non-organizer.
  //
  // A note rather than nothing, for the same reason the roster note exists:
  // "No sign-in yet" with no route beside it reads as a bug. The route is the
  // row's Edit form, where an address can be added; once it has one this
  // component renders the invitation button above instead.
  if (!hasSignIn) {
    return (
      <p className="card__note" data-testid={`no-address-${member.id}`}>
        {member.display_name} has no email address on their row, so Taskr cannot
        invite them. Edit the row to add one and the invitation goes to it.
      </p>
    )
  }

  if (!editing) {
    return (
      <button
        className="button button--quiet"
        type="button"
        onClick={open}
        disabled={busy}
        data-testid={`provision-${member.id}`}
        aria-label={`Reset the sign-in for ${member.display_name}`}
      >
        Reset sign-in
      </button>
    )
  }

  // What is left of the PIN form: a RESET for an account minted before #191.
  // The organizer still chooses this credential, and that is the one place the
  // #341 rule does not reach — there is no inbox to send a link to, so the
  // alternative to a spoken credential is no reset at all.
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
        onResetPin(member.id, secret).then(close, () => {})
      }}
    >
      <label className="field">
        <span className="field__label">New PIN for {member.display_name}</span>
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
      {/* #341 rewrote this and the rewrite is smaller than it looks. Every word
          about telling somebody their PIN is still here, because on this branch
          it is still TRUE: this form is only reached by a member with no
          address AND an account already minted at the synthetic one, for whom
          nothing can be emailed and a spoken credential is the only thing that
          works. #191 narrowed it again — the form no longer mints, only resets
          — so `signInAddressFor` is a reading of what the account WAS minted
          as, and the roster's one remaining copy of that rule.

          The sentence AC 5 sweeps for is gone from every row that HAS an
          address, which is what the criterion asks — not gone from the app,
          which would have left the one member it is true of with no instructions
          at all. */}
      <p className="card__note" data-testid={`provision-address-${member.id}`}>
        Tell {member.display_name} both of these — they sign in with{' '}
        <strong>{signInAddressFor(member)}</strong> and this PIN. No email is
        sent, and nobody can look the PIN up later.
      </p>
      {/* Unconditional now, where it used to be behind `isRealEmailMember`. The
          branch is not deleted for tidiness: it became UNREACHABLE, because a
          member with a real address never renders this form at all. Left as a
          condition it would read as a live choice and quietly always take the
          same arm — the shape a later reader has no way to tell from a bug. */}
      {/* review-fanout on #191 caught the sentence that stood here: "give them
          an address above and Taskr can email them a reset link instead". False
          — the account was minted AT the made-up address and `updateMember`
          changes the row, never the auth user (the edit form's own note says
          so), so a reset link would go to an address GoTrue has never heard of
          and this form, the one thing that reaches the account, would stop
          rendering for the row. Before #191 it promised an invitation instead,
          false for the same reason on a claimed row. The honest sentence has no
          route in it, because there is none from inside the app: re-pointing an
          account is a Supabase dashboard action (`docs/access-model.md`). */}
      <p className="card__note">
        That address is one Taskr made up, because {member.display_name} has no
        email on their row. It works, and it is long. Adding an address to their
        row later does not move this sign-in — the account stays at the made-up
        address, and this PIN is still the way in.
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
          Reset it
        </button>
      </div>
    </form>
  )
}

SignInControl.propTypes = {
  member: PropTypes.object.isRequired,
  busy: PropTypes.bool,
  onResetPin: PropTypes.func.isRequired,
  onInvite: PropTypes.func.isRequired,
  onSendReset: PropTypes.func.isRequired,
}

function MemberRow({
  member,
  override,
  isMe,
  busy,
  isOrganizer,
  onSave,
  onRemove,
  onResetPin,
  onInvite,
  onSendReset,
  onSetCapacity,
  onClearCapacity,
  onProposeCapacity,
  connection,
  onConnectCalendar,
  onDisconnectCalendar,
  revokeNote,
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
        {isOrganizer && onInvite ? (
          <SignInControl
            member={member}
            busy={busy}
            onResetPin={onResetPin}
            onInvite={onInvite}
            onSendReset={onSendReset}
          />
        ) : null}
        {/* The baseline above stays visible beside this week's number on
            purpose: an override that hid what it was overriding would make the
            figure impossible to sanity-check, and the product's claim is that
            the fairness number is one anybody can check. */}
        {/* #96's readout renders INSIDE the control since #97, directly under
            this week's minutes, which is the number it exists to inform. Own
            row only for the COMPLAINT (it is about a read this device
            attempted), household-wide for the FIGURE and for the tap that
            takes it: the derived rows are readable by everybody `0030`'s
            policy scopes them to, the same way a housemate's weekly minutes
            have always been, and this editor has never gated who may set. */}
        <CapacityControl
          member={member}
          override={override}
          isMe={isMe}
          busy={busy}
          onSet={onSetCapacity}
          onClear={onClearCapacity}
          onPropose={onProposeCapacity}
          busyWeek={busyWeek}
          busyComplaint={isMe ? busyComplaint : null}
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
            onDisconnect={onDisconnectCalendar}
            revokeNote={revokeNote}
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
  onResetPin: PropTypes.func,
  onInvite: PropTypes.func,
  onSendReset: PropTypes.func,
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
  onDisconnectCalendar: PropTypes.func,
  revokeNote: PropTypes.string,
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
  onResetPin,
  onInvite,
  onSendReset,
  onRefresh,
  onSignOut,
  overrides = [],
  periodStart = null,
  onSetCapacity,
  onClearCapacity,
  onProposeCapacity,
  connections = [],
  onConnectCalendar,
  onDisconnectCalendar,
  // #99 AC 4 — App's, not this component's, because the sentence describes the
  // outcome of a call App made and outlives the row that made it: the
  // connection is gone by the time it is drawn, so state held down here would
  // have to survive the very re-render the disconnect causes.
  calendarRevokeNote = null,
  busyWeeks = [],
  busyComplaint = null,
  // #166 — optional, and its absence renders exactly what #163 shipped.
  onCreateHousehold = null,
  // #173 — optional, the #166 shape: join another household with a code.
  onJoinHousehold = null,
  // #172 — the organizer's invitation card. Optional in the #166 shape: a roster
  // with no minter wired renders exactly what shipped before, so a test about
  // something else is not suddenly carrying a card it never asked for.
  invitations = [],
  mintedCode = null,
  onMintInvitation = null,
  onWithdrawInvitation = null,
  onDismissMintedCode = null,
  // #430 — the organizer's "Delete this household". Optional in the #166
  // shape: a roster with no handler wired renders exactly what it did.
  onDeleteHousehold = null,
  deletionGraceDays = null,
  // #431 — leaving, and the organizer's hand-over. Optional in the #166 shape.
  onLeaveHousehold = null,
  onHandOverAndLeave = null,
}) {
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState('')
  const [email, setEmail] = useState('')
  // #191 — the add form's confirmation that the invitation went, and the
  // refusal when it did not. Both cleared at the next submit, so neither
  // describes a send other than the last one.
  //
  // The refusal is held HERE as well as reaching the shell's strip through
  // `onInvite`, and the reason is a measurement (design-bar, 2026-09-12): the
  // strip is the roster's last element, so at 360×800 a refused send left the
  // organizer looking at a form that had just emptied — indistinguishable from
  // success — with the sentence 754px below the fold, beside the delete-household
  // card. Scrolling the strip into view (#360's remedy on the Shop tab) was
  // measured too and moved them 663px away from the form to read it next to two
  // destructive controls. The sentence belongs under the button they pressed.
  const [added, setAdded] = useState(null)
  const [addComplaint, setAddComplaint] = useState(null)
  // #166 — the second household's name, and what this person is called in it.
  //
  // THE ORGANIZER NAME IS DERIVED, NOT HELD, and the first version got this
  // wrong in a way its own comment denied. It was `useState(myName)`, whose
  // initialiser runs ONCE — so the field froze at mount while the comment above
  // it claimed the prefill "follows a rename". Found by review-fanout, and the
  // sharpest reproduction needs one household and one screen: press Edit on
  // your own row, change your name, and the field a few inches below still
  // offers the old one. Submit without looking and the new household knows you
  // by your pre-rename name.
  //
  // So the value is `override ?? myName`: null means "nobody has typed here,
  // show them what they are currently called", and any keystroke pins it. The
  // reset after a successful create is `setOrganizerOverride(null)` — back to
  // the live prefill rather than to a `myName` captured in a stale closure,
  // which was the same defect a second time.
  const myName = me?.display_name ?? ''
  const [anotherName, setAnotherName] = useState('')
  const [organizerOverride, setOrganizerOverride] = useState(null)
  const anotherOrganizer = organizerOverride ?? myName
  // #173 — the code typed into the join-another-household card, and the name
  // to join under: the `organizerOverride ?? myName` shape above, for its
  // reason — prefilled from this person's row here, editable, and following
  // a rename until they type their own answer.
  const [joinCode, setJoinCode] = useState('')
  const [joinNameOverride, setJoinNameOverride] = useState(null)
  const joinName = joinNameOverride ?? myName
  // #291 — the second sign-out is two taps, matching the Remove idiom below.
  // Not because it is destructive to data (it is not) but because it is
  // destructive to a session you are not holding: the point of pressing it is
  // to end a session on a device that is not in front of you, and a mis-tap
  // ends one that is.
  const [confirmingSignOutAll, setConfirmingSignOutAll] = useState(false)
  // #430 — deleting the household is two taps, the Remove idiom: the mistake
  // it guards is one tap on the wrong control.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // #431 — leaving is two taps as well, and the organizer's confirm carries a
  // choice of successor: somebody who has signed in, since an organizer who
  // cannot sign in could provision nobody (0016's dead end).
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [successorId, setSuccessorId] = useState('')
  const successors = members.filter((m) => m.claimed_by && m.id !== me?.id)
  const successorName = successors.find((m) => m.id === successorId)?.display_name ?? ''
  // Design-bar, 2026-09-11 (#431): both confirms opened BELOW the fold at
  // 360×800 when tapped from the bottom of the Who tab — measured, the member's
  // "Leave …?" at y=821 and #430's "Delete …?" at y=801 in an 800px viewport,
  // with nothing moving on screen, so the tap read as doing nothing. Each
  // confirm now scrolls itself into view as it opens; `nearest` moves the page
  // only as far as the confirm needs. Guarded: jsdom has no scrollIntoView.
  const leaveConfirmRef = useRef(null)
  const deleteConfirmRef = useRef(null)
  useEffect(() => {
    if (confirmingLeave) leaveConfirmRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [confirmingLeave])
  useEffect(() => {
    if (confirmingDelete) deleteConfirmRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [confirmingDelete])

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
        {/* #341 AC 5, and the third reversal this sentence has been through —
            `docs/access-model.md`'s admission section carries the other two.
            What it said until then was accurate and is the thing that story
            removed: "They sign in with that address and a PIN you set — tell
            them the PIN yourself, because no email is sent."

            #191 moved it once more, and the move is smaller: "then email each
            of them an invitation from their row" described a second press that
            no longer exists — the invitation goes out as part of adding them.
            The row's button survives for a send the mailer refused.

            Left as a note rather than deleted, because the organizer still needs
            to know that the address is the thing that matters and that what
            happens next happens in somebody else's inbox — which is a fact about
            timing they cannot see from this screen. */}
        {isOrganizer ? (
          <p className="card__note" data-testid="provisioning-note">
            Add people here with their email address and Taskr emails each of
            them an invitation as you add them. They choose their own password
            from that email — you never set one, and never see it.
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
                onResetPin={onResetPin}
                onInvite={onInvite}
                onSendReset={onSendReset}
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
                onDisconnectCalendar={onDisconnectCalendar}
                // #99 — passed for every row and drawn on ONE, because
                // `CalendarControl` renders only where `isMe` already holds
                // (see MemberRow). A `me?.id === member.id` test here would be
                // that same condition written twice, and this file has already
                // measured what a spare guard costs: with two of them producing
                // one observable, deleting either reddens nothing and the suite
                // reports coverage it does not have (#95's `isMe` mutation,
                // round 1). One guard, in the place that owns the question.
                revokeNote={calendarRevokeNote}
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

      {/* #172 — invite somebody by code. BEFORE "Add someone", owner decision
          at the design-bar pass, 2026-09-10: at 360 wide the card started 2.4
          screens down (y 1919 of 2636), under the add-by-email form — so the
          forward path was the one a person had to scroll furthest to reach.
          The two are the same act by two routes and still read as a pair.
          (This comment said #191 "retires" the add-by-email form "in favour of
          this one" until 2026-09-11; it does not. #191 retired the PIN half of
          adding — an address is required and the invitation is sent as part
          of the add — and both routes stay: email admits a NEW person, a code
          admits somebody who already has a sign-in, which `inviteUserByEmail`
          refuses.) Until #173 shipped the redemption a code minted here could
          not be spent, which is why that story and this one reached a release
          together.

          THE GATE IS `isOrganizer`, and it is the only one that decides who
          sees this (AC 5). `isOrganizer` is App's answer for the ACTIVE
          household — `me.id === household.organizer_member_id`, both resolved
          within the household on screen — so a person who organises one
          household and merely belongs to another sees this card in the first
          and not the second, by construction (AC 6). `onMintInvitation` is the
          wiring-optional half, not a second opinion about the role.

          This is not the guard: `0040`'s three organizer-only policies are,
          and they refuse the read and both writes to anybody else. */}
      {isOrganizer && onMintInvitation ? (
        <Invitations
          invitations={invitations}
          mintedCode={mintedCode}
          timeZone={household.timezone}
          busy={busy}
          onMint={onMintInvitation}
          onWithdraw={onWithdrawInvitation}
          onDismissCode={onDismissMintedCode}
        />
      ) : null}

      <section className="card" aria-labelledby="add-heading">
        <h2 id="add-heading" className="card__heading">
          Add someone
        </h2>
        {/* #191 AC 1 — adding somebody SENDS their invitation. One submit, two
            writes, in the order that keeps the first one safe alone: the row
            is added, and only then is the invitation sent from it. If the send
            is refused (the mailer allows two an hour, measured on #341) the
            person is still on the roster with the row's own "Email an
            invitation" button as the retry — so a refused send is never a
            duplicate add, and the form clears either way because the add DID
            happen. The refusal itself reaches the shell's error strip through
            `onInvite`; what this form owns is the confirmation, and it says
            "sent" only when the send resolved.

            `onInvite` is wired-optional like every other handler on this
            screen, and a roster with none wired adds without inviting — the
            #242 shape, which is what the tests without one exercise. */}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            const address = email
            setAdded(null)
            setAddComplaint(null)
            onAdd({ displayName: name, weeklyMinutes: minutes || 0, email: address }).then(
              (member) => {
                setName('')
                setMinutes('')
                setEmail('')
                if (!onInvite || !member?.id) return undefined
                return onInvite(member.id).then(
                  () => setAdded(`Added. Invitation sent to ${address}.`),
                  // The person IS added — say so with the refusal, or the
                  // organizer reads the emptied form as "nothing happened" and
                  // adds them again.
                  (err) =>
                    setAddComplaint(
                      `${name.trim()} is on the roster, but no invitation went: ${err?.message ?? 'the send was refused'}`,
                    ),
                )
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
          {/* #242 added this field, optional: a young child with no inbox was a
              real member of a real household and the synthetic address still
              worked for them.

              #191 made it REQUIRED, and with it retired the email-less add. The
              cost was stated and accepted by the owner (2026-08-26): every new
              member needs a working inbox, because the invitation is the only
              way in and `provision-member` no longer mints anything. Members
              added without one before this landed are untouched — their rows
              keep the PIN reset above. */}
          <label className="field">
            <span className="field__label">Email address</span>
            <input
              className="field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              autoComplete="off"
              required
            />
          </label>
          <p className="card__note">
            Their invitation goes here, and it is what they will sign in with.
            They choose their own password from that email.
          </p>
          <button
            className="button"
            type="submit"
            disabled={busy || !name.trim() || !email.trim()}
          >
            Add to household
          </button>
          {added ? (
            // role="status", not role="alert": a confirmation, and the .error
            // palette stays reserved for faults — the row control's own shape.
            <p className="card__note" role="status" data-testid="add-note">
              {added}
            </p>
          ) : null}
          {addComplaint ? (
            <p className="error" role="alert" data-testid="add-complaint">
              {addComplaint}
            </p>
          ) : null}
        </form>
      </section>

      {/* #166 — start another household without signing out.

          Optional, and its absence is the state every screen was in before this
          story: `createHousehold` had exactly one call site, behind
          `status === 'onboarding'`, so a roster with no `onCreateHousehold`
          wired renders exactly what #163 shipped. Same shape as
          `onProposeCapacity` above, for the same reason.

          BELOW "Add someone", deliberately. The two read as a pair and the
          order is the likelihood: adding a person to the household you are in
          is the everyday act, and starting a second household is something
          most people do once or never. */}
      {onCreateHousehold ? (
        <section className="card" aria-labelledby="another-household-heading">
          <h2 id="another-household-heading" className="card__heading">
            Start another household
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              onCreateHousehold(anotherName, { organizerName: anotherOrganizer }).then(
                () => {
                  setAnotherName('')
                  // The organizer field is NOT cleared to blank — the override
                  // is dropped, which puts it back to the LIVE prefill. Clearing
                  // it would leave a required field empty on a form about to be
                  // used again by the same person, and re-setting it from
                  // `myName` here would capture whatever that was when this
                  // closure was made.
                  setOrganizerOverride(null)
                },
                () => {},
              )
            }}
          >
            {/* INSIDE the form, which is the Add-someone card's idiom and not a
                preference: `.card__note` carries `margin-bottom: 0`, so a note
                placed between the heading and the form butts straight against
                the first label — measured at a 0px gap, against the
                neighbouring card's 14px. The form's own `gap` is what spaces
                every other note in this file. */}
            <p className="card__note">
              A second home, with its own people and its own chores. You will be
              its organizer, and you can move between them from the name at the
              top of the screen.
            </p>
            <label className="field">
              <span className="field__label">Household name</span>
              <input
                className="field__input"
                value={anotherName}
                onChange={(e) => setAnotherName(e.target.value)}
                maxLength={60}
                autoComplete="off"
              />
            </label>
            {/* PREFILLED from this person's member row in the household they
                are already in, and editable. `create_household` writes a member
                row for the organizer in the NEW household and takes its display
                name as an argument, so this cannot be skipped — but asking
                somebody their own name again, on a screen that is already
                showing it, is the kind of question an app asks when nobody
                looked. Editable because a household is allowed to know you by a
                different name. */}
            <label className="field">
              <span className="field__label">Your name in it</span>
              <input
                className="field__input"
                value={anotherOrganizer}
                onChange={(e) => setOrganizerOverride(e.target.value)}
                maxLength={40}
                autoComplete="off"
              />
            </label>
            <button
              className="button"
              type="submit"
              disabled={busy || !anotherName.trim() || !anotherOrganizer.trim()}
            >
              Create household
            </button>
          </form>
        </section>
      ) : null}

      {/* #173 — join ANOTHER household with a code, from inside one. The
          other half of #166's pair: starting a second household is the
          organizer's act, and being invited into one is everybody else's, so
          the two cards sit together at the foot of this surface and read in
          the order of likelihood. AC 7's whole subject — a person in two
          households, with the switcher listing both — is reachable by a
          person only through this card; the other two entry points serve
          somebody who is in no household yet. Optional in the wiring for the
          same reason as the card above. */}
      {onJoinHousehold ? (
        <section className="card" aria-labelledby="join-household-heading">
          <h2 id="join-household-heading" className="card__heading">
            Join another household
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              onJoinHousehold(joinCode, { name: joinName }).then(
                () => {
                  setJoinCode('')
                  // Back to the live prefill, never to blank — the create
                  // card's reason exactly.
                  setJoinNameOverride(null)
                },
                // A refused code stays in the field, beside the sentence that
                // refused it, so the person can see what they typed.
                () => {},
              )
            }}
          >
            <p className="card__note">
              Been given a code for a different household? Type it here and
              you are in both &mdash; move between them from the name at the
              top of the screen. A household is allowed to know you by a
              different name.
            </p>
            <label className="field">
              <span className="field__label">Invitation code</span>
              <input
                className="field__input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                maxLength={64}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
              />
            </label>
            <label className="field">
              <span className="field__label">Join as</span>
              <input
                className="field__input"
                value={joinName}
                onChange={(e) => setJoinNameOverride(e.target.value)}
                maxLength={40}
                autoComplete="off"
              />
            </label>
            <button
              className="button"
              type="submit"
              disabled={busy || !joinCode.trim() || !joinName.trim()}
            >
              Join household
            </button>
          </form>
        </section>
      ) : null}

      {/* #431 — leaving, in its own card just above deleting: both are ways out,
          and both sit after everything done here week to week. A member
          confirms and goes. The organizer's confirm offers the two ways out the
          owner decided on (#427): hand the household to somebody who has signed
          in, or delete it through #430's grace period. */}
      {onLeaveHousehold && me ? (
        <section className="card" aria-labelledby="leave-household-heading">
          <h2 id="leave-household-heading" className="card__heading">
            Leave this household
          </h2>
          {!confirmingLeave ? (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => {
                setSuccessorId(successors[0]?.id ?? '')
                setConfirmingLeave(true)
              }}
              disabled={busy}
            >
              Leave this household
            </button>
          ) : isOrganizer ? (
            <div className="row" ref={leaveConfirmRef}>
              <p className="card__note" data-testid="leave-household-warning">
                You organize {household.name}, so before you go somebody has to take it on,
                or it is deleted.
                {deletionGraceDays
                  ? ' Deleting it takes it from everyone, and you can restore it for ' +
                    deletionGraceDays +
                    ' days.'
                  : ''}
              </p>
              {successors.length ? (
                <>
                  <label className="field">
                    <span className="field__label">Hand it to</span>
                    <select
                      className="field__input"
                      value={successorId}
                      onChange={(event) => setSuccessorId(event.target.value)}
                      disabled={busy}
                    >
                      {successors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={() => {
                      setConfirmingLeave(false)
                      // The error is already on screen — App's mutate put it there.
                      Promise.resolve(onHandOverAndLeave(household.id, successorId, me.id)).catch(() => {})
                    }}
                    disabled={busy || !successorId || !onHandOverAndLeave}
                  >
                    Hand it to {successorName} and leave
                  </button>
                </>
              ) : (
                <p className="card__note">
                  Nobody else here has signed in yet, so it cannot be handed over.
                </p>
              )}
              {onDeleteHousehold ? (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => {
                    setConfirmingLeave(false)
                    // The error is already on screen — App's mutate put it there.
                    Promise.resolve(onDeleteHousehold(household.id)).catch(() => {})
                  }}
                  disabled={busy}
                >
                  Delete {household.name} instead
                </button>
              ) : null}
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setConfirmingLeave(false)}
                disabled={busy}
              >
                Stay
              </button>
            </div>
          ) : (
            <div className="row" ref={leaveConfirmRef}>
              <p className="card__note" data-testid="leave-household-warning">
                You stop getting {household.name}’s chores, and the ones you hold go to the
                others. Your calendar connection here is disconnected. If this is the only
                household you are in, your sign-in is deleted too.
              </p>
              <button
                className="button button--danger"
                type="button"
                onClick={() => {
                  setConfirmingLeave(false)
                  // The error is already on screen — App's mutate put it there.
                  Promise.resolve(onLeaveHousehold(household.id, me.id)).catch(() => {})
                }}
                disabled={busy}
              >
                Leave {household.name}?
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setConfirmingLeave(false)}
                disabled={busy}
              >
                Stay
              </button>
            </div>
          )}
        </section>
      ) : null}

      {/* #430 — deleting the household, in its own card at the BOTTOM of the
          Who tab, after everything done here week to week. It first sat in the
          household card under Sign out, looking like one of them; the owner
          moved it at design-bar (2026-09-11). Confirm-in-place, and the
          confirm says what goes and that it can be undone for a while. */}
      {isOrganizer && onDeleteHousehold ? (
        <section className="card" aria-labelledby="delete-household-heading">
          <h2 id="delete-household-heading" className="card__heading">
            Delete this household
          </h2>
          {confirmingDelete ? (
            <div className="row" ref={deleteConfirmRef}>
              <p className="card__note" data-testid="delete-household-warning">
                Everyone in {household.name} loses it at once: its people, chores,
                shopping lists and calendar connections. You can restore it for{' '}
                {deletionGraceDays} days; after that it is deleted for good.
              </p>
              <button
                className="button button--danger"
                type="button"
                onClick={() => {
                  setConfirmingDelete(false)
                  // The error is already on screen — App's mutate put it there.
                  Promise.resolve(onDeleteHousehold(household.id)).catch(() => {})
                }}
                disabled={busy}
              >
                Delete {household.name}?
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              Delete this household
            </button>
          )}
        </section>
      ) : null}

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
  onResetPin: PropTypes.func,
  onInvite: PropTypes.func,
  onSendReset: PropTypes.func,
  onRefresh: PropTypes.func.isRequired,
  onSignOut: PropTypes.func,
  overrides: PropTypes.array,
  periodStart: PropTypes.string,
  onSetCapacity: PropTypes.func.isRequired,
  onClearCapacity: PropTypes.func.isRequired,
  onProposeCapacity: PropTypes.func,
  connections: PropTypes.array,
  onConnectCalendar: PropTypes.func,
  onDisconnectCalendar: PropTypes.func,
  calendarRevokeNote: PropTypes.string,
  busyWeeks: PropTypes.array,
  busyComplaint: PropTypes.string,
  onCreateHousehold: PropTypes.func,
  onJoinHousehold: PropTypes.func,
  invitations: PropTypes.array,
  mintedCode: PropTypes.string,
  onMintInvitation: PropTypes.func,
  onWithdrawInvitation: PropTypes.func,
  onDismissMintedCode: PropTypes.func,
  onDeleteHousehold: PropTypes.func,
  deletionGraceDays: PropTypes.number,
  onLeaveHousehold: PropTypes.func,
  onHandOverAndLeave: PropTypes.func,
}
