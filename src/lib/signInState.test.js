// #458 — the sign-in state a roster row reports.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INVITATION_LINK_LIFETIME_MS,
  listSignInStates,
  nextExpiry,
  signInStateFor,
} from './signInState.js'
import { getSupabase } from './supabase.js'

vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }))

const SENT = '2026-09-16T02:44:12Z'
const SENT_MS = Date.parse(SENT)
const member = (id, claimed = true) => ({ id, claimed_by: claimed ? `user-${id}` : null })

describe('signInStateFor', () => {
  it('is none for a member with no account', () => {
    expect(signInStateFor(member('a', false), [], SENT_MS)).toEqual({ kind: 'none' })
  })

  it('is joined once the address is confirmed — the row reads as it does today (AC 3)', () => {
    const states = [{ member_id: 'a', invited_at: SENT, confirmed_at: '2026-09-16T02:45:12Z' }]
    expect(signInStateFor(member('a'), states, SENT_MS + 1000)).toEqual({ kind: 'joined' })
  })

  it('is joined for a pre-#191 account that was created confirmed and never invited', () => {
    const states = [{ member_id: 'a', invited_at: null, confirmed_at: '2026-08-20T00:00:00Z' }]
    expect(signInStateFor(member('a'), states, SENT_MS)).toEqual({ kind: 'joined' })
  })

  it('is invited, with when it was sent, for a claimed and unconfirmed account (AC 1)', () => {
    const states = [{ member_id: 'a', invited_at: SENT, confirmed_at: null }]
    expect(signInStateFor(member('a'), states, SENT_MS + 60_000)).toEqual({
      kind: 'invited',
      sentAt: SENT,
      expiresAt: SENT_MS + INVITATION_LINK_LIFETIME_MS,
    })
  })

  it('is expired at exactly an hour and after, and not a millisecond before (AC 5)', () => {
    const states = [{ member_id: 'a', invited_at: SENT, confirmed_at: null }]
    const at = (ms) => signInStateFor(member('a'), states, SENT_MS + ms).kind
    expect(at(INVITATION_LINK_LIFETIME_MS - 1)).toBe('invited')
    expect(at(INVITATION_LINK_LIFETIME_MS)).toBe('expired')
    expect(at(INVITATION_LINK_LIFETIME_MS * 24)).toBe('expired')
    expect(signInStateFor(member('a'), states, SENT_MS + INVITATION_LINK_LIFETIME_MS)).toEqual({
      kind: 'expired',
      sentAt: SENT,
    })
  })

  it('is invited with no date when the account is unconfirmed and carries no usable stamp', () => {
    for (const invited_at of [null, 'not a date']) {
      expect(
        signInStateFor(member('a'), [{ member_id: 'a', invited_at, confirmed_at: null }], SENT_MS),
      ).toEqual({ kind: 'invited', sentAt: null, expiresAt: null })
    }
  })

  it('falls back to joined while the read has not answered, not to invited', () => {
    expect(signInStateFor(member('a'), null, SENT_MS)).toEqual({ kind: 'joined' })
    expect(signInStateFor(member('a'), undefined, SENT_MS)).toEqual({ kind: 'joined' })
  })

  it('is joined for a claimed member the read has no row for', () => {
    const states = [{ member_id: 'b', invited_at: SENT, confirmed_at: null }]
    expect(signInStateFor(member('a'), states, SENT_MS)).toEqual({ kind: 'joined' })
  })

  it('reads the row for THIS member, not the first unconfirmed one', () => {
    const states = [
      { member_id: 'b', invited_at: SENT, confirmed_at: null },
      { member_id: 'a', invited_at: SENT, confirmed_at: SENT },
    ]
    expect(signInStateFor(member('a'), states, SENT_MS).kind).toBe('joined')
    expect(signInStateFor(member('b'), states, SENT_MS).kind).toBe('invited')
  })
})

describe('nextExpiry', () => {
  it('is the soonest live link among the members, ignoring joined and expired rows', () => {
    const later = '2026-09-16T02:50:00Z'
    const states = [
      { member_id: 'a', invited_at: later, confirmed_at: null },
      { member_id: 'b', invited_at: SENT, confirmed_at: null },
      { member_id: 'c', invited_at: '2026-09-15T00:00:00Z', confirmed_at: null },
      // Sent BEFORE b, so a confirmed row misread as pending would be the
      // soonest — the fixture must make that misreading change the answer.
      { member_id: 'd', invited_at: '2026-09-16T02:30:00Z', confirmed_at: SENT },
    ]
    const members = ['a', 'b', 'c', 'd'].map((id) => member(id))
    expect(nextExpiry(members, states, SENT_MS + 1000)).toBe(SENT_MS + INVITATION_LINK_LIFETIME_MS)
  })

  it('is null when nothing is waiting to expire', () => {
    expect(nextExpiry([member('a')], null, SENT_MS)).toBeNull()
    expect(nextExpiry([], [], SENT_MS)).toBeNull()
  })
})

describe('INVITATION_LINK_LIFETIME_MS', () => {
  it('is the link lifetime the runbook measured on the live project', () => {
    const runbook = readFileSync(join(process.cwd(), 'docs', 'deploy-runbook.md'), 'utf8')
    const measured = runbook.match(/`mailer_otp_exp = (\d+)`/)
    expect(measured, 'the runbook no longer records mailer_otp_exp').not.toBeNull()
    expect(INVITATION_LINK_LIFETIME_MS).toBe(Number(measured[1]) * 1000)
  })
})

describe('listSignInStates', () => {
  let rpc
  beforeEach(() => {
    rpc = vi.fn()
    getSupabase.mockReturnValue({ rpc })
  })

  it('asks for the named household and returns its rows', async () => {
    const rows = [{ member_id: 'a', invited_at: SENT, confirmed_at: null }]
    rpc.mockResolvedValue({ data: rows, error: null })
    await expect(listSignInStates('h1')).resolves.toBe(rows)
    expect(rpc).toHaveBeenCalledWith('member_sign_in_states', { target_household: 'h1' })
  })

  it('refuses to read without a household, rather than asking for none', async () => {
    await expect(listSignInStates(null)).rejects.toThrow(/Which household/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws a refusal rather than returning an empty list that reads as "nobody pending"', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    await expect(listSignInStates('h1')).rejects.toThrow(/Could not read who has joined: Could not find/)
  })
})
