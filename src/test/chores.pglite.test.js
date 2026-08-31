// @vitest-environment node
//
// Node, not the repo-wide jsdom: PGlite loads its WASM and its pgcrypto bundle
// through fetch/Response, and jsdom's Response has no arrayBuffer() here — every
// test in the file would die at PGlite.create() with a TypeError that says
// nothing about environments. Same reason migrations.pglite.test.js carries the
// same docblock.
//
// #34 — the chore schema and its write rules, run against a real Postgres.
//
// A separate file from migrations.pglite.test.js rather than more describes
// inside it. That file is 485 lines about households, members and credentials,
// and its beforeEach builds an organizer, a child and a stranger for questions
// about identity. Chores need the same household and none of the PIN
// machinery, and one shared fixture serving both would grow a parameter for
// every story that lands on it.
//
// What a pass here means, and it is worth restating because the sentence is
// load-bearing: "consistent with Postgres, given the Supabase-shaped environment
// stubbed in support/pgliteSupabase.js". It does NOT mean "Supabase will accept
// this". Proving that against the live project is #38, which is externally
// gated on an owner-only dashboard action.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHORE_SOURCES } from '../lib/chores.js'
import {
  MIGRATIONS,
  asDevice,
  attempt,
  freshDatabase,
  migrationFilesOnDisk,
  migrationSql,
  newDevice,
  databaseThrough,
} from './support/pgliteSupabase.js'

/** The columns a client may read, matching 0003's select grant. */
const READABLE = 'id, title, expected_minutes, due_on, created_at'

/**
 * A `date` column's value as YYYY-MM-DD, whatever the driver handed back.
 *
 * PGlite returns a `date` as a JS Date at UTC midnight, so `String(value)`
 * renders it in the RUNNER's local zone and reads as the previous day anywhere
 * behind UTC. Measured while writing this file: the assertion read
 * 'Sun Aug 09 2026 20:00:00 GMT-0400' for a chore due the 10th. That is the same
 * fault normalizeDueDate exists to prevent, arriving in the test rather than the
 * code — and a test that reads a date in local time would pass in CI (UTC) and
 * fail on this machine, or worse, the other way round.
 */
const asIsoDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)


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

