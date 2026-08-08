// AC 6 — "the data layer itself rejects it, asserted by a test that bypasses the
// client, because a client-side guard is not a guard."
//
// This file talks to Supabase over the wire with the anon key, exactly as a
// stranger with the published bundle would. It imports nothing from src/ except
// the join-code helper: if it went through the app's own data layer it would be
// testing the app's manners, not the database's rules.
//
// It is NOT part of `npm test` and therefore not part of CI. That exclusion is
// deliberate and the reason is written here rather than in a commit message
// nobody will read: CI has no Supabase credentials, and a suite that silently
// skips when its configuration is absent passes vacuously — which is the exact
// failure `docs/ci-gate.md` was written to prevent. Run it with `npm run test:rls`.
//
// Cleanup: each run creates one household named `TEST <timestamp>` and three
// anonymous users, and leaves them. (Three since #61 — the two-devices-one-person
// test needs a challenger that has claimed nobody, and 0002 claims the organizer
// for the creating device, so devices A and B are both taken by then.) There is deliberately no client-reachable
// way to delete a household — see the migration — so tidying is a manual
// statement in the Supabase SQL editor. `docs/access-model.md` carries it.

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSecretKey } from '../lib/keyShape.js'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

// Loud, not skipped. If this file runs at all it must either exercise the
// policies or fail saying why.
if (!url || !anonKey) {
  throw new Error(
    'rls.integration.test.js needs a live Supabase project.\n' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (gitignored) ' +
      'and run `npm run test:rls`.\n' +
      'This test is excluded from `npm test` on purpose: CI has no credentials, and ' +
      'a security test that skips itself is worse than no security test.',
  )
}

// A secret key bypasses RLS, so running this file with one exercises no policy
// at all. It would still go red — device B would see everything — but it would
// go red in the shape of "your policies are broken", sending someone to rewrite
// a migration that is fine. Added 2026-08-05, when exactly this key was found in
// the project's own hosting configuration.
if (isSecretKey(anonKey)) {
  throw new Error(
    'rls.integration.test.js was given a SECRET key, so it can prove nothing.\n' +
      'A secret key bypasses row-level security: every assertion below would be ' +
      'testing a client that is exempt from the rules under test.\n' +
      'Use the PUBLISHABLE key (sb_publishable_… , or a legacy JWT whose role is ' +
      '"anon"). See .env.example and docs/access-model.md.\n' +
      'If a secret key has been used in a build, rotate it — fixing the variable ' +
      'does not invalidate what was already published.',
  )
}

const ORGANIZER_PIN = '4821'

// Every read of `members` names its columns, and this is load-bearing rather
// than tidy. Migration 0002 revokes select on the table and re-grants it per
// column so `pin_hash` can never be read, which means `select('*')` fails with
// `42501 permission denied` for EVERY caller — including a device that is
// legitimately in the household.
//
// This file used `select('*')` throughout and so could not run at all once 0002
// was applied (#61). Worse than not running: a `42501` returns `data: null`, and
// an assertion written as `expect(data ?? []).toEqual([])` then holds whether or
// not the rule under test did anything.
//
// With the columns named, a refusal by the GRANT is impossible here, so an empty
// array means the ROW-LEVEL POLICY refused — which is the only thing this file
// exists to measure. Kept identical to MEMBER_COLUMNS in src/lib/household.js;
// the two are the same statement about what a client may read.
const MEMBER_COLUMNS = 'id, household_id, display_name, weekly_minutes, claimed_by, has_pin, created_at'

/** A fresh client per device, so the two never share a session. */
function newDevice() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signInAnonymously(device, label) {
  const { error } = await device.auth.signInAnonymously()
  if (error) {
    // Named explicitly because cairn memory records this presenting as a bug in
    // your own code: anonymous sign-in is capped at 30/hour per IP by default,
    // and a whole household — or a test run loop — shares one home IP.
    const hint = /rate|limit|429/i.test(error.message)
      ? ' — this looks like the 30/hour-per-IP anonymous sign-in cap, not a policy failure'
      : ' — check that Anonymous Sign-Ins are enabled in Supabase → Authentication → Providers'
    throw new Error(`anonymous sign-in failed for ${label}: ${error.message}${hint}`)
  }
}

