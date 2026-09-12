// Invite, reset and revoke a member's credential — the half of #62 that needs a
// server, plus #341's invitation path. The `provision` action this function is
// named for — an organizer minting an account at a password they typed — was
// removed by #191 AC 3 (2026-09-11); the name stays because it is the deployed
// function's, in `LIVE_EDGE_FUNCTIONS`, the deploy list and every runbook step.
//
// WHY THE HANDLER IS A SEPARATE MODULE FROM `index.ts`
//
// It was not, until #341. `index.ts` calls `Deno.serve` at import time and
// imports from `npm:`, so it cannot be loaded by anything but the edge runtime —
// which is why this function's only tests were `src/test/provisioning.functions.test.js`,
// driving real HTTP against a LOCAL Supabase stack with Docker, Postgres and
// GoTrue. CI runs none of that.
//
// That was affordable while every branch here could be reached by a real local
// stack. #341 AC 4 is the branch that cannot: **the mailer refuses the send**.
// Supabase's built-in SMTP allows a handful of emails an hour, and there is no
// way to ask a local GoTrue to fail on demand — so the branch that decides
// whether an organizer is told "the sign-in was NOT created" would have been
// covered by a suite CI never runs, on a stack that will not produce it.
//
// `calendar-connect/handler.ts` made this argument first, about Google, and the
// shape is copied deliberately rather than reinvented: everything that decides
// anything lives here behind injected dependencies, and `index.ts` is the few
// lines that bind them to the platform. `handler.test.js` runs in `npm test`, on
// every push, with no network and no Docker.
//
// The move is a MOVE. Every comment below was written for the code it sits on
// and is carried across unchanged, because the authorization argument is the
// part of this file most expensive to reconstruct and the part a reader most
// needs. What #341 added was the `invite` action and a refusal of `provision`
// for a member with a real address; what #191 then removed was `provision`
// itself, once the email-less row it survived for could no longer be created.
//
// WHY THIS FUNCTION EXISTS AT ALL
//
// `supabase.auth.signUp()` signs the CALLER in as the account it creates. An
// organizer using it for a child would be signed out of their own account and
// into the child's — which is #87 AC 2, and the reason #62 shipped the organizer
// path and stopped here. Creating somebody else's account, and resetting
// somebody else's password, both need `auth.admin.*` and the `service_role` key.
// That key bypasses RLS entirely and must never reach a browser; `src/lib/keyShape.js`
// fails the client build if it ever does.
//
// THE AUTHORIZATION SHAPE, WHICH IS THE PART TO GET RIGHT
//
// This function holds a key that can do anything to anybody. So the caller's
// authority is established with a CALLER-SCOPED client — the anon key plus the
// caller's own JWT — before the service_role client is touched at all:
//
//   1. Read the target member THROUGH THE CALLER. RLS restricts `members` to the
//      caller's households, so a member id from outside them simply is not
//      found. The request body is never trusted to say which household it means.
//   2. Ask `is_household_organizer(...)` THROUGH THE CALLER — about the
//      household ON THAT MEMBER'S ROW — so the answer is about the person
//      holding the JWT, and about the household the action lands in.
//   3. Only then use service_role, and only for the things that genuinely
//      need it.
//
// Step 2 named the CALLER's first household until #161, which is a privilege
// escalation once anybody belongs to two: organise one, be an ordinary member
// of another, and the check passes for a member of the other. Measured; see the
// comment at the check itself.
//
// Doing (1) with the service_role client would be the classic hole: it bypasses
// RLS, so every member of every household would be found and the only thing
// standing between a signed-in stranger and someone else's household would be a
// check this file could get wrong. Under the shape above, getting it wrong fails
// closed — the read returns nothing.
//
// `docs/access-model.md`'s central lesson, applied to a function rather than to a
// policy: a rule enforced only inside code you provide is enforced only for
// callers who choose to call it. Here the caller-scoped read means the DATABASE
// is still the thing saying no.
//
// The authorization shape is NOT a dependency and is not injected. A test that
// could swap it out would be testing a different function; what the injection
// buys is a fake GoTrue, not a fake permission check.

