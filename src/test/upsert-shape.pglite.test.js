// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same reason as
// the other pglite files.
//
// WHAT THIS FILE EXISTS FOR, and why the suite next door could not do it.
//
// `announce.pglite.test.js` writes the seen-marker with a helper documented as
// "the client's write, exactly as PostgREST issues an upsert on the PK", and
// that sentence was wrong for the life of the table. Its SET list omits the
// conflict target. PostgREST's does not:
//
//   ON CONFLICT("member_id") DO UPDATE SET "member_id" = EXCLUDED."member_id", ...
//
// So the helper is a hand-written mirror of what its author believed PostgREST
// sends, and a double cannot disagree with its author — every test that used it
// passed while the live app was refused `permission denied` on every open.
//
// Two things follow, and this file is both of them.
//
//   1. The SET list is DERIVED from PostgREST's rule (every payload column,
//      conflict target included) applied to the payload READ OUT OF THE CLIENT
//      SOURCE — not typed here. A new column added to a client upsert is
//      covered the day it lands, with nobody editing this file.
//
//   2. The privileges are asserted in BOTH directions per column, because an
//      upsert needs two: UPDATE because the column is a SET target, and SELECT
//      because `EXCLUDED."col"` reads it. `member_capacity.household_id` had
//      INSERT alone and is invisible to every behavioural check that only reads
//      the columns the client reads back — it is in no read-back list.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". `npm run check:live` and
// `npm run probe:live-grants` remain the authority on the live project.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asDevice, attempt, freshDatabase, newDevice } from './support/pgliteSupabase.js'

vi.setConfig({ testTimeout: 30_000 })

const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib')

/**
 * Every `.upsert()` a client module makes, read out of the source.
 *
 * Derived rather than listed, for the reason in the header. The parser walks
 * from each `.upsert(` to the balanced end of its first object literal and
 * takes the top-level keys — `key: value` and shorthand `key` alike, since the
 * real payloads use both (`snapshot`, `note`, `source` are shorthand). Nested
 * literals are skipped by depth, so an option bag inside a value cannot leak in.
 */
function clientUpsertsIn(file) {
  const source = readFileSync(join(libDir, file), 'utf8')
  const found = []
  for (let at = source.indexOf('.upsert('); at !== -1; at = source.indexOf('.upsert(', at + 1)) {
    const open = source.indexOf('{', at)
    if (open === -1) continue
    let depth = 0
    let close = -1
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close === -1) continue
    const body = source.slice(open + 1, close)

    // Split on TOP-LEVEL commas, not on newlines: `announce.js` writes its whole
    // payload on one line, and a line-oriented scan reads only the first key —
    // which the control below caught, doing exactly the job it is there for.
    const withoutComments = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    const segments = []
    let buffer = ''
    let level = 0
    let quote = null
    for (let i = 0; i < withoutComments.length; i += 1) {
      const ch = withoutComments[i]
      if (quote) {
        if (ch === quote && withoutComments[i - 1] !== '\\') quote = null
      } else if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
      } else if ('{[('.includes(ch)) {
        level += 1
      } else if ('}])'.includes(ch)) {
        level -= 1
      } else if (ch === ',' && level === 0) {
        segments.push(buffer)
        buffer = ''
        continue
      }
      buffer += ch
    }
    segments.push(buffer)

    const columns = segments
      .map((segment) => segment.trim().match(/^([a-z_][a-z0-9_]*)\s*(?::|$)/i)?.[1])
      .filter(Boolean)

    // `{ onConflict: 'a,b' }`. Both of today's call sites spell it out.
    const target = source.slice(close, close + 200).match(/onConflict:\s*'([^']+)'/)
    found.push({
      file,
      table: source.slice(0, at).match(/\.from\('([^']+)'\)[^']*$/)?.[1] ?? null,
      columns,
      conflictTarget: (target?.[1] ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    })
  }
  return found
}

const UPSERTS = [...clientUpsertsIn('announce.js'), ...clientUpsertsIn('capacity.js')]

/** The statement PostgREST compiles an upsert into — measured, not assumed. */
function postgrestUpsert({ table, columns, conflictTarget }) {
  const values = columns.map((_, i) => `$${i + 1}`).join(', ')
  const sets = columns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
  const names = columns.map((c) => `"${c}"`).join(', ')
  const onConflict = conflictTarget.map((c) => `"${c}"`).join(', ')
  return `insert into public.${table} (${names}) values (${values}) on conflict (${onConflict}) do update set ${sets}`
}