describe('row-level security, exercised over the wire', () => {
  const deviceA = newDevice()
  const deviceB = newDevice()
  let household
  let memberId

  beforeAll(async () => {
    await signInAnonymously(deviceA, 'device A')
    await signInAnonymously(deviceB, 'device B')

    const { data, error } = await deviceA.rpc('create_household', {
      household_name: `TEST ${new Date().toISOString()}`,
      // Migration 0002 creates the organizer in the same statement: a household
      // that exists for even one round trip without one cannot be administered,
      // because is_household_organizer() fails closed on a null.
      organizer_name: 'Placeholder Organizer',
      organizer_pin: ORGANIZER_PIN,
    })
    expect(error, `create_household failed: ${error?.message}`).toBeNull()
    household = data

    const { data: member, error: memberError } = await deviceA
      .from('members')
      .insert({ household_id: household.id, display_name: 'Placeholder', weekly_minutes: 120 })
      .select(MEMBER_COLUMNS)
      .single()
    expect(memberError, `seeding a member failed: ${memberError?.message}`).toBeNull()
    memberId = member.id
  }, 30_000)

  afterAll(async () => {
    await deviceA.auth.signOut()
    await deviceB.auth.signOut()
  })

  it('device A, which created the household, can see its own roster', () => {
    // The positive control. Without it, every assertion below is satisfied by a
    // database that returns nothing to anybody — including a typo in the table
    // name — and the suite would read as proof of security.
    expect(household?.id).toBeTruthy()
    expect(memberId).toBeTruthy()
  })

  describe('a device that has not joined', () => {
    it('sees no households at all', async () => {
      const { data, error } = await deviceB.from('households').select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('sees no members, not even an empty household', async () => {
      const { data, error } = await deviceB.from('members').select(MEMBER_COLUMNS)
      // `error` must be null for the empty set to mean anything. A permission
      // error would also produce no rows, and would prove nothing about RLS.
      expect(error, `expected a clean empty read, got ${error?.code}`).toBeNull()
      expect(data).toEqual([])
    })

    it('cannot read the roster even knowing the household id', async () => {
      const { data, error } = await deviceB
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('household_id', household.id)
      expect(error, `expected a clean empty read, got ${error?.code}`).toBeNull()
      expect(data).toEqual([])
    })

    it('cannot insert a member into a household it knows the id of', async () => {
      const { error } = await deviceB
        .from('members')
        .insert({ household_id: household.id, display_name: 'Intruder', weekly_minutes: 60 })
      expect(error, 'RLS should have refused the insert').not.toBeNull()
      // Name the MECHANISM, not just "something failed". Measured 2026-08-07:
      // every refusal in this file is `42501`, so the code alone cannot tell a
      // row-level policy from a missing column grant — only the message can.
      // If this refusal ever became a grant refusal instead, the rule this test
      // is named for would have quietly stopped being exercised.
      expect(error.message).toMatch(/row-level security/i)
    })

    it('cannot forge its own membership row', async () => {
      const { error } = await deviceB
        .from('household_devices')
        .insert({ household_id: household.id })
      expect(error, 'there is no insert policy on household_devices; this must fail').not.toBeNull()
      expect(error.message).toMatch(/row-level security/i)
    })

    it('cannot edit or remove someone else’s member row', async () => {
      // The subtlety this test was blind to until #61. `weekly_minutes` IS
      // inside 0002's update grant, so the grant permits this write and the
      // ROW-LEVEL POLICY is what must refuse it. While the returning read was
      // `select('*')`, a `42501` from the grant made `data` null, `null ?? []`
      // made the assertion hold, and the test would have passed unchanged with
      // the policy dropped — it could not detect the thing it is named for.
      //
      // Naming the columns removes the grant as a possible explanation: the
      // read is permitted, so an empty array can only mean the policy refused.
      const { data: updated, error: updateError } = await deviceB
        .from('members')
        .update({ weekly_minutes: 9999 })
        .eq('id', memberId)
        .select(MEMBER_COLUMNS)
      expect(updateError, `expected a permitted read of a refused write, got ${updateError?.code}`)
        .toBeNull()
      expect(updated).toEqual([])

      const { data: deleted, error: deleteError } = await deviceB
        .from('members')
        .delete()
        .eq('id', memberId)
        .select(MEMBER_COLUMNS)
      expect(deleteError, `expected a permitted read of a refused delete, got ${deleteError?.code}`)
        .toBeNull()
      expect(deleted).toEqual([])

      // The independent check, and the one a grant cannot fake: read the row as
      // a device that may read it and confirm nothing moved.
      const { data: still, error: stillError } = await deviceA
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('id', memberId)
        .single()
      expect(stillError, `reading the row back failed: ${stillError?.message}`).toBeNull()
      expect(still.weekly_minutes).toBe(120)
    })

    it('cannot join with a wrong code, and is not told which part was wrong', async () => {
      const { error } = await deviceB.rpc('join_household', { code: 'ZZZZZZZZ' })
      expect(error).not.toBeNull()
      expect(error.message).toMatch(/no household matches that code/i)

      const { error: malformed } = await deviceB.rpc('join_household', { code: 'nope' })
      expect(malformed).not.toBeNull()
      expect(malformed.message).toMatch(/no household matches that code/i)
    })
  })

  describe('once it joins with the real code', () => {
    it('accepts the code however a parent typed it, and then sees the roster', async () => {
      const spaced = `${household.join_code.slice(0, 4)}-${household.join_code.slice(4)}`.toLowerCase()
      const { error } = await deviceB.rpc('join_household', { code: spaced })
      expect(error, `join_household failed: ${error?.message}`).toBeNull()

      const { data, error: rosterError } = await deviceB.from('members').select(MEMBER_COLUMNS)
      expect(rosterError, `reading the roster after joining failed: ${rosterError?.message}`).toBeNull()
      expect(data.map((m) => m.id)).toContain(memberId)
    })

    it('still cannot see any OTHER household', async () => {
      const { data } = await deviceB.from('households').select('*')
      expect(data.map((h) => h.id)).toEqual([household.id])
    })

    it('cannot take an identity by writing claimed_by directly, going around the RPC', async () => {
      // Measured on 2026-08-06, BEFORE migration 0002: the RPC below refused
      // device B correctly and this direct update succeeded anyway, 1 row
      // changed. The guard was real and optional, which is the same as absent.
      // What refuses it now is a column grant, not a policy — RLS is row-level
      // and has nothing to say about which columns a client may write.
      const uidB = (await deviceB.auth.getUser()).data.user.id
      const { error } = await deviceB.from('members').update({ claimed_by: uidB }).eq('id', memberId)
      expect(error, 'a client could still write claimed_by directly').not.toBeNull()
      // Deliberately the GRANT, not a policy — 0002's whole argument is that RLS
      // is row-level and says nothing about columns. `permission denied` is the
      // grant refusing; a `row-level security` message here would mean the
      // column was writable again and something else caught it.
      expect(error.message).toMatch(/permission denied/i)
    })

    it('cannot read a PIN hash, so a four-digit PIN cannot be attacked offline', async () => {
      const { error } = await deviceB.from('members').select('pin_hash').eq('id', memberId)
      expect(error, 'pin_hash was readable by a household member').not.toBeNull()
      expect(error.message).toMatch(/permission denied/i)
    })

    it('will not let two devices claim the same person', async () => {
      // Restructured for 0002 (#61), and the two constraints that shape it are
      // both things the old version was not accounting for.
      //
      // ONE: the person under test must have NO PIN. `claim_member` is the
      // PIN-less route and refuses anyone who has a credential *before* it ever
      // reaches the already-claimed check — "that person has a PIN — use
      // claim_member_with_pin". 0002's `create_household` gives the organizer a
      // PIN, so the organizer cannot be the subject here. The seeded placeholder
      // has none.
      //
      // TWO: the challenging device must have claimed nobody, or a refusal could
      // equally mean "this device is already someone", which is a different
      // rule. 0002 claims the organizer for the creating device in the same
      // statement, so device A is taken and device B is about to be — hence a
      // third device. Under 0001 the household arrived with no organizer at all
      // and the old two-device shape worked; it fails with `23505` now, which
      // reads as a broken policy and is really a stale fixture.
      const { error: ownClaim } = await deviceB.rpc('claim_member', { member_id: memberId })
      expect(ownClaim, `claiming an unclaimed person should work: ${ownClaim?.message}`).toBeNull()

      const deviceC = newDevice()
      await signInAnonymously(deviceC, 'device C')
      const { error: joinError } = await deviceC.rpc('join_household', { code: household.join_code })
      expect(joinError, `device C could not join: ${joinError?.message}`).toBeNull()

      const { error: secondClaim } = await deviceC.rpc('claim_member', { member_id: memberId })
      expect(secondClaim, 'the second device should have been refused').not.toBeNull()
      // Named, not merely non-null: a refusal for the wrong reason — a missing
      // grant, a PIN check, a device that is already someone — is what this
      // assertion exists to rule out.
      expect(secondClaim.message).toMatch(/already claimed/i)

      await deviceC.auth.signOut()
    })
  })
})
