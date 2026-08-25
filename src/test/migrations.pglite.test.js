// @vitest-environment node
//
// Node, not the repo-wide jsdom: PGlite loads its WASM and its pgcrypto bundle
// through fetch/Response, and jsdom's Response has no arrayBuffer() here — every
// test in the file dies at PGlite.create() with a TypeError that says nothing
// about environments.

// #23 AC 3 — "the data layer itself rejects it, asserted by a test that bypasses
// the client, because a client-side guard is not a guard."
//
// The live suite (rls.integration.test.js) asserts the same rules against the
// real project and needs credentials, so CI cannot run it. This file runs the
// actual migration SQL against a real Postgres in WASM and needs nothing, so it
// runs on every push. Neither replaces the other: this one proves the SQL is
// correct Postgres and that the rules hold; that one proves Supabase agrees.
//
// The centrepiece is still `claimed_by`, and #62 raised its stakes rather than
// lowering them. Measured against the live project on 2026-08-06, before 0002:
// `claim_member()` correctly refused device B, and a direct
// `update members set claimed_by = B` succeeded anyway — the guard was real and
// optional. Under 0007 that column is no longer "which device is acting as this
// person"; it IS the person's identity, and it is the sole input to every
// policy in the schema. A client that could write it could become anyone in its
// household. The regression tests below are the reason it cannot.
//
// WHAT CHANGED IN #62, since roughly half this file used to test the other
// model: PINs, join codes and the two claim RPCs are gone. They are not merely
// unused — 0007 drops them, on this repo's rule that a dead credential path
// which still works is a second way in. What replaced them is not another
// database credential: provisioning is an Edge Function running as service_role,
// outside anything this harness can execute. So the tests that used to prove
// "the right PIN claims the person" have no successor here by design, and their
// place is taken by tests that the old route is GONE and that the new predicate
// resolves through `claimed_by`.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  MIGRATIONS,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'

/**
 * The columns a client is allowed to read. Named once so a drift is one edit.
 *
 * `has_pin` left with 0007 and `email` arrived with it. The list is asserted
 * against the grant itself further down rather than only being used here — a
 * constant that has quietly fallen behind the schema reads exactly like one
 * that has not.
 */
const READABLE = 'id, display_name, weekly_minutes, claimed_by, email, created_at'

// A pglite test builds a real Postgres in WebAssembly, so vitest's 5000ms
// default testTimeout is a number nobody chose for this suite - it is what you
// get for not setting one. Raised deliberately, and the measurement is why.
//
// Measured 2026-08-24 on repeats.pglite.test.js's heaviest case, which runs its
// whole scenario twice under two pinned session zones and must therefore build
// TWO more databases inside the test body, on top of the one beforeEach already
// built: 3460ms on the dev machine, 7800ms and 8107ms on ubuntu-latest, where it
// timed out. The same test passed in a third CI run, so the runner straddles the
// default - which is the worst place for a limit to sit, because the suite then
// fails about two pushes in three and reads as a real defect each time.
//
// 30s is ~3.7x the worst time actually observed. A genuine hang still fails; it
// fails later, and that is the whole cost of this line.
//
// hookTimeout is NOT set here. It is set once, for every pglite suite, in
// src/test/support/pgliteSupabase.js — which this file imports — and the
// measurement behind the value is in that file's comment. #145.
//
// It used to be seven copies of a paragraph explaining why the 10s default was
// deliberate. Two suites then timed out on it, the correction reached one copy,
// and six went on asserting the opposite of what the code did. A value with one
// home has no copy-set to keep in step.
vi.setConfig({ testTimeout: 30_000 })

