// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #352 — the shopping schema, its stamped RPCs and its grants, against a real
// Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies, so a green run says
// nothing about the hosted project. `0032` is unapplied there until somebody
// runs `npm run migrate:live`, and `npm run check:live` is the authority on
// that; the three `shopping_*` entries in `LIVE_SCHEMA` and the four RPC entries
// in `LIVE_RPCS` are red on purpose until then.
//
// WHAT THIS FILE CAN AND CANNOT SAY. RLS and column grants are really enforced
// here (`set role authenticated`), so every refusal below is honest. It is NOT
// PostgREST: `.eq()`, `.in()` and `.is()` are PostgREST features and a SQL
// shim cannot represent them, so this file asserts the SQL those calls compile
// to. The client-call half — that `readShopping` issues those filters and
// never an embed filter — is `src/lib/shopping.io.test.js`, and neither half
// is sufficient alone (the 0014/#159 division, restated).
//
// THE FIXTURE IS #159's: ONE auth user holding a claimed member row in TWO
// households, with a list in each. A single-household fixture cannot tell "the
// policy scopes to my households" from "the filter scopes to THIS household",
// because in it the two sets are equal — which is the exact shape that let
// every list read lean on RLS until #159.
//
// Names are synthetic — see #19.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'
import {
  SHOPPING_ITEM_COLUMNS,
  SHOPPING_LIST_COLUMNS,
  SHOPPING_RUN_COLUMNS,
} from '../lib/shopping.js'

// See migrations.pglite.test.js for the measurement behind this number; it is
// the same instrument and the same runner straddle. hookTimeout is set once, in
// support/pgliteSupabase.js.
vi.setConfig({ testTimeout: 30_000 })

const THIS_FILE = '0032_shopping_lists_runs_items.sql'
const TABLES = ['shopping_lists', 'shopping_runs', 'shopping_items']
const STAMP_COLUMNS = {
  shopping_items: ['added_by_member_id', 'added_at', 'purchased_at', 'purchased_by_member_id'],
  shopping_runs: ['closed_at', 'closed_by_member_id'],
}

