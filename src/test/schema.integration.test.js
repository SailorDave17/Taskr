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
//
// #91 — WHAT THIS FILE CAN AND CANNOT SAY ABOUT GRANTS, which is a narrower
// answer than it looks and is stated here because #91 asked the question
// directly.
//
// It CAN see a missing SELECT grant, and does so for free. Every table probe
// below is `select(<columns>).limit(0)` signed in as `authenticated`, and a
// column this role cannot read is answered `42501 permission denied` rather
// than with an empty page. That is not reasoned — it is the measurement in the
// sign-in docblock above: probing as `anon` returned exactly that code for
// `members`, `chores` and `member_capacity` against a completely healthy
// project. `describeSchemaError` already classifies it, and
// `liveSchema.test.js` asserts that it reports a grant failure rather than
// treating it as success.
//
// It CANNOT see a missing INSERT, UPDATE or DELETE grant, and that gap is
// deliberate rather than pending. Seeing one means ISSUING one: there is no
// read-only way to ask PostgREST whether you may delete, the way a GET on an
// RPC asks whether you may call it. A `.delete()` with a filter that matches
// nothing would answer the question and would also make this check — the one
// thing in the repo whose whole job is to be safe to run against production at
// any moment — a check that writes. Its safety would then rest on a filter
// being right rather than on the operation being read-only, and a filter is a
// thing somebody edits. #91 put that to the owner and the answer was no.
//
// So the DELETE and INSERT grants are covered in `src/test/grants.pglite.test.js`
// instead, which drives all seventeen client operations against a database built
// from `supabase/migrations/` with the platform's real default ACL. That runs in
// CI and answers a different question from this file: it asks whether the FILES
// grant what the client needs, where this file asks whether the PROJECT has what
// the files describe. Both are needed and neither substitutes for the other —
// #91 was three missing grants that were present on the live project and absent
// from every file, so this check was green throughout and correct to be.

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isSecretKey } from '../lib/keyShape.js'
import {
  LIVE_RPCS,
  LIVE_SCHEMA,
  LIVE_EDGE_FUNCTIONS,
  describeEdgeFunctionError,
  describeRpcError,
  describeSchemaError,
  describeSignInError,
  probeEdgeFunction,
  rpcArgNames,
  rpcProbeArgs,
} from '../lib/liveSchema.js'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const seedEmail = process.env.TASKR_TEST_EMAIL
const seedPassword = process.env.TASKR_TEST_PASSWORD

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

