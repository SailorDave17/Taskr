// @vitest-environment node
//
// `0036` — the extraction endpoint's call ledger, run against a real Postgres.
// Story #208. Node rather than the repo-wide jsdom for the reason every pglite
// suite here states on its first line: pglite loads its tarball through
// `Response.arrayBuffer`, which jsdom's `Response` does not have, and the
// failure is `r.arrayBuffer is not a function` at `freshDatabase` — measured
// on this file's first run, 12 of 12 red, before this directive existed.
//
// The Edge Function's own tests (supabase/functions/extract-description/
// handler.test.js) run against a fake client that returns whatever they tell
// it; they can prove the handler ASKS the ledger and never that the database
// refuses anybody else. This is the half a fake cannot see: that no client role
// holds anything on the table, that row-level security is on with no policy
// behind the absent grant, that `service_role` holds exactly the two verbs the
// function uses, and that the composite foreign key refuses a row pairing one
// household's member with another household's id.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asDevice, attempt, freshDatabase, newDevice } from './support/pgliteSupabase.js'

vi.setConfig({ testTimeout: 30_000 })

describe('the extraction call ledger, run against a real Postgres', () => {
  let db, deviceA, householdA, householdB, organizerA, outsider

  /** Append a call as the OWNER — what the function does as service_role. */
  const record = (household, member, kind = 'capacity') =>
    db.query(
      `insert into public.extraction_calls (household_id, member_id, kind) values ($1, $2, $3)`,
      [household, member, kind],
    )

  const grantsFor = async (role, table) => {
    const { rows } = await db.query(
      `select distinct privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee = $2`,
      [table, role],
    )
    return rows.map((r) => r.privilege_type).sort()
  }

  const readableColumns = async (role, table) => {
    const { rows } = await db.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = $1
          and grantee = $2 and privilege_type = 'SELECT'
        order by column_name`,
      [table, role],
    )
    return rows.map((r) => r.column_name)
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db, 'placeholder.organizer@example.test')
    const deviceB = await newDevice(db, 'placeholder.other@example.test')

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    householdB = await asDevice(db, deviceB, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })
    organizerA = householdA.organizer_member_id
    outsider = householdB.organizer_member_id
  })

  describe('no client can reach it', () => {
    it.each(['authenticated', 'anon'])('%s holds NO privilege of any kind on it', async (role) => {
      // The stub's default leaves `Dxtm` on a new table, which is not `[]`, so
      // an empty result here is only possible because `0036` revokes.
      expect(await grantsFor(role, 'extraction_calls')).toEqual([])
      expect(await readableColumns(role, 'extraction_calls')).toEqual([])
    })

    it('and a signed-in member is refused when they try anyway', async () => {
      await record(householdA.id, organizerA)
      const refused = await asDevice(db, deviceA, () =>
        attempt(() => db.query('select count(*) from public.extraction_calls')),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })

    it('POSITIVE CONTROL: the same caller CAN read their own roster', async () => {
      // Without this, the refusal above is satisfied by a caller with no
      // privileges at all, or a database that refuses everything.
      const allowed = await asDevice(db, deviceA, () =>
        attempt(() => db.query('select id from public.members')),
      )
      expect(allowed.ok, allowed.error ?? '').toBe(true)
      expect(allowed.value.rows).toHaveLength(1)
    })

    it('has row-level security on with NO policy, so a stray grant still finds nothing', async () => {
      const { rows: rls } = await db.query(
        `select relrowsecurity from pg_class where oid = 'public.extraction_calls'::regclass`,
      )
      expect(rls[0].relrowsecurity).toBe(true)
      const { rows: policies } = await db.query(
        `select policyname from pg_policies where schemaname = 'public' and tablename = 'extraction_calls'`,
      )
      expect(policies).toEqual([])
    })
  })

  describe('service_role holds the two DML verbs the function uses, and no more', () => {
    it('SELECT and INSERT', async () => {
      // Two rather than four, because the function reads the window and
      // appends to it. `grants.pglite.test.js` asserts the same string in its
      // audit of every service_role table; this is the per-table statement.
      // Filtered to the four DML verbs the way that audit is: the stub's
      // default leaves REFERENCES, TRIGGER and TRUNCATE on every role for
      // every new table (`0011`'s `Dxtm`), and those are not what a grant
      // decides — measured on this file's first green run, the unfiltered
      // list read five.
      const dml = (await grantsFor('service_role', 'extraction_calls')).filter((verb) =>
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(verb),
      )
      expect(dml).toEqual(['INSERT', 'SELECT'])
    })

    it('POSITIVE CONTROL: the owner can append and count, which is the whole use', async () => {
      await record(householdA.id, organizerA)
      await record(householdA.id, organizerA, 'chores')
      const { rows } = await db.query(
        `select count(*)::int as n from public.extraction_calls where household_id = $1`,
        [householdA.id],
      )
      expect(rows[0].n).toBe(2)
    })
  })

  describe('the schema’s own backstops', () => {
    it('refuses a row pairing one household’s member with another household’s id', async () => {
      const refused = await attempt(() => record(householdB.id, organizerA))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/extraction_calls_member_in_household|foreign key/i)
    })

    it('refuses a kind the corpus does not define', async () => {
      const refused = await attempt(() => record(householdA.id, organizerA, 'week'))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/extraction_calls_kind_known|check constraint/i)
    })

    it('a removed member takes their rows with them', async () => {
      await record(householdA.id, organizerA)
      await record(householdB.id, outsider)
      await db.query('delete from public.members where id = $1', [outsider])
      const { rows } = await db.query('select household_id from public.extraction_calls')
      expect(rows.map((r) => r.household_id)).toEqual([householdA.id])
    })

    it('stamps called_at from the database clock, not from the caller', async () => {
      const before = await db.query('select now() as t')
      await record(householdA.id, organizerA)
      const { rows } = await db.query('select called_at from public.extraction_calls')
      expect(new Date(rows[0].called_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.rows[0].t).getTime(),
      )
    })

    it('carries the index the window count walks', async () => {
      const { rows } = await db.query(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'extraction_calls'
            and indexname = 'extraction_calls_household_window_idx'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].indexdef).toMatch(/\(household_id, called_at DESC\)/)
    })
  })
})
