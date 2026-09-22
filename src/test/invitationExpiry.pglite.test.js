// @vitest-environment node
//
// `0050` and `0051` — an invitation's expiry is the database's clock, run
// against a real Postgres. Story #419.
//
// Until #419 `mintInvitation` computed `expires_at` on the phone and the
// database stamped `created_at` from its own clock, so the two stamps on one
// row came from two clocks. What this file proves that no unit test can:
//
//   * that a mint issued by `mintInvitation` ITSELF — its own payload, sent
//     through a client whose `single()` runs the insert here — succeeds with
//     the device clock wrong by more than seven days either way, and stores an
//     expiry exactly the lifetime after the stored `created_at` (AC 2);
//   * that the pre-#419 row, built on the same wrong clock, was refused or
//     stretched under `0050` alone — the positive control, without which every
//     acceptance above passes on a schema where nothing changed;
//   * that after `0051` a row NAMING `expires_at` is refused at the privilege
//     layer, so the client cannot send it even by mistake (AC 1);
//   * that the default's interval and `INVITATION_LIFETIME_DAYS` are one
//     number (AC 3), in hours rather than days, and why that matters;
//   * the re-runs, and the re-paste hazard `0051`'s header names, in both
//     directions.
//
// The node environment for the reason every pglite suite states: pglite loads
// its tarball through `Response.arrayBuffer`, which jsdom's `Response` lacks.
//
// Names are synthetic — see #19.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'
import { blankSqlComments } from './support/retiredVocabulary.js'
import { insertAsPostgrest } from './support/postgrestInsert.js'
import {
  INVITATION_LIFETIME_DAYS,
  hashInvitationCode,
  generateInvitationCode,
  invitationMintRow,
  mintInvitation,
} from '../lib/invitations.js'
import { getSupabase } from '../lib/supabase.js'

vi.mock('../lib/supabase.js', () => ({ getSupabase: vi.fn() }))

vi.setConfig({ testTimeout: 30_000 })

const BEFORE_DEFAULT = '0049_chore_assignment_history.sql'
const DEFAULT = '0050_invitation_expiry_from_the_database_clock.sql'
const WITHDRAWAL = '0051_invitation_expiry_withdrawn_from_the_client.sql'
const RECORD = '0040_invitation_record.sql'

const DAY_MS = 24 * 60 * 60 * 1000
/** The promise the card and the share message make, in seconds. */
const LIFETIME_SECONDS = INVITATION_LIFETIME_DAYS * 24 * 60 * 60

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

/**
 * A supabase-js stand-in whose one chain — `from(t).insert(row).select(c).single()`
 * — runs the insert HERE, as the organizer, from the exact object
 * `mintInvitation` handed it.
 *
 * `single()` puts the real clock back BEFORE the statement runs. pglite's
 * `now()` reads the same JavaScript clock a fake timer moves, so a mint issued
 * under a moved clock would otherwise move the SERVER's clock too, and the test
 * would compare two wrong clocks that agree. The payload is built while the
 * device's clock is wrong; the database answers on the right one.
 */
function clientAgainst(database, device, seen) {
  return {
    from: (table) => ({
      insert: (row) => {
        seen.row = row
        seen.deviceNow = Date.now()
        return {
          select: (columns) => ({
            single: async () => {
              vi.useRealTimers()
              const done = await asDevice(database, device, () =>
                attempt(() => insertAsPostgrest(database, table, row, columns)),
              )
              return done.ok
                ? { data: done.value.rows[0], error: null }
                : { data: null, error: { message: done.error } }
            },
          }),
        }
      },
    }),
  }
}

/** The stored lifetime of one invitation, in seconds, read as the owner. */
async function lifetimeOf(database, id) {
  const { rows } = await database.query(
    `select extract(epoch from expires_at - created_at)::float8 as seconds
       from public.invitations where id = $1`,
    [id],
  )
  return rows[0].seconds
}

/**
 * The row the client sent before #419: the three columns, plus an expiry the
 * phone computed from its own clock. Built by hand because the module no longer
 * can — which is the change under test.
 */
async function preFixRow(seeded, deviceNowMs) {
  return {
    ...invitationMintRow({
      householdId: seeded.household.id,
      tokenHash: await hashInvitationCode(generateInvitationCode()),
      createdByMemberId: seeded.organizer,
    }),
    expires_at: new Date(deviceNowMs + INVITATION_LIFETIME_DAYS * DAY_MS).toISOString(),
  }
}

const insertAs = (database, device, row) =>
  asDevice(database, device, () =>
    attempt(() => insertAsPostgrest(database, 'invitations', row, 'id')),
  )

afterEach(() => {
  vi.useRealTimers()
})

