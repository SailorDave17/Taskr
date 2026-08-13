import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CAPACITY_COLUMNS } from './capacity.js'
import { CHORE_COLUMNS } from './chores.js'
import { MEMBER_COLUMNS } from './household.js'
import { LIVE_SCHEMA, LIVE_TABLES, describeSchemaError } from './liveSchema.js'

// #78 — the half of the live-schema check that runs in CI.
//
// The check itself needs credentials and a network and therefore cannot run in
// the gate (see src/test/schema.integration.test.js). What CAN run without
// either is the question of whether the list it works from still matches the
// code: a check that reads five tables while the app reads six is a check that
// passes while the app is broken, which is the same shape as the outage #78
// comes from.
//
// So this file guards the LIST, over the wire guards the PROJECT, and neither
// substitutes for the other.

/** Every non-test source file under src/, so a new caller cannot hide. */
function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out)
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\.|\/test\//.test(path.replace(/\\/g, '/'))) {
      out.push(path)
    }
  }
  return out
}

const files = sourceFiles(resolve(process.cwd(), 'src')).filter(
  (p) => !p.replace(/\\/g, '/').includes('/src/test/'),
)

/** Table names the app actually asks PostgREST for, read out of the source. */
const readTables = new Set()
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const [, table] of source.matchAll(/\.from\('([a-z_]+)'\)/g)) readTables.add(table)
}

describe('#78 — the live-schema list cannot fall behind the code', () => {
  it('finds tables to check, so an empty pass is impossible', () => {
    // Without this the whole describe passes vacuously the moment the regex
    // stops matching - a switch to a query builder, or a renamed helper. Same
    // guard, and the same reason, as gate.test.js's class-name scan.
    expect(files.length).toBeGreaterThan(5)
    // Four since #62 dropped `household_devices`. The number is a floor against
    // a vacuous pass, not a target — it goes DOWN when a table legitimately
    // leaves, and that edit should be visible in review rather than automatic.
    expect(readTables.size).toBeGreaterThanOrEqual(4)
    expect(readTables).toContain('chores')
  })

  it('has an entry for every table the app reads', () => {
    const missing = [...readTables].filter((t) => !LIVE_TABLES.includes(t)).sort()
    expect(
      missing,
      `these tables are read by the app but are not in LIVE_SCHEMA, so the live check would ` +
        `pass while the app fails against them: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('has no entry for a table the app does not read', () => {
    // Extra entries are drift too: they make the live check fail on a table
    // nobody depends on, and a check that cries wolf gets run with --no-verify.
    const extra = LIVE_TABLES.filter((t) => !readTables.has(t)).sort()
    expect(extra, `in LIVE_SCHEMA but read nowhere in src/: ${extra.join(', ')}`).toEqual([])
  })

  it('covers the four tables the app still reads', () => {
    // #78 named five. `household_devices` was the fifth and #62 drops it, so
    // this list lost an entry rather than gaining one — worth stating, because
    // a shrinking required-set is exactly the edit that would otherwise look
    // like someone quietly weakening the check.
    for (const table of ['households', 'members', 'chores', 'member_capacity']) {
      expect(LIVE_TABLES).toContain(table)
    }
    expect(LIVE_TABLES).not.toContain('household_devices')
  })

  it('takes its column lists from the data layer rather than restating them', () => {
    // The point of AC 3: these are the SAME strings the queries use, so adding a
    // column to a select cannot leave the check behind. Asserting identity here
    // is what makes that claim checkable rather than a comment.
    const byTable = Object.fromEntries(LIVE_SCHEMA.map((e) => [e.table, e.columns]))
    expect(byTable.chores).toBe(CHORE_COLUMNS)
    expect(byTable.member_capacity).toBe(CAPACITY_COLUMNS)
    expect(byTable.members).toBe(MEMBER_COLUMNS)
  })

  it('asks for the columns the data layer actually selects', () => {
    // A stronger form of the above: the constants must still be the ones passed
    // to .select(). If someone inlines a column list at a call site, this fails.
    const chores = readFileSync(resolve(process.cwd(), 'src/lib/chores.js'), 'utf8')
    const capacity = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    const household = readFileSync(resolve(process.cwd(), 'src/lib/household.js'), 'utf8')
    expect(chores).toContain('.select(CHORE_COLUMNS)')
    expect(capacity).toContain('.select(CAPACITY_COLUMNS)')
    expect(household).toContain('.select(MEMBER_COLUMNS)')
  })
})

describe('#78 — a failure names the object that is missing', () => {
  it('names the table, the code and the columns it asked for', () => {
    const line = describeSchemaError('chores', 'id, title', {
      code: '42P01',
      message: 'relation "public.chores" does not exist',
    })
    expect(line).toContain('chores')
    expect(line).toContain('42P01')
    expect(line).toContain('does not exist in the live project')
    expect(line).toContain('id, title')
  })

  it('understands PostgREST answering a missing table from its schema cache', () => {
    // MEASURED against the live project 2026-08-10: an unknown table returns
    // `PGRST205`, not Postgres's `42P01`, because PostgREST resolves it from its
    // own schema cache before the query is issued. The first version of this
    // mapping knew only `42P01` and would have reported a missing table as an
    // "unexpected error" - correct that it failed, useless about why.
    const line = describeSchemaError('nope', '*', {
      code: 'PGRST205',
      message: "Could not find the table 'public.nope' in the schema cache",
    })
    expect(line).toContain('table does not exist in the live project')
    expect(line).toContain('PGRST205')
  })

  it('distinguishes a missing column from a missing table', () => {
    const line = describeSchemaError('chores', 'id, assigned_member_id', {
      code: '42703',
      message: 'column chores.assigned_member_id does not exist',
    })
    expect(line).toContain('a column this app selects does not exist')
    expect(line).not.toContain('table does not exist')
  })

  it('reports a grant failure rather than treating it as success', () => {
    const line = describeSchemaError('members', 'id, email', {
      code: '42501',
      message: 'permission denied for table members',
    })
    expect(line).toContain('may not read it')
  })

  it('says something useful for a code it has never seen', () => {
    const line = describeSchemaError('chores', 'id', { code: '08006', message: 'connection failure' })
    expect(line).toContain('unexpected error')
    expect(line).toContain('08006')
  })

  it('returns null when there is no error, so a caller cannot report a phantom', () => {
    expect(describeSchemaError('chores', 'id', null)).toBeNull()
    expect(describeSchemaError('chores', 'id', undefined)).toBeNull()
  })
})