describe('the migrations, run against a real Postgres', () => {
  let db
  let organizerDevice
  let childDevice
  let strangerDevice
  let household
  let organizerId
  let childId

  beforeEach(async () => {
    db = await freshDatabase()
    organizerDevice = await newDevice(db)
    childDevice = await newDevice(db)
    strangerDevice = await newDevice(db)

    household = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })

    const seeded = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, $2, $3) returning id`,
        [household.id, 'Placeholder Child', 120],
      )
      return rows[0]
    })
    childId = seeded.id
    organizerId = household.organizer_member_id

    // Where `join_household(code)` used to be. The child's phone becomes the
    // child by being attached to their member row, which is service_role work —
    // see provisionMember's docblock for why it deliberately does not go through
    // asDevice.
    await provisionMember(db, childId, childDevice)
  })

  // -------------------------------------------------------------------------
  // The harness itself. A suite whose safety rail is silent when removed proves
  // nothing, so the rail is asserted before anything relies on it.
  // -------------------------------------------------------------------------

  describe('harness integrity', () => {
    it('POSITIVE CONTROL: as the owner role, RLS is bypassed — so `set role` is what does the work', async () => {
      // Not wrapped in asDevice: this runs as the superuser that owns the tables.
      const { rows } = await db.query('select count(*)::int as n from public.households')
      expect(rows[0].n).toBe(1)

      // The same read as an unjoined device must see nothing. If these two ever
      // agree, the suite has stopped testing row-level security.
      const seen = await asDevice(db, strangerDevice, async () => {
        const { rows: r } = await db.query('select count(*)::int as n from public.households')
        return r[0].n
      })
      expect(seen).toBe(0)
    })

    it('every migration is re-runnable in order, which is how they are actually applied', async () => {
      // A human pastes these into a SQL editor; a re-paste after a partial
      // failure is the normal path. 0001 records a version of itself that failed
      // on the second run.
      //
      // The whole list in order is the real scenario and is asserted here. What
      // is NOT asserted anywhere, deliberately, is re-pasting a single older
      // file on top of a newer one: after 0007 that restores the retired model,
      // and the per-migration suites now build a database through their own
      // migration rather than reusing this one. See databaseThrough().
      const second = await attempt(async () => {
        for (const name of MIGRATIONS) await db.exec(migrationSql(name))
      })
      expect(second.error).toBeNull()
    })

    it('REGRESSION: a re-paste does not clear the identities the last one established', async () => {
      // 0007 clears every `claimed_by` on its first application, because the
      // values it inherits are anonymous DEVICE ids. Doing it twice clears the
      // PERSON ids the Edge Function has since written, and the household loses
      // access to its own data with no recovery from the app — the exact state
      // the migration's own ordering note calls unrecoverable.
      //
      // Measured 2026-08-11: the statement was unguarded and a second paste took
      // the count from 1 to 0. It was silent — the migration reported success
      // both times. Two guards were tried; the first (does household_devices
      // exist?) still read "first run", because re-pasting the list runs 0001
      // again and 0001 recreates that table.
      const before = await db.query(
        'select count(*)::int as n from public.members where claimed_by is not null',
      )
      expect(before.rows[0].n).toBeGreaterThan(0)

      for (const name of MIGRATIONS) await db.exec(migrationSql(name))

      const afterList = await db.query(
        'select count(*)::int as n from public.members where claimed_by is not null',
      )
      expect(afterList.rows[0].n).toBe(before.rows[0].n)

      // And the same file on its own, which is the other way a human re-applies
      // it — the two paths reach the guard differently.
      await db.exec(migrationSql('0007_per_member_auth.sql'))
      const afterOne = await db.query(
        'select count(*)::int as n from public.members where claimed_by is not null',
      )
      expect(afterOne.rows[0].n).toBe(before.rows[0].n)

      // The household is still reachable, which is the thing that actually
      // matters — a surviving count with a denied policy would be no comfort.
      const seen = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select count(*)::int as n from public.households')
        return rows[0].n
      })
      expect(seen).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — the household is the scoping entity
  // -------------------------------------------------------------------------

  describe('AC 1 — the household scopes everything', () => {
    it('is created with an organizer who is a real member, already claimed by their creator', async () => {
      // The claim is the load-bearing half after 0007. A household whose
      // organizer row is unclaimed is visible to nobody — including the person
      // who just made it — because every policy resolves through
      // current_household_ids(). create_household does both writes in one
      // statement for exactly that reason.
      expect(household.organizer_member_id).toBeTruthy()

      const organizer = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.members where id = $1`, [
          organizerId,
        ])
        return rows[0]
      })
      expect(organizer.display_name).toBe('Placeholder Organizer')
      expect(organizer.claimed_by).toBe(organizerDevice)
      // No address: the organizer was created without one, which is the
      // discriminator saying "this member signs in with a synthetic address and
      // a PIN". It is not a missing value.
      expect(organizer.email).toBeNull()
    })

    it('a device in one household cannot see another household or its people', async () => {
      const other = await asDevice(db, strangerDevice, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Other Household',
          'Other Organizer',
        ])
        return rows[0]
      })

      // The members half cannot ask `where household_id = $1` any more: #62
      // withholds `household_id` from the members SELECT grant, so naming it in
      // a WHERE is `permission denied for table members` — the withholding
      // working, and a refusal that would satisfy a naive assertion for the
      // wrong reason. So this counts everything the caller CAN see and checks
      // the other family is not in it, by name rather than by household.
      const visible = await asDevice(db, organizerDevice, async () => {
        const { rows: hh } = await db.query(
          'select count(*)::int as n from public.households where id = $1',
          [other.id],
        )
        const { rows: mm } = await db.query('select display_name from public.members')
        return { households: hh[0].n, names: mm.map((r) => r.display_name).sort() }
      })
      expect(visible.households).toBe(0)
      expect(visible.names).toEqual(['Placeholder Child', 'Placeholder Organizer'])
      expect(visible.names).not.toContain('Other Organizer')

      // POSITIVE CONTROL: the other household's organizer really does exist, so
      // the absence above is a policy refusing rather than an empty database.
      const { rows } = await db.query(
        'select count(*)::int as n from public.members where display_name = $1',
        ['Other Organizer'],
      )
      expect(rows[0].n).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // #62 AC 3 — the new membership predicate: identity is claimed_by, and
  // nothing else
  // -------------------------------------------------------------------------

  describe('#62 — membership resolves through claimed_by', () => {
    it('identifies the signed-in person, and attributes to them and to no one else', async () => {
      const seenByChild = await asDevice(db, childDevice, async () => {
        const { rows } = await db.query(
          'select id, display_name from public.members where claimed_by = $1',
          [childDevice],
        )
        return rows
      })
      expect(seenByChild).toHaveLength(1)
      expect(seenByChild[0].id).toBe(childId)
      expect(seenByChild[0].display_name).toBe('Placeholder Child')

      // The organizer's phone resolves to the organizer, not to the child —
      // "attributed to them and to no one else" needs the second half to mean
      // anything.
      const seenByOrganizer = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select id from public.members where claimed_by = $1', [
          organizerDevice,
        ])
        return rows
      })
      expect(seenByOrganizer).toHaveLength(1)
      expect(seenByOrganizer[0].id).toBe(organizerId)
    })

    it('a member row nobody has claimed is inert — it grants access to nothing', async () => {
      // The state every member is in between `alter table ... set claimed_by =
      // null` and their provisioning. Adding a roster row is ordinary household
      // maintenance and must not hand anybody a way in.
      const unclaimed = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `insert into public.members (household_id, display_name, weekly_minutes)
           values ($1, 'Not Yet Provisioned', 60) returning id`,
          [household.id],
        )
        return rows[0].id
      })

      const phone = await newDevice(db)
      const seen = await asDevice(db, phone, async () => {
        const { rows: h } = await db.query('select count(*)::int as n from public.households')
        const { rows: m } = await db.query('select count(*)::int as n from public.members')
        return { households: h[0].n, members: m[0].n }
      })
      expect(seen).toEqual({ households: 0, members: 0 })

      // POSITIVE CONTROL: the row really is there — the read above returned
      // zero because of the policy, not because the insert failed.
      const { rows } = await db.query('select claimed_by from public.members where id = $1', [
        unclaimed,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].claimed_by).toBeNull()
    })

    it('clearing every claim makes the household invisible to everyone — the re-claim hazard, asserted', async () => {
      // 0007 section 9 does exactly this to live rows, and warns that between
      // the statement and the first provision the household is reachable by
      // nobody from the client. That is severe enough to be worth a test rather
      // than only a comment: if it ever stops being true, the ordering warning
      // in the migration is wrong and somebody will find out on production.
      await db.query('update public.members set claimed_by = null')

      for (const [label, device] of [
        ['the organizer', () => organizerDevice],
        ['the child', () => childDevice],
      ]) {
        const seen = await asDevice(db, device(), async () => {
          const { rows } = await db.query('select count(*)::int as n from public.households')
          return rows[0].n
        })
        expect(seen, `${label} could still see the household`).toBe(0)
      }

      // And it is recoverable exactly one way: service_role re-attaching the
      // organizer, which is what the Edge Function does and what step 2 of the
      // migration's ordering note means.
      await provisionMember(db, organizerId, organizerDevice)
      const recovered = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select count(*)::int as n from public.households')
        return rows[0].n
      })
      expect(recovered).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — the rules survive a client that ignores the RPCs
  // -------------------------------------------------------------------------

  describe('AC 3 — the rules survive a client that ignores the RPCs', () => {
    it('REGRESSION: a household member cannot take an identity by writing claimed_by directly', async () => {
      // The oldest regression in this file and the one #62 makes most serious.
      // Before 0002 this write succeeded (see the mutation evidence at the foot
      // of this file). After 0007 succeeding would not merely mis-attribute a
      // completion — `claimed_by` is the whole membership predicate, so the
      // writer becomes that person everywhere at once.
      const bypass = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query('update public.members set claimed_by = $1 where id = $2', [
            childDevice,
            organizerId,
          ]),
        ),
      )
      expect(bypass.ok).toBe(false)
      expect(bypass.error).toMatch(/permission denied/i)

      const stillOrganizer = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select claimed_by from public.members where id = $1', [
          organizerId,
        ])
        return rows[0].claimed_by
      })
      expect(stillOrganizer).toBe(organizerDevice)
    })

    it('a client cannot smuggle an identity in at INSERT time either', async () => {
      // The update grant and the insert grant are separate lists, so refusing
      // one says nothing about the other. `claimed_by` is absent from both.
      const withClaim = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query(
            `insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
             values ($1, $2, $3, $4)`,
            [household.id, 'Smuggled', 10, childDevice],
          ),
        ),
      )
      expect(withClaim.ok).toBe(false)
      expect(withClaim.error).toMatch(/permission denied/i)
    })

    it('but the roster is still editable inside the household — 0001 decided that and it stands', async () => {
      const edit = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query(
            'update public.members set display_name = $1, weekly_minutes = $2 where id = $3',
            ['Renamed Placeholder', 200, childId],
          ),
        ),
      )
      expect(edit.error).toBeNull()
    })

    it('and an address is editable, because correcting a typo is roster maintenance', async () => {
      const edit = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('update public.members set email = $1 where id = $2', [
            'child@example.com',
            childId,
          ]),
        ),
      )
      expect(edit.error).toBeNull()
    })

    it('a device that has not joined sees nothing at all — not an empty household, nothing', async () => {
      const seen = await asDevice(db, strangerDevice, async () => {
        const { rows: h } = await db.query('select count(*)::int as n from public.households')
        const { rows: m } = await db.query('select count(*)::int as n from public.members')
        return { households: h[0].n, members: m[0].n }
      })
      expect(seen).toEqual({ households: 0, members: 0 })
    })
  })

  // -------------------------------------------------------------------------
  // #62 AC 4 — every policy re-pointed by 0007 is re-proven
  //
  // Written after a mutation pass over all fourteen, in which SEVEN reddened
  // nothing. That is the finding this block exists to close, and the two causes
  // are worth stating because neither is visible by reading a test:
  //
  //   1. RETURNING is filtered by the SELECT policy. Every insert helper in this
  //      suite ends `returning <columns>`, so neutralising an INSERT policy left
  //      the write SUCCEEDING while the returned row was withheld — and the test,
  //      which asserted /row-level security/i, matched that refusal and passed.
  //      Measured 2026-08-11: with `chores_insert_same_household` set to
  //      `with check (true)`, a cross-household insert through the helper still
  //      "refused", and the same insert without RETURNING landed a real row in
  //      the other family's household. A refusal was asserted and a refusal
  //      occurred; it was not the one under test.
  //
  //   2. UPDATE and DELETE policies are masked by the SELECT policy. A row the
  //      caller cannot see is not a row they can update or delete, so the write
  //      matches nothing and the assertion holds whatever the update policy says.
  //      That masking is a property of the model rather than a defect, and it
  //      cannot be removed by writing a better cross-household fixture: the two
  //      policies carry the same predicate, so there is no caller who can see the
  //      row and not write it. Stated rather than papered over — the catalog
  //      assertion below is what actually guards those four.
  // -------------------------------------------------------------------------

  describe('#62 AC 4 — the re-pointed policies', () => {
    // table, policy, command. Fourteen rows, which is the number 0007 section 3
    // re-points; a fifteenth appearing here without a matching policy is as much
    // a failure as a missing one.
    const REPOINTED = [
      ['households', 'households_select_joined', 'SELECT'],
      ['households', 'households_update_joined', 'UPDATE'],
      ['members', 'members_select_same_household', 'SELECT'],
      ['members', 'members_insert_same_household', 'INSERT'],
      ['members', 'members_update_same_household', 'UPDATE'],
      ['members', 'members_delete_same_household', 'DELETE'],
      ['chores', 'chores_select_same_household', 'SELECT'],
      ['chores', 'chores_insert_same_household', 'INSERT'],
      ['chores', 'chores_update_same_household', 'UPDATE'],
      ['chores', 'chores_delete_same_household', 'DELETE'],
      ['member_capacity', 'member_capacity_select_same_household', 'SELECT'],
      ['member_capacity', 'member_capacity_insert_same_household', 'INSERT'],
      ['member_capacity', 'member_capacity_update_same_household', 'UPDATE'],
      ['member_capacity', 'member_capacity_delete_same_household', 'DELETE'],
    ]

    it('all fourteen exist, on the right table and command, and none is permissive', async () => {
      // The guard for the four that outcome tests structurally cannot isolate.
      // A policy quietly loosened to `using (true)` — the exact mutation the pass
      // used — has no predicate referencing the membership function, so it fails
      // here even where no behavioural test can see it.
      const { rows } = await db.query(
        `select tablename, policyname, cmd,
                coalesce(qual, '') || ' ' || coalesce(with_check, '') as predicate
         from pg_policies where schemaname = 'public'`,
      )
      const found = new Map(rows.map((r) => [r.policyname, r]))

      for (const [table, policy, cmd] of REPOINTED) {
        const row = found.get(policy)
        expect(row, `${policy} is missing entirely`).toBeDefined()
        expect(row.tablename, `${policy} is on the wrong table`).toBe(table)
        expect(row.cmd, `${policy} is on the wrong command`).toBe(cmd)
        expect(
          row.predicate,
          `${policy} does not resolve membership through current_household_ids — it is permissive or keyed on something else`,
        ).toMatch(/current_household_ids/)
      }
    })

    it('and no policy anywhere still resolves through the dropped device table', async () => {
      const { rows } = await db.query(
        `select policyname,
                coalesce(qual, '') || ' ' || coalesce(with_check, '') as predicate
         from pg_policies where schemaname = 'public'`,
      )
      const stale = rows.filter((r) => /household_devices/.test(r.predicate))
      expect(stale.map((r) => r.policyname)).toEqual([])
      // POSITIVE CONTROL: the predicate column is really populated, so the empty
      // result above is a fact and not an empty read.
      expect(rows.length).toBeGreaterThanOrEqual(REPOINTED.length)
      expect(rows.some((r) => /current_household_ids/.test(r.predicate))).toBe(true)
    })

    it('ISOLATION: a cross-household chore insert lands no row — asserted without RETURNING', async () => {
      // Deliberately no RETURNING. With it, the SELECT policy withholds the new
      // row and raises an error that reads exactly like the insert being refused,
      // so this assertion would hold with the insert policy switched off.
      const other = await asDevice(db, strangerDevice, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Other Household',
          'Other Organizer',
        ])
        return rows[0]
      })

      const refused = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on)
             values ($1, 'Smuggled', 10, '2026-08-10')`,
            [other.id],
          ),
        ),
      )
      expect(refused.ok).toBe(false)

      // The load-bearing half: read as the owner, bypassing RLS entirely, and
      // count. A refusal that still wrote would satisfy the line above.
      const { rows } = await db.query(
        'select count(*)::int as n from public.chores where household_id = $1',
        [other.id],
      )
      expect(rows[0].n).toBe(0)
    })

    it('ISOLATION: a cross-household member insert lands no row either', async () => {
      const other = await asDevice(db, strangerDevice, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Other Household',
          'Other Organizer',
        ])
        return rows[0]
      })

      const refused = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query(
            `insert into public.members (household_id, display_name, weekly_minutes)
             values ($1, 'Smuggled', 60)`,
            [other.id],
          ),
        ),
      )
      expect(refused.ok).toBe(false)

      // The other household has exactly its organizer, and nobody else.
      const { rows } = await db.query(
        'select count(*)::int as n from public.members where household_id = $1',
        [other.id],
      )
      expect(rows[0].n).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // #62 AC 5 — the old credential path is gone, not merely unused
  // -------------------------------------------------------------------------

  describe('#62 — no client-reachable route to the retired credential path survives', () => {
    const RETIRED_FUNCTIONS = [
      'claim_member',
      'claim_member_with_pin',
      'set_member_pin',
      'join_household',
      'generate_join_code',
      'assert_valid_pin',
    ]

    it('every retired function is absent from the catalog', async () => {
      const { rows } = await db.query(
        `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1)`,
        [RETIRED_FUNCTIONS],
      )
      expect(rows.map((r) => r.proname).sort()).toEqual([])
    })

    it('POSITIVE CONTROL: the same query finds the functions that survived', async () => {
      // Without this, a typo in the schema name or a query that can only ever
      // return nothing would pass the test above while proving the opposite of
      // what it claims.
      const { rows } = await db.query(
        `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1)`,
        [['create_household', 'current_household_ids', 'complete_chore', 'assign_chore']],
      )
      expect(rows.map((r) => r.proname).sort()).toEqual([
        'assign_chore',
        'complete_chore',
        'create_household',
        'current_household_ids',
      ])
    })

    it('and the columns that carried the credential are gone with it', async () => {
      const columnsOf = async (table) => {
        const { rows } = await db.query(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1`,
          [table],
        )
        return rows.map((r) => r.column_name)
      }

      const members = await columnsOf('members')
      expect(members).not.toContain('pin_hash')
      expect(members).not.toContain('has_pin')
      expect(members).toEqual(expect.arrayContaining(['claimed_by', 'email']))

      const households = await columnsOf('households')
      expect(households).not.toContain('join_code')
      expect(households).toEqual(expect.arrayContaining(['id', 'name', 'timezone']))
    })

    it('and the device table it all hung from is gone', async () => {
      const { rows } = await db.query(
        `select table_name from information_schema.tables
         where table_schema = 'public' order by table_name`,
      )
      const tables = rows.map((r) => r.table_name)
      expect(tables).not.toContain('household_devices')
      // POSITIVE CONTROL, same reason as above: the read does find the tables
      // that remain, so "not present" is a fact rather than an empty answer.
      expect(tables).toEqual(
        expect.arrayContaining(['households', 'members', 'chores', 'member_capacity']),
      )
    })

    it('REGRESSION: the readable column list this file uses is the list the grant actually gives', async () => {
      // The constant at the top of this file is used by assertions that would
      // still pass if it drifted — `select id, display_name` succeeds whether or
      // not the constant is complete. This compares it to the grant itself.
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'members'
            and grantee = 'authenticated' and privilege_type = 'SELECT'
          order by column_name`,
      )
      const granted = rows.map((r) => r.column_name)
      const used = READABLE.split(',').map((c) => c.trim()).sort()
      expect(granted).toEqual(used)
    })
  })

  // -------------------------------------------------------------------------
  // #62 AC 1 — the identifier, and the nullability that discriminates
  // -------------------------------------------------------------------------

  describe('#62 — the address is actually written, not just declarable', () => {
    // The defect this closes: `email` was declared the credential-type
    // discriminator, granted for insert and update, and written by NOTHING. It
    // was a constant null for every member — including the organizer, the one
    // person guaranteed to have a real address — so the column said "synthetic
    // address and a PIN" about somebody signing in with neither.

    it('copies the organizer’s real address from auth.users at creation', async () => {
      const signedUp = await newDevice(db, 'alex@example.com')
      const made = await asDevice(db, signedUp, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Theirs',
          'Alex',
        ])
        return rows[0]
      })

      const { rows } = await db.query('select email, claimed_by from public.members where id = $1', [
        made.organizer_member_id,
      ])
      expect(rows[0].email).toBe('alex@example.com')
      expect(rows[0].claimed_by).toBe(signedUp)
    })

    it('and takes it from the auth account rather than from a parameter', async () => {
      // `create_household` has no email argument, deliberately: a parameter can
      // be passed an address different from the one the account actually has,
      // and nothing would ever notice. Reading `auth.users` makes the two
      // incapable of disagreeing.
      const signedUp = await newDevice(db, 'someone@example.com')
      const made = await asDevice(db, signedUp, async () => {
        const { rows } = await db.query(
          `select * from public.create_household('H', 'Person')`,
        )
        return rows[0]
      })
      const { rows } = await db.query('select email from public.members where id = $1', [
        made.organizer_member_id,
      ])
      expect(rows[0].email).toBe('someone@example.com')
    })

    it('leaves it null for a member with no auth account, which is what null MEANS', async () => {
      // This file's own fixture organizer has no address on their auth row, and
      // the child was provisioned without one. Null here is the discriminator
      // saying "synthetic address and a PIN", not a column nobody filled in.
      const { rows } = await db.query(
        'select email from public.members where id = any($1)',
        [[organizerId, childId]],
      )
      expect(rows.map((r) => r.email)).toEqual([null, null])
    })
  })

  describe('#62 — you cannot delete yourself out of your own household', () => {
    it('REFUSES deleting the row you are signed in as', async () => {
      // Under device auth this was survivable: `household_devices` carried
      // membership independently, so removing your member row left you in the
      // household. 0007 makes `claimed_by` the sole predicate, so the same
      // delete locks you out with no client-side recovery — and the client did
      // not change at all, which is why the guard is in the policy.
      const refused = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('delete from public.members where id = $1', [organizerId]),
        ),
      )
      // RLS filters rather than raising: the row is simply not deletable, so the
      // statement affects nothing. Asserting the ROW SURVIVES is the real check
      // — an assertion on the error alone would pass on a silent no-op either
      // way, which is the same shape as a refusal that still wrote.
      expect(refused.ok).toBe(true)
      const { rows } = await db.query('select claimed_by from public.members where id = $1', [
        organizerId,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].claimed_by).toBe(organizerDevice)

      // And the household is still reachable, which is the thing that actually
      // matters.
      const seen = await asDevice(db, organizerDevice, async () => {
        const { rows: r } = await db.query('select count(*)::int as n from public.households')
        return r[0].n
      })
      expect(seen).toBe(1)
    })

    it('POSITIVE CONTROL: removing somebody else still works, so this is not a blanket refusal', async () => {
      // Without this the guard could be `using (false)` and the test above would
      // still pass — the roster would simply be uneditable, which is a different
      // and worse bug.
      const spare = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `insert into public.members (household_id, display_name, weekly_minutes)
           values ($1, 'Spare', 30) returning id`,
          [household.id],
        )
        return rows[0].id
      })
      await asDevice(db, organizerDevice, () =>
        db.query('delete from public.members where id = $1', [spare]),
      )
      const { rows } = await db.query('select count(*)::int as n from public.members where id = $1', [
        spare,
      ])
      expect(rows[0].n).toBe(0)
    })
  })

  describe('#62 — the wildcard select still refuses', () => {
    it('refuses select(*) on members, because one column is withheld', async () => {
      // 0002 established revoke-wholesale-then-grant-per-column so that
      // `select('*')` fails outright rather than quietly omitting a column, and
      // four separate comments still say so. That property was NOT a property of
      // the grant shape — it held because `pin_hash` was withheld, and 0007
      // drops `pin_hash`. Every remaining column being granted would have made
      // the wildcard start succeeding while every one of those comments went on
      // asserting the opposite.
      //
      // `household_id` is withheld instead, which is what `chores` (0003) and
      // `member_capacity` (0005) already do with the same column.
      const refused = await attempt(() =>
        asDevice(db, organizerDevice, () => db.query('select * from public.members')),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })

    it('POSITIVE CONTROL: the explicit column list the client uses still works', async () => {
      const allowed = await attempt(() =>
        asDevice(db, organizerDevice, () => db.query(`select ${READABLE} from public.members`)),
      )
      expect(allowed.error).toBeNull()
    })
  })

  describe('#62 — the address is the discriminator between the two credentials', () => {
    it('accepts a real address and rejects one that is not address-shaped', async () => {
      const ok = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('update public.members set email = $1 where id = $2', [
            'alex@example.com',
            organizerId,
          ]),
        ),
      )
      expect(ok.error).toBeNull()

      const bad = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('update public.members set email = $1 where id = $2', ['not-an-address', childId]),
        ),
      )
      expect(bad.ok).toBe(false)
      expect(bad.error).toMatch(/members_email_shape/)
    })

    it('refuses two members of ONE household sharing an address, case-insensitively', async () => {
      await asDevice(db, organizerDevice, () =>
        db.query('update public.members set email = $1 where id = $2', [
          'shared@example.com',
          organizerId,
        ]),
      )

      const clash = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('update public.members set email = $1 where id = $2', [
            'SHARED@example.com',
            childId,
          ]),
        ),
      )
      expect(clash.ok).toBe(false)
      expect(clash.error).toMatch(/members_household_email_key/)
    })

    it('but any number of members may have no address at all', async () => {
      // The unique index is partial for this reason: a household of children,
      // none of whom has an inbox, is the ordinary case rather than an edge one.
      const added = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query(
            `insert into public.members (household_id, display_name, weekly_minutes)
             values ($1, 'Second Child', 60), ($1, 'Third Child', 60)`,
            [household.id],
          ),
        ),
      )
      expect(added.error).toBeNull()

      const { rows } = await db.query(
        'select count(*)::int as n from public.members where email is null and household_id = $1',
        [household.id],
      )
      expect(rows[0].n).toBe(4)
    })
  })
})

describe('the bypass this migration closes', () => {
  it('MUTATION EVIDENCE: with 0001 alone, writing claimed_by directly succeeds', async () => {
    // Applies ONLY the first migration, reproducing the state measured against
    // the live project on 2026-08-06. If this ever starts failing, 0001 has been
    // changed and the story of why 0002 exists needs rewriting — which is worth
    // being told about.
    //
    // Every call below is at 0001's vintage: a one-argument `create_household`,
    // `claim_member`, `join_household`. Those are facts about the migration under
    // mutation, not about the head of the schema, so they deliberately did not
    // follow 0007's signature change.
    const db = await PGlite.create({ extensions: { pgcrypto } })
    await db.exec(`
      create schema if not exists auth;
      create schema if not exists extensions;
      create extension if not exists pgcrypto with schema extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      grant usage on schema public, extensions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create table auth.users (id uuid primary key default gen_random_uuid());
      create or replace function auth.uid() returns uuid language sql stable as $stub$
        select nullif(current_setting('test.uid', true), '')::uuid
      $stub$;
    `)
    await db.exec(migrationSql(MIGRATIONS[0]))

    const deviceA = (await db.query('insert into auth.users default values returning id')).rows[0].id
    const deviceB = (await db.query('insert into auth.users default values returning id')).rows[0].id

    const setup = async (uid, fn) => {
      await db.exec('set role authenticated')
      await db.query(`select set_config('test.uid', $1, false)`, [uid])
      try {
        return await fn()
      } finally {
        await db.exec('reset role')
      }
    }

    const hh = await setup(deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1)', ['TEST'])
      return rows[0]
    })
    const member = await setup(deviceA, async () => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, 'Placeholder', 60) returning id`,
        [hh.id],
      )
      return rows[0]
    })
    await setup(deviceA, () => db.query('select public.claim_member($1)', [member.id]))
    await setup(deviceB, () => db.query('select public.join_household($1)', [hh.join_code]))

    // The RPC refuses...
    const viaRpc = await attempt(() =>
      setup(deviceB, () => db.query('select public.claim_member($1)', [member.id])),
    )
    expect(viaRpc.ok).toBe(false)
    expect(viaRpc.error).toMatch(/already claimed/i)

    // ...and going around it works, which is the defect.
    const direct = await attempt(() =>
      setup(deviceB, () =>
        db.query('update public.members set claimed_by = $1 where id = $2', [deviceB, member.id]),
      ),
    )
    expect(direct.ok, 'expected the pre-0002 bypass to succeed').toBe(true)

    const stolen = await setup(deviceA, async () => {
      const { rows } = await db.query('select claimed_by from public.members where id = $1', [
        member.id,
      ])
      return rows[0].claimed_by
    })
    expect(stolen).toBe(deviceB)
  })
})

