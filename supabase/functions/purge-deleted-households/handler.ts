// #430 — purge every household whose grace period has ended.
//
// WHO CALLS IT. Nobody in a browser. A daily Vercel cron calls `api/purge.js`,
// which calls this with the purge secret in `x-purge-secret`. That scheduler is
// a deliberate, recorded exception to docs/hosting-decision.md (owner decision
// on #430, 2026-09-11). The function is SERVER-ONLY: it is deployed with
// `--no-verify-jwt` because its caller holds no user session, and it checks the
// shared secret itself, refusing when the secret is not configured at all. It
// is listed in `SERVER_ONLY_FUNCTIONS` (scripts/deploy-function.mjs), never in
// `LIVE_EDGE_FUNCTIONS`, because the app never invokes it.
//
// WHAT IT DOES, per due household, in this order, and the order is the design:
//
//   1. Revoke the household's Google grants at Google, FIRST, because the delete
//      in step 3 cascades the token rows away, and a grant nobody holds a token
//      for can never be revoked. The tokens come from
//      `household_tokens_to_revoke`, which leaves out a person still connected
//      in another household: one Google account holds ONE grant with Taskr's
//      single OAuth client, so revoking it would break that other household's
//      calendar (owner decision at #430's review, 2026-09-11). Their token row
//      still goes with the cascade. A household whose tokens cannot be READ is
//      not purged this run and is retried tomorrow. A revoke Google REFUSES is
//      not a reason to stop, for calendar-disconnect's reason: most refusals
//      mean the grant is already gone.
//   2. Delete each sign-in that claims a member there and nowhere else (#262's
//      rule), BEFORE the household. `members_claimed_by_fkey` is ON DELETE SET
//      NULL, so this is #247's recoverable order: an account step that fails
//      leaves the household due, and tomorrow's run finds it again with the
//      claimants it still names. Household-first would cascade away the only
//      record of who claimed it, and the accounts would outlive it for good.
//      The other-claims read EXCLUDES this household, whose member rows are
//      still there.
//   3. `purge_household`, only once every account step succeeded. It deletes
//      the household only if its grace period is over, and says false when
//      there was nothing due to delete.
//   4. Record the run's counts with `record_household_purge_run`. Vercel Hobby
//      keeps logs for one hour and alerts on nothing, so this row is how a purge
//      that stopped is told apart from a quiet week.
//
// SAFE LATE, SAFE TWICE, SAFE AFTER A PARTIAL FAILURE. Nothing here assumes
// yesterday's run happened (docs/hosting-decision.md's standing rule). A second
// concurrent run finds the accounts already gone, which counts as done, and
// `purge_household` returning false. A run that dies part-way leaves the
// household due, still naming whoever it has not yet let go of.
//
// COUNTS ONLY in the response and the record: no household, person or token is
// named, because a response body can end up in a log. `failures` counts the
// households a failure left due.

import { GOOGLE_REVOKE_ENDPOINT } from '../calendar-disconnect/handler.ts'

/** The header the Vercel function sends the shared secret in. */
export const PURGE_SECRET_HEADER = 'x-purge-secret'

/** The Supabase function secret holding the shared value. */
export const PURGE_SECRET_ENV = 'PURGE_SHARED_SECRET'

/**
 * Every header supabase-js puts on a `functions.invoke` call — the same list as
 * the other functions, restated for their reason. Nothing invokes this one from
 * a browser; the literal is here because src/test/edge-function-cors.test.js
 * checks every function directory, and a function that one day is called from
 * one should not fail its preflight.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export interface Filtered {
  neq(column: string, value: unknown): Filtered
  limit(count: number): PromiseLike<{ data: any; error: any }>
}

/** The bits of a Supabase client this handler touches, structurally. */
export interface PurgeClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>
  from(table: string): { select(columns: string): { eq(column: string, value: unknown): Filtered } }
  auth: { admin: { deleteUser(id: string): Promise<{ error: any }> } }
}