describe('#419 — an invitation’s expiry is stamped by the database clock', () => {
  // More than seven days, both ways — AC 2's "wrong by more than seven days in
  // either direction". Eight is the tightest reading: under the pre-#419 client
  // eight behind is the first whole day that breaks `0040`'s check, and eight
  // ahead stretches the promised seven to fifteen.
  const SKEWS = [
    ['eight days behind', -8 * DAY_MS],
    ['eight days ahead', 8 * DAY_MS],
  ]

  describe.each(SKEWS)('a phone %s', (_label, skewMs) => {
    let db, home

    beforeEach(async () => {
      db = await freshDatabase()
      home = await seedHousehold(db)
    })

    it('mints through mintInvitation, and the stored expiry is exactly the lifetime after created_at', async () => {
      const seen = {}
      getSupabase.mockReturnValue(clientAgainst(db, home.organizerDevice, seen))
      const { rows: before } = await db.query('select clock_timestamp() as t')

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(Date.now() + skewMs))
      const { invitation } = await mintInvitation({
        householdId: home.household.id,
        createdByMemberId: home.organizer,
      })
      vi.useRealTimers()
      const { rows: after } = await db.query('select clock_timestamp() as t')

      // THE INSTRUMENT'S OWN CONTROL: the payload really was built while this
      // process's clock was wrong by the skew. Without it, a fake timer that
      // never engaged would make every line below pass on the old code too.
      expect(Math.abs(seen.deviceNow - Date.now() - skewMs)).toBeLessThan(60_000)
      // The client sent no clock at all — AC 1's "no longer sends it".
      expect(Object.keys(seen.row)).not.toContain('expires_at')

      // AC 2: the insert succeeded, and the two stamps are one clock apart by
      // exactly the lifetime.
      expect(invitation?.id).toBeTruthy()
      expect(await lifetimeOf(db, invitation.id)).toBe(LIFETIME_SECONDS)
      // And `created_at` is the SERVER's instant, bracketed by the database's
      // own clock read on either side — not the phone's, which is a week out.
      const created = new Date(invitation.created_at).getTime()
      expect(created).toBeGreaterThanOrEqual(new Date(before[0].t).getTime())
      expect(created).toBeLessThanOrEqual(new Date(after[0].t).getTime())
    })

    it('POSITIVE CONTROL: the pre-#419 row, on that clock, is refused or stretched under 0050 alone', async () => {
      // `0050` alone is the schema production runs between its apply and the
      // promotion: the default exists and the client may still send a value.
      // The old client's row on this clock either breaks `0040`'s check (the
      // raw constraint message an organizer read) or lands with a lifetime that
      // is not seven days. Either outcome is the defect #419 names.
      const through = await databaseThrough(DEFAULT)
      const seeded = await seedHousehold(through)
      const made = await insertAs(through, seeded.organizerDevice, await preFixRow(seeded, Date.now() + skewMs))
      if (skewMs < 0) {
        expect(made.ok).toBe(false)
        expect(made.error).toMatch(/invitations_expires_after_creation/)
      } else {
        expect(made.ok, made.error ?? '').toBe(true)
        const seconds = await lifetimeOf(through, made.value.rows[0].id)
        expect(seconds).not.toBe(LIFETIME_SECONDS)
        expect(Math.round(seconds / 86_400)).toBe(INVITATION_LIFETIME_DAYS + 8)
      }
    })
  })

  describe('AC 1 — the client cannot send an expiry, and needs none', () => {
    it('a row NAMING expires_at is refused at the privilege layer after 0051', async () => {
      // Even an honest value. The grant is what makes "the client no longer
      // sends it" a property of the database rather than of one module.
      const db = await freshDatabase()
      const home = await seedHousehold(db)
      const refused = await insertAs(db, home.organizerDevice, await preFixRow(home, Date.now()))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied for table invitations/)
      const { rows } = await db.query('select count(*)::int as n from public.invitations')
      expect(rows[0].n).toBe(0)
    })

    it('POSITIVE CONTROL: the same honest row was accepted under 0050 alone — the refusal is 0051’s', async () => {
      const through = await databaseThrough(DEFAULT)
      const seeded = await seedHousehold(through)
      const made = await insertAs(through, seeded.organizerDevice, await preFixRow(seeded, Date.now()))
      expect(made.ok, made.error ?? '').toBe(true)
    })

    it('POSITIVE CONTROL: the new row, naming no expiry, was refused before 0050 — the default is 0050’s', async () => {
      // Under 0049 the column had no default and was `not null`, so the client
      // this story ships would have failed every mint — the other half of why
      // the owner's sequencing is 0050, promote, 0051.
      const through = await databaseThrough(BEFORE_DEFAULT)
      const seeded = await seedHousehold(through)
      const row = invitationMintRow({
        householdId: seeded.household.id,
        tokenHash: await hashInvitationCode(generateInvitationCode()),
        createdByMemberId: seeded.organizer,
      })
      const refused = await insertAs(through, seeded.organizerDevice, row)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/null value in column "expires_at"/)
    })
  })

  describe('AC 3 — the stored expiry and the promised one are one number', () => {
    const defaultOf = async (database) => {
      const { rows } = await database.query(
        `select pg_get_expr(d.adbin, d.adrelid) as expr
           from pg_attrdef d
           join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
          where d.adrelid = 'public.invitations'::regclass and a.attname = 'expires_at'`,
      )
      return rows[0]?.expr ?? null
    }

    it('the default is now() plus INVITATION_LIFETIME_DAYS × 24 hours, held in the TIME field', async () => {
      // Built FROM the constant, so changing the card's promise without the
      // migration — or the migration without the constant — reddens here. The
      // catalog's own spelling: an interval with no day field deparses as
      // `HHH:MM:SS`, and a `'7 days'` interval would deparse as `'7 days'`.
      const db = await freshDatabase()
      expect(await defaultOf(db)).toBe(`(now() + '${INVITATION_LIFETIME_DAYS * 24}:00:00'::interval)`)
    })

    it('POSITIVE CONTROL: there was no default before 0050', async () => {
      expect(await defaultOf(await databaseThrough(BEFORE_DEFAULT))).toBeNull()
    })

    it('PLATFORM FACT: a day interval is not 24 hours under a zone that keeps daylight saving', async () => {
      // Why `0050` spells the lifetime in hours. Pinned for the reason the
      // btrim fact is pinned in `invitationMint.pglite.test.js`: the migration
      // exists partly because of it, and a Postgres that changed it would make
      // the hours spelling redundant rather than wrong. The instant is the day
      // before the 2026 spring change in New York; seven days later is past it.
      const db = await freshDatabase()
      await db.exec(`set timezone = 'America/New_York'`)
      const { rows } = await db.query(
        `select extract(epoch from (t + interval '7 days') - t)::float8 as days_form,
                extract(epoch from (t + interval '168 hours') - t)::float8 as hours_form
           from (select timestamptz '2026-03-07 17:00:00+00' as t) s`,
      )
      // Literals, not `LIFETIME_SECONDS`: this is a fact about Postgres, and it
      // must not move when the app's constant does.
      expect(rows[0].days_form).toBe(7 * 86_400 - 3600)
      expect(rows[0].hours_form).toBe(7 * 86_400)
    })
  })

  describe('0051 as source, and the re-runs', () => {
    const insertable = async (database) => {
      const { rows } = await database.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'invitations'
            and grantee = 'authenticated' and privilege_type = 'INSERT'
          order by column_name`,
      )
      return rows.map((r) => r.column_name)
    }
    const readable = async (database) => {
      const { rows } = await database.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'invitations'
            and grantee = 'authenticated' and privilege_type = 'SELECT'
          order by column_name`,
      )
      return rows.map((r) => r.column_name)
    }
    const THREE = ['created_by_member_id', 'household_id', 'token_hash']

    it('revokes before it grants, names all three roles, and uses no narrow revoke', () => {
      // `0040`'s form, asserted against the source because a catalog read sees
      // only the outcome. Comments stripped first: the header names the narrow
      // form as the thing this file does not do.
      const sql = blankSqlComments(migrationSql(WITHDRAWAL))
      const revokeAt = sql.search(/^revoke all on public\.invitations from authenticated, anon, public;/m)
      const grantAt = sql.search(/^grant /m)
      expect(revokeAt).toBeGreaterThan(-1)
      expect(grantAt).toBeGreaterThan(revokeAt)
      expect(sql).not.toMatch(/revoke\s+insert\s*\(/i)
      expect(sql).not.toMatch(/revoke\s+select\s*,\s*insert/i)
    })

    it('0050 and 0051 each apply a second time and change nothing', async () => {
      const db = await freshDatabase()
      await db.exec(migrationSql(DEFAULT))
      await db.exec(migrationSql(WITHDRAWAL))
      expect(await insertable(db)).toEqual(THREE)
      expect(await readable(db)).toHaveLength(9)
      const home = await seedHousehold(db)
      const made = await insertAs(
        db,
        home.organizerDevice,
        invitationMintRow({
          householdId: home.household.id,
          tokenHash: await hashInvitationCode(generateInvitationCode()),
          createdByMemberId: home.organizer,
        }),
      )
      expect(made.ok, made.error ?? '').toBe(true)
      expect(await lifetimeOf(db, made.value.rows[0].id)).toBe(LIFETIME_SECONDS)
    })

    it('THE RE-PASTE HAZARD: 0040 after 0051 hands expires_at back to the client, and 0051 again takes it away', async () => {
      // Asserted in both directions, as `0051`'s header states it. The first
      // half is the hazard itself — a re-paste of `0040` is a normal act here
      // and it silently re-widens the insert; the second half is the repair.
      // `0050`'s default survives the re-paste throughout, because `0040`'s
      // `create table if not exists` skips its whole statement.
      const db = await freshDatabase()
      expect(await insertable(db)).toEqual(THREE)

      await db.exec(migrationSql(RECORD))
      expect(await insertable(db)).toEqual([...THREE, 'expires_at'].sort())
      const { rows: still } = await db.query(
        `select count(*)::int as n from pg_attrdef d
           join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
          where d.adrelid = 'public.invitations'::regclass and a.attname = 'expires_at'`,
      )
      expect(still[0].n).toBe(1)

      await db.exec(migrationSql(WITHDRAWAL))
      expect(await insertable(db)).toEqual(THREE)
    })
  })
})
