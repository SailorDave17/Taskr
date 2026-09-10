// #87 — the Edge Function, exercised against a REAL Supabase stack.
//
// WHY THIS FILE IS NOT `npm test`, AND NOT `test:rls` EITHER
//
// It needs three things CI does not have and the live project must not be used
// for: a running Postgres, a running GoTrue, and a `service_role` key. So it runs
// against the LOCAL stack (`npx supabase start`), which ships fixed, publicly
// documented keys that are identical on every machine and grant nothing anywhere
// else. Nothing here ever points at the hosted project — provisioning creates
// auth users, and doing that against production to satisfy a test would be the
// tail wagging the dog.
//
// It is a separate runner from `npm run test:rls` because that config includes
// every `*.integration.test.js`, and `rls.integration.test.js` still targets the
// model #62 retired — it fails at setup by design until #88 migrates it. Pulling
// a known-red suite into this story's evidence would make this file's result
// unreadable.
//
// LOUD, NEVER SKIPPED. If the stack is not up, every test here fails with a
// sentence telling you to start it. A suite that quietly skips when its
// dependency is absent passes vacuously, which is the exact defect
// `docs/ci-gate.md` exists to prevent and the reason `test:rls` is loud too.

import { execSync } from 'node:child_process'
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// The local stack's published defaults. Overridable so the same file can be
// pointed at a scratch project, but never defaulted to anything hosted.
const URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const FUNCTION_URL = `${URL}/functions/v1/provision-member`

/**
 * The local stack's privileged key, ASKED FOR rather than written down — #161.
 *
 * Every other key in this file is a published local default, safe to embed
 * because it grants nothing anywhere but a stack on this machine. This one is
 * the same in fact, and is still not written down: `src/test/gate.test.js`
 * refuses a secret key NAME anywhere under `src/`, and a service-role JWT is
 * precisely the shape that guard exists to keep out of this tree. It cannot
 * currently see a raw JWT, so embedding one would widen a hole the guard is
 * blind to rather than break a rule it enforces — which is worse, not better.
 *
 * So it is read from the CLI at run time. That costs one subprocess and adds no
 * new precondition: this suite already refuses to run without the local stack,
 * and a stack that is up can always answer this.
 */
let serviceKey = null

function serviceClient() {
  return createClient(URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** A fresh anonymous-capable client with no session of its own. */
function freshClient() {
  return createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

let unique = 0
function uniqueEmail(label) {
  unique += 1
  return `${label}-${Date.now()}-${unique}@example.com`
}

/** Call the function as a given access token (or with none at all). */
async function callFunction(accessToken, body) {
  const headers = { apikey: ANON_KEY, 'content-type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  return { status: response.status, body: payload }
}

beforeAll(async () => {
  let reachable = false
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    // Any answered request proves it is serving. 404 means the function is not
    // deployed to the local runtime, which is a different failure from the
    // stack being down and gets its own sentence.
    reachable = response.status !== 404
    if (response.status === 404) {
      throw new Error(
        `The local stack is up but provision-member is not served at ${FUNCTION_URL}. ` +
          'Run `npx supabase functions serve --no-verify-jwt` in another terminal.',
      )
    }
  } catch (cause) {
    if (!reachable) {
      throw new Error(
        `Cannot reach the local Supabase Edge Function at ${FUNCTION_URL}. ` +
          'Start it with `npx supabase start` and `npx supabase functions serve --no-verify-jwt`. ' +
          'This suite deliberately fails rather than skipping, because a security test ' +
          `that skips when unconfigured passes vacuously. (${cause.message})`,
      )
    }
  }

  // Resolved here rather than at module scope so a failure names the stack
  // rather than arriving as an unreadable import-time crash.
  serviceKey = process.env.SUPABASE_LOCAL_SECRET ?? null
  if (!serviceKey) {
    try {
      const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }))
      serviceKey = status.SERVICE_ROLE_KEY
    } catch (cause) {
      throw new Error(
        'Could not read the privileged key for the local stack from `npx supabase status -o json`. ' +
          'Set SUPABASE_LOCAL_SECRET to override. ' +
          `One fixture below needs it, and is loud rather than skipped. (${cause.message})`,
      )
    }
  }
  expect(serviceKey, 'the local stack reported no service_role key').toBeTruthy()
}, 120_000)

