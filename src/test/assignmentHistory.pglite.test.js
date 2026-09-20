// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #481 — the assignment record `0049` keeps, against a real Postgres: one
// append-only row per assignment change, written by a trigger on `chores`
// and by nothing else, readable by the household and writable by no client.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". `check:live` sees the
// table and its columns; `probe:live-grants` sees the absence of a
// table-level grant; NEITHER sees the trigger, its predicate or its
// function's ACL — the read-only catalog query in docs/access-model.md's
// #481 section is that instrument on the live project, and this file is the
// one that runs on every push.
//
// The story asked for one test per RPC, and one proving a member cannot
// insert or delete a row. Both are here, plus the predicate's edges — the
// ones a trigger-shaped writer has and an insert-per-RPC would not — and one
// end-to-end: the rows the trigger writes, read back with the client's own
// grant, steer the next deal-out.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSIGNMENT_HISTORY_COLUMNS, HISTORY_WINDOW_WEEKS } from '../lib/assignmentHistory.js'
import { periodStartFor, priorPeriodStarts } from '../lib/capacity.js'
import { planReassignment } from '../lib/reassign.js'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'

vi.setConfig({ testTimeout: 30_000 })

/** Matches `src/lib/assignmentHistory.js`'s column list — asserted, not copied. */
const READABLE =
  'id, household_id, chore_id, repeat_parent_id, from_member_id, to_member_id, from_source, source, actor_member_id, period_start, recorded_at'

const MIGRATION = '0049_chore_assignment_history.sql'

