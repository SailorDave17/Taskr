// Read the live project's grant catalog — #185, AC 3 and AC 4.
//
//     npm run probe:live-grants
//
// WHAT THIS ANSWERS THAT `check:live` STRUCTURALLY CANNOT
//
// `npm run check:live` asks the project the questions the CLIENT asks: it selects
// columns and calls RPCs as `authenticated`, so it sees a MISSING select grant for
// free and is blind to everything else. #150's finding is the sharp edge of that:
// `0013` grants privileges the live project already held by inheritance, so it is
// a no-op behaviourally, `check:live` reads the same either side of the paste, and
// `docs/access-model.md` called the paste "unobservable by design".
//
// It is not unobservable. It is written permanently into `pg_attribute.attacl`,
// and the reason no instrument here could see it is narrower than it sounded:
// `information_schema` is not exposed over PostgREST, so no CLIENT-side probe can
// reach the catalog. The Management API is not PostgREST. This reaches it.
//
// The general form, which is worth more than this repo: a column-scoped grant of a
// privilege the role already holds is invisible to every behavioural probe and
// permanently visible in the catalog.
//
// WHY THERE IS A NEGATIVE CONTROL, AND WHY IT IS AN ACCEPTANCE CRITERION
//
// AC 3 requires one, in as many words: "a probe that reports grants everywhere
// cannot report an absence". A catalog read is exactly the shape of instrument
// that fails that way — a query with a wrong predicate, a join that multiplies
// rows, a table name that matches nothing, all produce output that LOOKS like
// grants. `chores.repeat_since` is the control: `0012` withholds it deliberately
// (its comment says the trigger is the only author) and no later migration grants
// it, so it must come back with NO column-level grant at all. If it comes back
// with one, this probe is reporting something other than what it claims to.
//
// IS THIS SAFE TO RUN AGAINST PRODUCTION?
//
// Yes, and the reason is worth stating precisely rather than asserted, because
// the Management API will run whatever it is sent — unlike `check:live`'s RPC
// probe, which is safe STRUCTURALLY because PostgREST serves a GET inside a
// read-only transaction and Postgres refuses the write.
//
// There is no such structural guarantee here, so the safety rests on two things
// that are checkable instead. The SQL is built entirely from `LIVE_TABLES` —
// a frozen list in this repo's own source, not an argument — and every identifier
// is validated before it is interpolated. And `assertReadOnly` refuses to send
// any statement carrying a write verb, so the claim this file makes about itself
// is enforced by the file rather than by its comments. This command takes no
// arguments at all, which is the other half of it: there is no input that could
// make it write.

import { pathToFileURL } from 'node:url'

import { LIVE_TABLES } from '../src/lib/liveSchema.js'
import { resolveSupabaseUrl } from './deploy-function.mjs'
import {
  Refusal,
  projectRefFrom,
  readEnvLocal,
  requireAccessToken,
  resolveAccessToken,
  runQuery,
} from './management-api.mjs'

/**
 * What #150 measured on the live project on 2026-08-26, plus the two grants
 * `0014` makes and the one column that must have none — AC 4.
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN DERIVED FROM THE MIGRATIONS. It records a
 * MEASUREMENT, and a measurement is a fact about a day. Deriving the expected
 * grants by parsing `supabase/migrations/` would produce a probe that agrees with
 * the files by construction and could never report the one thing worth reporting
 * — that the project and the files disagree. That is the whole gap `check:live`
 * exists to cover, one catalog over.
 *
 * The cost is stated rather than hidden: a future migration that legitimately
 * changes one of these rows makes this probe red until the row is updated here,
 * with the date and the issue that moved it. That is the same deliberate red
 * `LIVE_SCHEMA` carries for a table whose migration has not been pasted yet — an
 * entry earns its place by what it asks, not by what it currently answers.
 *
 * `privileges` is the privilege string granted to `authenticated`, extracted from
 * the aclitem rather than compared as a whole string, so an unrelated entry for
 * another role cannot make a correct row look wrong. `null` means the column must
 * carry NO column-level ACL at all.
 */
