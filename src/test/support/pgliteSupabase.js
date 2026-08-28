// A real Postgres to run the migrations against, with enough of Supabase around
// it that the answers mean something.
//
// Why this exists: `supabase/migrations/*.sql` is applied by a human pasting it
// into the Supabase SQL editor. Nothing between writing it and that paste parses
// it — there is no local Postgres, no Supabase CLI and no Docker on the build
// machine — so until now the first thing to read the file was production. A
// migration that fails halfway leaves a half-applied schema, and 0001's own
// comments already record that a re-paste is the normal path rather than an edge
// case.
//
// PGlite is Postgres 18 compiled to WASM. It genuinely executes; it is not a
// parser and not a mock.
//
// WHAT A PASS HERE MEANS: "consistent with Postgres, given the Supabase-shaped
// environment stubbed below". It does NOT mean "Supabase will accept this".
// The stub is the weak point and it is deliberately small and readable, so the
// gap between it and the real platform is inspectable rather than assumed.

import { vi } from 'vitest'

/**
 * How long one pglite `beforeEach` may take — #145, measured rather than
 * inherited.
 *
 * Set HERE because every pglite suite imports this module, so the limit is one
 * line rather than nine that can drift apart. `vi.setConfig` from an imported
 * module applies to the file that imported it, and a mutation proved it reaches
 * all nine: dropped to 1ms, every pglite file goes red.
 *
 * WHY IT WAS RAISED. `assignment.pglite.test.js` used to say `hookTimeout` was
 * deliberately left at vitest's 10s default, because "beforeEach builds exactly
 * one database in all eight pglite files, none has ever timed out". Two of them
 * then did, in two full-suite runs out of four on the dev machine — and both
 * passed 18/18 and 29/29 in isolation moments later, so the failing thing was
 * the limit, not either suite.
 *
 * WHAT WAS MEASURED. `freshDatabase` — the dominant term, a Postgres built in
 * WASM with every migration applied — timed on every call across two full
 * `npm test` runs on the dev machine, 448 samples:
 *
 *     median 5923ms   p90 6497ms   p99 10718ms   max 11471ms
 *     over 10000ms: 12 of 448, spread across seven of the nine files
 *
 * So the hook's dominant term alone exceeded the old limit about 3% of the
 * time, which is why the failure moved from file to file and looked like a
 * different defect each run. The rest of a `beforeEach` is a handful of queries
 * against an already-built database and is sub-second.
 *
 * WHY 45s. ~3.9x the worst time actually observed, which is the same discipline
 * the `testTimeout: 30_000` comment in assignment.pglite.test.js applies (~3.7x
 * its worst). The headroom is for CONTENTION: the spread between the median
 * (5923ms) and the max (11471ms) is the whole story here, and what decides a run
 * is what else the machine is doing while nine pglite files start in parallel.
 *
 * It is NOT for "CI is slower", and that correction is kept because it is how
 * this number was almost justified wrongly. The first version of this comment
 * argued from #53, which measured a test BODY at 3460ms locally against
 * 7800-8107ms on `ubuntu-latest`, and extrapolated 11471 x 2.3 = ~26s. A
 * same-day measurement in a sibling repo asked the question directly and found
 * the opposite for pglite BOOT: `ubuntu-latest` 5819ms against a local idle max
 * of 6232ms, i.e. no slower. See cairn's
 * `reference/pglite-and-vitest-harness-facts-2026-08-25.md`, which also records
 * that the boot dominates and does not grow as migrations accumulate, so this
 * cost is per FILE rather than per migration.
 *
 * The value does not change; the reason does. 45s is ~4.4x the worst that note
 * measured under full CPU saturation (10134ms) and ~3.9x the worst measured
 * here, so it is comfortable on both sets of numbers - which is the point of
 * recording which of them it rests on.
 *
 * THE COST, stated rather than discovered: a genuine hang still fails, and it
 * now takes 45s to do it instead of 10s. Proven — a `beforeEach` made to sleep
 * past the limit fails with `Hook timed out in 45000ms`.
 */
export const PGLITE_HOOK_TIMEOUT_MS = 45_000

vi.setConfig({ hookTimeout: PGLITE_HOOK_TIMEOUT_MS })

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', '..', 'supabase', 'migrations')

