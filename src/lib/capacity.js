// Capacity as a fact about a particular week — story #44.
//
// `members.weekly_minutes` is the BASELINE: what a person usually has. This
// module owns the delta — the week that is not usual — and the one function that
// resolves the two into the number the split actually divides.
//
// The charter's complaint about every competitor is that they treat capacity as
// a constant. Until this story Taskr did too, and the allocator (#40) was
// deliberately built to receive capacity as an argument so that fixing it would
// not require touching the allocator at all. This is the other end of that
// contract.
//
// Nothing here is a security boundary. The rules that hold are the row-level
// policies and the column grants in 0005; these turn a constraint violation into
// a sentence a person can act on.

import { getSupabase } from './supabase.js'

/**
 * The day a household's week begins — owner decision, 2026-08-08.
 *
 * ISO 8601 Monday, and named rather than inlined because it is a decision with
 * alternatives, not a fact. The reasoning and what Sunday and Saturday would
 * have cost are in docs/capacity-model.md.
 *
 * The migration enforces it with a check constraint on `period_start`
 * (`extract(isodow) = 1`), so this constant and the database cannot drift into
 * disagreeing — a row filed under any other weekday cannot exist.
 */
export const WEEK_STARTS_ON = 'Monday'

/** `WEEK_STARTS_ON` as Postgres `isodow` — Monday is 1. */
export const WEEK_START_ISO_DOW = 1

// Matches the select grant in 0005 exactly; `select('*')` still fails on this
// table, and that is unchanged by #159. 0014 grants `household_id` on `members`
// and `chores` only — `member_capacity` keeps its withheld `household_id` and
// keeps the loud wildcard refusal with it.
//
// The comment that stood here argued the client could not name a household
// because RLS already scoped it. That reasoning is what expired (#159 AC 8): RLS
// still scopes correctly, but to every household the caller belongs to, which is
// no longer necessarily one. This table does not need the column anyway — it is
// scoped from an already-scoped MEMBER set, which is why #157 measured it as
// needing no grant change.
export const CAPACITY_COLUMNS =
  'id, member_id, period_start, minutes, note, source, created_at'

/** The bounds of `member_capacity_minutes_range`, named so the UI can say them. */
export const MIN_CAPACITY_MINUTES = 0
export const MAX_CAPACITY_MINUTES = 10080

function unwrap({ data, error }, whatWeWereDoing) {
  if (error) {
    const err = new Error(`${whatWeWereDoing}: ${error.message}`)
    err.cause = error
    throw err
  }
  return data
}

/**
 * The calendar date, in a named zone, of an instant — as `YYYY-MM-DD`.
 *
 * `en-CA` because it formats exactly that way; the alternative is assembling
 * parts by hand from `formatToParts`, which is the same thing with more places
 * to get it wrong.
 *
 * The `timeZone` option is what makes this independent of the machine. Every
 * local getter on Date — `getDate`, `getDay`, `getFullYear` — reads the AMBIENT
 * zone, so a boundary computed with them is a boundary that changes depending on
 * which phone asked. That is the fault this whole function exists to prevent,
 * and a test asserts none of them appear in this file.
 */
function localDateIn(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * The household-local date the week containing `instant` begins on.
 *
 * @param {Date|number|string} instant
 * @param {string} timeZone an IANA name, from `households.timezone`
 * @returns {string} `YYYY-MM-DD`, always a Monday
 *
 * Two-stage on purpose. First resolve the instant to a LOCAL calendar date in
 * the household's zone; then do pure calendar arithmetic on that date in UTC.
 * The second stage never touches a zone at all, so no daylight-saving transition
 * can shift it — the classic bug here is subtracting `n * 86400000` milliseconds
 * across a DST boundary and landing an hour into the previous day.
 */
export function periodStartFor(instant, timeZone) {
  if (!timeZone) throw new Error('A period needs the household timezone.')
  const at = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(at.getTime())) throw new Error('That is not a real instant.')

  const [year, month, day] = localDateIn(at, timeZone).split('-').map(Number)

  // Midnight UTC on the local calendar date. A pure date carrier from here on —
  // the UTC getters below are correct precisely because the value is not an
  // instant any more.
  const asUtc = new Date(Date.UTC(year, month - 1, day))
  const isoDow = asUtc.getUTCDay() === 0 ? 7 : asUtc.getUTCDay()
  asUtc.setUTCDate(asUtc.getUTCDate() - (isoDow - WEEK_START_ISO_DOW))

  return asUtc.toISOString().slice(0, 10)
}

/**
 * The minutes this member actually has for the period — THE single definition.
 *
 * @param {{weekly_minutes: number}} member the baseline, as stored on the row
 * @param {{minutes: number}|null|undefined} override the week's override, if any
 *
 * An override of ZERO must win. `override?.minutes || baseline` would silently
 * fall through to the baseline for the person who has said they have no time at
 * all this week — the case the feature most exists to serve — so the presence of
 * the row, not the truthiness of its value, is what decides.
 *
 * #44 AC 7: every consumer resolves capacity here. The allocator (#40) never
 * sees `weekly_minutes`; it is handed the output of this function.
 */
export function effectiveCapacity(member, override) {
  const baseline = Number(member?.weekly_minutes ?? 0)
  if (override == null || override.minutes == null) return baseline
  return Number(override.minutes)
}

