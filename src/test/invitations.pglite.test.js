// @vitest-environment node
//
// `0040` — the invitation record and its access rules, run against a real
// Postgres. Story #171.
//
// Node rather than the repo-wide jsdom for the reason every pglite suite here
// states on its first line: pglite loads its tarball through
// `Response.arrayBuffer`, which jsdom's `Response` does not have.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies. `npm run check:live` is
// blind to this whole file (see `0040`'s section 8: no client reads the table
// and nothing calls the function until #172/#173), so the live instruments are
// `npm run probe:live-grants` and the catalog query in docs/access-model.md.
//
// ===========================================================================
// WHAT THIS SUITE IS FOR, AND WHAT IT STRUCTURALLY CANNOT SEE
// ===========================================================================
//
// AC 2 asks for the three access properties proven "over a client-role
// connection, both directions" — so every access assertion below runs through
// `asDevice`, which does `set role authenticated`. As the owning superuser
// Postgres bypasses row-level security and ignores column grants entirely, so
// the same assertions would pass while proving nothing; `migrations.pglite`
// carries the positive control for that rail.
//
// It CANNOT see what the hosted platform grants on top of a migration — the
// live project hands `service_role` `arwdDxtm` on every new table in `public`
// while this harness hands it no DML (cairn:
// the-harness-cannot-catch-what-the-platform-granted). The `service_role`
// assertion below is scoped to what `0040` itself does, and says so.
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
import {
  RETIRED_BY_0007,
  blankSqlComments,
  retiredNamesIn,
} from './support/retiredVocabulary.js'

vi.setConfig({ testTimeout: 30_000 })

const MIGRATION = '0040_invitation_record.sql'

/** Every column `0040` grants SELECT on, sorted — asserted against the grant. */
const READABLE = [
  'created_at',
  'created_by_member_id',
  'expires_at',
  'household_id',
  'id',
  'redeemed_at',
  'redeemed_by_member_id',
  'token_hash',
  'withdrawn_at',
]