// A separate message because the remedy is different: the keys are copied from
// the dashboard, where this account has to be CREATED there, once. Same
// credentials `test:rls` requires, for the same reason — see the sign-in
// docblock below for why this file stopped minting its own.
if (!seedEmail || !seedPassword) {
  throw new Error(
    'schema.integration.test.js signs in as the seeded test account (#246), and ' +
      'TASKR_TEST_EMAIL / TASKR_TEST_PASSWORD are not set.\n' +
      'They are the same credentials `npm run test:rls` already needs: one account, ' +
      'created once in the dashboard with "Auto Confirm User" ticked. `.env.example` ' +
      'carries the recipe. Nothing was probed.',
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

// Sign in as the seeded account, and for the reason the app's grants force.
//
// MEASURED 2026-08-10, and it is the finding that shaped this file: probing with
// the publishable key alone runs as role `anon`, which `0002` and `0003` revoke
// WHOLESALE — so `members`, `chores` and `member_capacity` all came back `42501
// permission denied` against a project that was completely healthy. A check that
// reports a working project as broken gets ignored, and one that cannot tell
// "revoked from anon" from "migration never ran" is not answering #78's question
// at all. So this file must ask its question on role `authenticated`, which is
// the role the per-column grants are written for — and grants are keyed on the
// role, not on who is holding it, so ANY signed-in user answers it.
//
// Until #246 the credential was an anonymous sign-in, and the cost this docblock
// stated for it — each run creates one permanent auth user, with no
// client-reachable way to delete it — turned out to be a live incident rather
// than an accepted overhead. MEASURED 2026-08-28: 45 anonymous auth users on the
// live project, every one minted by this file's own `beforeAll` (both
// `check:live` and `test:rls` run this file); all 45 carried session user-agent
// `node` from ONE IP, and one `check:live` run moved the count 44 → 45 with the
// new row stamped a second after the run started. The hypotheses #246 opened
// with — a stale pre-#62 client, an outside actor on the public key, a dashboard
// action — died on that one read: a phone carries a browser user agent, an
// outsider a different IP, and the dashboard mints no `node` sessions.
//
// So the credential is now the seeded account `test:rls` already requires:
// TASKR_TEST_EMAIL / TASKR_TEST_PASSWORD, created once in the dashboard with
// "Auto Confirm User" (recipe in `.env.example`). Same role, same grants, same
// answer to every probe below — and ZERO residue, because the `afterAll` revokes
// this run's session. The seeded account holds member rows in TEST households,
// which changes nothing here: every probe is `limit(0)` and reads no rows.
//
// The consequence, inverted from the sentence that stood here before: anonymous
// sign-in is now used by NOTHING in this repo — not the app (since #62), not
// this check (since #246) — so `external.anonymous_users` is disabled on the
// live project (owner decision 2026-08-28, recorded with its post-state on
// #246). The vocabulary guard in `support/retiredVocabulary.test.js` now scans
// this file with no exemption, so the call cannot quietly return.
//
// #250 — CAPTURED, NEVER THROWN, and that one word is the whole change.
//
// This hook used to throw on a failed sign-in. It was correct, and it was
// SILENT: vitest reports a `beforeAll` failure as its tests SKIPPED, so the run
// came back 26 total / 0 FAILED / 26 pending / `success: false`, naming nothing.
// Measured on this file on 2026-08-28, immediately before this change, by
// pointing TASKR_TEST_PASSWORD at a wrong value. That output reads as an
// environment hiccup rather than as a dead instrument — which is how the
// account's deletion around 2026-08-25 went unnoticed for FOUR DAYS while
// `npm run test:rls` threw here on every run.
//
// So the sign-in still happens here, because it has to happen before any probe,
// and its RESULT is asserted in a counted test below, where a failure is a named
// red carrying the fix. Recreating the account took about four minutes; the four
// days were the expensive part, and two of the RLS suite's own tests went stale
// inside the window — one written on 2026-08-26 and never once executed, one
// falsified by `0016` the same day.
const signIn = { error: null, session: null }

beforeAll(async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: seedEmail,
    password: seedPassword,
  })
  signIn.error = error ?? null
  signIn.session = data?.session ?? null
})

/**
 * Refuse to probe as the wrong caller — #250 AC 3.
 *
 * The option NOT available is letting these run anyway. Without a session they
 * run as `anon`, which `0002` and `0003` revoke wholesale, so `members`,
 * `chores` and `member_capacity` answer `42501` and `describeSchemaError`
 * reports a GRANT FAILURE against a completely healthy project — measured
 * 2026-08-10, and recorded in the sign-in docblock above. A check that reports a
 * working project as broken gets ignored.
 *
 * Owner decision 2026-08-28, taken against skipping them at run time. That
 * option reads better in a terminal — one red and twenty-five skips rather than
 * twenty-two reds — and it buys a new way for this file to pass while asking
 * almost nothing: a guard whose condition ever inverted would make a HEALTHY run
 * report one pass, twenty-five skips, and exit 0. This is the one file in the
 * repo whose whole job is to be unfoolable, so it fails closed and takes the
 * noise. Every one of those reds names the single real cause and says in as many
 * words that it is not a finding about the live project.
 */
function requireSession() {
  if (!signIn.session) {
    throw new Error(
      'NOT ASKED — the seeded account has no session, so this probe would run as `anon` ' +
        'and report a healthy project as broken. This is NOT a finding about the live ' +
        'project: the cause, and its fix, are on the #250 sign-in row above.',
    )
  }
}

