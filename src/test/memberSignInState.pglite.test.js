// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #458 — `member_sign_in_states`, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". The stub's auth.users
// carries the two columns 0045 reads; GoTrue is what writes them for real, and
// what it writes is recorded in the migration's header, not proven here.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'

vi.setConfig({ testTimeout: 30_000 })

const FILE = '0045_member_sign_in_state.sql'
const INVITED = '2026-09-16T02:44:12Z'
const ACCEPTED = '2026-09-16T02:45:12Z'

describe('member_sign_in_states, run against a real Postgres (#458)', () => {
  let db, organizer, pending, outsider, household, organizerRowId, pendingRowId, unclaimedRowId

  const states = (uid, id = household) =>
    asDevice(db, uid, async () =>
      (
        await db.query(
          'select member_id, invited_at, confirmed_at from public.member_sign_in_states($1) order by member_id',
          [id],
        )
      ).rows,
    )

  const addMember = async (householdId, name) =>
    (
      await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, $2, 60) returning id`,
        [householdId, name],
      )
    ).rows[0].id

  const createHousehold = (uid, name) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        name,
        'Placeholder Organizer',
      ])
      return rows[0].id
    })

  beforeEach(async () => {
    db = await freshDatabase()
    organizer = await newDevice(db)
    pending = await newDevice(db)
    outsider = await newDevice(db)
    // The organizer signed up and confirmed; the other member was invited and
    // has opened nothing — #178's 02:44:12 reading.
    await db.query('update auth.users set email_confirmed_at = $1 where id = $2', [ACCEPTED, organizer])
    await db.query('update auth.users set invited_at = $1 where id = $2', [INVITED, pending])

    household = await createHousehold(organizer, 'Placeholder Household')
    organizerRowId = (
      await db.query('select organizer_member_id as id from public.households where id = $1', [household])
    ).rows[0].id
    pendingRowId = await addMember(household, 'Placeholder One')
    await provisionMember(db, pendingRowId, pending)
    unclaimedRowId = await addMember(household, 'Placeholder Two')
  })

  it('tells an invited-and-unaccepted member apart from a joined one', async () => {
    const byId = Object.fromEntries((await states(organizer)).map((r) => [r.member_id, r]))
    // The pair the roster could not tell apart: both rows carry claimed_by.
    expect(byId[pendingRowId].invited_at?.toISOString()).toBe('2026-09-16T02:44:12.000Z')
    expect(byId[pendingRowId].confirmed_at).toBeNull()
    expect(byId[organizerRowId].confirmed_at?.toISOString()).toBe('2026-09-16T02:45:12.000Z')
  })

  it('reads the acceptance as soon as the account is confirmed', async () => {
    await db.query('update auth.users set email_confirmed_at = $1 where id = $2', [ACCEPTED, pending])
    const row = (await states(organizer)).find((r) => r.member_id === pendingRowId)
    expect(row.confirmed_at?.toISOString()).toBe('2026-09-16T02:45:12.000Z')
    // The invitation stamp stays: accepted is a second fact, not a replacement.
    expect(row.invited_at?.toISOString()).toBe('2026-09-16T02:44:12.000Z')
  })

  it('has no row for a member with no claim — the client reads that from claimed_by', async () => {
    const ids = (await states(organizer)).map((r) => r.member_id)
    expect(ids).not.toContain(unclaimedRowId)
    expect(ids.sort()).toEqual([organizerRowId, pendingRowId].sort())
  })

  it('answers every member of the household, not only the organizer (owner decision, #458)', async () => {
    const ids = (await states(pending)).map((r) => r.member_id)
    expect(ids.sort()).toEqual([organizerRowId, pendingRowId].sort())
  })

  it('answers nothing about a household the caller is not in', async () => {
    expect(await states(outsider)).toEqual([])
    // And a household of the outsider's own does not open the other one.
    const own = await createHousehold(outsider, 'Placeholder Other Household')
    expect(await states(outsider)).toEqual([])
    // Control: the same caller does get an answer about their own household.
    expect((await states(outsider, own)).length).toBe(1)
  })

  it('answers nothing about a household pending deletion', async () => {
    await asDevice(db, organizer, () =>
      db.query('select * from public.request_household_deletion($1)', [household]),
    )
    expect(await states(organizer)).toEqual([])
  })

  it('answers nothing to a caller with no session', async () => {
    expect(await states(null)).toEqual([])
  })

  it('returns only the two fields, never the address or anything else auth.users holds', async () => {
    const { rows } = await db.query(
      `select pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'member_sign_in_states'`,
    )
    expect(rows).toEqual([
      { result: 'TABLE(member_id uuid, invited_at timestamp with time zone, confirmed_at timestamp with time zone)' },
    ])
  })

  it('is definer, search_path-empty, executable by authenticated, commented, and one signature', async () => {
    const { rows } = await db.query(
      `select pg_get_function_identity_arguments(p.oid) as args,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              p.prosecdef, p.proconfig,
              obj_description(p.oid, 'pg_proc') as comment
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'member_sign_in_states'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      args: 'target_household uuid',
      auth: true,
      anon: false,
      prosecdef: true,
      proconfig: ['search_path=""'],
    })
    expect(rows[0].comment).toMatch(/Story #458/)
    // The anon half is the one this harness cannot really speak to (0034's
    // measured 0 of 1); `probe:live-grants` and the file's spelling own it.
  })

  it('refuses a direct read of auth.users to the client, which is why the function exists', async () => {
    const result = await asDevice(db, organizer, () =>
      attempt(() => db.query('select email_confirmed_at from auth.users')),
    )
    expect(result.ok).toBe(false)
  })

  it('re-applies cleanly and answers the same', async () => {
    const before = await states(organizer)
    await db.exec(migrationSql(FILE))
    expect(await states(organizer)).toEqual(before)
  })
})