describe('the assignment record, run against a real Postgres', () => {
  let db, deviceA, deviceB, outsiderDevice, household, memberA, memberB

  const seedMember = async (householdId, name, minutes) => {
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, $2, $3) returning id`,
      [householdId, name, minutes],
    )
    return rows[0].id
  }

  const seedChore = async (householdId, title = 'Dishes', minutes = 60, extra = {}) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on, generated_from)
       values ($1, $2, $3, '2026-09-14', $4) returning id`,
      [householdId, title, minutes, extra.generatedFrom ?? null],
    )
    return rows[0].id
  }

  /** The record for one chore, as the OWNER — ground truth, every grant bypassed. */
  const recordFor = async (choreId) => {
    const { rows } = await db.query(
      `select chore_id, repeat_parent_id, household_id, from_member_id, to_member_id,
              from_source, source, actor_member_id, period_start::text as period_start
         from public.chore_assignment_history
        where chore_id = $1
        order by recorded_at, id`,
      [choreId],
    )
    return rows
  }

  const rpc = (uid, sql, args) => asDevice(db, uid, () => db.query(sql, args))
  const assign = (uid, chore, member) => rpc(uid, 'select public.assign_chore($1, $2)', [chore, member])
  const unassign = (uid, chore) => rpc(uid, 'select public.unassign_chore($1)', [chore])
  const complete = (uid, chore) => rpc(uid, 'select public.complete_chore($1)', [chore])
  const uncomplete = (uid, chore) => rpc(uid, 'select public.uncomplete_chore($1)', [chore])

  /** One deal-out the way `reassignHousehold` runs one, every read as the device. */
  const dealOut = async (uid, householdId) =>
    asDevice(db, uid, async () => {
      const hh = (await db.query('select assignments_version, timezone from public.households where id = $1', [householdId])).rows[0]
      const members = (
        await db.query('select id, weekly_minutes from public.members where household_id = $1 order by created_at', [householdId])
      ).rows
      const memberIds = members.map((m) => m.id)
      const chores = (
        await db.query(
          `select id, expected_minutes, assigned_member_id, assigned_source, completed_at,
                  missed_at, actual_minutes, generated_from
             from public.chores where household_id = $1`,
          [householdId],
        )
      ).rows
      const overrides = (
        await db.query(
          `select member_id, period_start::text as period_start, minutes
             from public.member_capacity where member_id = any($1::uuid[])`,
          [memberIds],
        )
      ).rows
      const exclusions = (
        await db.query('select chore_id, member_id from public.chore_exclusions where member_id = any($1::uuid[])', [memberIds])
      ).rows
      const periodStart = periodStartFor(new Date(), hh.timezone)
      // The client's own read of the record — column list, household scope,
      // window — exactly as `listAssignmentHistory` issues it.
      const history = (
        await db.query(
          `select ${READABLE.replace('period_start', 'period_start::text as period_start')}
             from public.chore_assignment_history
            where household_id = $1 and period_start >= $2 and period_start < $3
            order by recorded_at`,
          [householdId, priorPeriodStarts(periodStart, HISTORY_WINDOW_WEEKS)[0], periodStart],
        )
      ).rows
      const plan = planReassignment({
        members,
        chores,
        exclusions,
        overrides,
        periodStart,
        timeZone: hh.timezone,
        history,
      })
      const { rows } = await db.query(
        'select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb) as result',
        [householdId, Number(hh.assignments_version), JSON.stringify(plan.placements), JSON.stringify(plan.verdict)],
      )
      return { plan, outcome: rows[0].result }
    })

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)
    deviceB = await newDevice(db)
    outsiderDevice = await newDevice(db)

    household = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    await asDevice(db, outsiderDevice, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })

    memberA = household.organizer_member_id
    memberB = await seedMember(household.id, 'Placeholder Two', 300)
    await db.query('update public.members set claimed_by = $1 where id = $2', [deviceB, memberB])
    await db.query('update public.members set weekly_minutes = 300 where id = $1', [memberA])
  })

  it('READABLE is the module’s column list, so a widening there reaches this file', () => {
    expect(READABLE).toBe(ASSIGNMENT_HISTORY_COLUMNS)
  })

  // -------------------------------------------------------------------------
  // AC 1 — one row per RPC
  // -------------------------------------------------------------------------

  describe('AC 1 — every assignment change is recorded', () => {
    it('assign_chore: from nobody to the member, by hand, by the caller, this week', async () => {
      const chore = await seedChore(household.id)
      await assign(deviceB, chore, memberA)

      const [row, ...rest] = await recordFor(chore)
      expect(rest).toEqual([])
      expect(row).toEqual({
        chore_id: chore,
        repeat_parent_id: null,
        household_id: household.id,
        from_member_id: null,
        to_member_id: memberA,
        from_source: null,
        source: 'manual',
        // WHO DID IT is the caller's member row, not the holder's.
        actor_member_id: memberB,
        period_start: periodStartFor(new Date(), 'UTC'),
      })
    })

    it('unassign_chore: from the member to nobody, and the source goes with them', async () => {
      const chore = await seedChore(household.id)
      await assign(deviceA, chore, memberA)
      await unassign(deviceA, chore)

      const rows = await recordFor(chore)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        from_member_id: memberA,
        to_member_id: null,
        from_source: 'manual',
        source: null,
        actor_member_id: memberA,
      })
    })

    it('apply_assignments: one auto row per placement — and one more when the deal-out KEEPS the holder', async () => {
      const chore = await seedChore(household.id)
      await dealOut(deviceA, household.id)
      const [first] = await recordFor(chore)
      expect(first).toMatchObject({ from_member_id: null, source: 'auto', actor_member_id: memberA })
      expect([memberA, memberB]).toContain(first.to_member_id)

      // The second deal-out changes nothing on the row — the incumbent wins
      // the tie — and is recorded anyway, because "the last three deal-outs
      // all went to A" is exactly the case where nothing changed.
      await dealOut(deviceB, household.id)
      const rows = await recordFor(chore)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        from_member_id: first.to_member_id,
        to_member_id: first.to_member_id,
        from_source: 'auto',
        source: 'auto',
        actor_member_id: memberB,
      })
    })

    it('complete_chore: claiming an unheld chore is recorded as a completed placement', async () => {
      const chore = await seedChore(household.id)
      await complete(deviceB, chore)

      const [row] = await recordFor(chore)
      expect(row).toMatchObject({
        from_member_id: null,
        to_member_id: memberB,
        from_source: null,
        source: 'completed',
        actor_member_id: memberB,
      })
    })
  })

  // -------------------------------------------------------------------------
  // The predicate's edges — what a trigger records that four inserts would
  // not, and what it must NOT record
  // -------------------------------------------------------------------------

  describe('the trigger fires on assignment changes and on deal-outs, and on nothing else', () => {
    it('completing a chore somebody already holds records nothing — it is not an assignment change', async () => {
      const chore = await seedChore(household.id)
      await dealOut(deviceA, household.id)
      expect(await recordFor(chore)).toHaveLength(1)

      await complete(deviceA, chore)
      // Holder and source preserved by `0029`; the completion stamp is not a
      // deal-out, whatever the source word says.
      expect(await recordFor(chore)).toHaveLength(1)
    })

    it('un-completing a held chore records nothing either; un-completing a CLAIM records the release', async () => {
      const held = await seedChore(household.id)
      await assign(deviceA, held, memberA)
      await complete(deviceA, held)
      await uncomplete(deviceA, held)
      expect(await recordFor(held)).toHaveLength(1)

      const claimed = await seedChore(household.id, 'Laundry')
      await complete(deviceB, claimed)
      await uncomplete(deviceB, claimed)
      const rows = await recordFor(claimed)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        from_member_id: memberB,
        to_member_id: null,
        from_source: 'completed',
        source: null,
      })
    })

    it('a title edit on an AUTO-held open chore records nothing — the columns that fire it were not set', async () => {
      // Auto-held on purpose: a manual-held chore is refused by the predicate
      // alone, so it could not tell whether the `of (...)` column list on the
      // trigger was there (review-fanout, 2026-09-18). An open auto-held row
      // satisfies the deal-out clause, so ONLY the column list keeps a title
      // edit (or a skip, or an actual-minutes edit) from reading as one more
      // deal-out to that person.
      const chore = await seedChore(household.id)
      await dealOut(deviceA, household.id)
      expect(await recordFor(chore)).toHaveLength(1)
      await asDevice(db, deviceA, () =>
        db.query(`update public.chores set title = 'Laundry' where id = $1`, [chore]),
      )
      expect(await recordFor(chore)).toHaveLength(1)
    })

    it('un-completing an AUTO-held chore records nothing — the completed_at guard, both sides', async () => {
      // `uncomplete_chore` re-SETs `assigned_source = 'auto'` on an auto
      // holder with `completed_at` going from set to null. Without the
      // `old.completed_at is null` half of the deal-out clause, every
      // un-completion would write a phantom self-to-self auto row and count
      // as one more deal-out to that person (review-fanout, 2026-09-18).
      const chore = await seedChore(household.id)
      await dealOut(deviceA, household.id)
      await complete(deviceA, chore)
      await uncomplete(deviceA, chore)
      expect(await recordFor(chore)).toHaveLength(1)
    })

    it('an occurrence is recorded under its repeat parent — the key the next week reads', async () => {
      const parent = await seedChore(household.id, 'Dishes', 60)
      const occurrence = await seedChore(household.id, 'Dishes', 60, { generatedFrom: parent })
      await assign(deviceA, occurrence, memberB)

      const [row] = await recordFor(occurrence)
      expect(row.repeat_parent_id).toBe(parent)
      expect(row.chore_id).toBe(occurrence)
    })

    it('removing a member releases their chores, and the release is a row naming the remover', async () => {
      const chore = await seedChore(household.id)
      await assign(deviceA, chore, memberB)
      // The FK's `on delete set null` is an ordinary update and fires the
      // trigger. The delete runs as the organizer, the way the roster's
      // remove does (0016) — `asDevice` sets the caller, and the members
      // delete policy admits the organizer.
      await rpc(deviceA, 'delete from public.members where id = $1', [memberB])

      const rows = await recordFor(chore)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({
        from_member_id: memberB,
        to_member_id: null,
        from_source: 'manual',
        source: 'manual',
        actor_member_id: memberA,
      })
    })

    it('a change with no signed-in caller is recorded with no actor, not refused', async () => {
      const chore = await seedChore(household.id)
      await assign(deviceA, chore, memberB)
      // `set_config(..., false)` is session-scoped, so the uid the last
      // `asDevice` set is still in force for the owner; clear it, so this
      // is the platform's own action (a purge, a console edit) and nobody's.
      await db.query(`select set_config('test.uid', '', false)`)
      await db.query('delete from public.members where id = $1', [memberB])

      const rows = await recordFor(chore)
      expect(rows).toHaveLength(2)
      expect(rows[1]).toMatchObject({ from_member_id: memberB, to_member_id: null, actor_member_id: null })
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — readable by the household, writable by nobody
  // -------------------------------------------------------------------------

  describe('AC 1 — the household reads it, and no client writes it', () => {
    let chore

    beforeEach(async () => {
      chore = await seedChore(household.id)
      await assign(deviceA, chore, memberA)
    })

    it('a member reads every column, of every row in their household, not only their own', async () => {
      const { rows } = await rpc(
        deviceB,
        `select ${READABLE} from public.chore_assignment_history where household_id = $1`,
        [household.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].to_member_id).toBe(memberA)
      expect(rows[0].household_id).toBe(household.id)
    })

    it('a member of another household sees nothing — not an error, nothing', async () => {
      const { rows } = await rpc(
        outsiderDevice,
        `select ${READABLE} from public.chore_assignment_history`,
        [],
      )
      expect(rows).toEqual([])
    })

    it('a member cannot insert a row, whatever it says', async () => {
      const refused = await attempt(() =>
        rpc(
          deviceA,
          `insert into public.chore_assignment_history
             (household_id, chore_id, to_member_id, source, period_start)
           values ($1, $2, $3, 'auto', '2026-09-07')`,
          [household.id, chore, memberB],
        ),
      )
      expect(refused.ok).toBe(false)
      expect(String(refused.error)).toMatch(/permission denied/)
    })

    it('a member cannot delete a row, and cannot update one', async () => {
      const deleted = await attempt(() =>
        rpc(deviceA, 'delete from public.chore_assignment_history where chore_id = $1', [chore]),
      )
      expect(deleted.ok).toBe(false)
      expect(String(deleted.error)).toMatch(/permission denied/)

      const updated = await attempt(() =>
        rpc(deviceA, `update public.chore_assignment_history set source = 'auto' where chore_id = $1`, [chore]),
      )
      expect(updated.ok).toBe(false)
      expect(String(updated.error)).toMatch(/permission denied/)

      // POSITIVE CONTROL: the row is still there, read as the owner.
      expect(await recordFor(chore)).toHaveLength(1)
    })

    it('the trigger function is executable by nobody a client can be', async () => {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', 'public.record_chore_assignment()', 'execute') as auth,
                has_function_privilege('anon', 'public.record_chore_assignment()', 'execute') as anon,
                prosecdef
           from pg_proc where proname = 'record_chore_assignment'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ auth: false, anon: false, prosecdef: true })
    })

    it('one select policy through current_household_ids, and no policy for any write', async () => {
      const { rows } = await db.query(
        `select policyname, cmd, coalesce(qual, '') as qual from pg_policies
          where schemaname = 'public' and tablename = 'chore_assignment_history'
          order by policyname`,
      )
      expect(rows.map((r) => [r.policyname, r.cmd])).toEqual([
        ['chore_assignment_history_select_same_household', 'SELECT'],
      ])
      expect(rows[0].qual).toMatch(/current_household_ids/)
    })
  })

  // -------------------------------------------------------------------------
  // The week key is the household's
  // -------------------------------------------------------------------------

  describe('period_start is the Monday of the household’s week', () => {
    it('agrees with the client’s periodStartFor in every zone, both sides of the date line', async () => {
      for (const zone of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York', 'Australia/Sydney']) {
        const { rows } = await db.query(
          `select (date_trunc('week', now() at time zone $1))::date::text as week`,
          [zone],
        )
        expect(rows[0].week, zone).toBe(periodStartFor(new Date(), zone))
      }
    })

    it('stamps the household’s zone, not the server’s', async () => {
      await db.query(`update public.households set timezone = 'Pacific/Kiritimati' where id = $1`, [household.id])
      const chore = await seedChore(household.id)
      await assign(deviceA, chore, memberA)
      const [row] = await recordFor(chore)
      expect(row.period_start).toBe(periodStartFor(new Date(), 'Pacific/Kiritimati'))
    })

    it('and reads the zone off the household row — asserted on the function text, since the clock cannot be moved', async () => {
      // The behavioural test above agrees with a hard-coded UTC about 92% of
      // the week (UTC+14 and UTC share a Monday from Monday 00:00 UTC to
      // Sunday 10:00 UTC), so on its own it is prove-tests mode 9 — the rule
      // and its mutation agree on the fixture. This is the deterministic
      // half: the same catalog read docs/access-model.md names for the live
      // project (review-fanout, 2026-09-18).
      const { rows } = await db.query(
        `select pg_get_functiondef('public.record_chore_assignment()'::regprocedure) as def`,
      )
      expect(rows[0].def).toMatch(/date_trunc\('week', now\(\) at time zone h\.timezone\)/)
      expect(rows[0].def).not.toMatch(/at time zone 'UTC'/)
    })

    it('refuses any weekday but Monday', async () => {
      const refused = await attempt(() =>
        db.query(
          `insert into public.chore_assignment_history (household_id, chore_id, period_start)
           values ($1, gen_random_uuid(), '2026-09-15')`,
          [household.id],
        ),
      )
      expect(refused.ok).toBe(false)
      expect(String(refused.error)).toMatch(/period_is_week_start/)
    })
  })

  // -------------------------------------------------------------------------
  // End to end — the record steers the next deal-out
  // -------------------------------------------------------------------------

  describe('the rows the trigger writes steer the next deal-out (AC 2, end to end)', () => {
    it('after three prior weeks on one person, the deal-out sends the chore to the other and says so', async () => {
      const chore = await seedChore(household.id, 'Dishes', 60)
      const { plan: first } = await dealOut(deviceA, household.id)
      const [placed] = first.placements
      const other = placed.member_id === memberA ? memberB : memberA

      // Three prior weeks of the same answer, written as the owner because
      // no client can write here and no clock can be turned back: the shape
      // is exactly what three deal-outs a week apart would have left.
      const thisWeek = periodStartFor(new Date(), 'UTC')
      for (const week of priorPeriodStarts(thisWeek, 3)) {
        await db.query(
          `insert into public.chore_assignment_history
             (household_id, chore_id, from_member_id, to_member_id, from_source, source, actor_member_id, period_start, recorded_at)
           values ($1, $2, $3, $3, 'auto', 'auto', $4, $5, ($5::date + interval '10 hours'))`,
          [household.id, chore, placed.member_id, memberA, week],
        )
      }

      const { plan: second } = await dealOut(deviceB, household.id)
      expect(second.placements).toEqual([{ chore_id: chore, member_id: other }])
      expect(second.verdict.steered).toEqual([
        { choreId: chore, from: placed.member_id, to: other, kind: 'repeat', weeks: 3, moved: true },
      ])

      // The run's verdict is stored where the Split reads it, steer included.
      const { rows } = await rpc(deviceA, 'select last_rebalance from public.households where id = $1', [household.id])
      expect(rows[0].last_rebalance.steered).toEqual(second.verdict.steered)
      // And the move itself was recorded, as a deal-out off the old holder.
      const record = await recordFor(chore)
      expect(record.at(-1)).toMatchObject({ from_member_id: placed.member_id, to_member_id: other, source: 'auto' })
    })

    it('POSITIVE CONTROL: with only two prior weeks the same deal-out keeps the holder', async () => {
      const chore = await seedChore(household.id, 'Dishes', 60)
      const { plan: first } = await dealOut(deviceA, household.id)
      const [placed] = first.placements
      const thisWeek = periodStartFor(new Date(), 'UTC')
      for (const week of priorPeriodStarts(thisWeek, 3).slice(1)) {
        await db.query(
          `insert into public.chore_assignment_history
             (household_id, chore_id, to_member_id, source, period_start, recorded_at)
           values ($1, $2, $3, 'auto', $4, ($4::date + interval '10 hours'))`,
          [household.id, chore, placed.member_id, week],
        )
      }
      const { plan: second } = await dealOut(deviceB, household.id)
      expect(second.placements).toEqual([{ chore_id: chore, member_id: placed.member_id }])
      expect(second.verdict.steered).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability
  // -------------------------------------------------------------------------

  describe('re-pasting 0049', () => {
    it('applies a second time on top of the full stack, keeps every row, and leaves one trigger', async () => {
      const chore = await seedChore(household.id)
      await assign(deviceA, chore, memberA)

      await db.exec(migrationSql(MIGRATION))

      expect(await recordFor(chore)).toHaveLength(1)
      const { rows } = await db.query(
        `select tgname from pg_trigger where tgrelid = 'public.chores'::regclass and tgname = 'chores_record_assignment'`,
      )
      expect(rows).toHaveLength(1)

      // And it still fires.
      await unassign(deviceA, chore)
      expect(await recordFor(chore)).toHaveLength(2)
    })

    it('does not widen the client’s privileges on a re-run', async () => {
      await db.exec(migrationSql(MIGRATION))
      const { rows } = await db.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chore_assignment_history'
            and grantee = 'authenticated'
          group by privilege_type`,
      )
      expect(rows.map((r) => r.privilege_type)).toEqual(['SELECT'])
      const { rows: table } = await db.query(
        `select coalesce(relacl::text, '') as acl from pg_class
          where relnamespace = 'public'::regnamespace and relname = 'chore_assignment_history'`,
      )
      expect(table[0].acl).not.toMatch(/authenticated=/)
      expect(table[0].acl).not.toMatch(/anon=/)
    })
  })
})
