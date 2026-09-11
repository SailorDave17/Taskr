// @vitest-environment node
// `0041` — a pasted invitation code survives its own whitespace, run against a
// real Postgres. Story #173, AC 8.
//
// What this file proves that no unit test can: that the function on the
// server, after `0041`, accepts a code carrying a tab, a newline or a carriage
// return at either end, that it did NOT before `0041` (the positive control —
// otherwise every "accepted" below passes on a schema where nothing changed),
// that the client's `normalizeInvitationCode` and the server's `btrim` agree
// on exactly the inputs that used to differ, and that the replace preserved
// everything it was not asked to change: the ACL, the definer flag, the
// pinned `search_path`. The re-paste hazard runs the other way and is
// asserted in both directions.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'
import { RETIRED_BY_0007, retiredNamesIn } from './support/retiredVocabulary.js'
import {
  INVITATION_TRIM_SET,
  hashInvitationCode,
  normalizeInvitationCode,
} from '../lib/invitations.js'

vi.setConfig({ testTimeout: 30_000 })

const BEFORE = '0040_invitation_record.sql'
const MIGRATION = '0041_invitation_code_whitespace.sql'

/** The four characters, as the SQL spells them inside `E'…'` — evaluates to real whitespace. */
const SQL_TRIM_SET = "E' \\t\\r\\n'"

/**
 * The same expression as it appears in the function's SOURCE, for reading it
 * back out of `pg_get_functiondef`. Dollar-quoted so the backslashes are
 * literal: the catalog holds the spelling `\t`, not a tab — a first draft
 * searched the source for real whitespace and read the widening as absent on
 * a function that carried it.
 */
const WIDENED_SOURCE = "$$btrim(redeem_invitation.code, E' \\t\\r\\n')$$"

describe('#173 AC 8 — a code is accepted however its whitespace arrived', () => {
  let db, home

  async function seedHousehold(database) {
    const organizerDevice = await newDevice(database, 'placeholder.organizer@example.test')
    const household = await asDevice(database, organizerDevice, async () => {
      const { rows } = await database.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    return { organizerDevice, household, organizer: household.organizer_member_id }
  }

  /** Mint as the OWNER, hashing the canonical code, so redemption is the only thing under test. */
  const mint = async (database, seeded, code) => {
    const { rows } = await database.query(
      `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
       values ($1, extensions.digest($2, 'sha256'), $3, now() + interval '7 days')
       returning id`,
      [seeded.household.id, code, seeded.organizer],
    )
    return rows[0].id
  }

  const redeemAs = (database, device, code) =>
    asDevice(database, device, () =>
      attempt(() => database.query('select * from public.redeem_invitation($1)', [code])),
    )

  beforeEach(async () => {
    db = await freshDatabase()
    home = await seedHousehold(db)
  })

  // The inputs that DIFFER between `btrim(code)` and `btrim(code, E' \t\r\n')`.
  // Every one of these was refused under `0040` and is accepted under `0041`.
  const PASTED = [
    ['a trailing newline — the ordinary copy-paste', 'k7m3qp4rwn\n'],
    ['a trailing CRLF — a Windows clipboard', 'k7m3qp4rwn\r\n'],
    ['a leading tab', '\tk7m3qp4rwn'],
    ['tabs and spaces both ends, in upper case', ' \tK7M3QP4RWN\t '],
    ['a newline before and a carriage return after', '\nk7m3qp4rwn\r'],
    // A LEADING carriage return on its own — review finding: every other
    // single character in either class had a fixture, and this one did not,
    // so dropping `\r` from the leading class reddened nothing.
    ['a leading carriage return', '\rk7m3qp4rwn'],
  ]

  describe.each(PASTED)('%s', (_label, typed) => {
    it('is ACCEPTED under 0041', async () => {
      await mint(db, home, 'k7m3qp4rwn')
      const joiner = await newDevice(db, 'placeholder.joiner@example.test')
      const redeemed = await redeemAs(db, joiner, typed)
      expect(redeemed.ok, redeemed.error ?? '').toBe(true)
      expect(redeemed.value.rows[0].household_id).toBe(home.household.id)
    })

    it('POSITIVE CONTROL: was REFUSED under 0040 alone — so the change above is 0041’s', async () => {
      // Without this every acceptance passes on a server where nothing
      // changed. `databaseThrough` stops at `0040`, which is the schema #172
      // measured the refusal on.
      const before = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(before)
      await mint(before, seeded, 'k7m3qp4rwn')
      const joiner = await newDevice(before, 'placeholder.joiner@example.test')
      const refused = await redeemAs(before, joiner, typed)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/that invitation cannot be used/)
    })
  })

  it('still refuses whitespace in the MIDDLE — the trim is ends-only, as the client’s is', async () => {
    await mint(db, home, 'k7m3qp4rwn')
    const joiner = await newDevice(db, 'placeholder.joiner@example.test')
    const refused = await redeemAs(db, joiner, 'k7m3q p4rwn')
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/that invitation cannot be used/)
  })

  it('still refuses a non-breaking space — the set is four characters, not every space', async () => {
    // `String.prototype.trim()` takes U+00A0; neither the server nor the
    // client does, and a client wider than the server is the first defect
    // back (#172's finding, with the sign flipped).
    await mint(db, home, 'k7m3qp4rwn')
    const joiner = await newDevice(db, 'placeholder.joiner@example.test')
    const refused = await redeemAs(db, joiner, 'k7m3qp4rwn ')
    expect(refused.ok).toBe(false)
    // The function's own refusal, not an encoding error on U+00A0 — review
    // finding: `attempt` flattens every throw, so `ok === false` alone is
    // satisfied by a raise that never evaluated the trim.
    expect(refused.error).toMatch(/that invitation cannot be used/)
  })

  it('POSITIVE CONTROL: a code with no whitespace at all redeems under 0041 as it did under 0040', async () => {
    await mint(db, home, 'k7m3qp4rwn')
    const joiner = await newDevice(db, 'placeholder.joiner@example.test')
    expect((await redeemAs(db, joiner, 'k7m3qp4rwn')).ok).toBe(true)
  })
})

