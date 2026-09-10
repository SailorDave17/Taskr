import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import CaptureShell from './CaptureShell.jsx'
import ChoreDraftList from './ChoreDraftList.jsx'
import {
  eventChorePrefill,
  eventWhenLabel,
  hasEventReadScope,
  importedEventIds,
} from '../lib/calendar.js'
import { CAPTURE_OUTCOMES } from '../lib/capture.js'
import {
  MAX_EXPECTED_MINUTES,
  MIN_EXPECTED_MINUTES,
  MONTHDAYS,
  SKIP_OFFER_MAX_DATES,
  SKIP_OFFER_SCAN_DAYS,
  WEEKDAYS,
  ordinalOf,
  actualsSummary,
  describeRepeat,
  estimateSuggestion,
  formatMinutes,
  isCompleted,
  isMissed,
  isOutstanding,
  isOverdue,
  normalizeActualMinutes,
  normalizeDueDate,
  normalizeExpectedMinutes,
  normalizeRepeat,
  normalizeTitle,
  outstandingMinutes,
  upcomingOccurrenceDates,
} from '../lib/chores.js'
import { countDoneInWeek } from '../lib/done.js'
import { excludedMemberIds, isExcluded } from '../lib/exclusions.js'

// The chore list — story #34.
//
// Minutes are entered as minutes, matching the roster, because that is the unit
// the whole app reasons in. "2h 0m" beside the field is a reading aid; the
// stored value is the number that was typed.
//
// AC 2 asks that the form refuse a bad minutes value "with a sentence BEFORE any
// request is sent". `validate` below is what does that, and it calls the same
// normalizers the data layer calls rather than restating their rules — a second
// copy of the bounds is a second copy that can drift from the check constraint,
// and the constraint is the one that is actually true.
//
// Both forms carry `noValidate`, and that is load-bearing rather than tidying.
// `min`, `max` and the implicit integer `step` on a number input make the
// browser refuse the submit itself, so onSubmit never fires and the person
// reads the BROWSER's bubble instead of the sentence written here. Measured
// while building this: five AC 2 tests failed with no alert rendered and onAdd
// never called, because jsdom implements that interception faithfully. The
// attributes stay — they size the spinner and tell assistive tech the range —
// but the refusal is ours, so it is one wording, tested, and the same on every
// browser.
//
// The assignee control and the per-person figures arrived with #36. What stays
// deliberately absent is the RANKING — no bar, no percentage, no ordering by
// load. See the note at the foot of src/lib/chores.js, and `Commitment` below.
//
// #37 adds the only route in the whole app for saying somebody cannot do a
// chore, and WHERE it lives is the story's central decision (owner, 2026-08-21,
// option (a)). It is on the chore row, entered at the moment the case actually
// bites. There is deliberately NO capability step in onboarding, NO capability
// section on the roster, and NO screen anywhere laying all chores against all
// members — that grid is what #8 asked for, and it is a form, in the same window
// the charter's bet exists to delete forms. `src/test/gate.test.js` enumerates
// the routes as a check rather than leaving this paragraph to be believed.
//
// #213 PUTS A QUESTION IN FRONT OF THE FORM, AND CHANGES NOTHING BEHIND IT.
//
// The shared `CaptureShell` (#210 AC 8) wraps the single-chore form: a
// description box asking the direct question #207's verdict found was the
// only thing that collected anything from a real household — a blank
// "describe your week" box collected nothing three times — and the form
// underneath it as the shell's CHILDREN, the manual road in, on screen before,
// during and after any description. A proposal renders as the #220 review
// list (`ChoreDraftList`) inside the shell's proposal box, every row editable
// and removable, and NOTHING is written until the member confirms it: the
// confirm is `onAddMany` with `source: 'extraction'` on each row, the same
// loop over `addChore` a typed batch takes (AC 9). The rows arrive with the
// data layer's own complaints already on them (a chore with no date, a zero
// duration, a title too long — `proposeChores` in capture.js), and confirm
// re-runs the same validators, so a marked row cannot be written as it stands.
//
// `onPropose` is OPTIONAL, and that is AC 10 made structural, the way
// Roster's `onPropose` is #210 AC 7's: a chore tab rendered without it is
// exactly the #34 surface, every #34 test renders it that way, and the shell
// does not mount at all. THE FORM IS STILL AN OPTION BESIDE THE PROMPT — the
// owner's amendment at this story's pickup, 2026-09-07 — so a member who
// never types a sentence adds a chore exactly as before, and the batch panel
// (#220) stays where it was. A failure never REVEALS the form; it moves the
// box out of the way and focuses the title field that was there throughout.
//
// #101 PUTS A THIRD WAY IN BESIDE THE FORM, AND IT WRITES THROUGH THE SAME
// SUBMIT. "Import from calendar" lives HERE, on the tab where the chore lands
// (owner decision at pickup, 2026-09-08, over the roster row beside "Calendar
// connected"), and only for a member whose own calendar is connected —
// `calendarConnection` is that member's row or null, and the control does not
// mount without it, so every #34 test renders the tab exactly as before.
// Picking an event PREFILLS the single form above it (title, minutes from the
// duration, due date) and marks the form as importing; Add is then the same
// submit, routed to `onImportEvent` so App writes the chore through `addChore`
// with `source: 'calendar'` and records the import — AC 3's one write path.
// Nothing is written by listing, and nothing by picking. The list itself is
// transient (AC 2): fetched when the section opens, held in this state, gone
// when it closes.
//
// The scope gate is the first thing the section shows a #95 connection: it
// holds free/busy alone, which cannot list titles, so the section offers the
// incremental consent step (AC 1) and nothing else until Google has granted
// the wider scope and the connection row says so.

/**
 * Settle a batch write's per-row outcomes against the rows that were sent —
 * #220 AC 5, shared since #213 by the batch panel and the proposal list.
 *
 * One outcome per submitted row, in order — addChores' contract. Saved rows
 * are PRUNED, which is what makes re-confirming unable to duplicate them: the
 * next confirm submits only what is still listed. A refused row keeps its
 * place with the server's sentence on it. Pure, so one implementation serves
 * two lists and its arithmetic is testable on its own.
 */
export function settleBatch(checked, outcomes) {
  const remaining = []
  let saved = 0
  outcomes.forEach((o, i) => {
    if (o?.ok) saved += 1
    else remaining.push({ ...checked[i], problem: o?.message ?? 'not saved' })
  })
  const notice =
    remaining.length === 0
      ? null
      : `${saved} of ${outcomes.length} saved — the rows still listed were not.`
  return { remaining, saved, notice }
}

/**
 * Run the data layer's own validators and return the first complaint, or null.
 *
 * Returning the message rather than a boolean is what makes "refuses with a
 * sentence" testable: a boolean would let the UI invent its own wording, and
 * then the sentence a person reads would be untested.
 */
function validate({ title, expectedMinutes, dueOn, repeatKind, repeatWeekdays, repeatMonthday }) {
  try {
    normalizeTitle(title)
    normalizeExpectedMinutes(expectedMinutes)
    normalizeDueDate(dueOn)
    // #53/#54/#103 — both forms' repeat is validated by the same function the
    // data layer calls, for the reason above: the rules the constraints
    // actually enforce live in one place. An occurrence row's editor passes no
    // repeat fields and gets 'none' back, which is the no-op it means.
    normalizeRepeat({ repeatKind, repeatWeekdays, repeatMonthday })
    return null
  } catch (err) {
    return err.message
  }
}

/**
 * The schedule controls — a kind, then weekdays for weekly or a day of the
 * month for monthly (#103). ONE component for the add form (#53) and the edit
 * form (#54), because two copies of the schedule controls would be two
 * vocabularies for one column set.
 *
 * Structured on the way in — #53 AC 6, honoured by #103: a day-of-month
 * CHOICE, never free text — there is no field a phrase could arrive through.
 * Days 29–31 say the clamp beside the number, because a person picking the
 * 31st is exactly the person who needs to know February still fires.
 */