export const MEASURED_GRANTS = Object.freeze([
  // #150, 2026-08-26. `0013` statement 1, and it can only be `0013`'s: `0005` is
  // the only other file touching this table's privileges and it grants
  // `update (name, timezone)`.
  Object.freeze({ table: 'households', column: 'id', privileges: 'r', source: '0013 (#150)' }),
  Object.freeze({
    table: 'households',
    column: 'created_at',
    privileges: 'r',
    source: '0013 (#150)',
  }),
  Object.freeze({
    table: 'households',
    column: 'organizer_member_id',
    privileges: 'r',
    source: '0013 (#150)',
  }),
  // `0014` (#159): the one grant that lets a client name which household it
  // means. `a` is the insert grant that predates it; `r` is `0014`'s.
  Object.freeze({
    table: 'members',
    column: 'household_id',
    privileges: 'ar',
    source: '0014 (#159)',
  }),
  Object.freeze({
    table: 'chores',
    column: 'household_id',
    privileges: 'ar',
    source: '0014 (#159)',
  }),
  // THE NEGATIVE CONTROL — AC 3. `0012` adds this column and grants it to nobody:
  // its own comment says the trigger is the only author. Nothing since grants it,
  // `0015` re-issues the select list in full and leaves it out. If this reports a
  // grant, the probe is not reading what it says it is reading.
  Object.freeze({
    table: 'chores',
    column: 'repeat_since',
    privileges: null,
    source: '0012 — deliberately never granted (NEGATIVE CONTROL)',
  }),
])

/** The role every expectation above is about. */
export const SUBJECT_ROLE = 'authenticated'

/**
 * The tables this probe reads, taken from `src/lib/liveSchema.js`.
 *
 * A function rather than the import used inline below, so that a test can assert
 * THIS is what the command works from. A test that imports `LIVE_TABLES` itself
 * and passes it to the query builders proves the builders work and says nothing
 * about where the command gets its list — the shape where a control constructs
 * the call instead of making it. Mutating the import to a hand-written list has
 * to redden something, and this is the seam that lets it.
 */
export function probeTables() {
  return [...LIVE_TABLES]
}

/**
 * Refuse an identifier that is not a plain lower-case SQL name.
 *
 * `LIVE_TABLES` is this repo's own frozen list, so this can never fire today.
 * It is here because the list is IMPORTED — a later story adds an entry, and the
 * moment an identifier reaches SQL by interpolation the check that it is an
 * identifier has to exist somewhere. Refusing is the only safe branch: quoting it
 * instead would send a name nobody meant.
 */
export function sqlIdentifier(name) {
  const value = String(name ?? '')
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`refusing to interpolate an identifier that is not a plain SQL name: ${value}`)
  }
  return value
}

/** `['a','b']` -> `'a', 'b'`, each validated. */
export function nameList(names) {
  return names.map((name) => `'${sqlIdentifier(name)}'`).join(', ')
}

/**
 * Refuse to send anything that could write.
 *
 * The point is that this file's claim about itself is enforced rather than
 * asserted. Word boundaries matter: `updated_at` must not read as `update`, and
 * measured against the two queries below it does not.
 */
export const WRITE_VERBS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|refresh|call|do)\b/i

export function assertReadOnly(sql) {
  const match = WRITE_VERBS.exec(String(sql ?? ''))
  if (match) {
    throw new Error(
      `refusing to send a statement carrying a write verb (${match[1]}). ` +
        'This command reads the catalog and does nothing else.',
    )
  }
  return sql
}

/** Table-level ACLs for the tables `LIVE_SCHEMA` names. */
export function relaclQuery(tables) {
  return assertReadOnly(
    'select c.relname as table_name,\n' +
      "       coalesce(array_to_string(c.relacl, ','), '') as acl\n" +
      'from pg_class c\n' +
      'join pg_namespace n on n.oid = c.relnamespace\n' +
      `where n.nspname = 'public' and c.relname in (${nameList(tables)})\n` +
      'order by c.relname;',
  )
}

