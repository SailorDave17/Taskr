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
// Cleanup: each run creates one household named `TEST <timestamp>` and two
// anonymous users, and leaves them. There is deliberately no client-reachable
// way to delete a household — see the migration — so tidying is a manual
// statement in the Supabase SQL editor. `docs/access-model.md` carries it.

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
    })
    expect(error, `create_household failed: ${error?.message}`).toBeNull()
    household = data

    const { data: member, error: memberError } = await deviceA
      .from('members')
      .insert({ household_id: household.id, display_name: 'Placeholder', weekly_minutes: 120 })
      .select()
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
      const { data, error } = await deviceB.from('members').select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('cannot read the roster even knowing the household id', async () => {
      const { data } = await deviceB.from('members').select('*').eq('household_id', household.id)
      expect(data).toEqual([])
    })

    it('cannot insert a member into a household it knows the id of', async () => {
      const { error } = await deviceB
        .from('members')
        .insert({ household_id: household.id, display_name: 'Intruder', weekly_minutes: 60 })
      expect(error, 'RLS should have refused the insert').not.toBeNull()
    })

    it('cannot forge its own membership row', async () => {
      const { error } = await deviceB
        .from('household_devices')
        .insert({ household_id: household.id })
      expect(error, 'there is no insert policy on household_devices; this must fail').not.toBeNull()
    })

    it('cannot edit or remove someone else’s member row', async () => {
      const { data: updated } = await deviceB
        .from('members')
        .update({ weekly_minutes: 9999 })
        .eq('id', memberId)
        .select()
      expect(updated ?? []).toEqual([])

      const { data: deleted } = await deviceB
        .from('members')
        .delete()
        .eq('id', memberId)
        .select()
      expect(deleted ?? []).toEqual([])

      // And the row is untouched when read by someone who may read it.
      const { data: still } = await deviceA.from('members').select('*').eq('id', memberId).single()
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

      const { data } = await deviceB.from('members').select('*')
      expect(data.map((m) => m.id)).toContain(memberId)
    })

    it('still cannot see any OTHER household', async () => {
      const { data } = await deviceB.from('households').select('*')
      expect(data.map((h) => h.id)).toEqual([household.id])
    })

    it('will not let two devices claim the same person', async () => {
      const { error: firstClaim } = await deviceA.rpc('claim_member', { member_id: memberId })
      expect(firstClaim, `first claim failed: ${firstClaim?.message}`).toBeNull()

      const { error: secondClaim } = await deviceB.rpc('claim_member', { member_id: memberId })
      expect(secondClaim, 'the second device should have been refused').not.toBeNull()
      expect(secondClaim.message).toMatch(/already claimed/i)
    })
  })
})
