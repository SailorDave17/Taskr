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
//   1. Read the household's Google refresh tokens and revoke each at Google.
//      FIRST, because the delete in step 2 cascades the token rows away, and a
//      grant nobody holds a token for can never be revoked. A household whose
//      tokens cannot be READ is not purged this run: purging it would leave its
//      grants live at Google forever. It stays due and is retried tomorrow.
//      A revoke Google REFUSES is not a reason to stop, for calendar-disconnect's
//      reason: most refusals mean the grant is already gone.
//   2. `purge_household`, which deletes the household only if its grace period
//      is over, and says false when there was nothing due to delete.
//   3. Delete each sign-in that claimed a member there and now claims nothing
//      anywhere (#262's rule). The claimants were read by
//      `households_due_for_purge` BEFORE the delete, because the cascade removes
//      the member rows that named them.
//   4. Record the run's counts with `record_household_purge_run`. Vercel Hobby
//      keeps logs for one hour and alerts on nothing, so this row is how a purge
//      that stopped is told apart from a quiet week.
//
// SAFE LATE AND SAFE TWICE. Nothing here assumes yesterday's run happened
// (docs/hosting-decision.md's standing rule), and a second concurrent run finds
// `purge_household` returning false and deletes no account.
//
// COUNTS ONLY in the response and the record: no household, person or token is
// named, because a response body can end up in a log.

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

export interface Selected extends PromiseLike<{ data: any; error: any }> {
  limit(count: number): Promise<{ data: any; error: any }>
}

/** The bits of a Supabase client this handler touches, structurally. */
export interface PurgeClient {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }>
  from(table: string): { select(columns: string): { eq(column: string, value: unknown): Selected } }
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
      const { data: tokens, error: tokenError } = await asService
        .from('calendar_tokens')
        .select('refresh_token')
        .eq('household_id', householdId)
      if (tokenError) {
        summary.failures++
        continue
      }
      for (const token of tokens ?? []) {
        if (token?.refresh_token && (await revokeAtGoogle(deps, token.refresh_token))) {
          summary.revoked++
        }
      }

      // 2. The household.
      const { data: deleted, error: purgeError } = await asService.rpc('purge_household', {
        household_id: householdId,
      })
      if (purgeError) {
        summary.failures++
        continue
      }
      if (deleted !== true) continue // purged by another run, or no longer due
      summary.purged++

      // 3. Each sign-in left claiming nothing.
      for (const claimant of claimants) {
        const { data: others, error: othersError } = await asService
          .from('members')
          .select('id')
          .eq('claimed_by', claimant)
          .limit(1)
        if (othersError) {
          summary.failures++
          continue
        }
        if ((others ?? []).length > 0) continue // #262: still in another household
        const { error: deleteError } = await asService.auth.admin.deleteUser(claimant)
        if (deleteError) summary.failures++
        else summary.accountsDeleted++
      }
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