describe('the invitation record, run against a real Postgres', () => {
  let db, a, b

  /**
   * A household with an organizer and a second CLAIMED member who is not the
   * organizer.
   *
   * The second member is the load-bearing fixture of this whole suite: AC 2's
   * middle property is about a member who IS in the household and is NOT the
   * organizer, and a fixture with only an organizer and an outsider cannot tell
   * `is_household_organizer(...)` from `current_household_ids()` — both
   * predicates would refuse the outsider, so the organizer clause could be
   * deleted and every test would stay green.
   */
  async function seedHousehold(suffix = '') {
    const organizerDevice = await newDevice(db, `placeholder.organizer${suffix}@example.test`)
    const household = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        `Placeholder Household${suffix}`,
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes, email)
       values ($1, 'Housemate', 300, $2) returning id`,
      [household.id, `placeholder.two${suffix}@example.test`],
    )
    const memberTwo = rows[0].id
    const memberTwoDevice = await newDevice(db, `placeholder.two${suffix}@example.test`)
    await db.query('update public.members set claimed_by = $1 where id = $2', [
      memberTwoDevice,
      memberTwo,
    ])
    return {
      organizerDevice,
      memberTwoDevice,
      household,
      organizer: household.organizer_member_id,
      memberTwo,
    }
  }

  /** Mint an invitation as the OWNER, so a test about reading is not also a test about writing. */
  const mint = async (home, code, { expiresAt = null, createdBy = undefined } = {}) => {
    const { rows } = await db.query(
      `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
       values ($1, extensions.digest($2, 'sha256'), $3, coalesce($4::timestamptz, now() + interval '7 days'))
       returning id`,
      [home.household.id, code, createdBy === undefined ? home.organizer : createdBy, expiresAt],
    )
    return rows[0].id
  }

  /** Redeem as a signed-in person, through the client role — the real call path. */
  const redeemAs = (device, code) =>
    asDevice(db, device, () =>
      attempt(() => db.query('select * from public.redeem_invitation($1)', [code])),
    )

  const grantsFor = async (role, table) => {
    const { rows } = await db.query(
      `select distinct privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee = $2`,
      [table, role],
    )
    return rows.map((r) => r.privilege_type).sort()
  }

  const columnsWith = async (role, table, privilege) => {
    const { rows } = await db.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = $1
          and grantee = $2 and privilege_type = $3
        order by column_name`,
      [table, role, privilege],
    )
    return rows.map((r) => r.column_name)
  }

  const countAsOwner = async () => {
    const { rows } = await db.query('select count(*)::int as n from public.invitations')
    return rows[0].n
  }

  beforeEach(async () => {
    db = await freshDatabase()
    a = await seedHousehold()
    b = await seedHousehold('.other')
  })

  // -------------------------------------------------------------------------
  // AC 1 — the retired vocabulary
  // -------------------------------------------------------------------------

  describe('AC 1 — none of the eleven retired names is in the file', () => {
    it('names nothing `0007` retired, in executable code', () => {
      // `retiredVocabulary.test.js` scans every migration as part of its corpus
      // and is the enforcement; this asserts the property AT THE SUBJECT, so a
      // reader of this file sees the criterion met rather than having to trust a
      // scan somewhere else. Comments are stripped there, and this file's header
      // deliberately DISCUSSES the retired model — which is the case the SQL
      // blanker exists for.
      expect(RETIRED_BY_0007.length).toBe(11)
      expect(retiredNamesIn(migrationSql(MIGRATION), { sql: true })).toEqual([])
    })

    it('POSITIVE CONTROL: the scanner DOES fire on a retired name in this dialect', () => {
      // Without this the assertion above is satisfied by a scanner that matches
      // nothing at all — the empty-pass shape this repo records repeatedly.
      const planted = "select public.join_household('x');"
      expect(retiredNamesIn(planted, { sql: true })).toEqual([
        { name: 'join_household', line: 1 },
      ])
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — who may read and write, over a client-role connection, both ways
  // -------------------------------------------------------------------------

  describe('AC 2 — invitations are the organizer’s, proven in both directions', () => {
    beforeEach(async () => {
      await mint(a, 'alpha-code')
      await mint(b, 'beta-code')
    })

    it('the ORGANIZER reads their household’s invitations', async () => {
      const seen = await asDevice(db, a.organizerDevice, () =>
        attempt(() => db.query('select id, household_id from public.invitations')),
      )
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows).toHaveLength(1)
      expect(seen.value.rows[0].household_id).toBe(a.household.id)
    })

    it('a MEMBER who is not the organizer reads NOTHING — the organizer clause is what does it', async () => {
      // The household clause would ADMIT this caller: they are in the household
      // and `current_household_ids()` returns it. Only
      // `is_household_organizer(...)` refuses them, so this is the assertion
      // that reddens if that clause is dropped.
      const seen = await asDevice(db, a.memberTwoDevice, () =>
        attempt(() => db.query('select id from public.invitations')),
      )
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows).toEqual([])
    })

    it('POSITIVE CONTROL: that same member CAN read their own roster', async () => {
      // Without this, the empty read above is satisfied by a caller with no
      // privileges at all, or by a database refusing everything.
      const roster = await asDevice(db, a.memberTwoDevice, () =>
        attempt(() => db.query('select id from public.members')),
      )
      expect(roster.ok, roster.error ?? '').toBe(true)
      expect(roster.value.rows).toHaveLength(2)
    })

    it('a NON-MEMBER reads nothing at all — not an empty household, nothing', async () => {
      const stranger = await newDevice(db, 'placeholder.stranger@example.test')
      const seen = await asDevice(db, stranger, () =>
        attempt(() => db.query('select id from public.invitations')),
      )
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows).toEqual([])
    })

    it('the organizer of ANOTHER household sees only their own', async () => {
      const seen = await asDevice(db, b.organizerDevice, () =>
        attempt(() => db.query('select household_id from public.invitations')),
      )
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows.map((r) => r.household_id)).toEqual([b.household.id])
    })

    it('the ORGANIZER may mint, pinned to their own member row', async () => {
      const made = await asDevice(db, a.organizerDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
             values ($1, extensions.digest('fresh', 'sha256'), $2, now() + interval '1 day')`,
            [a.household.id, a.organizer],
          ),
        ),
      )
      expect(made.ok, made.error ?? '').toBe(true)
      expect(await countAsOwner()).toBe(3)
    })

    it('refuses the organizer minting AS A HOUSEMATE — the row is pinned to the caller', async () => {
      const refused = await asDevice(db, a.organizerDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
             values ($1, extensions.digest('spoofed', 'sha256'), $2, now() + interval '1 day')`,
            [a.household.id, a.memberTwo],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/row-level security|violates/i)
      expect(await countAsOwner()).toBe(2)
    })

    it('refuses a NON-ORGANIZER member minting at all', async () => {
      const refused = await asDevice(db, a.memberTwoDevice, () =>
        attempt(() =>
          db.query(
            `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
             values ($1, extensions.digest('sneaky', 'sha256'), $2, now() + interval '1 day')`,
            [a.household.id, a.memberTwo],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/row-level security|violates/i)
      expect(await countAsOwner()).toBe(2)
    })

    it('lets the organizer WITHDRAW, and refuses a non-organizer the same update', async () => {
      const withdrawn = await asDevice(db, a.organizerDevice, () =>
        attempt(() => db.query('update public.invitations set withdrawn_at = now()')),
      )
      expect(withdrawn.ok, withdrawn.error ?? '').toBe(true)
      const { rows } = await db.query(
        'select withdrawn_at from public.invitations where household_id = $1',
        [a.household.id],
      )
      expect(rows[0].withdrawn_at).not.toBeNull()

      const refused = await asDevice(db, a.memberTwoDevice, () =>
        attempt(() => db.query('update public.invitations set withdrawn_at = null')),
      )
      // The non-organizer's update matches no row through the policy, so it is
      // permitted-but-empty rather than refused — and the row is unchanged,
      // which is the property that matters.
      expect(refused.ok, refused.error ?? '').toBe(true)
      const { rows: after } = await db.query(
        'select withdrawn_at from public.invitations where household_id = $1',
        [a.household.id],
      )
      expect(after[0].withdrawn_at).not.toBeNull()
    })

    it('fails CLOSED in a household with no organizer', async () => {
      // `is_household_organizer` returns false for everybody when
      // `organizer_member_id` is null — `0016`'s property, inherited here. The
      // household is damaged rather than open.
      await db.query('update public.households set organizer_member_id = null where id = $1', [
        a.household.id,
      ])
      const seen = await asDevice(db, a.organizerDevice, () =>
        attempt(() => db.query('select id from public.invitations')),
      )
      expect(seen.ok, seen.error ?? '').toBe(true)
      expect(seen.value.rows).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 and AC 4 — the grants, and the stored form
  // -------------------------------------------------------------------------

  describe('AC 3 — every privilege is stated, and none is inherited', () => {
    it.each(['authenticated', 'anon'])(
      '%s holds no TABLE-level privilege — every grant is by column',
      async (role) => {
        expect(await grantsFor(role, 'invitations')).toEqual([])
      },
    )

    it('grants exactly the columns 0040 names, and no more', async () => {
      expect(await columnsWith('authenticated', 'invitations', 'SELECT')).toEqual(READABLE)
      expect(await columnsWith('authenticated', 'invitations', 'INSERT')).toEqual([
        'created_by_member_id',
        'expires_at',
        'household_id',
        'token_hash',
      ])
      // ONE column. Withdrawal is the client's only write to an existing row;
      // the redemption stamps are the function's alone.
      expect(await columnsWith('authenticated', 'invitations', 'UPDATE')).toEqual(['withdrawn_at'])
      expect(await columnsWith('anon', 'invitations', 'SELECT')).toEqual([])
    })

    it('grants NO DELETE to anybody — an invitation is withdrawn, never removed', async () => {
      // The narrow-revoke tell `0013` exists for: `revoke select, insert,
      // update` would have left DELETE standing wherever it was inherited. This
      // asserts the outcome rather than the spelling.
      expect(await grantsFor('authenticated', 'invitations')).not.toContain('DELETE')
      const refused = await asDevice(db, a.organizerDevice, () =>
        attempt(() => db.query('delete from public.invitations')),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })

    it('the redemption stamps are absent from BOTH client write grants', async () => {
      // So a client cannot mark an invitation redeemed without the function —
      // asserted as an absence from each list, because a column present in
      // either one would be a second way to spend an invitation.
      const insertable = await columnsWith('authenticated', 'invitations', 'INSERT')
      const updatable = await columnsWith('authenticated', 'invitations', 'UPDATE')
      for (const column of ['redeemed_at', 'redeemed_by_member_id']) {
        expect(insertable).not.toContain(column)
        expect(updatable).not.toContain(column)
      }
    })

    it('0040 grants service_role nothing — no Edge Function touches this table', async () => {
      // Exactly the platform default this harness models and not one letter
      // more. Scoped deliberately: the LIVE project's inherited defaults hand
      // this role `arwdDxtm` on every table in `public`, which is a fact about
      // the project rather than about this file (#101's measurement), and
      // `probe:live-grants` is where that is read.
      expect(await grantsFor('service_role', 'invitations')).toEqual([
        'REFERENCES',
        'TRIGGER',
        'TRUNCATE',
      ])
      expect(await columnsWith('service_role', 'invitations', 'SELECT')).toEqual([])
    })

    it('has row-level security on, with exactly the three policies', async () => {
      const { rows: rls } = await db.query(
        `select relrowsecurity from pg_class where oid = 'public.invitations'::regclass`,
      )
      expect(rls[0].relrowsecurity).toBe(true)
      const { rows: policies } = await db.query(
        `select policyname, cmd from pg_policies
          where schemaname = 'public' and tablename = 'invitations' order by policyname`,
      )
      expect(policies).toEqual([
        { policyname: 'invitations_insert_organizer', cmd: 'INSERT' },
        { policyname: 'invitations_select_organizer', cmd: 'SELECT' },
        { policyname: 'invitations_update_organizer', cmd: 'UPDATE' },
      ])
    })

    it('is NOT in the Realtime publication, because no client reads it yet', async () => {
      // The pair `0037` and `realtime.pglite.test.js` hold in both directions:
      // the publication is `LIVE_SCHEMA` minus the self-scoped marker, and this
      // table is absent from `LIVE_SCHEMA` until #172 ships its reader. Asserted
      // rather than left as an omission, because an absent entry and a forgotten
      // one look identical.
      const { rows } = await db.query(
        `select tablename from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invitations'`,
      )
      expect(rows).toEqual([])
    })
  })

  describe('AC 4 — the code is stored as a digest and nowhere as a code', () => {
    it('has no column that could hold a spendable code', async () => {
      const { rows } = await db.query(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'invitations' order by ordinal_position`,
      )
      expect(rows.map((r) => r.column_name)).toEqual([
        'id',
        'household_id',
        'token_hash',
        'created_by_member_id',
        'created_at',
        'expires_at',
        'withdrawn_at',
        'redeemed_at',
        'redeemed_by_member_id',
      ])
      // `bytea`, because `digest()` returns one — a text column here would be a
      // place somebody could put the code itself.
      expect(rows.find((r) => r.column_name === 'token_hash').data_type).toBe('bytea')
    })

    it('the plaintext appears in no column of the row', async () => {
      // The claim AC 4 actually makes, asserted against the stored row rather
      // than against the schema: every value is scanned for the code.
      await mint(a, 'super-secret-code')
      const { rows } = await db.query('select * from public.invitations')
      const flattened = JSON.stringify(rows)
      expect(flattened).not.toContain('super-secret-code')
    })

    it('two different codes hash to different rows, and the same code collides', async () => {
      await mint(a, 'code-one')
      const second = await attempt(() => mint(a, 'code-two'))
      expect(second.ok, second.error ?? '').toBe(true)
      // The unique index is what stops one code admitting two invitations.
      const collision = await attempt(() => mint(a, 'code-one'))
      expect(collision.ok).toBe(false)
      expect(collision.error).toMatch(/invitations_token_hash_unique|duplicate key/i)
    })

    it('a reader of the row cannot spend it — the digest does not redeem', async () => {
      // The property that makes the readable `token_hash` column safe, and the
      // reason it is granted at all. The organizer can SEE the digest; passing
      // it back as the code redeems nothing.
      await mint(a, 'real-code')
      const { rows } = await db.query('select token_hash from public.invitations')
      const asText = rows[0].token_hash.toString()
      const stranger = await newDevice(db, 'placeholder.reader@example.test')
      const refused = await redeemAs(stranger, asText)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/that invitation cannot be used/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 5, 6, 7 — redemption
  // -------------------------------------------------------------------------

  describe('AC 5 — redemption is a definer function, and the client insert cannot substitute', () => {
    it('is security definer with search_path pinned, executable by authenticated and not anon', async () => {
      const { rows } = await db.query(
        `select p.prosecdef, p.proconfig,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'redeem_invitation'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].prosecdef).toBe(true)
      // The catalog stores `set search_path = ''` as `search_path=""`, quoted.
      expect(rows[0].proconfig).toEqual(['search_path=""'])
      expect(rows[0].auth).toBe(true)
      expect(rows[0].anon).toBe(false)
    })

    it('creates the member row for somebody who was in no household', async () => {
      await mint(a, 'join-me')
      const joiner = await newDevice(db, 'placeholder.joiner@example.test')
      const redeemed = await redeemAs(joiner, 'join-me')
      expect(redeemed.ok, redeemed.error ?? '').toBe(true)
      expect(redeemed.value.rows[0].household_id).toBe(a.household.id)
      expect(redeemed.value.rows[0].claimed_by).toBe(joiner)
    })

    it('POSITIVE CONTROL: the same person’s own INSERT is refused, so the function is not decoration', async () => {
      // `members_insert_same_household` requires a membership the redeemer does
      // not have. Without this control, the function could be removed and a
      // client insert would look like an equivalent route.
      const joiner = await newDevice(db, 'placeholder.direct@example.test')
      const refused = await asDevice(db, joiner, () =>
        attempt(() =>
          db.query(
            `insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
             values ($1, 'Housemate', 0, $2)`,
            [a.household.id, joiner],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      // Refused at the PRIVILEGE layer, before any policy is consulted —
      // *measured*, the message is `permission denied for table members` rather
      // than a row-level-security violation. That is a stronger result than the
      // criterion asks for and it is worth reading exactly: `0013` grants
      // `authenticated` insert on `members` by COLUMN, and `claimed_by` is not
      // among them (`0007` withholds it precisely so no signed-in caller can
      // attach itself to a member row). So a redeemer is stopped twice over —
      // by the missing column grant here, and by
      // `members_insert_same_household` if the grant were ever widened. Both
      // spellings are accepted so this control reports the refusal rather than
      // the layer that happened to win.
      expect(refused.error).toMatch(/permission denied|row-level security|violates/i)
    })

    it('refuses an unauthenticated caller', async () => {
      await mint(a, 'anon-try')
      const refused = await asDevice(db, null, () =>
        attempt(() => db.query('select * from public.redeem_invitation($1)', ['anon-try'])),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/not authenticated/)
    })

    it('normalises casing and surrounding whitespace — #173 AC 8', async () => {
      await mint(a, 'mixed-case')
      const joiner = await newDevice(db, 'placeholder.caser@example.test')
      const redeemed = await redeemAs(joiner, '  MIXED-Case  ')
      expect(redeemed.ok, redeemed.error ?? '').toBe(true)
    })

    it('stamps the invitation with the member it created', async () => {
      await mint(a, 'stamp-me')
      const joiner = await newDevice(db, 'placeholder.stamped@example.test')
      const redeemed = await redeemAs(joiner, 'stamp-me')
      const { rows } = await db.query(
        'select redeemed_at, redeemed_by_member_id from public.invitations where household_id = $1',
        [a.household.id],
      )
      expect(rows[0].redeemed_at).not.toBeNull()
      expect(rows[0].redeemed_by_member_id).toBe(redeemed.value.rows[0].id)
    })
  })

  describe('AC 6 — an invitation is spent exactly once', () => {
    it('refuses a second redemption of the same code', async () => {
      await mint(a, 'once-only')
      const first = await newDevice(db, 'placeholder.first@example.test')
      const second = await newDevice(db, 'placeholder.second@example.test')
      expect((await redeemAs(first, 'once-only')).ok).toBe(true)
      const refused = await redeemAs(second, 'once-only')
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/that invitation cannot be used/)
      // And no member row was created for the second person.
      const { rows } = await db.query('select count(*)::int as n from public.members where claimed_by = $1', [
        second,
      ])
      expect(rows[0].n).toBe(0)
    })

    it('refuses a withdrawn invitation, and an expired one', async () => {
      await mint(a, 'withdrawn-code')
      await db.query('update public.invitations set withdrawn_at = now()')
      const one = await newDevice(db, 'placeholder.w@example.test')
      const refusedWithdrawn = await redeemAs(one, 'withdrawn-code')
      expect(refusedWithdrawn.ok).toBe(false)
      expect(refusedWithdrawn.error).toMatch(/that invitation cannot be used/)

      // An invitation cannot be BORN expired — `invitations_expires_after_creation`
      // refuses it, which is asserted on its own below. So the expired state is
      // reached the way it is reached in life: a valid row whose expiry passes.
      //
      // BOTH stamps move, and the first draft moved only one. Setting
      // `expires_at = created_at + 1 second` leaves the expiry microseconds in
      // the FUTURE at the moment redemption runs, so the row was still live and
      // the test read a successful redemption as a failed refusal — an
      // instrument that could not show the state it was built to show. Ageing
      // `created_at` as well puts the whole row in the past while keeping
      // `expires_at > created_at` true, which is the constraint's own rule.
      //
      // The update goes through the OWNER because neither stamp is in the
      // client's update grant, which is itself the point.
      await mint(a, 'expired-code')
      await db.query(
        `update public.invitations
            set created_at = now() - interval '2 days',
                expires_at = now() - interval '1 day'
          where redeemed_at is null and withdrawn_at is null`,
      )
      const two = await newDevice(db, 'placeholder.e@example.test')
      const refusedExpired = await redeemAs(two, 'expired-code')
      expect(refusedExpired.ok).toBe(false)
      expect(refusedExpired.error).toMatch(/that invitation cannot be used/)
    })

    it('refuses an existing member WITHOUT spending the invitation — #173 AC 2', async () => {
      await mint(a, 'already-in')
      const refused = await redeemAs(a.memberTwoDevice, 'already-in')
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/you are already in that household/)
      // The invitation is still usable by whoever it was meant for, which is the
      // half of the criterion that is easy to lose.
      const { rows } = await db.query('select redeemed_at from public.invitations')
      expect(rows[0].redeemed_at).toBeNull()
      const joiner = await newDevice(db, 'placeholder.intended@example.test')
      expect((await redeemAs(joiner, 'already-in')).ok).toBe(true)
    })

    it('the four unusable states are ONE sentence — Decision 4 clause 4', async () => {
      // A refusal may say why it refused and never what it refused. Four
      // distinguishable answers would tell somebody guessing codes that they
      // found a real one, so the sentences are asserted EQUAL rather than each
      // asserted separately.
      const nobody = await newDevice(db, 'placeholder.guess@example.test')
      const noSuch = await redeemAs(nobody, 'no-such-code-at-all')

      await mint(a, 'spent-code')
      const spender = await newDevice(db, 'placeholder.spender@example.test')
      await redeemAs(spender, 'spent-code')
      const alreadySpent = await redeemAs(nobody, 'spent-code')

      await mint(a, 'gone-code')
      await db.query(`update public.invitations set withdrawn_at = now() where redeemed_at is null`)
      const withdrawn = await redeemAs(nobody, 'gone-code')

      expect(noSuch.error).toBe(alreadySpent.error)
      expect(noSuch.error).toBe(withdrawn.error)
      // And none of them names the household.
      for (const refusal of [noSuch, alreadySpent, withdrawn]) {
        expect(refusal.error).not.toContain('Placeholder Household')
        expect(refusal.error).not.toContain(a.household.id)
      }
    })
  })

  describe('AC 7 — holding an account is not sufficient', () => {
    it('a signed-in person with no invitation joins nothing', async () => {
      // `disable_signup: false` means anybody can mint an account with the anon
      // key. This is the assertion that an account grants nothing here.
      const stranger = await newDevice(db, 'placeholder.account@example.test')
      const refused = await redeemAs(stranger, 'a-code-they-invented')
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/that invitation cannot be used/)
      const { rows } = await db.query('select count(*)::int as n from public.members')
      expect(rows[0].n).toBe(4)
    })
  })

  // -------------------------------------------------------------------------
  // The schema's own backstops, and the re-run
  // -------------------------------------------------------------------------

  describe('the schema’s own backstops', () => {
    it('refuses a row pairing one household’s member with another household’s id', async () => {
      const refused = await attempt(() => mint(a, 'cross', { createdBy: b.organizer }))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/invitations_creator_in_household|foreign key/i)
    })

    it('refuses an expiry at or before creation — an invitation cannot be BORN expired', async () => {
      // `created_at` defaults to now(), so this constraint means a row minted
      // already-expired is refused outright rather than existing as an
      // invitation nobody can use. The AC 6 test above relies on this: it has to
      // age a valid row instead of inserting a dead one.
      const refused = await attempt(() =>
        mint(a, 'backwards', { expiresAt: new Date(Date.now() - 86_400_000).toISOString() }),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/invitations_expires_after_creation|check constraint/i)
    })

    it('refuses a row that is both withdrawn and redeemed', async () => {
      await mint(a, 'both-ends')
      const refused = await attempt(() =>
        db.query(
          `update public.invitations
              set withdrawn_at = now(), redeemed_at = now(), redeemed_by_member_id = $1`,
          [a.memberTwo],
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/invitations_not_both_ends|check constraint/i)
    })

    it('refuses a half-written redemption stamp', async () => {
      await mint(a, 'half-stamp')
      const refused = await attempt(() =>
        db.query('update public.invitations set redeemed_at = now()'),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/invitations_redeemed_whole|check constraint/i)
    })

    it('a removed organizer leaves the invitation standing, with no creator', async () => {
      // The charter's leave/close decision: attribution is set null, and the
      // COLUMN LIST is what keeps `household_id` intact (`0032`'s measured
      // correction). Without the list the delete would be refused instead.
      await mint(a, 'orphan-me')
      await db.query('update public.households set organizer_member_id = null where id = $1', [
        a.household.id,
      ])
      await db.query('delete from public.members where id = $1', [a.organizer])
      const { rows } = await db.query(
        'select household_id, created_by_member_id from public.invitations',
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].created_by_member_id).toBeNull()
      expect(rows[0].household_id).toBe(a.household.id)
    })

    it('a deleted household takes its invitations with it', async () => {
      await mint(a, 'cascade-me')
      await db.query('delete from public.households where id = $1', [a.household.id])
      expect(await countAsOwner()).toBe(0)
    })

    it('stamps created_at from the database clock, not from the caller', async () => {
      const before = await db.query('select now() as t')
      await mint(a, 'clocked')
      const { rows } = await db.query('select created_at from public.invitations')
      expect(new Date(rows[0].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.rows[0].t).getTime(),
      )
    })

    it('carries the index the organizer’s list walks', async () => {
      const { rows } = await db.query(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'invitations'
            and indexname = 'invitations_household_created_idx'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].indexdef).toMatch(/\(household_id, created_at DESC\)/)
    })
  })

  describe('what the harness structurally cannot prove, and the re-run', () => {
    it('orders the revoke before the grants, which only the source shows', () => {
      // A catalog read sees the OUTCOME, so a file that granted and then revoked
      // would be indistinguishable from one that revoked and then granted if the
      // net result matched. `0013` is the file that exists because of a revoke
      // written the wrong way round.
      // Comments stripped FIRST: this file's own header discusses the revoke
      // and the grants in prose, so a raw indexOf finds the explanation rather
      // than the statement (measured — it read 25408 against a grant at 1946).
      const sql = blankSqlComments(migrationSql(MIGRATION))
      const revokeAt = sql.search(/^revoke all on public\.invitations/m)
      const grantAt = sql.search(/^grant select \(/m)
      expect(revokeAt).toBeGreaterThan(-1)
      expect(grantAt).toBeGreaterThan(-1)
      expect(revokeAt).toBeLessThan(grantAt)
      // And the function's revoke names `anon` explicitly, which no test here can
      // otherwise see: `from public` alone leaves the live project's by-name
      // grant standing while pglite reads false either way.
      expect(sql).toMatch(
        /^revoke all on function public\.redeem_invitation\(text\) from public, anon;/m,
      )
    })

    it('uses no narrow revoke anywhere — AC 3’s tell', () => {
      // `revoke select, insert, update` preserves DELETE wherever it was
      // inherited, which is `0013`'s whole subject. Asserted against the source
      // because the outcome on this harness cannot distinguish it.
      // Stripped, for the reason above: the header NAMES the narrow form as the
      // thing this file does not do, and a scan of raw source cannot tell the
      // hazard from the sentence explaining it.
      expect(blankSqlComments(migrationSql(MIGRATION))).not.toMatch(
        /revoke\s+select\s*,\s*insert/i,
      )
    })

    it('0040 applies a second time without error, and changes nothing', async () => {
      const database = await databaseThrough(MIGRATION)
      const before = await database.query(
        `select policyname from pg_policies where tablename = 'invitations' order by policyname`,
      )
      await database.exec(migrationSql(MIGRATION))
      const after = await database.query(
        `select policyname from pg_policies where tablename = 'invitations' order by policyname`,
      )
      expect(after.rows).toEqual(before.rows)
      const { rows } = await database.query(
        `select column_name from information_schema.column_privileges
          where table_name = 'invitations' and grantee = 'authenticated'
            and privilege_type = 'SELECT' order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual(READABLE)
    })
  })
})