// `syntheticAddressFor` stood here until #191: `<members.id>@taskr.invalid`,
// the address `provision` minted an email-less member's account at. `.invalid`
// is reserved by RFC 2606 and can never resolve, so that address has no mailbox
// by construction — which is still why a `reset` is an admin password update
// and not an emailed link (#87 AC 3), and why such a member can never be
// INVITED: #341's whole path is an email arriving. Nothing here derives the
// address any more, because nothing here mints: `reset` acts on `claimed_by`,
// and the roster's `signInAddressFor` (src/lib/household.js) is the one
// remaining copy of the rule, read back for the accounts that already exist.
// `members.email` stays NULL for those rows, and that null IS the
// discriminator 0007 established.

/**
 * Whether this member has a real inbox — the `0007` discriminator, in one place.
 *
 * Exported because more than one branch turned on it and each would otherwise
 * spell it itself: `invite` requires one, and until #191 `provision` refused
 * one (#341 AC 1) and the minting address preferred one. A predicate spelled
 * more than one way is that many chances for a copy to drift, and the drift
 * would be silent — every branch agrees with itself.
 */
export function hasRealAddress(member: { email?: string | null }): boolean {
  return typeof member.email === 'string' && member.email.trim().length > 0
}

// Every header supabase-js puts on a `functions.invoke` call — because a browser
// preflight asks about ALL of them at once, and an allow-list missing even one
// fails the whole request before it is sent. The client then reports
// `FunctionsFetchError`, whose message is "Failed to send a request to the Edge
// Function": it names no header, mentions no preflight, and reads exactly like a
// dropped connection. That sentence is what #112 was reported as.
//
// `authorization` and `content-type` are the two you would think of. The other
// two are sent whether or not you ask for them, which is why the short list
// looked complete: the client's fetch wrapper sets `apikey` on every request,
// and `X-Client-Info` is a default header on every Supabase client.
// `x-retry-count` is postgrest-js's, and is listed so this stays a SUPERSET of
// the SDK's canonical set rather than the subset we happened to notice.
//
// That canonical set ships as `@supabase/supabase-js/cors`, and
// `src/test/edge-function-cors.test.js` asserts this list still covers it — so
// an SDK release that adds a header fails the gate here rather than on a phone.
// It is deliberately NOT imported: this list is a deploy-path constant, and a
// value that must not change silently should not be resolved at deploy time.
//
// That check reads `index.ts` AND `handler.ts` and joins them, so moving this
// literal here in #341 did not need the check changed — which is the difference
// between a guard that names a file and one that names a question.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * The three actions this endpoint takes. Exported so the test cannot drift from
 * the refusal message. `provision` was the fourth until #191 removed it — an
 * organizer can no longer create a sign-in at a credential they chose, and a
 * request naming it is refused as unknown rather than answered with a reason,
 * because there is no branch left to explain.
 */
export const ACTIONS = ['invite', 'reset', 'revoke'] as const

export type Action = (typeof ACTIONS)[number]

/**
 * A minimal shape for the bits of a Supabase client this handler touches.
 *
 * Deliberately structural rather than the SDK's own types, for the reason
 * `calendar-connect` gives: the point of the injection is that the test supplies
 * a fake, and a fake that has to satisfy the whole client interface is a fake
 * nobody writes.
 *
 * Note what IS named here that this handler never calls on the caller-scoped
 * client: the whole `admin` surface. The type is one shape for both clients
 * because both are built by the same injected `createClient`, and narrowing it
 * per-role would be a type asserting an authorization rule that the ORDERING
 * above is what actually enforces. Said plainly so nobody reads the width as an
 * oversight.
 */
export interface SupabaseLike {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } | null }>
    admin: {
      // `createUser` was in this shape until #191. It is gone from the TYPE as
      // well as from the code, so a branch that reached for it again would
      // fail to compile rather than quietly mint; the test's fake still OFFERS
      // it and records it, so "no account was created" stays an assertion
      // about a client that could have.
      inviteUserByEmail(
        email: string,
        options?: { redirectTo?: string; data?: Record<string, unknown> },
      ): Promise<{ data: { user: { id: string } | null } | null; error: any }>
      updateUserById(id: string, attrs: { password?: string }): Promise<{ error: any }>
      deleteUser(id: string): Promise<{ error: any }>
    }
  }
  from(table: string): {
    select(columns: string): Filterable
    update(row: unknown): { eq(column: string, value: unknown): Promise<{ error: any }> }
  }
  rpc(name: string, args: unknown): Promise<{ data: any; error: any }>
}

