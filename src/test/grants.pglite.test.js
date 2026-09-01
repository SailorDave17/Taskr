// @vitest-environment node
//
// Node, not the repo-wide jsdom, for the reason chores.pglite.test.js records:
// PGlite loads its WASM and pgcrypto bundle through fetch/Response, and jsdom's
// Response has no arrayBuffer() here. Without this line the whole suite dies in
// beforeAll — which vitest reports as 22 tests SKIPPED and zero failed, so the
// run looks empty rather than broken.
//
// #91 — every privilege the client needs is GRANTED by a migration, not inherited.
//
// This file exists because 886 green tests, a mutation pass and a careful read of
// every migration all went over three missing grants. None of those instruments
// could have seen them, for one reason: `pgliteSupabase.js` used to open with
//
//     alter default privileges in schema public grant all on tables to ...
//
// so the harness handed every table exactly the privilege the migration had
// forgotten to grant. #91 narrowed that line to the platform's real default, and
// this file is what now stands in the gap.
//
// THE DIRECTION OF THE DISAGREEMENT IS THE WHOLE POINT, because it decides which
// assertions here are worth anything:
//
//   - A stub MORE permissive than production makes a NEGATIVE assertion strong
//     ("holds nothing" can only pass if a revoke really is there) and a POSITIVE
//     one vacuous ("may read this" passes whether or not anything granted it).
//   - A stub matching production makes both real.
//
// Every operation assertion below is positive — "this is permitted" — which is
// exactly the class that was vacuous before. That makes the first test in this
// file load-bearing rather than ceremonial: if anyone widens the default back,
// all seventeen of them silently stop meaning anything.
//
// MEASURED, because the first draft of this paragraph said "and only that one
// notices" and the mutation pass falsified it: restoring `grant all` reddened
// THREE tests here, not one — the positive control, plus both "nothing was
// widened" assertions, because a widened default hands DML to `anon` and
// `service_role` as well. Three independent tests noticed, which was better than
// the design claimed and was recorded here rather than left as a nicer surprise
// for the next reader.
//
// **That count is TWO since `0017` (#186), and the drop is a strengthening
// rather than a regression.** *Re-measured 2026-08-27*: restoring `grant all`
// reddens the positive control and the `service_role` assertion, and NOT the
// `anon` one. `0005`, `0010` and `0011` all revoke wholesale from `anon`, and
// `0003` does too; `households` and `members` were the only two tables left
// where a widened default could reach that role, and `0017` revokes both. So a
// widened default can no longer hand `anon` anything anywhere in `public`, and
// the assertion below has stopped being a control on the harness default and
// become a claim about the migrations — which is what it says it is. It is
// still load-bearing: deleting either `0017` revoke reddens it, measured 1 and 1.
//
// The sentence above is left standing rather than rewritten, because it records
// a measurement that was true of the code it was taken against. Nothing executes
// a comment, so a count corrected silently reads as one nobody ever got wrong.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { vi } from 'vitest'

import { asDevice, attempt, freshDatabase } from './support/pgliteSupabase.js'
import { LIVE_SCHEMA } from '../lib/liveSchema.js'

// The convention every other pglite suite here follows, and gate.test.js
// enforces: vitest's 5000ms default is a number nobody chose for this file.
// 30s matches the eight siblings rather than being derived separately — this
// suite builds ONE database in beforeAll and its whole run is under 3s locally,
// so it is nowhere near the limit and the value is about CI's variance, not
// about this file's work. hookTimeout is not set here either: it comes from
// src/test/support/pgliteSupabase.js, which this file imports, and #145's
// measurement is in that file's comment.
vi.setConfig({ testTimeout: 30_000 })