describe('#250 — the seeded test account still works, said out loud', () => {
  // AC 1. A COUNTED ROW, which is the entire point: the failure this replaces
  // was a `beforeAll` throw, and vitest reports that as skips with
  // `numFailedTests: 0`. A row can go red; a hook cannot.
  it('signs in, so this run can ask its questions at all', () => {
    const line = describeSignInError(seedEmail, signIn.error, signIn.session)

    // THROWN rather than diffed, and the reason is presentation rather than
    // taste. MEASURED during this story's own mutation pass: the house
    // `expect(classify() ?? 'ok').toBe('ok')` idiom renders in the summary line
    // as `expected 'the seeded test account (test@tester.…' to be 'ok'` —
    // vitest truncates a serialized value at about forty characters, so the
    // account, the classification and the fix are all cut off. The full text is
    // still in the detail block below, but the summary line is where a person
    // reading twenty-two reds actually looks, and on this row the message IS the
    // deliverable. A thrown Error prints whole in both places.
    if (line) throw new Error(line)

    // Not a tautology, and worth stating because it looks like one: the
    // classifier returns null whenever a session object is present, so a session
    // carrying no access token would pass it and fail here. Everything below
    // sends that token.
    expect(signIn.session?.access_token, 'a green row here must mean a real session').toBeTruthy()
  })

  // AC 3, REWRITTEN — and the rewrite is recorded rather than quiet.
  //
  // As filed at 15:53Z on 2026-08-28 this criterion asked that the rest of
  // `check:live` be "demonstrably still asking its questions as the ANONYMOUS
  // caller", with the new probe on its own client so it could not replace that
  // session. That was true of this file when it was written and false three
  // hours later: PR #263 (#246) merged at 19:09Z the same day and made the
  // SEEDED ACCOUNT the credential for the whole file, precisely because the
  // anonymous sign-in had minted 45 permanent auth users. Two things now refuse
  // the criterion's literal form — `signInAnonymously` is retired vocabulary and
  // this file is scanned for it with no exemption, and
  // `external.anonymous_users` is disabled on the live project.
  //
  // The MECHANISM died; the REASON did not, and the reason is the whole value: a
  // check answering about the wrong subject stays green. So the claim is kept
  // and re-pointed at the caller this file actually has. Owner decision
  // 2026-08-28, taken against marking it moot.
  //
  // It asks the SERVER who the client is rather than reading back what the
  // sign-in returned — `getUser()` is a round trip against the session the
  // probes below will use, so it cannot agree with itself the way a local read
  // would.
  it('and every probe below asks as THAT account, on role `authenticated` — #250 AC 3', async () => {
    requireSession()

    const { data, error } = await supabase.auth.getUser()
    expect(error, 'the session the probes below will use is not usable').toBeNull()
    expect(data.user?.email, 'the probes below are running as somebody else').toBe(seedEmail)

    // The role is what the per-column grants are keyed on, and it is a claim in
    // the access token rather than a property of the account — so it is read
    // from the token this client is actually sending. `anon` here means every
    // probe below is asking the question this file exists NOT to ask.
    const claims = JSON.parse(
      Buffer.from(signIn.session.access_token.split('.')[1], 'base64url').toString('utf8'),
    )
    expect(claims.role, 'the probes below are not on the role the column grants are written for').toBe(
      'authenticated',
    )
  })
})