/** A filter chain. `provision-member` needs `eq`, `neq`, `limit` and `maybeSingle`. */
export interface Filterable {
  eq(column: string, value: unknown): Filterable
  neq(column: string, value: unknown): Filterable
  limit(n: number): Promise<{ data: any; error: any }>
  maybeSingle(): Promise<{ data: any; error: any }>
}

export interface ProvisionMemberDeps {
  /** `Deno.env.get` in production; a plain lookup in the test. */
  env: (name: string) => string | undefined
  /** Built per request, because the caller-scoped one carries the caller's JWT. */
  createClient: (url: string, key: string, options?: unknown) => SupabaseLike
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

// A refusal says what is wrong without saying whether the member exists — the
// caller-scoped read already decided that, and echoing it back would turn this
// endpoint into a way to probe other households for valid member ids.
function refuse(message: string, status: number): Response {
  return json({ error: message }, status)
}

/**
 * Whether GoTrue is telling us the address already has an account — #341 AC 3.
 *
 * `inviteUserByEmail` refuses an address that already holds an auth user, and
 * that refusal is a DIFFERENT fact from the mailer failing: one means "this
 * person already has a sign-in, reset it", the other means "nothing happened,
 * try later". Collapsing them is how an organizer sends a second invitation to
 * somebody who already had one, or waits for an email that was never going to
 * come.
 *
 * Branched on `code` first and the message only as a fallback, which is this
 * repo's standing rule for GoTrue: `error_code` is the contract and
 * `error_description` is prose that gets reworded without versioning
 * (`readSignInReturn` in `src/lib/household.js` says the same thing about the
 * same service). The message fallback is kept because older GoTrue builds send
 * no code at all, and a missed classification here reads as a mailer fault —
 * the more alarming of the two and the wrong one.
 */
export function isAddressTakenError(error: { code?: string; status?: number; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true
  return /already (been )?registered|already exists/i.test(String(error.message ?? ''))
}

export function createHandler(deps: ProvisionMemberDeps) {
  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (req.method !== 'POST') return refuse('Use POST.', 405)

    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) {
      return refuse('Sign in first.', 401)
    }

    let body: { action?: string; memberId?: string; password?: string; redirectTo?: string }
    try {
      body = await req.json()
    } catch {
      return refuse('Send a JSON body.', 400)
    }

    const action = String(body.action ?? '') as Action
    const memberId = String(body.memberId ?? '')
    const password = String(body.password ?? '')
    const redirectTo = String(body.redirectTo ?? '')

    if (!(ACTIONS as readonly string[]).includes(action)) {
      return refuse(`action must be ${ACTIONS.map((a) => `"${a}"`).join(', ')}.`, 400)
    }
    if (!memberId) return refuse('memberId is required.', 400)
    // Supabase's own floor is 6. Stated here rather than left to the admin API so
    // the refusal is a sentence the organizer can act on. Revoke takes no
    // password: deleting a sign-in has no credential to set. Neither does invite
    // — #341's whole point is that the organizer never chooses one. So the only
    // action that takes one is the reset of a PIN account minted before #191.
    const needsPassword = action === 'reset'
    if (needsPassword && password.length < 6) {
      return refuse('That credential is too short — use at least 6 characters.', 400)
    }

    const url = deps.env('SUPABASE_URL')
    const anonKey = deps.env('SUPABASE_ANON_KEY')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anonKey || !serviceKey) {
      // Loud rather than degraded. A function missing its secret that answered
      // anyway would be the "quietly passes when unconfigured" defect this repo
      // already refuses in its RLS suite.
      return refuse('This function is not configured.', 500)
    }

    // ---- 1 & 2: everything the CALLER is allowed to see and be ---------------