export interface PurgeDeps {
  fetch: (input: string, init?: unknown) => Promise<Response>
  env: (name: string) => string | undefined
  createClient: (url: string, key: string, options?: unknown) => PurgeClient
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * Compare the given secret with the expected one in constant time, so the
 * secret cannot be recovered a byte at a time from how long a refusal takes.
 */
export function secretsMatch(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let difference = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return difference === 0
}

/**
 * An account a concurrent run already deleted. Not a failure: the account is
 * gone, which is what this step is for, and counting it would make every
 * overlapping run answer 500 for doing no harm.
 */
function alreadyGone(error: any): boolean {
  return error?.status === 404 || error?.code === 'user_not_found'
}

/**
 * Ask Google to forget one grant. Best-effort and never throws: calendar-
 * disconnect's `revokeAtGoogle`, restated rather than imported because it is
 * not exported and exporting it would make calendar-disconnect a changed
 * function needing its own redeploy. The endpoint IS imported, so the two
 * cannot disagree about where a revoke goes.
 */
async function revokeAtGoogle(deps: PurgeDeps, refreshToken: string): Promise<boolean> {
  try {
    const response = await deps.fetch(GOOGLE_REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    })
    return response.ok
  } catch {
    return false
  }
}

export function createHandler(deps: PurgeDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const expected = deps.env(PURGE_SECRET_ENV)
    const url = deps.env('SUPABASE_URL')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    // Unset refuses, never admits: a secret that is missing is not a secret
    // that everyone knows.
    if (!expected || !url || !serviceKey) return refuse('This function is not configured.', 500)

    if (!secretsMatch(req.headers.get(PURGE_SECRET_HEADER) ?? '', expected)) {
      return refuse('Not allowed.', 401)
    }

    const asService = deps.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: due, error: dueError } = await asService.rpc('households_due_for_purge')
    if (dueError) return refuse('Could not read the households due for purge.', 500)

    const summary = { due: (due ?? []).length, purged: 0, failures: 0, revoked: 0, accountsDeleted: 0 }

    for (const row of due ?? []) {
      const householdId = row.household_id
      const claimants: string[] = row.claimants ?? []

      // 1. The grants, before the cascade takes the tokens.
      const { data: tokens, error: tokenError } = await asService.rpc('household_tokens_to_revoke', {
        household_id: householdId,
      })
      if (tokenError) {
        summary.failures++
        continue
      }
      for (const token of tokens ?? []) {
        if (token?.refresh_token && (await revokeAtGoogle(deps, token.refresh_token))) {
          summary.revoked++
        }
      }

      // 2. Each sign-in that claims nothing outside this household, BEFORE it goes.
      let accountsLetGo = true
      for (const claimant of claimants) {
        const { data: others, error: othersError } = await asService
          .from('members')
          .select('id')
          .eq('claimed_by', claimant)
          .neq('household_id', householdId)
          .limit(1)
        if (othersError) {
          accountsLetGo = false
          continue
        }
        if ((others ?? []).length > 0) continue // #262: still in another household
        const { error: deleteError } = await asService.auth.admin.deleteUser(claimant)
        if (!deleteError) summary.accountsDeleted++
        else if (!alreadyGone(deleteError)) accountsLetGo = false
      }
      if (!accountsLetGo) {
        // Left due: tomorrow's run lists this household again, with the
        // claimants it still names.
        summary.failures++
        continue
      }

      // 3. The household, once nobody it names is left behind.
      const { data: deleted, error: purgeError } = await asService.rpc('purge_household', {
        household_id: householdId,
      })
      if (purgeError) {
        summary.failures++
        continue
      }
      if (deleted === true) summary.purged++ // false: purged by another run, or no longer due
    }

    // 4. The record.
    const { error: recordError } = await asService.rpc('record_household_purge_run', {
      due: summary.due,
      purged: summary.purged,
      failures: summary.failures,
    })

    // Anything that needs looking at is a non-2xx, so it is at least visible
    // for the hour Vercel keeps the log.
    const status = recordError || summary.failures > 0 ? 500 : 200
    return json({ ...summary, recorded: !recordError }, status)
  }
}
