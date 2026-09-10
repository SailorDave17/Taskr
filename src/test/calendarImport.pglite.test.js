// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #101 — the import ledger and the widened provenance constraint, against a
// real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies, so a green run says
// nothing about the hosted project. `npm run check:live` sees the table and its
// publication row (red until `0038` is applied); it is BLIND to the constraint
// widening for `0031`'s reason, and the instrument for that half is the
// read-only catalog query recorded in docs/access-model.md's `0038` entry.
//
// ===========================================================================
// AC 5 IS A CONSTRAINT TEST IN BOTH DIRECTIONS — TWICE
// ===========================================================================
//
// "pglite test proves the idempotency constraint both directions": the second
// import of the same event in the same household is REFUSED, and — the arm that
// keeps the first honest — a different event in the same household and the same
// event in a different household are both ACCEPTED. A refusal alone is
// consistent with a table nothing can be inserted into.
//
// AC 4's "the chores table itself gains no column" is asserted the same way
// `0031`'s widening was: a database built through `0037` refuses a `calendar`
// chore naming the constraint, one built through `0038` accepts it, and the
// chores column set is the same on both.
//
// Names are synthetic — see #19.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHORE_SOURCES } from '../lib/chores.js'
import {
  asDevice,
  attempt,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

/** Matches `src/lib/calendar.js`'s CALENDAR_IMPORT_COLUMNS; asserted against the grant below. */
const READABLE = 'id, household_id, member_id, calendar_event_id, chore_id, imported_at'

const BEFORE = '0037_realtime_publication.sql'
const AFTER = '0038_calendar_event_import.sql'

// See calendar.pglite.test.js for the measurement behind this number; it is the
// same instrument and the same runner straddle. hookTimeout is set once, in
// support/pgliteSupabase.js.
vi.setConfig({ testTimeout: 30_000 })

/** What `chores_source_known` admits, per Postgres itself — the sorted words. */
async function admittedChoreSources(database) {
  const { rows } = await database.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'chores_source_known'`,
  )
  expect(rows, 'the constraint must exist exactly once').toHaveLength(1)
  return [...rows[0].def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
}

/** A household with an organizer and a second, claimed member, on any database. */
async function seedHousehold(database, suffix = '') {
  const device = await newDevice(database, `placeholder.organizer${suffix}@example.test`)
  const household = await asDevice(database, device, async () => {
    const { rows } = await database.query('select * from public.create_household($1, $2)', [
      `Placeholder Household${suffix}`,
      'Placeholder Organizer',
    ])
    return rows[0]
  })
  const { rows } = await database.query(
    `insert into public.members (household_id, display_name, weekly_minutes, email)
     values ($1, 'Placeholder Two', 300, $2) returning id`,
    [household.id, `placeholder.two${suffix}@example.test`],
  )
  const memberTwo = rows[0].id
  const deviceTwo = await newDevice(database, `placeholder.two${suffix}@example.test`)
  await database.query('update public.members set claimed_by = $1 where id = $2', [deviceTwo, memberTwo])
  return { device, deviceTwo, household, organizer: household.organizer_member_id, memberTwo }
}

/** A chore as the OWNER, so the ledger tests are about the ledger and not the chore grant. */
async function seedChore(database, householdId, title = 'Placeholder Chore', source = 'manual') {
  const { rows } = await database.query(
    `insert into public.chores (household_id, title, expected_minutes, due_on, source)
     values ($1, $2, 30, '2026-09-10', $3) returning id`,
    [householdId, title, source],
  )
  return rows[0].id
}

/** The client's write, as PostgREST issues it, signed in as `uid`. */
const recordAs = (database, uid, { household, member, event, chore }) =>
  asDevice(database, uid, () =>
    attempt(() =>
      database.query(
        `insert into public.calendar_imports (household_id, member_id, calendar_event_id, chore_id)
         values ($1, $2, $3, $4) returning ${READABLE}`,
        [household, member, event, chore],
      ),
    ),
  )

describe('the import ledger, run against a real Postgres', () => {
  let db, a, b, choreA, choreA2, choreB

  const countAsOwner = async (table) => {
    const { rows } = await db.query(`select count(*)::int as n from public.${table}`)
    return rows[0].n
  }

  /** The privileges a role actually holds on a table, per Postgres itself. */
  const grantsFor = async (role, table) => {
    const { rows } = await db.query(
      `select distinct privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee = $2`,
      [table, role],
    )
    return rows.map((r) => r.privilege_type).sort()
  }

  /** Column-level privileges of one kind, which `table_privileges` cannot see. */
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

  beforeEach(async () => {
    db = await freshDatabase()
    a = await seedHousehold(db)
    b = await seedHousehold(db, '.other')
    // Seeded as plain typed chores, deliberately: the ledger tests are about
    // the LEDGER, and a fixture whose every chore carried `source = 'calendar'`
    // would make the constraint mutation redden this whole file at its
    // beforeEach — coupling read as coverage. The word is exercised where it
    // is the subject, in the before/after describe below.
    choreA = await seedChore(db, a.household.id, 'Placeholder Chore')
    choreA2 = await seedChore(db, a.household.id, 'Placeholder Other Chore')
    choreB = await seedChore(db, b.household.id, 'Placeholder Third Chore')
  })

  // -------------------------------------------------------------------------
  // AC 4 — the stored shape: an event id, and nothing else from the calendar
  // -------------------------------------------------------------------------

  describe('AC 4 — the ledger holds the event id and nothing a calendar could have said', () => {
    it('has exactly the columns the decision allows, and no others', async () => {
      // The WHOLE set, not absences — `0030`'s test says why: a test asking
      // only "is there a title column" passes against a `summary`.
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'calendar_imports'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual([
        'calendar_event_id',
        'chore_id',
        'household_id',
        'id',
        'imported_at',
        'member_id',
      ])
    })

    it('and the CHORES table gained no column — the provenance is the word, not a new field', async () => {
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' order by column_name`,
      )
      const names = rows.map((r) => r.column_name)
      expect(names).toContain('source')
      for (const name of names) expect(name).not.toMatch(/calendar|event|import/)
      // POSITIVE CONTROL: the same scan finds the event column where it lives.
      const { rows: ledger } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'calendar_imports'`,
      )
      expect(ledger.map((r) => r.column_name).some((n) => /event/.test(n))).toBe(true)
    })

    it('bounds the event id to a non-empty short string, so the column cannot hold a description', async () => {
      const empty = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: '', chore: choreA,
      })
      expect(empty.ok).toBe(false)
      expect(empty.error).toMatch(/event_id_shape|check constraint/i)
      const huge = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'x'.repeat(1025), chore: choreA,
      })
      expect(huge.ok).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — idempotency, both directions
  // -------------------------------------------------------------------------

  describe('AC 5 — one import per household per event, proven in both directions', () => {
    it('REFUSES a second import of the same event in the same household, naming the constraint', async () => {
      const first = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      expect(first.ok, first.error ?? '').toBe(true)
      // A HOUSEMATE trying the same event, for a different chore: the
      // household-scoped key is what refuses it, not the chore key.
      const again = await recordAs(db, a.device, {
        household: a.household.id, member: a.organizer, event: 'evt-1', chore: choreA2,
      })
      expect(again.ok).toBe(false)
      expect(again.error).toMatch(/calendar_imports_one_per_event|duplicate key/i)
      expect(await countAsOwner('calendar_imports')).toBe(1)
    })

    it('ACCEPTS a different event in the same household — the key is the event, not the household', async () => {
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      const other = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-2', chore: choreA2,
      })
      expect(other.ok, other.error ?? '').toBe(true)
      expect(await countAsOwner('calendar_imports')).toBe(2)
    })

    it('ACCEPTS the same event id in ANOTHER household — a shared event is one chore per household', async () => {
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      const elsewhere = await recordAs(db, b.deviceTwo, {
        household: b.household.id, member: b.memberTwo, event: 'evt-1', chore: choreB,
      })
      expect(elsewhere.ok, elsewhere.error ?? '').toBe(true)
      expect(await countAsOwner('calendar_imports')).toBe(2)
    })

    it('one chore came from at most one event', async () => {
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      const twice = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-2', chore: choreA,
      })
      expect(twice.ok).toBe(false)
      expect(twice.error).toMatch(/calendar_imports_one_per_chore|duplicate key/i)
    })

    it('removing the chore frees the event to be imported again — the household said the import was wrong', async () => {
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      await db.query('delete from public.chores where id = $1', [choreA])
      expect(await countAsOwner('calendar_imports')).toBe(0)
      const again = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA2,
      })
      expect(again.ok, again.error ?? '').toBe(true)
    })

    it('a removed member leaves the import standing, with no importer — the chore is still the household’s', async () => {
      // `on delete set null (member_id)`: the column-list form, so the
      // scoping column is untouched and the delete is not refused (0032's
      // measured correction). The event stays refused a second time.
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      const removed = await attempt(() =>
        db.query('delete from public.members where id = $1', [a.memberTwo]),
      )
      expect(removed.ok, removed.error ?? '').toBe(true)
      const { rows } = await db.query(
        'select household_id, member_id, calendar_event_id from public.calendar_imports',
      )
      expect(rows).toEqual([
        { household_id: a.household.id, member_id: null, calendar_event_id: 'evt-1' },
      ])
      const again = await recordAs(db, a.device, {
        household: a.household.id, member: a.organizer, event: 'evt-1', chore: choreA2,
      })
      expect(again.ok).toBe(false)
      expect(again.error).toMatch(/calendar_imports_one_per_event|duplicate key/i)
    })
  })

  // -------------------------------------------------------------------------
  // Which rows, and which columns
  // -------------------------------------------------------------------------

  describe('the household reads, and a member records only their own imports', () => {
    it('refuses recording an import AS A HOUSEMATE — the row is pinned to the caller’s own member', async () => {
      // Device Two signed in, naming the organizer as the importer.
      const forged = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.organizer, event: 'evt-1', chore: choreA,
      })
      expect(forged.ok).toBe(false)
      expect(forged.error).toMatch(/row-level security/i)
      expect(await countAsOwner('calendar_imports')).toBe(0)
    })

    it('refuses a row for another household, and one pairing this household with the other’s member', async () => {
      const outside = await recordAs(db, a.deviceTwo, {
        household: b.household.id, member: a.memberTwo, event: 'evt-1', chore: choreB,
      })
      expect(outside.ok).toBe(false)
      const crossed = await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: b.memberTwo, event: 'evt-1', chore: choreA,
      })
      expect(crossed.ok).toBe(false)
      expect(await countAsOwner('calendar_imports')).toBe(0)
    })

    it('refuses a row with no importer at all — null is what a REMOVED member leaves, never what a phone writes', async () => {
      const nobody = await asDevice(db, a.deviceTwo, () =>
        attempt(() =>
          db.query(
            `insert into public.calendar_imports (household_id, calendar_event_id, chore_id)
             values ($1, 'evt-1', $2)`,
            [a.household.id, choreA],
          ),
        ),
      )
      expect(nobody.ok).toBe(false)
      expect(nobody.error).toMatch(/row-level security/i)
    })

    it('shows a housemate’s import, because the household is the trust boundary', async () => {
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      const seen = await asDevice(db, a.device, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.calendar_imports`)
        return rows
      })
      expect(seen.map((r) => r.calendar_event_id)).toEqual(['evt-1'])
      expect(seen[0].household_id).toBe(a.household.id)
    })

    it('shows NOTHING of another household’s', async () => {
      await recordAs(db, b.deviceTwo, {
        household: b.household.id, member: b.memberTwo, event: 'evt-9', chore: choreB,
      })
      const seen = await asDevice(db, a.device, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.calendar_imports`)
        return rows
      })
      expect(seen).toEqual([])
      expect(await countAsOwner('calendar_imports')).toBe(1)
    })

    it('grants exactly the columns calendar.js selects and inserts, and no more', async () => {
      expect(await columnsWith('authenticated', 'calendar_imports', 'SELECT')).toEqual(
        READABLE.split(',').map((c) => c.trim()).sort(),
      )
      expect(await columnsWith('authenticated', 'calendar_imports', 'INSERT')).toEqual([
        'calendar_event_id',
        'chore_id',
        'household_id',
        'member_id',
      ])
      expect(await columnsWith('authenticated', 'calendar_imports', 'UPDATE')).toEqual([])
      expect(await columnsWith('anon', 'calendar_imports', 'SELECT')).toEqual([])
    })

    it.each(['update', 'delete'])('refuses a client %s — a ledger row leaves only with its chore', async (verb) => {
      await recordAs(db, a.deviceTwo, {
        household: a.household.id, member: a.memberTwo, event: 'evt-1', chore: choreA,
      })
      const sql = {
        update: `update public.calendar_imports set calendar_event_id = 'evt-x'`,
        delete: 'delete from public.calendar_imports',
      }[verb]
      const refused = await asDevice(db, a.deviceTwo, () => attempt(() => db.query(sql)))
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
      expect(await countAsOwner('calendar_imports')).toBe(1)
    })

    it.each(['authenticated', 'anon'])('%s holds no TABLE-level privilege — every grant is by column', async (role) => {
      expect(await grantsFor(role, 'calendar_imports')).toEqual([])
    })

    it('grants service_role NO DML here — no Edge Function touches this table', async () => {
      // Exactly the platform default the harness models (`Dxtm` less the
      // MAINTAIN the standard catalog cannot see — grants.pglite.test.js's
      // control), and not one letter more: `0038` grants the service role
      // nothing, so the only way it could reach a row is a later migration.
      // Asserted as the exact set rather than as "no SELECT", so a widened
      // default would redden here as well as at the control.
      expect(await grantsFor('service_role', 'calendar_imports')).toEqual([
        'REFERENCES',
        'TRIGGER',
        'TRUNCATE',
      ])
      expect(await columnsWith('service_role', 'calendar_imports', 'SELECT')).toEqual([])
      expect(await columnsWith('service_role', 'calendar_imports', 'INSERT')).toEqual([])
    })

    it('has row-level security on, with exactly the two policies', async () => {
      const { rows: rls } = await db.query(
        `select relrowsecurity from pg_class where oid = 'public.calendar_imports'::regclass`,
      )
      expect(rls[0].relrowsecurity).toBe(true)
      const { rows: policies } = await db.query(
        `select policyname, cmd from pg_policies
          where schemaname = 'public' and tablename = 'calendar_imports' order by policyname`,
      )
      expect(policies).toEqual([
        { policyname: 'calendar_imports_insert_own_row', cmd: 'INSERT' },
        { policyname: 'calendar_imports_select_same_household', cmd: 'SELECT' },
      ])
    })

    it('is in the Realtime publication, so a second phone’s import moves this phone’s marks', async () => {
      const { rows } = await db.query(
        `select tablename from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calendar_imports'`,
      )
      expect(rows).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // The constraint, before and after
  // -------------------------------------------------------------------------

  describe('AC 4 — `chores.source` admits calendar after 0038 and not before', () => {
    it('BEFORE: a database built through 0037 REFUSES a calendar chore, naming the constraint', async () => {
      const at0037 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0037)
      expect(await admittedChoreSources(at0037)).toEqual(['extraction', 'manual'])
      const refused = await asDevice(at0037, seeded.deviceTwo, () =>
        attempt(() =>
          at0037.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, source)
             values ($1, 'Placeholder Chore', 30, '2026-09-10', 'calendar')`,
            [seeded.household.id],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain('chores_source_known')
      await at0037.close()
    })

    it('BEFORE — POSITIVE CONTROL: the same database accepts a manual chore, so the red is the word', async () => {
      const at0037 = await databaseThrough(BEFORE)
      const seeded = await seedHousehold(at0037)
      const accepted = await asDevice(at0037, seeded.deviceTwo, () =>
        attempt(() =>
          at0037.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, source)
             values ($1, 'Placeholder Chore', 30, '2026-09-10', 'manual')`,
            [seeded.household.id],
          ),
        ),
      )
      expect(accepted.ok, accepted.error ?? '').toBe(true)
      await at0037.close()
    })

    it('AFTER: a database built through 0038 accepts the calendar chore through the client’s own insert grant', async () => {
      expect(await admittedChoreSources(db)).toEqual(['calendar', 'extraction', 'manual'])
      const accepted = await asDevice(db, a.deviceTwo, () =>
        attempt(() =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, source)
             values ($1, 'Placeholder Fourth Chore', 30, '2026-09-10', 'calendar') returning source`,
            [a.household.id],
          ),
        ),
      )
      expect(accepted.ok, accepted.error ?? '').toBe(true)
      expect(accepted.value.rows[0].source).toBe('calendar')
    })

    it('holds CHORE_SOURCES equal to what the constraint admits, so the client and the schema cannot drift', async () => {
      expect(await admittedChoreSources(db)).toEqual([...CHORE_SOURCES].sort())
    })

    it('still refuses a word outside the vocabulary — the widening is one word, not an open column', async () => {
      const refused = await asDevice(db, a.deviceTwo, () =>
        attempt(() =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, source)
             values ($1, 'Placeholder Chore', 30, '2026-09-10', 'imported')`,
            [a.household.id],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain('chores_source_known')
    })
  })

  // -------------------------------------------------------------------------
  // What only the source can say, and the re-paste
  // -------------------------------------------------------------------------

  describe('what the harness structurally cannot prove, and the re-run', () => {
    it('orders the revoke before the grants, which only the source shows', () => {
      const sql = migrationSql(AFTER)
      const revokeAt = sql.indexOf('revoke all on public.calendar_imports')
      const grantAt = sql.search(/^grant select \([^)]*\)\n\s+on public\.calendar_imports to authenticated/m)
      expect(revokeAt, 'no revoke for calendar_imports').toBeGreaterThan(-1)
      expect(grantAt, 'no column grant for calendar_imports').toBeGreaterThan(-1)
      expect(grantAt).toBeGreaterThan(revokeAt)
    })

    it('is the same column list the client reads with', () => {
      const source = readFileSync(resolve(process.cwd(), 'src/lib/calendar.js'), 'utf8')
      expect(source).toContain(`CALENDAR_IMPORT_COLUMNS =\n  '${READABLE}'`)
    })

    it('0038 applies a second time without error, and leaves the constraint at three words', async () => {
      const second = await attempt(() => db.exec(migrationSql(AFTER)))
      expect(second.error).toBeNull()
      expect(await admittedChoreSources(db)).toEqual(['calendar', 'extraction', 'manual'])
      // And the publication row is still exactly one — the guarded add is
      // what makes the re-paste a no-op there rather than a 42710.
      const { rows } = await db.query(
        `select count(*)::int as n from pg_publication_tables
          where pubname = 'supabase_realtime' and tablename = 'calendar_imports'`,
      )
      expect(rows[0].n).toBe(1)
    })

    it('re-pasting 0023 on top does NOT narrow the constraint back — its add is catalog-guarded', async () => {
      // `0023` adds the constraint only `if not exists`, so a re-paste of the
      // older file finds ours and leaves it. The opposite of what a re-paste
      // of `0012`/`0025`/`0026` does to `0028`, and worth asserting because a
      // reader who has learned that hazard would expect it here.
      await db.exec(migrationSql('0023_chore_provenance.sql'))
      expect(await admittedChoreSources(db)).toEqual(['calendar', 'extraction', 'manual'])
    })
  })
})