/**
 * Column-level ACLs for every column of those tables.
 *
 * Every column, not only the granted ones, because an ABSENT row and a row with
 * an empty ACL are different answers — the first means the column is gone, and
 * that is a thing worth being told. `attnum > 0` drops the system columns and
 * `not attisdropped` drops the tombstones of columns a migration removed.
 */
export function attaclQuery(tables) {
  return assertReadOnly(
    'select c.relname as table_name,\n' +
      '       a.attname as column_name,\n' +
      "       coalesce(array_to_string(a.attacl, ','), '') as acl\n" +
      'from pg_attribute a\n' +
      'join pg_class c on c.oid = a.attrelid\n' +
      'join pg_namespace n on n.oid = c.relnamespace\n' +
      `where n.nspname = 'public' and c.relname in (${nameList(tables)})\n` +
      '  and a.attnum > 0 and not a.attisdropped\n' +
      'order by c.relname, a.attnum;',
  )
}

/**
 * The whole schema, not the tables the client happens to read — #186 AC 1.
 *
 * WHY THIS IS A SECOND PAIR OF QUERIES RATHER THAN A WIDER `LIVE_TABLES`
 *
 * The two above take a name list, and that list is `LIVE_SCHEMA` — what the
 * CLIENT reads. It is the right subject for the `authenticated` reconcile and the
 * wrong subject for an audit, because the question here is what the catalog holds
 * on the tables nobody thought to look at. #186 exists because three tables were
 * read and `public` has more; a widened hand-written list would repeat that
 * mistake with a longer list.
 *
 * So these take no argument at all. The set comes from `pg_namespace`, which
 * cannot go stale, and a table a future migration adds is in the audit the day it
 * lands rather than the day somebody remembers to add it.
 *
 * `relkind` is SELECTED rather than filtered down to `'r'`. A filter to ordinary
 * tables would be this story's own blind spot in miniature: a partitioned table,
 * a view or a materialized view carries an ACL in exactly the same column, and an
 * audit that silently drops them reports a clean `public` while one sits there
 * granted to `anon`.
 */
export function publicRelaclQuery() {
  return assertReadOnly(
    'select c.relname as table_name,\n' +
      '       c.relkind as kind,\n' +
      "       coalesce(array_to_string(c.relacl, ','), '') as acl\n" +
      'from pg_class c\n' +
      'join pg_namespace n on n.oid = c.relnamespace\n' +
      "where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')\n" +
      'order by c.relname;',
  )
}

/** Column-level ACLs across the same set, for the same reason. */
export function publicAttaclQuery() {
  return assertReadOnly(
    'select c.relname as table_name,\n' +
      '       a.attname as column_name,\n' +
      "       coalesce(array_to_string(a.attacl, ','), '') as acl\n" +
      'from pg_attribute a\n' +
      'join pg_class c on c.oid = a.attrelid\n' +
      'join pg_namespace n on n.oid = c.relnamespace\n' +
      "where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')\n" +
      '  and a.attnum > 0 and not a.attisdropped\n' +
      'order by c.relname, a.attnum;',
  )
}

/**
 * The privileges one role holds, out of an aclitem list.
 *
 * `authenticated=ar/postgres,postgres=arwdDxt/postgres` -> `ar` for
 * `authenticated`. Returns null when the role has no entry, which for a COLUMN
 * ACL means no column-level grant at all — the thing the negative control asserts.
 */
export function privilegesFor(acl, role = SUBJECT_ROLE) {
  const text = String(acl ?? '').trim()
  if (!text) return null
  for (const item of text.replace(/^\{|\}$/g, '').split(',')) {
    const match = /^\s*([^=]*)=([^/]*)\//.exec(item)
    if (match && match[1].trim() === role) return match[2].trim()
  }
  return null
}