describe('#352 — the shopping schema, run against a real Postgres', () => {
  let db
  let person // ONE auth user, in both households
  let housemate // a second member of household A, so "any member" can be shown
  let outsider // creates both households; a member of both, organizer of both
  let stranger // in no household at all
  let hA, hB
  let memberInA, memberInB, housemateInA
  let listA, listB
  let runA, runB

  const asOwner = (sql, params) => db.query(sql, params)

  const rpc = (device, sql, params) =>
    attempt(() => asDevice(db, device, async () => (await db.query(sql, params)).rows[0]))

  const countAsOwner = async (table, where = '', params = []) => {
    const { rows } = await db.query(`select count(*)::int as n from public.${table} ${where}`, params)
    return rows[0].n
  }

  const openRunOf = async (listId) => {
    const { rows } = await db.query(
      'select * from public.shopping_runs where list_id = $1 and closed_at is null',
      [listId],
    )
    return rows
  }

  /** Close a run the way #354's RPC will — as the owner, both stamps at once. */
  const closeRun = (runId, memberId) =>
    db.query(
      'update public.shopping_runs set closed_at = now(), closed_by_member_id = $2 where id = $1',
      [runId, memberId],
    )

  beforeEach(async () => {
    db = await freshDatabase()
    person = await newDevice(db)
    housemate = await newDevice(db)
    outsider = await newDevice(db)
    stranger = await newDevice(db)

    hA = await asDevice(db, outsider, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    hB = await asDevice(db, outsider, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })

    const seedMember = async (householdId, name) => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, $2, 60) returning id`,
        [householdId, name],
      )
      return rows[0].id
    }
    memberInA = await seedMember(hA.id, 'Placeholder One')
    memberInB = await seedMember(hB.id, 'Placeholder Two')
    housemateInA = await seedMember(hA.id, 'Housemate')

    // The load-bearing lines: ONE auth user claims a member row in EACH
    // household (0014's fixture), and a second person shares household A.
    await provisionMember(db, memberInA, person)
    await provisionMember(db, memberInB, person)
    await provisionMember(db, housemateInA, housemate)

    // One list per household, each through the RPC — which is the only way a
    // list arrives — so each already has its open run.
    listA = (await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, 'Groceries']))
      .value
    listB = (await rpc(outsider, 'select * from public.create_shopping_list($1, $2)', [hB.id, 'Groceries']))
      .value
    ;[runA] = await openRunOf(listA.id)
    ;[runB] = await openRunOf(listB.id)
  })

  it('PREMISE: the fixture really is one person in two households, each with an open run', async () => {
    const { rows } = await asOwner(
      'select household_id from public.members where claimed_by = $1 order by household_id',
      [person],
    )
    expect(new Set(rows.map((r) => r.household_id))).toEqual(new Set([hA.id, hB.id]))
    expect(listA?.id).toBeTruthy()
    expect(listB?.id).toBeTruthy()
    expect(runA?.id).toBeTruthy()
    expect(runB?.id).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // AC 1 — the three tables exist as named, RLS is on, every policy is keyed on
  // the household, and the file applies twice
  // -------------------------------------------------------------------------

  describe('AC 1 — the tables, their security, and a second apply', () => {
    const columnsOf = async (table) => {
      const { rows } = await db.query(
        `select column_name, column_default, is_nullable
           from information_schema.columns
          where table_schema = 'public' and table_name = $1
          order by ordinal_position`,
        [table],
      )
      return rows
    }

    it('creates shopping_lists with exactly the named columns, created_at defaulting to now()', async () => {
      const cols = await columnsOf('shopping_lists')
      expect(cols.map((c) => c.column_name)).toEqual(['id', 'household_id', 'name', 'created_at'])
      expect(cols.find((c) => c.column_name === 'created_at').column_default).toBe('now()')
    })

    it('creates shopping_runs with exactly the named columns, opened_at defaulting to now()', async () => {
      const cols = await columnsOf('shopping_runs')
      expect(cols.map((c) => c.column_name)).toEqual([
        'id',
        'list_id',
        'household_id',
        'opened_at',
        'closed_at',
        'closed_by_member_id',
      ])
      expect(cols.find((c) => c.column_name === 'opened_at').column_default).toBe('now()')
      expect(cols.find((c) => c.column_name === 'closed_at').is_nullable).toBe('YES')
    })

    it('creates shopping_items with exactly the named columns', async () => {
      const cols = await columnsOf('shopping_items')
      expect(cols.map((c) => c.column_name)).toEqual([
        'id',
        'run_id',
        'household_id',
        'name',
        'note',
        'added_by_member_id',
        'added_at',
        'purchased_at',
        'purchased_by_member_id',
        'carried_from_item_id',
      ])
    })

    it('has row-level security on all three, and every policy resolves through current_household_ids', async () => {
      const { rows: rls } = await db.query(
        `select relname, relrowsecurity from pg_class
          where relnamespace = 'public'::regnamespace and relname = any($1) order by relname`,
        [TABLES],
      )
      expect(rls).toEqual([
        { relname: 'shopping_items', relrowsecurity: true },
        { relname: 'shopping_lists', relrowsecurity: true },
        { relname: 'shopping_runs', relrowsecurity: true },
      ])

      const { rows: policies } = await db.query(
        `select tablename, policyname, cmd,
                coalesce(qual, '') || ' ' || coalesce(with_check, '') as predicate
           from pg_policies where schemaname = 'public' and tablename = any($1)
          order by tablename, policyname`,
        [TABLES],
      )
      // The exact set, so a policy added later is a line in a diff — and note
      // what is NOT here: no insert policy anywhere, no update policy on runs or
      // items. A policy with no matching grant would be inert, and an inert
      // policy is a second way in waiting for a grant.
      // #368 — `shopping_items_delete_unbought_on_open_run` stood at the top of
      // this list until `0034` dropped it with the grant it bounded. The
      // comment above still holds and now holds completely: there is no
      // insert, update or DELETE policy anywhere in the feature, because there
      // is no client DML left for one to bound.
      expect(policies.map((p) => [p.tablename, p.policyname, p.cmd])).toEqual([
        ['shopping_items', 'shopping_items_select_same_household', 'SELECT'],
        ['shopping_lists', 'shopping_lists_select_same_household', 'SELECT'],
        ['shopping_lists', 'shopping_lists_update_same_household', 'UPDATE'],
        ['shopping_runs', 'shopping_runs_select_same_household', 'SELECT'],
      ])
      for (const p of policies) {
        expect(p.predicate, `${p.policyname} is not keyed on the household`).toMatch(
          /current_household_ids/,
        )
      }
    })

    it('applies a second time without error — the paste path 0001 describes', async () => {
      const second = await attempt(() => db.exec(migrationSql(THIS_FILE)))
      expect(second.error).toBeNull()
      // And the second apply changed nothing: the fixture's rows survive and the
      // policy set is the same size. `create table if not exists` skipping the
      // statement is the mechanism; this is the observation.
      expect(await countAsOwner('shopping_lists')).toBe(2)
      expect(await countAsOwner('shopping_runs')).toBe(2)
      const { rows } = await db.query(
        `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any($1)`,
        [TABLES],
      )
      expect(rows[0].n).toBe(5)
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — two households, and a member of A reads none of B's rows
  // -------------------------------------------------------------------------

  describe('AC 2 — a member of household A reads no row of household B', () => {
    beforeEach(async () => {
      // One item on each run, so every table has a row in each household.
      await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', null])
      await rpc(outsider, 'select * from public.add_shopping_item($1, $2, $3)', [runB.id, 'Bread', null])
    })

    it('POSITIVE CONTROL: as the owner, both households have a row in every table', async () => {
      for (const table of TABLES) {
        expect(await countAsOwner(table, 'where household_id = $1', [hA.id]), table).toBe(1)
        expect(await countAsOwner(table, 'where household_id = $1', [hB.id]), table).toBe(1)
      }
    })

    it('the DEFECT SHAPE, stated: unfiltered, the person who is in both sees both — RLS is not the filter', async () => {
      // The #159 finding, restated for these tables. RLS returns every row the
      // caller MAY see, and this caller may see two households' worth. The
      // client's `.eq('household_id', id)` is what makes it one household, which
      // is why `household_id` is granted for select on all three.
      const seen = await asDevice(db, person, async () => {
        const { rows } = await db.query('select household_id from public.shopping_lists')
        return new Set(rows.map((r) => r.household_id))
      })
      expect(seen).toEqual(new Set([hA.id, hB.id]))
    })

    it('filtered by household A, each of the three reads returns only A', async () => {
      // The SQL `readShopping` compiles to: lists by household, runs by the
      // list ids, items by the run ids. Never a join through the embed.
      const result = await asDevice(db, person, async () => {
        const { rows: lists } = await db.query(
          `select ${SHOPPING_LIST_COLUMNS} from public.shopping_lists where household_id = $1`,
          [hA.id],
        )
        const { rows: runs } = await db.query(
          `select ${SHOPPING_RUN_COLUMNS} from public.shopping_runs
            where list_id = any($1::uuid[]) and closed_at is null`,
          [lists.map((l) => l.id)],
        )
        const { rows: items } = await db.query(
          `select ${SHOPPING_ITEM_COLUMNS} from public.shopping_items where run_id = any($1::uuid[])`,
          [runs.map((r) => r.id)],
        )
        return { lists, runs, items }
      })
      expect(result.lists).toHaveLength(1)
      expect(result.lists[0].household_id).toBe(hA.id)
      expect(result.runs).toHaveLength(1)
      expect(result.runs[0].household_id).toBe(hA.id)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].household_id).toBe(hA.id)
      expect(result.items[0].name).toBe('Milk')
    })

    it('a member of A ONLY sees nothing of B on any table, and a stranger sees nothing at all', async () => {
      // `housemate` is in A and not B — the plain case, where RLS alone scopes.
      for (const table of TABLES) {
        const seen = await asDevice(db, housemate, async () => {
          const { rows } = await db.query(`select household_id from public.${table}`)
          return rows.map((r) => r.household_id)
        })
        expect(seen, `${table} as a member of A only`).toEqual([hA.id])
        const none = await asDevice(db, stranger, async () => {
          const { rows } = await db.query(`select count(*)::int as n from public.${table}`)
          return rows[0].n
        })
        expect(none, `${table} as a stranger`).toBe(0)
      }
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — the grants: read everything by name, write almost nothing
  // -------------------------------------------------------------------------

  describe('AC 3 — what authenticated holds, column by column', () => {
    const columnGrants = async (privilege) => {
      const { rows } = await db.query(
        `select table_name, column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = any($1)
            and grantee = 'authenticated' and privilege_type = $2
          order by table_name, column_name`,
        [TABLES, privilege],
      )
      return rows.map((r) => `${r.table_name}.${r.column_name}`)
    }
    const tableGrants = async (privilege) => {
      const { rows } = await db.query(
        `select table_name from information_schema.table_privileges
          where table_schema = 'public' and table_name = any($1)
            and grantee = 'authenticated' and privilege_type = $2
          order by table_name`,
        [TABLES, privilege],
      )
      return rows.map((r) => r.table_name)
    }
    const allColumnsOf = async (table) => {
      const { rows } = await db.query(
        `select a.attname::text as column_name from pg_attribute a
          where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0 and not a.attisdropped
          order by 1`,
        [table],
      )
      return rows.map((r) => r.column_name).sort()
    }

    it('grants select on EVERY column of all three, by name, household_id included', async () => {
      const granted = await columnGrants('SELECT')
      for (const table of TABLES) {
        const all = await allColumnsOf(table)
        const forTable = granted.filter((g) => g.startsWith(`${table}.`)).map((g) => g.split('.')[1])
        expect(forTable.sort(), table).toEqual(all)
        expect(forTable, `${table}.household_id — the 0014 route`).toContain('household_id')
      }
      // PER COLUMN, not per table: a table-level select would silently cover
      // whatever the next migration adds. The property 0014 kept on members.
      expect(await tableGrants('SELECT')).toEqual([])
    })

    it('grants those columns as the same strings the data layer selects with', async () => {
      const granted = await columnGrants('SELECT')
      const constant = {
        shopping_lists: SHOPPING_LIST_COLUMNS,
        shopping_runs: SHOPPING_RUN_COLUMNS,
        shopping_items: SHOPPING_ITEM_COLUMNS,
      }
      for (const table of TABLES) {
        const used = constant[table].split(',').map((c) => c.trim()).sort()
        const forTable = granted.filter((g) => g.startsWith(`${table}.`)).map((g) => g.split('.')[1]).sort()
        expect(forTable, table).toEqual(used)
      }
    })

    it('grants update on shopping_lists(name) and on NO other column anywhere', async () => {
      expect(await columnGrants('UPDATE')).toEqual(['shopping_lists.name'])
      expect(await tableGrants('UPDATE')).toEqual([])
    })

    it('grants NO insert on any of the three — creation is the RPCs’ alone', async () => {
      expect(await columnGrants('INSERT')).toEqual([])
      expect(await tableGrants('INSERT')).toEqual([])
    })

    it('grants no table-level DELETE anywhere — #368 withdrew the last one', async () => {
      // This read `['shopping_items']` until `0034`. The remove is an RPC now,
      // for a reason no grant could fix: a policy bounds which ROWS and cannot
      // take the run's lock, so a remove racing a finish deleted the original
      // out of the closed run's record.
      expect(await tableGrants('DELETE')).toEqual([])
    })

    it('withholds update on every stamp column, which the update assertion above already implies — stated by name', async () => {
      // Redundant with `update on shopping_lists(name) only`, and kept because
      // THIS is the sentence the story is about: a client that could write a
      // stamp could attribute an item to a housemate or backdate a purchase.
      const updatable = await columnGrants('UPDATE')
      for (const [table, columns] of Object.entries(STAMP_COLUMNS)) {
        for (const column of columns) expect(updatable).not.toContain(`${table}.${column}`)
      }
    })

    it('BEHAVIOUR: a direct insert on each table is refused by the grant, not by a policy', async () => {
      // `where false` matches no row, so no policy is consulted — a refusal here
      // can only be a privilege refusal. The grants suite's discipline.
      for (const [table, sql] of [
        ['shopping_lists', 'insert into public.shopping_lists (household_id, name) select $1, $2 where false'],
        ['shopping_runs', 'insert into public.shopping_runs (list_id, household_id) select $2, $1 where false'],
        ['shopping_items', 'insert into public.shopping_items (run_id, household_id, name) select $2, $1, $3 where false'],
      ]) {
        const refused = await attempt(() =>
          asDevice(db, person, () => db.query(sql, [hA.id, listA.id, 'Smuggled'].slice(0, sql.split('$').length - 1))),
        )
        expect(refused.ok, table).toBe(false)
        expect(refused.error, table).toMatch(/permission denied/i)
      }
    })

    it('BEHAVIOUR: a direct write of a stamp column is refused by the grant', async () => {
      const item = (
        await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', null])
      ).value
      for (const sql of [
        'update public.shopping_items set purchased_at = now() where id = $1',
        'update public.shopping_items set added_by_member_id = null where id = $1',
        'update public.shopping_runs set closed_at = now() where id = $1',
      ]) {
        const refused = await attempt(() => asDevice(db, person, () => db.query(sql, [item.id])))
        expect(refused.ok, sql).toBe(false)
        expect(refused.error, sql).toMatch(/permission denied/i)
      }
    })

    it('anon holds nothing on any of the three, at table or column level', async () => {
      const { rows } = await db.query(
        `select count(*)::int as n from (
           select table_name from information_schema.table_privileges
            where table_schema = 'public' and table_name = any($1) and grantee = 'anon'
              and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
           union all
           select table_name from information_schema.column_privileges
            where table_schema = 'public' and table_name = any($1) and grantee = 'anon'
         ) t`,
        [TABLES],
      )
      expect(rows[0].n).toBe(0)
    })

    it('authenticated may execute all four RPCs, and anon and PUBLIC may execute none', async () => {
      const fns = [
        'public.create_shopping_list(uuid, text)',
        'public.add_shopping_item(uuid, text, text)',
        'public.purchase_shopping_item(uuid)',
        'public.unpurchase_shopping_item(uuid)',
      ]
      for (const fn of fns) {
        const { rows } = await db.query(
          `select has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('anon', $1, 'execute') as anon`,
          [fn],
        )
        expect(rows[0], fn).toEqual({ auth: true, anon: false })
      }
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — create_shopping_list and add_shopping_item
  // -------------------------------------------------------------------------

  describe('AC 5 — creating a list opens its run; adding an item stamps it', () => {
    it('create_shopping_list trims the name, writes the list AND one open run, and returns the list', async () => {
      const made = await rpc(person, 'select * from public.create_shopping_list($1, $2)', [
        hA.id,
        '  Hardware  ',
      ])
      expect(made.error).toBeNull()
      expect(made.value.name).toBe('Hardware')
      expect(made.value.household_id).toBe(hA.id)
      expect(made.value.created_at).toBeTruthy()

      const runs = await openRunOf(made.value.id)
      expect(runs).toHaveLength(1)
      expect(runs[0].household_id).toBe(hA.id)
      expect(runs[0].closed_at).toBeNull()
      expect(runs[0].closed_by_member_id).toBeNull()
    })

    it('an empty or blank name raises "a list needs a name" and writes nothing', async () => {
      const before = await countAsOwner('shopping_lists')
      for (const bad of ['', '   ', null]) {
        const refused = await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, bad])
        expect(refused.ok, JSON.stringify(bad)).toBe(false)
        expect(refused.error).toMatch(/a list needs a name/)
      }
      expect(await countAsOwner('shopping_lists')).toBe(before)
      expect(await countAsOwner('shopping_runs')).toBe(before)
    })

    it('a household the caller is not in is refused, and nothing is written', async () => {
      const refused = await rpc(housemate, 'select * from public.create_shopping_list($1, $2)', [
        hB.id,
        'Hardware',
      ])
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such household/)
      expect(await countAsOwner('shopping_lists', 'where household_id = $1', [hB.id])).toBe(1)
    })

    it('add_shopping_item stamps added_by_member_id = acting_member and added_at from the database clock', async () => {
      const made = await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [
        runA.id,
        '  Milk ',
        '  2 litres ',
      ])
      expect(made.error).toBeNull()
      expect(made.value.name).toBe('Milk')
      expect(made.value.note).toBe('2 litres')
      expect(made.value.run_id).toBe(runA.id)
      expect(made.value.household_id).toBe(hA.id)
      // The caller's member row IN THIS HOUSEHOLD — the person holds two, and
      // the one in B must never be written here.
      expect(made.value.added_by_member_id).toBe(memberInA)
      expect(made.value.purchased_at).toBeNull()
      expect(made.value.purchased_by_member_id).toBeNull()
      expect(made.value.carried_from_item_id).toBeNull()

      // From the clock: within the same transaction's now() window, and not a
      // value the caller could have chosen. The signature has no timestamp.
      const { rows } = await db.query(
        'select added_at <= now() and added_at > now() - interval \'1 minute\' as recent from public.shopping_items where id = $1',
        [made.value.id],
      )
      expect(rows[0].recent).toBe(true)
    })

    it('the two stamping signatures carry no timestamp argument', async () => {
      const { rows } = await db.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('add_shopping_item', 'purchase_shopping_item', 'create_shopping_list', 'unpurchase_shopping_item')
          order by p.proname`,
      )
      expect(rows).toEqual([
        { proname: 'add_shopping_item', args: 'run uuid, name text, note text' },
        { proname: 'create_shopping_list', args: 'household uuid, name text' },
        { proname: 'purchase_shopping_item', args: 'item uuid' },
        { proname: 'unpurchase_shopping_item', args: 'item uuid' },
      ])
      for (const row of rows) expect(row.args).not.toMatch(/timestamp/)
    })

    it('an empty item name raises "an item needs a name"', async () => {
      const refused = await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [
        runA.id,
        '  ',
        null,
      ])
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/an item needs a name/)
      expect(await countAsOwner('shopping_items')).toBe(0)
    })

    it('a run outside the caller’s households raises "no such run in your household" and writes nothing', async () => {
      const refused = await rpc(housemate, 'select * from public.add_shopping_item($1, $2, $3)', [
        runB.id,
        'Smuggled',
        null,
      ])
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such run in your household/)
      expect(await countAsOwner('shopping_items')).toBe(0)
    })

    it('a closed run raises "run already closed" and writes nothing', async () => {
      await closeRun(runA.id, memberInA)
      const refused = await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [
        runA.id,
        'Late',
        null,
      ])
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/run already closed/)
      expect(await countAsOwner('shopping_items')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 — purchase and unpurchase
  // -------------------------------------------------------------------------

  describe('AC 6 — buying an item, and taking it back', () => {
    let item

    beforeEach(async () => {
      item = (
        await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', '2 litres'])
      ).value
    })

    it('purchase stamps purchased_at from the clock and purchased_by_member_id = acting_member, and returns the row', async () => {
      const bought = await rpc(housemate, 'select * from public.purchase_shopping_item($1)', [item.id])
      expect(bought.error).toBeNull()
      expect(bought.value.id).toBe(item.id)
      expect(bought.value.purchased_by_member_id).toBe(housemateInA)
      expect(bought.value.purchased_at).toBeTruthy()
      // The adder is untouched by the buyer.
      expect(bought.value.added_by_member_id).toBe(memberInA)
      expect(bought.value.added_at).toEqual(item.added_at)
    })

    it('a second purchase raises "item already bought" and the FIRST stamp survives', async () => {
      const first = (await rpc(housemate, 'select * from public.purchase_shopping_item($1)', [item.id])).value
      const second = await rpc(person, 'select * from public.purchase_shopping_item($1)', [item.id])
      expect(second.ok).toBe(false)
      expect(second.error).toMatch(/item already bought/)

      const { rows } = await db.query(
        'select purchased_at, purchased_by_member_id from public.shopping_items where id = $1',
        [item.id],
      )
      expect(rows[0].purchased_by_member_id).toBe(housemateInA)
      expect(rows[0].purchased_at).toEqual(first.purchased_at)
    })

    it('unpurchase returns exactly the two columns to null and leaves the rest of the row byte-equal to before the purchase', async () => {
      const { rows: before } = await db.query('select * from public.shopping_items where id = $1', [item.id])
      await rpc(housemate, 'select * from public.purchase_shopping_item($1)', [item.id])
      // Any member, not only the buyer: `person` takes back `housemate`'s tick.
      const taken = await rpc(person, 'select * from public.unpurchase_shopping_item($1)', [item.id])
      expect(taken.error).toBeNull()
      expect(taken.value.purchased_at).toBeNull()
      expect(taken.value.purchased_by_member_id).toBeNull()

      const { rows: after } = await db.query('select * from public.shopping_items where id = $1', [item.id])
      expect(after[0]).toEqual(before[0])
    })

    it('purchase on an item outside the caller’s households is refused, and nothing moves', async () => {
      const itemB = (
        await rpc(outsider, 'select * from public.add_shopping_item($1, $2, $3)', [runB.id, 'Bread', null])
      ).value
      const refused = await rpc(housemate, 'select * from public.purchase_shopping_item($1)', [itemB.id])
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such item in your household/)
      const { rows } = await db.query('select purchased_at from public.shopping_items where id = $1', [itemB.id])
      expect(rows[0].purchased_at).toBeNull()
    })

    it('either RPC on an item in a CLOSED run raises "run already closed"', async () => {
      await closeRun(runA.id, memberInA)
      const buy = await rpc(person, 'select * from public.purchase_shopping_item($1)', [item.id])
      expect(buy.ok).toBe(false)
      expect(buy.error).toMatch(/run already closed/)
      const unbuy = await rpc(person, 'select * from public.unpurchase_shopping_item($1)', [item.id])
      expect(unbuy.ok).toBe(false)
      expect(unbuy.error).toMatch(/run already closed/)
    })

    it('POSITIVE CONTROL: the run-closed check is the reason, not the lock — the same item buys fine while the run is open', async () => {
      const bought = await rpc(person, 'select * from public.purchase_shopping_item($1)', [item.id])
      expect(bought.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 7 — one open run per list, one name per household, as constraints
  // -------------------------------------------------------------------------

  describe('AC 7 — the uniqueness constraints', () => {
    it('a second open run for the same list is refused by shopping_runs_one_open_per_list, whoever inserts it', async () => {
      // As the OWNER — bypassing every grant and policy — so what refuses is
      // the index and nothing in front of it.
      const refused = await attempt(() =>
        db.query('insert into public.shopping_runs (list_id, household_id) values ($1, $2)', [listA.id, hA.id]),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_runs_one_open_per_list/)
      expect(await openRunOf(listA.id)).toHaveLength(1)
    })

    it('CONTROL: once the open run is closed, a new open run for the list is accepted', async () => {
      await closeRun(runA.id, memberInA)
      const accepted = await attempt(() =>
        db.query('insert into public.shopping_runs (list_id, household_id) values ($1, $2)', [listA.id, hA.id]),
      )
      expect(accepted.error).toBeNull()
      expect(await openRunOf(listA.id)).toHaveLength(1)
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listA.id])).toBe(2)
    })

    it('a closer implies a close — a run with a closer and no closed_at is refused, and the converse is a real state', async () => {
      const refused = await attempt(() =>
        db.query('update public.shopping_runs set closed_by_member_id = $2 where id = $1', [
          runA.id,
          memberInA,
        ]),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_runs_closer_implies_close/)

      // The other way round is what a removed closer leaves behind (AC 9), so
      // it must be admitted — the first draft's symmetric constraint refused
      // it, and with it every member delete.
      const admitted = await attempt(() =>
        db.query('update public.shopping_runs set closed_at = now() where id = $1', [runA.id]),
      )
      expect(admitted.error).toBeNull()

      const sameForItems = await attempt(() =>
        db.query(
          `insert into public.shopping_items (run_id, household_id, name, purchased_by_member_id)
           values ($1, $2, $3, $4)`,
          [runB.id, hB.id, 'Milk', memberInB],
        ),
      )
      expect(sameForItems.ok).toBe(false)
      expect(sameForItems.error).toMatch(/shopping_items_buyer_implies_purchase/)
    })

    it('a second list named "groceries" beside "Groceries" is refused by shopping_lists_household_name_key', async () => {
      const refused = await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, 'groceries'])
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_lists_household_name_key/)
      expect(await countAsOwner('shopping_lists', 'where household_id = $1', [hA.id])).toBe(1)
    })

    it('CONTROL: the same name in ANOTHER household is fine — the fixture already has one in each', async () => {
      expect(listA.name).toBe('Groceries')
      expect(listB.name).toBe('Groceries')
      expect(await countAsOwner('shopping_lists', "where lower(name) = 'groceries'")).toBe(2)
    })

    it('and a rename into an existing name is refused by the same index', async () => {
      await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, 'Hardware'])
      const refused = await attempt(() =>
        asDevice(db, person, () =>
          db.query('update public.shopping_lists set name = $2 where id = $1', [listA.id, 'HARDWARE']),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_lists_household_name_key/)
    })

    // #358 AC 5 — the CODE, which is what the client's sentence is keyed on.
    //
    // The two tests above prove the index refuses; neither can say what the
    // client will be handed. `shopping.js` maps SQLSTATE 23505 — and never the
    // message, which Postgres is free to reword — into "You already have a list
    // called X", so if a future migration replaced the index with a trigger
    // raising `P0001`, every one of those tests would still pass while the
    // person read a sentence about a constraint. This is the assertion that
    // fails instead.
    it('#358 — both refusals carry SQLSTATE 23505, which is what the client maps on', async () => {
      const codeOf = async (fn) => {
        try {
          await fn()
          return null
        } catch (error) {
          return error.code
        }
      }

      const onInsert = await codeOf(() =>
        asDevice(db, person, () =>
          db.query('select * from public.create_shopping_list($1, $2)', [hA.id, 'GROCERIES']),
        ),
      )
      expect(onInsert).toBe('23505')

      await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, 'Hardware'])
      const onUpdate = await codeOf(() =>
        asDevice(db, person, () =>
          db.query('update public.shopping_lists set name = $2 where id = $1', [listA.id, 'hardware']),
        ),
      )
      expect(onUpdate).toBe('23505')

      // And no row moved on either refusal: two lists, named as they were.
      const { rows } = await db.query(
        'select name from public.shopping_lists where household_id = $1 order by name',
        [hA.id],
      )
      expect(rows.map((r) => r.name)).toEqual(['Groceries', 'Hardware'])
    })

    it('a rename to a blank name is refused by the check constraint, so the RPC’s trim rule holds on the direct write too', async () => {
      const refused = await attempt(() =>
        asDevice(db, person, () =>
          db.query('update public.shopping_lists set name = $2 where id = $1', [listA.id, '   ']),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_lists_name_present/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 8 — the delete policy: any member, unbought, open run
  // -------------------------------------------------------------------------

  describe('AC 8 — removing an item, through the RPC 0034 made it (#368)', () => {
    let item

    beforeEach(async () => {
      item = (
        await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', null])
      ).value
    })

    // The whole block was written against `delete from public.shopping_items`
    // under `0032`'s policy. `0034` withdrew that grant and the policy with it,
    // so the SUBJECT of these assertions has moved — and they are rewritten to
    // follow it rather than deleted, because what they protect is unchanged:
    // any member may remove an unbought item on an open run, and nothing else
    // is removable by anyone. What is NEW is that each refusal now has a name.
    const removeAs = (device, id) =>
      attempt(() => asDevice(db, device, () => db.query('select public.remove_shopping_item($1)', [id])))

    const deleteDirectlyAs = (device, id) =>
      attempt(() => asDevice(db, device, () => db.query('delete from public.shopping_items where id = $1', [id])))

    it('a housemate who did not add it removes an unbought item from the open run', async () => {
      const removed = await removeAs(housemate, item.id)
      expect(removed.error).toBeNull()
      expect(await countAsOwner('shopping_items', 'where id = $1', [item.id])).toBe(0)
    })

    it('a BOUGHT item is refused BY NAME, and it survives', async () => {
      await rpc(person, 'select * from public.purchase_shopping_item($1)', [item.id])
      const refused = await removeAs(person, item.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/item already bought/)
      expect(await countAsOwner('shopping_items', 'where id = $1', [item.id])).toBe(1)
    })

    it('an item on a CLOSED run is refused BY NAME, and it survives', async () => {
      await closeRun(runA.id, memberInA)
      const refused = await removeAs(person, item.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/run already closed/)
      expect(await countAsOwner('shopping_items', 'where id = $1', [item.id])).toBe(1)
    })

    it('an item in another household is refused as one this member cannot see', async () => {
      const itemB = (
        await rpc(outsider, 'select * from public.add_shopping_item($1, $2, $3)', [runB.id, 'Bread', null])
      ).value
      const refused = await removeAs(housemate, itemB.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such item in your household/)
      expect(await countAsOwner('shopping_items', 'where id = $1', [itemB.id])).toBe(1)
    })

    // The revoke's own proof, and the reason the RPC route was taken over a
    // trigger: after `0034` there is no client DML on `shopping_items` at all,
    // so the racing path this story closes is not merely guarded — it is gone.
    it('the client can no longer delete from the table at all — the grant is withdrawn', async () => {
      const refused = await deleteDirectlyAs(person, item.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/permission denied/i)
      expect(await countAsOwner('shopping_items', 'where id = $1', [item.id])).toBe(1)
    })

    it('and the policy that used to admit that delete is gone with it', async () => {
      // This assertion used to read the policy's predicate for its two
      // conditions. The policy is what `0034` removed, so the check inverts:
      // a policy still standing here would be `0032`'s "second way in waiting
      // for a grant to arrive", and the next person to grant a delete would
      // reopen the window without touching this file.
      const { rows } = await db.query(
        `select policyname from pg_policies
          where tablename = 'shopping_items' and cmd = 'DELETE'`,
      )
      expect(rows).toEqual([])
    })

    it('POSITIVE CONTROL: the fixture item really was removable before it was bought', async () => {
      // Without this, every refusal above is satisfied by an item that could
      // never be removed by anyone — the whole block would pass against a
      // function that always raises.
      const removed = await removeAs(person, item.id)
      expect(removed.error).toBeNull()
      expect(await countAsOwner('shopping_items', 'where id = $1', [item.id])).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC 9 — what a removed member leaves, and what a deleted list takes
  // -------------------------------------------------------------------------

  describe('AC 9 — attribution survives a member; structure follows a list', () => {
    it('deleting a member leaves their added, bought and closed rows standing with the stamp null', async () => {
      const added = (
        await rpc(housemate, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', null])
      ).value
      await rpc(housemate, 'select * from public.purchase_shopping_item($1)', [added.id])
      // A second run, closed by the housemate: close the open one first.
      await closeRun(runA.id, housemateInA)

      await db.query('delete from public.members where id = $1', [housemateInA])

      const { rows: items } = await db.query('select * from public.shopping_items where id = $1', [added.id])
      expect(items).toHaveLength(1)
      expect(items[0].added_by_member_id).toBeNull()
      expect(items[0].purchased_by_member_id).toBeNull()
      // `set null (purchased_by_member_id)` clears the WHO and keeps the WHEN,
      // and `household_id` — the other half of the composite key — survives.
      // Both are asserted because both were wrong in the first draft: a
      // column-less `set null` nulled `household_id` and the delete was
      // refused, and a symmetric whole-purchase check would have refused the
      // row this leaves.
      expect(items[0].purchased_at).not.toBeNull()
      expect(items[0].household_id).toBe(hA.id)

      const { rows: runs } = await db.query('select * from public.shopping_runs where id = $1', [runA.id])
      expect(runs).toHaveLength(1)
      expect(runs[0].closed_by_member_id).toBeNull()
      expect(runs[0].closed_at).not.toBeNull()
    })

    it('deleting a list cascades to its runs and their items', async () => {
      await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', null])
      await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Eggs', null])
      expect(await countAsOwner('shopping_items', 'where household_id = $1', [hA.id])).toBe(2)

      await db.query('delete from public.shopping_lists where id = $1', [listA.id])

      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listA.id])).toBe(0)
      expect(await countAsOwner('shopping_items', 'where household_id = $1', [hA.id])).toBe(0)
      // And household B's list is untouched — the cascade follows the list, not
      // the table.
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listB.id])).toBe(1)
    })

    it('deleting the run an item was carried from leaves the carried item, pointing at nothing', async () => {
      // #354's shape, exercised at the FK level here: carried_from is
      // attribution, so it is `set null`, and the item still wanted survives
      // the record of the trip it came from being deleted by SQL.
      const original = (
        await rpc(person, 'select * from public.add_shopping_item($1, $2, $3)', [runA.id, 'Milk', null])
      ).value
      await closeRun(runA.id, memberInA)
      const { rows: [next] } = await db.query(
        'insert into public.shopping_runs (list_id, household_id) values ($1, $2) returning id',
        [listA.id, hA.id],
      )
      const { rows: [carried] } = await db.query(
        `insert into public.shopping_items (run_id, household_id, name, carried_from_item_id)
         values ($1, $2, $3, $4) returning id`,
        [next.id, hA.id, 'Milk', original.id],
      )

      await db.query('delete from public.shopping_runs where id = $1', [runA.id])

      const { rows } = await db.query('select carried_from_item_id from public.shopping_items where id = $1', [
        carried.id,
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].carried_from_item_id).toBeNull()
    })

    it('every attribution FK is set-null and every structural FK is cascade, read off the catalog', async () => {
      const { rows } = await db.query(
        `select c.conrelid::regclass::text as on_table, c.conname, c.confdeltype
           from pg_constraint c
          where c.contype = 'f' and c.conrelid::regclass::text = any($1)
          order by 1, 2`,
        [TABLES.map((t) => `${t}`)],
      )
      // `a` = no action, `c` = cascade, `n` = set null.
      expect(rows).toEqual([
        { on_table: 'shopping_items', conname: 'shopping_items_adder_in_household', confdeltype: 'n' },
        { on_table: 'shopping_items', conname: 'shopping_items_buyer_in_household', confdeltype: 'n' },
        { on_table: 'shopping_items', conname: 'shopping_items_carried_from_item_id_fkey', confdeltype: 'n' },
        { on_table: 'shopping_items', conname: 'shopping_items_household_id_fkey', confdeltype: 'c' },
        { on_table: 'shopping_items', conname: 'shopping_items_run_id_fkey', confdeltype: 'c' },
        { on_table: 'shopping_lists', conname: 'shopping_lists_household_id_fkey', confdeltype: 'c' },
        { on_table: 'shopping_runs', conname: 'shopping_runs_closer_in_household', confdeltype: 'n' },
        { on_table: 'shopping_runs', conname: 'shopping_runs_household_id_fkey', confdeltype: 'c' },
        { on_table: 'shopping_runs', conname: 'shopping_runs_list_id_fkey', confdeltype: 'c' },
      ])
    })

    it('a row pairing one household’s person with another’s id is refused — the composite FKs', async () => {
      const refused = await attempt(() =>
        db.query(
          `insert into public.shopping_items (run_id, household_id, name, added_by_member_id)
           values ($1, $2, $3, $4)`,
          [runA.id, hA.id, 'Crossed', memberInB],
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_items_adder_in_household/)
    })
  })
})