describe('#173 AC 8 — the client’s normalisation is the server’s, on the inputs that differ', () => {
  let db

  beforeEach(async () => {
    db = await freshDatabase()
  })

  it('spells the same four characters, in the same order, in both places', () => {
    // DERIVED from the client's constant, not a second literal — review
    // finding: the first draft compared the constant to one literal and the
    // SQL to another, which linked the two nowhere. The E-string spelling of
    // whatever `INVITATION_TRIM_SET` holds must appear in the function, so
    // narrowing or reordering either side reddens this.
    const asEString = `E'${INVITATION_TRIM_SET.replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`
    expect(asEString).toBe(SQL_TRIM_SET)
    expect(migrationSql(MIGRATION)).toContain(`btrim(redeem_invitation.code, ${asEString})`)
    // And the set is the four the story names, in this order.
    expect(INVITATION_TRIM_SET).toBe(' \t\r\n')
  })

  it.each([
    'k7m3qp4rwn\n',
    'k7m3qp4rwn\r\n',
    '\tk7m3qp4rwn',
    ' \tK7M3QP4RWN\t ',
    '\nK7M3QP4RWN\r',
    '\rk7m3qp4rwn',
  ])('byte-equals digest(lower(btrim(code, E\' \\t\\r\\n\'))) for %j', async (typed) => {
    // The cross-check `invitationMint.pglite.test.js` runs for the mint, run
    // for the inputs THIS migration is about: the JavaScript digest of the
    // client's normalisation against the server's own expression.
    const { rows } = await db.query(
      `select $1::text::bytea = extensions.digest(lower(btrim($2, ${SQL_TRIM_SET})), 'sha256') as same`,
      [await hashInvitationCode(typed), typed],
    )
    expect(rows[0].same, typed).toBe(true)
    expect(normalizeInvitationCode(typed)).toBe('k7m3qp4rwn')
  })

  it('POSITIVE CONTROL: the comparison CAN evaluate false, and does under the OLD expression', async () => {
    // The same channel, with `0040`'s one-argument `btrim` on the server side:
    // the client now trims the tab and that server did not, so the digests
    // differ — which is the disagreement `0041` exists to end, shown here so
    // the agreements above are not vacuous.
    const typed = 'k7m3qp4rwn\t'
    const { rows } = await db.query(
      `select $1::text::bytea = extensions.digest(lower(btrim($2)), 'sha256') as same`,
      [await hashInvitationCode(typed), typed],
    )
    expect(rows[0].same).toBe(false)
  })
})

