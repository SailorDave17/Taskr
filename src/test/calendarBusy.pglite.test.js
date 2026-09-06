// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #96 — the derived busy figure's schema, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — a green run here says nothing whatever about the hosted project,
// because this harness BUILDS the schema it certifies. `0030` is unapplied on
// the live project until somebody pastes it, and `npm run check:live` is the
// authority on that, not this file. The `calendar_busy` entry in `LIVE_SCHEMA`
// is red on purpose until then.
//
// ===========================================================================
// WHICH HALF OF AC 6 THIS FILE CAN HONESTLY PROVE
// ===========================================================================
//
// AC 6 says the live grant proof belongs to the verification story (#100), and
// it is right. What is worth writing down is exactly WHICH of the assertions
// below `0030`'s privilege statements are load-bearing for — because this
// paragraph said something else first, and the mutation pass falsified it.
//
// *Measured 2026-09-04*: deleting `revoke all on public.calendar_busy from
// authenticated, anon` reddens **3 of these tests, not 9**. The paragraph that
// stood here predicted nine, on the reasoning that the harness's
// `alter default privileges` hands every role `grant all` — so that any table
// without an explicit revoke would arrive fully granted, and every refusal below
// would be proving the revoke. **That has not been true since #91.** The stub
// models the platform: `truncate, references, trigger, maintain` and NO DML
// (support/pgliteSupabase.js, and grants.pglite.test.js's positive control
// asserts it directly). So a fresh table already refuses the client's writes,
// and the revoke is the house convention of 0002/0003/0005/0010/0011 rather than
// the thing holding those doors shut.
//
// What each half is therefore worth:
//
// - The DML refusals, `select *`, and anon's empty column set are proven by the
//   PLATFORM DEFAULT the harness models. They are still worth asserting — they
//   are what the client must not be able to do, and a later migration granting
//   any of it would redden them — but they do not testify about `0030`.
// - The two table-level ACL assertions and the revoke-before-grant ordering DO
//   testify about `0030`: those are the three the mutation reddens.
// - Proving `service_role` HAS its grants is the half that got BETTER, and the
//   first draft of this header had it backwards too. With the default at `Dxtm`,
//   an explicit grant is the only thing that can put DML on the table, so the
//   assertion is real rather than vacuous — and it already exists, in
//   `grants.pglite.test.js`'s `and service_role reaches only what the Edge
//   Functions need`, which this story extended with a `calendar_busy` row.
//   *Measured 2026-09-04*: deleting `0030`'s service_role grant reddens exactly
//   that test — predicted 1, actual 1.
//
//   It is asserted through the CATALOG rather than by writing as the role, and
//   that is not laziness: `service_role` is created `nologin` here with no
//   BYPASSRLS, so an insert under `set role service_role` would be refused by
//   this table's row-level security — a true statement about the harness and a
//   false one about production, where the platform's service_role bypasses RLS.
//   A behavioural test would therefore fail for a reason that has nothing to do
//   with the grant it claims to be about.
//
// #95's `calendar.pglite.test.js` carries the same superseded paragraph, in the
// same words, about `0011` — *measured the same day*: deleting ITS revokes
// reddens 3 of 23 there too, against a header claiming every refusal in the file
// depends on them. Corrected here and reported rather than edited there, because
// that file is not this story's subject.
//
// Names are synthetic — see #19.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asDevice, attempt, freshDatabase, migrationSql, newDevice } from './support/pgliteSupabase.js'

/** Matches `src/lib/calendar.js`'s CALENDAR_BUSY_COLUMNS; asserted against the grant below. */
const READABLE = 'id, member_id, period_start, busy_minutes, event_count, computed_at'

/** A Monday, which is the only weekday `0030` will accept. */
const WEEK = '2026-09-07'

// See calendar.pglite.test.js for the measurement behind this number; it is the
// same instrument and the same runner straddle. hookTimeout is set once, in
// support/pgliteSupabase.js.
vi.setConfig({ testTimeout: 30_000 })

