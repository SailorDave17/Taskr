import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  MAX_EXPECTED_MINUTES,
  MIN_EXPECTED_MINUTES,
  commitmentByMember,
  formatMinutes,
  isOutstanding,
  normalizeDueDate,
  normalizeExpectedMinutes,
  normalizeTitle,
  outstandingMinutes,
} from '../lib/chores.js'
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

/**
 * Run the data layer's own validators and return the first complaint, or null.
 *
 * Returning the message rather than a boolean is what makes "refuses with a
 * sentence" testable: a boolean would let the UI invent its own wording, and
 * then the sentence a person reads would be untested.
 */
function validate({ title, expectedMinutes, dueOn }) {
  try {
    normalizeTitle(title)
    normalizeExpectedMinutes(expectedMinutes)
    normalizeDueDate(dueOn)
    return null
  } catch (err) {
    return err.message
  }
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
 * What each person is carrying, and what is left of their week — #36 AC 5, 6, 9.
 *
 * Deliberately the ugliest honest form: plain minutes, in roster order, with no
 * bar, no rank, no percentage and no sort-by-load. The charter says outright
 * that a proposal satisfiable by a screenshot of the 2020 all-users view has
 * collapsed, and every one of those four would be that screenshot. #47 owns the
 * presentation — share of each person's OWN capacity, which is the number that
 * actually means something — and replaces this. Replacing plain text is cheap;
 * un-shipping a leaderboard is not.
 *
 * An over-committed person reads "40m over" rather than "0m left". AC 6 asks for
 * exactly that, and `formatMinutes` clamps at zero, so the sign is decided here
 * and only the magnitude is handed to the formatter.
 */
function Commitment({ members, chores, capacities }) {
  const rows = commitmentByMember(members, chores, capacities)

  return (
    <section className="chore-load" aria-labelledby="load-heading">
      <h3 id="load-heading" className="card__subheading">
        Who is carrying what
      </h3>
      <ul className="chore-load__list">
        {rows.map(({ member, committedMinutes, remainingMinutes }) => (
          <li className="chore-load__row" key={member.id} data-testid={`load-${member.id}`}>
            <span className="chore-load__name">{member.display_name}</span>
            <span className="chore-load__figures">
              {committedMinutes} min committed
              <span aria-hidden="true"> · </span>
              {remainingMinutes < 0
                ? `${Math.abs(remainingMinutes)} min over`
                : `${remainingMinutes} min left`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

Commitment.propTypes = {
  members: PropTypes.array.isRequired,
  chores: PropTypes.array.isRequired,
  capacities: PropTypes.array.isRequired,
}

function ChoreRow({
  chore,
  members,
  exclusions,
  busy,
  onSave,
  onRemove,
  onComplete,
  onUncomplete,
  onAssign,
  onUnassign,
  onExclude,
  onAllow,
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chore.title)
  const [minutes, setMinutes] = useState(String(chore.expected_minutes))
  const [dueOn, setDueOn] = useState(chore.due_on)
  const [complaint, setComplaint] = useState(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

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
    setComplaint(null)
    setEditing(true)
  }

  function cancel() {
    setTitle(chore.title)
    setMinutes(String(chore.expected_minutes))
    setDueOn(chore.due_on)
    setComplaint(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="chore chore--editing">
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const problem = validate({ title, expectedMinutes: minutes, dueOn })
            if (problem) {
              setComplaint(problem)
              return
            }
            setComplaint(null)
            onSave(chore.id, { title, expectedMinutes: minutes, dueOn }).then(
              () => setEditing(false),
              () => {},
            )
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

  return (
    <li className="chore">
      <div className="chore__identity">
        <span className="chore__title">{chore.title}</span>
        <span className="chore__cost">
          {chore.expected_minutes} min
          <span className="chore__cost-human"> ({formatMinutes(chore.expected_minutes)})</span>
          <span aria-hidden="true"> · </span>
          <span className="chore__due">due {chore.due_on}</span>
        </span>
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
      </div>

      <div className="row row--end row--actions">
        {isOutstanding(chore) ? (
          <button
            className="button"
            type="button"
            onClick={() => onComplete(chore.id).then(() => {}, () => {})}
            disabled={busy}
            aria-label={`Mark ${chore.title} done`}
          >
            Done
          </button>
        ) : (
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onUncomplete(chore.id).then(() => {}, () => {})}
            disabled={busy}
            aria-label={`Put ${chore.title} back on the list`}
          >
            Not done after all
          </button>
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
  members: PropTypes.array.isRequired,
  exclusions: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onComplete: PropTypes.func.isRequired,
  onUncomplete: PropTypes.func.isRequired,
  onAssign: PropTypes.func.isRequired,
  onUnassign: PropTypes.func.isRequired,
  onExclude: PropTypes.func.isRequired,
  onAllow: PropTypes.func.isRequired,
}

export default function Chores({
  chores,
  members,
  capacities,
  exclusions,
  busy,
  error,
  onAdd,
  onSave,
  onRemove,
  onComplete,
  onUncomplete,
  onAssign,
  onUnassign,
  onExclude,
  onAllow,
}) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [complaint, setComplaint] = useState(null)

  const outstanding = chores.filter(isOutstanding)
  const done = chores.filter((c) => !isOutstanding(c))

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
                members={members}
                exclusions={exclusions}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
                onComplete={onComplete}
                onUncomplete={onUncomplete}
                onAssign={onAssign}
                onUnassign={onUnassign}
                onExclude={onExclude}
                onAllow={onAllow}
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

      {/* Keyed on the ROSTER, not on the chore list, so a person carrying
          nothing still appears — AC 6. Hiding the empty-handed is how a load
          view stops being a fairness view. */}
      {members.length > 0 ? (
        <Commitment members={members} chores={chores} capacities={capacities} />
      ) : null}

      {done.length > 0 ? (
        <section className="chore-done" aria-labelledby="done-heading">
          {/* Completed work stays VISIBLE in its own group rather than
              vanishing, so the household can see the week's work was actually
              done. Deliberately carries no streak, no rank, no score, no
              per-person total, and no error or alert styling: red is for work,
              never for people. A component test fails if any appears. */}
          <h3 id="done-heading" className="card__subheading">
            Done this week
          </h3>
          <ul className="chore-list chore-list--done">
            {done.map((chore) => (
              <ChoreRow
                key={chore.id}
                chore={chore}
                members={members}
                exclusions={exclusions}
                busy={busy}
                onSave={onSave}
                onRemove={onRemove}
                onComplete={onComplete}
                onUncomplete={onUncomplete}
                onAssign={onAssign}
                onUnassign={onUnassign}
                onExclude={onExclude}
                onAllow={onAllow}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const problem = validate({ title, expectedMinutes: minutes, dueOn })
          if (problem) {
            // AC 2: the refusal happens here, before onAdd is ever called, so a
            // bad value never becomes a request.
            setComplaint(problem)
            return
          }
          setComplaint(null)
          onAdd({ title, expectedMinutes: minutes, dueOn }).then(
            () => {
              setTitle('')
              setMinutes('')
              setDueOn('')
            },
            () => {},
          )
        }}
      >
        <label className="field">
          <span className="field__label">Chore</span>
          <input
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
        {complaint ? (
          <p className="error" role="alert">
            {complaint}
          </p>
        ) : null}
        <button className="button" type="submit" disabled={busy}>
          Add chore
        </button>
      </form>

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
  capacities: PropTypes.array.isRequired,
  exclusions: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  error: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  onComplete: PropTypes.func.isRequired,
  onUncomplete: PropTypes.func.isRequired,
  onAssign: PropTypes.func.isRequired,
  onUnassign: PropTypes.func.isRequired,
  onExclude: PropTypes.func.isRequired,
  onAllow: PropTypes.func.isRequired,
}
