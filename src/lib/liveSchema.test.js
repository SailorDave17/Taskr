import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CAPACITY_COLUMNS } from './capacity.js'
import { CHORE_COLUMNS } from './chores.js'
import { MEMBER_COLUMNS } from './household.js'
import {
  LIVE_RPCS,
  LIVE_RPC_NAMES,
  LIVE_SCHEMA,
  LIVE_TABLES,
  RPC_PROBE_VALUE,
  describeRpcError,
  describeSchemaError,
  rpcProbeArgs,
} from './liveSchema.js'

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

/**
 * RPCs the app actually calls, with the argument names it passes — #85.
 *
 * The argument object is captured as well as the name because PostgREST resolves
 * an overload by its set of argument names, so `create_household` alone is not
 * enough to say what the client asks for.
 *
 * `[^}]*` is safe only while no call site passes a nested object, so the
 * `noNesting` set below records where that assumption would break and a test
 * asserts it holds rather than leaving it to the next person to notice.
 */
const calledRpcs = new Map()
const nestedArgCalls = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const [, fn, argBlock = ''] of source.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*(?:,\s*\{([^}]*)\})?/g)) {
    if (/\{/.test(argBlock)) nestedArgCalls.push(fn)
    calledRpcs.set(fn, [...argBlock.matchAll(/([a-z_]+)\s*:/g)].map(([, name]) => name).sort())
  }
}

const sorted = (names) => [...names].sort()

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

describe('#85 — the RPC list cannot fall behind the code either', () => {
  it('finds RPC calls to check, so an empty pass is impossible', () => {
    // The same guard, and the same reason, as the table half above: the moment
    // this regex stops matching, every assertion below passes on an empty set.
    // Five since #62 and `0007` retired the PIN and join-code path — #85 was
    // filed naming nine, and four of them are dropped rather than unchecked.
    expect(calledRpcs.size).toBeGreaterThanOrEqual(5)
    expect([...calledRpcs.keys()]).toContain('assign_chore')
  })

  it('reads argument names, not just function names', () => {
    // PostgREST resolves an overload by argument NAMES, so a list that captured
    // only the function name would pass against a project carrying a different
    // signature - which is the exact live state until `0007` is pasted.
    expect(calledRpcs.get('assign_chore')).toEqual(['chore_id', 'member_id'])
    expect(calledRpcs.get('create_household')).toEqual([
      'household_name',
      'household_timezone',
      'organizer_name',
    ])
  })

  it('has no call site the argument scan would misread', () => {
    // The scan stops at the first `}`, so a nested object in an argument list
    // would silently truncate the argument names and the check would start
    // asking for a signature nobody calls. Asserted rather than assumed.
    expect(nestedArgCalls).toEqual([])
  })

  it('has an entry for every RPC the app calls, with the same arguments', () => {
    const wrong = []
    for (const [fn, args] of calledRpcs) {
      const entry = LIVE_RPCS.find((e) => e.fn === fn)
      if (!entry) wrong.push(`${fn}: called but absent from LIVE_RPCS`)
      else if (sorted(entry.args).join() !== args.join())
        wrong.push(`${fn}: called with (${args.join(', ')}), listed as (${entry.args.join(', ')})`)
    }
    expect(
      wrong,
      `the live check would pass while the app fails against these: ${wrong.join('; ')}`,
    ).toEqual([])
  })

  it('has no entry for an RPC the app does not call', () => {
    const extra = LIVE_RPC_NAMES.filter((fn) => !calledRpcs.has(fn)).sort()
    expect(extra, `in LIVE_RPCS but called nowhere in src/: ${extra.join(', ')}`).toEqual([])
  })

  it('covers the five the app still calls, and none of the four `0007` drops', () => {
    for (const fn of [
      'create_household',
      'complete_chore',
      'uncomplete_chore',
      'assign_chore',
      'unassign_chore',
    ]) {
      expect(LIVE_RPC_NAMES).toContain(fn)
    }
    // The half worth stating. `0007` drops these, so probing for them would make
    // the check RED against a fully migrated project — a check that fails on a
    // healthy project is the same defect as one that passes on a broken one, and
    // this repo has already shipped it once (`household_devices` in LIVE_SCHEMA).
    for (const fn of ['claim_member', 'claim_member_with_pin', 'set_member_pin', 'join_household']) {
      expect(LIVE_RPC_NAMES).not.toContain(fn)
    }
  })

  it('probes every argument the function takes, with a value that matches no row', () => {
    expect(rpcProbeArgs(['chore_id', 'member_id'])).toEqual({
      chore_id: RPC_PROBE_VALUE,
      member_id: RPC_PROBE_VALUE,
    })
    // A nil UUID rather than an empty string: it coerces to `uuid` AND to `text`,
    // so one placeholder covers both argument types this app passes, and it is
    // the value guaranteed to name nothing.
    expect(RPC_PROBE_VALUE).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/)
  })
})

