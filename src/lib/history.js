// What a member got done in past weeks, and what their calendar held then —
// story #480.
//
// `chores` already carries every completion the household ever recorded (the
// Done tab groups them by week, #302), and `calendar_busy` keeps one row per
// member per week the calendar was read (`0030`). Nothing computed a per-week
// figure from either until this story: the split sums THIS week (#471), the
// Done tab lists, and the roster's calendar suggestion reads one row. This
// module is the fold, and it is pure so the suggestion it feeds
// (`suggestCapacity`) can be argued about with a corpus rather than on a phone.
//
// It never reads `members.weekly_minutes` — capacity.test.js's reader
// allowlist would refuse it, and rightly: a history is about what happened,
// and the baseline is what somebody once typed.

import { isCompleted } from './chores.js'
import { doneWeekOf } from './done.js'
import { SUGGESTION_WINDOW_WEEKS, periodStartFor, priorPeriodStarts } from './capacity.js'

/**
 * The minutes a completed chore cost — `actual_minutes` where somebody
 * recorded one (`0015`), else the estimate. The same fallback `minutesOf` in
 * allocation.js and `actualsSummary` in chores.js make, so the history and
 * the split cannot disagree about what an old completion cost.
 */
export function completedMinutesOf(chore) {
  return Number(chore.actual_minutes ?? chore.expected_minutes ?? 0)
}

/**
 * One row per member per COMPLETED prior week in the window — the input
 * `suggestCapacity` reads.
 *
 * "Completed" is about the WEEK, not the chores: a week that has fully
 * elapsed and that the member was in the household for. A week with nothing
 * done is a row with `doneMinutes: 0`, and it counts — the story's rule. A
 * blank week is a fact about the person, and skipping it would read a
 * fortnight off as a steady month. A member is in a week from the week their
 * row was created (`created_at`, resolved in the household's zone), so the
 * join week counts even for somebody who joined on its Friday: the median
 * absorbs one low week, which is why the rule is a median. A member row with
 * no `created_at` has NO history — nothing says when they arrived, and four
 * weeks of zero for a person who may have joined yesterday would be a
 * confident "Suggested: 0 min" over nothing. (`0001` defaults the column, so
 * only a fixture ever lacks it; the choice matters because a fixture that
 * did not ask for a suggestion must not grow one.)
 *
 * WHOSE completion: the COMPLETER, `completed_by_member_id`, falling back to
 * the holder for a row completed before `0004` stamped one. Owner decision at
 * review-fanout's gate, 2026-09-16: the story's words are "what they actually
 * completed", and AC 6 compares the suggestion with what the member THEN
 * completed, so the person who did the work is the one credited. This is NOT
 * the split's attribution — `toAllocatorChores` credits the done minutes to
 * the holder, and `0029` keeps a held chore's holder whoever finishes it
 * (`coalesce(chores.assigned_member_id, completer)`), so on a covered chore
 * the split's done bar and this history name different people. The first
 * draft claimed the two agreed since `0029`; they agree only when nobody
 * covers for anybody. A completion credited to nobody counts for nobody.
 *
 * `busyMinutes` is the member's `calendar_busy` row for that week, or null
 * where none was read — null, not zero, because an unread calendar is unknown
 * and a zero would say "empty week". There is no work-hours field: #480
 * carried one at 0 for a figure nothing supplied, and #518 removed it.
 *
 * Refuses to run without a period or a zone rather than falling back to an
 * unfiltered fold, `choresInWeek`'s reason: that fallback IS the defect.
 */
export function weeklyHistory({
  members,
  chores,
  busyWeeks,
  timeZone,
  periodStart,
  weeks = SUGGESTION_WINDOW_WEEKS,
}) {
  if (!timeZone) throw new Error('A history needs the household timezone.')
  if (!periodStart) throw new Error('A history is relative to a particular week.')
  const mondays = priorPeriodStarts(periodStart, weeks)

  // `${member}|${week}` → minutes completed. Folded once over every chore
  // rather than once per (member, week), so a household with a long history
  // costs one pass and not members × weeks passes.
  const done = new Map()
  for (const chore of chores ?? []) {
    if (!isCompleted(chore)) continue
    const doer = chore.completed_by_member_id ?? chore.assigned_member_id
    if (doer == null) continue
    const key = `${doer}|${doneWeekOf(chore, timeZone)}`
    done.set(key, (done.get(key) ?? 0) + completedMinutesOf(chore))
  }

  const busy = new Map()
  for (const row of busyWeeks ?? []) {
    if (row.busy_minutes == null) continue
    busy.set(`${row.member_id}|${row.period_start}`, Number(row.busy_minutes))
  }

  const rows = []
  for (const member of members ?? []) {
    if (!member.created_at) continue
    const since = periodStartFor(member.created_at, timeZone)
    for (const monday of mondays) {
      if (monday < since) continue
      const key = `${member.id}|${monday}`
      rows.push({
        memberId: member.id,
        periodStart: monday,
        doneMinutes: done.get(key) ?? 0,
        busyMinutes: busy.has(key) ? busy.get(key) : null,
      })
    }
  }
  return rows
}