/**
 * One household with an organizer and one unprovisioned member.
 *
 * Built through the ordinary client surface rather than by seeding SQL, so the
 * fixture is a state the app can actually reach — a fixture the database cannot
 * produce is the failure mode #36 already paid for here.
 */
async function makeHousehold() {
  const organizer = freshClient()
  const organizerEmail = uniqueEmail('organizer')
  const organizerPassword = 'organizer-secret-1'

  const { data: signUp, error: signUpError } = await organizer.auth.signUp({
    email: organizerEmail,
    password: organizerPassword,
  })
  expect(signUpError, `organizer signup failed: ${signUpError?.message}`).toBeNull()
  expect(signUp.session, 'organizer signup returned no session').toBeTruthy()

  // The household comes back from the RPC, which is `security definer` and so
  // returns the row regardless of table grants.
  //
  // THAT DETOUR IS NOT A STYLE CHOICE. Reading it the way the app does —
  // `from('households').select('*')` — fails outright on a database built from
  // these migrations: no migration ever grants `authenticated` SELECT on
  // `households`, at table or column level. Measured 2026-08-13 against a fresh
  // local stack with 0001-0007 applied. See the finding filed for it; this
  // fixture routes around it so #87's evidence is about #87, and the workaround
  // is flagged here rather than left looking deliberate.
  const { data: household, error: createError } = await organizer.rpc('create_household', {
    household_name: `TEST ${Date.now()}`,
    organizer_name: 'Organizer',
    household_timezone: 'UTC',
  })
  expect(createError, `create_household failed: ${createError?.message}`).toBeNull()
  expect(household?.id, 'create_household returned no household row').toBeTruthy()

  const addMember = async (displayName, weeklyMinutes) => {
    const { data, error } = await organizer
      .from('members')
      .insert({ household_id: household.id, display_name: displayName, weekly_minutes: weeklyMinutes })
      .select('id, display_name, claimed_by, email')
      .single()
    expect(error, `adding ${displayName} failed: ${error?.message}`).toBeNull()
    return data
  }

  const member = await addMember('Kid', 60)

  return {
    organizer,
    organizerEmail,
    organizerPassword,
    organizerToken: signUp.session.access_token,
    household,
    addMember,
    member,
  }
}

