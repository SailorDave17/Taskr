// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #430 — an organizer deletes the household, with a grace period before it is
// purged, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". The half only the database
// can prove lives here: who may request, restore and read the status; that a
// household pending deletion is unreachable to its members through the tables
// AND through the definer functions that check membership themselves; that the
// purge's functions refuse every client role this harness models (the hosted
// platform's by-name grants are asserted on the source instead — the harness
// cannot see them); which Google grants the purge may revoke; that a purge
// leaves no row behind and is safe to run twice; and that re-applying the file
// changes nothing.

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

const FILE = '0042_delete_a_household_with_a_grace_period.sql'

describe('deleting a household, run against a real Postgres (#430)', () => {
  let db, organizer, member, outsider, household, memberRowId, choreId

  const asService = async (fn) => {
    await db.exec('set role service_role')
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }

  const rpc = (uid, sql, params = []) =>
    asDevice(db, uid, async () => (await db.query(sql, params)).rows)

  const request = (uid, id = household) =>
    rpc(uid, 'select * from public.request_household_deletion($1)', [id])
  const restore = (uid, id = household) =>
    rpc(uid, 'select * from public.restore_household($1)', [id])
  const status = (uid) => rpc(uid, 'select * from public.household_deletion_status()')

  /** Move the pending household's grace period into the past, as the owner. */
  const expire = () =>
    db.query(
      `update public.households
          set deletion_requested_at = now() - interval '8 days',
              purge_after = now() - interval '1 day'
        where id = $1`,
      [household],
    )

  /** A calendar connection for one member, written as the owner the way calendar.pglite.test.js does. */
  const connectCalendar = (householdId, memberId, refreshToken) =>
    db.query(
      `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope)
       values ($1, $2, $3, 'https://www.googleapis.com/auth/calendar.freebusy')`,
      [householdId, memberId, refreshToken],
    )

  const organizerRowId = async () =>
    (await db.query('select organizer_member_id as id from public.households where id = $1', [household])).rows[0].id

  /** Every public table with a household_id column, and its rows for this household. */
  const rowsLeftFor = async (id) => {
    const { rows: tables } = await db.query(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'household_id'
          and table_name in (select table_name from information_schema.tables
                              where table_schema = 'public' and table_type = 'BASE TABLE')
        order by table_name`,
    )
    const left = {}
    for (const { table_name: table } of tables) {
      const { rows } = await db.query(
        `select count(*)::int as n from public.${table} where household_id = $1`,
        [id],
      )
      if (rows[0].n > 0) left[table] = rows[0].n
    }
    const { rows: own } = await db.query('select count(*)::int as n from public.households where id = $1', [id])
    if (own[0].n > 0) left.households = own[0].n
    return { tablesChecked: tables.length, left }
  }

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

    const { rows: added } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, 'Placeholder One', 60) returning id`,
      [household],
    )
    memberRowId = added[0].id
    await provisionMember(db, memberRowId, member)

    const { rows: chore } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, 'Dishes', 20, '2026-08-10') returning id`,
      [household],
    )
    choreId = chore[0].id
  })

  describe('requesting deletion', () => {
    it('lets the organizer schedule it, with the purge exactly one grace period later', async () => {
      const [row] = await request(organizer)
      expect(row.deletion_requested_at).not.toBeNull()
      const { rows } = await db.query(
        `select purge_after - deletion_requested_at = public.household_grace_period() as exact,
                public.household_grace_period() = interval '7 days' as seven
           from public.households where id = $1`,
        [household],
      )
      expect(rows[0]).toEqual({ exact: true, seven: true })
    })

    it('refuses a member who is not the organizer, and an outsider, in the same words', async () => {
      for (const uid of [member, outsider]) {
        const result = await attempt(() => request(uid))
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/only the household's organizer can delete it/)
      }
      const { rows } = await db.query('select deletion_requested_at from public.households where id = $1', [household])
      expect(rows[0].deletion_requested_at).toBeNull()
    })

    it('refuses a second request while one is pending', async () => {
      await request(organizer)
      const result = await attempt(() => request(organizer))
      expect(result.error).toMatch(/already scheduled for deletion/)
    })

    it('refuses a half-set pair at the constraint, so the filter and the purge cannot disagree', async () => {
      const result = await attempt(() =>
        db.query('update public.households set deletion_requested_at = now() where id = $1', [household]),
      )
      expect(result.error).toMatch(/households_deletion_is_whole/)
    })
  })

  describe('a household pending deletion is unreachable to its members', () => {
    beforeEach(async () => {
      await request(organizer)
    })

    it('POSITIVE CONTROL: before the request, the member reads the household, its roster and its chores', async () => {
      await restore(organizer)
      const households = await rpc(member, 'select id from public.households')
      const chores = await rpc(member, 'select id from public.chores')
      expect(households.map((h) => h.id)).toEqual([household])
      expect(chores.map((c) => c.id)).toEqual([choreId])
    })

    it('hides the household, its members and its chores from every member, the organizer included', async () => {
      for (const uid of [member, organizer]) {
        expect(await rpc(uid, 'select id from public.households')).toEqual([])
        expect(await rpc(uid, 'select id from public.members')).toEqual([])
        expect(await rpc(uid, 'select id from public.chores')).toEqual([])
      }
    })

    it('refuses the definer RPCs that resolve membership themselves', async () => {
      const complete = await attempt(() => rpc(member, 'select * from public.complete_chore($1)', [choreId]))
      expect(complete.error).toMatch(/no such chore in your household/)

      const apply = await attempt(() =>
        rpc(member, `select public.apply_assignments($1, 0, '[]'::jsonb, '{}'::jsonb)`, [household]),
      )
      expect(apply.error).toMatch(/no such household for this member/)

      const acting = await rpc(member, 'select public.acting_member($1) as id', [household])
      expect(acting[0].id).toBeNull()
      const organizes = await rpc(organizer, 'select public.is_household_organizer($1) as yes', [household])
      expect(organizes[0].yes).toBe(false)
    })

    it('stops the organizer removing a member, because the organizer policy asks the patched helper', async () => {
      await rpc(organizer, 'delete from public.members where id = $1', [memberRowId])
      const { rows } = await db.query('select count(*)::int as n from public.members where id = $1', [memberRowId])
      expect(rows[0].n).toBe(1)
    })

    it('still shows the organizer its status, and only the organizer', async () => {
      const [row] = await status(organizer)
      expect(row.household_id).toBe(household)
      expect(row.household_name).toBe('Placeholder Household')
      expect(row.purge_after).not.toBeNull()
      expect(await status(member)).toEqual([])
      expect(await status(outsider)).toEqual([])
    })
  })

  describe('restoring', () => {
    beforeEach(async () => {
      await request(organizer)
    })

    it('lets the organizer restore it inside the grace period, and the member reads it again', async () => {
      const [row] = await restore(organizer)
      expect(row.deletion_requested_at).toBeNull()
      expect(row.purge_after).toBeNull()
      const households = await rpc(member, 'select id from public.households')
      expect(households.map((h) => h.id)).toEqual([household])
      // The status lists pending households only: a restored one drops out
      // (#430 review — nothing else exercised the only-pending half).
      expect(await status(organizer)).toEqual([])
    })

    it('refuses a member who is not the organizer', async () => {
      const result = await attempt(() => restore(member))
      expect(result.error).toMatch(/only the household's organizer can restore it/)
    })

    it('refuses once the grace period has ended, even before the purge has run', async () => {
      await expire()
      const result = await attempt(() => restore(organizer))
      expect(result.error).toMatch(/grace period has ended/)
    })

    it('stops listing it in the status once the grace period has ended, since a restore would be refused', async () => {
      expect(await status(organizer)).toHaveLength(1)
      await expire()
      expect(await status(organizer)).toEqual([])
    })

    it('refuses a household that is not pending', async () => {
      await restore(organizer)
      const result = await attempt(() => restore(organizer))
      expect(result.error).toMatch(/not scheduled for deletion/)
    })
  })

  describe('the purge functions', () => {
    const PURGE_FUNCTIONS = [
      'households_due_for_purge()',
      'household_tokens_to_revoke(uuid)',
      'purge_household(uuid)',
      'record_household_purge_run(integer, integer, integer)',
    ]

    // In THIS harness only: pgliteSupabase.js sets default privileges for
    // tables, not functions, so `authenticated` and `anon` read false here
    // whether or not a revoke names them. The next test is the half that can see it.
    it('are executable by service_role and by no client role', async () => {
      for (const fn of PURGE_FUNCTIONS) {
        const { rows } = await db.query(
          `select has_function_privilege('service_role', 'public.${fn}', 'execute') as service,
                  has_function_privilege('authenticated', 'public.${fn}', 'execute') as authenticated,
                  has_function_privilege('anon', 'public.${fn}', 'execute') as anon`,
        )
        expect(rows[0], fn).toEqual({ service: true, authenticated: false, anon: false })
      }
    })

    it('revoke EXECUTE from authenticated and anon by name in the source, which the hosted platform grants and this harness cannot see', () => {
      // The hosted project grants EXECUTE on a new function to anon,
      // authenticated and service_role by name (0017 recorded it on the live
      // complete_chore), so a revoke that leaves a role out leaves that role's
      // grant standing — measured in PGlite at #430's review. The idiom is
      // invitations.pglite.test.js's.
      const sql = blankSqlComments(migrationSql(FILE))
      for (const fn of PURGE_FUNCTIONS) {
        const name = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expect(sql, fn).toMatch(
          new RegExp(`^revoke all on function public\\.${name}\\s+from public, anon, authenticated;`, 'm'),
        )
      }
    })

    it('list only households whose grace period is over, with the sign-ins read before the delete', async () => {
      await request(organizer)
      expect(await asService(async () => (await db.query('select * from public.households_due_for_purge()')).rows)).toEqual([])
      await expire()
      const due = await asService(async () => (await db.query('select * from public.households_due_for_purge()')).rows)
      expect(due).toHaveLength(1)
      expect(due[0].household_id).toBe(household)
      expect([...due[0].claimants].sort()).toEqual([organizer, member].sort())
    })

    it('offer every grant for revoking except one whose person is still connected in another household', async () => {
      // The member is claimed here AND in a household that is staying, with a
      // calendar connected in both; one Google account holds one grant with
      // Taskr's client, so revoking theirs would break the other household's
      // calendar (owner decision at #430's review). The organizer is connected
      // here only.
      const staying = await asDevice(db, outsider, async () => {
        const { rows } = await db.query('select * from public.create_household($1, $2)', [
          'Placeholder Other Household',
          'Placeholder Other Organizer',
        ])
        return rows[0].id
      })
      const { rows: elsewhere } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
         values ($1, 'Placeholder One', 60, $2) returning id`,
        [staying, member],
      )
      await connectCalendar(household, await organizerRowId(), 'token-organizer')
      await connectCalendar(household, memberRowId, 'token-member-here')
      await connectCalendar(staying, elsewhere[0].id, 'token-member-elsewhere')

      const offered = async () =>
        (
          await asService(
            async () => (await db.query('select refresh_token from public.household_tokens_to_revoke($1)', [household])).rows,
          )
        )
          .map((row) => row.refresh_token)
          .sort()

      expect(await offered()).toEqual(['token-organizer'])
      // POSITIVE CONTROL: once the other connection goes, the member's grant here is offered too.
      await db.query('delete from public.calendar_tokens where household_id = $1', [staying])
      expect(await offered()).toEqual(['token-member-here', 'token-organizer'])
    })

    it('will not delete a household that is not due, whoever calls', async () => {
      await request(organizer)
      const purged = await asService(async () =>
        (await db.query('select public.purge_household($1) as ok', [household])).rows[0].ok,
      )
      expect(purged).toBe(false)
      const { left } = await rowsLeftFor(household)
      expect(left.households).toBe(1)
    })

    it('leaves no row of a due household in any public table, and a second call is a no-op', async () => {
      await connectCalendar(household, await organizerRowId(), 'token-organizer')
      await request(organizer)
      await expire()
      const before = await rowsLeftFor(household)
      expect(Object.keys(before.left).length, 'the positive control: rows exist to delete').toBeGreaterThan(1)
      expect(before.left.calendar_tokens, 'the positive control: a Google grant exists to lose').toBe(1)

      const first = await asService(async () =>
        (await db.query('select public.purge_household($1) as ok', [household])).rows[0].ok,
      )
      const second = await asService(async () =>
        (await db.query('select public.purge_household($1) as ok', [household])).rows[0].ok,
      )
      expect(first).toBe(true)
      expect(second).toBe(false)

      const after = await rowsLeftFor(household)
      expect(after.tablesChecked).toBeGreaterThan(10)
      expect(after.left).toEqual({})
    })

    it('can be refused by no table: every foreign key into households cascades, whatever the fixture left empty', async () => {
      // The purge test above has rows in only a few tables; a foreign key that
      // stopped cascading on an EMPTY table would refuse nothing there and
      // every real purge of a household holding such rows (#430 review). The
      // catalog sees every table at once.
      const { rows } = await db.query(
        `select conrelid::regclass::text as tbl, conname, confdeltype::text as on_delete
           from pg_constraint
          where contype = 'f' and confrelid = 'public.households'::regclass
          order by 1, 2`,
      )
      expect(rows.length, 'the positive control: there are foreign keys to check').toBeGreaterThan(5)
      expect(rows.filter((row) => row.on_delete !== 'c').map((row) => `${row.tbl}.${row.conname}`)).toEqual([])
    })

    it('records a run in a table no role can read or write directly', async () => {
      await asService(() => db.query('select public.record_household_purge_run(2, 1, 1)'))
      const { rows } = await db.query('select due, purged, failures from public.household_purge_runs')
      expect(rows).toEqual([{ due: 2, purged: 1, failures: 1 }])

      for (const role of ['service_role', 'authenticated', 'anon']) {
        const { rows: priv } = await db.query(
          `select has_table_privilege($1, 'public.household_purge_runs', 'select')
               or has_table_privilege($1, 'public.household_purge_runs', 'insert') as any`,
          [role],
        )
        expect(priv[0].any, role).toBe(false)
      }
    })
  })

  it('refuses a valid invitation to a pending household in the usual words, and honours it again after restore', async () => {
    // Behaviour, not the function's text: an outsider holding a good code is
    // exactly the "non-member write" the story says is refused. Minted as the
    // owner, the way invitations.pglite.test.js mints, so this is a test of
    // redeeming rather than of writing.
    const { rows: org } = await db.query('select organizer_member_id from public.households where id = $1', [household])
    await db.query(
      `insert into public.invitations (household_id, token_hash, created_by_member_id, expires_at)
       values ($1, extensions.digest($2, 'sha256'), $3, now() + interval '7 days')`,
      [household, 'k7m3qp4rwn', org[0].organizer_member_id],
    )
    const redeem = () => rpc(outsider, 'select * from public.redeem_invitation($1)', ['k7m3qp4rwn'])

    await request(organizer)
    const refused = await attempt(redeem)
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/^that invitation cannot be used$/)

    await restore(organizer)
    const admitted = await attempt(redeem)
    expect(admitted.ok, admitted.error).toBe(true)
    expect(admitted.value[0].household_id).toBe(household)
  })

  it('RE-PASTE HAZARD: 0041 re-pasted on top takes the pending-deletion refusal out of redeem_invitation, and 0042 puts it back', async () => {
    // 0028's hazard, met again: an older file that declares the same function,
    // re-pasted alone, succeeds silently and removes this file's change. Here
    // that would let an invitation admit somebody into a household pending
    // deletion. Asserted so docs/access-model.md's safe re-paste order is a
    // measured claim.
    const refuses = async () =>
      (
        await db.query(
          `select position('deletion_requested_at' in
                    pg_get_functiondef('public.redeem_invitation(text)'::regprocedure)) > 0 as yes`,
        )
      ).rows[0].yes

    expect(await refuses()).toBe(true)
    await db.exec(migrationSql('0041_invitation_code_whitespace.sql'))
    expect(await refuses()).toBe(false)
    await db.exec(migrationSql(FILE))
    expect(await refuses()).toBe(true)
  })

  it('re-applying the file changes nothing', async () => {
    await request(organizer)
    await db.exec(migrationSql(FILE))
    const [row] = await status(organizer)
    expect(row.household_id).toBe(household)
    expect(await rpc(member, 'select id from public.households')).toEqual([])
  })
})