// Exactly what `src/lib/*.js` issues, one row per call site, as SQL.
//
// Every statement is written to match NO ROWS — `where false`, or an
// `insert ... select ... where false`. That is deliberate and it is what makes
// this a test of GRANTS alone: a statement that touches no row never reaches a
// row-level policy, so a refusal here can only be a privilege refusal. The
// policies have their own files, and conflating the two is how a grant gap hides
// behind a policy that would have refused anyway.
const CLIENT_OPERATIONS = [
  {
    table: 'households',
    op: 'select *',
    site: 'household.js:197 currentHousehold()',
    sql: 'select * from public.households limit 1',
  },
  {
    table: 'members',
    op: 'select',
    site: 'household.js:285 listMembers()',
    sql: 'select id, display_name, weekly_minutes, claimed_by, email, created_at from public.members limit 0',
  },
  {
    table: 'members',
    op: 'insert',
    site: 'household.js:307 addMember()',
    sql: "insert into public.members (household_id, display_name, weekly_minutes) select gen_random_uuid(), 'Placeholder', 0 where false",
  },
  {
    table: 'members',
    op: 'update',
    site: 'household.js:330 updateMember()',
    sql: "update public.members set display_name = 'Placeholder' where false",
  },
  {
    table: 'members',
    op: 'select',
    site: 'household.js removeMember() pre-delete read — #247',
    sql: 'select id, display_name, claimed_by from public.members limit 0',
  },
  {
    table: 'members',
    op: 'delete',
    site: 'household.js removeMember()',
    sql: 'delete from public.members where false',
  },
  {
    table: 'chores',
    op: 'select',
    site: 'chores.js:184 listChores()',
    sql: 'select id, title, expected_minutes, due_on, created_at, completed_at, completed_by_member_id, assigned_member_id, repeat_kind, repeat_weekdays, generated_from from public.chores limit 0',
  },
  {
    table: 'chores',
    op: 'insert',
    site: 'chores.js:214 addChore()',
    sql: "insert into public.chores (household_id, title, expected_minutes, due_on) select gen_random_uuid(), 'Placeholder', 1, current_date where false",
  },
  {
    table: 'chores',
    op: 'update',
    site: 'chores.js:242 editChore()',
    sql: "update public.chores set title = 'Placeholder' where false",
  },
  {
    table: 'chores',
    op: 'delete',
    site: 'chores.js:440 removeChore()',
    sql: 'delete from public.chores where false',
  },
  {
    table: 'member_capacity',
    op: 'select',
    site: 'capacity.js:169 listCapacity()',
    sql: 'select id, member_id, period_start, minutes, note, source, created_at from public.member_capacity limit 0',
  },
  {
    table: 'member_capacity',
    op: 'insert',
    site: 'capacity.js:192 setCapacity() upsert',
    sql: "insert into public.member_capacity (household_id, member_id, period_start, minutes, note, source) select gen_random_uuid(), gen_random_uuid(), current_date, 0, null, 'manual' where false",
  },
  {
    table: 'member_capacity',
    op: 'update',
    site: 'capacity.js:192 setCapacity() upsert',
    sql: 'update public.member_capacity set minutes = 0 where false',
  },
  {
    table: 'member_capacity',
    op: 'delete',
    site: 'capacity.js:214 clearCapacity()',
    sql: 'delete from public.member_capacity where false',
  },
  {
    table: 'chore_exclusions',
    op: 'select',
    site: 'exclusions.js:74 listExclusions()',
    sql: 'select id, chore_id, member_id, created_at from public.chore_exclusions limit 0',
  },
  {
    table: 'chore_exclusions',
    op: 'insert',
    site: 'exclusions.js:104 addExclusion()',
    sql: 'insert into public.chore_exclusions (household_id, chore_id, member_id) select gen_random_uuid(), gen_random_uuid(), gen_random_uuid() where false',
  },
  {
    table: 'chore_exclusions',
    op: 'delete',
    site: 'exclusions.js:123 removeExclusion()',
    sql: 'delete from public.chore_exclusions where false',
  },
  {
    table: 'calendar_connections',
    op: 'select',
    site: 'calendar.js:233 listCalendarConnections()',
    sql: 'select id, member_id, scope, connected_at from public.calendar_connections limit 0',
  },
  {
    table: 'member_split_seen',
    op: 'select',
    site: 'announce.js readSplitSeen()',
    sql: 'select member_id, snapshot, seen_rebalance_at, fairness_note_dismissed from public.member_split_seen limit 0',
  },
  {
    table: 'member_split_seen',
    op: 'insert',
    site: 'announce.js writeSplitSeen() upsert',
    sql: `insert into public.member_split_seen (member_id, snapshot, seen_rebalance_at) select gen_random_uuid(), '{}'::jsonb, null where false`,
  },
  {
    table: 'member_split_seen',
    op: 'update',
    site: 'announce.js writeSplitSeen() upsert',
    sql: `update public.member_split_seen set snapshot = '{}'::jsonb, seen_rebalance_at = null where false`,
  },
  // #59 — the dismissal write touches ONE column the upsert above never
  // carries, granted by 0021 rather than 0020, so it is a separate operation
  // rather than a wider spelling of the one above.
  {
    table: 'member_split_seen',
    op: 'update',
    site: 'announce.js dismissFairnessNote()',
    sql: 'update public.member_split_seen set fairness_note_dismissed = true where false',
  },
  // #105 — the ONLY client operation on the exception table is the read. The
  // writes go through `skip_repeat_occurrence` (definer, granted to
  // `authenticated`), so there is deliberately no insert/update/delete row
  // here; repeats.pglite.test.js asserts all three are REFUSED for the client
  // role, which is this list's mirror image for a single-writer table.
  {
    table: 'chore_repeat_exceptions',
    op: 'select',
    site: 'chores.js listRepeatExceptions()',
    sql: 'select id, chore_id, excluded_on, created_at from public.chore_repeat_exceptions limit 0',
  },
]

