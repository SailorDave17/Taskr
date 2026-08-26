// The chore data layer — story #34.
//
// Same contract as household.js: nothing in this file is a security boundary.
// The rules that protect the data are the row-level policies and the column
// grants in supabase/migrations/0003_chores.sql. If a check below is deleted,
// the database still refuses; these only turn a Postgres constraint violation
// into a sentence a person can act on.
//
// The invariant this file exists to hold: a chore is a quantity of TIME.
// `expected_minutes` is the unit the fairness split divides, not a label on a
// to-do item, which is why the minutes bound is enforced here, in a check
// constraint, and in the form — three places, because it is the number the
// whole thesis rests on.

import { getSupabase } from './supabase.js'

/**
 * Unwrap a Supabase `{ data, error }` result.
 *
 * Deliberately a second copy of household.js's helper rather than an import of
 * it. Exporting it from there to here would make a module about households the
 * home of a generic utility, and the two are eight lines each; the duplication
 * is cheaper than the coupling. If a third caller appears, that is the moment
 * it earns its own module.
 */
function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

// The columns a client is allowed to read, matching the select grant in 0003
// exactly. `select('*')` FAILS on this table rather than quietly omitting a
// column — that is the intended behaviour of a column grant, and the reason this
// list is a constant rather than being spelled out at each call site.
//
// `household_id` IS read back now — #159, and the reason it was absent has
// expired rather than merely changed. It said the value "would be a constant the
// client can already name", which was true while a person belonged to one
// household: RLS returned one household's rows, so the column carried no
// information. `0009` made membership per-household, so the set RLS returns can
// span two and the column is the only thing that tells them apart.
//
// The wildcard refusal survives here, which is why 0014 is FREE on this table
// and not on `members`: `0012` withholds `repeat_since` and
// `repeat_caught_up_through` as well, so `select('*')` on `chores` still fails
// outright. 0003 carries the original reasoning; #157 measured this asymmetry.
export const CHORE_COLUMNS =
  'id, household_id, title, expected_minutes, due_on, created_at, completed_at, completed_by_member_id, assigned_member_id, repeat_kind, repeat_weekdays, generated_from'

/** The bounds of `chores_expected_minutes_range`, named so the UI can say them. */
export const MIN_EXPECTED_MINUTES = 1
export const MAX_EXPECTED_MINUTES = 1440

/**
 * The catch-up bound, in days — #53 AC 4. Owner decision 2026-08-24, recorded
 * in docs/refresh-charter.md's decision log.
 *
 * THE AUTHORITY IS THE MIGRATION: `catch_up_repeats_at` in `0012` carries the
 * same number, and that copy is the one that decides what exists. This copy
 * only words the notice, and repeats.pglite.test.js holds the two equal so
 * they cannot drift apart silently.
 */
export const CATCH_UP_BOUND_DAYS = 7

/** The schedule kinds `chores_repeat_kind_known` accepts, in the UI's order. */
export const REPEAT_KINDS = ['none', 'daily', 'weekly']

/** ISO weekdays as the schema stores them (1 = Monday … 7 = Sunday). */
export const WEEKDAYS = [
  { isoDow: 1, label: 'Mon' },
  { isoDow: 2, label: 'Tue' },
  { isoDow: 3, label: 'Wed' },
  { isoDow: 4, label: 'Thu' },
  { isoDow: 5, label: 'Fri' },
  { isoDow: 6, label: 'Sat' },
  { isoDow: 7, label: 'Sun' },
]

/**
 * Minutes of work a chore is expected to take.
 *
 * Zero is refused rather than clamped up. A chore costing no time cannot be
 * allocated against a budget of minutes, so silently turning it into one minute
 * would put a meaningless row into the calculation the app's fairness claim
 * rests on — better to refuse it and let a person decide it is a note.
 */
export function normalizeExpectedMinutes(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error('How many minutes does this chore take?')
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Expected minutes must be a number.')
  if (!Number.isInteger(n)) throw new Error('Expected minutes must be a whole number of minutes.')
  if (n < MIN_EXPECTED_MINUTES) throw new Error('A chore has to take at least a minute.')
  if (n > MAX_EXPECTED_MINUTES) {
    throw new Error('That is more than a day of work — split it into smaller chores.')
  }
  return n
}

