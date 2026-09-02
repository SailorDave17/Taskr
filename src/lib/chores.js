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
import { normalizeDueDate } from './dueDates.js'

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
  'id, household_id, title, expected_minutes, due_on, created_at, completed_at, completed_by_member_id, missed_at, assigned_member_id, assigned_source, repeat_kind, repeat_weekdays, repeat_monthday, generated_from, actual_minutes, source'

/**
 * How a chore came to exist — `chores_source_known` in `0023`, story #211.
 *
 * Provenance, never privilege: nothing keys off this value, and a wrong one
 * costs an answer rather than an access decision. It exists so the extraction
 * bet (epic #217) can be judged on data — `docs/refresh-charter.md` makes trust
 * in extracted numbers a kill condition, and a kill condition nothing measures
 * is a sentence rather than a test.
 *
 * NOT to be confused with `assigned_source`, which is on the same row and
 * records how the ASSIGNMENT was decided ('manual' | 'auto' | null). The two
 * vocabularies deliberately share no word, so a value read from the wrong column
 * is a wrong answer rather than a plausible one.
 */
export const CHORE_SOURCES = Object.freeze(['manual', 'extraction'])

/** What a chore's origin is when nobody says otherwise. */
export const DEFAULT_CHORE_SOURCE = 'manual'

/** The bounds of `chores_expected_minutes_range`, named so the UI can say them. */
export const MIN_EXPECTED_MINUTES = 1
export const MAX_EXPECTED_MINUTES = 1440

/**
 * The catch-up bounds — #53 AC 4, made KIND-DEPENDENT by #103.
 *
 * Seven days for daily and weekly (owner decision 2026-08-24), one month for
 * monthly (owner decision 2026-08-31, taken on a review escalation): the same
 * seven days would have dropped a monthly chore's whole occurrence in silence,
 * which for a rent chore is the feature's headline case failing.
 *
 * THE AUTHORITY IS THE MIGRATION. `catch_up_repeats_at` in `0026` carries both
 * numbers and its copy is the one that decides what exists; these are the
 * client-side record, and repeats.pglite.test.js holds them equal so they
 * cannot drift apart silently.
 *
 * NEITHER IS RENDERED, and that is a change worth stating rather than leaving
 * to be noticed. Until #103 the notice sentence below named the seven days,
 * which was honest while one number governed every kind. The pass returns ONE
 * skipped count across every schedule it walked, so a sentence naming one
 * window would now be wrong whenever a household has both a daily and a
 * monthly repeat — and it is the monthly case, the one likeliest to be
 * skipped, that the old wording would have described incorrectly. So the
 * sentence names no window, and these constants survive as the record the
 * charter's decision log points at, kept true by a test rather than by a
 * reader.
 */
export const CATCH_UP_BOUND_DAYS = 7
export const CATCH_UP_BOUND_MONTHS = 1

/**
 * The estimate-update thresholds — #12 AC 4. Owner-ratified tunable defaults,
 * recorded in docs/refresh-charter.md's decision log (2026-08-26).
 *
 * An update is offered once a chore's family has at least
 * `MIN_COMPLETIONS_FOR_ESTIMATE_UPDATE` completed instances AND their average
 * actual deviates from the current estimate by
 * `ESTIMATE_DEVIATION_THRESHOLD` (a fraction of the estimate) or more. Both
 * boundaries are inclusive — exactly 3 completions at exactly 25% offers —
 * and the boundary test in chores.test.js spells the values literally rather
 * than deriving its fixtures from these constants, so changing either one
 * reddens a test instead of silently moving it.
 */
export const MIN_COMPLETIONS_FOR_ESTIMATE_UPDATE = 3
export const ESTIMATE_DEVIATION_THRESHOLD = 0.25

/** The schedule kinds `chores_repeat_kind_known` accepts, in the UI's order. */
export const REPEAT_KINDS = ['none', 'daily', 'weekly', 'monthly']

/**
 * The days a monthly repeat can be pinned to — #103. 1..31 because 31 is a
 * real choice: `0026`'s clamp makes it fire on every month's last day when the
 * month is shorter, which is the owner-ratified rule (skip-the-month was
 * rejected at the groom gate).
 */
