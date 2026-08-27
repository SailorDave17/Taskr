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

/** `null` reads as an absence rather than as the word null, which is the whole point of the control. */
function show(privileges) {
  return privileges === null ? 'no column-level grant' : `${SUBJECT_ROLE}=${privileges}`
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

  console.log(
    `\n${verdicts.length} of ${verdicts.length} agree, negative control included — ` +
      'the probe can report an absence.\n',
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