/**
 * A due date as the `date` column wants it: `YYYY-MM-DD`, no time, no zone.
 *
 * Deliberately string-in, string-out, and deliberately NOT via `new Date()`.
 * Parsing '2026-08-10' into a Date and formatting it back returns the previous
 * day for anyone west of UTC, because the parse is UTC-midnight and the format
 * is local — a chore due Monday would be stored as Sunday for half the world.
 * The column is a calendar date and this keeps it one all the way down.
 */
export function normalizeDueDate(value) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('When is this chore due?')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('A due date needs to look like 2026-08-10.')

  const [year, month, day] = text.split('-').map(Number)
  if (month < 1 || month > 12) throw new Error('That is not a real month.')
  // Round-trip through UTC to reject 31 February and friends, which the regex
  // above is happy with. UTC on both sides, so no zone can shift the answer.
  const asUtc = new Date(Date.UTC(year, month - 1, day))
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    throw new Error('That is not a real date.')
  }
  return text
}

/**
 * A schedule the columns will accept — #53 AC 6: structured, never free text.
 *
 * Takes the form's shape (`repeatKind` + `repeatWeekdays`) and returns the two
 * COLUMN values, so a caller cannot send half a schedule: weekly without days
 * is refused here with a sentence, and the check constraint
 * `chores_repeat_weekdays_shape` refuses it again at the database for any
 * caller that skips this function.
 *
 * Weekdays come back sorted and deduplicated. The constraint tolerates a
 * duplicate (it is harmless to the schedule arithmetic), but a stored
 * `{5,1,5}` would render back as a different-looking set than was saved.
 */
export function normalizeRepeat({ repeatKind, repeatWeekdays } = {}) {
  const kind = repeatKind === undefined || repeatKind === null ? 'none' : String(repeatKind)
  if (!REPEAT_KINDS.includes(kind)) {
    throw new Error('A repeat is daily or weekly — anything fancier is not a schedule yet.')
  }

  if (kind !== 'weekly') {
    if (Array.isArray(repeatWeekdays) && repeatWeekdays.length > 0) {
      throw new Error('Weekdays only make sense on a weekly repeat.')
    }
    return { repeat_kind: kind, repeat_weekdays: null }
  }

  const days = Array.isArray(repeatWeekdays) ? repeatWeekdays.map(Number) : []
  if (days.length === 0) {
    throw new Error('A weekly repeat needs at least one weekday.')
  }
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new Error('A weekday is 1 (Monday) through 7 (Sunday).')
  }
  return { repeat_kind: 'weekly', repeat_weekdays: [...new Set(days)].sort((a, b) => a - b) }
}

/** A chore title the column will accept. */
export function normalizeTitle(value) {
  const title = String(value ?? '').trim()
  if (!title) throw new Error('A chore needs a name.')
  if (title.length > 80) throw new Error('That name is too long — 80 characters at most.')
  return title
}

/**
 * Every chore in this device's household, soonest first.
 *
 * Ordered by `due_on` then `created_at` so the order is total and therefore
 * stable: two chores due the same day would otherwise come back in whatever
 * order Postgres found them, and the list would reshuffle between refreshes for
 * no visible reason.
 */
export async function listChores(householdId) {
  if (!householdId) throw new Error('Which household? A chore read must name one.')
  return (
    unwrap(
      await getSupabase()
        .from('chores')
        .select(CHORE_COLUMNS)
        .eq('household_id', householdId)
        .order('due_on', { ascending: true })
        .order('created_at', { ascending: true }),
      'loading the chores',
    ) ?? []
  )
}

/**
 * Record a chore as a titled unit of expected minutes — AC 1.
 *
 * `householdId` is now a parameter — #159 AC 4. It was read here from the same
 * unordered `.limit(1)` the reads used, so with two households a chore could be
 * filed into a different one from the list on screen. The caller passes the
 * household it is showing; the with-check policy in 0003 still refuses any id
 * outside `current_household_ids()`, so this is defence in depth over a database
 * guard rather than the guard (#159 AC 5).
 */
export async function addChore({ title, expectedMinutes, dueOn, repeatKind, repeatWeekdays, householdId }) {
  const cleanTitle = normalizeTitle(title)
  const minutes = normalizeExpectedMinutes(expectedMinutes)
  const due = normalizeDueDate(dueOn)
  // #53 — the repeat is set where the chore is created, as a property of the
  // chore. There is no templates screen to route through, and callers that say
  // nothing get 'none', which is the column's own default.
  const repeat = normalizeRepeat({ repeatKind, repeatWeekdays })

  if (!householdId) throw new Error('Which household? Adding a chore must name one.')

  return unwrap(
    await getSupabase()
      .from('chores')
      .insert({
        household_id: householdId,
        title: cleanTitle,
        expected_minutes: minutes,
        due_on: due,
        repeat_kind: repeat.repeat_kind,
        repeat_weekdays: repeat.repeat_weekdays,
      })
      .select(CHORE_COLUMNS)
      .single(),
    'adding the chore',
  )
}