export const MONTHDAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/** "1" → "1st", "22" → "22nd" — how a screen says a day of the month. */
export function ordinalOf(day) {
  const n = Number(day)
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

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
 * Minutes the work actually took — #12 AC 1.
 *
 * Bounds match `chores_actual_minutes_range`, and ZERO IS LEGAL — the one
 * deliberate difference from `normalizeExpectedMinutes`. A zero estimate
 * cannot be allocated against a budget of minutes, but "it took no time — it
 * was already done" is a real household fact, and allocation.test.js (#47
 * criterion 7) already pins that a recorded zero contributes zero. Its own
 * function rather than a call through the expected normalizer because the
 * rules AND the sentences differ, and a shared implementation would make one
 * form's refusal a side effect of editing the other's.
 */
export function normalizeActualMinutes(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error('How many minutes did it actually take?')
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Actual minutes must be a number.')
  if (!Number.isInteger(n)) throw new Error('Actual minutes must be a whole number of minutes.')
  if (n < 0) throw new Error('It cannot have taken negative time.')
  if (n > MAX_EXPECTED_MINUTES) {
    throw new Error('That is more than a day — was this really one chore?')
  }
  return n
}

/**
 * A due date as the `date` column wants it: `YYYY-MM-DD`, no time, no zone.
 *
 * Lived here until #202, which moved it to dueDates.js — a leaf module — so
 * the extraction grader can import it without inheriting this file's
 * supabase.js import (extraction.test.js walls the grader off from anything
 * that could reach the network). Re-exported rather than duplicated, because a
 * second implementation of the same validation is the drift the move avoids.
 * Every existing caller and its one-argument, ISO-only behaviour are
 * unchanged; the widened phrase-plus-reference form is #202's and is
 * documented at the definition.
 */
export { normalizeDueDate }

/**
 * The skip picker's date arithmetic — #105, re-exported from dueDates.js for
 * normalizeDueDate's reason: one implementation, living in the leaf module, so
 * the schedule mirror and the due-date rules cannot drift apart by having two
 * homes.
 */
export { localTodayIn, upcomingOccurrenceDates } from './dueDates.js'

/**
 * A schedule the columns will accept — #53 AC 6: structured, never free text.
 *
 * Takes the form's shape (`repeatKind` + `repeatWeekdays` + `repeatMonthday`,
 * #103) and returns the three COLUMN values, so a caller cannot send part of
 * a schedule: weekly without days, or monthly without a day of the month, is
 * refused here with a sentence, and the check constraints
 * `chores_repeat_weekdays_shape` and `chores_repeat_monthday_shape` refuse it
 * again at the database for any caller that skips this function.
 *
 * Weekdays come back sorted and deduplicated. The constraint tolerates a
 * duplicate (it is harmless to the schedule arithmetic), but a stored
 * `{5,1,5}` would render back as a different-looking set than was saved.
 */