describe('#85 — a probe failure names the function and what was asked of it', () => {
  const args = ['chore_id', 'member_id']

  it('reports a function PostgREST could not resolve', () => {
    const line = describeRpcError('assign_chore', args, {
      code: 'PGRST202',
      message: 'Could not find the function public.assign_chore(chore_id, member_id)',
    })
    expect(line).toContain('assign_chore')
    expect(line).toContain('PGRST202')
    expect(line).toContain('never ran, or its signature changed')
    expect(line).toContain('asked for: assign_chore(chore_id, member_id)')
  })

  it('reports an ambiguous overload, which is what a changed signature leaves behind', () => {
    // `create or replace` with a different signature ADDS a function rather than
    // replacing it, and the resulting error blames the caller. Named here so the
    // check says which migration to look at instead.
    const line = describeRpcError('create_household', ['household_name'], {
      code: 'PGRST203',
      message: 'Could not choose the best candidate function',
    })
    expect(line).toContain('more than one function matches')
    expect(line).toContain('overload')
  })

  it('reports a missing execute grant rather than treating it as success', () => {
    const line = describeRpcError('complete_chore', ['chore_id'], {
      code: '42501',
      message: 'permission denied for function complete_chore',
    })
    expect(line).toContain('may not execute it')
  })

  it('treats a write refused by the read-only transaction as PRESENT', () => {
    // The one that decides whether this check works at all. `25006` is Postgres
    // stopping the function's own write, which can only happen if the function
    // resolved and ran — so it is the strongest possible evidence of presence,
    // and it must not read as a failure.
    expect(
      describeRpcError('complete_chore', ['chore_id'], {
        code: '25006',
        message: 'cannot execute SELECT FOR UPDATE in a read-only transaction',
      }),
    ).toBeNull()
  })

  it('treats the function raising its own error as PRESENT', () => {
    // A probe argument matches no row, so a function that checks its inputs first
    // answers with its own `raise` instead of `25006`. Both mean present.
    expect(
      describeRpcError('unassign_chore', ['chore_id'], {
        code: 'P0001',
        message: 'no such chore, or not your household',
      }),
    ).toBeNull()
    expect(
      describeRpcError('complete_chore', ['chore_id'], {
        code: '22P02',
        message: 'invalid input syntax for type uuid',
      }),
    ).toBeNull()
  })

  it('refuses to call presence proven when the probe never reached Postgres', () => {
    // A network failure has no SQLSTATE. Passing it would make an ABSENT result
    // read as a clean one, which is the failure mode this whole file exists for.
    const line = describeRpcError('assign_chore', args, { message: 'fetch failed' })
    expect(line).toContain('UNPROVEN')
    expect(line).toContain('assign_chore')
    const unknown = describeRpcError('assign_chore', args, {
      code: 'PGRST301',
      message: 'JWT expired',
    })
    expect(unknown).toContain('UNPROVEN')
  })

  it('returns null when there is no error, so a caller cannot report a phantom', () => {
    expect(describeRpcError('complete_chore', ['chore_id'], null)).toBeNull()
    expect(describeRpcError('complete_chore', ['chore_id'], undefined)).toBeNull()
  })
})