describe('#127 — membership is per household, not per database', () => {
  // 0009. Found by RUNNING the live RLS suite for the first time: one signed-in
  // person creating two households failed at setup, which is a fact about the
  // schema rather than about the suite. The reasoning lives in the migration.
  // These assert both halves of it — what 0009 opens, and what it must not.

  it('one person may create, and belong to, two households', async () => {
    const db = await freshDatabase()
    const uid = await newDevice(db, 'organizer@example.com')

    const made = await asDevice(db, uid, async () => ({
      first: await attempt(() =>
        db.query('select public.create_household($1, $2, $3)', ['Placeholder Household', 'Organizer', 'UTC']),
      ),
      second: await attempt(() =>
        db.query('select public.create_household($1, $2, $3)', ['Placeholder Other Household', 'Organizer', 'UTC']),
      ),
    }))

    // Before 0009 the second call raised 23505 on members_claimed_by_key. That
    // is the exact failure the live suite hit on 2026-08-21.
    expect(made.first.error).toBeNull()
    expect(made.second.error).toBeNull()

    const { rows } = await db.query(
      'select count(distinct household_id)::int as n from public.members where claimed_by = $1',
      [uid],
    )
    expect(rows[0].n).toBe(2)
    await db.close()
  })

  it('their address is written into both member rows, which the global email index forbade', async () => {
    // The second half of the fix, and the one that is easy to miss: rescoping
    // claimed_by alone moves the failure to members_email_key rather than
    // removing it, because create_household copies the organizer's address out
    // of auth.users every time it runs. Measured before 0009 was written.
    const db = await freshDatabase()
    const uid = await newDevice(db, 'organizer@example.com')

    await asDevice(db, uid, async () => {
      await db.query('select public.create_household($1, $2, $3)', ['Placeholder Household', 'Organizer', 'UTC'])
      await db.query('select public.create_household($1, $2, $3)', ['Placeholder Other Household', 'Organizer', 'UTC'])
    })

    const { rows } = await db.query(
      'select count(*)::int as n from public.members where lower(email) = $1',
      ['organizer@example.com'],
    )
    expect(rows[0].n).toBe(2)
    await db.close()
  })

  it('but within ONE household a person still claims at most one member row', async () => {
    // The rule 0001 wrote the index for, and the only part of it that was ever
    // about ambiguity: "who did this" must stay answerable. 0009 narrows the
    // index's reach across households and leaves this exactly as it was, so a
    // green result here is what stops the fix being a deletion.
    const db = await freshDatabase()
    const uid = await newDevice(db, 'organizer@example.com')

    const householdId = await asDevice(db, uid, async () => {
      const { rows } = await db.query('select (public.create_household($1, $2, $3)).id as id', [
        'Placeholder Household', 'Organizer', 'UTC',
      ])
      return rows[0].id
    })

    const spare = await asDevice(db, uid, async () => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, 'Spare', 30) returning id`,
        [householdId],
      )
      return rows[0].id
    })

    const doubled = await attempt(() => provisionMember(db, spare, uid))
    expect(doubled.ok).toBe(false)
    expect(doubled.error).toMatch(/members_household_claimed_by_key/)
    await db.close()
  })

  it('re-pasting 0009 is a no-op, because a re-paste is the normal path', async () => {
    const db = await freshDatabase()
    const again = await attempt(() => db.exec(migrationSql('0009_membership_is_per_household.sql')))
    expect(again.error).toBeNull()

    const { rows } = await db.query(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'members'
        order by indexname`,
    )
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('members_household_claimed_by_key')
    expect(names).toContain('members_household_email_key')
    expect(names).not.toContain('members_claimed_by_key')
    expect(names).not.toContain('members_email_key')
    await db.close()
  })
})
