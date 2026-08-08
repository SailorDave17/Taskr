import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  MAX_EXPECTED_MINUTES,
  MIN_EXPECTED_MINUTES,
  formatMinutes,
  normalizeDueDate,
  normalizeExpectedMinutes,
  normalizeTitle,
} from '../lib/chores.js'

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
// Deliberately absent: any total, per-member figure or assignee. See the note at
// the foot of src/lib/chores.js.

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

function ChoreRow({ chore, busy, onSave, onRemove }) {
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
      </div>

      <div className="row row--end">
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
  busy: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}

export default function Chores({ chores, busy, error, onAdd, onSave, onRemove }) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [complaint, setComplaint] = useState(null)

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
      ) : (
        <ul className="chore-list">
          {chores.map((chore) => (
            <ChoreRow
              key={chore.id}
              chore={chore}
              busy={busy}
              onSave={onSave}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

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
  busy: PropTypes.bool,
  error: PropTypes.string,
  onAdd: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}