export function normalizeRepeat({ repeatKind, repeatWeekdays, repeatMonthday } = {}) {
  const kind = repeatKind === undefined || repeatKind === null ? 'none' : String(repeatKind)
  if (!REPEAT_KINDS.includes(kind)) {
    throw new Error('A repeat is daily, weekly or monthly — anything fancier is not a schedule yet.')
  }

  const hasMonthday =
    repeatMonthday !== undefined && repeatMonthday !== null && String(repeatMonthday).trim() !== ''

  if (kind !== 'monthly' && hasMonthday) {
    throw new Error('A day of the month only makes sense on a monthly repeat.')
  }

  if (kind === 'monthly') {
    if (Array.isArray(repeatWeekdays) && repeatWeekdays.length > 0) {
      throw new Error('Weekdays only make sense on a weekly repeat.')
    }
    if (!hasMonthday) {
      throw new Error('A monthly repeat needs a day of the month.')
    }
    const day = Number(repeatMonthday)
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error('A day of the month is 1 through 31.')
    }
    return { repeat_kind: 'monthly', repeat_weekdays: null, repeat_monthday: day }
  }

  if (kind !== 'weekly') {
    if (Array.isArray(repeatWeekdays) && repeatWeekdays.length > 0) {
      throw new Error('Weekdays only make sense on a weekly repeat.')
    }
    return { repeat_kind: kind, repeat_weekdays: null, repeat_monthday: null }
  }

  const days = Array.isArray(repeatWeekdays) ? repeatWeekdays.map(Number) : []
  if (days.length === 0) {
    throw new Error('A weekly repeat needs at least one weekday.')
  }
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new Error('A weekday is 1 (Monday) through 7 (Sunday).')
  }
  return {
    repeat_kind: 'weekly',
    repeat_weekdays: [...new Set(days)].sort((a, b) => a - b),
    repeat_monthday: null,
  }
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
export async function addChore({
  title,
  expectedMinutes,
  dueOn,
  repeatKind,
  repeatWeekdays,
  repeatMonthday,
  householdId,
  // #211 — where the chore came from. Defaulted rather than required, so every
  // existing call site keeps its current meaning without being edited: App.jsx
  // spreads a form object that names no source, and a typed chore is exactly
  // what 'manual' means. The extraction path (#213) is the one caller that will
  // pass anything else.
  //
  // Validated by the check constraint in 0023 and NOT here, which is
  // `setCapacity`'s shape for the same column and the same reason: this is
  // provenance, so a bad value costs an answer rather than an access decision,
  // and a second copy of the vocabulary in a client-side guard is a second copy
  // to drift. `chores.pglite.test.js` holds CHORE_SOURCES equal to what the
  // constraint admits, which is the binding that keeps the two honest.
  source = DEFAULT_CHORE_SOURCE,
}) {
  const cleanTitle = normalizeTitle(title)
  const minutes = normalizeExpectedMinutes(expectedMinutes)
  const due = normalizeDueDate(dueOn)
  // #53 — the repeat is set where the chore is created, as a property of the
  // chore. There is no templates screen to route through, and callers that say
  // nothing get 'none', which is the column's own default.
  const repeat = normalizeRepeat({ repeatKind, repeatWeekdays, repeatMonthday })

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
        repeat_monthday: repeat.repeat_monthday,
        // Written explicitly rather than left to the column's DEFAULT. The two
        // are identical for a typed chore, and stating it is what makes the
        // insert path a thing a mutation can remove and a test can miss — the
        // column default would silently supply 'manual' and every assertion
        // would go on passing while the client had stopped saying anything.
        source,
      })
      .select(CHORE_COLUMNS)
      .single(),
    'adding the chore',
  )
}

/**
 * Add several chores in one confirmed pass — #220.
 *
 * A loop over `addChore`, and that it is NOTHING MORE is the story's central
 * decision (filed 2026-08-26): no bulk insert, no second write route, no new
 * grant. Every row lands exactly as a singly-added chore does, so nothing
 * downstream — the allocator, the repeat pass, `liveSchema.js` — can tell the
 * two apart, and there is no second refusal behaviour to keep in step.
 *
 * SEQUENTIAL, deliberately. `created_at` then orders the rows in entry order
 * (listChores breaks due-date ties on it), and a per-row outcome can name which
 * rows landed when one is refused mid-batch — #220 AC 5's whole requirement.
 *
 * NEVER THROWS for a refused row. A thrown error could only say "something
 * failed" after some rows are already durable; the outcome array says which.
 * One outcome per input row, in the same order, `{ ok: true, chore }` or
 * `{ ok: false, message }` — the caller prunes the saved rows so a re-confirm
 * cannot duplicate them.
 */
export async function addChores(rows, { householdId } = {}) {
  const outcomes = []
  for (const row of rows) {
    try {
      // householdId is spread LAST so a stray one inside a row cannot override
      // the household the caller is showing — the same defence addChore itself
      // makes for the snake_case spelling.
      outcomes.push({ ok: true, chore: await addChore({ ...row, householdId }) })
    } catch (err) {
      outcomes.push({ ok: false, message: err.message })
    }
  }
  return outcomes
}

/**
 * Edit a chore's title, minutes, due date — #34 AC 6 — or its repeat — #54.
 *
 * The repeat fields travel TOGETHER, never partially: the shape constraints
 * (`chores_repeat_weekdays_shape`, `chores_repeat_monthday_shape`) tie
 * `repeat_kind` to `repeat_weekdays` and `repeat_monthday`, so a patch naming
 * any of them names all three, through the same `normalizeRepeat` the add
 * path calls. A weekdays-only or monthday-only patch is refused here with a
 * sentence rather than sent — `normalizeRepeat` would read the missing kind
 * as 'none' and silently switch the repeat off, which is not what a caller
 * editing the schedule meant.
 *
 * Propagation is #54's ratified option (b) BY CONSTRUCTION, and this function
 * is where the claim is easiest to mis-fix later, so it is stated here: an
 * occurrence copies its minutes at creation (0012), so an estimate edit on the
 * anchor reaches only occurrences created AFTER it, and never rewrites work
 * already on somebody's list. There is deliberately no second statement here
 * updating occurrence rows — #54 AC 6 mutates that shape in and records which
 * tests redden.
 */
