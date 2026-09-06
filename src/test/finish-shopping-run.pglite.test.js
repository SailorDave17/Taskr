// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #354 — `finish_shopping_run`: close a list's open run and open the next one
// with every unbought item carried forward, as ONE transaction, against a real
// Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies, so a green run says
// nothing about the hosted project. `0033` is unapplied there until somebody
// runs `npm run migrate:live`, and `npm run check:live` is the authority on
// that; the `finish_shopping_run` entry in `LIVE_RPCS` is red on purpose until
// then.
//
// WHAT THIS FILE CANNOT SAY, stated up front because it is the story's hardest
// claim: pglite is ONE connection, so the two-phones-at-once interleaving the
// `for update` exists for cannot happen here. What this file proves is the
// SEQUENTIAL form — the second call on a run the first call closed is refused
// and writes nothing — and #356 proves the concurrent form on the live project.
//
// THE FIXTURE IS #352's (and #159's): ONE auth user holding a claimed member
// row in TWO households, a second person sharing household A, and a list with
// an open run in each. The two-household shape is what makes "the closer is
// the caller's member row IN THIS HOUSEHOLD" a real assertion: `person` holds
// two member rows, and only one of them may ever be written.
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

// See migrations.pglite.test.js for the measurement behind this number; it is
// the same instrument and the same runner straddle. hookTimeout is set once, in
// support/pgliteSupabase.js.
vi.setConfig({ testTimeout: 30_000 })

const THIS_FILE = '0033_finish_shopping_run.sql'
const FN = 'public.finish_shopping_run(uuid)'
const NOBODY = '00000000-0000-0000-0000-000000000000'

