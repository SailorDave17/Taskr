import PropTypes from 'prop-types'
import { MAX_EXPECTED_MINUTES, MIN_EXPECTED_MINUTES } from '../lib/chores.js'

// The editable review list for chores that do not exist yet — story #220.
//
// A separate component, and separate ON PURPOSE rather than for tidiness: #220
// builds this list from typed input, and #213 will build the same list from
// extracted proposals. The issue's AC 7 requires that it "takes its rows as
// input rather than owning where they came from", so nothing in this file
// knows about the batch panel, the extraction bet, or the database — it
// renders the rows it is handed and reports edits to whoever owns them.
//
// A row is `{ key, title, minutes, dueOn, problem }`, all strings except
// `problem`, which is the refusal sentence to show on that row or null. The
// values are the FORM's strings, not normalized values — normalization happens
// where the rows are confirmed, by the data layer's own validators, so this
// list cannot end up enforcing a second copy of the rules.
//
// Per-row problems render with `role="alert"` and the error palette, matching
// the single form's refusals: these are about WORK, which is the one thing the
// stylesheet's red is for.

function DraftRow({ row, position, busy, onChange, onRemove }) {
  return (
    <li className="chore chore--editing chore-draft" data-testid={`draft-${row.key}`}>
      <div className="stack">
        <label className="field">
          <span className="field__label">Chore</span>
          <input
            className="field__input"
            value={row.title}
            maxLength={80}
            autoComplete="off"
            placeholder="Dishes"
            aria-label={`Title for chore ${position}`}
            onChange={(e) => onChange(row.key, { title: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">Expected minutes</span>
          <input
            className="field__input"
            type="number"
            min={MIN_EXPECTED_MINUTES}
            max={MAX_EXPECTED_MINUTES}
            value={row.minutes}
            placeholder="20"
            aria-label={`Expected minutes for chore ${position}`}
            onChange={(e) => onChange(row.key, { minutes: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">Due</span>
          <input
            className="field__input"
            type="date"
            value={row.dueOn}
            aria-label={`Due date for chore ${position}`}
            onChange={(e) => onChange(row.key, { dueOn: e.target.value })}
          />
        </label>
        {row.problem ? (
          <p className="error" role="alert">
            {row.problem}
          </p>
        ) : null}
        <div className="row row--end">
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            aria-label={`Remove chore ${position} from the list`}
            onClick={() => onRemove(row.key)}
          >
            Remove from list
          </button>
        </div>
      </div>
    </li>
  )
}

DraftRow.propTypes = {
  row: PropTypes.shape({
    key: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    minutes: PropTypes.string.isRequired,
    dueOn: PropTypes.string.isRequired,
    problem: PropTypes.string,
  }).isRequired,
  position: PropTypes.number.isRequired,
  busy: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}

export default function ChoreDraftList({ rows, busy, onChange, onRemove }) {
  return (
    <ul className="chore-list chore-draft-list">
      {rows.map((row, index) => (
        <DraftRow
          key={row.key}
          row={row}
          position={index + 1}
          busy={busy}
          onChange={onChange}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}

ChoreDraftList.propTypes = {
  rows: PropTypes.array.isRequired,
  busy: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}
