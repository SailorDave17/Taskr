// Provision and reset a member's credential — the half of #62 that needs a server.
//
// WHY THIS EXISTS AT ALL
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
//   3. Only then use service_role, and only for the two things that genuinely
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

import { createClient } from 'npm:@supabase/supabase-js@2'

// `.invalid` is reserved by RFC 2606 and can never resolve, so a synthetic
// address has no mailbox by construction — which is why a reset is an admin
// password update and not an emailed link (#87 AC 3).
//
// Derived from `members.id`, never stored: `members.email` stays NULL for a
// member without a real address, and that null IS the discriminator 0007
// established. Storing the synthetic address would destroy the distinction
// between "has a real inbox" and "does not".
function syntheticAddressFor(memberId: string): string {
  return `${memberId}@taskr.invalid`
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
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return refuse('Use POST.', 405)

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) {
    return refuse('Sign in first.', 401)
  }

  let body: { action?: string; memberId?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return refuse('Send a JSON body.', 400)
  }

  const action = String(body.action ?? '')
  const memberId = String(body.memberId ?? '')
  const password = String(body.password ?? '')

  if (action !== 'provision' && action !== 'reset') {
    return refuse('action must be "provision" or "reset".', 400)
  }
  if (!memberId) return refuse('memberId is required.', 400)
  // Supabase's own floor is 6. Stated here rather than left to the admin API so
  // the refusal is a sentence the organizer can act on.
  if (password.length < 6) {
    return refuse('That credential is too short — use at least 6 characters.', 400)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) {
    // Loud rather than degraded. A function missing its secret that answered
    // anyway would be the "quietly passes when unconfigured" defect this repo
    // already refuses in its RLS suite.
    return refuse('This function is not configured.', 500)
  }

  // ---- 1 & 2: everything the CALLER is allowed to see and be -----------------

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Constructed here but deliberately NOT used until the caller-scoped checks
  // below have passed. Creating a client grants nothing; the ordering that
  // matters is which one answers the authorization questions.
  const asService = createClient(url, serviceKey, {
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

  // ---- 3: the two things that genuinely need service_role --------------------

  if (action === 'reset') {
    if (!member.claimed_by) {
      return refuse('That person has no sign-in yet — provision one first.', 409)
    }
    const { error } = await asService.auth.admin.updateUserById(member.claimed_by, {
      password,
    })
    if (error) return refuse(`Could not reset that credential: ${error.message}`, 400)
    return json({ ok: true, action: 'reset', memberId: member.id })
  }

  // provision
  if (member.claimed_by) {
    // Not an error worth failing on silently — say which state we are in, so the
    // organizer knows the answer is "use reset" rather than "try again".
    return refuse('That person already has a sign-in — reset it instead.', 409)
  }

  // A member with a REAL address signs in with it; one without gets the
  // synthetic form. `member.email` is null for everybody the Edge Function
  // provisions, which is exactly what 0007 says the column means.
  const address = member.email ?? syntheticAddressFor(member.id)

  const { data: created, error: createError } = await asService.auth.admin.createUser({
    email: address,
    password,
    // No inbox exists for a synthetic address, so a confirmation mail could
    // never be answered. Confirming at creation is the only workable state.
    email_confirm: true,
  })
  if (createError || !created?.user) {
    return refuse(`Could not create that sign-in: ${createError?.message ?? 'unknown'}`, 400)
  }

  // The write the client is deliberately not granted: `claimed_by` is absent
  // from the client update grant in 0007 (#87 AC 5), so this is the only path
  // that can set it.
  const { error: claimError } = await asService
    .from('members')
    .update({ claimed_by: created.user.id })
    .eq('id', member.id)

  if (claimError) {
    // The auth user exists but is attached to nobody. Roll it back rather than
    // leaving an orphan that makes the next provision fail on a duplicate
    // address with no way for the organizer to see why.
    await asService.auth.admin.deleteUser(created.user.id)
    return refuse('Could not attach that sign-in to the person.', 400)
  }

  return json({
    ok: true,
    action: 'provision',
    memberId: member.id,
    email: address,
    claimedBy: created.user.id,
  })
})
