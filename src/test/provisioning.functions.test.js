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
    // not a shortcut: there is NO public path that attaches an EXISTING auth
    // user to a second member row. `provision-member` mints a new one, which is
    // the gap #191 and #168 both record. So this state is unreachable through
    // the app today — which is exactly why #161 lands before the affordance
    // that makes it reachable, rather than after.
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