export async function updateChore(
  id,
  { title, expectedMinutes, dueOn, repeatKind, repeatWeekdays, repeatMonthday },
) {
  const patch = {}
  if (title !== undefined) patch.title = normalizeTitle(title)
  if (expectedMinutes !== undefined) patch.expected_minutes = normalizeExpectedMinutes(expectedMinutes)
  if (dueOn !== undefined) patch.due_on = normalizeDueDate(dueOn)
  if (repeatKind === undefined && (repeatWeekdays !== undefined || repeatMonthday !== undefined)) {
    throw new Error('A schedule edit names how often — pass repeatKind with the schedule fields.')
  }
  if (repeatKind !== undefined) {
    const repeat = normalizeRepeat({ repeatKind, repeatWeekdays, repeatMonthday })
    patch.repeat_kind = repeat.repeat_kind
    patch.repeat_weekdays = repeat.repeat_weekdays
    patch.repeat_monthday = repeat.repeat_monthday
  }

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
 * Record that a chore did not get done — #305.
 *
 * Through an RPC for the same reason completion is (0027, quoting 0004): the
 * CLOCK. `missed_at` decides which capacity week the Done surface files the
 * row under, so the server stamps it and the client cannot. The column is in
 * no update grant, so this is the only path there is.
 */
export async function missChore(id) {
  return unwrap(await getSupabase().rpc('miss_chore', { chore_id: id }), 'marking it not done')
}

/** Undo a miss — the chore returns to the outstanding list. */
export async function unmissChore(id) {
  return unwrap(
    await getSupabase().rpc('unmiss_chore', { chore_id: id }),
    'putting it back on the list',
  )
}

/**
 * Adjust how long a chore really took — #12 AC 1.
 *
 * A plain column-granted update, unlike completion, and the difference is
 * argued in 0015: `completed_at` moves only through a function because of the
 * server clock, while an actual is a member's own claim about their own time
 * with no derived rule keying off it — allocation reads `expected_minutes`
 * only. Completion seeds the value to the estimate (the zero-tap default);
 * this is the path for saying otherwise.
 */
export async function recordActualMinutes(id, actualMinutes) {
  const minutes = normalizeActualMinutes(actualMinutes)
  return unwrap(
    await getSupabase()
      .from('chores')
      .update({ actual_minutes: minutes })
      .eq('id', id)
      .select(CHORE_COLUMNS)
      .single(),
    'recording how long it took',
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
    `${what} older than the catch-up window ` +
    `${n === 1 ? 'was' : 'were'} skipped rather than piled onto this week.`
  )
}

/**
 * How far ahead the skip picker looks, and how many dates it offers — #105,
 * REWORKED by #103's review.
 *
 * Presentation only: the exception table takes any date, and the pass honours
 * whatever is stored.
 *
 * WHY THIS IS NO LONGER A DAY COUNT. It was `SKIP_OFFER_HORIZON_DAYS = 28`,
 * argued from "four weeks covers 'we're away next week'" and from capping a
 * daily repeat at 28 options. Both halves are about DAILY, and 28 days is
 * shorter than a monthly period — so the moment #103 added monthly, the
 * control offered nothing at all for days at a time, and `SkipControl`
 * returns null when it has nothing to offer, so the whole affordance
 * disappeared from the row with no explanation and came back with no user
 * action. *Measured during review*: for a monthly-on-the-15th chore the offer
 * list is empty on 2026-08-16 and 08-17, and for a NEWLY CREATED anchor first
 * due 2026-09-15 it is empty from 2026-08-01 right through 2026-09-16 —
 * roughly six weeks in which #105's stated purpose is unreachable on the
 * first use of a monthly schedule.
 *
 * A day count cannot fit all three kinds: any window wide enough for monthly
 * offers a daily repeat a hundred-odd options. What fits every kind is a
 * COUNT OF OCCURRENCES — the next N dates this schedule produces, whatever
 * its period — with a scan ceiling so the loop is bounded for a schedule that
 * produces nothing (a monthly anchor needs ~366 days to yield twelve).
 *
 * Twelve is the select's constraint rather than the calendar's: it is a
 * comfortable list on a phone, and it means daily now offers twelve days
 * where it offered twenty-eight. That narrowing is deliberate and is the
 * trade — "we're away next week" fits inside twelve days, and the kinds that
 * gain are the two the old number was never chosen for.
 */
export const SKIP_OFFER_MAX_DATES = 12
export const SKIP_OFFER_SCAN_DAYS = 400

// The columns a client may read, matching the select grant in 0025 exactly.
// `household_id` stays absent and a wildcard select still fails loudly here —
// 0010's reasoning, restated in 0025.
export const REPEAT_EXCEPTION_COLUMNS = 'id, chore_id, excluded_on, created_at'

/**
 * Every exception date this household's repeating chores carry — #105.
 *
 * Scoped by ANCHOR ids rather than a household id, because `household_id` is
 * deliberately not in the select grant (0025) — the same shape as
 * `listExclusions`, which scopes by the member set for the same reason. Only
 * anchors can carry exceptions, so the caller passes the anchor ids it is
 * showing and the list stays as small as the household's schedules.
 */
export async function listRepeatExceptions(anchorIds) {
  if (!Array.isArray(anchorIds)) {
    throw new Error('Which repeats? An exception read must name their anchor chores.')
  }
  if (anchorIds.length === 0) return []
  return (
    unwrap(
      await getSupabase()
        .from('chore_repeat_exceptions')
        .select(REPEAT_EXCEPTION_COLUMNS)
        .in('chore_id', anchorIds),
      'loading the skipped dates',
    ) ?? []
  )
}

/**
 * Skip one occurrence of a repeating chore — #105.
 *
 * Through an RPC for the house's ACCESS reason in its strongest form: the
 * client holds no write privilege on the exception table at all, so this is
 * not the preferred path but the only one. The function stores the exception
 * AND removes that date's uncompleted generated instance in one transaction —
 * the ratified retroactivity rule (uncompleted goes, completed stays as
 * history) lives in `0025` where no client can apply half of it.
 *
 * Returns the number of instance rows removed (0 for an upcoming date, 1 when
 * catch-up had already generated the occurrence). Callers refresh afterwards
 * like every other mutation, so the value is informational.
 */
export async function skipRepeatOccurrence(choreId, skipDate) {
  if (!choreId) throw new Error('Which repeating chore is being skipped?')
  const date = normalizeDueDate(skipDate)
  return unwrap(
    await getSupabase().rpc('skip_repeat_occurrence', { chore_id: choreId, skip_date: date }),
    'skipping that date',
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
  if (chore.repeat_kind === 'monthly') {
    // #103. Days 29–31 do not exist in every month, and the clamp is a fact a
    // person planning rent day needs on screen — a bare "on the 31st" reads as
    // skipping February, which is exactly the rejected behaviour.
    const day = Number(chore.repeat_monthday)
    if (!Number.isInteger(day)) return 'repeats monthly'
    return day >= 29
      ? `repeats monthly on the ${ordinalOf(day)} (last day of shorter months)`
      : `repeats monthly on the ${ordinalOf(day)}`
  }
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

/** Was this chore recorded as not done? — #305. Null and absent both mean no. */
export function isMissed(chore) {
  return chore.missed_at !== null && chore.missed_at !== undefined
}

/**
 * Was this chore finished? — keyed on `completed_at` alone.
 *
 * Until #305 this was `!isOutstanding`, and the two were one question. A
 * missed chore is neither outstanding nor completed, so every reader that
 * meant FINISHED — the actuals, the "took" line, the count on the Chores tab —
 * asks this, and every reader that meant STILL TO DO asks `isOutstanding`.
 * A row satisfies at most one of the three (0027's constraint forbids both
 * stamps at once), which is what lets each reader ask only its own question.
 */
export function isCompleted(chore) {
  return chore.completed_at !== null && chore.completed_at !== undefined
}

/**
 * Is this chore still to do? The whole definition of outstanding, in one place.
 *
 * Both stamps null — #305 taught it the second column. A row that carries
 * neither is on the list; a row that carries either has left it.
 */
export function isOutstanding(chore) {
  return !isCompleted(chore) && !isMissed(chore)
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
 * The completed instances a chore's feedback is computed over — #12 AC 2.
 *
 * A chore's FAMILY is itself plus the occurrences generated from it: a repeat
 * anchor gathers everything its schedule produced (0012 — the anchor's own
 * `due_on` is the first occurrence, so the anchor's own completion counts),
 * and a one-off's family is just itself, which is how feedback stays
 * not-template-only without a second rule. An occurrence row's family is also
 * itself alone — its history belongs to the anchor, and double-counting it
 * under both would weight the average by nothing real.
 *
 * COMPLETED, not "not outstanding" — #305. A missed occurrence has left the
 * list and carries no actual, so counting it here would put its estimate into
 * the average as though somebody had done the work in exactly the expected
 * time, and would count toward the completion floor an estimate update waits
 * for. It is ignored: the family's history is the work that happened.
 */
export function completedInstances(chore, chores) {
  return chores.filter(
    (c) => (c.id === chore.id || c.generated_from === chore.id) && isCompleted(c),
  )
}

/**
 * Expected-versus-actual, summarised for one chore's family — #12 ACs 2 & 3.
 *
 * Null when there are no completed instances, and the caller renders "no data
 * yet" — never a fabricated average. Where an instance predates 0015 and so
 * carries no actual, its estimate stands in, which is `minutesOf`'s exact
 * fallback: one definition of what a piece of work cost, not two.
 */
export function actualsSummary(chore, chores) {
  const done = completedInstances(chore, chores)
  if (done.length === 0) return null
  const total = done.reduce((sum, c) => sum + (c.actual_minutes ?? c.expected_minutes ?? 0), 0)
  return { count: done.length, averageMinutes: total / done.length }
}

/**
 * The one-tap estimate update, or null when none is owed — #12 AC 4.
 *
 * Offered once the family has at least MIN_COMPLETIONS_FOR_ESTIMATE_UPDATE
 * completed instances and their average deviates from the CURRENT estimate by
 * ESTIMATE_DEVIATION_THRESHOLD or more, both inclusive. The suggested value is
 * the average rounded to whole minutes and held to the column's own bounds.
 * A suggestion that rounds back to the current estimate is withheld — a
 * button offering to change 1 minute to 1 minute is noise wearing a number.
 *
 * Accepting is `updateChore(id, { expectedMinutes })` on the anchor, and the
 * propagation is #54's ratified option (b) BY CONSTRUCTION: an occurrence
 * copies its minutes at creation (0012), so a new estimate reaches future
 * occurrences and never rewrites work already on somebody's list.
 *
 * No repeat-kind gate, deliberately: a one-off or an occurrence has a family
 * of one, so the completion floor already keeps the offer to anchors — a
 * second gate would be a copy of that arithmetic that could drift from it.
 */
export function estimateSuggestion(chore, chores) {
  const summary = actualsSummary(chore, chores)
  if (!summary || summary.count < MIN_COMPLETIONS_FOR_ESTIMATE_UPDATE) return null

  const expected = chore.expected_minutes || 0
  if (expected < MIN_EXPECTED_MINUTES) return null
  const deviation = Math.abs(summary.averageMinutes - expected) / expected
  if (deviation < ESTIMATE_DEVIATION_THRESHOLD) return null

  const suggested = Math.min(
    MAX_EXPECTED_MINUTES,
    Math.max(MIN_EXPECTED_MINUTES, Math.round(summary.averageMinutes)),
  )
  return suggested === expected ? null : suggested
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
 * `actualMinutes` is passed through UNCHANGED. #12 added the column; rows
 * completed before 0015 carry null there, and `allocation.minutesOf` falls
 * back to the estimate for exactly those — the same fallback `actualsSummary`
 * uses, so the bar and the feedback line cannot disagree about what an old
 * completion cost.
 *
 * A MISSED chore is dropped here rather than passed through — #305. It
 * contributes nothing: not open load (it is not going to happen) and not done
 * minutes (nobody did it). Passing it as `done: true` would credit its holder
 * with the estimate; passing it as `done: false` would count it as work still
 * to do and the allocator would try to place it. Neither is the fact, so the
 * allocator never sees the row — which is also why `announce.js`'s snapshot
 * and the split surface's probe drop it for free, both being built from this.
 */
export function toAllocatorChores(chores) {
  return chores
    .filter((chore) => !isMissed(chore))
    .map((chore) => ({
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