describe('#91 — the client privileges come from a migration, not from a default', () => {
  let db

  beforeAll(async () => {
    db = await freshDatabase()
  })

  afterAll(async () => {
    await db?.close()
  })

  // ---------------------------------------------------------------------------
  // The control that keeps the rest of this file honest
  // ---------------------------------------------------------------------------

  it('POSITIVE CONTROL: the harness default grants no DML, so every assertion below is about a migration', async () => {
    // A table created here, after every migration, receives whatever the
    // harness's `alter default privileges` hands out and nothing else. If that
    // line is ever widened back to `grant all`, this fails FIRST and says why —
    // before seventeen green assertions quietly stop proving anything.
    //
    // MEASURED against `supabase start` (CLI 2.114.0) and PGlite 0.5 (PG 18):
    // the platform default is `Dxtm` — truncate, references, trigger, maintain.
    await db.exec('create table public.grant_control_probe (id int)')
    try {
      const { rows } = await db.query(
        `select privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'grant_control_probe'
            and grantee = 'authenticated'
          order by privilege_type`,
      )
      const held = rows.map((r) => r.privilege_type)

      expect(
        held,
        'the harness default has been widened — every assertion in this file is now vacuous',
      ).not.toContain('SELECT')
      expect(held).not.toContain('INSERT')
      expect(held).not.toContain('UPDATE')
      expect(held).not.toContain('DELETE')

      // Not merely "nothing". The platform grants four privileges, and stubbing
      // NONE would be a different error — in the safe direction, but still a
      // model that does not match. Asserting the exact set is what makes this a
      // model of the platform rather than an absence of one.
      //
      // MAINTAIN is absent from this list on purpose: `information_schema` is
      // the SQL standard's catalog and has no row for a privilege the standard
      // does not define, even though Postgres 17+ grants it. The default
      // privileges line in the harness does grant it.
      expect(held).toEqual(['REFERENCES', 'TRIGGER', 'TRUNCATE'])
    } finally {
      await db.exec('drop table public.grant_control_probe')
    }
  })

  // ---------------------------------------------------------------------------
  // AC 1 and AC 3 — drive every operation the client actually issues
  // ---------------------------------------------------------------------------

  it('finds operations to check, so an empty pass is impossible', () => {
    expect(CLIENT_OPERATIONS.length).toBeGreaterThan(10)

    // Every table `check:live` says the app reads is exercised here. Tying to
    // LIVE_SCHEMA rather than restating the table list inherits the enforcement
    // `liveSchema.test.js` already applies to it in both directions, instead of
    // starting a third hand-maintained list that can fall behind on its own.
    const exercised = new Set(CLIENT_OPERATIONS.map((o) => o.table))
    const expected = LIVE_SCHEMA.map((entry) => entry.table)
    expect([...exercised].sort()).toEqual([...expected].sort())
  })

  it.each(CLIENT_OPERATIONS)('permits $table $op — $site', async ({ sql }) => {
    const person = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const result = await attempt(() => asDevice(db, person, () => db.query(sql)))

    // The message matters as much as the assertion. A bare "expected null" here
    // sends the next reader to the policy files, which is the wrong place: this
    // statement matches no rows, so no policy was ever consulted.
    expect(
      result.error,
      'refused by a GRANT, not a policy — this statement matches no rows',
    ).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // AC 2 — the households grant covers every column, because the client reads *
  // ---------------------------------------------------------------------------

  it('grants select on EVERY column of households, because currentHousehold reads select(*)', async () => {
    // 0013 grants `households` by column list rather than at table level, so
    // that adding a column is a decision rather than an automatic exposure. The
    // cost of that choice is a way to forget, and this is the guard for it: a
    // column added and not granted breaks `select('*')` OUTRIGHT — the whole
    // read is refused rather than returning a narrower row — so it would take
    // the app's first screen down on a rebuilt project, and nothing else in this
    // suite would notice.
    const { rows: columns } = await db.query(
      `select attname from pg_attribute
        where attrelid = 'public.households'::regclass and attnum > 0 and not attisdropped
        order by attnum`,
    )
    const { rows: granted } = await db.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'households'
          and grantee = 'authenticated' and privilege_type = 'SELECT'`,
    )

    expect(columns.length, 'no columns found — the query is wrong, not the grant').toBeGreaterThan(0)
    expect(new Set(granted.map((r) => r.column_name))).toEqual(new Set(columns.map((r) => r.attname)))
  })

  // ---------------------------------------------------------------------------
  // AC 3 — and nothing was widened on the way past
  // ---------------------------------------------------------------------------

  it('leaves anon holding NOTHING in public, at table level or column level', async () => {
    // #186 changed what this can assert, and the change is the point.
    //
    // It used to read `privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`
    // and carried a measurement explaining the exclusion: anon retained the
    // platform default's REFERENCES on `households` and `members`, because the
    // revokes touching those two are NARROW — 0002 revokes `select, insert,
    // update` and 0005 revokes `update`, neither of which strips it. That was
    // accurate, and its conclusion — "asserting it away would be tidying a
    // privilege that cannot be exercised" — was reasoning about the wrong
    // project. The same narrow revokes left `anon` holding INSERT, SELECT and
    // DELETE on the LIVE `households`, which this harness cannot show because
    // its default privileges are the modern tight ones.
    //
    // 0017 revokes ALL from anon on both tables, so the filter comes off and the
    // claim becomes the one worth making: anon reaches nothing in `public` by
    // any route. That is a NEGATIVE assertion against a stub that is no more
    // permissive than production on this axis, which is the class this file's
    // header calls load-bearing.
    const { rows: tableLevel } = await db.query(
      `select table_name, privilege_type from information_schema.table_privileges
        where table_schema = 'public' and grantee = 'anon'
        order by table_name, privilege_type`,
    )
    const { rows: columnLevel } = await db.query(
      `select table_name, privilege_type from information_schema.column_privileges
        where table_schema = 'public' and grantee = 'anon'
        order by table_name, privilege_type`,
    )
    expect(tableLevel).toEqual([])
    expect(columnLevel).toEqual([])
  })

  it('POSITIVE CONTROL: the query above can find a privilege when there is one', async () => {
    // Without this, a typo'd schema name, a renamed catalog view or a grantee
    // spelled `"anon"` would make the assertion above pass by returning nothing
    // — and it asserts an empty result, so an empty result is what success
    // looks like. `authenticated` is asked the identical question through the
    // identical views and must come back with rows.
    const { rows } = await db.query(
      `select count(*)::int as n from information_schema.table_privileges
        where table_schema = 'public' and grantee = 'authenticated'`,
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('and anon may EXECUTE nothing in public either — 0017 section 4', async () => {
    // The catalog `check:live` cannot reach and RLS does not cover. A
    // `security definer` function runs as its owner, so a policy has no say in
    // it; `complete_chore` and `uncomplete_chore` were executable by PUBLIC and
    // by `anon` on the live project because 0004 revoked from `public, anon`
    // for `acting_member` and not for the two lines below it.
    //
    // `has_function_privilege` is used rather than `routine_privileges` because
    // it resolves PUBLIC as well as a by-name grant. Those are separate entries
    // in `proacl`, and revoking only one of them leaves the privilege in place
    // while the catalog looks tidier — the half-fix 0017's section 4 argues
    // against at length.
    const { rows } = await db.query(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by fn`,
    )
    expect(rows).toEqual([])
  })

  it('POSITIVE CONTROL: authenticated may execute the two functions 0017 revokes', async () => {
    // The revoke names one role and `authenticated` is one word away in the same
    // statement. Without this, deleting `to authenticated` from 0004's grants —
    // or widening 0017's revoke to hit both — leaves the assertion above green
    // while the app cannot mark a chore done.
    const { rows } = await db.query(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as may
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('complete_chore', 'uncomplete_chore')
        order by p.proname`,
    )
    expect(rows).toEqual([
      { proname: 'complete_chore', may: true },
      { proname: 'uncomplete_chore', may: true },
    ])
  })

  it('and service_role reaches only what the Edge Functions need', async () => {
    // Not an audit of every role, which would be a list nobody maintains. This
    // is the one role that bypasses row-level security, so a privilege it holds
    // is a privilege with nothing else behind it. 0008 and 0011 are the only
    // files that grant it anything; this asserts they still are.
    const { rows } = await db.query(
      `select table_name, string_agg(distinct privilege_type, ',' order by privilege_type) as privs
        from information_schema.table_privileges
        where table_schema = 'public' and grantee = 'service_role'
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        group by table_name order by table_name`,
    )
    expect(rows).toEqual([
      { table_name: 'calendar_connections', privs: 'DELETE,INSERT,SELECT,UPDATE' },
      { table_name: 'calendar_tokens', privs: 'DELETE,INSERT,SELECT,UPDATE' },
    ])

    const { rows: memberColumns } = await db.query(
      `select privilege_type, string_agg(column_name, ',' order by column_name) as cols
        from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'members' and grantee = 'service_role'
          and privilege_type in ('SELECT', 'UPDATE')
        group by privilege_type order by privilege_type`,
    )
    expect(memberColumns).toEqual([
      { privilege_type: 'SELECT', cols: 'claimed_by,display_name,email,household_id,id' },
      { privilege_type: 'UPDATE', cols: 'claimed_by' },
    ])
  })

  // ---------------------------------------------------------------------------
  // #227 — and `authenticated` holds only what a migration granted it
  // ---------------------------------------------------------------------------
  //
  // These read `pg_class.relacl` rather than `information_schema`, and the
  // reason is the one this file's line 233 already records from the other side:
  // MAINTAIN is a Postgres 17+ privilege the SQL standard does not define, so
  // the standard catalog has no row for it. Four of the letters 0019 revokes
  // are exactly the ones a standard view under-reports, so asserting through
  // `information_schema` would let `m` survive silently. `relacl` is also the
  // instrument `npm run probe:live-grants` uses against the live project, so
  // this asserts the same string the production check does.

  const authenticatedOn = async (db, table) => {
    const { rows } = await db.query(
      `select coalesce(relacl::text, '') as acl from pg_class
        where relnamespace = 'public'::regnamespace and relname = $1`,
      [table],
    )
    expect(rows.length, `no such relation: ${table}`).toBe(1)
    const match = rows[0].acl.match(/(?:^|[{,])authenticated=([a-zA-Z*]*)\//)
    return match ? match[1] : null
  }

  it('leaves authenticated NO table-level privilege on households — 0019 section 1', async () => {
    // The consequential one. A table-level SELECT subsumes every column-level
    // grant, so while it stood, 0013's and 0018's column lists were decoration
    // on the live project: a column added and deliberately not granted would
    // have been readable anyway. The live project had `ardDxtm` here; this
    // harness never had `a`, `r` or `d` to lose, so what this proves is the END
    // STATE both converge on, not the removal.
    expect(await authenticatedOn(db, 'households')).toBeNull()
  })

  it('leaves members and chores holding exactly the DELETE 0013 granted', async () => {
    // Here the harness and the live project agree exactly — both read `dDxtm`
    // before 0019, because 0013 grants the `d` explicitly and the other four
    // ride through 0002/0003/0007's narrow revokes. So this pair is a real
    // before-and-after, not a convergence.
    expect(await authenticatedOn(db, 'members')).toBe('d')
    expect(await authenticatedOn(db, 'chores')).toBe('d')
  })

  it('POSITIVE CONTROL: the reading can report a privilege that is still there', async () => {
    // Three of the four assertions above expect an absence, and two expect a
    // one-letter string — both are what a broken parse returns. `member_capacity`
    // and `chore_exclusions` are untouched by 0019 and must still read `d`,
    // through the identical helper, or the helper is the thing being tested.
    expect(await authenticatedOn(db, 'member_capacity')).toBe('d')
    expect(await authenticatedOn(db, 'chore_exclusions')).toBe('d')

    // And the parse must be able to return more than one letter, or `d` above
    // proves nothing about the letters 0019 removed. service_role is untouched
    // by every migration here after 0011 and carries the full set.
    const { rows } = await db.query(
      `select coalesce(relacl::text, '') as acl from pg_class
        where relnamespace = 'public'::regnamespace and relname = 'households'`,
    )
    expect(rows[0].acl).toMatch(/service_role=[a-zA-Z]{4,}\//)
  })

  it('keeps the column UPDATE 0005 granted, because 0019 does not name update', async () => {
    // The ordering claim in 0019's header, asserted rather than argued. Its
    // households revoke names seven privileges and NOT `update`, which is what
    // leaves `update (name, timezone)` standing with no re-grant. Name `update`
    // there and this goes red while every other assertion in this block stays
    // green — the whole cost of that mistake lands here.
    const { rows } = await db.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'households'
          and grantee = 'authenticated' and privilege_type = 'UPDATE'
        order by column_name`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(['name', 'timezone'])
  })
})