export const MIGRATIONS = [
  '0001_household_and_roster.sql',
  '0002_member_pins_and_column_grants.sql',
  '0003_chores.sql',
  '0004_chore_completion.sql',
  '0005_weekly_capacity.sql',
  '0006_chore_assignment.sql',
  '0007_per_member_auth.sql',
  '0008_provisioning_grants.sql',
  '0009_membership_is_per_household.sql',
  '0010_chore_exclusions.sql',
  '0011_calendar_connection.sql',
  '0012_repeating_chores.sql',
  '0013_grants_the_platform_no_longer_infers.sql',
  '0014_scope_reads_to_one_household.sql',
  '0015_actual_minutes.sql',
  '0016_organizer_only_removal.sql',
  '0017_anon_holds_nothing_in_public.sql',
  '0018_stored_reassignment.sql',
  '0019_authenticated_holds_only_what_a_migration_granted.sql',
  '0020_split_seen.sql',
  '0021_fairness_note_dismissed.sql',
]

export function migrationSql(name) {
  return readFileSync(join(migrationsDir, name), 'utf8')
}

/**
 * Every `.sql` file actually sitting in supabase/migrations, sorted.
 *
 * The array above is hand-maintained and applied in order, which is correct —
 * order matters and a directory listing does not carry intent. The hazard is
 * that adding a migration file and forgetting the one-line edit here leaves it
 * silently untested while the whole suite stays green, which is a pass that
 * means nothing. #34 AC 8 turns that into a failing test; this is what it reads.
 */
export function migrationFilesOnDisk() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

// The parts of Supabase the migrations depend on. Each line here is a claim
// about the real platform; they are listed rather than bundled so a wrong one is
// findable.
//
// The default privileges matter more than they look, and this line USED TO
// overstate the platform on purpose. #91 narrowed it, and the reason is the
// whole point of that story.
//
// *Measured 2026-08-13* against `supabase start` (CLI 2.114.0), and re-measured
// here: the default ACL for tables created by `postgres` in `public` is
// `anon=Dxtm authenticated=Dxtm service_role=Dxtm` — TRUNCATE, REFERENCES,
// TRIGGER, MAINTAIN, and NO select/insert/update/delete at all. Supabase
// historically granted `arwdDxtm` there and newer stacks tightened it. The
// hosted project predates the change, so it still carries the permissive form —
// which is the only reason the live app could ever read `households`, because
// until 0013 no migration granted that.
//
// What the old permissive stub cost, stated because it is the finding: a suite
// that grants ALL by default cannot see a MISSING grant, so 886 green tests, a
// mutation pass and a full read of every migration all went over three of them
// (`households` select, `members` delete, `chores` delete). Two of the three had
// a migration comment asserting the privilege was held. A harness that builds
// its own environment cannot report that the environment is wrong.
//
// The direction of the disagreement is what matters, not its size. A stub MORE
// permissive than production makes a negative assertion strong (`holds nothing`
// can only pass if a revoke is really there) and a positive one vacuous (`may
// read this` passes whether or not anything granted it). Narrowing it here
// flips that: positive grant assertions became real, and `grants.pglite.test.js`
// is the file that now asserts them. Understating is the safer error of the two
// — it fails loudly at the harness, where overstating fails silently in
// production — which is why the four privileges below are the platform's exact
// set rather than nothing at all.
const SUPABASE_ENV = `
  create schema if not exists auth;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;

  create role anon nologin;
  create role authenticated nologin;
  -- Added for #87. The provisioning Edge Function runs as this role, and 0008
  -- grants it two column privileges - without the role, that migration fails to
  -- apply at all. It is nologin here for the same reason the other two are: this
  -- harness never authenticates, it uses set role.
  create role service_role nologin;

  grant usage on schema public     to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;

  -- The platform's real default, not a convenience. See the docblock above:
  -- these four and no DML. MAINTAIN is Postgres 17+, which PGlite 0.5 (PG 18)
  -- has; if that ever fails to parse, the stub has outrun the engine and the
  -- fix is here rather than in a migration.
  alter default privileges in schema public
    grant truncate, references, trigger, maintain on tables
    to anon, authenticated, service_role;

  -- email is a real column on Supabase's auth.users, and 0007 reads it: the
  -- organizer's address is copied onto their member row from here rather than
  -- passed as a parameter, so the discriminator cannot disagree with the auth
  -- account. Stubbing only id made that read fail with 'column u.email does
  -- not exist' - the stub understating the platform, which is the failure mode
  -- this whole block's docblock warns about.
  --
  -- No backticks in this comment on purpose: SUPABASE_ENV is a JS template
  -- literal, so a backtick here ends the string and the file stops parsing.
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text
  );

  -- Supabase reads the caller from a JWT claim. Here it comes from a session
  -- setting, which is what lets one connection act as several devices.
  create or replace function auth.uid() returns uuid
  language sql stable
  as $stub$
    select nullif(current_setting('test.uid', true), '')::uuid
  $stub$;
`

