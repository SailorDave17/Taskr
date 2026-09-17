// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #474 — a leave or a purge never revokes a Google grant another connection
// still uses, keyed on the GOOGLE ACCOUNT rather than the Taskr sign-in.
//
// Google revokes a whole account's grant when any one of its refresh tokens is
// revoked (0047's header quotes the documentation), so the question each
// function answers is "does anybody else hold a token for THIS Google
// account?". Before 0047 it asked "does this Taskr sign-in hold one elsewhere?",
// which is a different question whenever two sign-ins consented one account.
// The BEFORE block below reads the old answer on a database built through 0046,
// so the defect is on record here rather than only reasoned from a body.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". The Google call itself is
// the Edge Functions' (their handler.test.js files).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  databaseThrough,
  freshDatabase,
  migrationSql,
  newDevice,
} from './support/pgliteSupabase.js'
import { blankSqlComments } from './support/retiredVocabulary.js'

vi.setConfig({ testTimeout: 30_000 })

const FILE = '0047_revoke_keys_on_google_account.sql'
const BEFORE = '0046_suggested_capacity_source.sql'

const ACCOUNT_A = 'google-sub-account-a'
const ACCOUNT_B = 'google-sub-account-b'

/**
 * Two households, each organized by its own Taskr sign-in, plus one extra
 * member row in the first household for the same-household cases. Nobody here
 * is claimed in both households: the sign-ins are DIFFERENT, which is the case
 * the old rule could not see.
 */
async function seed(db) {
  const first = await newDevice(db)
  const second = await newDevice(db)
  const housemate = await newDevice(db)
  const create = (uid, name, organizer) =>
    asDevice(db, uid, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [name, organizer])
      return rows[0]
    })
  const one = await create(first, 'Placeholder Household', 'Placeholder Organizer')
  const two = await create(second, 'Placeholder Other Household', 'Placeholder Other Organizer')
  const { rows } = await db.query(
    `insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
     values ($1, 'Placeholder One', 60, $2) returning id`,
    [one.id, housemate],
  )
  return {
    first,
    second,
    one: one.id,
    two: two.id,
    firstRow: one.organizer_member_id,
    secondRow: two.organizer_member_id,
    housemateRow: rows[0].id,
  }
}

/** A stored token. `sub` undefined writes no column at all, so it runs on a pre-0047 database too. */
function connect(db, householdId, memberId, token, sub) {
  if (sub === undefined) {
    return db.query(
      `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope)
       values ($1, $2, $3, 'https://www.googleapis.com/auth/calendar.freebusy')`,
      [householdId, memberId, token],
    )
  }
  return db.query(
    `insert into public.calendar_tokens (household_id, member_id, refresh_token, scope, google_sub)
     values ($1, $2, $3, 'https://www.googleapis.com/auth/calendar.freebusy', $4)`,
    [householdId, memberId, token, sub],
  )
}

