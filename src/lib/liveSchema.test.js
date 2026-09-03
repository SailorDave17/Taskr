import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CALENDAR_CONNECTION_COLUMNS } from './calendar.js'
import { CAPACITY_COLUMNS } from './capacity.js'
import { CHORE_COLUMNS } from './chores.js'
import { EXCLUSION_COLUMNS } from './exclusions.js'
import { MEMBER_COLUMNS } from './household.js'
import {
  LIVE_EDGE_FUNCTIONS,
  PREFLIGHT_HEADERS,
  describeEdgeFunctionError,
  probeEdgeFunction,
} from './liveSchema.js'
import {
  LIVE_RPCS,
  LIVE_RPC_NAMES,
  LIVE_SCHEMA,
  LIVE_TABLES,
  RPC_PROBE_VALUE,
  describeRpcError,
  describeSchemaError,
  describeSignInError,
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
    // SIX since #95 added `calendar_connections` — five after #37's
    // `chore_exclusions`, four after #62 dropped `household_devices`. The number
    // is a floor against a vacuous pass, not a target: it goes DOWN when a table
    // legitimately leaves and UP when one arrives, and either edit should be
    // visible in review rather than automatic.
    expect(readTables.size).toBeGreaterThanOrEqual(6)
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

  it('covers the six tables the app still reads', () => {
    // #78 named five, of which `household_devices` was one and #62 drops it. The
    // set went to four, back to five with #37's `chore_exclusions` — a different
    // fifth — and to six with #95's `calendar_connections`. Every edit is
    // stated, because a required-set that changes size silently is exactly how
    // somebody quietly weakens a check.
    for (const table of [
      'households',
      'members',
      'chores',
      'member_capacity',
      'chore_exclusions',
      'calendar_connections',
    ]) {
      expect(LIVE_TABLES).toContain(table)
    }
    expect(LIVE_TABLES).not.toContain('household_devices')

    // `0011` creates TWO tables and only one is here. The other holds the
    // refresh token and the client is granted nothing on it, so probing it would
    // report a missing grant on a perfectly healthy project — the
    // `household_devices` mistake with the sign flipped. Asserted rather than
    // left as an omission, because an absent entry and a forgotten one look
    // identical.
    expect(LIVE_TABLES).not.toContain('calendar_tokens')
  })

  it('takes its column lists from the data layer rather than restating them', () => {
    // The point of AC 3: these are the SAME strings the queries use, so adding a
    // column to a select cannot leave the check behind. Asserting identity here
    // is what makes that claim checkable rather than a comment.
    const byTable = Object.fromEntries(LIVE_SCHEMA.map((e) => [e.table, e.columns]))
    expect(byTable.chores).toBe(CHORE_COLUMNS)
    expect(byTable.member_capacity).toBe(CAPACITY_COLUMNS)
    expect(byTable.members).toBe(MEMBER_COLUMNS)
    expect(byTable.chore_exclusions).toBe(EXCLUSION_COLUMNS)
    expect(byTable.calendar_connections).toBe(CALENDAR_CONNECTION_COLUMNS)
  })

  it('asks for the columns the data layer actually selects', () => {
    // A stronger form of the above: the constants must still be the ones passed
    // to .select(). If someone inlines a column list at a call site, this fails.
    const chores = readFileSync(resolve(process.cwd(), 'src/lib/chores.js'), 'utf8')
    const capacity = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    const household = readFileSync(resolve(process.cwd(), 'src/lib/household.js'), 'utf8')
    const exclusions = readFileSync(resolve(process.cwd(), 'src/lib/exclusions.js'), 'utf8')
    const calendar = readFileSync(resolve(process.cwd(), 'src/lib/calendar.js'), 'utf8')
    expect(chores).toContain('.select(CHORE_COLUMNS)')
    expect(capacity).toContain('.select(CAPACITY_COLUMNS)')
    expect(household).toContain('.select(MEMBER_COLUMNS)')
    expect(exclusions).toContain('.select(EXCLUSION_COLUMNS)')
    expect(calendar).toContain('.select(CALENDAR_CONNECTION_COLUMNS)')
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
    // signature - which was the exact live state until `0007` was pasted on
    // 2026-08-20 (#108).
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

  it('covers the eight the app still calls, and none of the four `0007` drops', () => {
    for (const fn of [
      'create_household',
      'complete_chore',
      'uncomplete_chore',
      // #305 — the third state's writer and its undo, arriving with `0027`.
      'miss_chore',
      'unmiss_chore',
      'assign_chore',
      'unassign_chore',
      'catch_up_repeats',
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
    // And #37's two, for the SAME reason arriving from the opposite direction:
    // `0010` creates them and deliberately withholds execute from
    // `authenticated`, so a probe would report a missing grant on a project that
    // is entirely correct. They are covered by the `chore_exclusions` entry in
    // LIVE_SCHEMA — one paste creates all three.
    for (const fn of ['is_member_eligible', 'eligible_members']) {
      expect(LIVE_RPC_NAMES).not.toContain(fn)
    }
    // And #53's three internals, same reason again: `catch_up_repeats_at`,
    // `repeat_occurrence_dates` and `set_repeat_since` are granted to no
    // client role on purpose, so a probe would report a missing grant on a
    // correct project. The `catch_up_repeats` entry covers their paste — all
    // four arrive in `0012`.
    for (const fn of ['catch_up_repeats_at', 'repeat_occurrence_dates', 'set_repeat_since']) {
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

describe('#115 - the Edge Function list cannot fall behind the code', () => {
  // The call site passes a CONST, not a literal, so the naive scan for
  // `invoke('name')` finds NOTHING and reports an empty set - which would pass
  // every assertion below vacuously. Resolving the const is the whole reason
  // this scan is more than one regex, and `unresolved` is asserted empty so it
  // cannot quietly go back to finding nothing.
  const invoked = new Set()
  const unresolved = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const consts = new Map(
      [...source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)].map(
        ([, name, value]) => [name, value],
      ),
    )
    for (const [, arg] of source.matchAll(/\.functions\.invoke\(\s*([^,)\s]+)/g)) {
      const literal = arg.match(/^'([^']+)'$/)
      if (literal) invoked.add(literal[1])
      else if (consts.has(arg)) invoked.add(consts.get(arg))
      else unresolved.push(`${file}: ${arg}`)
    }
  }

  it('finds an invocation to check, so an empty pass is impossible', () => {
    expect(invoked.size).toBeGreaterThan(0)
    expect(LIVE_EDGE_FUNCTIONS.length).toBeGreaterThan(0)
  })

  it('resolved every invoke argument, so the scan is not silently under-reporting', () => {
    expect(unresolved, `could not resolve: ${unresolved.join(', ')}`).toEqual([])
  })

  it('lists exactly the functions the app invokes, in both directions', () => {
    // Both directions, for LIVE_RPCS' reason: a function added here but never
    // called makes check:live permanently red against a healthy project, and one
    // called but never listed is the hole #112 fell through.
    expect(sorted(LIVE_EDGE_FUNCTIONS)).toEqual(sorted(invoked))
  })
})

describe('#115 - the preflight header set comes from the SDK, not from us', () => {
  it('carries the two headers no call site mentions', () => {
    // The entire point. `apikey` and `x-client-info` are attached by the
    // client's fetch wrapper, appear nowhere in this repo's calling code, and
    // are exactly what #112's hand-written allow-list omitted. If these ever
    // stop being present, this check has quietly become the defect it catches.
    expect(PREFLIGHT_HEADERS).toContain('apikey')
    expect(PREFLIGHT_HEADERS).toContain('x-client-info')
    expect(PREFLIGHT_HEADERS).toContain('authorization')
    expect(PREFLIGHT_HEADERS).toContain('content-type')
  })
})

describe('#115 - a preflight is classified into the three states that have different repairs', () => {
  const healthy = { status: 200, allowHeaders: PREFLIGHT_HEADERS.join(', ') }

  it('POSITIVE CONTROL: a healthy preflight is not reported as a problem', () => {
    // Without this, every assertion below is satisfied by a classifier that
    // simply always complains.
    expect(describeEdgeFunctionError('provision-member', healthy)).toBeNull()
  })

  it('calls a 404 NOT DEPLOYED, and names the command that fixes it', () => {
    // Measured against the live project 2026-08-20: the gateway answers 404 for
    // an absent function AND returns three of the four headers while doing it,
    // so the header half alone would read healthy here. The status is what
    // separates them.
    const line = describeEdgeFunctionError('provision-member', {
      status: 404,
      allowHeaders: 'authorization, x-client-info, apikey',
    })
    expect(line).toContain('NOT DEPLOYED')
    expect(line).toContain('provision-member')
    expect(line).toContain('supabase functions deploy')
  })

  it('calls a narrow allow-list DEPLOYED and uncallable, naming the missing headers', () => {
    // #112's latent half, and the one no test outside a browser can reach: Node
    // preflights nothing, so the function answers every Node caller happily.
    const line = describeEdgeFunctionError('provision-member', {
      status: 200,
      allowHeaders: 'authorization, content-type',
    })
    expect(line).toContain('DEPLOYED')
    expect(line).not.toContain('NOT DEPLOYED')
    expect(line).toContain('apikey')
    expect(line).toContain('x-client-info')
  })

  it('refuses to call presence proven when the preflight never completed', () => {
    // Same rule as describeRpcError: an absent answer must never read as a clean
    // one. A network failure says nothing about whether the function is there.
    for (const probe of [
      { status: null, allowHeaders: '', error: new Error('fetch failed') },
      undefined,
    ]) {
      expect(describeEdgeFunctionError('provision-member', probe)).toContain('UNPROVEN')
    }
  })

  it('reports an unexpected status as UNPROVEN rather than guessing', () => {
    const line = describeEdgeFunctionError('provision-member', { status: 500, allowHeaders: '' })
    expect(line).toContain('UNPROVEN')
    expect(line).not.toContain('NOT DEPLOYED')
  })
})

describe('#115 - the probe is a preflight, which is what makes it safe against production', () => {
  it('sends OPTIONS and never a body, so it cannot invoke anything', async () => {
    // THE CONTROL FOR SAFETY, and it goes through the real function rather than
    // rebuilding the request - the same argument as the read-only-transaction
    // control in schema.integration.test.js. A test that built its own OPTIONS
    // request would stay green while probeEdgeFunction started POSTing.
    let seen = null
    const fake = (url, init) => {
      seen = { url, init }
      return Promise.resolve({ status: 200, headers: { get: () => 'authorization' } })
    }
    await probeEdgeFunction('https://example.test', 'provision-member', fake)

    expect(seen.init.method).toBe('OPTIONS')
    expect(seen.init.body, 'a preflight carries no body - this would be an invocation').toBeUndefined()
    expect(seen.url).toBe('https://example.test/functions/v1/provision-member')
    expect(seen.init.headers['Access-Control-Request-Headers']).toContain('apikey')
  })

  it('strips a trailing slash rather than building a double-slash URL', async () => {
    let seen = null
    const fake = (url) => {
      seen = url
      return Promise.resolve({ status: 200, headers: { get: () => '' } })
    }
    await probeEdgeFunction('https://example.test/', 'provision-member', fake)
    expect(seen).toBe('https://example.test/functions/v1/provision-member')
  })

  it('turns a thrown fetch into an UNPROVEN result instead of propagating', async () => {
    const probe = await probeEdgeFunction('https://example.test', 'x', () => {
      throw new Error('ECONNREFUSED')
    })
    expect(probe.status).toBeNull()
    expect(describeEdgeFunctionError('x', probe)).toContain('UNPROVEN')
  })
})

describe('#250 — a dead seeded account is classified into the two states with different fixes', () => {
  // This is the CI-runnable half of #250. `check:live` is not run by CI and
  // cannot be — it needs credentials and a live project — so the classifier it
  // calls lives here, where the gate does exercise it. Same split as every other
  // list and message in this module: the live file asks the question, this file
  // proves the answer is legible.

  const EMAIL = 'suite@throwaway.example'

  it('says the account is HELD FOR CONFIRMATION, and that .env.local is fine', () => {
    // The half that is easy to misread as a wrong password, and it is the one
    // where changing TASKR_TEST_PASSWORD does nothing: the account exists, the
    // password matched, and it was created without ticking "Auto Confirm User".
    const line = describeSignInError(EMAIL, {
      code: 'email_not_confirmed',
      message: 'Email not confirmed',
    })
    expect(line).toContain(EMAIL)
    expect(line).toContain('email_not_confirmed')
    expect(line).toContain('the password is RIGHT')
    expect(line, 'this is the state where editing .env.local is wasted effort').toContain(
      'Nothing is wrong with .env.local',
    )
    expect(line).toContain('Auto Confirm User')
  })

  it('says the account is ABSENT OR THE PASSWORD IS WRONG, and does not guess between them', () => {
    // MEASURED 2026-08-28 against the live project by pointing
    // TASKR_TEST_PASSWORD at a wrong value: GoTrue answers `invalid_credentials`
    // / "Invalid login credentials". It answers the same way for an account that
    // does not exist, deliberately, so the message must not claim to know which
    // — and this is the state the 2026-08-25 deletion presented as.
    const line = describeSignInError(EMAIL, {
      code: 'invalid_credentials',
      message: 'Invalid login credentials',
    })
    expect(line).toContain(EMAIL)
    expect(line).toContain('invalid_credentials')
    expect(line).toContain('ABSENT')
    expect(line, 'GoTrue does not say which, so neither may we').toContain(
      'the same way for both on purpose',
    )
  })

  it('gives the two states DIFFERENT lines, which is the only reason to classify at all', () => {
    // The control on the pair. Both branches producing a plausible line is not
    // enough — a classifier that returned one message for both would pass every
    // assertion above that names the account, because both contain the address.
    const confirm = describeSignInError(EMAIL, { code: 'email_not_confirmed', message: 'x' })
    const invalid = describeSignInError(EMAIL, { code: 'invalid_credentials', message: 'x' })
    expect(confirm).not.toBe(invalid)
    expect(confirm, 'the confirmation state must not send anyone to the password').not.toContain(
      'TASKR_TEST_PASSWORD does not match',
    )
  })

  it('carries the recreation step, because that is what the reader has to do next', () => {
    for (const code of ['email_not_confirmed', 'invalid_credentials', 'over_request_rate_limit']) {
      const line = describeSignInError(EMAIL, { code, message: 'x' })
      expect(line, `${code} does not say how to recreate the account`).toContain(
        'Authentication -> Users -> Add user -> Create new user',
      )
    }
  })

  it('reports an unrecognised failure as UNPROVEN rather than classifying it', () => {
    // Same rule as `describeRpcError`: an absent answer must not read as a clean
    // one, and a network failure here says nothing about the account. A rate
    // limit is the realistic case — it is neither "gone" nor "wrong password".
    const line = describeSignInError(EMAIL, {
      code: 'over_request_rate_limit',
      message: 'Request rate limit reached',
    })
    expect(line).toContain('UNPROVEN')
    expect(line).toContain('over_request_rate_limit')
  })

  it('refuses a sign-in that returned no error AND no session', () => {
    // The state that would otherwise be the worst outcome available: every probe
    // in `schema.integration.test.js` runs as `anon`, `0002` and `0003` revoke
    // that role wholesale, and a healthy project is reported broken.
    const line = describeSignInError(EMAIL, null, null)
    expect(line).toContain('NO ERROR AND NO SESSION')
    expect(line).toContain('report a healthy project as broken')
  })

  it('returns null only when there is a session, so a green row means a real one', () => {
    expect(describeSignInError(EMAIL, null, { access_token: 'x' })).toBeNull()
  })

  it('never prints a password, because it is never handed one', () => {
    // The signature is the guard here rather than a filter: this function takes
    // (email, error, session) and has no parameter a password could arrive in.
    // Asserted because "names the account" and "prints the credential" are one
    // careless template literal apart.
    expect(describeSignInError.length, 'a fourth parameter would be the place a password lands').toBe(
      3,
    )
  })
})
