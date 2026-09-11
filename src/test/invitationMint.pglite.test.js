// @vitest-environment node
//
// The organizer's half of admission, through the CLIENT's own statements and
// against the REAL `redeem_invitation` — story #172.
//
// Node rather than the repo-wide jsdom for the reason every pglite suite here
// states on its first line: pglite loads its tarball through
// `Response.arrayBuffer`, which jsdom's `Response` does not have.
//
// ===========================================================================
// WHY THIS FILE EXISTS WHEN #171'S SUITE IS ALREADY THOROUGH
// ===========================================================================
//
// `invitations.pglite.test.js` mints every fixture as the OWNER with
// `extensions.digest($code, 'sha256')` — the server hashing a code it was
// handed. The app does not do that and cannot: the plaintext must never cross
// the wire, so `src/lib/invitations.js` hashes in the browser and sends the
// digest. That makes the mint and the redemption two implementations of one
// function in two languages, and `0040`'s own header names the risk exactly —
// "two normalisations in two places is one drift away from a code that cannot
// be redeemed".
//
// Nothing in #171's suite can see that drift, because every one of its codes
// was hashed by the same `digest()` that redeems it. This file is the pair: the
// digest comes from the JavaScript, the redemption from the SQL, and a
// disagreement between them is a red here rather than an organizer reading out
// a code that has never worked.
//
// What a pass means is still "consistent with Postgres, given the Supabase-
// shaped environment stubbed in support/pgliteSupabase.js". The statements are
// written as PostgREST writes them — a JSON string for `token_hash` arrives as
// text and is cast to `bytea`, and `withdrawn_at` arrives as the text `'now'` —
// so the cast Postgres performs is the one under test. PostgREST's own leg,
// from supabase-js's JSON to those parameters, is not reproduced here; it is
// the same leg `expires_at` rides on every mint.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asDevice, attempt, freshDatabase, newDevice } from './support/pgliteSupabase.js'
import {
  INVITATION_COLUMNS,
  SERVER_NOW,
  generateInvitationCode,
  hashInvitationCode,
  invitationExpiryFrom,
} from '../lib/invitations.js'

vi.setConfig({ testTimeout: 30_000 })

