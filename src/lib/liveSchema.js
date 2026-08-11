import { CAPACITY_COLUMNS } from './capacity.js'
import { CHORE_COLUMNS } from './chores.js'
import { MEMBER_COLUMNS } from './household.js'

/**
 * What the client asks the live project for — story #78.
 *
 * Every entry is a table this app reads and the exact column list it reads with.
 * The column lists are IMPORTED, never restated: `CHORE_COLUMNS` and its
 * equivalents are the same strings the data layer passes to `.select()`, so a
 * column added to a query cannot drift away from the thing that checks it. That
 * is #78 AC 3, and restating them here would have rebuilt the very gap this
 * story exists to close.
 *
 * One entry has no constant because the data layer has no constant for it:
 *
 * - `households` is read with `select('*')` (`household.js`, loading the
 *   household), so `*` is genuinely what the client asks for. Unlike `members`
 *   and `chores`, its grants were never narrowed to a column list, and a check
 *   that demanded a specific list here would assert something the app does not.
 *
 * `household_devices` was the second such entry and left with #62, which drops
 * the table. Removing it here is not bookkeeping: the check runs against the
 * LIVE project, so an entry for a dropped table would fail every run — correctly
 * — and the fix is to stop asking, not to tolerate the failure. It could only be
 * removed once `household.js` stopped reading it, and `liveSchema.test.js` is
 * what enforces that pairing in both directions.
 *
 * The RPCs are deliberately absent, and that is a stated limit rather than an
 * oversight: this list covers TABLES, per #78 AC 1. A migration that adds only a
 * function — `0006` added `assign_chore` and `unassign_chore` — would be invisible
 * to every check built on this list. Recorded in the story and in
 * `docs/access-model.md` rather than left to be discovered.
 */
export const LIVE_SCHEMA = Object.freeze([
  Object.freeze({ table: 'households', columns: '*' }),
  Object.freeze({ table: 'members', columns: MEMBER_COLUMNS }),
  Object.freeze({ table: 'chores', columns: CHORE_COLUMNS }),
  Object.freeze({ table: 'member_capacity', columns: CAPACITY_COLUMNS }),
])

/** The tables the client reads, for callers that only need the names. */
export const LIVE_TABLES = Object.freeze(LIVE_SCHEMA.map((entry) => entry.table))

/**
 * Turn a PostgREST error into a sentence that names the missing object.
 *
 * #78 AC 1 asks the failure to name what is missing, because the outage this
 * story comes from was diagnosed from exactly such a message — `42P01: relation
 * "public.chores" does not exist` — pasted by hand into the SQL editor. The
 * codes are Postgres's, not PostgREST's invention:
 *
 * - `42P01` undefined_table — the migration creating it never ran.
 * - `42703` undefined_column — the migration adding it never ran. `0004` and
 *   `0006` both add columns to an existing table, so a table-existence check
 *   alone would have missed both.
 * - `42501` insufficient_privilege — the table and column exist and this role
 *   cannot read them. Distinct cause, identical consequence for the client, so
 *   it is reported rather than tolerated.
 */
export function describeSchemaError(table, columns, error) {
  if (!error) return null
  const code = error.code || 'unknown'
  const detail = error.message || String(error)
  const known = {
    // PostgREST answers an unknown table from its schema cache BEFORE the query
    // reaches Postgres, so the code is its own, not `42P01`. Measured against the
    // live project on 2026-08-10: a table that does not exist returns `PGRST205`.
    // Both are accepted because a cache miss and a genuine undefined_table mean
    // the same thing to this app, and only one of them was guessable from docs.
    PGRST205: 'table does not exist in the live project',
    '42P01': 'table does not exist in the live project',
    // A column IS resolved by Postgres, and — measured — before the privilege
    // check, so an unknown column reports `42703` even for a role with no grants.
    '42703': 'a column this app selects does not exist in the live project',
    '42501': 'this role may not read it, so the app cannot either',
  }[code]
  return (
    `${table}: ${known || 'unexpected error'} [${code}] — ${detail}` +
    `\n    asked for: ${columns}`
  )
}
