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
// The default privileges matter more than they look. Supabase grants ALL on
// every table in `public` to `anon` and `authenticated`, which is precisely why
// row-level security alone was not enough in 0001 and why 0002 has to revoke
// and re-grant per column. Stubbing this wrongly — by granting nothing — would
// make 0002's central fix untestable and, worse, make it look unnecessary.
const SUPABASE_ENV = `
  create schema if not exists auth;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;

  create role anon nologin;
  create role authenticated nologin;

  grant usage on schema public     to anon, authenticated;
  grant usage on schema extensions to anon, authenticated;

  alter default privileges in schema public grant all on tables to anon, authenticated;

  create table auth.users (
    id uuid primary key default gen_random_uuid()
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

/** Register a device (an anonymous auth user) and return its id. */
export async function newDevice(db) {
  const { rows } = await db.query('insert into auth.users default values returning id')
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

/** Run `fn` and return `{ ok, error }` instead of throwing — the shape assertions want. */
export async function attempt(fn) {
  try {
    return { ok: true, value: await fn(), error: null }
  } catch (error) {
    return { ok: false, value: null, error: String(error.message ?? error) }
  }
}