// Revoke THIS RUN's session, so a run leaves nothing behind. Scope 'local'
// touches only the session the sign-in above created — never the seeded
// account's other sessions, which a concurrently-running `test:rls` may hold.
// #246 exists because this file used to leave one permanent auth user per run;
// now the residue is zero users and zero sessions.
afterAll(async () => {
  await supabase.auth.signOut({ scope: 'local' })
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
      requireSession()
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
    requireSession()
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
    requireSession()
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
 * function-shaped equivalent of `limit(0)`: these RPCs write, so the database
 * refuses the write and answers `25006` — which proves the function resolved,
 * proves this role may execute it, and proves it changed nothing, in the same
 * round trip.
 *
 * Every argument gets the placeholder for its declared TYPE, and each of those is
 * a value of that type which matches no row, so even the read a function does
 * before its write finds nothing.
 *
 * #268 CORRECTED THIS DOCBLOCK, and the sentence it replaced is worth keeping in
 * view because it was the thing that hid the defect. It read "every one of these
 * RPCs writes, so the database refuses the write and answers `25006` — which
 * proves the function resolved and ran". Two of the ten never ran:
 * `apply_assignments` and `skip_repeat_occurrence` take an argument that is not a
 * `uuid`, the one nil-UUID placeholder could not coerce to it, and Postgres
 * refused the CALL before the privilege check — `22P02` and `22007`, both green
 * under a classifier that reads any five-character SQLSTATE as proof of presence.
 *
 * So the claim is now stated at the strength the weakest row can carry, and
 * `describeRpcError` REFUSES a class-22 answer rather than leaving the claim to a
 * comment. Not every row answers `25006` even now: with the placeholders it is
 * handed, `apply_assignments` is refused by its own first argument guard before
 * it reads anything. That is a plpgsql `raise` past the privilege check, so it
 * proves what this file claims — the function is there and this role may call it —
 * and the read-only transaction is a second wall behind it rather than the one
 * that fired.
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
    requireSession()
    const error = await probeRpc('complete_chore', { chore_id: 'uuid' })
    expect(error?.code, 'the probe is no longer read-only — every probe below now WRITES').toBe(
      '25006',
    )
  })

  // One test per function, for the table half's reason: a failure should name the
  // function in the run output, so the person who just pasted a migration reads
  // which one is missing without opening a file.
  for (const entry of LIVE_RPCS) {
    const { fn, args } = entry
    const names = rpcArgNames(args)
    it(`${fn}(${names.join(', ')}) exists, with the arguments the app passes`, async () => {
      requireSession()
      const error = await probeRpc(fn, args)
      expect(describeRpcError(fn, names, error) ?? 'ok').toBe('ok')
      // #268 AC 2, and it is a SEPARATE assertion on purpose. The line above
      // already refuses a class-22 answer, but it refuses it inside
      // `describeRpcError` — so a future edit that widened the classifier back
      // would take this row's meaning with it and nothing here would notice. This
      // one says the thing the row is FOR, at the call site, in its own words.
      expect(
        error?.code ?? 'no error',
        `${fn} was answered while COERCING an argument, so this row proves less than the ` +
          `rows beside it: the call never reached the privilege check, and would look ` +
          `identical against a project granting this role no execute at all (#268)`,
      ).not.toMatch(/^22/)
    })
  }

  // #268 AC 2 and AC 3 for the two rows the story was filed about, pinned to the
  // exact answer each gives. The loop above says "not a coercion error", which is
  // the general property and the one that protects a row added tomorrow; these
  // say what these two functions actually answered on the day the types were
  // measured, so a change in that answer is a thing somebody has to look at
  // rather than a silent drift back.
  it('apply_assignments is answered by the FUNCTION, past the privilege check — #268', async () => {
    requireSession()
    const args = LIVE_RPCS.find((entry) => entry.fn === 'apply_assignments').args
    const error = await probeRpc('apply_assignments', args)
    // P0001 is the function's own `raise`. Reaching it means PostgREST resolved
    // the overload, Postgres checked `execute` and allowed it, and plpgsql began
    // — which is everything the row claims, and none of which the pre-#268
    // `22P02` established.
    expect(error?.code).toBe('P0001')
    // AC 3: shown to change nothing, rather than assumed to. This is the message
    // of the FIRST guard in the body — `jsonb_typeof(placements) is distinct from
    // 'array'` — so the probe was refused before the membership lookup, before the
    // `for update` on `households`, and before any statement that could write. The
    // read-only transaction asserted above never had to fire.
    expect(error?.message).toContain('placements must be an array')
  })

  it('skip_repeat_occurrence is refused by the read-only transaction — #268', async () => {
    requireSession()
    const args = LIVE_RPCS.find((entry) => entry.fn === 'skip_repeat_occurrence').args
    const error = await probeRpc('skip_repeat_occurrence', args)
    // The other half of AC 3, and the cleaner one: this function's first act is a
    // row lock, so the answer IS the read-only transaction stopping a write —
    // observed, on the live project, with the same placeholders every other row
    // uses. Before #268 this row answered `22007` and could not have said so.
    expect(error?.code).toBe('25006')
  })
})