async function asService(db, fn) {
  await db.exec('set role service_role')
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

const offeredForMember = async (db, memberId) =>
  (
    await asService(db, async () =>
      (await db.query('select refresh_token from public.member_tokens_to_revoke($1)', [memberId])).rows,
    )
  )
    .map((row) => row.refresh_token)
    .sort()

const offeredForHousehold = async (db, householdId) =>
  (
    await asService(db, async () =>
      (await db.query('select refresh_token from public.household_tokens_to_revoke($1)', [householdId])).rows,
    )
  )
    .map((row) => row.refresh_token)
    .sort()

describe('BEFORE 0047 — the sign-in rule revokes a grant another sign-in shares', () => {
  let db
  afterEach(async () => db?.close())

  it('offers the leaver\'s token although a different sign-in in another household holds the same Google account', async () => {
    // Nothing in a pre-0047 database records the account, so "same account" is
    // the fixture's fact and not the table's: two sign-ins, two households,
    // and the old body answers as if they were unrelated. This is the reading
    // #474 reasoned from 0043's body, measured.
    db = await databaseThrough(BEFORE)
    const s = await seed(db)
    await connect(db, s.one, s.firstRow, 'token-first')
    await connect(db, s.two, s.secondRow, 'token-second')
    expect(await offeredForMember(db, s.firstRow)).toEqual(['token-first'])
    expect(await offeredForHousehold(db, s.one)).toEqual(['token-first'])
  })
})

describe('after 0047 — a grant is kept while another connection uses the same Google account (#474)', () => {
  let db, s
  beforeEach(async () => {
    db = await freshDatabase()
    s = await seed(db)
  })
  afterEach(async () => db?.close())

  describe('AC 1 — a leave', () => {
    it('does not offer a token whose Google account a DIFFERENT sign-in uses in another household', async () => {
      await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
      await connect(db, s.two, s.secondRow, 'token-second', ACCOUNT_A)
      expect(await offeredForMember(db, s.firstRow)).toEqual([])
      // POSITIVE CONTROL: the other connection is a different account, and the
      // same leave is offered its token — and only its token.
      await db.query('update public.calendar_tokens set google_sub = $1 where member_id = $2', [
        ACCOUNT_B,
        s.secondRow,
      ])
      expect(await offeredForMember(db, s.firstRow)).toEqual(['token-first'])
    })

    it('does not offer a token whose account another member of the SAME household uses', async () => {
      await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
      await connect(db, s.one, s.housemateRow, 'token-housemate', ACCOUNT_A)
      expect(await offeredForMember(db, s.firstRow)).toEqual([])
      await db.query('delete from public.calendar_tokens where member_id = $1', [s.housemateRow])
      expect(await offeredForMember(db, s.firstRow)).toEqual(['token-first'])
    })

    it('never offers a token whose account is unknown, even with no other connection anywhere', async () => {
      await connect(db, s.one, s.firstRow, 'token-first')
      expect(await offeredForMember(db, s.firstRow)).toEqual([])
      // POSITIVE CONTROL: the same row with its account recorded is offered.
      await db.query('update public.calendar_tokens set google_sub = $1 where member_id = $2', [
        ACCOUNT_A,
        s.firstRow,
      ])
      expect(await offeredForMember(db, s.firstRow)).toEqual(['token-first'])
    })

    it('keeps the old sign-in rule against another row whose account is unknown', async () => {
      // The other row predates 0047. Same sign-in: kept, as before 0047.
      // Different sign-in: offered — the residual 0047's header names.
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes, claimed_by)
         values ($1, 'Placeholder One', 60, $2) returning id`,
        [s.two, s.first],
      )
      await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
      await connect(db, s.two, rows[0].id, 'token-first-elsewhere')
      await connect(db, s.two, s.secondRow, 'token-second')
      expect(await offeredForMember(db, s.firstRow)).toEqual([])
      await db.query('delete from public.calendar_tokens where member_id = $1', [rows[0].id])
      expect(await offeredForMember(db, s.firstRow)).toEqual(['token-first'])
    })

    it('offers only the leaver\'s token, whoever else holds one', async () => {
      await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
      await connect(db, s.one, s.housemateRow, 'token-housemate', ACCOUNT_B)
      await connect(db, s.two, s.secondRow, 'token-second', 'google-sub-account-c')
      expect(await offeredForMember(db, s.firstRow)).toEqual(['token-first'])
      expect(await offeredForMember(db, s.housemateRow)).toEqual(['token-housemate'])
    })
  })

  describe('AC 2 — a household purge', () => {
    it('does not offer a token whose Google account another household uses, under a different sign-in', async () => {
      await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
      await connect(db, s.one, s.housemateRow, 'token-housemate', ACCOUNT_B)
      await connect(db, s.two, s.secondRow, 'token-second', ACCOUNT_A)
      expect(await offeredForHousehold(db, s.one)).toEqual(['token-housemate'])
      await db.query('delete from public.calendar_tokens where household_id = $1', [s.two])
      expect(await offeredForHousehold(db, s.one)).toEqual(['token-first', 'token-housemate'])
    })

    it('offers both tokens when two members of the purged household share one account', async () => {
      // The whole household goes, so nothing left behind uses the grant.
      await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
      await connect(db, s.one, s.housemateRow, 'token-housemate', ACCOUNT_A)
      expect(await offeredForHousehold(db, s.one)).toEqual(['token-first', 'token-housemate'])
    })

    it('never offers a token whose account is unknown', async () => {
      await connect(db, s.one, s.firstRow, 'token-first')
      await connect(db, s.one, s.housemateRow, 'token-housemate', ACCOUNT_B)
      expect(await offeredForHousehold(db, s.one)).toEqual(['token-housemate'])
    })
  })

  it('adds the account column to the token table only, where no client can read it', async () => {
    const { rows } = await db.query(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'google_sub'`,
    )
    expect(rows.map((r) => r.table_name)).toEqual(['calendar_tokens'])
    const { rows: acl } = await db.query(
      `select has_column_privilege('authenticated', 'public.calendar_tokens', 'google_sub', 'select') as authenticated,
              has_column_privilege('service_role', 'public.calendar_tokens', 'google_sub', 'select') as service`,
    )
    expect(acl[0]).toEqual({ authenticated: false, service: true })
  })

  it('leaves both functions executable by service_role only, and revokes them from every client role by name', async () => {
    for (const fn of ['member_tokens_to_revoke(uuid)', 'household_tokens_to_revoke(uuid)']) {
      const { rows } = await db.query(
        `select has_function_privilege('service_role', 'public.${fn}', 'execute') as service,
                has_function_privilege('authenticated', 'public.${fn}', 'execute') as authenticated,
                has_function_privilege('anon', 'public.${fn}', 'execute') as anon`,
      )
      expect(rows[0], fn).toEqual({ service: true, authenticated: false, anon: false })
    }
    // The hosted project grants EXECUTE by name and this harness cannot see it
    // (0042's reason), so the source is read as well.
    const sql = blankSqlComments(migrationSql(FILE))
    expect(sql).toMatch(/^revoke all on function public\.household_tokens_to_revoke\(uuid\) from public, anon, authenticated;/m)
    expect(sql).toMatch(/^revoke all on function public\.member_tokens_to_revoke\(uuid\) from public, anon, authenticated;/m)
  })

  it('re-applying the file changes nothing', async () => {
    await connect(db, s.one, s.firstRow, 'token-first', ACCOUNT_A)
    await connect(db, s.two, s.secondRow, 'token-second', ACCOUNT_A)
    await db.exec(migrationSql(FILE))
    expect(await offeredForMember(db, s.firstRow)).toEqual([])
    const { rows } = await db.query('select google_sub from public.calendar_tokens order by refresh_token')
    expect(rows.map((r) => r.google_sub)).toEqual([ACCOUNT_A, ACCOUNT_A])
  })
})