describe('what a client upsert actually needs, against a real Postgres', () => {
  let db, person, memberId, householdId

  beforeEach(async () => {
    db = await freshDatabase()
    person = await newDevice(db)
    const household = await asDevice(db, person, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    householdId = household.id
    memberId = household.organizer_member_id
  })

  // -------------------------------------------------------------------------
  // The parser is an instrument, so it gets a control. A regex that matched
  // nothing would make every assertion below vacuous and green.
  // -------------------------------------------------------------------------
  it('the source scan finds both client upserts and their payloads', () => {
    expect(UPSERTS.map((u) => u.table).sort()).toEqual(['member_capacity', 'member_split_seen'])

    const seen = UPSERTS.find((u) => u.table === 'member_split_seen')
    expect([...seen.columns].sort()).toEqual(['member_id', 'seen_rebalance_at', 'snapshot'])
    expect(seen.conflictTarget).toEqual(['member_id'])

    const capacity = UPSERTS.find((u) => u.table === 'member_capacity')
    expect([...capacity.columns].sort()).toEqual([
      'household_id',
      'member_id',
      'minutes',
      'note',
      'period_start',
      'source',
    ])
    expect(capacity.conflictTarget).toEqual(['member_id', 'period_start'])
  })

  // -------------------------------------------------------------------------
  // The catalog claim. Cheap, and it is the one that generalises: a table added
  // tomorrow with a client upsert is covered the day its payload is parsed.
  // -------------------------------------------------------------------------
  it.each(UPSERTS)(
    'every column the $table upsert names carries INSERT, SELECT and UPDATE',
    async ({ table, columns }) => {
      const { rows } = await db.query(
        `select a.attname, coalesce(array_to_string(a.attacl, ','), '') as acl
           from pg_attribute a
          where a.attrelid = ('public.' || $1)::regclass
            and a.attname = any($2::text[])`,
        [table, columns],
      )
      expect(rows).toHaveLength(columns.length)
      for (const { attname, acl } of rows) {
        const granted = acl.match(/authenticated=([a-zA-Z]*)/)?.[1] ?? ''
        // a = INSERT (the row is proposed), r = SELECT (EXCLUDED."col" reads
        // it), w = UPDATE (it is a SET target). All three, or the statement is
        // refused at PLAN time — before any conflict can fire.
        const held = ['a', 'r', 'w'].filter((p) => granted.includes(p)).join('')
        expect(`${table}.${attname} -> ${held || '(none)'}`).toBe(`${table}.${attname} -> arw`)
      }
    },
  )

  // -------------------------------------------------------------------------
  // The behavioural claim, in PostgREST's own shape.
  // -------------------------------------------------------------------------
  it('the seen-marker upsert PostgREST issues is accepted', async () => {
    const shape = UPSERTS.find((u) => u.table === 'member_split_seen')
    const values = {
      member_id: memberId,
      snapshot: JSON.stringify({ members: [] }),
      seen_rebalance_at: null,
    }
    const result = await asDevice(db, person, () =>
      attempt(() => db.query(postgrestUpsert(shape), shape.columns.map((c) => values[c]))),
    )
    expect(result.error).toBeNull()
  })

  it('the capacity upsert PostgREST issues is accepted', async () => {
    const shape = UPSERTS.find((u) => u.table === 'member_capacity')
    const values = {
      household_id: householdId,
      member_id: memberId,
      period_start: '2026-08-24',
      minutes: 200,
      note: null,
      source: 'manual',
    }
    const result = await asDevice(db, person, () =>
      attempt(() => db.query(postgrestUpsert(shape), shape.columns.map((c) => values[c]))),
    )
    expect(result.error).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Why the suite next door stayed green. This is the regression itself, held
  // as a test: with 0022's grant taken away, the shape the old helper issues
  // still passes and the shape PostgREST issues is refused. A guard that cannot
  // tell those two apart is the guard this file replaces.
  // -------------------------------------------------------------------------
  it('without 0022, the old helper shape passes and the PostgREST shape is refused', async () => {
    await db.exec('revoke update (member_id) on public.member_split_seen from authenticated')

    const args = [memberId, JSON.stringify({ members: [] }), null]
    const outcomes = await asDevice(db, person, async () => ({
      oldHelper: await attempt(() =>
        db.query(
          `insert into public.member_split_seen (member_id, snapshot, seen_rebalance_at)
           values ($1, $2::jsonb, $3)
           on conflict (member_id) do update
             set snapshot = excluded.snapshot, seen_rebalance_at = excluded.seen_rebalance_at`,
          args,
        ),
      ),
      postgrest: await attempt(() =>
        db.query(
          `insert into public.member_split_seen (member_id, snapshot, seen_rebalance_at)
           values ($1, $2::jsonb, $3)
           on conflict (member_id) do update
             set member_id = excluded.member_id,
                 snapshot = excluded.snapshot,
                 seen_rebalance_at = excluded.seen_rebalance_at`,
          args,
        ),
      ),
    }))

    expect(outcomes.oldHelper.error).toBeNull()
    expect(outcomes.postgrest.error).toBe('permission denied for table member_split_seen')
  })
})
