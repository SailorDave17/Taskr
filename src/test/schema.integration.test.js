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

import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import { isSecretKey } from '../lib/keyShape.js'
import { LIVE_SCHEMA, describeSchemaError } from '../lib/liveSchema.js'

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
// `household.js` calls `signInAnonymously()` before it reads anything, which puts
// a real device on role `authenticated` — the role the per-column grants are
// actually written for. This does the same, so the check asks its question with
// the same credentials, the same role and the same column lists as the app.
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
      `could not sign in anonymously, so this check cannot ask its question as the ` +
        `role the app uses: ${error.message}. ` +
        `If anonymous sign-ins are disabled on the project, the app itself is broken too.`,
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
    expect(LIVE_SCHEMA.length).toBeGreaterThanOrEqual(5)
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