/**
 * Compare what the project says against what #150 measured — AC 4.
 *
 * Returns one verdict per expected row. `missing` is kept distinct from a wrong
 * privilege string on purpose: a column that is not there at all means a
 * migration did not run, and a column with the wrong grant means one ran and did
 * something else. Those route to different repairs.
 */
export function reconcile(columnRows, expectations = MEASURED_GRANTS, role = SUBJECT_ROLE) {
  const byKey = new Map(
    columnRows.map((row) => [`${row.table_name}.${row.column_name}`, row.acl ?? '']),
  )

  return expectations.map((entry) => {
    const key = `${entry.table}.${entry.column}`
    if (!byKey.has(key)) {
      return { ...entry, key, agrees: false, actual: undefined, note: 'the column is not there' }
    }
    const actual = privilegesFor(byKey.get(key), role)
    const agrees = actual === entry.privileges
    return { ...entry, key, agrees, actual, note: agrees ? '' : 'differs from what #150 measured' }
  })
}

/**
 * Every function in `public`, so the audit is not one catalog wide — #186.
 *
 * `complete_chore` and `uncomplete_chore` were executable by PUBLIC and by
 * `anon` on the live project, and no `relacl` or `attacl` read could have shown
 * it. A `security definer` function is the one thing RLS does not hold, so this
 * is the catalog where the same defect would actually have mattered.
 */
export function publicProaclQuery() {
  return assertReadOnly(
    'select p.proname as function_name,\n' +
      '       pg_get_function_identity_arguments(p.oid) as args,\n' +
      "       coalesce(array_to_string(p.proacl, ','), '') as acl\n" +
      'from pg_proc p\n' +
      'join pg_namespace n on n.oid = p.pronamespace\n' +
      "where n.nspname = 'public'\n" +
      'order by p.proname;',
  )
}

/**
 * What `authenticated` holds at TABLE level, measured on the live project the
 * hour before `0017` was written — #186 AC 5's control.
 *
 * The control is the whole reason this list exists. `revoke all on
 * public.households from anon` is one word away from `... from authenticated`,
 * and a revoke that hit the wrong role would leave `anon` reading clean — which
 * is the outcome the anon assertion below is looking for. So the paste is only
 * confirmed when BOTH halves hold: anon lost everything, and authenticated lost
 * nothing.
 *
 * All seven tables, not the two `0017` names. A revoke aimed at one table cannot
 * splash onto another, but this list costs nothing to widen and a control that
 * only watches the tables you changed cannot report a surprise.
 *
 * `null` means the role holds no TABLE-level privilege at all — which for
 * `calendar_connections` and `calendar_tokens` is correct and load-bearing: the
 * client is granted nothing on either, and `0011` says so.
 */
export const MEASURED_TABLE_ACLS = Object.freeze([
  Object.freeze({ table: 'calendar_connections', authenticated: null }),
  Object.freeze({ table: 'calendar_tokens', authenticated: null }),
  Object.freeze({ table: 'chore_exclusions', authenticated: 'd' }),
  Object.freeze({ table: 'chores', authenticated: 'dDxtm' }),
  Object.freeze({ table: 'households', authenticated: 'ardDxtm' }),
  Object.freeze({ table: 'member_capacity', authenticated: 'd' }),
  Object.freeze({ table: 'members', authenticated: 'dDxtm' }),
])

/**
 * The one function in `public` that may stay executable by `anon` — #186.
 *
 * `rls_auto_enable()` returns `event_trigger` and appears in no file under
 * `supabase/migrations/`. It is Supabase's, not ours, and a migration that
 * revokes a platform grant is one that fights the platform on its next upgrade.
 *
 * It is an EXEMPTION rather than a filter, and the difference is that an
 * exemption can stop being needed: `anonExecutable` reports an exemption that
 * matched nothing, because an allowlist entry nobody exercises is one that has
 * quietly become a claim about a function that no longer exists.
 */