describe('chores, run against a real Postgres', () => {
  let db
  let deviceA
  let deviceB
  let householdA

  /** Insert a chore as a device, returning `{ ok, value, error }`. */
  async function insertChore(uid, { householdId, title = 'Dishes', minutes = 20, due = '2026-08-10' }) {
    return attempt(() =>
      asDevice(db, uid, async () => {
        const { rows } = await db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on)
           values ($1, $2, $3, $4) returning ${READABLE}`,
          [householdId, title, minutes, due],
        )
        return rows[0]
      }),
    )
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)
    deviceB = await newDevice(db)

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — a chore is a titled unit of expected minutes, due on a DATE
  // -------------------------------------------------------------------------

  describe('AC 1 — a chore is minutes of work with a due date', () => {
    it('stores the household, title, minutes and due date that were submitted', async () => {
      const added = await insertChore(deviceA, {
        householdId: householdA.id,
        title: 'Dishes',
        minutes: 20,
        due: '2026-08-10',
      })

      expect(added.error).toBeNull()
      expect(added.value.title).toBe('Dishes')
      expect(added.value.expected_minutes).toBe(20)
      expect(asIsoDate(added.value.due_on)).toBe('2026-08-10')

      // AC 1 asks that the row carry the household_id, and a client cannot read
      // that column — 0003 withholds it, which is what makes `select *` fail.
      // Read it as the table owner instead, which is exactly the situation the
      // withheld column creates and therefore the honest way to check it.
      const { rows } = await db.query('select household_id from public.chores where id = $1', [
        added.value.id,
      ])
      expect(rows[0].household_id).toBe(householdA.id)
    })

    it('due_on is a DATE column, not text — the recurrence stories cannot schedule against "Monday"', async () => {
      const { rows } = await db.query(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'due_on'`,
      )
      expect(rows[0].data_type).toBe('date')
    })

    it('POSITIVE CONTROL: the same assertion would catch a text column, so it is not vacuous', async () => {
      // If information_schema simply answered `date` for everything, the test
      // above would pass on any schema at all. `title` is text and must read as
      // text — one query away from proving the instrument discriminates.
      const { rows } = await db.query(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'title'`,
      )
      expect(rows[0].data_type).toBe('text')
    })

    it('expected_minutes is an integer column, so 20.5 minutes cannot be stored at all', async () => {
      const { rows } = await db.query(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'expected_minutes'`,
      )
      expect(rows[0].data_type).toBe('integer')
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the minutes bound is a NAMED check constraint
  // -------------------------------------------------------------------------

  describe('AC 2 — the database refuses minutes the form would also refuse', () => {
    it('POSITIVE CONTROL: a valid chore inserts, so a refusal below is the constraint and not a broken path', async () => {
      const ok = await insertChore(deviceA, { householdId: householdA.id, minutes: 20 })
      expect(ok.error).toBeNull()
      expect(ok.value.expected_minutes).toBe(20)
    })

    // Asserted against the constraint NAME chosen in 0003, never against
    // Postgres's generated message text — that text is not a contract, and a
    // test asserting on it passes or fails on a Postgres version rather than on
    // the rule.
    for (const [label, minutes] of [
      ['zero', 0],
      ['negative', -30],
      ['above a day of work', 1441],
    ]) {
      it(`refuses ${label} minutes, by the named constraint chores_expected_minutes_range`, async () => {
        const refused = await insertChore(deviceA, { householdId: householdA.id, minutes })
        expect(refused.ok).toBe(false)
        expect(refused.error).toMatch(/chores_expected_minutes_range/)
      })
    }

    it('refuses a non-integer, which the column type catches before the constraint does', async () => {
      const refused = await insertChore(deviceA, { householdId: householdA.id, minutes: 20.5 })
      expect(refused.ok).toBe(false)
    })

    it('refuses a blank title, by the named constraint chores_title_length', async () => {
      const refused = await insertChore(deviceA, { householdId: householdA.id, title: '   ' })
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/chores_title_length/)
    })

    it('accepts both ends of the range, so the bound is inclusive as written', async () => {
      const low = await insertChore(deviceA, { householdId: householdA.id, minutes: 1 })
      const high = await insertChore(deviceA, { householdId: householdA.id, minutes: 1440 })
      expect(low.error).toBeNull()
      expect(high.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — a household sees its own chores and nobody else's
  // -------------------------------------------------------------------------

  describe('AC 3 — chores are scoped to the household', () => {
    it('device B sees none of household A rows, and device A sees them — so the empty result is a refusal', async () => {
      await insertChore(deviceA, { householdId: householdA.id, title: 'Dishes' })

      // B is in a household of its own, not merely unjoined.
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2)', [
          'Other Household',
          'Other Organizer',
        ]),
      )

      // Deliberately NOT filtered by household_id. A client cannot name that
      // column in a WHERE either — withholding the select grant removes it from
      // every clause, not just the projection — and it does not need to: RLS is
      // the filter. This is the query the app actually issues.
      const query = 'select count(*)::int as n from public.chores'

      const seenByB = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query(query)
        return rows[0].n
      })
      // The identical query, as the household that owns the row. If these two
      // ever agree, the fixture is broken rather than the rule being proven.
      const seenByA = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(query)
        return rows[0].n
      })

      expect(seenByB).toBe(0)
      expect(seenByA).toBe(1)
    })

    it('a device that has joined nothing sees no chores at all', async () => {
      await insertChore(deviceA, { householdId: householdA.id })
      const stranger = await newDevice(db)

      const seen = await asDevice(db, stranger, async () => {
        const { rows } = await db.query('select count(*)::int as n from public.chores')
        return rows[0].n
      })
      expect(seen).toBe(0)
    })

    it('a device in another household cannot edit or delete a chore it cannot see', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      await asDevice(db, deviceB, () =>
        db.query('select * from public.create_household($1, $2)', ['Other', 'Other Org']),
      )

      await asDevice(db, deviceB, () =>
        db.query('update public.chores set title = $1 where id = $2', ['Hijacked', chore.value.id]),
      )
      await asDevice(db, deviceB, () =>
        db.query('delete from public.chores where id = $1', [chore.value.id]),
      )

      // Both statements affect zero rows rather than erroring — that is how RLS
      // refuses an UPDATE or DELETE — so the proof is that the row is untouched.
      const after = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select title from public.chores where id = $1', [
          chore.value.id,
        ])
        return rows
      })
      expect(after).toHaveLength(1)
      expect(after[0].title).toBe('Dishes')
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — the with-check policy on insert
  // -------------------------------------------------------------------------

  describe('AC 4 — a device cannot file a chore into a household it has not joined', () => {
    it('refuses an insert naming another household', async () => {
      const otherHousehold = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Other Household',
          'Other Organizer',
        ])
        return rows[0]
      })

      const refused = await insertChore(deviceA, { householdId: otherHousehold.id })
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/row-level security/i)
    })

    it('POSITIVE CONTROL: the same insert into its own household succeeds', async () => {
      const allowed = await insertChore(deviceA, { householdId: householdA.id })
      expect(allowed.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — column grants, the shape 0002 established
  // -------------------------------------------------------------------------

  describe('AC 5 — the grants are per column, because RLS is row-level', () => {
    it('an explicit column list reads, and select(*) fails outright rather than omitting a column', async () => {
      await insertChore(deviceA, { householdId: householdA.id })

      const explicit = await attempt(() =>
        asDevice(db, deviceA, () => db.query(`select ${READABLE} from public.chores`)),
      )
      expect(explicit.error).toBeNull()

      const star = await attempt(() =>
        asDevice(db, deviceA, () => db.query('select * from public.chores')),
      )
      // `select *` expands to every column including `household_id`, which is
      // not granted, so it is refused as a whole. That is the behaviour we want:
      // it fails loudly at the client instead of quietly returning a narrower
      // row. MEASURED: with every column granted this assertion FAILS — the
      // wildcard succeeds — which is why 0003 withholds one.
      expect(star.ok, 'select * must fail, not silently omit a column').toBe(false)
      expect(star.error).toMatch(/permission denied/i)
    })

    it('a client may edit a chore description', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })

      const edited = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set title = $1, expected_minutes = $2 where id = $3', [
            'Dishes and counters',
            30,
            chore.value.id,
          ]),
        ),
      )
      expect(edited.error).toBeNull()
    })

    it('REGRESSION: a client cannot move a chore into another household by writing household_id', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      const otherHousehold = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Other Household',
          'Other Organizer',
        ])
        return rows[0]
      })

      const moved = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chores set household_id = $1 where id = $2', [
            otherHousehold.id,
            chore.value.id,
          ]),
        ),
      )
      // Refused by the column grant, not by the policy — `household_id` is
      // simply not in 0003's update grant, so there is no value it could be set
      // to. This is the convention #35, #36 and #37 inherit.
      expect(moved.ok).toBe(false)
      expect(moved.error).toMatch(/permission denied/i)
    })

    it('`anon` holds NOTHING on this table — checked at TABLE level, not column level', async () => {
      // The catalog matters more than the assertion here. An earlier version of
      // this test queried `column_privileges` and was named as though it proved
      // anon could not write; MEASURED, that catalog reports only the four
      // column-grantable privileges (SELECT/INSERT/UPDATE/REFERENCES) and is
      // structurally incapable of reporting DELETE, TRUNCATE or TRIGGER — which
      // is exactly what anon still held. A test that cannot observe the thing
      // its name claims is worse than absent, because it reads as coverage.
      const tableLevel = await db.query(
        `select privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'chores' and grantee = 'anon'`,
      )
      expect(tableLevel.rows.map((r) => r.privilege_type)).toEqual([])

      const columnLevel = await db.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores' and grantee = 'anon'`,
      )
      expect(columnLevel.rows.map((r) => r.privilege_type)).toEqual([])
    })

    it('POSITIVE CONTROL: table_privileges CAN see a delete grant, so the empty result above means something', async () => {
      // Without this, the assertion above passes if the query is simply wrong —
      // a misspelled table name returns zero rows just as convincingly.
      // `authenticated` must still hold DELETE, because
      // chores_delete_same_household needs it.
      const { rows } = await db.query(
        `select privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'DELETE'`,
      )
      expect(rows).toHaveLength(1)
    })

    it('and a joined device can still delete its own household chore, so the revoke did not overreach', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      await asDevice(db, deviceA, () =>
        db.query('delete from public.chores where id = $1', [chore.value.id]),
      )
      const { rows } = await db.query('select count(*)::int as n from public.chores where id = $1', [
        chore.value.id,
      ])
      expect(rows[0].n).toBe(0)
    })

    it('the granted column sets are exactly what 0003 says, so a widening is visible here', async () => {
      const granted = async (privilege) => {
        const { rows } = await db.query(
          `select column_name from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'chores'
              and grantee = 'authenticated' and privilege_type = $1
            order by column_name`,
          [privilege],
        )
        return rows.map((r) => r.column_name)
      }

      // Widened by 0004 (completion), 0006 (assignment), 0012 (repeats), 0015
      // (actuals, #12) and 0023 (provenance, #211), each making its columns
      // READABLE; 0012 is the first to widen the INSERT set, because a repeat
      // is DECLARED where the chore is created, and 0015 the first to widen the
      // UPDATE set since 0003 — an actual is adjustable after the fact, and
      // actuals.pglite proves it stays out of INSERT. 0024 (#54) widens UPDATE
      // second, with the repeat pair — editing or stopping a repeat is an edit
      // to the chore that holds it. The convention holds: additive by column,
      // and no later story revokes a shipped grant. `repeat_since`, the
      // watermark and `generated_from` are absent from insert and update — the
      // trigger and the catch-up pass are their only authors, and
      // repeats.pglite.test.js proves the refusals.
      //
      // `source` (0023) is the second column after `repeat_kind` to join INSERT
      // and stay out of UPDATE, and the reason is the same one stated the other
      // way round: an origin is a fact about an event that already happened, so
      // there is a moment to state it and no later moment to correct it.
      expect(await granted('SELECT')).toEqual([
        'actual_minutes',
        'assigned_member_id',
        'assigned_source',
        'completed_at',
        'completed_by_member_id',
        'created_at',
        'due_on',
        'expected_minutes',
        'generated_from',
        'household_id',
        'id',
        'repeat_kind',
        'repeat_weekdays',
        'source',
        'title',
      ])
      expect(await granted('INSERT')).toEqual([
        'due_on',
        'expected_minutes',
        'household_id',
        'repeat_kind',
        'repeat_weekdays',
        'source',
        'title',
      ])
      expect(await granted('UPDATE')).toEqual([
        'actual_minutes',
        'due_on',
        'expected_minutes',
        'repeat_kind',
        'repeat_weekdays',
        'title',
      ])
    })

    it('every column a later story added arrived with its own write guard', async () => {
      // The convention, now that both later stories have landed: #35 brought
      // completed_at and #36 brought assigned_member_id, each with the test
      // proving a client cannot write it living in the story that introduced it.
      //
      // This test used to assert assigned_member_id was ABSENT, which was the
      // right assertion while it was — it stopped the column being declared here
      // ahead of the story with a reason to try writing it. What survives that
      // change is the property underneath: a column added later must not be in
      // the UPDATE grant, and asserting that here catches a widening wherever it
      // is introduced. #36's own suite proves the refusal end to end.
      const { rows } = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'chores'
          order by column_name`,
      )
      const columns = rows.map((r) => r.column_name)
      expect(columns).toContain('completed_at')
      expect(columns).toContain('assigned_member_id')

      const { rows: writable } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      const updatable = writable.map((r) => r.column_name)
      expect(updatable).not.toContain('completed_at')
      expect(updatable).not.toContain('completed_by_member_id')
      expect(updatable).not.toContain('assigned_member_id')
      // POSITIVE CONTROL: the query can see an update grant when there is one,
      // so the three absences above mean "withheld" rather than "query wrong".
      expect(updatable).toContain('title')
    })
  })

  // -------------------------------------------------------------------------
  // AC 7 — the file is applied by a human pasting it, twice
  // -------------------------------------------------------------------------

  describe('AC 7 — 0003 is re-runnable', () => {
    // Each test here builds its own database THROUGH this migration rather than
    // reusing the full-stack `db`. Re-pasting a superseded file on top of a
    // newer one is not the path a human takes, and after 0007 it is destructive:
    // it restores the four-argument `create_household` and the policies that
    // resolve through the dropped `household_devices`. Two of these assertions
    // went on passing while doing exactly that — a green test that had already
    // undone the migration under review.

    it('applies a second time without error, because a re-paste is the normal path', async () => {
      const at0003 = await databaseThrough('0003_chores.sql')
      const second = await attempt(() => at0003.exec(migrationSql('0003_chores.sql')))
      expect(second.error).toBeNull()
    })

    it('and a re-run does not widen the grants — the revoke/grant pair is idempotent too', async () => {
      const db = await databaseThrough('0003_chores.sql')
      await db.exec(migrationSql('0003_chores.sql'))
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).toEqual(['due_on', 'expected_minutes', 'title'])
    })
  })

  // -------------------------------------------------------------------------
  // #211 — where a chore came from
  //
  // A separate section rather than lines folded into AC 1 and AC 5 above,
  // because those are #34's criteria and this is a different story's. The
  // grant-set assertion in AC 5 is deliberately NOT duplicated here: it is the
  // named test #211 AC 2 points at, and a second copy would mean a widening
  // reddens two tests and gets read as two findings.
  // -------------------------------------------------------------------------

  describe('#211 — a chore records whether it was typed or extracted', () => {
    it('defaults to manual, so a chore created without saying anything is recorded as typed', async () => {
      const row = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on)
           values ($1, 'Dishes', 20, '2026-08-10') returning source`,
          [householdA.id],
        )
        return rows[0]
      })
      expect(row.source).toBe('manual')
    })

    it('accepts extraction, which is the value the capture path will write', async () => {
      const row = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on, source)
           values ($1, 'Dishes', 20, '2026-08-10', 'extraction') returning source`,
          [householdA.id],
        )
        return rows[0]
      })
      expect(row.source).toBe('extraction')
    })

    it('refuses a word outside the vocabulary, by the named constraint', async () => {
      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, source)
             values ($1, 'Dishes', 20, '2026-08-10', 'imported')`,
            [householdA.id],
          ),
        ),
      )
      expect(refused.error).not.toBeNull()
      // Asserted against the constraint NAME, never the message: Postgres writes
      // its own message text and that text is not a contract (0003's rule).
      expect(refused.error).toContain('chores_source_known')
    })

    it('refuses auto — assigned_source vocabulary is not this column vocabulary', async () => {
      // The whole argument for reusing the name `source` rests on the two
      // columns sharing no word, so a value read out of the wrong one is a wrong
      // ANSWER rather than a plausible one. This is that claim, tested, in the
      // direction that matters: 'auto' is legal in assigned_source and must not
      // be legal here.
      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chores (household_id, title, expected_minutes, due_on, source)
             values ($1, 'Dishes', 20, '2026-08-10', 'auto')`,
            [householdA.id],
          ),
        ),
      )
      expect(refused.error).not.toBeNull()
      expect(refused.error).toContain('chores_source_known')

      // POSITIVE CONTROL, and it is what stops the assertion above meaning
      // "some insert failed": the same word IS accepted by the column it belongs
      // to, on the same table, in the same database.
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      const assigned = await attempt(() =>
        db.query(`update public.chores set assigned_source = 'auto' where id = $1`, [
          chore.value.id,
        ]),
      )
      expect(assigned.error).toBeNull()
    })

    it('holds CHORE_SOURCES equal to what the constraint admits, so the two copies cannot drift', async () => {
      // The vocabulary exists in two places by necessity — a check constraint in
      // Postgres and a frozen array the client imports — and nothing but this
      // binds them. Derived from the catalog rather than spelled out, so adding
      // a value to the constraint without adding it to the constant reddens
      // here rather than surfacing as a refused insert months later.
      const { rows } = await db.query(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conname = 'chores_source_known'`,
      )
      expect(rows).toHaveLength(1)
      const admitted = [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
      expect(admitted).toEqual([...CHORE_SOURCES].sort())
    })

    it('cannot be updated after the fact — an origin is a fact about an event, not a field', async () => {
      const chore = await insertChore(deviceA, { householdId: householdA.id })
      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(`update public.chores set source = 'extraction' where id = $1`, [
            chore.value.id,
          ]),
        ),
      )
      expect(refused.error).not.toBeNull()
      expect(refused.error).toMatch(/permission denied/i)

      // POSITIVE CONTROL: the same device, same row, same statement shape, on a
      // column that IS in the update grant. Without this the refusal above is
      // consistent with the device being unable to update anything at all.
      const allowed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(`update public.chores set title = 'Washing up' where id = $1`, [
            chore.value.id,
          ]),
        ),
      )
      expect(allowed.error).toBeNull()
    })

    it('0023 applies a second time without error, because a re-application is the normal path', async () => {
      // Built THROUGH 0023 rather than on the full stack, which for this file is
      // the same database — it is the last migration today. Written this way so
      // it stays honest when 0024 exists: re-pasting a superseded file on top of
      // a newer one is not the path anybody takes, and AC 7 above records what
      // it cost to learn that.
      const at0023 = await databaseThrough('0023_chore_provenance.sql')
      const second = await attempt(() => at0023.exec(migrationSql('0023_chore_provenance.sql')))
      expect(second.error).toBeNull()

      // And the re-run left the column, the constraint and the grants as they
      // were — a file that errors on its second run is loud, one that succeeds
      // while changing something is not.
      const { rows: cols } = await at0023.query(
        `select column_default, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'chores' and column_name = 'source'`,
      )
      expect(cols).toHaveLength(1)
      expect(cols[0].is_nullable).toBe('NO')
      expect(cols[0].column_default).toContain('manual')

      const { rows: grants } = await at0023.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chores'
            and grantee = 'authenticated' and column_name = 'source'
          order by privilege_type`,
      )
      expect(grants.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT'])
    })
  })
})

// ---------------------------------------------------------------------------
// AC 8 — a migration on disk that nothing applies is a migration nothing tests
// ---------------------------------------------------------------------------

describe('AC 8 — the migration list cannot silently fall behind the directory', () => {
  it('every .sql file in supabase/migrations is in the MIGRATIONS array', () => {
    const onDisk = migrationFilesOnDisk()
    const missing = onDisk.filter((name) => !MIGRATIONS.includes(name))

    expect(
      missing,
      `supabase/migrations contains ${missing.join(', ')}, which src/test/support/pgliteSupabase.js ` +
        'never applies — so that migration is untested while this suite stays green. Add it to MIGRATIONS.',
    ).toEqual([])
  })

  it('and every entry in MIGRATIONS is a file that exists — the other direction', () => {
    const onDisk = migrationFilesOnDisk()
    const phantom = MIGRATIONS.filter((name) => !onDisk.includes(name))
    expect(phantom, `MIGRATIONS names ${phantom.join(', ')}, which is not on disk`).toEqual([])
  })

  it('POSITIVE CONTROL: the check reads the real directory, so it can see a file at all', () => {
    // Without this, both assertions above pass vacuously if migrationFilesOnDisk
    // ever returns an empty list — a wrong path, a changed layout — and an empty
    // list satisfies "nothing is missing" perfectly.
    expect(migrationFilesOnDisk().length).toBeGreaterThanOrEqual(3)
    expect(migrationFilesOnDisk()).toContain('0003_chores.sql')
  })
})
