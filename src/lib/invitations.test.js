// The invitation data layer's pure halves, plus the payload each write sends —
// story #172.
//
// What this file can and cannot answer. It proves the code generator draws from
// the alphabet it claims, that the normalisation matches the SQL's shape, and
// that each write sends the columns `0040` grants and no others. It CANNOT
// prove that the digest this module computes is the digest
// `redeem_invitation` recomputes — that is a claim about two implementations of
// one function and only a real Postgres can settle it, which
// `src/test/invitationMint.pglite.test.js` does.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INVITATIONS_REDEEMABLE,
  INVITATION_ALPHABET,
  INVITATION_CODE_LENGTH,
  INVITATION_COLUMNS,
  INVITATION_LIFETIME_DAYS,
  SERVER_NOW,
  generateInvitationCode,
  hashInvitationCode,
  invitationDateLabel,
  invitationExpiryFrom,
  invitationShareText,
  listInvitations,
  mintInvitation,
  normalizeInvitationCode,
  outstandingInvitations,
  withdrawInvitation,
} from './invitations.js'
import { getSupabase } from './supabase.js'

vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }))

/**
 * A builder recording every call, so a test can assert the SHAPE of the request
 * rather than only its payload.
 *
 * Returns itself from every filter so the chain works, and resolves from
 * `select`/`single` or from the terminal `await` of an update. The recorded
 * calls are what the assertions read.
 */
function stubClient({ data = [], error = null, single = null } = {}) {
  const calls = []
  const record = (name) => (...args) => {
    calls.push([name, ...args])
    return builder
  }
  const builder = {
    calls,
    from: record('from'),
    select: record('select'),
    insert: record('insert'),
    update: record('update'),
    eq: record('eq'),
    is: record('is'),
    order: record('order'),
    single: () => {
      calls.push(['single'])
      return Promise.resolve({ data: single, error })
    },
    then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject),
  }
  getSupabase.mockReturnValue(builder)
  return builder
}

const argsOf = (client, name) => client.calls.filter(([called]) => called === name).map(([, arg]) => arg)

describe('#172 AC 2 — a code is not derivable from the household id', () => {
  it('takes no input but its random source, so there is nothing of the household to derive it from', () => {
    // The structural half of the criterion: the generator's ONLY parameter is
    // the byte source, and the mint calls it with none. A code built from the
    // household id would need that id as an argument, and there is no slot for
    // it to arrive through.
    expect(generateInvitationCode.length).toBeLessThanOrEqual(1)
    const fixed = () => Uint8Array.from(Array.from({ length: INVITATION_CODE_LENGTH }, (_, n) => n))
    // Same bytes, same code, whatever household is in play — because no
    // household is in play.
    expect(generateInvitationCode(fixed)).toBe(generateInvitationCode(fixed))
  })

  it('two mints for the SAME household get two different codes, neither carrying its id', async () => {
    const household = '8f14e45f-ceea-467a-9575-8e3b5a2d1c77'
    const codes = []
    for (let i = 0; i < 2; i += 1) {
      stubClient({ single: { id: `i${i}` } })
      const { code } = await mintInvitation({ householdId: household, createdByMemberId: 'm1' })
      codes.push(code)
    }
    expect(codes[0]).not.toBe(codes[1])
    // No run of the id's hex survives into a code. Four characters is the
    // shortest fragment that would mean anything, and the alphabet excludes
    // `0` and `1`, so most of a uuid could not appear even by accident.
    const fragments = household.replace(/-/g, '').match(/.{4}/g)
    for (const code of codes) {
      for (const fragment of fragments) expect(code).not.toContain(fragment)
    }
  })
})

