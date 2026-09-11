// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #342 — the Realtime publication `0037` fills, checked against the list the
// CLIENT derives. The migration is a hand-written array of table names and
// `src/lib/realtime.js` derives its list from `LIVE_SCHEMA`; nothing else
// compares the two, and a table watched on one side and unpublished on the
// other would be a channel join the live project refuses for every phone.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js" — never "the live project
// is healthy". `0037` is RED in `npm run check:live` by design until it is
// applied, one row per watched table, and that check is the authority on live
// state. pglite has no `supabase_realtime` publication of its own, so `0037`
// creates it here and only here; the live project already has one.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { freshDatabase, migrationSql } from './support/pgliteSupabase.js'
import { LIVE_TABLES } from '../lib/liveSchema.js'
import {
  REALTIME_PUBLICATION,
  UNWATCHED_TABLES,
  WATCHED_TABLE_NAMES,
} from '../lib/realtime.js'

// Same value and same reasoning as the other pglite suites (#145). hookTimeout
// is set once in support/pgliteSupabase.js.
vi.setConfig({ testTimeout: 30_000 })

const MIGRATION = '0037_realtime_publication.sql'

async function publishedTables(db) {
  const { rows } = await db.query(
    `select tablename from pg_publication_tables
     where pubname = $1 and schemaname = 'public'
     order by tablename`,
    [REALTIME_PUBLICATION],
  )
  return rows.map((r) => r.tablename)
}

describe('#342 — the publication 0037 fills, against a real Postgres', () => {
  // One database for the whole file: every test below only READS the catalog,
  // and a pglite boot is the dominant cost of a suite (#145's measurement).
  let db
  beforeAll(async () => {
    db = await freshDatabase()
  })

  it('carries exactly the tables the client watches — no more, no fewer', async () => {
    const published = await publishedTables(db)
    const watched = [...WATCHED_TABLE_NAMES].sort()
    // Both directions, stated separately so a failure says which way it drifted.
    const unpublished = watched.filter((t) => !published.includes(t))
    const unwatched = published.filter((t) => !watched.includes(t))
    expect(
      unpublished,
      `watched by the client and NOT in ${REALTIME_PUBLICATION}: ${unpublished.join(', ')}`,
    ).toEqual([])
    expect(
      unwatched,
      `in ${REALTIME_PUBLICATION} and watched by nobody: ${unwatched.join(', ')}`,
    ).toEqual([])
    expect(published).toEqual(watched)
  })

  it('POSITIVE CONTROL: there are tables to compare, so an empty pass is impossible', async () => {
    // Eleven at #342: every `LIVE_SCHEMA` table but one. The number is a floor
    // against a vacuous pass, not a target — it moves when the client's read
    // set moves, and either edit should be visible in review.
    expect(WATCHED_TABLE_NAMES.length).toBeGreaterThanOrEqual(11)
    expect(await publishedTables(db)).toContain('chores')
  })

  it('leaves the self-scoped table out, on purpose and by name', async () => {
    // `member_split_seen` was the one table the client read and did not watch
    // until #172 excused `invitations` too; both are asserted below.
    // Asserted rather than left as an omission, because an absent entry and a
    // forgotten one look identical — and the reason is in UNWATCHED_TABLES.
    // #172 added `invitations` as the second, and it is asserted the same way:
    // read by the client, excused by name, and absent from the publication.
    expect(Object.keys(UNWATCHED_TABLES)).toEqual(['member_split_seen', 'invitations'])
    expect(LIVE_TABLES).toContain('member_split_seen')
    expect(await publishedTables(db)).not.toContain('member_split_seen')
    expect(LIVE_TABLES).toContain('invitations')
    expect(await publishedTables(db)).not.toContain('invitations')
  })

  it('publishes inserts, updates AND deletes — the unfiltered DELETE binding rests on the last', async () => {
    const { rows } = await db.query(
      `select puballtables, pubinsert, pubupdate, pubdelete from pg_publication where pubname = $1`,
      [REALTIME_PUBLICATION],
    )
    expect(rows).toHaveLength(1)
    // Not `for all tables`: the list is the eleven above and nothing a later
    // migration creates joins it by accident.
    expect(rows[0].puballtables).toBe(false)
    expect(rows[0].pubinsert).toBe(true)
    expect(rows[0].pubupdate).toBe(true)
    expect(rows[0].pubdelete).toBe(true)
  })

  it('every published table has a primary key, which UPDATE and DELETE need to be published', async () => {
    const { rows } = await db.query(
      `select p.tablename
       from pg_publication_tables p
       where p.pubname = $1 and p.schemaname = 'public'
         and not exists (
           select 1 from pg_index i
           join pg_class c on c.oid = i.indrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = p.schemaname and c.relname = p.tablename and i.indisprimary
         )`,
      [REALTIME_PUBLICATION],
    )
    expect(rows.map((r) => r.tablename), 'published without a primary key').toEqual([])
  })

  it('can be re-run, and the second run adds nothing and raises nothing', async () => {
    const before = await publishedTables(db)
    // The re-paste `0001`'s header calls the normal path. A bare
    // `alter publication ... add table` refuses a table already present
    // (42710); the loop in `0037` is what makes this a no-op.
    await db.exec(migrationSql(MIGRATION))
    expect(await publishedTables(db)).toEqual(before)
  })

  it('does not set replica identity full on any watched table', async () => {
    // The access decision in `0037`'s header: a delete broadcasts an id and
    // nothing else. `replica identity full` would send the whole deleted row
    // with no policy applied, so its absence is asserted rather than assumed.
    const { rows } = await db.query(
      `select c.relname, c.relreplident
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[]) and c.relreplident <> 'd'`,
      [[...WATCHED_TABLE_NAMES]],
    )
    expect(rows, 'a watched table with a non-default replica identity').toEqual([])
  })
})
