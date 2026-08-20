// #78 — does the LIVE project actually have what the client asks it for?
//
// The gap this closes, in one line: a required deploy step is performed by a
// human, recorded only in prose, and compared against nothing. On 2026-08-09
// `0003` and `0004` had never been pasted into the live project though #34 and
// #35 had merged and deployed client code that reads those tables. For a day the
// app could not hold a household at all, and nothing noticed until an unrelated
// paste failed.
//
// Why no existing suite could have caught it, and why this file is separate:
//
//   - `npm test` builds its own Postgres. `src/test/support/pgliteSupabase.js`
//     applies every file in `supabase/migrations/` FROM DISK, so a green run is
//     positive evidence about the one environment where the schema cannot be
//     wrong. It can never diverge from the files; the live project always can.
//   - `npm run test:rls` is the only thing that goes over the wire, and as of
//     2026-08-09 it contained zero references to `chores`. It would have passed
//     green throughout the outage.
//
// WHERE THIS RUNS (#78 AC 4). Not in CI, and that is deliberate rather than an
// omission: CI has no Supabase credentials, and a check that skips itself when
// unconfigured passes vacuously — the precise defect `test:rls`'s own CI
// exclusion exists to avoid, and re-introducing it here would be worse than not
// writing the check, because the gate would then report a green it never earned.
// So it is loud, never skipped: run `npm run check:live` before or after pasting
// a migration, and treat its output as the authority on live state.
//
// The half that DOES run in CI is `src/lib/liveSchema.test.js`, which checks the
// table list against the source. This file checks the list against the project.
//
// #85 EXTENDS IT TO FUNCTIONS. #78 covered tables and columns and said so as a
// stated limit: `0006` adds two RPCs as well as a column, and a migration that
// added ONLY a function would pass the table check completely while every
// assignment in the app failed. The RPC half is at the foot of this file, and
// it probes with a GET rather than the POST `.rpc()` normally issues — which is
// what makes calling a function that writes safe to do against production.

import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import { isSecretKey } from '../lib/keyShape.js'
import {
  LIVE_RPCS,
  LIVE_SCHEMA,
  describeRpcError,
  describeSchemaError,
  rpcProbeArgs,
} from '../lib/liveSchema.js'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

// Loud, not skipped. If this file runs at all it must either answer the question
// or fail saying why it could not.
if (!url || !anonKey) {
  throw new Error(
    'schema.integration.test.js needs the live Supabase project.\n' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (gitignored) ' +
      'and run `npm run check:live`.\n' +
      'It is excluded from `npm test` on purpose: CI has no credentials, and a check ' +
      'that quietly passes when unconfigured is the failure it exists to prevent.',
  )
}