export const PLATFORM_FUNCTIONS = Object.freeze(['rls_auto_enable'])

/**
 * Which relations still let `anon` in, at table or column level — #186 AC 5.
 *
 * A RULE rather than a list, deliberately. The expected state after `0017` is
 * that no relation in `public` carries an `anon` entry at all, and a rule cannot
 * go stale the way a list of seven table names does the moment an eighth table
 * lands.
 */
export function anonEntries(relRows, columnRows) {
  const tables = relRows
    .filter((row) => privilegesFor(row.acl, 'anon') !== null)
    .map((row) => ({ where: row.table_name, privileges: privilegesFor(row.acl, 'anon') }))
  const columns = columnRows
    .filter((row) => privilegesFor(row.acl, 'anon') !== null)
    .map((row) => ({
      where: `${row.table_name}.${row.column_name}`,
      privileges: privilegesFor(row.acl, 'anon'),
    }))
  return [...tables, ...columns]
}

/**
 * Functions `anon` may execute, and whether every exemption still earns its place.
 *
 * PUBLIC and `anon` are separate `proacl` entries — the platform grants execute
 * to `anon` by name, and `revoke ... from public` does not reach a by-name
 * grant — so both are read. An empty grantee (`=X/postgres`) is PUBLIC, and a
 * PUBLIC grant reaches `anon` exactly as a named one does.
 */
export function anonExecutable(functionRows, exempt = PLATFORM_FUNCTIONS) {
  const reachable = functionRows.filter(
    (row) => privilegesFor(row.acl, 'anon') !== null || privilegesFor(row.acl, '') !== null,
  )
  return {
    unexpected: reachable.filter((row) => !exempt.includes(row.function_name)),
    exempted: reachable.filter((row) => exempt.includes(row.function_name)).map((r) => r.function_name),
    unusedExemptions: exempt.filter(
      (name) => !reachable.some((row) => row.function_name === name),
    ),
  }
}

/** Compare `authenticated`'s table-level privileges against the control — #186 AC 5. */
export function reconcileTableAcls(relRows, expectations = MEASURED_TABLE_ACLS) {
  const byTable = new Map(relRows.map((row) => [row.table_name, row.acl ?? '']))
  return expectations.map((entry) => {
    if (!byTable.has(entry.table)) {
      return { ...entry, agrees: false, actual: undefined, note: 'the table is not there' }
    }
    const actual = privilegesFor(byTable.get(entry.table), SUBJECT_ROLE)
    return {
      ...entry,
      agrees: actual === entry.authenticated,
      actual,
      note: actual === entry.authenticated ? '' : 'the control moved — a revoke hit the wrong role',
    }
  })
}

/** `null` reads as an absence rather than as the word null, which is the whole point of the control. */
function show(privileges) {
  return privileges === null ? 'no column-level grant' : `${SUBJECT_ROLE}=${privileges}`
}