describe('#85 AC 2 — POSITIVE CONTROL: the RPC check can actually fail', () => {
  // Without these, every assertion above is consistent with a probe that cannot
  // report a problem — a GET that always errors the same way, a client swallowing
  // the code, a classification that returns null for everything.

  it('fails on a function that does not exist, and names it', async () => {
    requireSession()
    const fn = 'taskr_no_such_function_positive_control'
    const error = await probeRpc(fn, { chore_id: 'uuid' })
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
    requireSession()
    const error = await probeRpc('complete_chore', { chore: 'uuid' })
    expect(error, 'a changed signature must be an error, not an empty result').toBeTruthy()
    expect(error.code).toBe('PGRST202')
    expect(describeRpcError('complete_chore', ['chore'], error)).toContain('signature changed')
  })
})

describe('#115 - the live project is RUNNING every Edge Function this app invokes', () => {
  // The gap this closes: everything above probes things a migration paste
  // creates. An Edge Function arrives by `supabase functions deploy` and no
  // migration mentions it, so `provision-member` sat undeployed from 2026-08-13
  // to 2026-08-20 with all 17 checks above green, and the app failed on a phone
  // with a network-shaped error (#112).
  it('has an Edge Function list to check, so an empty pass is impossible', () => {
    // The floor, for the same reason as the table and RPC floors: a list that
    // silently empties turns this whole describe into a vacuous pass.
    expect(LIVE_EDGE_FUNCTIONS.length).toBeGreaterThanOrEqual(1)
  })

  // One test per function, so a failure names it in the run output rather than
  // making somebody open a file to find out which one is missing.
  for (const name of LIVE_EDGE_FUNCTIONS) {
    it(`${name} is deployed, and a browser could actually call it`, async () => {
      const probe = await probeEdgeFunction(url, name)
      expect(describeEdgeFunctionError(name, probe) ?? 'ok').toBe('ok')
    })
  }
})

describe('#115 AC 5 - POSITIVE CONTROL: the Edge Function check can actually fail', () => {
  it('reports a function name that does not exist, and names it', async () => {
    // Live rather than synthetic, matching the table and RPC controls: this
    // proves the probe reaches the real gateway and that the classifier fires on
    // a real answer, not that a hand-built object routes correctly - the unit
    // tests in liveSchema.test.js already cover that.
    //
    // The caveat this carried has EXPIRED, and it said in band that it would.
    // While `provision-member` was itself undeployed, this control returned the
    // SAME verdict as the real test above, so the pair did not DISCRIMINATE —
    // and a control that cannot yet tell two things apart looks identical to
    // one that works. The deploy landed on 2026-08-20 and they now disagree:
    // the test above reports deployed and callable, this reports absent. That
    // disagreement is what makes the pair evidence rather than two guesses that
    // happen to match. (Cleared 2026-08-21 by #88, along with the expected-red
    // entry in docs/access-model.md the caveat was keyed to.)
    const absent = 'taskr-check-live-no-such-function'
    const probe = await probeEdgeFunction(url, absent)
    const line = describeEdgeFunctionError(absent, probe)
    expect(line, 'the gateway answered as though this function exists').toContain('NOT DEPLOYED')
    expect(line).toContain(absent)
  })
})

describe('#78 — the probe reads schema, never a household', () => {
  // #250 moved this query out of a nested `beforeAll` and into the test. That
  // hook was a second copy of the failure this story exists to remove: a throw
  // in it reports as a SKIP, so the one assertion that says this check reveals
  // nobody could stop being asked without anything going red.
  it('returns no rows, so running this reveals nobody', async () => {
    requireSession()
    const result = await supabase.from('members').select('id').limit(0)
    // Asserted rather than commented because it is why this is safe to run
    // against production whenever anyone wants to. Note the honest scope: the
    // run DOES create an anonymous auth user (see the sign-in above). What it
    // does not do is read, write or expose any household's data.
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })
})
