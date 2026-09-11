// #430 — the organizer's way back from deleting a household.
//
// Shown ABOVE the tabs and above the onboarding screen, because deleting your
// only household lands you on onboarding, and the one thing you might want
// next is to undo it. A household pending deletion is no longer selectable
// (migration 0042), so this reads `household_deletion_status()` rather than the
// household list, and it is the only place such a household still appears.
//
// Built only from classes that already carry rules, so it adds nothing to the
// stylesheet guard's list.

import PropTypes from 'prop-types'

/** The purge date as a person reads it: weekday, month and day, in their own zone. */
export function formatPurgeDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function PendingDeletion({ pending = [], onRestore, busy = false }) {
  if (!pending.length) return null
  return (
    <section className="card" aria-labelledby="pending-deletion-heading">
      <h2 id="pending-deletion-heading" className="card__heading">
        Scheduled for deletion
      </h2>
      {pending.map((entry) => (
        <div key={entry.household_id} className="row row--between">
          {/* The date is the whole rule; restating the period beside it was a
              second sentence saying the same thing (owner, design-bar 2026-09-11). */}
          <p className="card__body">
            {entry.household_name} will be deleted for good on {formatPurgeDate(entry.purge_after)}.
            Until then you can bring it back.
          </p>
          <button
            className="button"
            type="button"
            onClick={() => onRestore(entry.household_id)}
            disabled={busy}
          >
            Restore {entry.household_name}
          </button>
        </div>
      ))}
    </section>
  )
}

PendingDeletion.propTypes = {
  pending: PropTypes.arrayOf(
    PropTypes.shape({
      household_id: PropTypes.string.isRequired,
      household_name: PropTypes.string.isRequired,
      purge_after: PropTypes.string.isRequired,
    }),
  ),
  onRestore: PropTypes.func.isRequired,
  busy: PropTypes.bool,
}