function RepeatControl({ kind, days, monthday, onKindChange, onDaysChange, onMonthdayChange, context }) {
  return (
    <>
      <label className="field">
        <span className="field__label">Repeats</span>
        <select
          className="field__input"
          value={kind}
          aria-label={context ? `How often ${context} repeats` : 'How often this chore repeats'}
          onChange={(e) => {
            const next = e.target.value
            onKindChange(next)
            // Days belong to weekly alone, the monthday to monthly alone;
            // leaving a stale selection behind would silently rearm if the
            // person flips back.
            if (next !== 'weekly') onDaysChange([])
            if (next !== 'monthly') onMonthdayChange('')
          }}
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Every day</option>
          <option value="weekly">Weekly, on&hellip;</option>
          <option value="monthly">Monthly, on the&hellip;</option>
        </select>
      </label>
      {kind === 'monthly' ? (
        <label className="field">
          <span className="field__label">Which day of the month</span>
          <select
            className="field__input"
            value={monthday}
            aria-label={
              context ? `Which day of the month ${context} repeats on` : 'Which day of the month'
            }
            onChange={(e) => onMonthdayChange(e.target.value)}
          >
            <option value="">Pick a day&hellip;</option>
            {MONTHDAYS.map((day) => (
              <option key={day} value={String(day)}>
                {day >= 29 ? `${ordinalOf(day)} (or last day of the month)` : ordinalOf(day)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {kind === 'weekly' ? (
        <fieldset className="field chore-weekdays">
          <legend className="field__label">Which days</legend>
          <div className="chore-weekdays__row">
            {WEEKDAYS.map(({ isoDow, label }) => (
              <label key={isoDow} className="chore-weekdays__day">
                <input
                  type="checkbox"
                  checked={days.includes(isoDow)}
                  aria-label={context ? `Repeat ${context} on ${label}` : `Repeat on ${label}`}
                  onChange={(e) =>
                    onDaysChange(
                      e.target.checked ? [...days, isoDow] : days.filter((d) => d !== isoDow),
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  )
}

RepeatControl.propTypes = {
  kind: PropTypes.string.isRequired,
  days: PropTypes.array.isRequired,
  monthday: PropTypes.string.isRequired,
  onKindChange: PropTypes.func.isRequired,
  onDaysChange: PropTypes.func.isRequired,
  onMonthdayChange: PropTypes.func.isRequired,
  context: PropTypes.string,
}

/**
 * The one place a chore is given to a person — #36 AC 1.
 *
 * A `<select>` rather than a list of buttons, because the number of options is
 * the size of the household and the control has to work on a 360px phone. The
 * empty option is "Nobody yet" and choosing it routes to `onUnassign`, not to
 * `onAssign(null)` — `assign_chore` refuses a null person outright, so a dropped
 * variable fails loudly instead of quietly clearing somebody's work.
 *
 * `assigned_member_id` may name a member this device cannot see. That is not
 * hypothetical: the roster is re-read on every mutation, so between another
 * phone removing a person and this one refreshing, the value points at nobody in
 * `members`. A bare `value=` would silently fall back to the first option and
 * the next change would look like a deliberate re-assignment, so the unknown id
 * is carried as its own option instead.
 */
function AssigneeSelect({ chore, members, busy, onAssign, onUnassign }) {
  const current = chore.assigned_member_id ?? ''
  const known = members.some((m) => m.id === current)

  return (
    <label className="chore__assignee">
      <span className="field__label">Who</span>
      <select
        className="field__input"
        value={current}
        disabled={busy}
        aria-label={`Who is doing ${chore.title}`}
        onChange={(e) => {
          const chosen = e.target.value
          const done = chosen === '' ? onUnassign(chore.id) : onAssign(chore.id, chosen)
          // Two-arm, for the reason the remove button gives: onAssign routes
          // through App's mutate(), which RETHROWS after recording the message.
          done.then(() => {}, () => {})
        }}
      >
        <option value="">Nobody yet</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
        {current !== '' && !known ? <option value={current}>Someone not on the roster</option> : null}
      </select>
    </label>
  )
}

AssigneeSelect.propTypes = {
  chore: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onAssign: PropTypes.func.isRequired,
  onUnassign: PropTypes.func.isRequired,
}

/**
 * The one route into an exclusion — #37 ACs 2 and 3.
 *
 * A `<select>` of the people not already excluded, sitting on the chore itself.
 * Choosing somebody records the pair; there is no Save, for the same reason the
 * assignee control has none — this is one fact, and a form around one fact is
 * the ceremony the bet exists to remove.
 *
 * The control is CONTROLLED AT THE EMPTY VALUE and never shows a selection. It
 * is an action rather than a state: the state is the list above it, which is
 * read back from the database on the next refresh. A select that kept the last
 * choice would read as "this is who cannot do it" while actually meaning "this
 * is who I last added", and those diverge the moment a second person is added.
 *
 * Nothing is offered when every member is already excluded — the alternative is
 * a control whose only option is the placeholder. That state is legitimate and
 * has a name: `eligible_members` returns the empty set, and #40 is where a
 * household is told a chore nobody may do cannot be allocated. It is not this
 * screen's job to invent a second sentence about it.
 */
function ExclusionControl({ chore, members, excludedIds, busy, onExclude, onAllow }) {
  const excluded = members.filter((m) => excludedIds.includes(m.id))
  const available = members.filter((m) => !excludedIds.includes(m.id))

  return (
    <div className="chore__exclusions" data-testid={`exclusions-${chore.id}`}>
      {excluded.length > 0 ? (
        <ul className="chore__exclusion-list">
          {excluded.map((m) => (
            <li className="chore__exclusion" key={m.id}>
              <span className="chore__exclusion-name">{m.display_name} cannot do this</span>
              <button
                className="button button--quiet"
                type="button"
                disabled={busy}
                aria-label={`Let ${m.display_name} do ${chore.title} again`}
                // Two-arm, for the reason the remove button gives: onAllow routes
                // through App's mutate(), which RETHROWS after recording the
                // message, so a bare call escapes as an unhandled rejection.
                onClick={() => onAllow(chore.id, m.id).then(() => {}, () => {})}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {available.length > 0 ? (
        <label className="chore__exclusion-add">
          <span className="field__label">Cannot do this</span>
          <select
            className="field__input"
            value=""
            disabled={busy}
            aria-label={`Mark someone as unable to do ${chore.title}`}
            onChange={(e) => {
              const chosen = e.target.value
              if (!chosen) return
              onExclude(chore.id, chosen).then(() => {}, () => {})
            }}
          >
            <option value="">Everyone can</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  )
}

ExclusionControl.propTypes = {
  chore: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
  excludedIds: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onExclude: PropTypes.func.isRequired,
  onAllow: PropTypes.func.isRequired,
}

/**
 * Skip one occurrence of a repeat — #105.
 *
 * ExclusionControl's shape on purpose: a select CONTROLLED AT THE EMPTY VALUE,
 * an action rather than a state, on the anchor row where the schedule already
 * lives. The state it changes is read back from the server on the next
 * refresh, like everything else here.
 *
 * WHAT IS OFFERED, and why it is a list rather than a date box: the dates of
 * outstanding instances the pass has already generated (skipping one removes
 * it — the ratified retroactivity rule, which is how "we're away next week"
 * still works after catch-up ran), then the schedule's next dates, up to
 * SKIP_OFFER_MAX_DATES of them. A free date box would accept a date the schedule
 * never visits and "succeed" — an inert row wearing a confirmation — where a
 * list can only offer dates that mean something. Dates already skipped are not
 * offered again.
 *
 * A COMPLETED occurrence's date is not offered: completed work is history, the
 * skip function would remove nothing, and offering it would read as a way to
 * un-do work. The anchor's own due date is not offered either — the anchor row
 * IS that occurrence, and removing it would be removing the schedule.
 */
function SkipControl({ chore, chores, repeatExceptions, todayIso, busy, onSkip }) {
  if (!todayIso) return null

  const skipped = new Set(
    repeatExceptions.filter((x) => x.chore_id === chore.id).map((x) => x.excluded_on),
  )
  const generated = new Set(
    chores.filter((c) => c.generated_from === chore.id && isOutstanding(c)).map((c) => c.due_on),
  )
  // ISO strings order lexicographically, so max() is a string comparison. The
  // schedule produces nothing at or before the anchor's own due date, so
  // offering from the later of (today, due date) offers only dates that exist.
  const from = todayIso >= chore.due_on ? todayIso : chore.due_on
  // #103's review: scan far enough that a MONTHLY schedule yields dates at all,
  // then cap the list at what a phone select can carry. A day-count horizon
  // shorter than the period offered nothing for days at a time, and — for an
  // anchor first due more than a horizon away — for weeks.
  const upcoming = upcomingOccurrenceDates(
    chore.repeat_kind,
    chore.repeat_weekdays,
    chore.repeat_monthday,
    from,
    SKIP_OFFER_SCAN_DAYS,
  )
  // Sliced AFTER merging and sorting, so an already-generated date can never be
  // pushed out of the list by future ones: those rows are real work sitting on
  // somebody's list today, and they sort earliest.
  const offered = [...new Set([...generated, ...upcoming])]
    .filter((date) => !skipped.has(date))
    .sort()
    .slice(0, SKIP_OFFER_MAX_DATES)
  // Feedback that a stored skip is real: without this line, skipping an
  // upcoming date changes nothing visible but the offer list. Spent dates
  // (today and older) are not restated — their effect is the row's absence.
  const upcomingSkipped = [...skipped].filter((date) => date > todayIso).sort()

  if (offered.length === 0 && upcomingSkipped.length === 0) return null

  return (
    <div className="chore__skip" data-testid={`skip-${chore.id}`}>
      {offered.length > 0 ? (
        <label className="chore__skip-add">
          <span className="field__label">Skip a date</span>
          <select
            className="field__input"
            value=""
            disabled={busy}
            aria-label={`Skip one date ${chore.title} repeats on`}
            onChange={(e) => {
              const chosen = e.target.value
              if (!chosen) return
              // Two-arm, for the reason every control here gives: onSkip routes
              // through App's mutate(), which RETHROWS after recording the
              // message.
              onSkip(chore.id, chosen).then(() => {}, () => {})
            }}
          >
            <option value="">This date, once&hellip;</option>
            {offered.map((date) => (
              <option key={date} value={date}>
                {generated.has(date) ? `${date} — already on the list` : date}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {upcomingSkipped.length > 0 ? (
        <p className="chore__skip-note" role="status">
          Won&apos;t repeat on {upcomingSkipped.join(', ')}
        </p>
      ) : null}
    </div>
  )
}

SkipControl.propTypes = {
  chore: PropTypes.object.isRequired,
  chores: PropTypes.array.isRequired,
  repeatExceptions: PropTypes.array.isRequired,
  todayIso: PropTypes.string,
  busy: PropTypes.bool,
  onSkip: PropTypes.func.isRequired,
}

/**
 * The chore is held by somebody marked as unable to do it — #37 ACs 6 and 7.
 *
 * ONE surface for two criteria, and that is a finding rather than a shortcut.
 * AC 6 describes assigning an excluded person; AC 7 describes excluding the
 * person already assigned. They are the same rendered state reached by two
 * orders of events, so building two would put two different sentences on screen
 * for one situation — and the household would have no way to tell which they had
 * caused.
 *
 * It is a STATEMENT, not a demand. #8's answer was a conflict flag in the task
 * list and in the household screen's attention area, and that was recommended
 * against: a flag asking a human to go and fix something is precisely the
 * negotiation the signature moment exists to remove, the same reasoning that
 * already ruled out an explicit re-balance button. So this names the person, says
 * what is true, and offers nothing to click.
 *
 * `role="status"` rather than `role="alert"`, and no `.error` class anywhere near
 * it. An alert interrupts a screen reader for something the person just did on
 * purpose, and the error palette is red — which this file's own stylesheet block
 * reserves for work, never for people.
 */
function ExcludedAssigneeNote({ chore, members }) {
  const holder = members.find((m) => m.id === chore.assigned_member_id)
  // A name this device cannot see, for `AssigneeSelect`'s reason: between another
  // phone removing a person and this one refreshing, the id names nobody. The
  // note still belongs on screen — the pairing is what is wrong, not the label —
  // so it degrades to the same wording that control uses rather than vanishing.
  const name = holder ? holder.display_name : 'Someone not on the roster'

  return (
    <p className="chore__warning" role="status">
      {name} is marked as unable to do this, and has it anyway.
    </p>
  )
}

ExcludedAssigneeNote.propTypes = {
  chore: PropTypes.object.isRequired,
  members: PropTypes.array.isRequired,
}

/**
 * "Took N min" on a done row — #12 AC 1's capture, in the one-tap shape the
 * owner ratified (2026-08-26, decision log): completion itself already stored
 * the estimate as the honest default, so this control is the path for saying
 * otherwise, prefilled with what is stored. Doing nothing IS the zero-tap
 * path — there is no sheet to dismiss.
 *
 * Keyed by the stored value at the call site, so a change arriving from
 * another device re-seeds the draft the same way `openEditor` re-seeds the
 * editor — a stale draft saved over a fresher value is the exact write-back
 * fault that comment describes.
 */
function ActualMinutesControl({ chore, busy, onRecordActual }) {
  const stored = chore.actual_minutes ?? chore.expected_minutes
  const [minutes, setMinutes] = useState(String(stored))
  const [complaint, setComplaint] = useState(null)

  return (
    <form
      className="chore__actual"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        // The refusal happens here, before any request — the same
        // validate-with-a-sentence contract as the add and edit forms, calling
        // the data layer's own normalizer rather than restating its rules.
        let clean
        try {
          clean = normalizeActualMinutes(minutes)
        } catch (err) {
          setComplaint(err.message)
          return
        }
        setComplaint(null)
        onRecordActual(chore.id, clean).then(() => {}, () => {})
      }}
    >
      <label className="chore__actual-field">
        <span className="field__label">Took (minutes)</span>
        <input
          className="field__input"
          type="number"
          // Zero is legal here, unlike the estimate fields — "it was already
          // done" is a real fact, and #47 pins that it contributes zero.
          min={0}
          max={MAX_EXPECTED_MINUTES}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-label={`Minutes ${chore.title} actually took`}
        />
      </label>
      <button className="button button--quiet" type="submit" disabled={busy}>
        Save
      </button>
      {complaint ? (
        <p className="error" role="alert">
          {complaint}
        </p>
      ) : null}
    </form>
  )
}

ActualMinutesControl.propTypes = {
  chore: PropTypes.object.isRequired,
  busy: PropTypes.bool,
  onRecordActual: PropTypes.func.isRequired,
}

/**
 * Expected versus average-actual for a chore's family — #12 ACs 2 and 3.
 *
 * Rendered on repeat ANCHORS, which are the rows an estimate update targets.
 * There is deliberately no detail screen for this to live on: the reimagined
 * app has three inline surfaces and no chore detail, so the feedback sits on
 * the row itself, beside the estimate it judges. One-offs need no separate
 * grouping for the same reason — a completed one-off already shows its own
 * "took N min" beside its estimate, which is AC 2's side-by-side for the
 * family of one.
 *
 * "no data yet" is AC 3's literal sentence: a repeat with no completed
 * instances shows those words, never an average fabricated from nothing.
 */
function ActualsFeedback({ chore, chores }) {
  const summary = actualsSummary(chore, chores)
  return (
    <p className="chore__feedback" data-testid={`feedback-${chore.id}`}>
      {summary === null
        ? 'no data yet'
        : `expected ${chore.expected_minutes} min · actually ~${Math.round(summary.averageMinutes)} min over ${summary.count} ${summary.count === 1 ? 'completion' : 'completions'}`}
    </p>
  )
}

ActualsFeedback.propTypes = {
  chore: PropTypes.object.isRequired,
  chores: PropTypes.array.isRequired,
}

// Exported since #302: the Done surface renders completed rows with this same
// component, so "Not done after all" and "Took (minutes)" are one
// implementation on two screens rather than two.
export function ChoreRow({
  chore,
  chores,
  members,
  exclusions,
  repeatExceptions,
  todayIso,
  busy,
  onSave,
  onRemove,
  onComplete,
  onUncomplete,
  onMiss,
  onUnmiss,
  onAssign,
  onUnassign,
  onExclude,
  onAllow,
  onSkip,
  onRecordActual,
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chore.title)
  const [minutes, setMinutes] = useState(String(chore.expected_minutes))
  const [dueOn, setDueOn] = useState(chore.due_on)
  const [editKind, setEditKind] = useState(chore.repeat_kind ?? 'none')
  const [editDays, setEditDays] = useState(chore.repeat_weekdays ?? [])
  const [editMonthday, setEditMonthday] = useState(
    chore.repeat_monthday != null ? String(chore.repeat_monthday) : '',
  )
  const [complaint, setComplaint] = useState(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  // A generated occurrence is ordinary work (#53 AC 7) and cannot itself
  // repeat — `chores_occurrence_does_not_repeat` refuses it whatever the form
  // sends — so its editor shows no schedule controls and its save carries no
  // repeat fields at all.
  const isOccurrence = chore.generated_from != null

  /**
   * Seed the editor from the row as it is NOW, every time it opens.
   *
   * `useState(chore.title)` runs only on the row's first render, and the row is
   * keyed by `chore.id` and never unmounts while the household is on screen —
   * so after another device's change arrives through refresh(), the list showed
   * the new value while the editor would have opened on the old one, and saving
   * would have written the stale value back over the other device's edit. The
   * initialisers above are now only the first-open default; this is the one
   * that matters.
   */
  function openEditor() {
    setTitle(chore.title)
    setMinutes(String(chore.expected_minutes))
    setDueOn(chore.due_on)
    setEditKind(chore.repeat_kind ?? 'none')
    setEditDays(chore.repeat_weekdays ?? [])
    setEditMonthday(chore.repeat_monthday != null ? String(chore.repeat_monthday) : '')
    setComplaint(null)
    setEditing(true)
  }

  function cancel() {
    setTitle(chore.title)
    setMinutes(String(chore.expected_minutes))
    setDueOn(chore.due_on)
    setEditKind(chore.repeat_kind ?? 'none')
    setEditDays(chore.repeat_weekdays ?? [])
    setEditMonthday(chore.repeat_monthday != null ? String(chore.repeat_monthday) : '')
    setComplaint(null)
    setEditing(false)
  }

  /**
   * Did the person actually change the schedule? — #54.
   *
   * The repeat pair travels in the save ONLY when it did. Not an optimisation:
   * an estimate-only or title-only edit then needs no UPDATE privilege on the
   * repeat columns, so every pre-#54 edit keeps working against a project
   * where `0024` is not yet applied — the client and the migration deploy on
   * different clocks, and this is the line that keeps an ordinary edit out of
   * the gap between them.
   */
  function repeatChanged() {
    const storedKind = chore.repeat_kind ?? 'none'
    const storedDays = [...(chore.repeat_weekdays ?? [])].sort((a, b) => a - b)
    const chosenDays = [...new Set(editDays)].sort((a, b) => a - b)
    const storedMonthday = chore.repeat_monthday != null ? String(chore.repeat_monthday) : ''
    return (
      editKind !== storedKind ||
      chosenDays.length !== storedDays.length ||
      chosenDays.some((d, i) => d !== storedDays[i]) ||
      editMonthday !== storedMonthday
    )
  }

  if (editing) {
    return (
      <li className="chore chore--editing">
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const withRepeat = !isOccurrence && repeatChanged()
            const repeatFields = withRepeat
              ? { repeatKind: editKind, repeatWeekdays: editDays, repeatMonthday: editMonthday }
              : {}
            const problem = validate({
              title,
              expectedMinutes: minutes,
              dueOn,
              ...repeatFields,
            })
            if (problem) {
              setComplaint(problem)
              return
            }
            setComplaint(null)
            onSave(chore.id, {
              title,
              expectedMinutes: minutes,
              dueOn,
              ...repeatFields,
            }).then(() => setEditing(false), () => {})
          }}
        >
          <label className="field">
            <span className="field__label">Chore</span>
            <input
              className="field__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              aria-label={`Name for ${chore.title}`}
            />
          </label>
          <label className="field">
            <span className="field__label">Expected minutes</span>
            <input
              className="field__input"
              type="number"
              min={MIN_EXPECTED_MINUTES}
              max={MAX_EXPECTED_MINUTES}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-label={`Expected minutes for ${chore.title}`}
            />
          </label>
          <label className="field">
            <span className="field__label">Due</span>
            <input
              className="field__input"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              aria-label={`Due date for ${chore.title}`}
            />
          </label>
          {/* #54 — the schedule is edited where the chore is edited. Changing
              it touches nothing already dated: occurrences copy their minutes
              at creation, so only what the pass creates from now on follows
              the new schedule, and switching off deletes nothing. */}
          {!isOccurrence ? (
            <RepeatControl
              kind={editKind}
              days={editDays}
              monthday={editMonthday}
              onKindChange={setEditKind}
              onDaysChange={setEditDays}
              onMonthdayChange={setEditMonthday}
              context={chore.title}
            />
          ) : null}
          {complaint ? (
            <p className="error" role="alert">
              {complaint}
            </p>
          ) : null}
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

  // #345 — the row's date has passed. Computed once here and used twice below,
  // so the class and the word can never disagree about the same row.
  const overdue = isOverdue(chore, todayIso, chores)

  return (
    // #305 — a missed row carries a modifier so the Done surface can dim it
    // without striking it through: a strike says finished, and this was not.
    // #345 adds a second, independent modifier: the two never coincide (an
    // overdue row is by definition outstanding), but they are separate facts
    // and the class list says so rather than nesting one inside the other.
    <li className={`chore${isMissed(chore) ? ' chore--missed' : ''}${overdue ? ' chore--overdue' : ''}`}>
      <div className="chore__identity">
        <span className="chore__identity-line">
          <span className="chore__title">{chore.title}</span>
          {/* #345 — the word, so colour is never the only carrier: a member
              who cannot separate the tint from the ink beside it still reads
              "overdue". BESIDE THE TITLE rather than beside the date it is
              about, which is where it started: measured at 360×800 in a real
              browser it wrapped the cost line to two, taking the row from
              282px to 302px and stranding a separator dot at the end of the
              first line. Gluing the dot to the word changed nothing — the
              wrap point is intrinsic at that width — so the fix is the
              position, not the punctuation. Here it also lands where a scan
              starts. */}
          {overdue ? <span className="chore__overdue">overdue</span> : null}
        </span>
        <span className="chore__cost">
          {chore.expected_minutes} min
          <span className="chore__cost-human"> ({formatMinutes(chore.expected_minutes)})</span>
          <span aria-hidden="true"> · </span>
          <span className="chore__due">due {chore.due_on}</span>
          {/* #53 — the schedule, read off the row's own columns, so what the
              screen says is what the database will do. A generated occurrence
              says nothing here on purpose: it is ordinary work (AC 7), and a
              badge would make it read as a different kind of chore. */}
          {describeRepeat(chore) ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="chore__repeat">{describeRepeat(chore)}</span>
            </>
          ) : null}
          {/* #12 AC 2 — a completed chore says what it cost beside what it was
              expected to cost. Null on rows completed before the column
              existed; every completion since stores a value (seeded or
              entered), so this renders on all new done work. */}
          {isCompleted(chore) && chore.actual_minutes != null ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="chore__took">took {chore.actual_minutes} min</span>
            </>
          ) : null}
          {/* #305 — a chore nobody did says so, in the same quiet tone as
              "took". Work, not a person: no name, no count, no red. */}
          {isMissed(chore) ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="chore__missed">not done</span>
            </>
          ) : null}
        </span>
        {/* #12 ACs 2–4 — feedback and the estimate update live on the repeat
            anchor, the row whose estimate the occurrences copy. */}
        {describeRepeat(chore) ? <ActualsFeedback chore={chore} chores={chores} /> : null}
        {describeRepeat(chore) && estimateSuggestion(chore, chores) != null ? (
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            // Accepting is an ordinary estimate edit on the anchor, so the
            // propagation is #54's ratified option (b) by construction:
            // occurrences copy minutes at creation, so the new estimate
            // reaches future occurrences and never moves committed work.
            onClick={() =>
              onSave(chore.id, { expectedMinutes: estimateSuggestion(chore, chores) }).then(
                () => {},
                () => {},
              )
            }
          >
            Update estimate to {estimateSuggestion(chore, chores)} min
          </button>
        ) : null}
        <AssigneeSelect
          chore={chore}
          members={members}
          busy={busy}
          onAssign={onAssign}
          onUnassign={onUnassign}
        />
        {/* #37 — the note sits directly under the control that causes it, so the
            two halves of the same fact are read together. The database refuses
            neither the assignment nor the exclusion: warn-and-allow is a rule
            about this screen, and `exclusions.pglite.test.js` asserts that the
            write succeeds so nobody later "fixes" it into a block. */}
        {isExcluded(exclusions, chore.id, chore.assigned_member_id) ? (
          <ExcludedAssigneeNote chore={chore} members={members} />
        ) : null}
        <ExclusionControl
          chore={chore}
          members={members}
          excludedIds={excludedMemberIds(exclusions, chore.id)}
          busy={busy}
          onExclude={onExclude}
          onAllow={onAllow}
        />
        {/* #105 — on the anchor, beside the schedule it edits. A generated
            occurrence gets nothing here: its date is skipped from its anchor,
            and the row's own Remove already exists for plain deletion. */}
        {describeRepeat(chore) ? (
          <SkipControl
            chore={chore}
            chores={chores}
            repeatExceptions={repeatExceptions}
            todayIso={todayIso}
            busy={busy}
            onSkip={onSkip}
          />
        ) : null}
      </div>

      <div className="row row--end row--actions">
        {isOutstanding(chore) ? (
          <>
            <button
              className="button"
              type="button"
              onClick={() => onComplete(chore.id).then(() => {}, () => {})}
              disabled={busy}
              aria-label={`Mark ${chore.title} done`}
            >
              Done
            </button>
            {/* #305 — the third exit, beside Done and no confirmation: it is
                reversed by "Put it back" on the missed row, and it destroys
                nothing. Quiet rather than primary, because Done is the thing a
                row is for. The accessible name avoids the word "done" on
                purpose — "Mark X not done" would match every query for the
                Done control. */}
            <button
              className="button button--quiet"
              type="button"
              onClick={() => onMiss(chore.id).then(() => {}, () => {})}
              disabled={busy}
              aria-label={`Say ${chore.title} did not happen`}
            >
              Didn&rsquo;t happen
            </button>
          </>
        ) : isMissed(chore) ? (
          // #305 — a missed row offers the way back and nothing else: no
          // "Took", because nothing was done and there is no time to record.
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onUnmiss(chore.id).then(() => {}, () => {})}
            disabled={busy}
            aria-label={`Put ${chore.title} back on the list — it was marked not done`}
          >
            Put it back
          </button>
        ) : (
          <>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => onUncomplete(chore.id).then(() => {}, () => {})}
              disabled={busy}
              aria-label={`Put ${chore.title} back on the list`}
            >
              Not done after all
            </button>
            <ActualMinutesControl
              key={`actual-${chore.actual_minutes ?? 'unset'}`}
              chore={chore}
              busy={busy}
              onRecordActual={onRecordActual}
            />
          </>
        )}
        <button
          className="button button--quiet"
          type="button"
          onClick={openEditor}
          disabled={busy}
          aria-label={`Edit ${chore.title}`}
        >
          Edit
        </button>
        {confirmingRemove ? (
          <>
            <button
              className="button button--danger"
              type="button"
              // The two-arm handler is not decoration: onRemove routes through
              // App's mutate(), which RETHROWS after recording the message, so
              // a bare call here escapes as an unhandled promise rejection. The
              // other two call sites in this file already do this.
              onClick={() => onRemove(chore.id).then(() => {}, () => {})}
              disabled={busy}
            >
              Remove {chore.title}?
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={busy}
            >
              Keep
            </button>
            {/* #54 AC 4 — the recorded choice, said where it is applied rather
                than only in a migration comment: deleting a repeat ends the
                schedule and KEEPS what it already created (0012's FK orphans
                the occurrences). Silent keeping reads later as a bug; this
                sentence is what makes it a decision. */}
            {describeRepeat(chore) ? (
              <p className="card__note" role="status">
                This ends the repeat. Chores it already put on the list stay there.
              </p>
            ) : null}
          </>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
            aria-label={`Remove ${chore.title}`}
          >
            Remove
          </button>
        )}
      </div>
    </li>
  )
}

ChoreRow.propTypes = {
  chore: PropTypes.object.isRequired,
  chores: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  exclusions: PropTypes.array.isRequired,
  repeatExceptions: PropTypes.array.isRequired,
  todayIso: PropTypes.string,
  busy: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onComplete: PropTypes.func.isRequired,
  onUncomplete: PropTypes.func.isRequired,
  onMiss: PropTypes.func.isRequired,
  onUnmiss: PropTypes.func.isRequired,
  onAssign: PropTypes.func.isRequired,
  onUnassign: PropTypes.func.isRequired,
  onExclude: PropTypes.func.isRequired,
  onAllow: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  onRecordActual: PropTypes.func.isRequired,
}

/**
 * The events a connected member could import, and the consent step in front
 * of them — #101 AC 1 and AC 2.
 *
 * Owns the OPEN/CLOSED state and the transient list, and nothing about what a
 * chore is: `onPick(event)` hands the chosen event to the tab, which prefills
 * its own form. `onFetchEvents` resolves to the Edge Function's answer and is
 * NOT routed through App's `mutate()` — nothing is written, so there is no
 * change to re-read and no `busy` to set over the rest of the tab; the section
 * carries its own pending state for the one thing that is waiting.
 *
 * `hasEventReadScope(connection)` decides which of two things the open section
 * shows. The connection row is the readable half of what Google granted
 * (`0011` stores the token response's scope), so a #95 connection reads as
 * free/busy-only here and gets the consent step; the Edge Function refuses the
 * same token with `needsScope`, which lands here too when the row is stale.
 */
function CalendarImport({
  connection,
  imports,
  busy,
  timeZone,
  onFetchEvents,
  onWidenConsent,
  onPick,
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [events, setEvents] = useState(null)
  const [complaint, setComplaint] = useState(null)
  const [needsScope, setNeedsScope] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const canRead = hasEventReadScope(connection)
  const imported = importedEventIds(imports)

  async function load() {
    setPending(true)
    setComplaint(null)
    setNeedsScope(false)
    try {
      const result = await onFetchEvents()
      if (!mounted.current) return
      setEvents(Array.isArray(result?.events) ? result.events : [])
    } catch (err) {
      // The tab may have been left while Google was thinking. Nothing to show,
      // and nothing was written.
      if (!mounted.current) return
      setEvents(null)
      setComplaint(err?.message ?? String(err))
      setNeedsScope(Boolean(err?.needsScope))
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  function openSection() {
    setOpen(true)
    if (canRead) load()
  }

  function close() {
    // The list is TRANSIENT (AC 2): closing forgets it, and the next open reads
    // the calendar again rather than showing a week that may have moved on.
    setOpen(false)
    setEvents(null)
    setComplaint(null)
    setNeedsScope(false)
  }

  if (!open) {
    return (
      <button className="button button--quiet" type="button" disabled={busy} onClick={openSection}>
        Import from calendar
      </button>
    )
  }

  return (
    <section className="chore-import" aria-labelledby="import-heading" data-testid="calendar-import">
      <h3 id="import-heading" className="card__subheading">
        Import from your calendar
      </h3>
      {!canRead || needsScope ? (
        <>
          {/* AC 1 — the scope widening is a SECOND consent, said plainly: what
              Taskr can see today, what it needs, and that Google asks once. */}
          <p className="card__body" data-testid="import-consent">
            Taskr can see when you’re busy, not what’s on your calendar. To import an event it
            needs to read event titles — Google will ask you once, and Taskr keeps only the id
            of an event you import.
          </p>
          <div className="row">
            <button className="button" type="button" disabled={busy} onClick={onWidenConsent}>
              Allow reading events
            </button>
            <button className="button button--quiet" type="button" disabled={busy} onClick={close}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          {pending ? (
            <p className="capture__outcome" role="status" data-testid="import-pending">
              Reading your calendar…
            </p>
          ) : null}
          {complaint ? (
            <p className="capture__outcome" role="status" data-testid="import-complaint">
              {complaint}
            </p>
          ) : null}
          {events && events.length === 0 ? (
            <p className="card__body">Nothing upcoming on your calendar this week.</p>
          ) : null}
          {events && events.length > 0 ? (
            <ul className="chore-import__list">
              {events.map((event) => {
                const title = event.title || 'Untitled event'
                const when = eventWhenLabel(event, timeZone)
                const length =
                  Number.isFinite(event.durationMinutes) && event.durationMinutes > 0
                    ? formatMinutes(event.durationMinutes)
                    : null
                // AC 5 — already imported is a state, not a control: the mark
                // is drawn where Use would be, and Use is absent rather than
                // disabled, so nothing offers a second import that the ledger
                // would refuse.
                const done = imported.has(event.id)
                return (
                  <li key={event.id} className="chore-import__event">
                    <span className="chore-import__title">{title}</span>
                    {when || length ? (
                      <span className="chore-import__when">
                        {[when, length].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    {done ? (
                      <span className="chore-import__done" data-testid={`imported-${event.id}`}>
                        Already imported
                      </span>
                    ) : (
                      <button
                        className="button button--quiet"
                        type="button"
                        disabled={busy}
                        onClick={() => onPick(event)}
                        aria-label={`Import ${title}`}
                      >
                        Use
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
          <div className="row">
            <button
              className="button button--quiet"
              type="button"
              disabled={busy || pending}
              onClick={load}
            >
              Read again
            </button>
            <button className="button button--quiet" type="button" disabled={busy} onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </section>
  )
}

CalendarImport.propTypes = {
  connection: PropTypes.object.isRequired,
  imports: PropTypes.array,
  busy: PropTypes.bool,
  timeZone: PropTypes.string,
  onFetchEvents: PropTypes.func.isRequired,
  onWidenConsent: PropTypes.func.isRequired,
  onPick: PropTypes.func.isRequired,
}

export default function Chores({
  chores,
  members,
  exclusions,
  repeatExceptions,
  todayIso,
  timezone,
  periodStart,
  busy,
  error,
  onAdd,
  onShowDone,
  onAddMany,
  onPropose,
  calendarConnection,
  calendarImports,
  onFetchCalendarEvents,
  onWidenCalendarConsent,
  onImportEvent,
  onSave,
  onRemove,
  onComplete,
  onUncomplete,
  onMiss,
  onUnmiss,
  onAssign,
  onUnassign,
  onExclude,
  onAllow,
  onSkip,
  onRecordActual,
}) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const [dueOn, setDueOn] = useState('')
  // #53 — the repeat is set HERE, where the chore is created, as a property of
  // the chore. There is deliberately no templates screen and no template
  // object anywhere: a second place to define the household's work is a second
  // evening of data entry, which is the universal killer the field scan names.
  const [repeatKind, setRepeatKind] = useState('none')
  const [repeatDays, setRepeatDays] = useState([])
  const [repeatMonthday, setRepeatMonthday] = useState('')
  const [complaint, setComplaint] = useState(null)

  // #220 — enter several chores in one pass. The single form above stays the
  // default path (AC 6); this panel is an addition behind its own button, and
  // NOTHING is written until the list is confirmed: the drafts live only in
  // this state until `confirmBatch` hands them to onAddMany.
  const [batchOpen, setBatchOpen] = useState(false)
  const [drafts, setDrafts] = useState([])
  // The partial-save summary — AC 5's "told which rows were saved". Null when
  // there is nothing to say.
  const [batchNotice, setBatchNotice] = useState(null)
  const draftKey = useRef(1)

  // #213 — the rows a description proposed, held here (not in the shell)
  // because they are EDITED in place and the shell knows nothing about what a
  // proposal contains. Unwritten by construction until `confirmProposed`.
  // `shellKey` remounts the shell to clear a settled or discarded proposal —
  // the shell keeps its own result state and exposes no reset, and Roster
  // closes its editor the same way.
  const [proposed, setProposed] = useState([])
  const [proposedNotice, setProposedNotice] = useState(null)
  const [shellKey, setShellKey] = useState(0)

  // #101 — the event the single form is currently an import OF, or null. Held
  // here because the form is here: picking an event prefills the fields above
  // and marks the submit as an import, and the mark travels with the write
  // (`onImportEvent` gets the event id) rather than being inferred from the
  // title. `title` is kept for the source line only.
  const [importing, setImporting] = useState(null)
  const titleRef = useRef(null)

  const importReady = Boolean(
    calendarConnection && onFetchCalendarEvents && onWidenCalendarConsent && onImportEvent,
  )

  /**
   * Take an event into the form — #101 AC 3. A prefill and a mark, and
   * deliberately not a write: the member is looking at a chore they have not
   * yet agreed to, and Add is where they agree. The repeat is cleared and the
   * control hidden while importing, because an imported event is a ONE-TIME
   * chore by the story's terms. Focus follows the prefill so the member is
   * looking at the field they will edit, not the button they pressed.
   */
  function pickEvent(event) {
    const prefill = eventChorePrefill(event)
    setTitle(prefill.title)
    setMinutes(prefill.expectedMinutes)
    setDueOn(prefill.dueOn)
    setRepeatKind('none')
    setRepeatDays([])
    setRepeatMonthday('')
    setComplaint(null)
    setImporting({ eventId: event.id, title: prefill.title || 'this event' })
    // Guarded: jsdom has no scrollIntoView, and a test that renders this tab
    // must not need one to exist.
    titleRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    titleRef.current?.focus?.()
  }

  function freshDraft() {
    return { key: `draft-${draftKey.current++}`, title: '', minutes: '', dueOn: '', problem: null }
  }

  function openBatch() {
    // Two rows, not one: the panel exists for SEVERAL, and an untouched spare
    // costs nothing because confirmBatch skips rows left entirely blank.
    setDrafts([freshDraft(), freshDraft()])
    setBatchNotice(null)
    setBatchOpen(true)
  }

  function cancelBatch() {
    // The drafts are unwritten by construction, so cancelling discards them.
    setDrafts([])
    setBatchNotice(null)
    setBatchOpen(false)
  }

  const changeDraft = (key, patch) =>
    setDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch, problem: null } : r)))
  const removeDraft = (key) => setDrafts((rows) => rows.filter((r) => r.key !== key))

  /**
   * The same per-field validators the data layer calls — AC 3. Returning the
   * message keeps "marked with the reason" testable, exactly as `validate`
   * above argues for the single form. No repeat fields: a batch row is title,
   * minutes and due date, and addChore writes 'none' for a caller that says
   * nothing about repeating.
   */
  function draftProblem({ title, minutes, dueOn }) {
    try {
      normalizeTitle(title)
      normalizeExpectedMinutes(minutes)
      normalizeDueDate(dueOn)
      return null
    } catch (err) {
      return err.message
    }
  }

  function confirmBatch(e) {
    e.preventDefault()
    // A row left entirely blank carries no intent and is dropped rather than
    // refused — the spare row openBatch adds must not hold the batch hostage.
    // A row with ANYTHING in it is validated in full.
    const entered = drafts.filter(
      (d) => d.title.trim() !== '' || String(d.minutes).trim() !== '' || d.dueOn.trim() !== '',
    )
    if (entered.length === 0) {
      setBatchNotice('nothing entered yet — fill in at least one chore.')
      return
    }

    // AC 3 — every entered row is checked BEFORE anything is written. One bad
    // row marks itself and blocks the write; the others stay entered, edited
    // rather than retyped. Writing the good rows here instead would turn a
    // typo into a surprise partial save — partial is AC 5's territory, and it
    // is reserved for the server refusing a row the client could not fault.
    let anyBad = false
    const checked = entered.map((row) => {
      const problem = draftProblem(row)
      if (problem) anyBad = true
      return { ...row, problem }
    })
    setDrafts(checked)
    setBatchNotice(null)
    if (anyBad) return

    onAddMany(
      checked.map(({ title, minutes, dueOn }) => ({ title, expectedMinutes: minutes, dueOn })),
    ).then(
      (outcomes) => {
        // One outcome per submitted row, in order — addChores' contract. Saved
        // rows are PRUNED from the drafts, which is what makes re-confirming
        // unable to duplicate them (AC 5): the next confirm submits only what
        // is still listed.
        const { remaining, notice } = settleBatch(checked, outcomes)
        if (remaining.length === 0) {
          cancelBatch()
        } else {
          setDrafts(remaining)
          setBatchNotice(notice)
        }
      },
      // onAddMany routes through App's mutate(), which rethrows only when the
      // whole action failed (addChores itself reports per-row outcomes rather
      // than throwing). mutate has already put that message on screen; the
      // drafts stay listed, the same exposure the single form has when onAdd
      // rejects.
      () => {},
    )
  }

  // ---- #213 — the proposal list ---------------------------------------------

  const changeProposed = (key, patch) =>
    setProposed((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch, problem: null } : r)))
  // AC 9 — a removed row is gone from the list, so it is not in what confirm
  // sends, and no placeholder is left where it was.
  const removeProposed = (key) => setProposed((rows) => rows.filter((r) => r.key !== key))

  function discardProposal() {
    setProposed([])
    setProposedNotice(null)
    setShellKey((k) => k + 1)
  }

  function confirmProposed(e) {
    e.preventDefault()
    if (proposed.length === 0) {
      setProposedNotice('nothing left to add — every row was removed.')
      return
    }
    // AC 5, AC 7 — every row is checked BEFORE anything is written, with the
    // same validators the batch panel and the single form call. A row that
    // arrived marked and was never edited still carries a complaint here, so
    // it cannot be confirmed as it stands; a row the member fixed passes.
    let anyBad = false
    const checked = proposed.map((row) => {
      const problem = draftProblem(row)
      if (problem) anyBad = true
      return { ...row, problem }
    })
    setProposed(checked)
    setProposedNotice(null)
    if (anyBad) return

    // AC 9 — each row goes through the same addChore path a typed chore uses,
    // recorded with where it came from. `source` is the ONE thing this write
    // adds to a typed batch's, and the data layer's `addChores` spreads the
    // row into `addChore`, so it lands on the column #211 added.
    onAddMany(
      checked.map(({ title, minutes, dueOn }) => ({
        title,
        expectedMinutes: minutes,
        dueOn,
        source: 'extraction',
      })),
    ).then(
      (outcomes) => {
        const { remaining, notice } = settleBatch(checked, outcomes)
        if (remaining.length === 0) {
          discardProposal()
        } else {
          setProposed(remaining)
          setProposedNotice(notice)
        }
      },
      () => {},
    )
  }

  // #213 — the single form is the manual road in, rendered ONCE and placed
  // inside the shell when a proposer is wired (its children, on screen
  // throughout) and bare when there is not, so the #34 surface is the same
  // element either way.
  const singleForm = (
      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          // #101 — an import is a ONE-TIME chore, so the schedule fields are
          // 'none' by construction while the form is an import, whatever the
          // hidden control's state was before the pick.
          const schedule = importing
            ? { repeatKind: 'none', repeatWeekdays: [], repeatMonthday: '' }
            : { repeatKind, repeatWeekdays: repeatDays, repeatMonthday }
          const chore = { title, expectedMinutes: minutes, dueOn, ...schedule }
          const problem = validate(chore)
          if (problem) {
            // AC 2: the refusal happens here, before onAdd is ever called, so a
            // bad value never becomes a request.
            setComplaint(problem)
            return
          }
          setComplaint(null)
          // #101 AC 3 — the SAME submit, the same fields; the one difference is
          // which handler App is asked to run, and App's import handler calls
          // the same `addChore` a typed chore does and then records the event
          // id. A second submit button would have been a second write path.
          const write = importing ? onImportEvent(chore, importing.eventId) : onAdd(chore)
          write.then(
            () => {
              setTitle('')
              setMinutes('')
              setDueOn('')
              setRepeatKind('none')
              setRepeatDays([])
              setRepeatMonthday('')
              setImporting(null)
            },
            () => {},
          )
        }}
      >
        <label className="field">
          <span className="field__label">Chore</span>
          <input
            ref={titleRef}
            className="field__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="Dishes"
          />
        </label>
        <label className="field">
          <span className="field__label">Expected minutes</span>
          <input
            className="field__input"
            type="number"
            min={MIN_EXPECTED_MINUTES}
            max={MAX_EXPECTED_MINUTES}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="20"
          />
        </label>
        <label className="field">
          <span className="field__label">Due</span>
          <input
            className="field__input"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </label>
        {/* #53's controls, now the shared component #54's edit form also
            renders — one copy of the schedule vocabulary. Hidden while the
            form is an import (#101): an imported event is a one-time chore. */}
        {importing ? null : (
          <RepeatControl
            kind={repeatKind}
            days={repeatDays}
            monthday={repeatMonthday}
            onKindChange={setRepeatKind}
            onDaysChange={setRepeatDays}
            onMonthdayChange={setRepeatMonthday}
          />
        )}
        {/* #101 — where the fields came from, and the way to say they no longer
            do. "Not from the calendar" keeps whatever the member has typed and
            turns the submit back into an ordinary add, so an event used as a
            starting point costs nothing to disown. */}
        {importing ? (
          <p className="chore-import__source" data-testid="import-source">
            From your calendar · {importing.title}{' '}
            <button
              className="button button--link"
              type="button"
              disabled={busy}
              onClick={() => setImporting(null)}
            >
              Not from the calendar
            </button>
          </p>
        ) : null}
        {complaint ? (
          <p className="error" role="alert">
            {complaint}
          </p>
        ) : null}
        <button className="button" type="submit" disabled={busy}>
          Add chore
        </button>
      </form>
    )


  const outstanding = chores.filter(isOutstanding)
  const done = chores.filter((c) => !isOutstanding(c))
  // #302 AC 1 — the one number this tab still says about finished work. Both
  // props arrive from App's refresh; between the household read and the period
  // read there is a render where periodStart is still null, and a count of
  // zero for that frame is the honest reading rather than a crash.
  const doneThisWeek = timezone && periodStart ? countDoneInWeek(chores, timezone, periodStart) : 0

  return (
    <section className="card" aria-labelledby="chores-heading">
      <h2 id="chores-heading" className="card__heading">
        What needs doing
      </h2>

      {chores.length === 0 ? (
        <p className="card__body">
          No chores yet. Write down what actually needs doing this week and how long each one
          takes — the split is proportional to those minutes, so they are worth being honest
          about.
        </p>
      ) : null}

      {outstanding.length > 0 ? (
        <>
          <ul className="chore-list">
            {outstanding.map((chore) => (
              <ChoreRow
                key={chore.id}
                chore={chore}
                chores={chores}
                members={members}
                exclusions={exclusions}
                repeatExceptions={repeatExceptions}
                todayIso={todayIso}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
                onComplete={onComplete}
                onUncomplete={onUncomplete}
                onMiss={onMiss}
                onUnmiss={onUnmiss}
                onAssign={onAssign}
                onUnassign={onUnassign}
                onExclude={onExclude}
                onAllow={onAllow}
                onSkip={onSkip}
                onRecordActual={onRecordActual}
              />
            ))}
          </ul>
          {/* A household figure, not a per-person one. #34's fence forbade an
              aggregate because there was nothing to aggregate — completion is
              what makes "still to do" a real quantity, and it is the number the
              allocation in #40 will divide. Nothing here ranks anybody. */}
          <p className="card__note" data-testid="outstanding-total">
            {outstanding.length} still to do · {outstandingMinutes(chores)} min
            <span className="chore__cost-human"> ({formatMinutes(outstandingMinutes(chores))})</span>
          </p>
        </>
      ) : null}

      {/* The per-person load figures lived here until #47. They have not been
          dropped — they moved to the Split surface, which draws each person's
          load as a share of THEIR OWN capacity, which is the number that
          actually means something. #36 shipped them here in deliberately the
          ugliest honest form and its own comment said #47 owned the
          presentation and would replace this. Leaving both would put two
          answers to one question on two screens, which is the fault
          capacity.js's docstring calls invisible. */}

      {/* #302 — completed work LEFT this tab. Until then every completed chore
          ever rendered here under a heading reading "Done this week", which
          nothing bounded to a week: it was false from the household's second
          week on and grew by a screen a week once the daily repeats landed.
          The rows still exist (#12 reads them, #105 keeps them); they now
          live on the Done tab, grouped by capacity week. What stays here is
          one line saying how many were finished THIS week, and it is the way
          there. It renders whenever anything has ever been completed — with a
          zero — because a household that finished things last week and
          nothing yet this week should still be able to find them. */}
      {done.length > 0 ? (
        <p className="card__note chore-done-line">
          <button
            className="button button--quiet"
            type="button"
            onClick={onShowDone}
            disabled={busy}
            data-testid="done-this-week"
          >
            {doneThisWeek} done this week · see Done
          </button>
        </p>
      ) : null}

      {onPropose ? (
        <CaptureShell
          key={shellKey}
          label="What needs doing this week?"
          placeholder="Mow the lawn on Saturday, about 45 minutes. Dishes tonight, 20 minutes."
          describeLabel="Work out the chores"
          manualHint="Type them in below instead."
          busy={busy}
          onDescribe={async (text) => {
            const result = await onPropose(text)
            if (result?.outcome === CAPTURE_OUTCOMES.PROPOSAL) {
              setProposed(result.rows)
              setProposedNotice(null)
            }
            return result
          }}
          renderProposal={() => (
            // The #220 review list, fed from proposals — AC 1, AC 2: one row
            // per chore the description named, each editable and removable,
            // nothing written until "Add these chores". Its own form, a
            // SIBLING of the single form inside the shell's div, never a
            // parent of it: the two writes are different confirms.
            <form
              className="chore-proposal"
              noValidate
              onSubmit={confirmProposed}
              aria-label="Chores read from your description"
            >
              <p className="capture__figure">
                {proposed.length === 1 ? 'One chore read' : `${proposed.length} chores read`} from
                what you wrote. Check each one, then add them.
              </p>
              <ChoreDraftList
                rows={proposed}
                busy={busy}
                onChange={changeProposed}
                onRemove={removeProposed}
              />
              {proposedNotice ? (
                <p className="card__note" role="status" data-testid="proposal-notice">
                  {proposedNotice}
                </p>
              ) : null}
              <div className="row">
                <button className="button" type="submit" disabled={busy}>
                  Add these chores
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy}
                  onClick={discardProposal}
                >
                  Discard
                </button>
              </div>
            </form>
          )}
        >
          {singleForm}
        </CaptureShell>
      ) : (
        singleForm
      )}

      {/* #101 — the third way in, beside the form it prefills. Mounts only for
          a member whose own calendar is connected, and only when App has wired
          all three handlers; a tab rendered without them is the #34 surface. */}
      {importReady ? (
        <CalendarImport
          connection={calendarConnection}
          imports={calendarImports ?? []}
          busy={busy}
          timeZone={timezone}
          onFetchEvents={onFetchCalendarEvents}
          onWidenConsent={onWidenCalendarConsent}
          onPick={pickEvent}
        />
      ) : null}

      {/* #220 — the batch entry. An ADDITION behind its own control, never a
          replacement: the single form above is untouched and stays the default
          path (AC 6). The review list is ChoreDraftList, which #213 will feed
          from extracted proposals — it takes rows as input and owns nothing
          about where they came from (AC 7). */}
      {batchOpen ? (
        <section className="chore-batch" aria-labelledby="batch-heading">
          <h3 id="batch-heading" className="card__subheading">
            Add several at once
          </h3>
          <form className="stack" noValidate onSubmit={confirmBatch}>
            <ChoreDraftList rows={drafts} busy={busy} onChange={changeDraft} onRemove={removeDraft} />
            {batchNotice ? (
              <p className="card__note" role="status" data-testid="batch-notice">
                {batchNotice}
              </p>
            ) : null}
            <div className="row">
              <button
                className="button button--quiet"
                type="button"
                disabled={busy}
                onClick={() => setDrafts((rows) => [...rows, freshDraft()])}
              >
                Add another row
              </button>
              <button className="button" type="submit" disabled={busy}>
                Add these chores
              </button>
              <button
                className="button button--quiet"
                type="button"
                disabled={busy}
                onClick={cancelBatch}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : (
        <button className="button button--quiet" type="button" disabled={busy} onClick={openBatch}>
          Add several at once
        </button>
      )}

      {/* A failed write used to report itself only inside the Roster card, in a
          different section of the page, because <Chores> was passed no `error`.
          The message belongs beside the form that caused it. `complaint` above
          is the client-side refusal; this is the server's. */}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {/* A failed write used to report itself only inside the Roster card, in a
          different section of the page, because <Chores> was passed no `error`.
          The message belongs beside the form that caused it. `complaint` above
          is the client-side refusal; this is the server's. */}
    </section>
  )
}

Chores.propTypes = {
  chores: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  exclusions: PropTypes.array.isRequired,
  repeatExceptions: PropTypes.array.isRequired,
  todayIso: PropTypes.string,
  // #302 — which capacity week is "this" one, and in whose zone. Optional only
  // because App renders this surface one frame before its period read lands.
  timezone: PropTypes.string,
  periodStart: PropTypes.string,
  busy: PropTypes.bool,
  error: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onAddMany: PropTypes.func.isRequired,
  // #213 — optional: the tab without it is exactly the #34 surface (AC 10).
  onPropose: PropTypes.func,
  // #101 — all optional, and the import control mounts only with all four:
  // the signed-in member's own connection row (null when none), the household's
  // import ledger, and the three handlers. Without them the tab is unchanged.
  calendarConnection: PropTypes.object,
  calendarImports: PropTypes.array,
  onFetchCalendarEvents: PropTypes.func,
  onWidenCalendarConsent: PropTypes.func,
  onImportEvent: PropTypes.func,
  onShowDone: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onComplete: PropTypes.func.isRequired,
  onUncomplete: PropTypes.func.isRequired,
  onMiss: PropTypes.func.isRequired,
  onUnmiss: PropTypes.func.isRequired,
  onAssign: PropTypes.func.isRequired,
  onUnassign: PropTypes.func.isRequired,
  onExclude: PropTypes.func.isRequired,
  onAllow: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  onRecordActual: PropTypes.func.isRequired,
}
