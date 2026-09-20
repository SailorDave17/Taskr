// Delete your own account — story #432.
//
// WHO CALLS IT. The person whose sign-in goes, with their own JWT. The body is
// not read: WHO is deleted is `auth.uid()` off the token, as `leave-household`
// does it, so one account cannot delete another through this endpoint (AC 4),
// and there is no id to get wrong.
//
// WHY A FUNCTION AT ALL. Deleting an auth user needs `auth.admin`, and the
// refresh token behind a Google grant is readable only by service_role. Nothing
// a client holds can do either, and `provision-member` is an organizer's tool
// aimed at OTHER rows — the owner decided on #427 that self-service deletion is
// a separate function.
//
// WHY IMMEDIATE, when a household gets seven days (owner decision at #432's
// pickup, 2026-09-19). The grace period already applies wherever there is
// something to restore: an organizer deletes the household and the purge
// deletes their sign-in when the period ends; a member leaves, and
// `leave-household` deletes a last-claim sign-in on the spot (#431). What is
// left for this function is a sign-in in NO live household, which holds
// nothing but the auth row. There is nothing to bring back, and signing up
// again costs a minute. The confirm says it is immediate.
//
// WHAT IT DOES, in this order, and the order is the design:
//
//   1. Refuse while a LIVE household still claims the caller. Read AS THE
//      CALLER: row-level security answers through `current_household_ids()`,
//      which since `0042` leaves out a household pending deletion — so a row
//      that comes back is one in a household the person can still leave, and
//      leaving is the route (the organizer hands it over or deletes it).
//      Leaving the last one deletes the sign-in anyway, which is why this
//      function does not do the leaving too.
//   2. Read the rows that still claim the caller AS SERVICE_ROLE. After step 1
//      these can only be in households pending deletion — the ones the leave
//      path refuses (0043's reasoning) and the purge would otherwise reach
//      first. A person deleting their account is not going to wait for it.
//   3. Revoke the Google grant behind each of those rows, through
//      `member_tokens_to_revoke` (keyed on the Google account since `0047`,
//      #474), BEFORE the sign-in goes. Not because the delete takes the token
//      row — `members_claimed_by_fkey` is ON DELETE SET NULL, so the member row
//      and its token outlive the account — but because after it nobody can
//      come back to press Disconnect, and the purge's later revoke is only as
//      good as a cron the owner has to configure. If the tokens cannot be READ,
//      nothing happens and the person is told to try again, `leave-household`'s
//      reason: deleting anyway would leave a grant live at Google with nobody
//      able to revoke it. A revoke Google REFUSES or cannot be reached does not
//      stop the delete (calendar-disconnect's reason: it is usually a grant
//      already gone), but the response says so — `revokeFailed` — and the app
//      turns that into #99's sentence.
//   4. `auth.admin.deleteUser(callerId)`. Last, and only once every read above
//      succeeded, so a failure anywhere before it leaves the account exactly as
//      it was and the person can try again.
//
// WHAT THIS DOES NOT DO. It never touches a row in `public`: the member rows in
// a pending household stay, unclaimed, until the purge cascades them, exactly
// as a removed member's do. #262's other-claims rule does not apply — the
// caller is deleting their OWN account, and the only question is whether a
// live household still needs them, which step 1 answers.
//
// THE GOOGLE SIGN-IN GRANT is out of reach, and the confirm says so: Taskr
// asks for no offline access on sign-in and stores no token for it, so only
// the calendar grants can be revoked from here. The person removes Taskr from
// their Google account's third-party access themselves.
//
// COUNTS ONLY in the response: no token, no household and no other person is
// named, because a response body can end up in a log.

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

/** A filtered read that is awaitable as it stands, or bounded with `limit`. */
export interface MemberRead extends PromiseLike<{ data: any; error: any }> {
  eq(column: string, value: unknown): MemberRead
  limit(n: number): PromiseLike<{ data: any; error: any }>
}

/** The bits of a Supabase client this handler touches, structurally. */
export interface SupabaseLike {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } | null }>
    admin: { deleteUser(id: string): Promise<{ error: any }> }
  }
  from(table: string): { select(columns: string): MemberRead }
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }>
}

export interface DeleteAccountDeps {
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

/** The sentence a person still in a household reads. The app routes them to Leave. */
export const STILL_IN_A_HOUSEHOLD =
  'You are still in a household. Leave it first — or hand it over or delete it, if you organize it — and your sign-in goes when you leave the last one.'

/** Ask Google to forget one grant. Best-effort and never throws — calendar-disconnect's reason. */
async function revokeAtGoogle(deps: DeleteAccountDeps, refreshToken: string): Promise<boolean> {
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

export function createHandler(deps: DeleteAccountDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return refuse('Sign in first.', 401)

    // The body is deliberately never read: there is nothing in it this
    // function may act on. See the header.

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anonKey || !serviceKey) return refuse('This function is not configured.', 500)

    // ---- everything the CALLER is allowed to see and be --------------------

    const asCaller = deps.createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // Constructed here, used only after the caller-scoped check has passed.
    const asService = deps.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller } = (await asCaller.auth.getUser()) ?? { data: null }
    const callerId = caller?.user?.id
    if (!callerId) return refuse('Sign in first.', 401)

    // 1. A live household that still claims them. Row-level security scopes
    //    this read to households that are not pending deletion, so anything
    //    that comes back is one they can leave.
    const { data: live, error: liveError } = await asCaller
      .from('members')
      .select('id')
      .eq('claimed_by', callerId)
      .limit(1)
    if (liveError) return refuse('Could not read your roster entries.', 400)
    if ((live ?? []).length > 0) return refuse(STILL_IN_A_HOUSEHOLD, 409)

    // ---- the things that genuinely need service_role -----------------------

    // 2. The rows that still claim them: after step 1, only in households
    //    pending deletion. A blast-radius read, not an authorization one.
    const { data: pending, error: pendingError } = await asService
      .from('members')
      .select('id')
      .eq('claimed_by', callerId)
    if (pendingError) {
      return refuse(
        'Could not check your remaining memberships, so your account was not deleted. Try again.',
        503,
      )
    }

    // 3. The grants, before the person who could revoke them is gone.
    let attempted = 0
    let revoked = 0
    for (const row of pending ?? []) {
      const { data: tokens, error: tokenError } = await asService.rpc('member_tokens_to_revoke', {
        member_id: row.id,
      })
      if (tokenError) {
        return refuse(
          'Could not check your calendar connection, so your account was not deleted. Try again.',
          503,
        )
      }
      for (const token of tokens ?? []) {
        if (!token?.refresh_token) continue
        attempted++
        if (await revokeAtGoogle(deps, token.refresh_token)) revoked++
      }
    }
    // `attempted` beside `revoked`, so a refused or unreachable revoke is not
    // read as "there was nothing to revoke" — leave-household's reason.
    const revokeFailed = revoked < attempted

    // 4. The sign-in. Last, so every failure above leaves it untouched.
    const { error: deleteError } = await asService.auth.admin.deleteUser(callerId)
    if (deleteError) {
      return refuse(`Could not delete your sign-in: ${deleteError.message}`, 500)
    }
    return json({
      ok: true,
      deleted: true,
      revoked,
      revokeFailed,
      pendingHouseholds: (pending ?? []).length,
    })
  }
}