/** Edit a chore's title, minutes or due date — AC 6. */
export async function updateChore(id, { title, expectedMinutes, dueOn }) {
  const patch = {}
  if (title !== undefined) patch.title = normalizeTitle(title)
  if (expectedMinutes !== undefined) patch.expected_minutes = normalizeExpectedMinutes(expectedMinutes)
  if (dueOn !== undefined) patch.due_on = normalizeDueDate(dueOn)

  // An empty patch would issue `update chores set` — a syntax error from
  // Postgres reported as "saving the change: ...", which reads like the row was
  // rejected rather than like nothing was asked for.
  if (Object.keys(patch).length === 0) throw new Error('Nothing to change.')

  return unwrap(
    await getSupabase().from('chores').update(patch).eq('id', id).select(CHORE_COLUMNS).single(),
    'saving the change',
  )
}

/**
 * Mark a chore done — #35.
 *
 * Through an RPC rather than an update, and the reason is the CLOCK rather than
 * access control: `completed_at` is set by `now()` inside the function, so a
 * phone with the wrong date cannot move work between weeks. The column is not
 * in the update grant at all, so this is not merely the preferred path — it is
 * the only one.
 */
export async function completeChore(id) {
  return unwrap(await getSupabase().rpc('complete_chore', { chore_id: id }), 'marking it done')
}

/** Undo a completion — the chore returns to the outstanding list. */
export async function uncompleteChore(id) {
  return unwrap(
    await getSupabase().rpc('uncomplete_chore', { chore_id: id }),
    'putting it back on the list',
  )
}

/**
 * Create every missed occurrence of the household's repeating chores — #53.
 *
 * Called on app open, before the first read, so the occurrences it creates are
 * in the list the person is about to see. Through an RPC for BOTH of the
 * house's reasons at once: the clock (household-local "today" is the server's
 * `now()` in the household's zone, so a phone with the wrong date cannot move
 * an occurrence between days) and access (`generated_from` is in no client
 * grant, so this is the only path that can write an occurrence at all).
 *
 * Exactly-once under a double-fire is the DATABASE's unique index, not
 * anything here — two devices calling this in the same second is the designed
 * case, not a race to defend against in JavaScript.
 */
export async function catchUpRepeats() {
  const rows = unwrap(await getSupabase().rpc('catch_up_repeats'), 'catching up repeats')
  // A table-returning function arrives as an array of one row.
  const pass = Array.isArray(rows) ? rows[0] : rows
  return {
    created: pass?.created_count ?? 0,
    skipped: pass?.skipped_count ?? 0,
  }
}

/**
 * The sentence a household reads when catch-up skipped occurrences older than
 * the bound — #53 AC 4's "told rather than silent", worded once so every
 * surface says it the same way. Null when nothing was skipped, so callers can
 * render nothing rather than an empty notice.
 */
export function formatSkippedNotice(skipped) {
  const n = Number(skipped) || 0
  if (n <= 0) return null
  const what = n === 1 ? '1 repeat occurrence' : `${n} repeat occurrences`
  return (
    `${what} more than ${CATCH_UP_BOUND_DAYS} days old ` +
    `${n === 1 ? 'was' : 'were'} skipped rather than piled onto this week.`
  )
}

/**
 * "repeats weekly on Mon, Thu" — the row's one-line account of its schedule,
 * or null for a chore that does not repeat. Reads the COLUMN values, so what
 * the screen says is what the database will actually do.
 */
export function describeRepeat(chore) {
  if (!chore || chore.repeat_kind === 'none' || !chore.repeat_kind) return null
  if (chore.repeat_kind === 'daily') return 'repeats daily'
  const names = (chore.repeat_weekdays ?? [])
    .map((d) => WEEKDAYS.find((w) => w.isoDow === Number(d))?.label)
    .filter(Boolean)
  return names.length > 0 ? `repeats weekly on ${names.join(', ')}` : 'repeats weekly'
}

