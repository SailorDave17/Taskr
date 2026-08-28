import PropTypes from 'prop-types'

// The re-balance, announced — story #50, the signature moment's payload.
//
// The charter is explicit that the moment must not become a screen: this is an
// EVENT, rendered once above whatever surface the member is on, dismissed and
// gone. The split surface goes on answering "what is the split?"; this answers
// "what happened while you were not looking?", and the two are different
// behaviours on purpose — keeping them apart is what makes a collapse into a
// static screen detectable.
//
// THREE WORDING RULES, each an acceptance criterion rather than taste:
//
//   - Every quantity is MINUTES (AC 3). The prototype's first narration read
//     "ten chores moved" beside "Nora minus one, Ava plus one" — both true, and
//     it read as broken. No count of chores appears in any sentence here.
//   - The cause is a CIRCUMSTANCE, never a person's failing (AC 9). A week
//     "has less room" — nobody fell behind, nobody is slacking, and there is no
//     streak, score or rank anywhere in the output.
//   - The verdict is the RUN'S OWN (AC 6). Whether the change budget bound the
//     result, or level was unreachable, cannot be recomputed from the current
//     rows — the run stored its verdict in `households.last_rebalance`, and
//     this renders that record rather than deriving a fresh one to disagree.

/** "A", "A and B", "A, B and C" — a sentence, never a ranked list. */
function joinParts(parts) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Roster order, then anyone the roster no longer names — the same rule as the
 * split's bars (#47 criterion 6): the order the household added people is the
 * only order, because any other order is a comparison somebody did not choose.
 * A member who has since left the household still had minutes to hand over, so
 * their entry is kept and named by the fallback.
 */
function inRosterOrder(entries, members) {
  const byMember = new Map(entries.map((entry) => [entry.memberId, entry]))
  const ordered = []
  for (const member of members) {
    const entry = byMember.get(member.id)
    if (entry) {
      ordered.push(entry)
      byMember.delete(member.id)
    }
  }
  return [...ordered, ...byMember.values()]
}

export default function Announcement({ announcement, members, onDismiss }) {
  const { moves, capacityChanges, verdict } = announcement

  const nameOf = (memberId) => members.find((m) => m.id === memberId)?.display_name ?? 'Someone'

  // The cause: whose week changed, and by how many minutes (AC 1). Room, not
  // performance — a capacity is a circumstance. When no capacity differs (a
  // change that arrived and reverted between looks, with budget-bound moves
  // left behind), the cause is stated at its honest width instead of invented.
  const causeParts = inRosterOrder(capacityChanges, members).map(
    ({ memberId, minutes }) =>
      `${nameOf(memberId)}’s week has ${Math.abs(minutes)} min ${minutes < 0 ? 'less' : 'more'} room`,
  )
  const cause =
    causeParts.length > 0
      ? `Since you last looked, ${joinParts(causeParts)}.`
      : 'Since you last looked, the chores were re-balanced.'

  // The effect: how many minutes moved to whom (AC 1), as diffs of the bars'
  // own figures. Lighter lists first, then who picked the minutes up — cause
  // before consequence, both in roster order within their half.
  const ordered = inRosterOrder(moves, members)
  const lighter = ordered
    .filter(({ minutes }) => minutes < 0)
    .map(({ memberId, minutes }) => `${Math.abs(minutes)} min of chores moved off ${nameOf(memberId)}’s list`)
  const heavier = ordered
    .filter(({ minutes }) => minutes > 0)
    .map(({ memberId, minutes }) => `${nameOf(memberId)} picked up ${Math.abs(minutes)} min`)
  const effect = `${[joinParts(lighter), joinParts(heavier)].filter(Boolean).join('; ')}.`

  return (
    <section className="announce" role="status" data-testid="rebalance-announcement">
      <p className="announce__statement">
        <span className="announce__cause">{cause}</span>{' '}
        <span className="announce__moves">{effect}</span>
      </p>

      {/* AC 6 — the stored verdict, in the run's own terms. The same facts the
          split's footnote states (#49 AC 7), phrased into the event; both read
          `households.last_rebalance`, so they cannot disagree. */}
      {verdict.boundByBudget ? (
        <p className="announce__verdict" data-testid="announcement-verdict">
          The re-balance moved {verdict.minutesMoved} min and stopped there — the change budget
          ({verdict.changeBudgetMinutes} min) held the rest of the week where it was.
        </p>
      ) : null}
      {!verdict.boundByBudget && verdict.contested && !verdict.level && verdict.reason ? (
        <p className="announce__verdict" data-testid="announcement-verdict">
          The split could not be made level: {nameOf(verdict.reason.memberId)}&rsquo;s fair share
          is {verdict.reason.fairShareMinutes} min and the smallest job is{' '}
          {verdict.reason.smallestJobMinutes} min.
        </p>
      ) : null}

      <button type="button" className="button button--quiet announce__dismiss" onClick={onDismiss}>
        Got it
      </button>
    </section>
  )
}

Announcement.propTypes = {
  announcement: PropTypes.shape({
    moves: PropTypes.array.isRequired,
    capacityChanges: PropTypes.array.isRequired,
    verdict: PropTypes.object.isRequired,
  }).isRequired,
  members: PropTypes.array.isRequired,
  onDismiss: PropTypes.func.isRequired,
}
