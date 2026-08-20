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

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

// The local stack's published defaults. Overridable so the same file can be
// pointed at a scratch project, but never defaulted to anything hosted.
const URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const FUNCTION_URL = `${URL}/functions/v1/provision-member`

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
}, 30_000)

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
