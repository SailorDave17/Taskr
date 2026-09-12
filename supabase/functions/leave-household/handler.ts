// Leave a household — story #431.
//
// WHO CALLS IT. The person leaving, with their own sign-in. The body names the
// household and nothing else: WHO is leaving is `auth.uid()` off the JWT, as
// `calendar-disconnect` does it, so nobody can make somebody else leave through
// this endpoint — and `leave_household` (0043) takes no member id either.
//
// WHY A FUNCTION AT ALL (owner decision on #431). Two halves of leaving need
// powers no client holds: the refresh token behind a Google grant is readable
// only by service_role, and deleting an auth user needs `auth.admin`. The row
// itself still goes through the caller's own RPC, so the database stays the
// thing saying no about it.
//
// WHAT IT DOES, in this order, and the order is the design:
//
//   1. Refuse the organizer. They hand the household over or delete it (#430)
//      first; the RPC refuses too, and asking here first keeps a refusal from
//      costing a Google revoke.
//   2. Revoke the leaver's Google grant — `member_tokens_to_revoke`, which leaves
//      out a grant still used by their membership of another household (#430's
//      rule: one Google account holds one grant). BEFORE the leave, because the
//      member row's cascade takes the token row, and a grant nobody holds a
//      token for can never be revoked. If the tokens cannot be READ, nothing
//      happens and the person is told to try again: unlike the purge, which
//      retries tomorrow, a leave is somebody standing there, and leaving anyway
//      would orphan the grant.
//   3. `leave_household`, AS THE CALLER.
//   4. Delete their login if this household was its last claim (#262's rule).
//      Last, because deleting the account first would leave nobody to call
//      step 3 as. A failure here is reported as a warning, not an error: the
//      person HAS left, and saying otherwise invites a retry that cannot work.
//
// COUNTS ONLY in the response: no token and no other person is named.

import { GOOGLE_REVOKE_ENDPOINT } from '../calendar-disconnect/handler.ts'

/**
 * Every header supabase-js puts on a `functions.invoke` call — the same list as
 * the other functions, restated for their reason (a deploy-path constant must not
 * change silently). `src/test/edge-function-cors.test.js` checks every directory.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export interface Filterable {
  eq(column: string, value: unknown): Filterable
  limit(n: number): PromiseLike<{ data: any; error: any }>
  maybeSingle(): PromiseLike<{ data: any; error: any }>
}

/** The bits of a Supabase client this handler touches, structurally. */
export interface SupabaseLike {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } | null }>
    admin: { deleteUser(id: string): Promise<{ error: any }> }
  }
  from(table: string): { select(columns: string): Filterable }
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>
}

export interface LeaveHouseholdDeps {
  fetch: (input: string, init?: unknown) => Promise<Response>
  env: (name: string) => string | undefined
  createClient: (url: string, key: string, options?: unknown) => SupabaseLike
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

/** Says what is wrong without saying whether anybody else exists — the siblings' rule. */
function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/** Ask Google to forget one grant. Best-effort and never throws — calendar-disconnect's reason. */
async function revokeAtGoogle(deps: LeaveHouseholdDeps, refreshToken: string): Promise<boolean> {
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

/** The sentence the app shows when the person left but their sign-in survived. */
export const ACCOUNT_NOT_DELETED =
  'You have left the household, but your sign-in was not deleted. It can still sign in until it is.'

export function createHandler(deps: LeaveHouseholdDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return refuse('Sign in first.', 401)

    let body: { householdId?: string }
    try {
      body = await req.json()
    } catch {
      return refuse('Send a JSON body.', 400)
    }
    // `null` parses as JSON and `null.householdId` would escape as a bare 500
    // with no CORS headers (calendar-disconnect's guard, same reason).
    if (!body || typeof body !== 'object') return refuse('Send a JSON body.', 400)

    const householdId = String(body.householdId ?? '')
    if (!householdId) return refuse('No household was named.', 400)

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anonKey || !serviceKey) return refuse('This function is not configured.', 500)

    // ---- everything the CALLER is allowed to see and be --------------------

    const asCaller = deps.createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // Constructed here, used only after the caller-scoped checks have passed.
    const asService = deps.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller } = (await asCaller.auth.getUser()) ?? { data: null }
    const callerId = caller?.user?.id
    if (!callerId) return refuse('Sign in first.', 401)

    // Row-level security scopes this to the caller's households: a household
    // they are not in — or one pending deletion — matches nothing.
    const { data: member, error: memberError } = await asCaller
      .from('members')
      .select('id, household_id')
      .eq('claimed_by', callerId)
      .eq('household_id', householdId)
      .maybeSingle()
    if (memberError) return refuse('Could not read your roster entry.', 400)
    if (!member) return refuse('You are not a member of that household.', 403)

    // 1. The organizer hands over or deletes first. Asked as the caller, about
    //    THIS household (provision-member's #161 lesson).
    const { data: organizes, error: organizerError } = await asCaller.rpc('is_household_organizer', {
      target_household: householdId,
    })
    if (organizerError) return refuse('Could not check whether you organize this household.', 400)
    if (organizes === true) {
      return refuse('The organizer cannot leave. Hand the household over or delete it first.', 409)
    }

    // 2. The grants, before the leave's cascade takes the tokens.
    const { data: tokens, error: tokenError } = await asService.rpc('member_tokens_to_revoke', {
      member_id: member.id,
    })
    if (tokenError) {
      return refuse(
        'Could not check your calendar connection, so nothing was changed. Try leaving again.',
        503,
      )
    }
    let revoked = 0
    for (const token of tokens ?? []) {
      if (token?.refresh_token && (await revokeAtGoogle(deps, token.refresh_token))) revoked++
    }

    // 3. The leave itself, as the caller.
    const { error: leaveError } = await asCaller.rpc('leave_household', { household_id: householdId })
    if (leaveError) return refuse(`Could not leave the household: ${leaveError.message}`, 400)

    // 4. The login, where this was its last claim. Read as service_role: the
    //    caller cannot see households they are not in, and this is a
    //    blast-radius question, not an authorization one.
    const { data: others, error: othersError } = await asService
      .from('members')
      .select('id')
      .eq('claimed_by', callerId)
      .limit(1)
    if (othersError) {
      return json({ ok: true, left: true, revoked, accountDeleted: false, warning: ACCOUNT_NOT_DELETED })
    }
    if ((others ?? []).length > 0) {
      return json({ ok: true, left: true, revoked, accountDeleted: false, kept: 'claimed-elsewhere' })
    }
    const { error: deleteError } = await asService.auth.admin.deleteUser(callerId)
    if (deleteError) {
      return json({ ok: true, left: true, revoked, accountDeleted: false, warning: ACCOUNT_NOT_DELETED })
    }
    return json({ ok: true, left: true, revoked, accountDeleted: true })
  }
}