describe('#172 — minting through the client, redeeming through 0040', () => {
  let db, home

  async function seedHousehold() {
    const organizerDevice = await newDevice(db, 'placeholder.organizer@example.test')
    const household = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    // A claimed member who is NOT the organizer — the fixture AC 5 needs, since
    // an outsider alone cannot tell the organizer clause from the household one.
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes, email)
       values ($1, 'Housemate', 300, 'placeholder.two@example.test') returning id`,
      [household.id],
    )
    const memberTwoDevice = await newDevice(db, 'placeholder.two@example.test')
    await db.query('update public.members set claimed_by = $1 where id = $2', [
      memberTwoDevice,
      rows[0].id,
    ])
    return { organizerDevice, memberTwoDevice, household, organizer: household.organizer_member_id }
  }

  /**
   * The mint exactly as `mintInvitation` issues it: the organizer's own role,
   * the four granted columns, and the digest computed in JavaScript and sent as
   * the text PostgREST would send.
   */
  const mintAsClient = async (code) => {
    // Hashed BEFORE the role switch, as the browser does it: the digest exists
    // before any statement is issued, and nothing about it depends on who asks.
    const tokenHash = await hashInvitationCode(code)
    const made = await asDevice(db, home.organizerDevice, () =>
      attempt(() =>
        db.query(
          `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
           values ($1, $2::text::bytea, $3, $4::text::timestamptz)
           returning ${INVITATION_COLUMNS}`,
          [home.household.id, tokenHash, home.organizer, invitationExpiryFrom()],
        ),
      ),
    )
    expect(made.ok, made.error ?? '').toBe(true)
    return made.value.rows[0]
  }

  const redeemAs = (device, code) =>
    asDevice(db, device, () =>
      attempt(() => db.query('select * from public.redeem_invitation($1)', [code])),
    )

  beforeEach(async () => {
    db = await freshDatabase()
    home = await seedHousehold()
  })

  describe('AC 2 — the digest the browser computes is the digest redemption recomputes', () => {
    it('byte-equals digest(lower(btrim(code))) for fifty generated codes', async () => {
      // The direct cross-check. Fifty rather than one because a normalisation
      // mismatch only shows on a code that the mismatch touches, and the
      // generator is what decides which characters appear.
      for (let i = 0; i < 50; i += 1) {
        const code = generateInvitationCode()
        const { rows } = await db.query(
          `select $1::text::bytea = extensions.digest(lower(btrim($2)), 'sha256') as same`,
          [await hashInvitationCode(code), code],
        )
        expect(rows[0].same, code).toBe(true)
      }
    })

    it('and for a code typed in upper case with space around it', async () => {
      // The input `redeem_invitation` normalises. The browser hashes the same
      // normalised form, so both ends land on one digest.
      const code = '  K7M3QP4RWN '
      const { rows } = await db.query(
        `select $1::text::bytea = extensions.digest(lower(btrim($2)), 'sha256') as same`,
        [await hashInvitationCode(code), code],
      )
      expect(rows[0].same).toBe(true)
    })

    it('and for one carrying a TAB — the input on which the first draft disagreed', async () => {
      // The finding this file produced on its first run. The first
      // `normalizeInvitationCode` used JavaScript's `trim()`, which strips tabs
      // and newlines; `btrim` does not. This exact input hashed to two
      // different digests, which is the "code that cannot be redeemed" `0040`'s
      // header warns about. Kept as a case of its own rather than folded into
      // the one above, so the input that found it stays named.
      const code = '  K7M3QP4RWN\t'
      const { rows } = await db.query(
        `select $1::text::bytea = extensions.digest(lower(btrim($2)), 'sha256') as same`,
        [await hashInvitationCode(code), code],
      )
      expect(rows[0].same).toBe(true)
    })

    it('PLATFORM FACT: btrim with one argument trims spaces and nothing else', async () => {
      // Pinned because the whole agreement above rests on it, and because it is
      // the fact the first draft got wrong. If a Postgres upgrade ever widened
      // the default set, this reddens before the cross-check does and says why.
      const { rows } = await db.query(
        `select btrim(E'  x\\t') = E'x\\t' as keeps_tab,
                btrim(E'\\nx ') = E'\\nx' as keeps_newline,
                btrim('  x  ') = 'x' as trims_space`,
      )
      expect(rows[0]).toEqual({ keeps_tab: true, keeps_newline: true, trims_space: true })
    })

    it('POSITIVE CONTROL: the comparison under test CAN evaluate false', async () => {
      // Through the SAME channel the two assertions above use — the JavaScript
      // digest cast to bytea on one side, the server's normalised digest on the
      // other — with codes that differ by one character. Review finding: the
      // first version of this control compared two SQL `digest()` expressions,
      // which showed normalisation matters to SHA-256 and never that the
      // comparison actually asserted above could come back false.
      const { rows } = await db.query(
        `select $1::text::bytea = extensions.digest(lower(btrim($2)), 'sha256') as same`,
        [await hashInvitationCode('k7m3qp4rwn'), 'k7m3qp4rwm'],
      )
      expect(rows[0].same).toBe(false)
    })

    it('and the raw, unnormalised digest is the drift the server disagrees with', async () => {
      const code = 'K7M3QP4RWN'
      const { rows } = await db.query(
        `select extensions.digest($1, 'sha256') = extensions.digest(lower(btrim($1)), 'sha256') as same`,
        [code],
      )
      expect(rows[0].same).toBe(false)
    })

    it('a code minted by the client is REDEEMED by somebody holding it', async () => {
      // The round trip, end to end: the organizer's role writes the digest the
      // browser made, and a signed-in person with no household spends the
      // plaintext through the real function.
      const code = generateInvitationCode()
      const minted = await mintAsClient(code)
      const stranger = await newDevice(db, 'placeholder.stranger@example.test')

      const joined = await redeemAs(stranger, code)
      expect(joined.ok, joined.error ?? '').toBe(true)
      expect(joined.value.rows[0].household_id).toBe(home.household.id)

      const { rows } = await db.query(
        'select redeemed_at, redeemed_by_member_id from public.invitations where id = $1',
        [minted.id],
      )
      expect(rows[0].redeemed_at).not.toBeNull()
      expect(rows[0].redeemed_by_member_id).toBe(joined.value.rows[0].id)
    })

    it('redeems when read back in upper case with space around it', async () => {
      // How a code read aloud gets typed. The display is lower case; the person
      // at the other end may not be.
      const code = generateInvitationCode()
      await mintAsClient(code)
      const stranger = await newDevice(db, 'placeholder.stranger@example.test')
      const joined = await redeemAs(stranger, `  ${code.toUpperCase()} `)
      expect(joined.ok, joined.error ?? '').toBe(true)
    })

    it('stores the digest and never the code', async () => {
      const code = generateInvitationCode()
      const minted = await mintAsClient(code)
      const { rows } = await db.query('select row_to_json(i)::text as whole from public.invitations i where id = $1', [
        minted.id,
      ])
      expect(rows[0].whole).not.toContain(code)
      expect(rows[0].whole).not.toContain(code.toUpperCase())
    })

    it('the row the mint returns carries no token_hash — the client never reads it back', async () => {
      const minted = await mintAsClient(generateInvitationCode())
      expect(Object.keys(minted)).not.toContain('token_hash')
      expect(minted.household_id).toBe(home.household.id)
      expect(minted.created_by_member_id).toBe(home.organizer)
    })
  })

  describe('AC 4 — a withdrawn invitation cannot be redeemed', () => {
    const withdrawAsClient = (device, id) =>
      asDevice(db, device, () =>
        attempt(() =>
          // Exactly `withdrawInvitation`: the one granted column, the value
          // PostgREST sends as text, and the two "not already ended" filters.
          db.query(
            `update public.invitations set withdrawn_at = $1::text::timestamptz
              where id = $2 and withdrawn_at is null and redeemed_at is null
              returning id`,
            [SERVER_NOW, id],
          ),
        ),
      )

    it('refuses the redemption after the organizer withdraws it', async () => {
      const code = generateInvitationCode()
      const minted = await mintAsClient(code)

      const withdrawn = await withdrawAsClient(home.organizerDevice, minted.id)
      expect(withdrawn.ok, withdrawn.error ?? '').toBe(true)
      // POSITIVE CONTROL for the zero-row signal: a withdrawal that landed
      // hands its row back.
      expect(withdrawn.value.rows.map((r) => r.id)).toEqual([minted.id])

      const stranger = await newDevice(db, 'placeholder.stranger@example.test')
      const refused = await redeemAs(stranger, code)
      expect(refused.ok).toBe(false)
      // The one sentence `0040` gives all four unusable states, so a refusal
      // cannot confirm a code ever existed.
      expect(refused.error).toMatch(/that invitation cannot be used/)
      const { rows } = await db.query(
        'select count(*)::int as n from public.members where household_id = $1',
        [home.household.id],
      )
      expect(rows[0].n).toBe(2)
    })

    it('POSITIVE CONTROL: the same code redeems when nobody withdrew it', async () => {
      // Without this the refusal above is satisfied by a mint that never worked.
      const code = generateInvitationCode()
      await mintAsClient(code)
      const stranger = await newDevice(db, 'placeholder.stranger@example.test')
      const joined = await redeemAs(stranger, code)
      expect(joined.ok, joined.error ?? '').toBe(true)
    })

    it('stamps withdrawn_at from the DATABASE clock, not a value the device chose', async () => {
      // `SERVER_NOW` is the text `'now'`, which Postgres resolves when it casts
      // it — so the stamp lands inside the window the server's own clock
      // brackets. A device ISO string would land wherever the phone thought it
      // was.
      const minted = await mintAsClient(generateInvitationCode())
      const { rows: before } = await db.query('select clock_timestamp() as t')
      await withdrawAsClient(home.organizerDevice, minted.id)
      const { rows: after } = await db.query('select clock_timestamp() as t')
      const { rows } = await db.query('select withdrawn_at from public.invitations where id = $1', [
        minted.id,
      ])
      const stamp = new Date(rows[0].withdrawn_at).getTime()
      expect(stamp).toBeGreaterThanOrEqual(new Date(before[0].t).getTime())
      expect(stamp).toBeLessThanOrEqual(new Date(after[0].t).getTime())
    })

    it('a non-organizer’s withdrawal changes nothing, and the code still redeems', async () => {
      const code = generateInvitationCode()
      const minted = await mintAsClient(code)
      // Permitted-but-empty rather than refused: the policy matches no row for
      // this caller. What matters is that the invitation is untouched.
      const attempted = await withdrawAsClient(home.memberTwoDevice, minted.id)
      expect(attempted.ok, attempted.error ?? '').toBe(true)
      const stranger = await newDevice(db, 'placeholder.stranger@example.test')
      const joined = await redeemAs(stranger, code)
      expect(joined.ok, joined.error ?? '').toBe(true)
    })

    it('does not overwrite a REDEMPTION that already won', async () => {
      // The "not already ended" filters in `withdrawInvitation`: a withdrawal
      // arriving after a redemption matches no row, so the stamp that won
      // stands and `invitations_not_both_ends` is never tested by this path.
      const code = generateInvitationCode()
      const minted = await mintAsClient(code)
      const stranger = await newDevice(db, 'placeholder.stranger@example.test')
      expect((await redeemAs(stranger, code)).ok).toBe(true)
      const late = await withdrawAsClient(home.organizerDevice, minted.id)
      expect(late.ok, late.error ?? '').toBe(true)
      // ZERO rows came back — the signal `withdrawInvitation` now reads and
      // refuses on, instead of reporting a withdrawal that never landed.
      expect(late.value.rows).toEqual([])
      const { rows } = await db.query(
        'select withdrawn_at, redeemed_at from public.invitations where id = $1',
        [minted.id],
      )
      expect(rows[0].withdrawn_at).toBeNull()
      expect(rows[0].redeemed_at).not.toBeNull()
    })
  })

  describe('AC 5 — the read the app makes is refused by policy, not only hidden', () => {
    const readAs = (device) =>
      asDevice(db, device, () =>
        attempt(() =>
          // `listInvitations`, as SQL: the imported column list and the same
          // household filter and stamp filters.
          db.query(
            `select ${INVITATION_COLUMNS} from public.invitations
              where household_id = $1 and withdrawn_at is null and redeemed_at is null
              order by created_at desc`,
            [home.household.id],
          ),
        ),
      )

    it('the ORGANIZER reads the outstanding invitation', async () => {
      const minted = await mintAsClient(generateInvitationCode())
      const seen = await readAs(home.organizerDevice)
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows.map((r) => r.id)).toEqual([minted.id])
    })

    it('a MEMBER who is not the organizer reads NOTHING through that same statement', async () => {
      // The screen hides the list from this person; this is the database
      // agreeing. The household filter admits them, the stamps admit the row,
      // and only `is_household_organizer` stands in the way.
      await mintAsClient(generateInvitationCode())
      const seen = await readAs(home.memberTwoDevice)
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows).toEqual([])
    })

    it('POSITIVE CONTROL: that member is really in the household', async () => {
      // Otherwise the empty read above is satisfied by a fixture that never
      // admitted them at all.
      const roster = await asDevice(db, home.memberTwoDevice, () =>
        attempt(() => db.query('select id from public.members where household_id = $1', [home.household.id])),
      )
      expect(roster.ok, roster.error ?? '').toBe(true)
      expect(roster.value.rows).toHaveLength(2)
    })
  })
})