describe('#172 — the invitation code itself', () => {
  it('draws 31 symbols with no visually confusable pair among them', () => {
    expect(INVITATION_ALPHABET).toHaveLength(31)
    expect(new Set(INVITATION_ALPHABET).size).toBe(31)
    // The characters this alphabet exists to exclude. A code is read aloud and
    // retyped, so each of these is a pair somebody gets wrong.
    for (const confusable of ['0', 'o', '1', 'l', 'i']) {
      expect(INVITATION_ALPHABET, `${confusable} is confusable and must not be drawn`).not.toContain(
        confusable,
      )
    }
    // Lower case throughout, which is load-bearing rather than cosmetic: the
    // string shown to the organizer has to BE the string `lower(btrim(...))`
    // produces, or the code reads differently from the way it hashes.
    expect(INVITATION_ALPHABET).toBe(INVITATION_ALPHABET.toLowerCase())
    // No separator, because `redeem_invitation` trims the ends and touches
    // nothing in the middle — a hyphen would be part of the secret.
    expect(INVITATION_ALPHABET).not.toMatch(/[-\s_.]/)
  })

  it('is ten characters, all of them from the alphabet', () => {
    expect(INVITATION_CODE_LENGTH).toBe(10)
    for (let i = 0; i < 200; i += 1) {
      const code = generateInvitationCode()
      expect(code).toHaveLength(INVITATION_CODE_LENGTH)
      expect(code).toMatch(new RegExp(`^[${INVITATION_ALPHABET}]{${INVITATION_CODE_LENGTH}}$`))
    }
  })

  it('does not repeat itself across two hundred draws', () => {
    // A floor against a generator that has stopped drawing — a constant, or a
    // counter. At 31^10 two collisions in 200 draws is not something that
    // happens, so any repeat here means the source is not random.
    const seen = new Set()
    for (let i = 0; i < 200; i += 1) seen.add(generateInvitationCode())
    expect(seen.size).toBe(200)
  })

  it('DISCARDS a byte that would bias the alphabet, rather than folding it in', () => {
    // The assertion a random source cannot be asked for. 248 is the first byte
    // value that must be rejected (31 × 8), and 255 is the last; a `% 31`
    // implementation would map them onto '2' and '9' and be ~12% more likely to
    // produce the first eight symbols than the rest, which is a guessing order
    // an attacker gets for free.
    //
    // The script hands out 248..255 first — every one of which must be thrown
    // away — and then ten FIVES, so a correct generator returns ten
    // alphabet[5]s.
    //
    // Fives, not zeroes, and that is the review's correction to this fixture:
    // 248 % 31 is 0, so with a zero filler a wrongly ACCEPTED 248 produced the
    // same symbol the filler did, and an off-by-one `>` in place of `>=` —
    // the boundary this test is named for — reddened nothing. Any filler whose
    // symbol differs from alphabet[0] makes the folded byte visible.
    const script = [
      [248, 249, 250, 251, 252, 253, 254, 255, 248, 249],
      [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    ]
    let batch = 0
    const code = generateInvitationCode(() => Uint8Array.from(script[batch++]))
    expect(code).toBe(INVITATION_ALPHABET[5].repeat(INVITATION_CODE_LENGTH))
    // Two batches were drawn, which is the discard actually happening rather
    // than the first batch quietly satisfying the loop.
    expect(batch).toBe(2)
  })

  it('maps a byte to the alphabet by its own index, so every symbol is reachable', () => {
    // Drives each index directly: byte n (n < 31) is alphabet[n], so a
    // generator that dropped, shifted or duplicated a symbol shows up here.
    // Three codes cover indices 0–29 ten at a time; the fourth is index 30
    // repeated, the last symbol, which an off-by-one would never reach.
    const run = (bytes) => generateInvitationCode(() => Uint8Array.from(bytes))
    const indices = (from) => Array.from({ length: INVITATION_CODE_LENGTH }, (_, n) => from + n)
    const drawn = run(indices(0)) + run(indices(10)) + run(indices(20))
    expect(drawn).toBe(INVITATION_ALPHABET.slice(0, 30))
    expect(run(Array(INVITATION_CODE_LENGTH).fill(30))).toBe(
      INVITATION_ALPHABET[30].repeat(INVITATION_CODE_LENGTH),
    )
  })
})

describe('#172 — the normalisation shared with redeem_invitation', () => {
  it('lowers and trims SPACES, which is what lower(btrim(code)) does', () => {
    expect(normalizeInvitationCode('K7M3QP4RWN')).toBe('k7m3qp4rwn')
    expect(normalizeInvitationCode('  k7m3qp4rwn  ')).toBe('k7m3qp4rwn')
    expect(normalizeInvitationCode('  K7m3Qp4rWn ')).toBe('k7m3qp4rwn')
  })

  it('does NOT trim a tab or a newline, because btrim does not', () => {
    // The correction this function carries. `btrim(s)` defaults its character
    // set to a single space, so Postgres keeps a tab or a newline at either end
    // — and a normalisation that stripped them here would hash to a digest the
    // server will never reproduce. `invitationMint.pglite.test.js` measures the
    // server half; this pins the client half to it.
    expect(normalizeInvitationCode('\tk7m3qp4rwn')).toBe('\tk7m3qp4rwn')
    expect(normalizeInvitationCode('k7m3qp4rwn\n')).toBe('k7m3qp4rwn\n')
    expect(normalizeInvitationCode(' \tK7M3QP4RWN\t ')).toBe('\tk7m3qp4rwn\t')
  })

  it('leaves the MIDDLE alone, because btrim does', () => {
    // The half that matters. A normalisation that stripped internal whitespace
    // would accept a code Postgres then refuses, and the organizer would be
    // told a correct code was wrong.
    expect(normalizeInvitationCode('k7m3 qp4rwn')).toBe('k7m3 qp4rwn')
    expect(normalizeInvitationCode('k7m3-qp4rwn')).toBe('k7m3-qp4rwn')
  })

  it('treats a blank code as a refusal rather than hashing the empty string', async () => {
    // The empty string has a perfectly good SHA-256, and inserting it would
    // mint an invitation redeemable by typing nothing.
    await expect(hashInvitationCode('   ')).rejects.toThrow(/cannot be blank/)
    await expect(hashInvitationCode(null)).rejects.toThrow(/cannot be blank/)
  })
})

describe('#172 — the digest the mint sends', () => {
  it('is the SHA-256 of the NORMALISED code, in Postgres hex input form', async () => {
    // The known answer: SHA-256('abc'). Taken from the published test vector
    // rather than from this implementation, so the test cannot agree with a
    // wrong implementation of the hash itself.
    await expect(hashInvitationCode('abc')).resolves.toBe(
      '\\xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    // Casing and surrounding whitespace reach the same digest, which is the
    // property `redeem_invitation` relies on.
    const plain = await hashInvitationCode('k7m3qp4rwn')
    expect(await hashInvitationCode('  K7M3QP4RWN  ')).toBe(plain)
    expect(await hashInvitationCode('K7m3Qp4rWn')).toBe(plain)
  })

  it('is 32 bytes of hex behind a literal backslash-x', async () => {
    const hash = await hashInvitationCode(generateInvitationCode())
    expect(hash).toMatch(/^\\x[0-9a-f]{64}$/)
    // The backslash is a CHARACTER in the value, not an escape in the wire
    // format — Postgres's hex input for bytea. Asserted by length, because a
    // doubled backslash would still match the pattern above.
    expect(hash.slice(0, 2)).toBe('\\x')
    expect(hash).toHaveLength(66)
  })

  it('two different codes reach two different digests', async () => {
    expect(await hashInvitationCode('k7m3qp4rwn')).not.toBe(await hashInvitationCode('k7m3qp4rwm'))
  })
})

describe('#172 — the created and expires labels', () => {
  it('reads as a month, a day and a time, in the household’s zone', () => {
    // 19:04 UTC is 3:04 PM in New York on this date (EDT, UTC−4).
    expect(invitationDateLabel('2026-09-10T19:04:00.000Z', 'America/New_York')).toBe('Sep 10, 3:04 PM')
  })

  it('moves with the zone, because the instant is fixed and the clock is not', () => {
    // The same instant is the NEXT day in Tokyo — the property that makes the
    // household's zone, rather than the phone's, the right one to ask.
    expect(invitationDateLabel('2026-09-10T19:04:00.000Z', 'Asia/Tokyo')).toBe('Sep 11, 4:04 AM')
  })

  it('carries the minute, so two codes minted the same day can be told apart', () => {
    const first = invitationDateLabel('2026-09-10T19:04:00.000Z', 'America/New_York')
    const second = invitationDateLabel('2026-09-10T19:11:00.000Z', 'America/New_York')
    expect(first).not.toBe(second)
  })

  it('is null rather than a throw for anything it cannot read', () => {
    expect(invitationDateLabel(null, 'America/New_York')).toBeNull()
    expect(invitationDateLabel('not a date', 'America/New_York')).toBeNull()
    expect(invitationDateLabel('2026-09-10T19:04:00.000Z', null)).toBeNull()
    expect(invitationDateLabel('2026-09-10T19:04:00.000Z', 'Not/AZone')).toBeNull()
  })
})

describe('#172 — the message a shared code travels in (design-bar, 2026-09-10)', () => {
  it('is exactly the code and its terms', () => {
    // Exact, not `toContain`: the Share button's payload is built from this, so
    // the one assertion that pins the words is here.
    expect(invitationShareText('k7m3qp4rwn')).toBe(
      `Your Taskr invitation code is k7m3qp4rwn. It works once, within ${INVITATION_LIFETIME_DAYS} days.`,
    )
  })

  it('takes the code and nothing else, so no household can travel with it', () => {
    // docs/data-outside-production.md, Decision 4 clause 2: a typed code MUST
    // NOT name the household — it is forwarded and screenshotted, so whoever
    // ends up holding it is not the person the organizer chose. Clause 3: no
    // household contents and not the id. A function whose only input is the
    // code has no route by which either could arrive.
    expect(invitationShareText.length).toBe(1)
    expect(invitationShareText('k7m3qp4rwn')).not.toMatch(/household/i)
  })
})

describe('#172 — whether a code can be spent yet', () => {
  it('ships FALSE, because nothing can redeem a code until #173', () => {
    // Owner decision at the review escalation, 2026-09-10: the card is wired
    // only when this is true, so a promotion of develop cannot put an
    // unredeemable code in front of real organizers. #173 flips it, and this
    // test with it — the criterion that says so is on #173.
    expect(INVITATIONS_REDEEMABLE).toBe(false)
  })
})

describe('#172 — the expiry', () => {
  it('is seven days after the moment it is minted', () => {
    expect(INVITATION_LIFETIME_DAYS).toBe(7)
    const at = new Date('2026-09-10T12:00:00.000Z')
    expect(invitationExpiryFrom(at)).toBe('2026-09-17T12:00:00.000Z')
  })

  it('is always after creation, which is what 0040s check constraint demands', () => {
    const at = new Date('2026-09-10T12:00:00.000Z')
    expect(new Date(invitationExpiryFrom(at)).getTime()).toBeGreaterThan(at.getTime())
  })
})

describe('#172 — which invitations are outstanding', () => {
  const row = (expires) => ({ id: `i-${expires}`, expires_at: expires })
  const NOW = new Date('2026-09-10T12:00:00.000Z')

  it('keeps one whose expiry is still ahead', () => {
    expect(outstandingInvitations([row('2026-09-10T12:00:01.000Z')], NOW)).toHaveLength(1)
  })

  it('drops one whose expiry has passed', () => {
    expect(outstandingInvitations([row('2026-09-10T11:59:59.000Z')], NOW)).toEqual([])
  })

  it('drops one AT its expiry instant, matching the servers <= refusal', () => {
    // `redeem_invitation` refuses `expires_at <= now()`, so a row at exactly
    // its expiry is already dead. Showing it would put a code on screen the
    // server will not accept — the one boundary where a `>=` here would be a
    // lie rather than an off-by-one.
    expect(outstandingInvitations([row('2026-09-10T12:00:00.000Z')], NOW)).toEqual([])
  })

  it('survives no rows at all', () => {
    expect(outstandingInvitations([], NOW)).toEqual([])
    expect(outstandingInvitations(null, NOW)).toEqual([])
  })
})

describe('#172 — what each write actually sends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the columns liveSchema probes, and never token_hash', async () => {
    const client = stubClient({ data: [] })
    await listInvitations('h1')
    expect(argsOf(client, 'from')).toEqual(['invitations'])
    expect(argsOf(client, 'select')).toEqual([INVITATION_COLUMNS])
    // The household filter, asserted with its VALUE — review finding. Nothing
    // failed when it was deleted: App mocks this function whole and the pglite
    // read is a hand-written copy, so this is the only place it is held. A
    // person organising two households is admitted to both by the policy, and
    // without the filter B's codes would sit under A's card.
    expect(client.calls.filter(([name]) => name === 'eq')).toEqual([['eq', 'household_id', 'h1']])
    // The one column the whole design exists to keep scarce. A digest cannot be
    // displayed, read aloud or spent, so asking for it would put it on the wire
    // on every refresh for no reader.
    expect(INVITATION_COLUMNS).not.toContain('token_hash')
  })

  it('filters the two stamps on the SERVER and the expiry nowhere', async () => {
    const client = stubClient({ data: [] })
    await listInvitations('h1')
    expect(client.calls.filter(([name]) => name === 'is')).toEqual([
      ['is', 'withdrawn_at', null],
      ['is', 'redeemed_at', null],
    ])
    // No expiry filter, deliberately: the only clock that decides anything is
    // the server's inside `redeem_invitation`, so filtering it in the query
    // would be this device's opinion dressed as a fact.
    expect(client.calls.map(([name, col]) => `${name}:${col}`)).not.toContain('lt:expires_at')
    expect(client.calls.map(([name, col]) => `${name}:${col}`)).not.toContain('gt:expires_at')
  })

  it('refuses a read that names no household', async () => {
    stubClient({ data: [] })
    await expect(listInvitations(null)).rejects.toThrow(/must name one/)
  })

  it('mints with exactly the four columns 0040 grants insert on', async () => {
    const client = stubClient({ single: { id: 'i1', household_id: 'h1' } })
    const { code, invitation } = await mintInvitation({
      householdId: 'h1',
      createdByMemberId: 'm1',
      now: new Date('2026-09-10T12:00:00.000Z'),
    })
    expect(invitation).toEqual({ id: 'i1', household_id: 'h1' })
    expect(code).toMatch(new RegExp(`^[${INVITATION_ALPHABET}]{${INVITATION_CODE_LENGTH}}$`))

    const [payload] = argsOf(client, 'insert')
    // The exact grant: `insert (household_id, token_hash, created_by_member_id,
    // expires_at)`. A fifth key here would be refused at the privilege layer.
    expect(Object.keys(payload).sort()).toEqual([
      'created_by_member_id',
      'expires_at',
      'household_id',
      'token_hash',
    ])
    expect(payload.household_id).toBe('h1')
    expect(payload.created_by_member_id).toBe('m1')
    expect(payload.expires_at).toBe('2026-09-17T12:00:00.000Z')
    expect(payload.token_hash).toBe(await hashInvitationCode(code))
  })

  it('sends the HASH and never the code', async () => {
    const client = stubClient({ single: { id: 'i1' } })
    const { code } = await mintInvitation({ householdId: 'h1', createdByMemberId: 'm1' })
    // The assertion this whole design exists for: the plaintext appears nowhere
    // in anything that crosses the wire.
    expect(JSON.stringify(client.calls)).not.toContain(code)
  })

  it('refuses a mint that names no household or no minter', async () => {
    stubClient({ single: null })
    await expect(mintInvitation({ createdByMemberId: 'm1' })).rejects.toThrow(/must name one/)
    await expect(mintInvitation({ householdId: 'h1' })).rejects.toThrow(/records who minted it/)
  })

  it('withdraws by stamping withdrawn_at from the SERVER clock, and nothing else', async () => {
    const client = stubClient({ data: [{ id: 'i1' }] })
    await withdrawInvitation('i1')
    const [payload] = argsOf(client, 'update')
    // `grant update (withdrawn_at)` is the whole privilege, so a second key
    // here would be refused before any policy was consulted.
    expect(Object.keys(payload)).toEqual(['withdrawn_at'])
    expect(payload.withdrawn_at).toBe(SERVER_NOW)
    // Not an ISO string off this device's clock. The value is a record of when
    // a credential was revoked, and a phone's clock is not evidence of that.
    expect(payload.withdrawn_at).not.toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(client.calls.filter(([name]) => name === 'eq')).toEqual([['eq', 'id', 'i1']])
  })

  it('withdraws only a row that has not already ended', async () => {
    const client = stubClient({ data: [{ id: 'i1' }] })
    await withdrawInvitation('i1')
    // Not a security boundary — `invitations_not_both_ends` is, and it refuses
    // a row that is both withdrawn and redeemed outright. This stops a
    // withdrawal racing a redemption from overwriting the stamp that won.
    expect(client.calls.filter(([name]) => name === 'is')).toEqual([
      ['is', 'withdrawn_at', null],
      ['is', 'redeemed_at', null],
    ])
  })

  it('reads back the row it changed, and refuses when it changed none — review finding', async () => {
    // Redeemed on another phone, or withdrawn from another device: the filters
    // match no row and PostgREST answers with no error. Before the review this
    // was reported as a success indistinguishable from a real withdrawal.
    const client = stubClient({ data: [] })
    await expect(withdrawInvitation('i1')).rejects.toThrow(/already used or withdrawn/)
    expect(argsOf(client, 'select')).toEqual(['id'])
  })

  it('POSITIVE CONTROL: a withdrawal that changed its row resolves', async () => {
    stubClient({ data: [{ id: 'i1' }] })
    await expect(withdrawInvitation('i1')).resolves.toBeUndefined()
  })

  it('refuses a withdrawal that names no invitation', async () => {
    stubClient({ data: null })
    await expect(withdrawInvitation(null)).rejects.toThrow(/must name one/)
  })

  it('reports a refusal with what it was doing, not with a bare Postgres string', async () => {
    stubClient({ data: null, single: null, error: { message: 'permission denied' } })
    await expect(listInvitations('h1')).rejects.toThrow(/loading the invitations: permission denied/)
    await expect(
      mintInvitation({ householdId: 'h1', createdByMemberId: 'm1' }),
    ).rejects.toThrow(/creating the invitation: permission denied/)
    await expect(withdrawInvitation('i1')).rejects.toThrow(
      /withdrawing the invitation: permission denied/,
    )
  })
})
