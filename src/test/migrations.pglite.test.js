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
// The centrepiece is `claimed_by`. Measured against the live project on
// 2026-08-06, before 0002: `claim_member()` correctly refused device B, and a
// direct `update members set claimed_by = B` succeeded anyway. The guard was
// real and optional. Several tests below exist to keep it from becoming optional
// again, and they fail against 0001 alone.

import { beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { asDevice, attempt, freshDatabase, migrationSql, MIGRATIONS, newDevice } from './support/pgliteSupabase.js'

const ORGANIZER_PIN = '4821'
const CHILD_PIN = '1357'

/** The columns a client is allowed to read. Named once so a drift is one edit. */
const READABLE = 'id, household_id, display_name, weekly_minutes, claimed_by, has_pin, created_at'

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
      const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
        'Placeholder Household',
        'Placeholder Organizer',
        ORGANIZER_PIN,
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

    await asDevice(db, childDevice, () =>
      db.query('select public.join_household($1)', [household.join_code]),
    )
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

    it('both migrations are re-runnable, which is how they are actually applied', async () => {
      // A human pastes these into a SQL editor; a re-paste after a partial
      // failure is the normal path. 0001 records a version of itself that failed
      // on the second run.
      const second = await attempt(async () => {
        for (const name of MIGRATIONS) await db.exec(migrationSql(name))
      })
      expect(second.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — the household is the scoping entity
  // -------------------------------------------------------------------------

  describe('AC 1 — the household scopes everything', () => {
    it('is created with a readable join code and an organizer who is a real member', async () => {
      expect(household.join_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/)
      expect(household.organizer_member_id).toBeTruthy()

      const organizer = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          `select ${READABLE} from public.members where id = $1`,
          [organizerId],
        )
        return rows[0]
      })
      expect(organizer.display_name).toBe('Placeholder Organizer')
      expect(organizer.claimed_by).toBe(organizerDevice)
      expect(organizer.has_pin).toBe(true)
    })

    it('a device in one household cannot see another household or its people', async () => {
      const other = await asDevice(db, strangerDevice, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [
          'Other Household',
          'Other Organizer',
          '9999',
        ])
        return rows[0]
      })

      const visible = await asDevice(db, organizerDevice, async () => {
        const { rows: hh } = await db.query('select count(*)::int as n from public.households where id = $1', [other.id])
        const { rows: mm } = await db.query('select count(*)::int as n from public.members where household_id = $1', [other.id])
        return { households: hh[0].n, members: mm[0].n }
      })
      expect(visible).toEqual({ households: 0, members: 0 })
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the organizer creates and resets credentials
  // -------------------------------------------------------------------------

  describe('AC 2 — only the organizer sets a credential', () => {
    it('the organizer can set a PIN on a member', async () => {
      const result = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('select public.set_member_pin($1, $2)', [childId, CHILD_PIN]),
        ),
      )
      expect(result.error).toBeNull()

      const hasPin = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select has_pin from public.members where id = $1', [childId])
        return rows[0].has_pin
      })
      expect(hasPin).toBe(true)
    })

    it('another member of the same household cannot — being inside the household is not being the organizer', async () => {
      const result = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query('select public.set_member_pin($1, $2)', [childId, '0000']),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/only the household organizer/i)
    })

    it('a stranger cannot, and is refused for the same reason rather than a different one', async () => {
      const result = await attempt(() =>
        asDevice(db, strangerDevice, () =>
          db.query('select public.set_member_pin($1, $2)', [childId, '0000']),
        ),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/only the household organizer/i)
    })

    it('a reset releases the phone currently acting as that person', async () => {
      await asDevice(db, organizerDevice, () =>
        db.query('select public.set_member_pin($1, $2)', [childId, CHILD_PIN]),
      )
      await asDevice(db, childDevice, () =>
        db.query('select public.claim_member_with_pin($1, $2)', [childId, CHILD_PIN]),
      )

      await asDevice(db, organizerDevice, () =>
        db.query('select public.set_member_pin($1, $2)', [childId, '2468']),
      )

      const claimedBy = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select claimed_by from public.members where id = $1', [childId])
        return rows[0].claimed_by
      })
      expect(claimedBy).toBeNull()
    })

    it('rejects a PIN too short to be a credential, at creation and at reset', async () => {
      const atCreation = await attempt(() =>
        asDevice(db, strangerDevice, () =>
          db.query('select public.create_household($1, $2, $3)', ['H', 'O', '12']),
        ),
      )
      expect(atCreation.error).toMatch(/between 4 and 12/i)

      const atReset = await attempt(() =>
        asDevice(db, organizerDevice, () => db.query('select public.set_member_pin($1, $2)', [childId, '1'])),
      )
      expect(atReset.error).toMatch(/between 4 and 12/i)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — the data layer rejects it, whatever the client does
  //
  // These are the regression tests for the measured bypass. Each one fails
  // against 0001 alone.
  // -------------------------------------------------------------------------

  describe('AC 3 — the rules survive a client that ignores the RPCs', () => {
    it('REGRESSION: a household member cannot take an identity by writing claimed_by directly', async () => {
      await asDevice(db, organizerDevice, () =>
        db.query('select public.set_member_pin($1, $2)', [childId, CHILD_PIN]),
      )

      const bypass = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query('update public.members set claimed_by = $1 where id = $2', [childDevice, organizerId]),
        ),
      )
      expect(bypass.ok).toBe(false)
      expect(bypass.error).toMatch(/permission denied/i)

      const stillOrganizer = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select claimed_by from public.members where id = $1', [organizerId])
        return rows[0].claimed_by
      })
      expect(stillOrganizer).toBe(organizerDevice)
    })

    it('REGRESSION: a member cannot set their own PIN by writing pin_hash directly', async () => {
      const forged = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query('update public.members set pin_hash = $1 where id = $2', ['anything', childId]),
        ),
      )
      expect(forged.ok).toBe(false)
      expect(forged.error).toMatch(/permission denied/i)
    })

    it('REGRESSION: nobody can read a PIN hash, so a four-digit PIN cannot be attacked offline', async () => {
      await asDevice(db, organizerDevice, () =>
        db.query('select public.set_member_pin($1, $2)', [childId, CHILD_PIN]),
      )

      for (const [label, device] of [
        ['the organizer', () => organizerDevice],
        ['another member', () => childDevice],
      ]) {
        const read = await attempt(() =>
          asDevice(db, device(), () => db.query('select pin_hash from public.members where id = $1', [childId])),
        )
        expect(read.ok, `${label} could read pin_hash`).toBe(false)
        expect(read.error).toMatch(/permission denied/i)
      }
    })

    it('a client cannot smuggle a credential or an identity in at INSERT time', async () => {
      const withPin = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query(
            `insert into public.members (household_id, display_name, weekly_minutes, pin_hash)
             values ($1, $2, $3, $4)`,
            [household.id, 'Smuggled', 10, 'known-hash'],
          ),
        ),
      )
      expect(withPin.ok).toBe(false)
      expect(withPin.error).toMatch(/permission denied/i)

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
          db.query('update public.members set display_name = $1, weekly_minutes = $2 where id = $3', [
            'Renamed Placeholder',
            200,
            childId,
          ]),
        ),
      )
      expect(edit.error).toBeNull()
    })

    it('and has_pin is readable, because the sign-in screen has to know which it is', async () => {
      const read = await attempt(() =>
        asDevice(db, childDevice, () => db.query('select has_pin from public.members where id = $1', [childId])),
      )
      expect(read.error).toBeNull()
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
  // Claiming a person, which is what the credential is for
  // -------------------------------------------------------------------------

  describe('claiming', () => {
    beforeEach(async () => {
      await asDevice(db, organizerDevice, () =>
        db.query('select public.set_member_pin($1, $2)', [childId, CHILD_PIN]),
      )
    })

    it('the PIN-less route refuses a person who has a PIN, so it is not an alternative way in', async () => {
      const result = await attempt(() =>
        asDevice(db, childDevice, () => db.query('select public.claim_member($1)', [childId])),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/has a PIN/i)
    })

    it('the right PIN claims the person', async () => {
      const result = await attempt(() =>
        asDevice(db, childDevice, () =>
          db.query('select public.claim_member_with_pin($1, $2)', [childId, CHILD_PIN]),
        ),
      )
      expect(result.error).toBeNull()

      const claimedBy = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select claimed_by from public.members where id = $1', [childId])
        return rows[0].claimed_by
      })
      expect(claimedBy).toBe(childDevice)
    })

    it('the wrong PIN does not, and does not say whether the person or the PIN was wrong', async () => {
      const result = await attempt(() =>
        asDevice(db, childDevice, () => db.query('select public.claim_member_with_pin($1, $2)', [childId, '0000'])),
      )
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/that PIN is not right/i)
      expect(result.error).not.toMatch(/member|household|exists/i)
    })

    it('the same person on a new phone can take over with their PIN — a lost phone is not a lost identity', async () => {
      await asDevice(db, childDevice, () =>
        db.query('select public.claim_member_with_pin($1, $2)', [childId, CHILD_PIN]),
      )

      const newPhone = await newDevice(db)
      await asDevice(db, newPhone, () => db.query('select public.join_household($1)', [household.join_code]))

      const result = await attempt(() =>
        asDevice(db, newPhone, () => db.query('select public.claim_member_with_pin($1, $2)', [childId, CHILD_PIN])),
      )
      expect(result.error).toBeNull()

      const claimedBy = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query('select claimed_by from public.members where id = $1', [childId])
        return rows[0].claimed_by
      })
      expect(claimedBy).toBe(newPhone)
    })

    it('one device acts as at most one person, so "who did this" is never ambiguous', async () => {
      // The organizer device already holds the organizer member. Claiming the
      // child with the correct PIN must release the first, not fail on the
      // unique index.
      const result = await attempt(() =>
        asDevice(db, organizerDevice, () =>
          db.query('select public.claim_member_with_pin($1, $2)', [childId, CHILD_PIN]),
        ),
      )
      expect(result.error).toBeNull()

      const held = await asDevice(db, organizerDevice, async () => {
        const { rows } = await db.query(
          'select count(*)::int as n from public.members where claimed_by = $1',
          [organizerDevice],
        )
        return rows[0].n
      })
      expect(held).toBe(1)
    })
  })
})

describe('the bypass this migration closes', () => {
  it('MUTATION EVIDENCE: with 0001 alone, writing claimed_by directly succeeds', async () => {
    // Applies ONLY the first migration, reproducing the state measured against
    // the live project on 2026-08-06. If this ever starts failing, 0001 has been
    // changed and the story of why 0002 exists needs rewriting — which is worth
    // being told about.
    const db = await PGlite.create({ extensions: { pgcrypto } })
    await db.exec(`
      create schema if not exists auth;
      create schema if not exists extensions;
      create extension if not exists pgcrypto with schema extensions;
      create role anon nologin;
      create role authenticated nologin;
      grant usage on schema public, extensions to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
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
    const viaRpc = await attempt(() => setup(deviceB, () => db.query('select public.claim_member($1)', [member.id])))
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
      const { rows } = await db.query('select claimed_by from public.members where id = $1', [member.id])
      return rows[0].claimed_by
    })
    expect(stolen).toBe(deviceB)
  })
})
