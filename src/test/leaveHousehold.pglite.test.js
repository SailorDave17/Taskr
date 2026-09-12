// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #431 — leaving a household, and handing it over, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". The half only the database
// can prove lives here: that leaving removes the caller's own row and nobody
// else's, that the members delete policy still refuses a self-delete, who may
// hand a household to whom, which Google grants the leave function may revoke,
// and that re-applying the file changes nothing. The Google revoke and the
// account deletion are the Edge Function's (its handler.test.js).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'
import { blankSqlComments } from './support/retiredVocabulary.js'

vi.setConfig({ testTimeout: 30_000 })

const FILE = '0043_leave_or_hand_over_a_household.sql'

describe('leaving and handing over a household, run against a real Postgres (#431)', () => {
  let db, organizer, member, outsider, household, organizerRowId, memberRowId

  const rpc = (uid, sql, params = []) =>
    asDevice(db, uid, async () => (await db.query(sql, params)).rows)
  const leave = (uid, id = household) => rpc(uid, 'select public.leave_household($1) as left', [id])
  const transfer = (uid, to, id = household) =>
    rpc(uid, 'select * from public.transfer_household($1, $2)', [id, to])

  const asService = async (fn) => {
    await db.exec('set role service_role')
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }

  const rowExists = async (id) =>
    (await db.query('select count(*)::int as n from public.members where id = $1', [id])).rows[0].n === 1

  beforeEach(async () => {
    db = await freshDatabase()
    organizer = await newDevice(db)
    member = await newDevice(db)
    outsider = await newDevice(db)

    household = await asDevice(db, organizer, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0].id
    })
    organizerRowId = (
      await db.query('select organizer_member_id as id from public.households where id = $1', [household])
    ).rows[0].id

    const { rows: added } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, 'Placeholder One', 60) returning id`,
      [household],
    )
    memberRowId = added[0].id
    await provisionMember(db, memberRowId, member)
  })

  describe('leaving', () => {
    it('removes the caller\'s own row and leaves the chores they held unassigned, for the re-deal', async () => {
      const { rows: chores } = await db.query(
        `insert into public.chores (household_id, title, expected_minutes, due_on, assigned_member_id, assigned_source)
         values ($1, 'Dishes', 20, '2026-08-10', $2, 'auto'), ($1, 'sweep', 10, '2026-08-10', $2, 'manual')
         returning id`,
        [household, memberRowId],
      )
      const [row] = await leave(member)
      expect(row.left).toBe(true)
      expect(await rowExists(memberRowId)).toBe(false)
      expect(await rowExists(organizerRowId)).toBe(true)
      const { rows: after } = await db.query(
        'select assigned_member_id from public.chores where id = any($1::uuid[]) order by title',
        [chores.map((c) => c.id)],
      )
      expect(after.map((c) => c.assigned_member_id)).toEqual([null, null])
    })

    it('can only ever remove the caller: its one argument is the household', async () => {
      const { rows } = await db.query(
        "select pg_get_function_arguments('public.leave_household(uuid)'::regprocedure) as args",
      )
      expect(rows[0].args).toBe('household_id uuid')
    })

    it('leaves the members delete policy exactly as it was: a self-delete is still refused', async () => {
      await rpc(member, 'delete from public.members where id = $1', [memberRowId])
      expect(await rowExists(memberRowId)).toBe(true)
    })

    it('refuses the organizer, in words that say what to do instead', async () => {
      const result = await attempt(() => leave(organizer))
      expect(result.error).toMatch(/hand the household over or delete it first/)
      expect(await rowExists(organizerRowId)).toBe(true)
    })

    it('refuses somebody who is not in the household, and removes nothing', async () => {
      const result = await attempt(() => leave(outsider))
      expect(result.error).toMatch(/not a member of that household/)
      expect(await rowExists(memberRowId)).toBe(true)
      expect(await rowExists(organizerRowId)).toBe(true)
    })

    it('refuses a household pending deletion, like one you were never in', async () => {
      await rpc(organizer, 'select * from public.request_household_deletion($1)', [household])
      const result = await attempt(() => leave(member))
      expect(result.error).toMatch(/not a member of that household/)
      expect(await rowExists(memberRowId)).toBe(true)
    })
  })

  describe('handing the household over', () => {
    it('makes a signed-in member the organizer, after which the old organizer may leave', async () => {
      const [row] = await transfer(organizer, memberRowId)
      expect(row.organizer_member_id).toBe(memberRowId)
      const [{ yes }] = await rpc(member, 'select public.is_household_organizer($1) as yes', [household])
      expect(yes).toBe(true)
      const [left] = await leave(organizer)
      expect(left.left).toBe(true)
      expect(await rowExists(organizerRowId)).toBe(false)
    })

    it('refuses a member who is not the organizer', async () => {
      const result = await attempt(() => transfer(member, memberRowId))
      expect(result.error).toMatch(/only the household's organizer can hand it over/)
    })

    it('refuses a member who has never signed in, who could not organize anything', async () => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, 'Placeholder Two', 30) returning id`,
        [household],
      )
      const result = await attempt(() => transfer(organizer, rows[0].id))
      expect(result.error).toMatch(/somebody who has signed in/)
    })

    it('refuses somebody from another household, and the organizer themselves', async () => {
      const other = await asDevice(db, outsider, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Placeholder Other Household',
          'Placeholder Other Organizer',
        ])
        return rows[0].organizer_member_id
      })
      expect((await attempt(() => transfer(organizer, other))).error).toMatch(/not in this household/)
      expect((await attempt(() => transfer(organizer, organizerRowId))).error).toMatch(/already organize/)
      const { rows } = await db.query('select organizer_member_id from public.households where id = $1', [household])
      expect(rows[0].organizer_member_id).toBe(organizerRowId)
    })

    it('refuses to hand over a household pending deletion', async () => {
      await rpc(organizer, 'select * from public.request_household_deletion($1)', [household])
      const result = await attempt(() => transfer(organizer, memberRowId))
      expect(result.error).toMatch(/only the household's organizer can hand it over/)
    })
  })

  describe('the grants the leave function may revoke', () => {
    const connect = (householdId, memberId, token) =>
      db.query(
        `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope)
         values ($1, $2, $3, 'https://www.googleapis.com/auth/calendar.freebusy')`,
        [householdId, memberId, token],
      )
    const offered = async (memberId) =>
      (
        await asService(
          async () => (await db.query('select refresh_token from public.member_tokens_to_revoke($1)', [memberId])).rows,
        )
      ).map((row) => row.refresh_token)

    it('is executable by service_role and by no client role', async () => {
      const { rows } = await db.query(
        `select has_function_privilege('service_role', 'public.member_tokens_to_revoke(uuid)', 'execute') as service,
                has_function_privilege('authenticated', 'public.member_tokens_to_revoke(uuid)', 'execute') as authenticated,
                has_function_privilege('anon', 'public.member_tokens_to_revoke(uuid)', 'execute') as anon`,
      )
      expect(rows[0]).toEqual({ service: true, authenticated: false, anon: false })
    })

    it('offers the leaver\'s grant, unless they are still connected in another household', async () => {
      const staying = await asDevice(db, outsider, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Placeholder Other Household',
          'Placeholder Other Organizer',
        ])
        return rows[0]
      })
      const { rows: elsewhere } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
         values ($1, 'Placeholder One', 60, $2) returning id`,
        [staying.id, member],
      )
      await connect(household, memberRowId, 'token-member-here')
      await connect(staying.id, elsewhere[0].id, 'token-member-elsewhere')
      // Everybody else's grants exist at BOTH assertions — one in this
      // household, one in the other. Without them a read of every token in the
      // table looks exactly like a read of the leaver's, and the function's
      // `t.member_id = …` clause could be deleted on a green suite
      // (review-fanout, 2026-09-11).
      await connect(household, organizerRowId, 'token-organizer-here')
      await connect(staying.id, staying.organizer_member_id, 'token-outsider-elsewhere')
      expect(await offered(memberRowId)).toEqual([])
      // POSITIVE CONTROL: once the leaver's other connection goes, the grant
      // here is offered — and only it.
      await db.query('delete from public.calendar_tokens where member_id = $1', [elsewhere[0].id])
      expect(await offered(memberRowId)).toEqual(['token-member-here'])
    })
  })

  it('revokes each function from the right roles BY NAME in the source, which the hosted platform grants and this harness cannot see', () => {
    // 0042's reason: the hosted project grants EXECUTE on a new function to
    // anon, authenticated and service_role by name, and a revoke that leaves a
    // role out leaves that grant standing while pglite reads false either way.
    const sql = blankSqlComments(migrationSql(FILE))
    expect(sql).toMatch(/^revoke all on function public\.leave_household\(uuid\) from public, anon;/m)
    expect(sql).toMatch(/^revoke all on function public\.transfer_household\(uuid, uuid\) from public, anon;/m)
    expect(sql).toMatch(
      /^revoke all on function public\.member_tokens_to_revoke\(uuid\) from public, anon, authenticated;/m,
    )
  })

  it('locks the household row before asking whether the caller organizes, so a racing hand-over cannot orphan it', () => {
    // One pglite connection cannot run two transactions at once, so the race
    // itself is not reproducible here; the ORDER that prevents it is. The
    // interleaving it closes is in 0043's header (review-fanout, 2026-09-11).
    const sql = blankSqlComments(migrationSql(FILE))
    const body = sql.slice(
      sql.indexOf('create or replace function public.leave_household'),
      sql.indexOf('create or replace function public.transfer_household'),
    )
    const lock = body.search(/from public\.households h where h\.id = leave_household\.household_id for update;/)
    const check = body.indexOf('public.is_household_organizer(leave_household.household_id)')
    expect(lock).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(check)
  })

  it('re-applying the file changes nothing', async () => {
    await db.exec(migrationSql(FILE))
    const [row] = await leave(member)
    expect(row.left).toBe(true)
    expect((await attempt(() => leave(organizer))).error).toMatch(/hand the household over or delete it first/)
  })
})
