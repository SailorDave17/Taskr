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
 * The RPCs used to be a stated limit here — this list covers TABLES, per #78 AC 1,
 * so a migration that adds only a function was invisible to every check built on
 * it. `LIVE_RPCS` below closes that in #85, and the two lists stay separate
 * because a table and a function are probed by different means.
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
 * What the client CALLS on the live project — story #85.
 *
 * Every entry is an RPC the app invokes and the exact argument names it passes.
 * The argument names are not decoration: PostgREST resolves an overload by the
 * SET OF ARGUMENT NAMES, not by position, so `create_household(household_name,
 * organizer_name, household_timezone)` and `create_household(household_name,
 * household_tz, organizer_name, organizer_pin)` are two different functions to
 * it. A check that asked only about the name would call the live project healthy
 * while every household creation in the app failed — which is not hypothetical:
 * that was exactly the live project's state until `0007` was pasted on
 * 2026-08-20, and this check is what caught it (#85, then #108 confirmed the
 * paste cleared it).
 *
 * #85 was filed naming NINE RPCs. Five is correct and the difference is not a
 * narrowing of scope: `0007` DROPS `claim_member`, `claim_member_with_pin`,
 * `set_member_pin` and `join_household`, and the client stopped calling them at
 * #62. Probing for them would make this check red against a fully migrated
 * project — the same mistake as leaving `household_devices` in `LIVE_SCHEMA`
 * after #62 dropped it, which made both non-CI commands permanently red. The
 * list is derived from the call sites, and `liveSchema.test.js` fails if it ever
 * stops matching them in either direction.
 */
export const LIVE_RPCS = Object.freeze([
  Object.freeze({
    fn: 'create_household',
    args: Object.freeze(['household_name', 'organizer_name', 'household_timezone']),
  }),
  Object.freeze({ fn: 'complete_chore', args: Object.freeze(['chore_id']) }),
  Object.freeze({ fn: 'uncomplete_chore', args: Object.freeze(['chore_id']) }),
  Object.freeze({ fn: 'assign_chore', args: Object.freeze(['chore_id', 'member_id']) }),
  Object.freeze({ fn: 'unassign_chore', args: Object.freeze(['chore_id']) }),
])

/** The function names alone, for callers that do not need the signatures. */
export const LIVE_RPC_NAMES = Object.freeze(LIVE_RPCS.map((entry) => entry.fn))

/**
 * The one value every probe passes for every argument.
 *
 * A nil UUID is text that coerces to `uuid`, so one placeholder serves both
 * argument types this app passes and the probe needs no type table alongside the
 * name table. It matches no row of any household, which is the second half of
 * why it is safe.
 */
export const RPC_PROBE_VALUE = '00000000-0000-0000-0000-000000000000'

/** The arguments to probe `fn` with — every name it takes, all set to the placeholder. */
export function rpcProbeArgs(args) {
  return Object.fromEntries(args.map((name) => [name, RPC_PROBE_VALUE]))
}

/**
 * Did this probe prove the function is there, and if not, say what is wrong.
 *
 * The probe is a GET rather than the POST `supabase.rpc()` normally issues, and
 * that single difference is what makes it safe to run against production:
 * PostgREST serves GET inside a READ-ONLY TRANSACTION, so a function that writes
 * cannot write. Postgres refuses the write with `25006`, which is therefore a
 * PASS here — it is the database saying "this function exists, and I stopped it
 * before it changed anything". `schema.integration.test.js` asserts that
 * read-only behaviour directly rather than trusting this comment.
 *
 * So the classification is not a list of happy codes. It is a question about WHO
 * answered:
 *
 * - `PGRST202` / `PGRST203` are PostgREST's own, raised from its schema cache
 *   BEFORE the request reaches Postgres. They mean the function was never
 *   resolved: absent, renamed, or its argument names changed. This is the whole
 *   point of the check.
 * - `42501` is Postgres, and the function exists — but `execute` is not granted
 *   to this role, so the client cannot call it either. Distinct cause, identical
 *   consequence, so it is reported rather than tolerated. Same treatment the
 *   table probe gives a missing grant.
 * - Any OTHER five-character SQLSTATE means Postgres ran the call far enough to
 *   raise it, so the function resolved. `25006` (write refused), `22P02` (a bad
 *   UUID), `P0001` (the function's own `raise`) all say the same thing: present.
 * - No error at all means a non-volatile function simply ran and returned. Also
 *   present — and safe, because a function Postgres allows in a read-only
 *   transaction is one that cannot write by definition.
 *
 * Anything else — a `PGRST` code that is not one of ours, or an error with no
 * code at all, which is what a network failure looks like — is reported as
 * UNPROVEN rather than passed. An absent answer must not read as a clean one.
 */
export function describeRpcError(fn, args, error) {
  if (!error) return null
  const code = error.code || 'unknown'
  const detail = error.message || String(error)
  const asked = `\n    asked for: ${fn}(${args.join(', ')})`

  const failures = {
    PGRST202:
      'no function of this name takes exactly these arguments — the migration that ' +
      'creates it never ran, or its signature changed',
    PGRST203:
      'more than one function matches these arguments, so PostgREST refuses to pick — ' +
      'a `create or replace` with a changed signature adds an overload rather than ' +
      'replacing, and the client cannot call either',
    // PostgREST resolves from its own cache, so this should not be reachable. It
    // is accepted for the same reason the table probe accepts both `PGRST205` and
    // `42P01`: only one of the pair was guessable, and being wrong about which
    // arrives is not worth a wrong answer.
    '42883': 'Postgres does not have a function of this name and shape',
    '42501': 'the function exists and this role may not execute it, so the app cannot either',
  }[code]
  if (failures) return `${fn}: ${failures} [${code}] — ${detail}${asked}`

  // A SQLSTATE is five characters. Postgres raised it, so the call resolved.
  if (/^[0-9A-Z]{5}$/.test(code)) return null

  return (
    `${fn}: presence is UNPROVEN — the probe failed before Postgres could answer, so ` +
    `this says nothing about whether the function is there [${code}] — ${detail}${asked}`
  )
}

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
