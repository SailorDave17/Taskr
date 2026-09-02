import { periodStartFor } from './capacity.js'
import { isCompleted, isOutstanding } from './chores.js'

// Completed work, arranged for the Done surface — story #302.
//
// The chore screen used to render every completed chore ever under a heading
// reading "Done this week". Nothing bounded that group to a week: it was false
// from the household's second week and grew by one row per completion forever.
// The rows cannot be dropped from the DATA — #12 reads completed instances to
// suggest estimates and #105 keeps a completed occurrence as history — so only
// the screen changes, and this module is the arithmetic the screen needs.
//
// "Week" here is the CAPACITY week, derived by the same `periodStartFor` the
// roster and the allocator use, in the household's time zone. The household
// already thinks in capacity weeks (#46/#47); inventing a second notion of a
// week for the done list would be two answers to one question.

/**
 * The instant a chore left the list: finished, or recorded as not done (#305).
 *
 * Null for outstanding work. The two stamps are mutually exclusive (0027's
 * constraint), so this is a lookup rather than a choice.
 */
export function settledAt(chore) {
  if (isOutstanding(chore)) return null
  return chore.completed_at ?? chore.missed_at
}

/**
 * The capacity week a settled chore belongs to, or null for outstanding work.
 *
 * Keyed on `completed_at` — or, for a chore nobody did, `missed_at` — both the
 * database's own clock (#35 AC 1, #305 AC 1), never on `due_on`: a chore due
 * Sunday and finished Monday morning was Monday's work, and a chore given up on
 * Monday belongs to Monday's week the same way. A missed row sits in its week's
 * group on this surface, labelled as not done, because it is still that week's
 * record of what the household did and did not get to.
 */
export function doneWeekOf(chore, timeZone) {
  const at = settledAt(chore)
  if (at === null) return null
  return periodStartFor(at, timeZone)
}

/**
 * Completed chores grouped by capacity week, NEWEST WEEK FIRST — #302 AC 2.
 *
 * Within a week the most recently finished chore comes first, so the top of
 * the surface is always the latest thing anybody did. Outstanding chores are
 * dropped rather than grouped: they have no week yet.
 *
 * @returns {{ periodStart: string, chores: object[] }[]}
 */
export function groupDoneByWeek(chores, timeZone) {
  const byWeek = new Map()
  for (const chore of chores) {
    const week = doneWeekOf(chore, timeZone)
    if (week === null) continue
    if (!byWeek.has(week)) byWeek.set(week, [])
    byWeek.get(week).push(chore)
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([periodStart, group]) => ({
      periodStart,
      chores: [...group].sort((a, b) => {
        const at = settledAt(a)
        const bt = settledAt(b)
        return at < bt ? 1 : at > bt ? -1 : 0
      }),
    }))
}

/**
 * How many chores were COMPLETED in the given capacity week — the one number
 * the Chores tab still says about finished work (#302 AC 1).
 *
 * `periodStart` is the week App derived at refresh, so the tab and the Done
 * surface agree about which week is "this" one by construction.
 *
 * Completed, not settled: the line reads "N done this week", and a chore
 * nobody did is not done (#305). It still sits in that week's group on the
 * Done surface, which the line leads to; it is not counted in the sentence.
 */
export function countDoneInWeek(chores, timeZone, periodStart) {
  if (!periodStart) return 0
  return chores.filter((c) => isCompleted(c) && doneWeekOf(c, timeZone) === periodStart).length
}

/**
 * A capacity week as people read it: "Aug 24 – Aug 30, 2026".
 *
 * `periodStart` is a pure calendar date (the Monday), so the formatter runs in
 * UTC on purpose — formatting it in the household's zone would shift the date
 * by a day for any zone west of Greenwich, which is every household this app
 * has. The year is spelled on both ends only when the week straddles one.
 */
export function weekRangeLabel(periodStart) {
  const start = new Date(`${periodStart}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) throw new Error('That is not a period start.')
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const dayMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  const dayMonthYear = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return sameYear
    ? `${dayMonth.format(start)} – ${dayMonthYear.format(end)}`
    : `${dayMonthYear.format(start)} – ${dayMonthYear.format(end)}`
}
