// Announce a re-balance as an event — story #50.
//
// The charter's design direction says the re-balance "must be perceptible as an
// event, not a silently different number on next look", and the issue defines
// the event precisely: WHAT CHANGED SINCE THIS MEMBER LAST LOOKED. That
// definition has two halves and this module owns both:
//
//   - the SNAPSHOT — the per-member minutes this member was last shown,
//     persisted per member (`member_split_seen`, 0020), because two members who
//     last looked at different times must receive different statements (AC 2).
//     `households.last_rebalance` cannot carry this: it is one fact per
//     household, about the run rather than about any member's last look.
//
//   - the STATEMENT — the diff between that snapshot and the split now on
//     screen, in minutes and nothing else (AC 3).
//
// ONE SOURCE (AC 4). A snapshot is produced by `assess` — the exact arithmetic
// the split's bars render from — so the announcement's minutes are diffs of the
// bars' own figures and the sentence cannot disagree with the picture. There is
// no second implementation of "how many minutes is this person carrying" here,
// for the same reason #40 AC 9 permits one `fairShare`.
//
// NET, NOT A REPLAY (AC 5). A change arriving in two steps between one member's
// visits is reported as one move, because the diff is taken against the
// snapshot rather than against the previous run: the snapshot only advances
// when this member is shown the state.
//
// The verdict is NOT computed here (AC 6): whether the run was bound by the
// change budget, or could not reach level, depends on the state the run
// replaced — `apply_assignments` stored it in `households.last_rebalance`, and
// the announcement carries that stored verdict rather than deriving a fresh one
// to disagree with it.

import { assess } from './allocation.js'
import { toAllocatorChores } from './chores.js'
import { getSupabase } from './supabase.js'

function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

// Matches the select grant in 0020 exactly. Like `member_capacity`, the table
// withholds `household_id` — it is scoped by the member set — so `select('*')`
// would be refused and the explicit list is the whole surface.
export const SPLIT_SEEN_COLUMNS = 'member_id, snapshot, seen_rebalance_at'

/**
 * The split as a member is being shown it, in the shape the seen-marker stores.
 *
 * Produced by the SAME `assess` call the bars render from — AC 4's one source.
 * Every member appears, including those with no capacity this week: they can
 * still be holding work, and work moving off a zero-capacity person's list is
 * exactly the move a re-balance exists to make visible.
 *
 * Sorted by member id so the stored form is deterministic — the same property
 * `assess` guarantees of its own output, inherited rather than re-implemented.
 */
export function splitSnapshot({ capacities, chores }) {
  const picture = assess({ members: capacities, chores: toAllocatorChores(chores) })
  const members = [
    ...picture.load.map((entry) => ({
      id: entry.memberId,
      minutes: entry.assignedMinutes,
      capacityMinutes: entry.capacityMinutes,
    })),
    ...picture.noCapacity.map((entry) => ({
      id: entry.memberId,
      minutes: entry.assignedMinutes,
      capacityMinutes: 0,
    })),
  ].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return { members }
}

/** `applied_at` and `seen_rebalance_at` compared as instants, not as strings:
 * the first is jsonb text written by `to_jsonb(now())`, the second a
 * timestamptz PostgREST rendered, and two spellings of one moment must not
 * read as an unseen event. `Date` drops sub-millisecond digits from both
 * sides, so the truncation cannot split a pair either. */
function isAtOrAfter(a, b) {
  return new Date(a).getTime() >= new Date(b).getTime()
}

/**
 * The announcement this member is owed, or null when they are owed nothing.
 *
 * Null is the common answer and every branch to it is a criterion:
 *
 *   - no re-balance has ever run, or none since this member last looked —
 *     the event was seen once and is not shown a second time (AC 7);
 *   - this member has no snapshot yet — a first look has no before-state, and
 *     announcing a diff against nothing would manufacture an event;
 *   - the re-balance moved no minutes against what this member was shown —
 *     nothing is announced, because the app does not manufacture an event to
 *     look busy (AC 8). This also nets a move-and-move-back to silence, which
 *     is AC 5's rule carried to its endpoint.
 *
 * The moves are PER-MEMBER MINUTE DELTAS of the bars' own figures — positive
 * is work arriving on that member's list, negative is work leaving it. The
 * capacity deltas name the cause (whose week changed, and by how many
 * minutes); the moves name the effect (how many minutes moved to whom).
 */
export function announcementFrom({ seen, current, lastRebalance }) {
  if (!lastRebalance?.applied_at) return null
  if (!seen?.snapshot?.members) return null
  if (seen.seen_rebalance_at != null && isAtOrAfter(seen.seen_rebalance_at, lastRebalance.applied_at)) {
    return null
  }

  const before = new Map(seen.snapshot.members.map((m) => [m.id, m]))
  const after = new Map(current.members.map((m) => [m.id, m]))
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
    String(a).localeCompare(String(b)),
  )

  const moves = []
  const capacityChanges = []
  for (const id of ids) {
    const was = before.get(id)
    const now = after.get(id)
    const minutesDelta = (now?.minutes ?? 0) - (was?.minutes ?? 0)
    if (minutesDelta !== 0) moves.push({ memberId: id, minutes: minutesDelta })
    const capacityDelta = (now?.capacityMinutes ?? 0) - (was?.capacityMinutes ?? 0)
    if (capacityDelta !== 0) capacityChanges.push({ memberId: id, minutes: capacityDelta })
  }

  if (moves.length === 0) return null

  return { moves, capacityChanges, verdict: lastRebalance }
}

/**
 * What this member was last shown — their own row and nobody else's, which is
 * RLS's doing rather than this filter's; the filter is what makes the read a
 * single row instead of a scan. `maybeSingle`, because no row yet is the
 * ordinary first-look state, not an error.
 */
export async function readSplitSeen(memberId) {
  if (!memberId) throw new Error('Whose last look? Reading the seen-marker must name a member.')
  return unwrap(
    await getSupabase()
      .from('member_split_seen')
      .select(SPLIT_SEEN_COLUMNS)
      .eq('member_id', memberId)
      .maybeSingle(),
    'reading what you were last shown',
  )
}

/**
 * Record what this member has now been shown, advancing the announcement's
 * baseline. An upsert on the primary key: a second look is a correction of the
 * same fact, not a second fact — the same reasoning as `setCapacity`.
 *
 * `seenRebalanceAt` is the `applied_at` of the re-balance this member has now
 * seen the state of (or null when none has ever run). Writing it is what makes
 * the statement an event seen once (AC 7): the next read finds the marker at
 * or past `last_rebalance.applied_at` and announces nothing.
 */
export async function writeSplitSeen({ memberId, snapshot, seenRebalanceAt = null }) {
  if (!memberId) throw new Error('Whose last look? Recording the seen-marker must name a member.')
  unwrap(
    await getSupabase()
      .from('member_split_seen')
      .upsert(
        { member_id: memberId, snapshot, seen_rebalance_at: seenRebalanceAt },
        { onConflict: 'member_id' },
      ),
    'recording what you were shown',
  )
}