/** The same, for a TABLE-level ACL, where "column-level" would be the wrong noun. */
function showTable(privileges) {
  return privileges === null ? 'no table-level grant' : `${SUBJECT_ROLE}=${privileges}`
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

async function main(env) {
  const refuse = (message) => {
    throw new Refusal(message)
  }

  let ref
  try {
    ref = projectRefFrom(resolveSupabaseUrl(env, readEnvLocal))
  } catch (error) {
    refuse(`Cannot work out which project to read.\n\n${error.message}`)
  }

  const token = requireAccessToken(resolveAccessToken(env, readEnvLocal))

  const tables = probeTables()
  console.log(`\nproject : ${ref}   (derived from VITE_SUPABASE_URL)`)
  console.log(`tables  : ${tables.join(', ')}   (from src/lib/liveSchema.js)`)
  console.log(`role    : ${SUBJECT_ROLE}\n`)

  const relacl = await runQuery({ ref, token, sql: relaclQuery(tables), fetchImpl: fetch })
  if (!relacl.ok) refuse(`Could not read pg_class.relacl.\n\n${relacl.error}`)

  const attacl = await runQuery({ ref, token, sql: attaclQuery(tables), fetchImpl: fetch })
  if (!attacl.ok) refuse(`Could not read pg_attribute.attacl.\n\n${attacl.error}`)

  // A catalog read that comes back empty is an ABSENT answer, not a clean one —
  // and for this probe an empty result is exactly what a wrong schema name or a
  // typo'd table produces. Refuse it rather than printing a tidy empty report.
  if (!relacl.rows.length || !attacl.rows.length) {
    refuse(
      'The catalog returned NOTHING for these tables, which is not the same as ' +
        'their having no grants.\nEither the project is not the one you meant, or the ' +
        'query reached a schema with none of these tables in it.',
    )
  }

  console.log('pg_class.relacl — table-level')
  for (const row of relacl.rows) {
    console.log(`  ${row.table_name.padEnd(22)} ${show(privilegesFor(row.acl))}`)
    console.log(`  ${''.padEnd(22)} full: ${row.acl || '(none)'}`)
  }

  console.log('\npg_attribute.attacl — column-level')
  for (const table of tables) {
    const rows = attacl.rows.filter((row) => row.table_name === table)
    console.log(`  ${table}`)
    for (const row of rows) {
      const held = privilegesFor(row.acl)
      console.log(`    ${row.column_name.padEnd(26)} ${show(held)}`)
    }
  }

  const verdicts = reconcile(attacl.rows)
  const differing = verdicts.filter((verdict) => !verdict.agrees)

  console.log('\nagainst what #150 measured on 2026-08-26 — AC 4')
  for (const verdict of verdicts) {
    const mark = verdict.agrees ? 'ok  ' : 'DIFF'
    console.log(`  ${mark} ${verdict.key.padEnd(34)} expected ${show(verdict.privileges)}`)
    console.log(`       ${''.padEnd(34)} actual   ${show(verdict.actual ?? null)}`)
    // The note is PRINTED, and it was computed and dropped until review found it.
    // `reconcile` distinguishes a column that is not there from one carrying no
    // grant, and `show` renders both as `no column-level grant` — so without this
    // line the two print identically, including on the negative control, where
    // the difference is the whole point: an absent column means a migration did
    // not run, an ungranted one means the control is working.
    if (verdict.note) console.log(`       ${''.padEnd(34)} note     ${verdict.note}`)
    console.log(`       ${''.padEnd(34)} ${verdict.source}`)
  }

  if (differing.length) {
    refuse(
      `${differing.length} of ${verdicts.length} rows DIFFER from the recorded measurement.\n\n` +
        'That is either a migration this repo does not know about, or a row that has\n' +
        'legitimately moved — in which case update MEASURED_GRANTS in\n' +
        'scripts/probe-live-grants.mjs with the date and the issue that moved it.\n' +
        'Do not delete the row: a measurement with no successor reads as one nobody took.',
    )
  }

  // -------------------------------------------------------------------------
  // #186 — the same catalogs, asked about `anon` and about the whole schema
  //
  // Read from `pg_namespace` rather than from `LIVE_SCHEMA`, so a table a future
  // migration adds is audited the day it lands. The `authenticated` reconcile
  // above keeps its narrower subject on purpose: it is about what the CLIENT
  // reads, and this is about what a role HOLDS.
  // -------------------------------------------------------------------------

  const wholeRel = await runQuery({ ref, token, sql: publicRelaclQuery(), fetchImpl: fetch })
  if (!wholeRel.ok) refuse(`Could not read pg_class.relacl for public.\n\n${wholeRel.error}`)

  const wholeAtt = await runQuery({ ref, token, sql: publicAttaclQuery(), fetchImpl: fetch })
  if (!wholeAtt.ok) refuse(`Could not read pg_attribute.attacl for public.\n\n${wholeAtt.error}`)

  const wholeFn = await runQuery({ ref, token, sql: publicProaclQuery(), fetchImpl: fetch })
  if (!wholeFn.ok) refuse(`Could not read pg_proc.proacl for public.\n\n${wholeFn.error}`)

  // Same reasoning as the refusal above: an empty catalog read is an ABSENT
  // answer, and `public` having no relations at all is not a thing that is true.
  if (!wholeRel.rows.length || !wholeAtt.rows.length || !wholeFn.rows.length) {
    refuse(
      'The catalog returned NOTHING for schema `public`, which is not the same as ' +
        'its being empty.\nEither the project is not the one you meant, or the query ' +
        'reached a schema that is not this one.',
    )
  }

  console.log(`\nwhole schema — ${wholeRel.rows.length} relations, ${wholeFn.rows.length} functions`)
  for (const row of wholeRel.rows) {
    console.log(`  ${row.table_name.padEnd(22)} [${row.kind}] ${row.acl || '(none)'}`)
  }

  const strays = anonEntries(wholeRel.rows, wholeAtt.rows)
  const fns = anonExecutable(wholeFn.rows)
  const controls = reconcileTableAcls(wholeRel.rows)
  const controlsMoved = controls.filter((entry) => !entry.agrees)

  console.log('\nanon — #186 AC 5. Expected: nothing, anywhere.')
  if (strays.length) {
    for (const stray of strays) console.log(`  STRAY ${stray.where.padEnd(34)} anon=${stray.privileges}`)
  } else {
    console.log('  none — anon holds no table-level or column-level privilege in public')
  }
  if (fns.unexpected.length) {
    for (const fn of fns.unexpected) {
      console.log(`  STRAY ${`${fn.function_name}(${fn.args})`.padEnd(34)} execute`)
    }
  } else {
    console.log('  none — anon may execute no function in public, PUBLIC grants included')
  }
  for (const name of fns.exempted) console.log(`  exempt ${name} — Supabase platform, not ours`)
  for (const name of fns.unusedExemptions) {
    console.log(`  NOTE  the exemption for ${name} matched nothing and may be stale`)
  }

  console.log('\nthe control — authenticated must be UNCHANGED by a revoke aimed at anon')
  for (const entry of controls) {
    const mark = entry.agrees ? 'ok  ' : 'MOVED'
    console.log(`  ${mark} ${entry.table.padEnd(22)} expected ${showTable(entry.authenticated)}`)
    if (!entry.agrees) {
      console.log(`        ${''.padEnd(22)} actual   ${showTable(entry.actual ?? null)}`)
      console.log(`        ${''.padEnd(22)} note     ${entry.note}`)
    }
  }

  if (strays.length || fns.unexpected.length || controlsMoved.length) {
    refuse(
      `anon reaches ${strays.length + fns.unexpected.length} thing(s) in public, and ` +
        `${controlsMoved.length} control row(s) moved.\n\n` +
        'Before `0017` is pasted this is the EXPECTED reading, and the two strays are\n' +
        '`households` and `members` — that red is the entry doing its job, exactly as\n' +
        '`LIVE_SCHEMA` carries a table whose migration has not been pasted yet.\n\n' +
        'After the paste it is a real finding: either a privilege arrived from\n' +
        'somewhere, or a revoke hit `authenticated` instead of `anon`. A moved CONTROL\n' +
        'row is the second of those and is the more serious — it means the paste took\n' +
        'a privilege the app needs.',
    )
  }


  console.log(
    `\n${verdicts.length} of ${verdicts.length} agree, negative control included — ` +
      'the probe can report an absence. anon reaches nothing in public, and the authenticated control is where it was.\n',
  )
}

if (isMain) {
  try {
    await main(process.env)
  } catch (error) {
    // `process.exitCode`, never `process.exit()` — see `Refusal` in
    // scripts/management-api.mjs. The first query's failure branch is reached after
    // exactly ONE completed fetch, which is the count that aborts inside libuv on
    // Windows/Node 24 and replaces the exit code with one a shell reports as 127.
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}