/**
 * Give a chore to a person - #36 AC 1.
 *
 * Through an RPC because `assigned_member_id` is absent from the update grant in
 * 0003/0006, so this is not the preferred path - it is the only one. A client
 * that could write the column directly would make the eligibility rule (#37),
 * the churn bound (#41) and every allocator invariant advisory.
 */
export async function assignChore(choreId, memberId) {
  return unwrap(
    await getSupabase().rpc('assign_chore', { chore_id: choreId, member_id: memberId }),
    'giving the chore to that person',
  )
}

/** Take a chore off whoever is holding it - #36 AC 4. */
export async function unassignChore(choreId) {
  return unwrap(
    await getSupabase().rpc('unassign_chore', { chore_id: choreId }),
    'taking the chore off that person',
  )
}

/** Is this chore still to do? The whole definition of outstanding, in one place. */
export function isOutstanding(chore) {
  return chore.completed_at === null || chore.completed_at === undefined
}

/**
 * Minutes of work still to do — #35 AC 5.
 *
 * Sums ONLY outstanding chores. A sum over every row is the defect this exists
 * to prevent: committed minutes that can only grow, so the load figure drifts
 * upward all week and any re-balance derived from it is computed over work
 * already finished.
 */
export function outstandingMinutes(chores) {
  return chores.filter(isOutstanding).reduce((sum, c) => sum + (c.expected_minutes || 0), 0)
}

/**
 * Chore rows as the allocation module wants them — #47.
 *
 * The boundary between "a row from Postgres" and "the shape the fairness
 * arithmetic reasons about". `src/lib/allocation.js` is deliberately pure and
 * knows nothing about column names; this is the only place the two vocabularies
 * meet, so a column rename has one call site rather than one per screen.
 *
 * `done` is derived through `isOutstanding` rather than by testing
 * `completed_at` again here. That is the same one-definition rule the rest of
 * this module keeps, and it matters more than it looks: the surface's completed
 * segment and the chore list's Done section must agree about which chores are
 * finished, or a household sees work in one place and not the other.
 *
 * `actualMinutes` is passed through UNCHANGED, including when the column does
 * not exist — it is `undefined` today and `allocation.minutesOf` falls back to
 * the estimate. #12 adds the column and this line already carries it. Reading a
 * column that is not in `CHORE_COLUMNS` yet is not a bug: PostgREST returns the
 * columns it was asked for, so the property is simply absent and the fallback
 * is the whole point.
 */
export function toAllocatorChores(chores) {
  return chores.map((chore) => ({
    id: chore.id,
    expectedMinutes: chore.expected_minutes || 0,
    actualMinutes: chore.actual_minutes ?? null,
    assignedMemberId: chore.assigned_member_id ?? null,
    done: !isOutstanding(chore),
  }))
}

// `committedMinutes` and `commitmentByMember` lived here until #47.
//
// #36 built them for the per-person load figures on the chore screen, and #47
// moved that presentation to the split surface, which derives the same people
// from `allocation.assess` — done and outstanding minutes separately, each
// person's share of their own capacity, and the fair share the household is
// measured against. Nothing called these two afterwards but their own tests.
//
// They are DELETED rather than left exported, and the reason is the one this
// module already argues for `members.committed_minutes`: two implementations of
// "what is this person carrying" would disagree the first time either changed,
// and the second one would be the one nobody was looking at. The claims they
// held are in src/components/Split.test.jsx under "inherited from #36".

/** Remove a chore — AC 6. */
export async function removeChore(id) {
  unwrap(await getSupabase().from('chores').delete().eq('id', id), 'removing the chore')
}

/**
 * "20" → "20m", "90" → "1h 30m". The same reading aid the roster uses.
 *
 * Re-exported from household.js rather than reimplemented: two formatters that
 * drift apart would show the same quantity two ways on one screen.
 */
export { formatMinutes } from './household.js'

// Still deliberately absent, now that the per-member figure has arrived (#36):
// any household-wide RANKING, share-of-capacity percentage, or ordering by load.
// The per-member numbers above are in roster order and nothing here sorts them.
//
// The percentage is #47's, not an oversight. This story owns the DERIVATION and
// says it in the ugliest form that is honest — plain minutes — because the
// charter's test is that a proposal must not be satisfiable by a screenshot of
// the 2020 all-users view. #47 replaces the presentation with share-of-own-
// capacity; replacing it is cheap, and un-shipping a leaderboard is not.