/**
 * Boot a database with the Supabase stub and every migration applied in order.
 *
 * Applies each migration as a single `exec`, which is how the SQL editor
 * receives it — so a statement that only works when run in isolation fails here
 * too, rather than passing and failing on the paste.
 */
export async function freshDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(SUPABASE_ENV)
  for (const name of MIGRATIONS) {
    await db.exec(migrationSql(name))
  }
  return db
}

/**
 * A database with every migration applied UP TO AND INCLUDING `name`.
 *
 * This is the honest setting for a re-runnability test. `freshDatabase()`
 * applies the whole list, so re-pasting an older file on top of it does not ask
 * "is this file idempotent" — it asks "what happens when a human re-pastes a
 * migration that a later one has already superseded", which is a different
 * question with an unsurprising answer. After 0007 it is not even a quiet one:
 * re-pasting 0005 restores the four-argument `create_household` and the policies
 * that resolve through the dropped `household_devices` table, so the model 0007
 * retires comes back.
 *
 * Re-pasting the migration you are currently applying IS the normal path, and it
 * is what these tests mean. The full-list re-run — every file, in order, twice —
 * is asserted separately in migrations.pglite.test.js and is the other real case.
 */
export async function databaseThrough(name) {
  const index = MIGRATIONS.indexOf(name)
  if (index === -1) {
    throw new Error(`databaseThrough: ${name} is not in MIGRATIONS`)
  }
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(SUPABASE_ENV)
  for (const each of MIGRATIONS.slice(0, index + 1)) {
    await db.exec(migrationSql(each))
  }
  return db
}

/**
 * Register an auth user and return its id.
 *
 * Still called `newDevice` throughout the suite, and after #62 that name is a
 * historical accident: an auth user is a PERSON now. Left alone rather than
 * renamed across five files in the same change that rewrote the model — the
 * rename is mechanical and would bury the behavioural diff.
 *
 * `email` is optional because both kinds of member are real: one with an
 * address, one provisioned with a synthetic `<id>@taskr.invalid` that never
 * reaches an inbox.
 */
export async function newDevice(db, email = null) {
  const { rows } = await db.query('insert into auth.users (email) values ($1) returning id', [email])
  return rows[0].id
}

/**
 * Run `fn` as a specific device, with the privileges a Supabase client has.
 *
 * `set role authenticated` is the load-bearing line: as the owning superuser,
 * Postgres bypasses row-level security and ignores column grants entirely, so
 * every assertion in the suite would pass while proving nothing. The suite has a
 * test that asserts exactly this, because a harness whose safety rail is silent
 * when removed is not a harness.
 */
export async function asDevice(db, uid, fn) {
  await db.exec('set role authenticated')
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

/**
 * Attach an auth user to a member row — what the Edge Function does, and the
 * only way anybody joins a household after 0007.
 *
 * Deliberately NOT run through `asDevice`. `members.claimed_by` is absent from
 * the client update grant precisely so no signed-in caller can write it: a
 * client that could would attach itself to any member row in its household and
 * become that person. So this runs as the owning role, which is what
 * `service_role` is in the real system.
 *
 * This replaces `join_household(code)`. Under device auth, joining a household
 * and claiming a person were two steps, and the gap between them was a real
 * state — a phone in the household acting as nobody. Here they are one act:
 * membership IS a claimed member row, so that intermediate state no longer
 * exists rather than merely being unusual.
 */
export async function provisionMember(db, memberId, authUserId) {
  const { rows } = await db.query(
    'update public.members set claimed_by = $1 where id = $2 returning id, claimed_by',
    [authUserId, memberId],
  )
  if (rows.length !== 1) {
    throw new Error(`provisionMember matched ${rows.length} rows for member ${memberId}`)
  }
  return rows[0]
}

/** Run `fn` and return `{ ok, error }` instead of throwing — the shape assertions want. */
export async function attempt(fn) {
  try {
    return { ok: true, value: await fn(), error: null }
  } catch (error) {
    return { ok: false, value: null, error: String(error.message ?? error) }
  }
}