describe('#87 — provisioning a member, against a real stack', () => {
  it('AC 2 — provisions a member WITHOUT signing the organizer out', async () => {
    const h = await makeHousehold()

    // Pin the identity before the call, so "unchanged" is a comparison and not
    // an assumption. This is the exact failure signUp() would cause and the
    // whole reason the function exists.
    const { data: before } = await h.organizer.auth.getUser()
    expect(before.user.email).toBe(h.organizerEmail)

    const result = await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })
    expect(result.status, `provision failed: ${JSON.stringify(result.body)}`).toBe(200)
    expect(result.body.ok).toBe(true)

    const { data: after } = await h.organizer.auth.getUser()
    expect(after.user.id, 'the organizer was signed out or swapped').toBe(before.user.id)
    expect(after.user.email).toBe(h.organizerEmail)
  })

  it('AC 4 — members.email stays NULL and the address is derived from members.id', async () => {
    const h = await makeHousehold()

    const result = await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })
    expect(result.status).toBe(200)

    // Derived, not stored. The null is the discriminator 0007 established
    // between "has a real inbox" and "does not", and storing the synthetic
    // address would destroy it.
    expect(result.body.email).toBe(`${h.member.id}@taskr.invalid`)

    const { data: row } = await h.organizer
      .from('members')
      .select('email, claimed_by')
      .eq('id', h.member.id)
      .single()
    expect(row.email, 'a synthetic address was written into members.email').toBeNull()
    expect(row.claimed_by, 'claimed_by was not set').toBe(result.body.claimedBy)
  })

  it('the provisioned member can actually sign in with that address', async () => {
    const h = await makeHousehold()
    await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })

    // The claim the other assertions cannot make: a row saying `claimed_by` is
    // set is not the same as a person being able to get in.
    const kid = freshClient()
    const { data, error } = await kid.auth.signInWithPassword({
      email: `${h.member.id}@taskr.invalid`,
      password: 'kid-secret-1',
    })
    expect(error, `the provisioned member could not sign in: ${error?.message}`).toBeNull()
    expect(data.session).toBeTruthy()
  })

  it('AC 3 — an organizer resets a credential with no inbox involved', async () => {
    const h = await makeHousehold()
    await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })

    const reset = await callFunction(h.organizerToken, {
      action: 'reset',
      memberId: h.member.id,
      password: 'kid-secret-2',
    })
    expect(reset.status, `reset failed: ${JSON.stringify(reset.body)}`).toBe(200)

    const address = `${h.member.id}@taskr.invalid`
    const withNew = await freshClient().auth.signInWithPassword({
      email: address,
      password: 'kid-secret-2',
    })
    expect(withNew.error, 'the new credential does not work').toBeNull()

    // POSITIVE CONTROL for the reset: without this, a reset that changed
    // nothing would pass the assertion above.
    const withOld = await freshClient().auth.signInWithPassword({
      email: address,
      password: 'kid-secret-1',
    })
    expect(withOld.error, 'the OLD credential still works — the reset did nothing').toBeTruthy()
  })

  it('AC 5 — the client cannot write claimed_by, even as the organizer', async () => {
    const h = await makeHousehold()
    const { error } = await h.organizer
      .from('members')
      .update({ claimed_by: '00000000-0000-0000-0000-000000000000' })
      .eq('id', h.member.id)

    expect(error, 'a client wrote claimed_by — the column grant has widened').toBeTruthy()
    // Column grant, not row policy. Both refuse with 42501, so the message is
    // the only discriminator — the distinction #45 established here.
    expect(error.message).toMatch(/permission denied/i)
  })

  it('POSITIVE CONTROL — the organizer CAN write the columns they are granted', async () => {
    // Without this, the assertion above is satisfied by a table nobody can
    // write at all, and the suite would read as proof of security.
    const h = await makeHousehold()
    const { error } = await h.organizer
      .from('members')
      .update({ display_name: 'Kid renamed' })
      .eq('id', h.member.id)
    expect(error, `the organizer cannot rename a member: ${error?.message}`).toBeNull()
  })

  it('refuses a caller who is not the organizer', async () => {
    const h = await makeHousehold()
    await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })

    const kid = freshClient()
    const { data: kidSession } = await kid.auth.signInWithPassword({
      email: `${h.member.id}@taskr.invalid`,
      password: 'kid-secret-1',
    })

    // A second member for the kid to try to provision — the kid is in the
    // household, so RLS lets them SEE this row. Only the organizer check stands
    // between them and creating an account for somebody else.
    const sibling = await h.addMember('Sibling', 30)

    const result = await callFunction(kidSession.session.access_token, {
      action: 'provision',
      memberId: sibling.id,
      password: 'sibling-secret-1',
    })
    expect(result.status, 'a non-organizer provisioned an account').toBe(403)
  })

  it('refuses a member of ANOTHER household, without revealing they exist', async () => {
    const mine = await makeHousehold()
    const theirs = await makeHousehold()

    const result = await callFunction(mine.organizerToken, {
      action: 'provision',
      memberId: theirs.member.id,
      password: 'stranger-secret-1',
    })

    // 404, not 403: the caller-scoped read never found the row, so the function
    // cannot distinguish "not yours" from "does not exist" — and neither can
    // the caller, which is the point. A 403 here would confirm the id is real.
    expect(result.status).toBe(404)

    const { data: untouched } = await theirs.organizer
      .from('members')
      .select('claimed_by')
      .eq('id', theirs.member.id)
      .single()
    expect(untouched.claimed_by, 'a stranger provisioned into another household').toBeNull()
  })

  it('#161 — refuses a member of a household the caller is IN but does not ORGANISE', async () => {
    // The escalation, which the test above does not reach. That one uses a
    // household the caller is not in AT ALL, so the caller-scoped read finds
    // nothing and the 404 is decided before any organizer question is asked.
    //
    // Here the caller CAN see the target: they are an ordinary member of that
    // household. Everything the old code checked passed — the member row was
    // visible, and the caller really does organise A — because it asked whether
    // the caller organises `current_household_ids()[0]` rather than whether they
    // organise the household the TARGET is in.
    const mine = await makeHousehold()
    const theirs = await makeHousehold()

    // Putting the caller on the other roster needs `service_role`, and that is
    // not a shortcut — but the reason it is not changed under #341 and the old
    // one is worth not re-deriving. This used to read "there is NO public path
    // that attaches an EXISTING auth user to a second member row". Since #341
    // there is one, and it is measured in this file: *re-inviting a PENDING
    // address returns the same account rather than a second one* claims an
    // existing auth user onto a member row in another household, 200.
    //
    // It stays out of reach HERE because the caller's account is ESTABLISHED —
    // `makeHousehold` signs up with a password — and `inviteUserByEmail` refuses
    // an address in that state, measured in the test above this one. So the
    // fixture still needs `service_role` to reach the state, which is why #161
    // lands before the affordance that makes it reachable rather than after.
    // #168 recorded the gap and was retired superseded; #191 records the half
    // that is left.
    const { data: identity } = await mine.organizer.auth.getUser()
    const housemate = await theirs.addMember('Housemate', 60)
    const svc = serviceClient()
    const { error: attachError } = await svc
      .from('members')
      .update({ claimed_by: identity.user.id })
      .eq('id', housemate.id)
    expect(attachError, `attaching the caller to the second household failed: ${attachError?.message}`).toBeNull()

    // PRECONDITION, asserted rather than assumed. The defect needs the caller's
    // OWN household to be the one `current_household_ids()` happens to return
    // first — that unordered pick is the whole bug — so if this ever stops
    // holding, the fixture has stopped reproducing the escalation and this test
    // must fail LOUDLY rather than pass for the wrong reason.
    const { data: ids } = await mine.organizer.rpc('current_household_ids')
    expect(ids, 'the caller should now be in both households').toContain(theirs.household.id)
    expect(
      ids[0],
      'fixture no longer reproduces the escalation ordering — re-derive it before trusting this test',
    ).toBe(mine.household.id)

    const result = await callFunction(mine.organizerToken, {
      action: 'provision',
      memberId: theirs.member.id,
      password: 'escalation-secret-1',
    })

    // 403 and not 404: the caller may legitimately SEE this person, so the read
    // succeeded and it is the organizer check that refuses. Different from the
    // test above on purpose, and the difference is the story.
    expect(result.status, `expected a refusal, got ${JSON.stringify(result.body)}`).toBe(403)
    expect(result.body.error).toMatch(/only the household organizer/i)

    const { data: untouched } = await svc
      .from('members')
      .select('claimed_by')
      .eq('id', theirs.member.id)
      .single()
    expect(
      untouched.claimed_by,
      'a non-organizer minted a sign-in for somebody in a household they merely belong to',
    ).toBeNull()
  })

  it('refuses provisioning twice, and says to reset instead', async () => {
    const h = await makeHousehold()
    await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })
    const again = await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-9',
    })
    expect(again.status).toBe(409)
    expect(again.body.error).toMatch(/reset/i)
  })

  it('refuses a reset for somebody who has no sign-in yet', async () => {
    const h = await makeHousehold()
    const result = await callFunction(h.organizerToken, {
      action: 'reset',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/no sign-in yet/i)
  })
})