describe('the derived busy figure, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, householdB
  let organizerA, memberTwo, outsider

  /** Write a figure as the OWNER — what the Edge Function does as service_role. */
  const record = async (household, member, { week = WEEK, minutes = 320, events = 6 } = {}) =>
    attempt(() =>
      db.query(
        `insert into public.calendar_busy
           (household_id, member_id, period_start, busy_minutes, event_count)
         values ($1, $2, $3, $4, $5)`,
        [household, member, week, minutes, events],
      ),
    )

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

  /** Column-level SELECT privileges, which `table_privileges` cannot see. */
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

  const seedMember = async (household, name) => {
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, $2, 60) returning id`,
      [household, name],
    )
    return rows[0].id
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db, 'placeholder.organizer@example.test')
    deviceB = await newDevice(db, 'placeholder.other@example.test')

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
    memberTwo = await seedMember(householdA.id, 'Placeholder Two')
    outsider = householdB.organizer_member_id
  })

  // -------------------------------------------------------------------------
  // AC 3 — the stored shape IS the minimization decision
  // -------------------------------------------------------------------------

  describe('AC 3 — only derived fields exist at all', () => {
    it('has exactly the columns the decision allows, and no others', async () => {
      // Asserted as the WHOLE column set rather than as absences, and that is
      // the difference between a check and a hope: a test that only asked "is
      // there a `summary` column" passes against a `title`, an `attendees` and
      // anything else somebody adds later. There is no column here that COULD
      // hold what a calendar said, which is the point of writing the rule as a
      // schema instead of as a rule in an Edge Function.
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'calendar_busy'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual([
        'busy_minutes',
        'computed_at',
        'event_count',
        'household_id',
        'id',
        'member_id',
        'period_start',
      ])
    })

    it('stores integers and an instant, so a title could not be squeezed in', async () => {
      // The type is the second wall. `busy_minutes text` would satisfy the
      // column-name assertion above while holding anything at all.
      const { rows } = await db.query(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'calendar_busy'
            and column_name in ('busy_minutes', 'event_count', 'period_start', 'computed_at')
          order by column_name`,
      )
      expect(Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]))).toEqual({
        busy_minutes: 'integer',
        computed_at: 'timestamp with time zone',
        event_count: 'integer',
        period_start: 'date',
      })
    })
  })

  // -------------------------------------------------------------------------
  // The key, and the constraints that make it mean something
  // -------------------------------------------------------------------------

  describe('the week a figure is filed under', () => {
    it('accepts a Monday', async () => {
      const written = await record(householdA.id, organizerA)
      expect(written.ok, written.error ?? '').toBe(true)
    })

    it('REFUSES any other weekday, so the key cannot drift from capacity’s', async () => {
      // 0005 enforces the same rule on `member_capacity`, and the two tables are
      // joined on this key by #97. A figure filed under a Tuesday is a row
      // nothing will ever read, and it would look perfectly healthy sitting
      // there.
      const refused = await record(householdA.id, organizerA, { week: '2026-09-08' })
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/period_is_week_start|check constraint/i)
    })

    it('holds ONE figure per member per week', async () => {
      await record(householdA.id, organizerA)
      const again = await record(householdA.id, organizerA, { minutes: 60 })
      expect(again.ok).toBe(false)
      expect(again.error).toMatch(/one_per_period|duplicate key/i)
    })

    it('CONTROL: the same member CAN hold a figure for a different week', async () => {
      // Without this the constraint above is indistinguishable from one keyed on
      // the member alone, which would let a household hold exactly one figure
      // for all time.
      await record(householdA.id, organizerA)
      const next = await record(householdA.id, organizerA, { week: '2026-09-14' })
      expect(next.ok, next.error ?? '').toBe(true)
    })

    it('refuses minutes outside the LONGEST week, and a negative count', async () => {
      // 10141, not 10081: the fall-back week is 169 hours, and `0030`'s comment
      // on the column says why the bound is the longest week rather than an
      // ordinary one.
      const tooMany = await record(householdA.id, organizerA, { minutes: 10141 })
      expect(tooMany.ok).toBe(false)
      const negative = await record(householdA.id, organizerA, { minutes: -1 })
      expect(negative.ok).toBe(false)
      const negativeCount = await record(householdA.id, organizerA, { events: -1 })
      expect(negativeCount.ok).toBe(false)
    })

    it('accepts a whole week of busy, which is a real answer — the long week included', async () => {
      const full = await record(householdA.id, organizerA, { minutes: 10080 })
      expect(full.ok, full.error ?? '').toBe(true)
      const longWeek = await record(householdA.id, memberTwo, { minutes: 10140 })
      expect(longWeek.ok, longWeek.error ?? '').toBe(true)
    })

    it('bounds the column to the same number the Edge Function reduces to', () => {
      // Two copies of one number, in two languages, and this is the only thing
      // holding them together: the function's `MAX_BUSY_MINUTES` is read off its
      // source (gate.test.js forbids importing from supabase/functions/), and
      // the constraint is read off the migration.
      const fn = readFileSync(resolve(process.cwd(), 'supabase/functions/calendar-busy/handler.ts'), 'utf8')
      const sql = migrationSql('0030_calendar_busy_minutes.sql')
      expect(fn).toMatch(/export const MAX_BUSY_MINUTES = 169 \* 60/)
      expect(sql).toMatch(/busy_minutes <= 10140/)
      expect(169 * 60).toBe(10140)
    })

    it('refuses a row pairing one household’s person with another’s id', async () => {
      // The composite foreign key, for 0010's and 0011's reason: the member and
      // the household this row claims must be the same household, so the wrong
      // pairing cannot exist rather than merely being unlikely.
      const crossed = await record(householdB.id, organizerA)
      expect(crossed.ok).toBe(false)
      expect(crossed.error).toMatch(/member_in_household|foreign key/i)
    })

    it('takes a removed member’s figures with them', async () => {
      await record(householdA.id, memberTwo)
      expect(await countAsOwner('calendar_busy')).toBe(1)
      await db.query('delete from public.members where id = $1', [memberTwo])
      expect(await countAsOwner('calendar_busy')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 — who may read it, and who may write it
  // -------------------------------------------------------------------------

  describe('AC 6 — the household reads, and only the function writes', () => {
    it('grants exactly the columns `calendar.js` selects, and no more', async () => {
      const granted = await readableColumns('authenticated', 'calendar_busy')
      const used = READABLE.split(',')
        .map((c) => c.trim())
        .sort()
      expect(granted).toEqual(used)
    })

    it('withholds household_id, so `select *` FAILS rather than returning a subset', async () => {
      await record(householdA.id, organizerA)
      const refused = await asDevice(db, deviceA, () =>
        attempt(() => db.query('select * from public.calendar_busy')),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
    })

    it('shows a housemate’s figure, because the household is the trust boundary', async () => {
      await record(householdA.id, memberTwo)
      const seen = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.calendar_busy`)
        return rows
      })
      expect(seen.map((r) => r.member_id)).toEqual([memberTwo])
    })

    it('shows NOTHING of another household’s', async () => {
      await record(householdB.id, outsider)
      const seen = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(`select ${READABLE} from public.calendar_busy`)
        return rows
      })
      expect(seen).toEqual([])
      // And the row is really there — otherwise this passes against a fixture
      // that never wrote one.
      expect(await countAsOwner('calendar_busy')).toBe(1)
    })

    it.each(['insert', 'update', 'delete'])(
      'refuses a client %s — the function owns the write',
      async (verb) => {
          // A client that could write here could claim any busy figure it liked
        // for anybody in the household, and #97 will offer that figure as a
        // capacity prefill. The credential it is derived from is one no client
        // can reach, so a client-written row would be a number nothing could be
        // checked against.
        //
        // Proven by the platform default the harness models, NOT by `0030`'s
        // revoke — see the header. This asserts what must stay true; the
        // mutation that moves it is a later migration granting DML, not the
        // removal of a revoke.
        await record(householdA.id, organizerA)
        const statements = {
          insert: [
            `insert into public.calendar_busy
               (household_id, member_id, period_start, busy_minutes, event_count)
             values ($1, $2, $3, 60, 1)`,
            [householdA.id, memberTwo, WEEK],
          ],
          update: ['update public.calendar_busy set busy_minutes = 0', []],
          delete: ['delete from public.calendar_busy', []],
        }
        const [sql, args] = statements[verb]
        const refused = await asDevice(db, deviceA, () => attempt(() => db.query(sql, args)))
        expect(refused.ok).toBe(false)
        expect(refused.error).toMatch(/permission denied/i)
      },
    )

    it.each(['authenticated', 'anon'])('%s holds no TABLE-level privilege at all', async (role) => {
      // One of the THREE assertions `0030`'s revoke is load-bearing for — the
      // header carries the measurement. It said "the stub grants `all` ... every
      // assertion in this describe goes red" here until review-fanout found the
      // header's correction had not reached its own file: since #91 the stub
      // grants no DML by default, so the revoke's only observable effect is on
      // this table-level reading and the ordering test at the bottom.
      //
      // Empty for `authenticated` too, which is not a mistake and took a run to
      // see: `0030` grants SELECT on six NAMED COLUMNS, and a column-level grant
      // does not appear in `role_table_grants` at all. The two questions need
      // two catalogs, which is why `readableColumns` exists beside this — and
      // why a suite asking only this one would report a table nobody can read.
      expect(await grantsFor(role, 'calendar_busy')).toEqual([])
    })

    it('anon can read no COLUMN either, which is the question the catalog above misses', async () => {
      expect(await readableColumns('anon', 'calendar_busy')).toEqual([])
      // POSITIVE CONTROL, in the same test so it cannot drift from it: the same
      // query DOES find the grant one role over. Without it, an empty result
      // proves the query, not the privilege.
      expect(await readableColumns('authenticated', 'calendar_busy')).toHaveLength(6)
    })

    it('has row-level security on, with exactly one policy', async () => {
      const { rows: rls } = await db.query(
        `select relrowsecurity from pg_class where oid = 'public.calendar_busy'::regclass`,
      )
      expect(rls[0].relrowsecurity).toBe(true)

      const { rows: policies } = await db.query(
        `select policyname, cmd from pg_policies
          where schemaname = 'public' and tablename = 'calendar_busy'`,
      )
      expect(policies).toEqual([
        { policyname: 'calendar_busy_select_same_household', cmd: 'SELECT' },
      ])
    })
  })

  // -------------------------------------------------------------------------
  // What only the source can say
  // -------------------------------------------------------------------------

  describe('what the harness structurally cannot prove', () => {
    it('orders the revoke before the service_role grant, which only the source shows', async () => {
      // The ORDERING is what only the source can testify to — the privileges
      // themselves are asserted from the catalog in grants.pglite.test.js, and
      // this file's header says why that is the right instrument. A revoke
      // issued after the grant takes back the grant it was meant to precede, and
      // the end state is identical to a file that simply never granted: the
      // catalog cannot tell the two apart, and this file is pasted by hand, in
      // order, more than once.
      const sql = migrationSql('0030_calendar_busy_minutes.sql')
      const revokeAt = sql.indexOf('revoke all on public.calendar_busy')
      const grantAt = sql.search(/^grant[^;]*on public\.calendar_busy[^;]*to service_role/m)
      expect(revokeAt, 'no revoke for calendar_busy').toBeGreaterThan(-1)
      expect(grantAt, 'no service_role grant for calendar_busy').toBeGreaterThan(-1)
      expect(grantAt).toBeGreaterThan(revokeAt)
    })

    it('is the same column list the client reads with', () => {
      // Two copies, in two files, and a divergence would be silent: the grant
      // test above would keep passing against its own stale constant while the
      // app asked for a column it is not granted.
      const source = readFileSync(resolve(process.cwd(), 'src/lib/calendar.js'), 'utf8')
      expect(source).toContain(`CALENDAR_BUSY_COLUMNS =\n  '${READABLE}'`)
    })
  })
})
