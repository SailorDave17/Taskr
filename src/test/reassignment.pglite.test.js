// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #49 — stored re-assignment, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — the paste is a human step recorded nowhere, and check:live's
// `apply_assignments` probe is what watches for it.
//
// The end-to-end here is as end-to-end as this repo can be without a live
// stack: a capacity write lands the way the client's upsert lands, the REAL
// planner (src/lib/reassign.js, which is the real allocator) computes from
// rows read back with the client's own grants, and the real RPC applies the
// result. Only the transport is hand-rolled — the same seam every pglite file
// swaps.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'
import { planReassignment } from '../lib/reassign.js'

vi.setConfig({ testTimeout: 30_000 })

// A Monday — `member_capacity_period_is_monday` refuses anything else.
const MONDAY = '2026-08-24'

describe('stored re-assignment, run against a real Postgres', () => {
  let db, deviceA, deviceB, outsiderDevice, household, memberA, memberB

  const seedMember = async (householdId, name, minutes) => {
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, $2, $3) returning id`,
      [householdId, name, minutes],
    )
    return rows[0].id
  }

  const seedChore = async (householdId, title, minutes) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-24') returning id`,
      [householdId, title, minutes],
    )
    return rows[0].id
  }

  /** The version as the client reads it — coerced, because int8 arrives wide. */
  const versionOf = async (householdId) => {
    const { rows } = await db.query(
      'select assignments_version from public.households where id = $1',
      [householdId],
    )
    return Number(rows[0].assignments_version)
  }

  /** Ground truth, read as the owner. */
  const assignmentOf = async (choreId) => {
    const { rows } = await db.query(
      'select assigned_member_id, assigned_source from public.chores where id = $1',
      [choreId],
    )
    return { holder: rows[0].assigned_member_id, source: rows[0].assigned_source }
  }

  /**
   * What the ORCHESTRATOR does, with pglite as the transport: read the version
   * first, then every input with the client's own privileges, then compute
   * with the real planner. Returns the plan plus what it was computed from.
   */
  const computeAsDevice = async (uid, householdId) =>
    asDevice(db, uid, async () => {
      const version = Number(
        (
          await db.query('select assignments_version from public.households where id = $1', [
            householdId,
          ])
        ).rows[0].assignments_version,
      )
      const members = (
        await db.query(
          'select id, weekly_minutes from public.members where household_id = $1 order by created_at',
          [householdId],
        )
      ).rows
      const memberIds = members.map((m) => m.id)
      const chores = (
        await db.query(
          `select id, expected_minutes, assigned_member_id, assigned_source,
                  completed_at, actual_minutes
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
        await db.query(
          'select chore_id, member_id from public.chore_exclusions where member_id = any($1::uuid[])',
          [memberIds],
        )
      ).rows

      const plan = planReassignment({
        members,
        chores,
        exclusions,
        overrides,
        periodStart: MONDAY,
      })
      return { version, plan }
    })

  const applyAsDevice = async (uid, householdId, version, plan) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query('select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb) as result', [
        householdId,
        version,
        JSON.stringify(plan.placements),
        JSON.stringify(plan.verdict),
      ])
      return rows[0].result
    })

  /** One full re-assignment cycle, the way reassignHousehold runs one. */
  const runCycle = async (uid, householdId) => {
    const { version, plan } = await computeAsDevice(uid, householdId)
    const outcome = await applyAsDevice(uid, householdId, version, plan)
    return { plan, outcome }
  }

  /** This week's capacity, written the way the client's upsert writes it. */
  const writeCapacity = async (uid, householdId, memberId, minutes) =>
    asDevice(db, uid, () =>
      db.query(
        `insert into public.member_capacity (household_id, member_id, period_start, minutes, source)
         values ($1, $2, $3, $4, 'manual')
         on conflict (member_id, period_start) do update set minutes = excluded.minutes`,
        [householdId, memberId, MONDAY, minutes],
      ),
    )

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
    // The outsider's own household — created so `outsiderDevice` is a real
    // signed-in member somewhere, just not HERE.
    await asDevice(db, outsiderDevice, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })

    memberA = household.organizer_member_id
    memberB = await seedMember(household.id, 'Placeholder Two', 300)
    // deviceB acts as memberB — the second phone in the same household.
    await db.query('update public.members set claimed_by = $1 where id = $2', [deviceB, memberB])
    // The organizer's default weekly_minutes comes from create_household;
    // pin it so every arithmetic below is stated, not inherited.
    await db.query('update public.members set weekly_minutes = 300 where id = $1', [memberA])
  })

  // -------------------------------------------------------------------------
  // AC 2 — a capacity write, then the assignments come into line, end to end
  // -------------------------------------------------------------------------

  it('brings the assignments into line with a capacity change, nobody pressing assign', async () => {
    const c1 = await seedChore(household.id, 'Dishes', 120)
    const c2 = await seedChore(household.id, 'Laundry', 120)

    // First run: equal capacities, one chore each.
    await runCycle(deviceA, household.id)
    const first = [await assignmentOf(c1), await assignmentOf(c2)]
    expect(new Set(first.map((a) => a.holder))).toEqual(new Set([memberA, memberB]))
    expect(first.every((a) => a.source === 'auto')).toBe(true)

    // memberB's week collapses; the write is the client's own upsert, and the
    // re-run is the automatic follow — no assign_chore call anywhere in this
    // test, which is the criterion.
    await writeCapacity(deviceB, household.id, memberB, 0)
    await runCycle(deviceB, household.id)

    const after = [await assignmentOf(c1), await assignmentOf(c2)]
    expect(after.map((a) => a.holder)).toEqual([memberA, memberA])
  })

  // -------------------------------------------------------------------------
  // AC 1 — what is persisted is the allocator's answer, nothing added
  // -------------------------------------------------------------------------

  it('persists exactly what the allocation module returns for the same inputs', async () => {
    await seedChore(household.id, 'Dishes', 90)
    await seedChore(household.id, 'Laundry', 45)
    await seedChore(household.id, 'Vacuuming', 30)
    await writeCapacity(deviceA, household.id, memberA, 100)

    const { plan } = await runCycle(deviceA, household.id)

    // The stored state, read back and compared against the plan's own result —
    // a re-computation on the same inputs, which the planner test proves is a
    // direct `reallocate` call. Persistence added nothing and dropped nothing.
    for (const placement of plan.placements) {
      const stored = await assignmentOf(placement.chore_id)
      expect(stored.holder).toBe(placement.member_id)
      expect(stored.source).toBe(placement.member_id === null ? null : 'auto')
    }
  })

  // -------------------------------------------------------------------------
  // AC 6 — two devices race; the version CAS refuses the stale one
  // -------------------------------------------------------------------------

  it('refuses a result computed from a state that moved, and the retry converges', async () => {
    const c1 = await seedChore(household.id, 'Dishes', 100)
    const c2 = await seedChore(household.id, 'Laundry', 100)

    // Device A writes ITS capacity change and computes from what it can see.
    await writeCapacity(deviceA, household.id, memberA, 60)
    const staleRead = await computeAsDevice(deviceA, household.id)

    // Device B's change lands before A applies — the same-second race, spelled
    // out. B computes from a state that includes BOTH writes and applies first.
    await writeCapacity(deviceB, household.id, memberB, 60)
    await runCycle(deviceB, household.id)

    // A's apply now carries a version the household has left behind.
    const refused = await attempt(() =>
      applyAsDevice(deviceA, household.id, staleRead.version, staleRead.plan),
    )
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/changed while re-assignment was computed/)

    // The retry is a fresh cycle — and it must agree with what a direct call
    // on the final inputs says, which is convergence stated as an assertion.
    const retry = await runCycle(deviceA, household.id)
    for (const placement of retry.plan.placements) {
      const stored = await assignmentOf(placement.chore_id)
      expect(stored.holder).toBe(placement.member_id)
    }

    // No chore lost, none doubled: every open chore has exactly one verdict.
    const { rows } = await db.query(
      'select id, assigned_member_id from public.chores where household_id = $1',
      [household.id],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id).sort()).toEqual([c1, c2].sort())
  })

  it('bumps the version on every input the allocator reads', async () => {
    const before = await versionOf(household.id)

    await seedChore(household.id, 'Dishes', 30)
    const afterChore = await versionOf(household.id)
    expect(afterChore).toBeGreaterThan(before)

    await db.query('update public.members set weekly_minutes = 200 where id = $1', [memberB])
    const afterMember = await versionOf(household.id)
    expect(afterMember).toBeGreaterThan(afterChore)

    await writeCapacity(deviceA, household.id, memberA, 100)
    const afterCapacity = await versionOf(household.id)
    expect(afterCapacity).toBeGreaterThan(afterMember)

    await db.query(
      `insert into public.chore_exclusions (household_id, chore_id, member_id)
       select $1, id, $2 from public.chores where household_id = $1 limit 1`,
      [household.id, memberA],
    )
    const afterExclusion = await versionOf(household.id)
    expect(afterExclusion).toBeGreaterThan(afterCapacity)
  })

  // -------------------------------------------------------------------------
  // AC 4 — a manual placement survives every run, and the RPC refuses to touch it
  // -------------------------------------------------------------------------

  it('leaves a hand-assigned chore where it is across a capacity-driven run', async () => {
    const pinned = await seedChore(household.id, 'Dishes', 200)
    await seedChore(household.id, 'Laundry', 60)

    // A person places it — the RPC the chore screen calls.
    await asDevice(db, deviceA, () =>
      db.query('select public.assign_chore($1, $2)', [pinned, memberB]),
    )
    expect(await assignmentOf(pinned)).toEqual({ holder: memberB, source: 'manual' })

    // memberB's week collapses to nothing; the pinned chore still stays.
    await writeCapacity(deviceB, household.id, memberB, 0)
    const { plan } = await runCycle(deviceB, household.id)

    expect(plan.placements.map((p) => p.chore_id)).not.toContain(pinned)
    expect(await assignmentOf(pinned)).toEqual({ holder: memberB, source: 'manual' })
  })

  it('refuses a payload that names a manual chore, and rolls the whole apply back', async () => {
    const pinned = await seedChore(household.id, 'Dishes', 60)
    const free = await seedChore(household.id, 'Laundry', 60)
    await asDevice(db, deviceA, () =>
      db.query('select public.assign_chore($1, $2)', [pinned, memberA]),
    )

    const version = await versionOf(household.id)
    const result = await attempt(() =>
      asDevice(db, deviceA, () =>
        db.query('select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb)', [
          household.id,
          version,
          JSON.stringify([
            { chore_id: free, member_id: memberB },
            { chore_id: pinned, member_id: memberB },
          ]),
          JSON.stringify({ level: true }),
        ]),
      ),
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/open, non-manual chore/)
    // Atomic: the legitimate placement in the same payload did not land either.
    expect(await assignmentOf(free)).toEqual({ holder: null, source: null })
    expect(await assignmentOf(pinned)).toEqual({ holder: memberA, source: 'manual' })
  })

  it('refuses a payload that names a completed chore', async () => {
    const done = await seedChore(household.id, 'Dishes', 60)
    await asDevice(db, deviceA, () => db.query('select public.complete_chore($1)', [done]))

    const version = await versionOf(household.id)
    const result = await attempt(() =>
      asDevice(db, deviceA, () =>
        db.query('select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb)', [
          household.id,
          version,
          JSON.stringify([{ chore_id: done, member_id: memberA }]),
          JSON.stringify({ level: true }),
        ]),
      ),
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/open, non-manual chore/)
  })

  // -------------------------------------------------------------------------
  // AC 5 — a chore nobody may do completes the run unassigned
  // -------------------------------------------------------------------------

  it('completes without error and leaves an impossible chore flagged unassigned', async () => {
    const impossible = await seedChore(household.id, 'Dishes', 60)
    const possible = await seedChore(household.id, 'Laundry', 60)
    for (const member of [memberA, memberB]) {
      await db.query(
        `insert into public.chore_exclusions (household_id, chore_id, member_id)
         values ($1, $2, $3)`,
        [household.id, impossible, member],
      )
    }

    const { plan } = await runCycle(deviceA, household.id)

    expect(plan.placements).toContainEqual({ chore_id: impossible, member_id: null })
    expect(await assignmentOf(impossible)).toEqual({ holder: null, source: null })
    expect((await assignmentOf(possible)).holder).not.toBe(null)
  })

  // -------------------------------------------------------------------------
  // AC 7 — the verdict travels with the result
  // -------------------------------------------------------------------------

  it('stores the run’s verdict on the household, readable by the client', async () => {
    await seedChore(household.id, 'Dishes', 90)
    const { plan } = await runCycle(deviceA, household.id)

    const stored = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query(
        'select last_rebalance from public.households where id = $1',
        [household.id],
      )
      return rows[0].last_rebalance
    })

    expect(stored).toMatchObject({
      level: plan.verdict.level,
      boundByBudget: plan.verdict.boundByBudget,
      jobsMoved: plan.verdict.jobsMoved,
      minutesMoved: plan.verdict.minutesMoved,
      changeBudgetMinutes: plan.verdict.changeBudgetMinutes,
    })
    // Stamped by the SERVER, so "when did this run" cannot depend on a phone's
    // clock — the same reasoning complete_chore gives.
    expect(stored.applied_at).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // The write paths say HOW — assign_chore is manual, the RPC is auto
  // -------------------------------------------------------------------------

  it('marks assign_chore placements manual and unassign_chore clears both columns', async () => {
    const chore = await seedChore(household.id, 'Dishes', 30)

    await asDevice(db, deviceA, () =>
      db.query('select public.assign_chore($1, $2)', [chore, memberB]),
    )
    expect(await assignmentOf(chore)).toEqual({ holder: memberB, source: 'manual' })

    await asDevice(db, deviceA, () => db.query('select public.unassign_chore($1)', [chore]))
    expect(await assignmentOf(chore)).toEqual({ holder: null, source: null })
  })

  // -------------------------------------------------------------------------
  // Access — the household boundary, the column, the function grants
  // -------------------------------------------------------------------------

  it('refuses a caller from another household, and an unauthenticated one', async () => {
    const version = await versionOf(household.id)

    const outsider = await attempt(() =>
      asDevice(db, outsiderDevice, () =>
        db.query('select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb)', [
          household.id,
          version,
          '[]',
          '{}',
        ]),
      ),
    )
    expect(outsider.ok).toBe(false)
    expect(outsider.error).toMatch(/no such household/)

    const anonymous = await attempt(() =>
      asDevice(db, null, () =>
        db.query('select public.apply_assignments($1, $2, $3::jsonb, $4::jsonb)', [
          household.id,
          version,
          '[]',
          '{}',
        ]),
      ),
    )
    expect(anonymous.ok).toBe(false)
    expect(anonymous.error).toMatch(/not authenticated/)
  })

  it('withholds assigned_source from the client’s update grant', async () => {
    const chore = await seedChore(household.id, 'Dishes', 30)

    const direct = await attempt(() =>
      asDevice(db, deviceA, () =>
        db.query(`update public.chores set assigned_source = 'manual' where id = $1`, [chore]),
      ),
    )
    expect(direct.ok).toBe(false)
    expect(direct.error).toMatch(/permission denied/)

    // The SELECT half is granted — the client reads the column on every refresh.
    const read = await asDevice(db, deviceA, () =>
      db.query('select assigned_source from public.chores where id = $1', [chore]),
    )
    expect(read.rows[0].assigned_source).toBe(null)
  })

  // -------------------------------------------------------------------------
  // Re-paste — the normal path, not an edge case
  // -------------------------------------------------------------------------

  it('applies 0018 a second time without error and without moving anything', async () => {
    const chore = await seedChore(household.id, 'Dishes', 30)
    await asDevice(db, deviceA, () =>
      db.query('select public.assign_chore($1, $2)', [chore, memberA]),
    )

    await db.exec(migrationSql('0018_stored_reassignment.sql'))

    // The backfill matched nothing (source already set), the manual mark
    // survived, and the constraint arrived exactly once.
    expect(await assignmentOf(chore)).toEqual({ holder: memberA, source: 'manual' })
    const { rows } = await db.query(
      `select count(*)::int as n from pg_constraint where conname = 'chores_assigned_source_known'`,
    )
    expect(rows[0].n).toBe(1)
  })
})
