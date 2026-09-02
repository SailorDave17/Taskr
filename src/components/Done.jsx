import PropTypes from 'prop-types'
import { ChoreRow } from './Chores.jsx'
import { groupDoneByWeek, weekRangeLabel } from '../lib/done.js'

// Completed work, by capacity week — story #302, owner's option (a).
//
// This surface exists because the chore list was piling every finished chore
// ever under the working list, and the Chores tab had stopped reading as work.
// It is a fourth tab rather than a disclosure on the third (option (b)) so that
// the tab a person opens to see what needs doing shows only that.
//
// What this screen is NOT, and #35 AC 9 still binds here: no streak, no rank,
// no score, no per-person total, and nothing styled as an error or an alert.
// Red is for work, never for people. Done.test.jsx fails if any of those
// appears — the test moved here with the group.
//
// A completed row is the same `ChoreRow` the chore list renders, so "Not done
// after all" and "Took (minutes)" are one implementation on two screens. The
// tests for those controls moved with it and run against this surface with
// their fixtures untouched (AC 2).
export default function Done({
  chores,
  members,
  exclusions,
  repeatExceptions,
  todayIso,
  timezone,
  busy,
  error,
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
  // Grouped by the week `periodStartFor` derives — the capacity week, in the
  // household's zone — newest first. See src/lib/done.js for why that week and
  // not another.
  const groups = groupDoneByWeek(chores, timezone)

  return (
    <section className="card" aria-labelledby="done-heading">
      <h2 id="done-heading" className="card__heading">
        Done
      </h2>

      {groups.length === 0 ? (
        <p className="card__body">
          Nothing finished yet. A chore marked done on the Chores tab lands here, under the
          week it was finished in — and so does one marked as not done (#305), under the week
          it was given up on.
        </p>
      ) : null}

      {groups.map(({ periodStart, chores: rows }, index) => (
        <section
          key={periodStart}
          className="chore-done"
          aria-labelledby={`done-week-${periodStart}`}
        >
          {/* Only the NEWEST week opens; every earlier week sits behind its
              heading. Owner decision at the design-bar gate (2026-09-01),
              taken on a measurement rather than a description: with eight
              weeks of daily repeats this surface rendered as 27 screens at
              360px, because a done row is the working row and stands 375px
              tall. Grouping helps a reader find a week; it does nothing for
              density. A native `details` needs no state here, survives the
              arrival re-read (React only rewrites `open` when the prop
              changes, and it changes only when a new week becomes newest),
              and is keyboard-operable for free. The bar the owner set — a
              logbook of dense rows — is only half met by this; the other
              half, a compact done row, is its own story. */}
          <details className="chore-done__week" open={index === 0}>
            <summary className="chore-done__summary">
              <h3 id={`done-week-${periodStart}`} className="card__subheading">
                {weekRangeLabel(periodStart)}
              </h3>
              <span className="chore-done__count">
                {rows.length} {rows.length === 1 ? 'chore' : 'chores'}
              </span>
            </summary>
            <ul className="chore-list chore-list--done">
              {rows.map((chore) => (
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
          </details>
        </section>
      ))}

      {/* A failed "Not done after all" or "Took" write reports itself beside
          the rows that caused it, for the reason Chores.jsx gives: the message
          belongs on the screen the person is looking at. Outside every week
          group on purpose — the groups are what AC 3 holds free of alert
          styling, and this is the server's refusal, not a judgement of anyone. */}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

Done.propTypes = {
  chores: PropTypes.array.isRequired,
  members: PropTypes.array.isRequired,
  exclusions: PropTypes.array.isRequired,
  repeatExceptions: PropTypes.array.isRequired,
  todayIso: PropTypes.string,
  // Required, unlike on Chores: this surface has nothing to show without it,
  // and periodStartFor refuses to guess a zone.
  timezone: PropTypes.string.isRequired,
  busy: PropTypes.bool,
  error: PropTypes.string,
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