    const asCaller = deps.createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Constructed here but deliberately NOT used until the caller-scoped checks
    // below have passed. Creating a client grants nothing; the ordering that
    // matters is which one answers the authorization questions.
    const asService = deps.createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: caller } = await asCaller.auth.getUser()
    if (!caller?.user) return refuse('Sign in first.', 401)

    // RLS scopes this to the caller's household. A member id from anywhere else
    // is simply not found, so the 404 below covers both "no such member" and
    // "not yours" — deliberately indistinguishable.
    //
    // `household_id` IS selected here now, and the comment that used to sit in
    // this spot said the opposite — it is a reversal rather than an addition, so
    // it says so. The column was absent from 0007's select grant for
    // `authenticated`, and a column withheld from `select` cannot even be NAMED:
    // PostgREST returns "permission denied for table members", which reads like
    // the whole table is closed rather than like one column is, and naming it
    // here once made every provision fail with a 400. `0014` grants it (#159, on
    // #157's measurement), so the trap is gone and the column is readable by the
    // caller for exactly the rows RLS already lets them see.
    //
    // Reading it is now NECESSARY, which it was not before — #161 criterion 2.
    // Until 0009 a caller had one household, so "the caller's household" and
    // "this member's household" were the same value and either would do. They are
    // different values now, and the one this function must act on is the member's.
    const { data: member, error: memberError } = await asCaller
      .from('members')
      .select('id, display_name, claimed_by, email, household_id')
      .eq('id', memberId)
      .maybeSingle()

    if (memberError) return refuse('Could not read that person.', 400)
    if (!member) return refuse('No such person in your household.', 404)

    // The household comes from the MEMBER ROW — #161 criteria 1 and 3.
    //
    // What stood here argued the opposite, and the argument is worth keeping
    // because it is the PREMISE that failed rather than the conclusion: "the read
    // above already proved this member is visible to the caller, which under
    // `members_select_joined` means same household; so the caller's own household
    // id IS the member's". Every clause of that is still true except the last.
    // Visibility means the member is in ONE OF the caller's households, and since
    // 0009 there can be more than one — so the code took
    // `current_household_ids()[0]`, whichever the database returned first, and
    // asked whether the caller organises THAT.
    //
    // *Measured 2026-08-26* against a local stack, and it is a privilege
    // escalation rather than an inconvenience: a caller who organises household A
    // and is an ordinary member of household B can see B's members, and
    // `current_household_ids()` returned `[A, B]`. `is_household_organizer(A)`
    // answered true, so the check passed and the function would have minted a
    // sign-in for somebody in B — a household this caller organises nothing in.
    // Asking about `member.household_id` instead answered false and refused, on
    // the same fixture.
    //
    // Still asked THROUGH THE CALLER, which is the part that must not change:
    // `is_household_organizer` resolves `auth.uid()` itself, so the answer is
    // about the person holding the JWT and not about this function.
    const { data: isOrganizer, error: organizerError } = await asCaller.rpc(
      'is_household_organizer',
      { target_household: member.household_id },
    )
    if (organizerError) return refuse('Could not check your permissions.', 400)
    if (isOrganizer !== true) {
      return refuse('Only the household organizer can do that.', 403)
    }

    // ---- 3: the things that genuinely need service_role ----------------------

    if (action === 'revoke') {
      // #247/#262 — the auth half of removing somebody from the roster. The
      // member ROW is deliberately NOT deleted here: the client deletes it
      // through RLS after this answers, so `members_delete_same_household`
      // (0016) stays the guard for the row — and removing somebody with no
      // sign-in never depends on this function being deployed or reachable.
      //
      // The client calls this FIRST and deletes the row second, and that order
      // is load-bearing: `members_claimed_by_fkey` is ON DELETE SET NULL, so a
      // removal that dies between the halves leaves a member with "No sign-in
      // yet" — a state the roster renders and the organizer can recover from
      // by inviting them again ("with Give a sign-in" until #191 retired the
      // mint). The other order leaves an account that can still
      // sign in with no member row naming it, which is the orphan #247 is about.
      if (!member.claimed_by) {
        // Not reset's 409. Reset needs a target to act on; revoke's goal is an
        // absence, and the absence already holds — so a removal racing another
        // device's revoke stays quiet instead of warning about an account that
        // does not exist.
        return json({
          ok: true,
          action: 'revoke',
          memberId: member.id,
          deleted: false,
          kept: 'no-sign-in',
        })
      }

      // #262's constraint. Since 0009 one person can hold member rows in TWO
      // households, claimed by ONE auth account — so deleting the account here
      // could end their access to a household this caller organizes nothing in.
      // The account goes only when THIS row is its last claim. The same rule
      // covers a member with a real email address: the account was minted for
      // the member rows that claim it, and when the last claim goes, what is
      // left is a key to nothing plus the power to start a household — exactly
      // the defect. Read as service_role, necessarily: the caller cannot see
      // other households, and this is a blast-radius question, not an
      // authorization one — authorization was the caller-scoped checks above.
      //
      // THE RACE CLAUSE THAT #341 CHANGED, AND THE PREMISE IT LOST. This used
      // to read "no write can race this check into deleting a shared account:
      // the only path that sets `claimed_by` is this function's own provision
      // branch, and it always attaches a FRESHLY created auth user, never an
      // existing one."
      //
      // **That premise is now false, and it was measured false rather than
      // reasoned about.** A first draft of this comment claimed `invite` kept it
      // true because `inviteUserByEmail` refuses an address that already has an
      // account. *Measured 2026-09-09 against a real GoTrue*, the refusal
      // depends on the state of that account:
      //
      //   - ESTABLISHED (somebody signed up with a password): refused, and
      //     `isAddressTakenError` routes it to AC 3's 409. Nothing is attached.
      //   - PENDING (invited, never accepted): the SAME auth user is returned,
      //     200, and this branch claims it onto a second member row. Two rows in
      //     two households, one account — reached with no consent step, because
      //     the person never clicked anything either time.
      //
      // So the check below is **load-bearing rather than defensive**, and that
      // is the whole reason this paragraph is worth reading: deleting the
      // account on the first revoke would end another household's access to
      // somebody who had not yet accepted either invitation. The check already
      // handled it; what was wrong was a comment asserting the situation could
      // not arise. `provisioning.functions.test.js` carries both measurements.
      const { data: otherClaims, error: otherClaimsError } = await asService
        .from('members')
        .select('id')
        .eq('claimed_by', member.claimed_by)
        .neq('id', member.id)
        .limit(1)
      if (otherClaimsError) {
        return refuse('Could not check whether that sign-in is used elsewhere.', 400)
      }
      if ((otherClaims ?? []).length > 0) {
        return json({
          ok: true,
          action: 'revoke',
          memberId: member.id,
          deleted: false,
          kept: 'claimed-elsewhere',
        })
      }

      const { error: deleteError } = await asService.auth.admin.deleteUser(member.claimed_by)
      if (deleteError) {
        return refuse(`Could not delete that sign-in: ${deleteError.message}`, 400)
      }
      return json({ ok: true, action: 'revoke', memberId: member.id, deleted: true })
    }

    if (action === 'reset') {
      if (!member.claimed_by) {
        // "provision one first" until #191; there is nothing to provision now.
        return refuse('That person has no sign-in yet — invite them first.', 409)
      }
      const { error } = await asService.auth.admin.updateUserById(member.claimed_by, {
        password,
      })
      if (error) return refuse(`Could not reset that credential: ${error.message}`, 400)
      return json({ ok: true, action: 'reset', memberId: member.id })
    }

    if (action === 'invite') {
      // #341 — the organizer never chooses a credential. `inviteUserByEmail`
      // sends the project's *Invite user* template, creates the auth user
      // unconfirmed, and confirms them when they follow the link; the link lands
      // on `redirectTo` with a session in the fragment and `type=invite`, and the
      // app asks them for a password once.
      if (member.claimed_by) {
        // Same shape as provision's 409 and for the same reason: name the state,
        // so the organizer knows the answer is "reset it" and not "try again".
        return refuse('That person already has a sign-in — reset it instead.', 409)
      }
      if (!hasRealAddress(member)) {
        // A synthetic `<id>@taskr.invalid` address has no mailbox by
        // construction, so an invitation to it can never arrive. Refused here
        // rather than sent and lost: GoTrue would accept the address and the
        // organizer would wait for an email that RFC 2606 guarantees will never
        // be delivered.
        return refuse(
          `${member.display_name} has no email address on their row — add one first, ` +
            'and the invitation goes to it.',
          409,
        )
      }
      if (!redirectTo) {
        // Derived by the client from the origin the organizer is on, never a
        // constant — a dev server has to come back to the dev server. Refused
        // rather than defaulted, because a default would send every invitation
        // to production from wherever it was pressed, and the link would work,
        // which is what makes it hard to notice.
        return refuse('redirectTo is required.', 400)
      }

      const address = member.email as string
      // #191 AC 1 — the invitation is "personalised with the typed name". The
      // name the organizer typed reaches the email as template data
      // (`{{ .Data.invited_as }}` in the *Invite user* template, which is a
      // dashboard edit and the owner's — `docs/deploy-runbook.md` §2). It is
      // deliberately NOT the person's display name and the app never reads it
      // back: the owner's decision is that the typed name personalises the
      // email only, and the person names themselves at the password screen.
      //
      // PRECONDITION (review-fanout on #191, read off GoTrue's `invite.go`):
      // `data` is applied only when the invite CREATES the account. A re-invite
      // of a PENDING address — invited by another household, never accepted —
      // returns the same user unchanged, so its metadata keeps the FIRST
      // household's typed name and the second email renders that one. Template
      // personalisation only; the person still names themselves on arrival.
      const { data: invited, error: inviteError } = await asService.auth.admin.inviteUserByEmail(
        address,
        { redirectTo, data: { invited_as: member.display_name } },
      )

      if (inviteError || !invited?.user) {
        if (isAddressTakenError(inviteError)) {
          // AC 3. The organizer must NOT read this as "the email went" — that is
          // the whole reason this is a distinct sentence rather than a generic
          // failure, and it names the route out.
          //
          // The route is a CODE, since #173 — this said "Use Reset sign-in
          // instead" from #341 until #191's review, which was wrong twice over:
          // the row's control reads *Email an invitation* (its `claimed_by` is
          // null, so every press lands here again), and a reset link would go
          // to an account that belongs to another household's roster. An
          // established account joins a second household by redeeming a code
          // as itself (#173); this refusal is where an organizer learns that.
          return refuse(
            `${address} already has a Taskr sign-in, so no invitation was sent. ` +
              'Invite them with a code instead (Who tab, "Invite somebody by code") — they join as that account.',
            409,
          )
        }
        // AC 4 — ONE fact. The mailer refused (Supabase's built-in SMTP allows a
        // handful of emails an hour), and what the organizer needs to know is
        // that nothing was created and they may try later. Anything that reads
        // as a half-created state invites them to go looking for an account that
        // is not there.
        //
        // The rollback is what makes the sentence TRUE rather than merely
        // reassuring: GoTrue creates the user and then sends, so a send that
        // fails can leave an unconfirmed account behind — and that account is
        // exactly what would make the organizer's next attempt fail on AC 3's
        // "already has a sign-in", for a person who has never signed in at all.
        if (invited?.user?.id) {
          await asService.auth.admin.deleteUser(invited.user.id)
        }
        return refuse(
          `The sign-in was not created and no email was sent to ${address} — ` +
            'the mail service refused it. Try again in a little while.',
          502,
        )
      }

      // The write the client is deliberately not granted: `claimed_by` is absent
      // from the client update grant in 0007 (#87 AC 5), so this is the only path
      // that can set it.
      const { error: claimError } = await asService
        .from('members')
        .update({ claimed_by: invited.user.id })
        .eq('id', member.id)

      if (claimError) {
        // The auth user exists but is attached to nobody. Roll it back rather
        // than leaving an orphan that makes the next invitation fail on AC 3's
        // already-registered branch — which would tell the organizer to reset a
        // sign-in that belongs to no member row.
        await asService.auth.admin.deleteUser(invited.user.id)
        return refuse('Could not attach that sign-in to the person.', 400)
      }

      return json({
        ok: true,
        action: 'invite',
        memberId: member.id,
        email: address,
        claimedBy: invited.user.id,
      })
    }

    // The `provision` branch stood here from #87 until #191 — read the member's
    // address, coalesce to `syntheticAddressFor(member.id)`, `createUser` at a
    // password the organizer typed with `email_confirm: true`, then claim the
    // row. #341 had narrowed it to the email-less row ("only until #191 retires
    // the ability to create one"), and #191 did: `addMember` requires an
    // address, so no caller for this branch can exist and the whole action
    // went, along with the password floor above for it and `createUser` from
    // the client shape. An organizer never mints anybody's credential again.
    //
    // Unreachable: `ACTIONS` was checked at the top and every action above has
    // returned. TypeScript still wants an ending return, and the same refusal
    // the unknown-action guard gives is the honest one — never a silent 200.
    return refuse(`action must be ${ACTIONS.map((a) => `"${a}"`).join(', ')}.`, 400)
  }
}
