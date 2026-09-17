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
      // #180 AC 7 — the ORGANIZER's own row too. Since 0016 a member's
      // self-delete is refused twice over (not the organizer, and themselves),
      // so only the organizer's attempt rests on 0007's clause alone: with that
      // clause removed the assertion above stays green and this one reddens
      // (measured by mutation, #180).
      await rpc(organizer, 'delete from public.members where id = $1', [organizerRowId])
      expect(await rowExists(organizerRowId)).toBe(true)
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

    it('#179 AC 6 — is executable by a signed-in member and not by anon', async () => {
      // The harness's `anon` reads false either way once `from public` is
      // revoked (#368's measurement), so the live half of this criterion is
      // `npm run probe:live-grants` and the read-only catalog query recorded in
      // docs/access-model.md; the source-text assertion below is what catches a
      // revoke that leaves `anon` out. This asserts the ACL the file leaves
      // behind, with `authenticated` as the positive control that the read can
      // report a grant that is there.
      const { rows } = await db.query(
        `select has_function_privilege('anon', 'public.transfer_household(uuid, uuid)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.transfer_household(uuid, uuid)', 'execute') as authenticated`,
      )
      expect(rows[0]).toEqual({ anon: false, authenticated: true })
    })

    it('#179 AC 3 — is a definer, and the households UPDATE grant is NOT widened to organizer_member_id', async () => {
      // 0005's reason: with `organizer_member_id` in the column grant, the
      // update policy would let any member make themselves organizer. The
      // definer is how the role changes hands WITHOUT that grant, so the two
      // are asserted together — widen the grant and this reddens naming the
      // column, which is AC 7's mutation.
      const { rows: fn } = await db.query(
        `select prosecdef from pg_proc where oid = 'public.transfer_household(uuid, uuid)'::regprocedure`,
      )
      expect(fn[0].prosecdef).toBe(true)
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'households'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(rows.map((r) => r.column_name)).not.toContain('organizer_member_id')
      // POSITIVE CONTROL: the same read finds the two columns 0005 does grant.
      expect(rows.map((r) => r.column_name)).toEqual(['name', 'timezone'])
    })
  })

  describe('the grants the leave function may revoke', () => {
    // Every token carries its Google account: since 0047 (#474) a token with
    // none is never offered, which would make every assertion below read [].
    // The keying rule itself is revokeKeying.pglite.test.js's.
    const connect = (householdId, memberId, token, sub) =>
      db.query(
        `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope, google_sub)
         values ($1, $2, $3, 'https://www.googleapis.com/auth/calendar.freebusy', $4)`,
        [householdId, memberId, token, sub],
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
      await connect(household, memberRowId, 'token-member-here', 'sub-member')
      await connect(staying.id, elsewhere[0].id, 'token-member-elsewhere', 'sub-member')
      // Everybody else's grants exist at BOTH assertions — one in this
      // household, one in the other. Without them a read of every token in the
      // table looks exactly like a read of the leaver's, and the function's
      // `t.member_id = …` clause could be deleted on a green suite
      // (review-fanout, 2026-09-11).
      await connect(household, organizerRowId, 'token-organizer-here', 'sub-organizer')
      await connect(staying.id, staying.organizer_member_id, 'token-outsider-elsewhere', 'sub-outsider')
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

  // #180 — the criteria #431 shipped without a test of their own.
  describe('#180 — what leaving takes with it, read back row by row', () => {
    // AC 4: five outcomes, five assertions, none of them "the delete was
    // issued". The organizer holds a row in every one of the same tables as
    // the control: a cascade that emptied a table would pass the leaver's
    // assertion on its own.
    let chores
    const count = async (table, memberId) =>
      (await db.query(`select count(*)::int as n from public.${table} where member_id = $1`, [memberId]))
        .rows[0].n

    beforeEach(async () => {
      const { rows } = await db.query(
        `insert into public.chores
           (household_id, title, expected_minutes, due_on, assigned_member_id, assigned_source, completed_at, completed_by_member_id)
         values
           ($1, 'Dishes', 20, '2026-08-10', $2, 'auto', null, null),
           ($1, 'sweep', 10, '2026-08-10', $2, 'manual', null, null),
           ($1, 'dust', 10, '2026-08-10', $3, 'auto', null, null),
           ($1, 'bins', 5, '2026-08-09', null, null, now(), $2),
           ($1, 'mop', 15, '2026-08-09', null, null, now(), $3)
         returning id, title`,
        [household, memberRowId, organizerRowId],
      )
      chores = Object.fromEntries(rows.map((r) => [r.title, r.id]))
      await db.query(
        `insert into public.member_capacity (household_id, member_id, period_start, minutes)
         values ($1, $2, '2026-08-10', 90), ($1, $3, '2026-08-10', 45)`,
        [household, memberRowId, organizerRowId],
      )
      await db.query(
        `insert into public.chore_exclusions (household_id, chore_id, member_id)
         values ($1, $2, $3), ($1, $2, $4)`,
        [household, chores.dust, memberRowId, organizerRowId],
      )
      await db.query(
        `insert into public.calendar_connections (household_id, member_id, scope)
         values ($1, $2, 'freebusy'), ($1, $3, 'freebusy')`,
        [household, memberRowId, organizerRowId],
      )
      await db.query(
        `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope)
         values ($1, $2, 'token-leaver', 'freebusy'), ($1, $3, 'token-organizer', 'freebusy')`,
        [household, memberRowId, organizerRowId],
      )
      // The attribution edges that landed after #180 was filed (review-fanout,
      // 2026-09-16): a shopping run the leaver closed with an item they added
      // and bought, a calendar import they made, an invitation they created and
      // one they redeemed. Every one is `on delete set null`, the completions
      // shape, and the organizer holds the control row in each table.
      const { rows: lists } = await db.query(
        `insert into public.shopping_lists (household_id, name) values ($1, 'Groceries') returning id`,
        [household],
      )
      const { rows: runs } = await db.query(
        `insert into public.shopping_runs (list_id, household_id, closed_at, closed_by_member_id)
         values ($1, $2, now(), $3) returning id`,
        [lists[0].id, household, memberRowId],
      )
      await db.query(
        `insert into public.shopping_items (run_id, household_id, name, added_by_member_id, purchased_at, purchased_by_member_id)
         values ($1, $2, 'milk', $3, now(), $3), ($1, $2, 'bread', $4, null, null)`,
        [runs[0].id, household, memberRowId, organizerRowId],
      )
      await db.query(
        `insert into public.calendar_imports (household_id, member_id, calendar_event_id, chore_id)
         values ($1, $2, 'event-leaver', $3), ($1, $4, 'event-organizer', $5)`,
        [household, memberRowId, chores.Dishes, organizerRowId, chores.mop],
      )
      await db.query(
        `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at, redeemed_at, redeemed_by_member_id)
         values ($1, decode('01', 'hex'), $2, now() + interval '1 day', null, null),
                ($1, decode('02', 'hex'), $3, now() + interval '1 day', now(), $2)`,
        [household, memberRowId, organizerRowId],
      )
      const [row] = await leave(member)
      expect(row.left).toBe(true)
    })

    it('1. a completion the leaver recorded keeps its row and loses its name (0004: set null)', async () => {
      const { rows } = await db.query(
        'select completed_at is not null as done, completed_by_member_id as who from public.chores where id = $1',
        [chores.bins],
      )
      expect(rows).toEqual([{ done: true, who: null }])
      const { rows: control } = await db.query(
        'select completed_by_member_id as who from public.chores where id = $1',
        [chores.mop],
      )
      expect(control).toEqual([{ who: organizerRowId }])
    })

    it('2. chores assigned to the leaver become unassigned, hand-placed or dealt (0006: set null)', async () => {
      const { rows } = await db.query(
        'select title, assigned_member_id as who from public.chores where id = any($1::uuid[]) order by title',
        [[chores.Dishes, chores.dust, chores.sweep]],
      )
      expect(rows).toEqual([
        { title: 'Dishes', who: null },
        { title: 'dust', who: organizerRowId },
        { title: 'sweep', who: null },
      ])
    })

    it('3. their weekly capacity is destroyed (0005: cascade)', async () => {
      expect(await count('member_capacity', memberRowId)).toBe(0)
      expect(await count('member_capacity', organizerRowId)).toBe(1)
    })

    it('4. their chore exclusions are destroyed (0010: cascade)', async () => {
      expect(await count('chore_exclusions', memberRowId)).toBe(0)
      expect(await count('chore_exclusions', organizerRowId)).toBe(1)
    })

    it('5. their calendar connection and its token are destroyed (0011: cascade)', async () => {
      expect(await count('calendar_connections', memberRowId)).toBe(0)
      expect(await count('calendar_tokens', memberRowId)).toBe(0)
      expect(await count('calendar_connections', organizerRowId)).toBe(1)
      expect(await count('calendar_tokens', organizerRowId)).toBe(1)
    })

    it('6. shopping, calendar imports and invitations keep their rows and lose the leaver\'s name (0032, 0038, 0040: set null)', async () => {
      const { rows: items } = await db.query(
        `select name, added_by_member_id as added_by, purchased_at is not null as bought, purchased_by_member_id as bought_by
         from public.shopping_items order by name`,
      )
      expect(items).toEqual([
        { name: 'bread', added_by: organizerRowId, bought: false, bought_by: null },
        { name: 'milk', added_by: null, bought: true, bought_by: null },
      ])
      const { rows: runs } = await db.query(
        'select closed_at is not null as closed, closed_by_member_id as closed_by from public.shopping_runs',
      )
      expect(runs).toEqual([{ closed: true, closed_by: null }])
      const { rows: imports } = await db.query(
        'select calendar_event_id as event, member_id from public.calendar_imports order by calendar_event_id',
      )
      expect(imports).toEqual([
        { event: 'event-leaver', member_id: null },
        { event: 'event-organizer', member_id: organizerRowId },
      ])
      const { rows: invitations } = await db.query(
        `select created_by_member_id as created_by, redeemed_at is not null as redeemed, redeemed_by_member_id as redeemed_by
         from public.invitations order by token_hash`,
      )
      expect(invitations).toEqual([
        { created_by: null, redeemed: false, redeemed_by: null },
        { created_by: organizerRowId, redeemed: true, redeemed_by: null },
      ])
    })

    it('7. 0044 — the check that refused this leave is gone, its one-directional replacement stands, and the file re-applies', async () => {
      // With 0040's `invitations_redeemed_whole` in place the beforeEach above
      // FAILS at the leave (measured 2026-09-16: the FK blanks the redeemer,
      // the symmetric check refuses the row, Postgres refuses the delete), so
      // the six tests above are the proof it is gone. This one pins what
      // replaced it, in the catalog and in behaviour.
      const names = async () =>
        (
          await db.query(
            `select conname from pg_constraint
             where conrelid = 'public.invitations'::regclass and conname like 'invitations_redee%'
             order by conname`,
          )
        ).rows.map((r) => r.conname)
      expect(await names()).toEqual(['invitations_redeemer_implies_stamp', 'invitations_redeemer_in_household'])
      // The direction that stays refused: a redeemer with no stamp.
      const stray = await attempt(() =>
        db.query('update public.invitations set redeemed_by_member_id = $1 where redeemed_at is null', [
          organizerRowId,
        ]),
      )
      expect(stray.ok).toBe(false)
      expect(stray.error).toMatch(/invitations_redeemer_implies_stamp/)
      await db.exec(migrationSql('0044_a_redeemed_invitation_survives_its_redeemer.sql'))
      expect(await names()).toEqual(['invitations_redeemer_implies_stamp', 'invitations_redeemer_in_household'])
    })
  })

  describe('#180 — the last member, and a member of two households', () => {
    it('AC 6 — refuses the last member, who IS the organizer, so their way out is deleting the household', async () => {
      // Nothing a client holds can leave a household with members and no
      // organizer: the delete policy (0016) is organizer-only and still refuses
      // the organizer's own row, `leave_household` refuses the organizer, and
      // `transfer_household` hands to a member who exists. So "the last member"
      // and "the organizer" are one person, and the Who tab offers that person
      // Delete alone (RosterLeaveHousehold.test.jsx: "with nobody else signed
      // in"). This pins the database half of that routing.
      await db.query('delete from public.members where id = $1', [memberRowId])
      const { rows: left } = await db.query(
        'select count(*)::int as n from public.members where household_id = $1',
        [household],
      )
      expect(left[0].n).toBe(1)
      const result = await attempt(() => leave(organizer))
      expect(result.error).toMatch(/hand the household over or delete it first/)
      expect(await rowExists(organizerRowId)).toBe(true)
      const { rows } = await db.query('select organizer_member_id as who from public.households where id = $1', [
        household,
      ])
      expect(rows).toEqual([{ who: organizerRowId }])
    })

    it('AC 8 — leaving one of two households leaves the other membership untouched, and the only one readable', async () => {
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
      const readable = async () => (await rpc(member, 'select id from public.households')).map((h) => h.id).sort()
      const memberships = async () =>
        (await rpc(member, 'select h as id from public.current_household_ids() as h')).map((r) => r.id)
      expect(await readable()).toEqual([household, staying.id].sort())

      const [row] = await leave(member)
      expect(row.left).toBe(true)

      expect(await rowExists(elsewhere[0].id)).toBe(true)
      expect(await readable()).toEqual([staying.id])
      expect(await memberships()).toEqual([staying.id])
      // Leaving is not deleting: the household left still stands, organizer and all.
      expect(await rowExists(organizerRowId)).toBe(true)
    })
  })
})