describe('#354 — finish_shopping_run, run against a real Postgres', () => {
  let db
  let person // ONE auth user, in both households
  let housemate // a second member of household A — "the other phone"
  let outsider // creates both households; a member of both, organizer of both
  let stranger // in no household at all
  let hA, hB
  let memberInA, memberInB, housemateInA
  let listA, listB
  let runA, runB
  let unbought // the three items still to find when the run is finished
  let bought // the two already in the cart
  let beforeFinish // every row of runA, whole, as it stood before any finish

  const rpc = (device, sql, params) =>
    attempt(() => asDevice(db, device, async () => (await db.query(sql, params)).rows[0]))

  const finishAs = (device, runId) => rpc(device, 'select * from public.finish_shopping_run($1)', [runId])

  const addAs = (device, runId, name, note = null) =>
    rpc(device, 'select * from public.add_shopping_item($1, $2, $3)', [runId, name, note])

  const buyAs = (device, itemId) => rpc(device, 'select * from public.purchase_shopping_item($1)', [itemId])

  const countAsOwner = async (table, where = '', params = []) => {
    const { rows } = await db.query(`select count(*)::int as n from public.${table} ${where}`, params)
    return rows[0].n
  }

  const openRunsOf = async (listId) => {
    const { rows } = await db.query(
      'select * from public.shopping_runs where list_id = $1 and closed_at is null',
      [listId],
    )
    return rows
  }

  const itemsOn = async (runId) => {
    const { rows } = await db.query(
      'select * from public.shopping_items where run_id = $1 order by added_at, name, id',
      [runId],
    )
    return rows
  }

  /** Every row of both tables, as the owner, for a "nothing changed" comparison. */
  const snapshot = async () => {
    const { rows: runs } = await db.query('select * from public.shopping_runs order by id')
    const { rows: items } = await db.query('select * from public.shopping_items order by id')
    return { runs, items }
  }

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

    await provisionMember(db, memberInA, person)
    await provisionMember(db, memberInB, person)
    await provisionMember(db, housemateInA, housemate)

    listA = (await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, 'Groceries']))
      .value
    listB = (await rpc(outsider, 'select * from public.create_shopping_list($1, $2)', [hB.id, 'Groceries']))
      .value
    ;[runA] = await openRunsOf(listA.id)
    ;[runB] = await openRunsOf(listB.id)

    // The story's own fixture: two purchased and three unpurchased. The
    // housemate adds one of the unbought ones and buys both bought ones, so
    // "added by" and "bought by" are not always the finisher's row.
    unbought = [
      (await addAs(person, runA.id, 'Milk', '2 litres')).value,
      (await addAs(housemate, runA.id, 'Eggs')).value,
      (await addAs(person, runA.id, 'Bread')).value,
    ]
    bought = [(await addAs(person, runA.id, 'Butter')).value, (await addAs(person, runA.id, 'Flour')).value]
    for (const item of bought) await buyAs(housemate, item.id)
    // Whole rows, as the owner, after the purchases and before any finish —
    // the reference every "left exactly as it was" assertion compares against.
    beforeFinish = await itemsOn(runA.id)
  })

  it('PREMISE: one person in two households, five items on the open run, two of them bought', async () => {
    const { rows } = await db.query(
      'select household_id from public.members where claimed_by = $1 order by household_id',
      [person],
    )
    expect(new Set(rows.map((r) => r.household_id))).toEqual(new Set([hA.id, hB.id]))
    expect(await countAsOwner('shopping_items', 'where run_id = $1', [runA.id])).toBe(5)
    expect(await countAsOwner('shopping_items', 'where run_id = $1 and purchased_at is not null', [runA.id])).toBe(2)
    expect(unbought.every((i) => i.purchased_at === null)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // AC 1 — the close, the next run, and what is carried
  // -------------------------------------------------------------------------

  describe('AC 1 — finishing closes the run and opens the next with the unbought items carried', () => {
    let opened

    beforeEach(async () => {
      const result = await finishAs(person, runA.id)
      expect(result.error).toBeNull()
      opened = result.value
    })

    it('stamps closed_at from the database clock and closed_by_member_id = acting_member — the caller’s row in THIS household', async () => {
      const { rows } = await db.query(
        `select closed_by_member_id,
                closed_at is not null as closed,
                closed_at <= now() and closed_at > now() - interval '1 minute' as recent
           from public.shopping_runs where id = $1`,
        [runA.id],
      )
      expect(rows[0].closed).toBe(true)
      expect(rows[0].recent).toBe(true)
      expect(rows[0].closed_by_member_id).toBe(memberInA)
      // `person` also holds a member row in household B, and that one must
      // never be written here.
      expect(rows[0].closed_by_member_id).not.toBe(memberInB)
    })

    it('returns the NEW run: same list, same household, open, a different row', async () => {
      expect(opened.id).not.toBe(runA.id)
      expect(opened.list_id).toBe(listA.id)
      expect(opened.household_id).toBe(hA.id)
      expect(opened.closed_at).toBeNull()
      expect(opened.closed_by_member_id).toBeNull()
      expect(opened.opened_at).toBeTruthy()

      const open = await openRunsOf(listA.id)
      expect(open).toHaveLength(1)
      expect(open[0].id).toBe(opened.id)
      // Two runs on the list now — the closed one and this one — and nothing
      // in household B moved.
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listA.id])).toBe(2)
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listB.id])).toBe(1)
    })

    it('carries exactly the three unbought items, each keeping name, note, adder and added_at, pointing at its original, purchase columns null', async () => {
      const carried = await itemsOn(opened.id)
      expect(carried).toHaveLength(3)

      const byOrigin = new Map(carried.map((c) => [c.carried_from_item_id, c]))
      for (const original of unbought) {
        const copy = byOrigin.get(original.id)
        expect(copy, `${original.name} was not carried`).toBeTruthy()
        expect(copy.id).not.toBe(original.id)
        expect(copy.run_id).toBe(opened.id)
        expect(copy.household_id).toBe(hA.id)
        // The owner decision of 2026-09-05: the original adder and time, not
        // the finisher's. `Eggs` was added by the housemate, and stays theirs.
        expect(copy.name).toBe(original.name)
        expect(copy.note).toBe(original.note)
        expect(copy.added_by_member_id).toBe(original.added_by_member_id)
        expect(copy.added_at).toEqual(original.added_at)
        expect(copy.purchased_at).toBeNull()
        expect(copy.purchased_by_member_id).toBeNull()
      }
      expect(carried.find((c) => c.name === 'Eggs').added_by_member_id).toBe(housemateInA)
      expect(carried.find((c) => c.name === 'Milk').note).toBe('2 litres')
      // And neither bought item came along.
      expect(carried.map((c) => c.name).sort()).toEqual(['Bread', 'Eggs', 'Milk'])
    })

    it('leaves every row of the finished run WHOLE-ROW equal to what it was before the finish — the bought items untouched, the unbought ones COPIED, never moved', async () => {
      // `beforeFinish` is the whole-row snapshot taken in the outer beforeEach,
      // AFTER the two purchases and BEFORE the finish — so each row is compared
      // in full, not on a few named columns. A first draft asserted five
      // columns across the five rows and titled itself "byte-equal"; the
      // fan-out's test-vacuity lens showed a post-carry `update … set note =
      // null` on the originals would have left it green.
      const still = await itemsOn(runA.id)
      expect(still).toHaveLength(5)
      expect(still).toEqual(beforeFinish)
      for (const original of unbought) {
        const kept = still.find((s) => s.id === original.id)
        expect(kept, `${original.name} left the closed run`).toBeTruthy()
        expect(kept.carried_from_item_id).toBeNull()
      }
      // Eight items in the household now: five on the record, three on the
      // next list.
      expect(await countAsOwner('shopping_items', 'where household_id = $1', [hA.id])).toBe(8)
    })

    it('closed_at and the new run’s opened_at are the same transaction-start clock reading — now(), never clock_timestamp()', async () => {
      // What this pins: both stamps come from `now()`, which is the
      // transaction's START time, so two stamps written in one transaction are
      // equal to the microsecond and two written in separate transactions
      // could not be. It does NOT prove atomicity — a plpgsql body invoked
      // through SELECT cannot commit halfway whatever this file says, so no
      // mutation of 0033 could split the close from the open. The atomicity
      // argument is the migration header's; what a mutation can reach here is
      // `now()` → `clock_timestamp()` on either stamp (0033's close, or
      // 0032's `opened_at` default).
      const { rows } = await db.query(
        `select closed.closed_at = opened.opened_at as same
           from public.shopping_runs closed, public.shopping_runs opened
          where closed.id = $1 and opened.id = $2`,
        [runA.id, opened.id],
      )
      expect(rows[0].same).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the RUN is the argument, so a stale screen cannot finish the fresh run
  // -------------------------------------------------------------------------

  describe('AC 2 — a second phone finishing the run it still shows is refused and writes nothing', () => {
    it('two calls back to back: the second raises "run already closed", one open run remains, no item is carried twice', async () => {
      const first = await finishAs(person, runA.id)
      expect(first.error).toBeNull()
      const before = await snapshot()

      // The housemate's phone, still showing the run `person` just finished.
      const second = await finishAs(housemate, runA.id)
      expect(second.ok).toBe(false)
      expect(second.error).toMatch(/run already closed/)

      expect(await snapshot()).toEqual(before)
      expect(await openRunsOf(listA.id)).toHaveLength(1)
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listA.id])).toBe(2)
      for (const original of unbought) {
        expect(
          await countAsOwner('shopping_items', 'where carried_from_item_id = $1', [original.id]),
          `${original.name} carried more than once`,
        ).toBe(1)
      }
      expect(await countAsOwner('shopping_items', 'where run_id = $1', [first.value.id])).toBe(3)
    })

    it('CONTROL: a phone that HAS seen the fresh run may finish that one — the refusal is about the run named, not the list', async () => {
      const first = await finishAs(person, runA.id)
      const third = await finishAs(housemate, first.value.id)
      expect(third.error).toBeNull()
      expect(third.value.id).not.toBe(first.value.id)
      expect(await openRunsOf(listA.id)).toHaveLength(1)
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listA.id])).toBe(3)
      // The three still-unbought items ride forward again, each pointing at
      // the copy on the run just closed — a chain, one link per trip.
      const carriedAgain = await itemsOn(third.value.id)
      expect(carriedAgain.map((c) => c.name).sort()).toEqual(['Bread', 'Eggs', 'Milk'])
      const secondRunIds = new Set((await itemsOn(first.value.id)).map((i) => i.id))
      for (const c of carriedAgain) expect(secondRunIds.has(c.carried_from_item_id)).toBe(true)
    })

    it('a run closed by direct SQL is refused the same way — the guard reads the row, not who closed it', async () => {
      await db.query(
        'update public.shopping_runs set closed_at = now(), closed_by_member_id = $2 where id = $1',
        [runA.id, housemateInA],
      )
      const before = await snapshot()
      const refused = await finishAs(person, runA.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/run already closed/)
      expect(await snapshot()).toEqual(before)
    })
  })

  // -------------------------------------------------------------------------
  // AC 3 — an empty next run, and the household boundary
  // -------------------------------------------------------------------------

  describe('AC 3 — nothing to carry, and the wrong household', () => {
    it('with no unbought items, the run still closes and the new run is empty', async () => {
      for (const item of unbought) await buyAs(person, item.id)
      expect(await countAsOwner('shopping_items', 'where run_id = $1 and purchased_at is null', [runA.id])).toBe(0)

      const result = await finishAs(person, runA.id)
      expect(result.error).toBeNull()
      expect(result.value.closed_at).toBeNull()
      expect(await itemsOn(result.value.id)).toEqual([])
      const { rows } = await db.query('select closed_at, closed_by_member_id from public.shopping_runs where id = $1', [
        runA.id,
      ])
      expect(rows[0].closed_at).not.toBeNull()
      expect(rows[0].closed_by_member_id).toBe(memberInA)
      expect(await countAsOwner('shopping_items', 'where run_id = $1', [runA.id])).toBe(5)
    })

    it('a run in another household raises "no such run in your household" and no row changes', async () => {
      const before = await snapshot()
      // `housemate` is in A only; `runB` is B's.
      const refused = await finishAs(housemate, runB.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such run in your household/)
      expect(await snapshot()).toEqual(before)
      expect(await openRunsOf(listB.id)).toHaveLength(1)
      expect(await openRunsOf(listB.id).then((r) => r[0].id)).toBe(runB.id)
    })

    it('a run id that names nothing gets the SAME sentence, so which of the two you hit is free information', async () => {
      const refused = await finishAs(person, NOBODY)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/no such run in your household/)
    })

    it('a stranger in no household is refused with that sentence too, and a caller with no session with "not authenticated"', async () => {
      const before = await snapshot()
      const asStranger = await finishAs(stranger, runA.id)
      expect(asStranger.ok).toBe(false)
      expect(asStranger.error).toMatch(/no such run in your household/)

      const asNobody = await finishAs(null, runA.id)
      expect(asNobody.ok).toBe(false)
      expect(asNobody.error).toMatch(/not authenticated/)
      expect(await snapshot()).toEqual(before)
    })

    it('CONTROL: the same run finished by a member of ITS household succeeds — the refusal above is the boundary, not the fixture', async () => {
      const accepted = await finishAs(outsider, runB.id)
      expect(accepted.error).toBeNull()
      expect(accepted.value.list_id).toBe(listB.id)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — the RPC is the only writer; the clock is the source
  // -------------------------------------------------------------------------

  describe('AC 4 — no client grant reaches a run, and the signature carries no clock', () => {
    const columnGrants = async (table, privilege) => {
      const { rows } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = $1
            and grantee = 'authenticated' and privilege_type = $2
          order by column_name`,
        [table, privilege],
      )
      return rows.map((r) => r.column_name)
    }
    const tableGrants = async (table) => {
      const { rows } = await db.query(
        `select privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = $1 and grantee = 'authenticated'
          order by privilege_type`,
        [table],
      )
      return rows.map((r) => r.privilege_type)
    }

    it('shopping_runs still has NO client insert or update grant of any kind — select on its six columns is everything', async () => {
      expect(await columnGrants('shopping_runs', 'INSERT')).toEqual([])
      expect(await columnGrants('shopping_runs', 'UPDATE')).toEqual([])
      expect(await tableGrants('shopping_runs')).toEqual([])
      expect(await columnGrants('shopping_runs', 'SELECT')).toEqual([
        'closed_at',
        'closed_by_member_id',
        'household_id',
        'id',
        'list_id',
        'opened_at',
      ])
      // And nothing on shopping_items changed either: no insert grant, so the
      // rollover is the RPC's alone.
      expect(await columnGrants('shopping_items', 'INSERT')).toEqual([])
      expect(await tableGrants('shopping_items')).toEqual(['DELETE'])
    })

    it('BEHAVIOUR: a client writing closed_at, closed_by_member_id or a new run row is refused by the grant', async () => {
      for (const [sql, params] of [
        ['update public.shopping_runs set closed_at = now() where id = $1', [runA.id]],
        ['update public.shopping_runs set closed_by_member_id = $2 where id = $1', [runA.id, memberInA]],
        ['insert into public.shopping_runs (list_id, household_id) select $1, $2 where false', [listA.id, hA.id]],
      ]) {
        const refused = await attempt(() => asDevice(db, person, () => db.query(sql, params)))
        expect(refused.ok, sql).toBe(false)
        expect(refused.error, sql).toMatch(/permission denied/i)
      }
    })

    it('the signature is exactly (run_id uuid) — no timestamp, no member, no list', async () => {
      const { rows } = await db.query(
        `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'finish_shopping_run'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].args).toBe('run_id uuid')
      expect(rows[0].args).not.toMatch(/timestamp|member|list/)
      // AC 1's other two words: security definer, with the search path emptied.
      // The catalog keeps the empty string QUOTED (`search_path=""`), which is
      // how `set search_path = ''` reads back — measured, not guessed.
      expect(rows[0].prosecdef).toBe(true)
      expect(rows[0].proconfig).toEqual(['search_path=""'])
    })

    it('authenticated may execute it; anon and PUBLIC may not', async () => {
      const { rows } = await db.query(
        `select has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('service_role', $1, 'execute') as service`,
        [FN],
      )
      expect(rows[0]).toEqual({ auth: true, anon: false, service: false })
      // PUBLIC: no grantee at all holds it beyond the owner and authenticated.
      const { rows: acl } = await db.query(
        `select coalesce(array_to_string(p.proacl, ','), '') as acl
           from pg_proc p where p.oid = $1::regprocedure`,
        [FN],
      )
      expect(acl[0].acl).toMatch(/authenticated=X/)
      expect(acl[0].acl).not.toMatch(/(^|,)=X/)
    })

    it('POSITIVE CONTROL: the stamps the finish wrote are the database’s — closed_at is within the clock window and not a value the caller sent', async () => {
      const { value: opened } = await finishAs(person, runA.id)
      const { rows } = await db.query(
        `select closed_at <= now() and closed_at > now() - interval '1 minute' as recent_close,
                (select opened_at <= now() and opened_at > now() - interval '1 minute'
                   from public.shopping_runs where id = $2) as recent_open
           from public.shopping_runs where id = $1`,
        [runA.id, opened.id],
      )
      expect(rows[0]).toEqual({ recent_close: true, recent_open: true })
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — the one-open-run index stands behind the function
  // -------------------------------------------------------------------------

  describe('AC 5 — the partial unique index from 0032 is what stops a second open run', () => {
    it('after a finish, a second open run for the list by direct SQL is refused by shopping_runs_one_open_per_list', async () => {
      await finishAs(person, runA.id)
      const refused = await attempt(() =>
        db.query('insert into public.shopping_runs (list_id, household_id) values ($1, $2)', [listA.id, hA.id]),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/shopping_runs_one_open_per_list/)
      expect(await openRunsOf(listA.id)).toHaveLength(1)
      expect(await countAsOwner('shopping_runs', 'where list_id = $1', [listA.id])).toBe(2)
    })

    it('the index is partial on closed_at IS NULL, so the closed run and the open one coexist on the list', async () => {
      const { rows } = await db.query(
        `select pg_get_indexdef(i.indexrelid) as def
           from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relname = 'shopping_runs_one_open_per_list'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].def).toMatch(/UNIQUE/)
      expect(rows[0].def).toMatch(/WHERE \(closed_at IS NULL\)/)
    })
  })

  // -------------------------------------------------------------------------
  // The lock discipline — the one observable a single connection has
  //
  // pglite cannot interleave two transactions, so the effect of `for update`
  // and `for key share` is observable by NO test here; #356 holds that half
  // on the live project. What a single connection CAN read is the catalog:
  // which lock each body takes and in which order. These assert the text of
  // the four bodies, so the clauses cannot be dropped silently — the
  // fan-out's finding that `0032`'s writers raced the finish is exactly a
  // missing clause, and a missing clause reddens nothing behavioural.
  // -------------------------------------------------------------------------

  describe('the lock discipline, read off the catalog because one connection cannot observe it', () => {
    const bodyOf = async (signature) => {
      const { rows } = await db.query('select pg_get_functiondef($1::regprocedure) as def', [signature])
      expect(rows).toHaveLength(1)
      return rows[0].def
    }

    // THE CLAUSE, NOT ITS COMMENT. `pg_get_functiondef` returns the body
    // verbatim, comments included, and the bodies name their own clauses in
    // prose ("#354: `for key share of r`. A finish in flight …"). A first
    // draft matched `/for key share of r/` and the mutation dropping the add's
    // clause reddened 0 — the assertion was satisfied by the sentence about
    // the clause (cairn: a guard that reads source must survive its own docs).
    // Every match below is anchored on the clause's terminator `;`, which no
    // comment carries.
    const RUN_FOR_UPDATE = /for update of r;/
    const RUN_KEY_SHARE = /for key share of r;/
    const ITEM_FOR_UPDATE = /for update of i;/

    it('finish_shopping_run locks the run FOR UPDATE and the carried source rows FOR UPDATE', async () => {
      const def = await bodyOf(FN)
      expect(def).toMatch(RUN_FOR_UPDATE)
      // The carry's source lock: a purchase or a remove already holding an
      // item makes the copy wait and re-check, rather than copying a row that
      // is bought or referencing one that is gone.
      expect(def).toMatch(/and i\.purchased_at is null\s+for update of i;/)
    })

    it('the three 0032 item writers now take the run FOR KEY SHARE before they read closed_at', async () => {
      for (const signature of [
        'public.add_shopping_item(uuid, text, text)',
        'public.purchase_shopping_item(uuid)',
        'public.unpurchase_shopping_item(uuid)',
      ]) {
        const def = await bodyOf(signature)
        expect(def, signature).toMatch(RUN_KEY_SHARE)
      }
    })

    it('the lock ORDER is run-then-item in every writer, so a finish and a tick cannot deadlock', async () => {
      // A purchase that locked the item first and the run second would wait
      // on a finish holding the run while the finish waited on the item.
      // Position in the body is the honest proxy for order of execution here:
      // plpgsql runs its statements top to bottom.
      for (const signature of ['public.purchase_shopping_item(uuid)', 'public.unpurchase_shopping_item(uuid)']) {
        const def = await bodyOf(signature)
        const runLock = def.search(RUN_KEY_SHARE)
        const itemLock = def.search(ITEM_FOR_UPDATE)
        expect(runLock, `${signature} run lock present`).toBeGreaterThan(-1)
        expect(itemLock, `${signature} item lock present`).toBeGreaterThan(-1)
        expect(runLock, `${signature} locks the run before the item`).toBeLessThan(itemLock)
      }
      const finish = await bodyOf(FN)
      expect(finish.search(ITEM_FOR_UPDATE)).toBeGreaterThan(-1)
      expect(finish.search(RUN_FOR_UPDATE)).toBeLessThan(finish.search(ITEM_FOR_UPDATE))
    })

    it('POSITIVE CONTROL: the clause regexes do not match the bodies’ own comments', async () => {
      // The body of the add names its clause in prose; strip every line that
      // is SQL and what survives must match none of the three.
      const def = await bodyOf('public.add_shopping_item(uuid, text, text)')
      const commentsOnly = def
        .split('\n')
        .filter((line) => line.trim().startsWith('--'))
        .join('\n')
      expect(commentsOnly).toMatch(/for key share/) // the sentence is there …
      expect(commentsOnly).not.toMatch(RUN_KEY_SHARE) // … and the regex cannot see it
      expect(commentsOnly).not.toMatch(RUN_FOR_UPDATE)
      expect(commentsOnly).not.toMatch(ITEM_FOR_UPDATE)
    })

    it('the replaced writers keep their 0032 signatures, privileges and refusals — a true replace, no overload', async () => {
      const { rows } = await db.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as args,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('add_shopping_item', 'purchase_shopping_item', 'unpurchase_shopping_item')
          order by p.proname`,
      )
      expect(rows).toEqual([
        { proname: 'add_shopping_item', args: 'run uuid, name text, note text', auth: true, anon: false },
        { proname: 'purchase_shopping_item', args: 'item uuid', auth: true, anon: false },
        { proname: 'unpurchase_shopping_item', args: 'item uuid', auth: true, anon: false },
      ])
      // And the sequential behaviour is unchanged: the fixture's two
      // purchases went through the replaced body in beforeEach, a tick on a
      // closed run is still refused by name, and a second tick still loses.
      await finishAs(person, runA.id)
      const late = await buyAs(person, unbought[0].id)
      expect(late.ok).toBe(false)
      expect(late.error).toMatch(/run already closed/)
    })

    it('HAZARD, stated: re-pasting 0032 on top puts the three UNLOCKED bodies back — the direction cairn records for 0004 over 0007', async () => {
      await db.exec(migrationSql('0032_shopping_lists_runs_items.sql'))
      const def = await bodyOf('public.purchase_shopping_item(uuid)')
      expect(def).not.toMatch(RUN_KEY_SHARE)
      // And re-applying THIS file restores them — the re-paste order that is
      // safe is the one that ends on 0033.
      await db.exec(migrationSql(THIS_FILE))
      expect(await bodyOf('public.purchase_shopping_item(uuid)')).toMatch(RUN_KEY_SHARE)
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 — the file applies twice, and leaves what it declares
  // -------------------------------------------------------------------------

  describe('AC 6 — a second apply', () => {
    it('applies a second time without error and leaves ONE function at the declared signature, privileges and comment', async () => {
      // Asserted against what the file DECLARES, never against a snapshot
      // taken before the re-apply: a database built THROUGH this file already
      // holds everything it grants, so before-equals-after would be true
      // whatever the file said (cairn: a snapshot around a re-run cannot see
      // the file it brackets).
      const second = await attempt(() => db.exec(migrationSql(THIS_FILE)))
      expect(second.error).toBeNull()

      const { rows } = await db.query(
        `select count(*)::int as n,
                min(pg_get_function_identity_arguments(p.oid)) as args,
                bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as auth,
                bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon,
                min(obj_description(p.oid, 'pg_proc')) as comment
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'finish_shopping_run'`,
      )
      expect(rows[0].n).toBe(1)
      expect(rows[0].args).toBe('run_id uuid')
      expect(rows[0].auth).toBe(true)
      expect(rows[0].anon).toBe(false)
      expect(rows[0].comment).toMatch(/Story #354/)

      // And the function still works after the re-apply — the fixture's run
      // finishes and carries three.
      const result = await finishAs(person, runA.id)
      expect(result.error).toBeNull()
      expect(await itemsOn(result.value.id)).toHaveLength(3)
    })
  })
})