/**
 * Every member's capacity for a period, as the allocator wants it.
 *
 * Returns `{id, capacityMinutes}` — the allocator's input shape, built here
 * rather than in the allocator, which is what keeps that module unable to read
 * the member row at all.
 *
 * `periodStart` is required and the overrides are filtered against it HERE
 * rather than trusted to have been filtered by the caller. `listCapacity` does
 * query by period, so this looks redundant — it is not. An override silently
 * applied to the wrong week is invisible: every number stays plausible, the
 * split just responds to a week that is not this one. #44 AC 7 asks for a test
 * that a foreign period does not apply, and a property the caller is merely
 * trusted to uphold has nowhere for that test to land.
 */
export function capacitiesFor(members, overrides, periodStart) {
  if (!periodStart) throw new Error('Capacities are for a particular week.')
  const byMember = new Map(
    overrides.filter((o) => o.period_start === periodStart).map((o) => [o.member_id, o]),
  )
  return members.map((member) => ({
    id: member.id,
    capacityMinutes: effectiveCapacity(member, byMember.get(member.id)),
  }))
}

/**
 * Did a roster save actually move this member's baseline? — #49.
 *
 * The owner extended the re-assignment trigger to baseline edits at pickup of
 * #49, and the roster's save form always sends `weeklyMinutes` whether or not
 * the person touched it — so the caller needs to know whether the value MOVED,
 * or a name-only edit would overwrite `last_rebalance` with a run nothing
 * prompted.
 *
 * Here rather than in App.jsx because this file is the one place baseline and
 * override meet: capacity.test.js's reader allowlist exists precisely so that a
 * new consumer of `weekly_minutes` has to arrive through this module and be
 * asked whether it should.
 */
export function baselineMoved(member, weeklyMinutes) {
  if (weeklyMinutes === undefined) return false
  return Number(weeklyMinutes) !== Number(member?.weekly_minutes ?? 0)
}

/** Minutes a person can claim for a week. */
export function normalizeCapacityMinutes(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error('How many minutes do you have this week?')
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Minutes must be a number.')
  if (!Number.isInteger(n)) throw new Error('Minutes must be a whole number.')
  if (n < MIN_CAPACITY_MINUTES) throw new Error('Minutes cannot be negative.')
  if (n > MAX_CAPACITY_MINUTES) throw new Error('That is more than a week has in it.')
  return n
}

/**
 * Every override ONE household has recorded for a period — #159 AC 1.
 *
 * Scoped by `memberIds` rather than by a household id, because `member_capacity`
 * withholds `household_id` and needs no grant to be scoped: the caller already
 * holds the household's member set, and a row belongs to this household exactly
 * when its member does. That is the whole reason 0014 touches two tables instead
 * of five.
 *
 * An empty member set short-circuits to `[]` rather than issuing `in ()`. A
 * household with no members has no overrides by construction, and PostgREST
 * renders an empty `in` list as a filter matching nothing — correct, but a round
 * trip to be told so.
 */
export async function listCapacity(periodStart, memberIds) {
  if (!Array.isArray(memberIds)) throw new Error('Which household? A capacity read must name its members.')
  if (memberIds.length === 0) return []
  return (
    unwrap(
      await getSupabase()
        .from('member_capacity')
        .select(CAPACITY_COLUMNS)
        .in('member_id', memberIds)
        .eq('period_start', periodStart),
      'loading this week’s capacity',
    ) ?? []
  )
}

/**
 * Record or correct a member's capacity for a period.
 *
 * An upsert on `(member_id, period_start)`, because a second declaration for the
 * same week is a correction rather than a second fact — the unique constraint in
 * 0005 says so and this is the client half of it.
 */
export async function setCapacity({ memberId, periodStart, minutes, note = null, source = 'manual', householdId }) {
  const value = normalizeCapacityMinutes(minutes)
  if (!householdId) throw new Error('Which household? Saving capacity must name one.')

  return unwrap(
    await getSupabase()
      .from('member_capacity')
      .upsert(
        {
          household_id: householdId,
          member_id: memberId,
          period_start: periodStart,
          minutes: value,
          note,
          source,
        },
        { onConflict: 'member_id,period_start' },
      )
      .select(CAPACITY_COLUMNS)
      .single(),
    'saving this week’s capacity',
  )
}

/**
 * Drop an override, so the member falls back to their baseline.
 *
 * NO household argument, deliberately — and #159 AC 4's enumeration is slightly
 * wrong about this one. It groups `clearCapacity` with the four writes that
 * "read `currentHousehold()` and insert its `household_id`"; this function has
 * never done either. It is a DELETE, so there is no `household_id` to write and
 * no written row to read back, which is the evidence that criterion asks for.
 *
 * The narrower property that is true and that scopes it: a `member_id` belongs
 * to exactly one household by construction — each household has its own member
 * rows — so naming a member already names a household, and
 * `member_capacity_delete_same_household` refuses any row outside
 * `current_household_ids()` regardless. Adding a household argument here would
 * be a parameter the statement could only check against itself.
 *
 * `allowMember` in exclusions.js is the same shape for the same reason.
 */
export async function clearCapacity(memberId, periodStart) {
  unwrap(
    await getSupabase()
      .from('member_capacity')
      .delete()
      .eq('member_id', memberId)
      .eq('period_start', periodStart),
    'clearing this week’s capacity',
  )
}