// A secret key would answer a different question. It carries broad grants, so a
// column this app cannot read as `anon` may read fine as the service role — the
// check would go green while the app stayed broken. Same reasoning as the RLS
// suite's refusal, one layer over: there a secret key hides a policy, here it
// hides a grant.
if (isSecretKey(anonKey)) {
  throw new Error(
    'This is a SECRET key. It carries grants the app does not have, so this check ' +
      'would pass on columns the published client cannot read. Use the publishable ' +
      '(anon) key — the same one the browser gets.',
  )
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Sign in the way the app does, and for the reason the app's grants force.
//
// MEASURED 2026-08-10, and it is the finding that shaped this file: probing with
// the publishable key alone runs as role `anon`, which `0002` and `0003` revoke
// WHOLESALE — so `members`, `chores` and `member_capacity` all came back `42501
// permission denied` against a project that was completely healthy. A check that
// reports a working project as broken gets ignored, and one that cannot tell
// "revoked from anon" from "migration never ran" is not answering #78's question
// at all.
//
// An anonymous sign-in is what puts this check on role `authenticated`, which is
// the role the per-column grants are written for. That is still exactly the
// right probe, and the REASON it is right changed with #62.
//
// It used to be "the same credentials the app uses": `household.js` called
// `signInAnonymously()` itself before reading anything. It does not any more —
// the app signs a PERSON in — so the justification is now narrower and worth
// stating precisely. What this check tests is whether the tables, columns and
// GRANTS exist, and grants are keyed on the role, not on who is holding it. An
// anonymous user is a first-class `authenticated` user with no member row, so it
// lands on the same grants and simply sees no rows — which is all this check
// needs, since it reads zero rows on purpose.
//
// The consequence, corrected: if anonymous sign-ins are disabled on the project,
// THIS CHECK breaks and the app does not. That sentence used to say the
// opposite, truthfully, and #62 made it false — anonymous sign-in is now used by
// nothing but this file. Disabling it is a reasonable thing for the owner to do
// after #62, and it would take `npm run check:live` down with it.
//
// THE COST, stated because it is a write to production: each run creates one
// anonymous auth user, and there is no client-reachable way to delete it. That is
// the same accumulation `rls.integration.test.js` already accepts and documents;
// tidying is a manual statement in the SQL editor. It creates no household and
// reads no household's rows.
beforeAll(async () => {
  const { error } = await supabase.auth.signInAnonymously()
  if (error) {
    throw new Error(
      `could not sign in anonymously, so this check cannot ask its question on role ` +
        `\`authenticated\`, which is the role the column grants are written for: ${error.message}. ` +
        `Since #62 the app no longer signs in anonymously, so this is a limitation of the ` +
        `CHECK rather than a fault in the project — if the provider has been turned off, this ` +
        `check needs a real member's credentials instead.`,
    )
  }
})

/**
 * Ask for exactly what the client asks for, and for none of the data.
 *
 * `limit(0)` is the whole trick: PostgREST resolves the relation and the column
 * list before it applies RLS or returns rows, so a missing table or column is an
 * error while a present one is an empty array. That means this reads no
 * household's data at any point — it is a question about the SCHEMA, asked with
 * the same credentials and the same column lists as the app.
 */
async function probe(table, columns) {
  const { error } = await supabase.from(table).select(columns).limit(0)
  return error
}

describe('#78 — the live project has every table and column this app reads', () => {
  it('has a schema list to check, so an empty pass is impossible', () => {
    // FOUR since #62 dropped `household_devices`. It said five, which is the
    // count #78 shipped with, and leaving it made BOTH non-CI commands
    // permanently red — this file and `rls.integration.test.js` are matched by
    // the same `include` glob, and `test:rls` passes no path filter, so the
    // over-the-wire suite reddened on it too. `check:live` could never exit 0
    // against any project, healthy or broken, while `docs/access-model.md`
    // names it as the authority on live state.
    //
    // The failure message is the part worth remembering: "expected 4 to be
    // greater than or equal to 5", under a test called "so an empty pass is
    // impossible" — it reads as an empty list and is a stale floor. A guard
    // against vacuity became the thing that broke the run.
    //
    // The number goes DOWN when a table legitimately leaves. That edit should be
    // deliberate and visible in review, which is why it is a literal rather than
    // `LIVE_SCHEMA.length` — comparing the list to itself would pass at zero.
    expect(LIVE_SCHEMA.length).toBeGreaterThanOrEqual(4)
  })

  // One test per table rather than a loop with one assertion: a failure should
  // name the table in the test name, not only in a message, so the run output
  // says which migration is missing without anyone opening the file.
  for (const { table, columns } of LIVE_SCHEMA) {
    it(`${table} exists, with every column the app selects`, async () => {
      const error = await probe(table, columns)
      expect(describeSchemaError(table, columns, error) ?? 'ok').toBe('ok')
    })
  }
})

describe('#78 AC 2 — POSITIVE CONTROL: this check can actually fail', () => {
  // Without these, every assertion above is consistent with a probe that cannot
  // report a problem — a connection that silently returns no error, a client
  // swallowing it, a `limit(0)` short-circuit that never reaches the database.
  // A green run above means nothing unless these two go red on demand.

  it('fails on a table that does not exist, and names it', async () => {
    const table = 'taskr_no_such_table_positive_control'
    const error = await probe(table, '*')
    expect(error, 'a missing table must be an error, not an empty result').toBeTruthy()
    // MEASURED: PostgREST answers this from its schema cache before Postgres sees
    // it, so the code is `PGRST205` rather than the `42P01` this control first
    // asserted. Both are accepted; pinning only the guessed one is how a control
    // goes red against a correct implementation.
    expect(['PGRST205', '42P01']).toContain(error.code)
    expect(describeSchemaError(table, '*', error)).toContain(table)
  })

  it('fails on a column that does not exist, and names it', async () => {
    // The sharper half. `0004` and `0006` both add COLUMNS to a table that
    // already exists, so a table-existence check alone would have missed both
    // and this control is what proves the column half is live.
    const column = 'taskr_no_such_column_positive_control'
    const error = await probe('members', `id, ${column}`)
    expect(error, 'a missing column must be an error, not an empty result').toBeTruthy()
    expect(error.code).toBe('42703')
    expect(error.message).toContain(column)
  })
})

/**
 * Ask whether the function is there, without letting it do its job — #85.
 *
 * `{ get: true }` turns `.rpc()` from a POST into a GET, and PostgREST serves a
 * GET inside a READ-ONLY TRANSACTION. That is the whole trick, and it is the
 * function-shaped equivalent of `limit(0)`: every one of these RPCs writes, so
 * the database refuses the write and answers `25006` — which proves the function
 * resolved and ran, and proves it changed nothing, in the same round trip.
 *
 * Every argument gets a nil-UUID placeholder, so even the read the function does
 * before its write matches no row of any household.
 */
async function probeRpc(fn, args) {
  const { error } = await supabase.rpc(fn, rpcProbeArgs(args), { get: true })
  return error
}

describe('#85 — the live project has every function this app calls', () => {
  it('has an RPC list to check, so an empty pass is impossible', () => {
    // Same shape and same reason as the table floor above, including the trap it
    // has already sprung once: this is a FLOOR against a vacuous pass, not a
    // target, and it goes down when an RPC legitimately leaves. Five since `0007`
    // retires four of the nine #85 was filed naming.
    expect(LIVE_RPCS.length).toBeGreaterThanOrEqual(5)
  })

  it('probes inside a read-only transaction, so a probe cannot write — #85 AC 3', async () => {
    // THE CONTROL FOR AC 3, and it is evidence rather than a promise: every
    // assertion in this describe rests on the claim that a GET cannot mutate, and
    // that claim is only true while PostgREST keeps serving GET read-only.
    //
    // `complete_chore` takes a `for update` row lock as its first act, so if the
    // transaction were writable this would come back `P0001` (no such chore).
    // Postgres answering `25006` IS the read-only transaction, observed.
    //
    // It goes through `probeRpc` rather than calling the client directly, and
    // that is the load-bearing detail: the safety of this whole file rests on one
    // option — `{ get: true }` — living in one function, and a control that
    // reached past it would stay green while every probe below started POSTing.
    // Dropping the option makes this the test that fails, which is the only
    // arrangement where AC 3 is guarded rather than asserted.
    const error = await probeRpc('complete_chore', ['chore_id'])
    expect(error?.code, 'the probe is no longer read-only — every probe below now WRITES').toBe(
      '25006',
    )
  })

  // One test per function, for the table half's reason: a failure should name the
  // function in the run output, so the person who just pasted a migration reads
  // which one is missing without opening a file.
  for (const { fn, args } of LIVE_RPCS) {
    it(`${fn}(${args.join(', ')}) exists, with the arguments the app passes`, async () => {
      const error = await probeRpc(fn, args)
      expect(describeRpcError(fn, args, error) ?? 'ok').toBe('ok')
    })
  }
})

describe('#85 AC 2 — POSITIVE CONTROL: the RPC check can actually fail', () => {
  // Without these, every assertion above is consistent with a probe that cannot
  // report a problem — a GET that always errors the same way, a client swallowing
  // the code, a classification that returns null for everything.

  it('fails on a function that does not exist, and names it', async () => {
    const fn = 'taskr_no_such_function_positive_control'
    const error = await probeRpc(fn, ['chore_id'])
    expect(error, 'a missing function must be an error, not an empty result').toBeTruthy()
    expect(error.code).toBe('PGRST202')
    const line = describeRpcError(fn, ['chore_id'], error)
    expect(line).toContain(fn)
    // MEASURED during the mutation pass: naming the function is not enough on its
    // own. Disarming the `PGRST202` classification left this control GREEN — the
    // fallback still produced a line, and that line still contained the function
    // name, so the assertion could not tell "reported as missing" from "reported
    // as unprovable". Pinning the classification is what makes it a control.
    expect(line).toContain('never ran, or its signature changed')
  })

  it('fails on a function whose ARGUMENTS have changed, and names it', async () => {
    // The sharper half, and the one that decides whether this check is worth
    // more than a name list. `complete_chore` exists; `complete_chore(chore)`
    // does not, because PostgREST resolves by argument names. A signature that
    // drifts away from the client is exactly the live failure this check is for,
    // and a name-only check would call it healthy.
    const error = await probeRpc('complete_chore', ['chore'])
    expect(error, 'a changed signature must be an error, not an empty result').toBeTruthy()
    expect(error.code).toBe('PGRST202')
    expect(describeRpcError('complete_chore', ['chore'], error)).toContain('signature changed')
  })
})

describe('#78 — the probe reads schema, never a household', () => {
  let result

  beforeAll(async () => {
    result = await supabase.from('members').select('id').limit(0)
  })

  it('returns no rows, so running this reveals nobody', () => {
    // Asserted rather than commented because it is why this is safe to run
    // against production whenever anyone wants to. Note the honest scope: the
    // run DOES create an anonymous auth user (see the sign-in above). What it
    // does not do is read, write or expose any household's data.
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })
})