describe('#247 — revoking a sign-in when a member is removed', () => {
  it('AC 1 — the whole removal, end to end: the account is deleted and cannot sign in', async () => {
    const h = await makeHousehold()
    const provisioned = await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })
    expect(provisioned.status, `provision failed: ${JSON.stringify(provisioned.body)}`).toBe(200)
    const authId = provisioned.body.claimedBy
    const address = `${h.member.id}@taskr.invalid`

    // POSITIVE CONTROL, inside this test rather than borrowed from a sibling:
    // the credential works BEFORE the revoke, so the refusal below is the
    // revoke's doing and not a broken fixture's.
    const before = await freshClient().auth.signInWithPassword({
      email: address,
      password: 'kid-secret-1',
    })
    expect(before.error, `the account never worked: ${before.error?.message}`).toBeNull()

    // The client's sequence, in the client's order: auth half first. No
    // password travels with a revoke.
    const revoked = await callFunction(h.organizerToken, {
      action: 'revoke',
      memberId: h.member.id,
    })
    expect(revoked.status, `revoke failed: ${JSON.stringify(revoked.body)}`).toBe(200)
    expect(revoked.body.deleted).toBe(true)

    // Gone by the admin API's account of it...
    const after = await serviceClient().auth.admin.getUserById(authId)
    expect(after.data?.user ?? null, 'the auth user still exists after revoke').toBeNull()

    // ...and by the door itself.
    const attempt = await freshClient().auth.signInWithPassword({
      email: address,
      password: 'kid-secret-1',
    })
    expect(attempt.error, 'a revoked account can still sign in').toBeTruthy()

    // The FK released the row (ON DELETE SET NULL) — the state the ordering
    // note calls recoverable — and the row half then completes through RLS,
    // exactly as the client does it.
    const { data: released } = await h.organizer
      .from('members')
      .select('claimed_by')
      .eq('id', h.member.id)
      .single()
    expect(released.claimed_by, 'the member row still claims the deleted user').toBeNull()

    await h.organizer.from('members').delete().eq('id', h.member.id)
    // Verified through service_role: an RLS-refused delete removes 0 rows and
    // reports NO error, so the client's own error is not evidence here.
    const { data: goneRow } = await serviceClient()
      .from('members')
      .select('id')
      .eq('id', h.member.id)
      .maybeSingle()
    expect(goneRow, 'the member row survived the removal').toBeNull()
  })

  it('#262 — keeps the account when another household still claims it', async () => {
    const mine = await makeHousehold()
    const theirs = await makeHousehold()
    const provisioned = await callFunction(mine.organizerToken, {
      action: 'provision',
      memberId: mine.member.id,
      password: 'kid-secret-1',
    })
    expect(provisioned.status).toBe(200)
    const authId = provisioned.body.claimedBy

    // The same service-role attach the #161 fixture uses: no public path
    // creates the one-person-two-households claim today, which is exactly why
    // the guard has to exist before the affordance that will.
    const other = await theirs.addMember('Housemate', 30)
    const svc = serviceClient()
    const { error: attachError } = await svc
      .from('members')
      .update({ claimed_by: authId })
      .eq('id', other.id)
    expect(attachError, `attaching the second claim failed: ${attachError?.message}`).toBeNull()

    const revoked = await callFunction(mine.organizerToken, {
      action: 'revoke',
      memberId: mine.member.id,
    })
    expect(revoked.status, `revoke failed: ${JSON.stringify(revoked.body)}`).toBe(200)
    expect(revoked.body.deleted).toBe(false)
    expect(revoked.body.kept).toBe('claimed-elsewhere')

    // The account survives: the other household's access was never this
    // organizer's to end.
    const still = await freshClient().auth.signInWithPassword({
      email: `${mine.member.id}@taskr.invalid`,
      password: 'kid-secret-1',
    })
    expect(still.error, `the shared account was deleted: ${still.error?.message}`).toBeNull()
    const { data: otherRow } = await svc
      .from('members')
      .select('claimed_by')
      .eq('id', other.id)
      .single()
    expect(otherRow.claimed_by, "the other household's claim was disturbed").toBe(authId)
  })

  it('AC 3 (function half) — a member with no sign-in revokes as a quiet ok, not an error', async () => {
    // The client never calls this for an unclaimed member; this covers the
    // race where another device revoked first. The goal is an absence and the
    // absence holds, so the answer is ok — reset's 409 shape would surface a
    // scary warning about an account that does not exist.
    const h = await makeHousehold()
    const result = await callFunction(h.organizerToken, {
      action: 'revoke',
      memberId: h.member.id,
    })
    expect(result.status, `revoke refused: ${JSON.stringify(result.body)}`).toBe(200)
    expect(result.body.deleted).toBe(false)
    expect(result.body.kept).toBe('no-sign-in')
  })

  it('refuses a revoke from a non-organizer, and the account survives', async () => {
    const h = await makeHousehold()
    await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'kid-secret-1',
    })
    const sibling = await h.addMember('Sibling', 30)
    await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: sibling.id,
      password: 'sibling-secret-1',
    })

    const kid = freshClient()
    const { data: kidSession } = await kid.auth.signInWithPassword({
      email: `${h.member.id}@taskr.invalid`,
      password: 'kid-secret-1',
    })

    const result = await callFunction(kidSession.session.access_token, {
      action: 'revoke',
      memberId: sibling.id,
    })
    expect(result.status, "a non-organizer deleted somebody's sign-in").toBe(403)

    const still = await freshClient().auth.signInWithPassword({
      email: `${sibling.id}@taskr.invalid`,
      password: 'sibling-secret-1',
    })
    expect(still.error, 'the refused revoke deleted the account anyway').toBeNull()
  })

  it("refuses a revoke aimed at another household's member, without revealing they exist", async () => {
    const mine = await makeHousehold()
    const theirs = await makeHousehold()
    await callFunction(theirs.organizerToken, {
      action: 'provision',
      memberId: theirs.member.id,
      password: 'kid-secret-1',
    })

    const result = await callFunction(mine.organizerToken, {
      action: 'revoke',
      memberId: theirs.member.id,
    })
    // 404, same as provision's shape: the caller-scoped read never found the
    // row, so "not yours" and "does not exist" stay indistinguishable.
    expect(result.status).toBe(404)

    const still = await freshClient().auth.signInWithPassword({
      email: `${theirs.member.id}@taskr.invalid`,
      password: 'kid-secret-1',
    })
    expect(still.error, "a stranger revoked another household's sign-in").toBeNull()
  })
})