describe('0041 — what the replace changed, and what it preserved', () => {
  let db

  const functionFacts = async (database) => {
    const { rows } = await database.query(
      `select p.prosecdef,
              p.proconfig,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may,
              has_function_privilege('anon', p.oid, 'execute') as anon_may,
              obj_description(p.oid, 'pg_proc') as comment,
              position(${WIDENED_SOURCE} in pg_get_functiondef(p.oid)) > 0 as widened,
              position('where i.id = target.id' in pg_get_functiondef(p.oid)) > 0 as locks_by_key,
              md5(p.prosrc) as body_md5
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'redeem_invitation'`,
    )
    expect(rows).toHaveLength(1)
    return rows[0]
  }

  // Through 0041, not the whole list: this block's subject is what 0041 does,
  // and since 0042 (#430) replaces `redeem_invitation` again, "re-applying 0041
  // changes nothing" is only true of a database that stops at 0041. On the full
  // list, re-applying it takes 0042's pending-deletion refusal away, which is
  // 0042's re-paste hazard and is asserted in householdDeletion.pglite.test.js.
  // `databaseThrough`'s own docblock names this as the honest setting.
  beforeEach(async () => {
    db = await databaseThrough(MIGRATION)
  })

  it('widens the normalisation and nothing else about the function’s shape', async () => {
    const after = await functionFacts(db)
    expect(after.widened).toBe(true)
    // `0040`'s properties, preserved across the replace (`0028`'s reading).
    expect(after.prosecdef).toBe(true)
    // The catalog's quoted spelling of `set search_path = ''` (the overlay's
    // `0028` reading, met again here).
    expect(after.proconfig).toEqual(['search_path=""'])
    expect(after.authenticated_may).toBe(true)
    expect(after.anon_may).toBe(false)
    expect(after.locks_by_key).toBe(true)
    expect(after.comment).toMatch(/0041/)
    expect(after.comment).toMatch(/Story #171/)
  })

  it('POSITIVE CONTROL: under 0040 alone the normalisation is NOT widened, and the rest is the same', async () => {
    const before = await functionFacts(await databaseThrough(BEFORE))
    expect(before.widened).toBe(false)
    expect(before.prosecdef).toBe(true)
    expect(before.authenticated_may).toBe(true)
    expect(before.anon_may).toBe(false)
    expect(before.locks_by_key).toBe(true)
    expect(before.comment).not.toMatch(/0041/)
  })

  it('applies a second time without error, and changes nothing', async () => {
    const once = await functionFacts(db)
    await db.exec(migrationSql(MIGRATION))
    const twice = await functionFacts(db)
    expect(twice).toEqual(once)
  })

  it('RE-PASTE HAZARD, both directions: 0040 on top reverts the widening, and 0041 on top restores it', async () => {
    // `0028`'s hazard exactly: an older file that declares the same function,
    // re-pasted alone, succeeds silently and takes this file's change away.
    // Asserted so the safe re-paste order in `docs/access-model.md` is a
    // measured claim rather than a remembered one.
    const widened = await functionFacts(db)
    expect(widened.widened).toBe(true)

    await db.exec(migrationSql(BEFORE))
    const reverted = await functionFacts(db)
    expect(reverted.widened).toBe(false)
    expect(reverted.body_md5).not.toBe(widened.body_md5)

    await db.exec(migrationSql(MIGRATION))
    const restored = await functionFacts(db)
    expect(restored.widened).toBe(true)
    expect(restored.body_md5).toBe(widened.body_md5)
  })

  it('carries the complete privilege statement itself, in 0034’s idiom', () => {
    const sql = migrationSql(MIGRATION)
    expect(sql).toMatch(/revoke all on function public\.redeem_invitation\(text\) from public, anon;/)
    expect(sql).toMatch(/grant execute on function public\.redeem_invitation\(text\) to authenticated;/)
  })

  it('names nothing `0007` retired, in executable code', () => {
    expect(RETIRED_BY_0007.length).toBe(11)
    expect(retiredNamesIn(migrationSql(MIGRATION), { sql: true })).toEqual([])
  })
})