// #341 — the invitation path, against the REAL stack.
//
// `handler.test.js` covers every branch of this action with no network, and is
// where the mailer-refusal and address-taken branches are proven, because no
// local GoTrue will produce either on demand. This file exists for the two
// things that fake cannot answer:
//
//   1. **Whether GoTrue really refuses an address that already holds an account.**
//      AC 3's entire refusal branch rests on that, and until this suite ran it
//      was a claim read out of Supabase's documentation. `handler.test.js` says
//      so in its own header. Here it is exercised against a real GoTrue.
//   2. **Whether the function still works at all after #341 split it.** The
//      authorization shape moved from `index.ts` to `handler.ts` — 346 lines,
//      on the one function in this repo holding a key that bypasses row-level
//      security. A move is supposed to change nothing, and nothing is exactly
//      what a unit test with a fake client cannot check: the fake answers
//      whatever this file tells it to, and RLS is what the move must not have
//      lost. Every test in this suite passing IS that evidence.
describe('#341 — inviting a member, against a real stack', () => {
  /**
   * A member row carrying a REAL address, which is what the invite path needs.
   *
   * `makeHousehold`'s own `addMember` deliberately inserts none — every #87
   * fixture is the email-less member the PIN path is for — so this adds the
   * column here rather than widening a helper six other tests depend on.
   */
  async function addMemberWithEmail(h, displayName, email) {
    const { data, error } = await h.organizer
      .from('members')
      .insert({
        household_id: h.household.id,
        display_name: displayName,
        weekly_minutes: 60,
        email,
      })
      .select('id, display_name, claimed_by, email')
      .single()
    expect(error, `adding ${displayName} failed: ${error?.message}`).toBeNull()
    expect(data.email, 'the address did not land on the row').toBe(email)
    return data
  }

  it('AC 1 — invites a member with an address, and claims their row', async () => {
    const h = await makeHousehold()
    const address = uniqueEmail('invited')
    const member = await addMemberWithEmail(h, 'Placeholder One', address)

    const { status, body } = await callFunction(h.organizerToken, {
      action: 'invite',
      memberId: member.id,
      redirectTo: 'http://localhost:5173',
    })

    expect(status, `invite failed: ${JSON.stringify(body)}`).toBe(200)
    expect(body).toMatchObject({ ok: true, action: 'invite', memberId: member.id, email: address })
    expect(body.claimedBy, 'no auth user was attached').toBeTruthy()

    // Read the row back through the ORGANIZER, so this is the state the app
    // would see rather than the payload the function chose to report.
    const { data: after } = await h.organizer
      .from('members')
      .select('id, claimed_by')
      .eq('id', member.id)
      .single()
    expect(after.claimed_by).toBe(body.claimedBy)
  })

  it('AC 3 MEASURED — a real GoTrue refuses an address that already has an ESTABLISHED account', async () => {
    // THE POINT OF THIS FILE, and the word ESTABLISHED is load-bearing.
    // Everything downstream of AC 3 assumes `inviteUserByEmail` refuses rather
    // than returning the existing user, and until this ran it was a claim read
    // out of Supabase's documentation.
    //
    // *Measured 2026-09-09 against a local GoTrue*, and it turns on the state of
    // the existing account, which the criterion does not distinguish and which
    // the first draft of this test got wrong:
    //
    //   - an account somebody has REGISTERED (signed up with a password) is
    //     REFUSED — 409, this branch, what AC 3 describes;
    //   - an account still INVITED-BUT-NEVER-ACCEPTED is re-invited: 200, and
    //     the SAME auth user comes back. The case below covers that.
    //
    // The first draft invited a never-accepted address twice and expected a
    // refusal, so it failed on the app being right. AC 3's own examples — "a
    // member removed and re-added, or a Google sign-in from #304 that matched
    // nobody" — are both established accounts, so the criterion is about this
    // case and the fixture has to build it: a real signup, with a password.
    const h = await makeHousehold()
    const address = uniqueEmail('established')

    // A person who already uses Taskr, in a household of their own.
    const theirs = freshClient()
    const { error: signUpError } = await theirs.auth.signUp({
      email: address,
      password: 'their-own-password-1',
    })
    expect(signUpError, `the established signup failed: ${signUpError?.message}`).toBeNull()

    const member = await addMemberWithEmail(h, 'Placeholder One', address)
    const { status, body } = await callFunction(h.organizerToken, {
      action: 'invite',
      memberId: member.id,
      redirectTo: 'http://localhost:5173',
    })

    expect(status).toBe(409)
    expect(body.error).toMatch(/already has a Taskr sign-in/i)
    expect(body.error).toMatch(/Reset sign-in/i)

    // The half a status code does not prove, and the one that matters most:
    // nothing was attached. An organizer who merely knows an address cannot put
    // that person's existing account into their household.
    const { data: after } = await h.organizer
      .from('members')
      .select('id, claimed_by')
      .eq('id', member.id)
      .single()
    expect(after.claimed_by, 'a refused invite claimed the row anyway').toBeNull()
  })

  it('MEASURED — re-inviting a PENDING address returns the same account rather than a second one', async () => {
    // The other half of the measurement above, recorded because it falsifies a
    // sentence this repo used to carry. `revoke`'s blast-radius argument said
    // invite "always attaches a FRESHLY created auth user, never an existing
    // one". That is true of an established account (refused, above) and FALSE
    // here: a second invitation to an address whose user has never accepted
    // returns the SAME user, and it can be claimed onto a member row in another
    // household.
    //
    // Which is why `revoke`'s `otherClaims` check is load-bearing rather than
    // belt-and-braces: two member rows really can share one auth user by this
    // route, and deleting the account on the first revoke would end the other
    // household's access. The check already handles it; what was wrong was the
    // comment saying it could not arise.
    const a = await makeHousehold()
    const address = uniqueEmail('pending')
    const first = await addMemberWithEmail(a, 'Placeholder One', address)
    const firstCall = await callFunction(a.organizerToken, {
      action: 'invite',
      memberId: first.id,
      redirectTo: 'http://localhost:5173',
    })
    expect(firstCall.status, `the first invite must succeed: ${JSON.stringify(firstCall.body)}`).toBe(200)

    // A second household, because `members_household_email_key` forbids two
    // rows at one address inside one household — itself worth knowing, and
    // measured: `23505` on the insert, before the function is reached.
    const b = await makeHousehold()
    const second = await addMemberWithEmail(b, 'Placeholder Two', address)
    const secondCall = await callFunction(b.organizerToken, {
      action: 'invite',
      memberId: second.id,
      redirectTo: 'http://localhost:5173',
    })

    expect(secondCall.status).toBe(200)
    expect(
      secondCall.body.claimedBy,
      'a pending re-invite minted a SECOND account at one address',
    ).toBe(firstCall.body.claimedBy)
  })

  it('AC 1 — provision is refused for a member who has an address', async () => {
    const h = await makeHousehold()
    const member = await addMemberWithEmail(h, 'Placeholder One', uniqueEmail('has-address'))

    const { status, body } = await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: member.id,
      password: 'a-good-password',
    })

    expect(status).toBe(409)
    expect(body.error).toMatch(/send them an invitation instead/i)

    const { data: after } = await h.organizer
      .from('members')
      .select('id, claimed_by')
      .eq('id', member.id)
      .single()
    expect(after.claimed_by, 'a refused provision minted an account anyway').toBeNull()
  })

  it('the email-less member still provisions, which is why that branch survives', async () => {
    // The control for the test above. Without it, a function that refused
    // `provision` outright would pass every assertion up there and would have
    // left the one member who cannot be emailed with no way in at all.
    const h = await makeHousehold()
    const { status, body } = await callFunction(h.organizerToken, {
      action: 'provision',
      memberId: h.member.id,
      password: 'a-good-password',
    })

    expect(status, `provision failed: ${JSON.stringify(body)}`).toBe(200)
    expect(body.email).toBe(`${h.member.id}@taskr.invalid`)
  })

  it('refuses an invite to a member with no address', async () => {
    const h = await makeHousehold()
    const { status, body } = await callFunction(h.organizerToken, {
      action: 'invite',
      memberId: h.member.id,
      redirectTo: 'http://localhost:5173',
    })

    expect(status).toBe(409)
    expect(body.error).toMatch(/no email address on their row/i)
  })

  it('refuses an invite with no redirectTo', async () => {
    const h = await makeHousehold()
    const member = await addMemberWithEmail(h, 'Placeholder One', uniqueEmail('no-redirect'))
    const { status } = await callFunction(h.organizerToken, {
      action: 'invite',
      memberId: member.id,
    })
    expect(status).toBe(400)
  })

  it('the authorization shape survived the split — a non-organizer cannot invite', async () => {
    // #161's escalation, re-asked of the NEW action against real row-level
    // security. The caller here organises nothing in this household, so the
    // caller-scoped member read is what must fail closed — and a fake client
    // could not have shown that, because a fake enforces nothing.
    const h = await makeHousehold()
    const member = await addMemberWithEmail(h, 'Placeholder One', uniqueEmail('protected'))

    const outsider = freshClient()
    const { data: signUp, error } = await outsider.auth.signUp({
      email: uniqueEmail('outsider'),
      password: 'outsider-secret-1',
    })
    expect(error, `outsider signup failed: ${error?.message}`).toBeNull()

    const { status, body } = await callFunction(signUp.session.access_token, {
      action: 'invite',
      memberId: member.id,
      redirectTo: 'http://localhost:5173',
    })

    // 404, not 403: the caller-scoped read cannot SEE the member, so the
    // function never reaches the organizer check. That is the shape failing
    // closed, and it is deliberately indistinguishable from "no such member".
    expect([403, 404]).toContain(status)
    expect(body.ok).toBeFalsy()

    const { data: after } = await h.organizer
      .from('members')
      .select('id, claimed_by')
      .eq('id', member.id)
      .single()
    expect(after.claimed_by, 'an outsider got a sign-in attached').toBeNull()
  })
})
