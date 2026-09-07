// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #360 — `archive_shopping_list` and `unarchive_shopping_list`: put a list away
// so the picker stops drawing it, without losing a single row, against a real
// Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — this harness BUILDS the schema it certifies, so a green run says
// nothing about the hosted project. `0035` is unapplied there until somebody
// runs `npm run migrate:live`, and `npm run check:live` is the authority on
// that; the two entries in `LIVE_RPCS` are red on purpose until then.
//
// WHAT THIS FILE CANNOT SAY. Two things, both stated up front:
//
//   * the CONTENDED form of the archive's lock. pglite is one connection, so an
//     add that arrives while an archive holds the run row cannot be run here —
//     what is proved is the sequential form (the count is refused, the stamp is
//     refused, nothing is written) and the presence of the clause in the
//     catalog. `npm run prove:finish-race` is where a contended claim about this
//     schema is proved, and it does not carry an archive phase;
//   * the `anon` half of the privilege statements. `revoke ... from public,
//     anon` is `0034`'s measured idiom, and putting `from public` alone back
//     reddens NOTHING here — the PUBLIC default is all this harness's `anon`
//     holds, while the live project holds more. cairn records the shape in
//     `the-harness-cannot-catch-what-the-platform-granted`; the instrument for
//     that half is `npm run probe:live-grants` against the real project.
//
// THE FIXTURE IS #354's, trimmed: one auth user with a claimed member row in
// TWO households, a housemate sharing household A, and a list with an open run
// in each. The two-household shape is what makes "in the caller's household" a
// real assertion rather than a sentence.
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

const THIS_FILE = '0035_archive_shopping_list.sql'
const ARCHIVE = 'public.archive_shopping_list(uuid)'
const UNARCHIVE = 'public.unarchive_shopping_list(uuid)'
const NOBODY = '00000000-0000-0000-0000-000000000000'

describe('#360 — archiving a shopping list, run against a real Postgres', () => {
  let db
  let person // ONE auth user, in both households
  let housemate // a second member of household A — "the other phone"
  let outsider // creates both households; a member of both
  let hA, hB
  let memberInA
  let listA, listB
  let runA

  const rpc = (device, sql, params) =>
    attempt(() => asDevice(db, device, async () => (await db.query(sql, params)).rows[0]))

  const archiveAs = (device, listId) =>
    rpc(device, 'select * from public.archive_shopping_list($1)', [listId])

  const unarchiveAs = (device, listId) =>
    rpc(device, 'select * from public.unarchive_shopping_list($1)', [listId])

  const addAs = (device, runId, name, note = null) =>
    rpc(device, 'select * from public.add_shopping_item($1, $2, $3)', [runId, name, note])

  const buyAs = (device, itemId) =>
    rpc(device, 'select * from public.purchase_shopping_item($1)', [itemId])

  const removeAs = (device, itemId) =>
    rpc(device, 'select public.remove_shopping_item($1)', [itemId])

  const finishAs = (device, runId) =>
    rpc(device, 'select * from public.finish_shopping_run($1)', [runId])

  const listById = async (listId) => {
    const { rows } = await db.query('select * from public.shopping_lists where id = $1', [listId])
    return rows[0]
  }

  const openRunsOf = async (listId) => {
    const { rows } = await db.query(
      'select * from public.shopping_runs where list_id = $1 and closed_at is null',
      [listId],
    )
    return rows
  }

  const bodyOf = async (signature) => {
    const { rows } = await db.query('select pg_get_functiondef($1::regprocedure) as def', [signature])
    return rows[0].def
  }

  /** Every row of all three tables, for a "nothing changed" comparison. */
  const snapshot = async () => {
    const { rows: lists } = await db.query('select * from public.shopping_lists order by id')
    const { rows: runs } = await db.query('select * from public.shopping_runs order by id')
    const { rows: items } = await db.query('select * from public.shopping_items order by id')
    return { lists, runs, items }
  }

  beforeEach(async () => {
    db = await freshDatabase()
    person = await newDevice(db)
    housemate = await newDevice(db)
    outsider = await newDevice(db)

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
    const memberInB = await seedMember(hB.id, 'Placeholder Two')
    const housemateInA = await seedMember(hA.id, 'Housemate')

    await provisionMember(db, memberInA, person)
    await provisionMember(db, memberInB, person)
    await provisionMember(db, housemateInA, housemate)

    listA = (await rpc(person, 'select * from public.create_shopping_list($1, $2)', [hA.id, 'Hardware']))
      .value
    listB = (await rpc(outsider, 'select * from public.create_shopping_list($1, $2)', [hB.id, 'Hardware']))
      .value
    ;[runA] = await openRunsOf(listA.id)
  })

  it('PREMISE: a list in each household, each with one empty open run, neither archived', async () => {
    expect(listA.archived_at).toBeNull()
    expect(listB.archived_at).toBeNull()
    expect(await openRunsOf(listA.id)).toHaveLength(1)
    const { rows } = await db.query('select count(*)::int as n from public.shopping_items')
    expect(rows[0].n).toBe(0)
  })

  // -------------------------------------------------------------------------
  // AC 1 — the column, the stamp, and who may write it
  // -------------------------------------------------------------------------

  describe('AC 1 — the column and the two RPCs', () => {
    it('shopping_lists carries archived_at, nullable timestamptz with no default', async () => {
      const { rows } = await db.query(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'shopping_lists'
            and column_name = 'archived_at'`,
      )
      expect(rows).toHaveLength(1)
      // No default is the point: null IS the active state, so no existing row
      // had to be touched and no backfill could get it wrong.
      expect(rows[0]).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      })
    })

    it('the client may READ the stamp and may not WRITE it — the pairing SHOPPING_LIST_COLUMNS rests on', async () => {
      const { rows } = await db.query(
        `select privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'shopping_lists'
            and column_name = 'archived_at' and grantee = 'authenticated'
          order by privilege_type`,
      )
      expect(rows.map((r) => r.privilege_type)).toEqual(['SELECT'])
      // And `name` is still the ONLY column the client may update — the whole
      // reason archiving had to be an RPC rather than a patch.
      const { rows: writable } = await db.query(
        `select column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'shopping_lists'
            and grantee = 'authenticated' and privilege_type = 'UPDATE'
          order by column_name`,
      )
      expect(writable.map((r) => r.column_name)).toEqual(['name'])
    })

    it('archiving stamps archived_at from the database clock and returns the list', async () => {
      const result = await archiveAs(person, listA.id)
      expect(result.error).toBeNull()
      expect(result.value.id).toBe(listA.id)
      expect(result.value.archived_at).toBeTruthy()

      const { rows } = await db.query(
        `select archived_at is not null as stamped,
                archived_at <= now() and archived_at > now() - interval '1 minute' as recent
           from public.shopping_lists where id = $1`,
        [listA.id],
      )
      expect(rows[0]).toEqual({ stamped: true, recent: true })
    })

    it('archiving CLOSES nothing and DELETES nothing — the run, its history and the rows all stay', async () => {
      // The epic's rule, asserted rather than described: an archive is a stamp
      // on one column. Everything else about the list is compared whole.
      const item = (await addAs(person, runA.id, 'Screws')).value
      await buyAs(person, item.id)
      const finished = await finishAs(person, runA.id)
      const [emptyRun] = await openRunsOf(listA.id)

      const before = await snapshot()
      const result = await archiveAs(person, listA.id)
      expect(result.error).toBeNull()
      const after = await snapshot()

      expect(after.runs).toEqual(before.runs)
      expect(after.items).toEqual(before.items)
      // Two runs: the one the shop finished, and the empty one it opened.
      expect(after.runs.filter((r) => r.list_id === listA.id)).toHaveLength(2)
      expect((await openRunsOf(listA.id)).map((r) => r.id)).toEqual([emptyRun.id])
      expect(emptyRun.id).toBe(finished.value.id)
      // The bought item stayed on the run that was CLOSED — `0033` carries the
      // unbought ones forward and leaves the record of the trip alone — and the
      // archive did not move it either.
      expect(after.items.find((i) => i.id === item.id).run_id).toBe(runA.id)
      // The list row moved on exactly one column.
      const listBefore = before.lists.find((l) => l.id === listA.id)
      const listAfter = after.lists.find((l) => l.id === listA.id)
      expect({ ...listAfter, archived_at: null }).toEqual({ ...listBefore, archived_at: null })
      expect(listBefore.archived_at).toBeNull()
      expect(listAfter.archived_at).toBeTruthy()
    })

    it('unarchiving clears the stamp and moves nothing else', async () => {
      await archiveAs(person, listA.id)
      const before = await snapshot()
      const result = await unarchiveAs(person, listA.id)
      expect(result.error).toBeNull()
      expect(result.value.archived_at).toBeNull()
      expect(await listById(listA.id)).toEqual({
        ...before.lists.find((l) => l.id === listA.id),
        archived_at: null,
      })
    })

    it('any member may archive and unarchive — the epic’s decision 2, no organizer gate', async () => {
      // `housemate` is not the organizer of household A and did not create the
      // list. Both calls are theirs.
      expect((await archiveAs(housemate, listA.id)).error).toBeNull()
      expect((await unarchiveAs(housemate, listA.id)).error).toBeNull()
    })

    it('a list in another household is refused with the SAME sentence a nonexistent id gets', async () => {
      // `complete_chore`'s rule, kept by every function in this feature: which
      // of the two you hit is free information about somebody else's data.
      //
      // THE CALLER HERE IS `housemate`, NOT `person`, and the choice is the
      // test. `person` holds a claimed member row in BOTH households — that is
      // the fixture's whole point elsewhere in this file — so `person` naming
      // household B's list is a member naming their own list, and this test
      // passed vacuously against a function with no membership check at all
      // until it was run. `housemate` is in household A alone.
      const other = await archiveAs(housemate, listB.id)
      const missing = await archiveAs(housemate, NOBODY)
      expect(other.ok).toBe(false)
      expect(other.error).toMatch(/no such list in your household/)
      expect(missing.error).toMatch(/no such list in your household/)
      expect(await listById(listB.id)).toEqual({ ...listB, archived_at: null })

      const otherBack = await unarchiveAs(housemate, listB.id)
      expect(otherBack.error).toMatch(/no such list in your household/)
      expect((await unarchiveAs(housemate, NOBODY)).error).toMatch(/no such list in your household/)
    })

    it('CONTROL: the member of BOTH households may archive either one — the refusal is membership, not identity', async () => {
      // The positive half of the test above, and the reason it needs one:
      // "refused" is only evidence about a membership check if somebody who IS
      // a member is allowed. `person` holds a row in each household.
      expect((await archiveAs(person, listA.id)).error).toBeNull()
      expect((await archiveAs(person, listB.id)).error).toBeNull()
    })

    it('an archive over an archived list, and an unarchive over an active one, are refused by name', async () => {
      await archiveAs(person, listA.id)
      const twice = await archiveAs(housemate, listA.id)
      expect(twice.ok).toBe(false)
      expect(twice.error).toMatch(/this list is archived/)

      await unarchiveAs(person, listA.id)
      const backTwice = await unarchiveAs(housemate, listA.id)
      expect(backTwice.ok).toBe(false)
      expect(backTwice.error).toMatch(/this list is not archived/)
    })
  })

  // -------------------------------------------------------------------------
  // AC 1 — the refusal, and the owner's stricter rule for it
  // -------------------------------------------------------------------------

  describe('AC 1 — an archive is refused while the open run holds ANY item', () => {
    it('refuses over an UNBOUGHT item, with the sentence naming both ways out, and writes nothing', async () => {
      await addAs(person, runA.id, 'Screws')
      const before = await snapshot()
      const refused = await archiveAs(person, listA.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/finish or clear this run first/)
      expect(await snapshot()).toEqual(before)
      expect((await listById(listA.id)).archived_at).toBeNull()
    })

    it('refuses over a BOUGHT item too — the owner’s decision of 2026-09-06, and the half AC 1’s wording did not cover', async () => {
      // The story's AC said "unbought items" and its own rationale called the
      // archived list's run "empty"; the owner took the stricter reading at
      // pickup. This is the case the two readings disagree about, and it is
      // asserted rather than left to the prose: under the looser rule this
      // bought row would sit on an open run of an archived list, reachable from
      // no screen — history is `closed_at is not null`, and an archived list
      // draws its finished runs only.
      const item = (await addAs(person, runA.id, 'Screws')).value
      await buyAs(person, item.id)
      const refused = await archiveAs(person, listA.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/finish or clear this run first/)
      expect((await listById(listA.id)).archived_at).toBeNull()
    })

    it('and is allowed once the run is FINISHED — the first way out the sentence names', async () => {
      const item = (await addAs(person, runA.id, 'Screws')).value
      await buyAs(person, item.id)
      expect((await archiveAs(person, listA.id)).ok).toBe(false)

      const finished = await finishAs(person, runA.id)
      expect(finished.error).toBeNull()
      expect((await archiveAs(person, listA.id)).error).toBeNull()
      // And the trip that was finished is still there to read.
      const { rows } = await db.query(
        'select count(*)::int as n from public.shopping_items where run_id = $1',
        [runA.id],
      )
      expect(rows[0].n).toBe(1)
    })

    it('and is allowed once the run is CLEARED — the second way out', async () => {
      const item = (await addAs(person, runA.id, 'Screws')).value
      expect((await archiveAs(person, listA.id)).ok).toBe(false)

      expect((await removeAs(person, item.id)).error).toBeNull()
      expect((await archiveAs(person, listA.id)).error).toBeNull()
      // One run still, and it is empty rather than closed.
      expect(await openRunsOf(listA.id)).toHaveLength(1)
    })

    it('the count is the OPEN run’s alone — a finished run full of items never blocks an archive', async () => {
      // The property that makes archiving possible at all: a household that
      // shops from a list for a year has a year of closed runs, and every one
      // of them holds rows. Only the open one is asked about.
      for (const name of ['Screws', 'Nails', 'Glue']) {
        const made = await addAs(person, runA.id, name)
        await buyAs(person, made.value.id)
      }
      await finishAs(person, runA.id)
      const { rows } = await db.query(
        'select count(*)::int as n from public.shopping_items where run_id = $1',
        [runA.id],
      )
      expect(rows[0].n).toBe(3)
      expect((await archiveAs(person, listA.id)).error).toBeNull()
    })

    it('a list with NO open run archives — a state nothing writes, which the schema still admits', async () => {
      await db.query('update public.shopping_runs set closed_at = now() where list_id = $1', [listA.id])
      expect(await openRunsOf(listA.id)).toHaveLength(0)
      expect((await archiveAs(person, listA.id)).error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the two writers that can reach an archived list
  // -------------------------------------------------------------------------

  describe('AC 2 — add and finish are refused on an archived list, and work again when it comes back', () => {
    beforeEach(async () => {
      expect((await archiveAs(person, listA.id)).error).toBeNull()
    })

    it('add_shopping_item raises "this list is archived" and writes nothing', async () => {
      const before = await snapshot()
      const refused = await addAs(person, runA.id, 'Screws')
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/this list is archived/)
      expect(await snapshot()).toEqual(before)
    })

    it('finish_shopping_run raises "this list is archived" — so an archived list can never grow a fresh run', async () => {
      // The story's own rationale for replacing this function. Without the
      // check a stale screen finishing an archived list would CLOSE its empty
      // run and OPEN another, so a list nobody is shopping from would collect a
      // new run every time somebody tapped.
      const before = await snapshot()
      const refused = await finishAs(person, runA.id)
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/this list is archived/)
      expect(await snapshot()).toEqual(before)
      expect(await openRunsOf(listA.id)).toHaveLength(1)
    })

    it('the run’s OWN state is still reported first — a closed run says so, archived or not', async () => {
      // Ordering inside the body, asserted where it is observable: the archive
      // check sits under the closed check, so a call naming a run that is
      // closed reads the fact about the run it named rather than a fact about
      // the list it belongs to.
      await unarchiveAs(person, listA.id)
      const finished = await finishAs(person, runA.id)
      expect(finished.error).toBeNull()
      await archiveAs(person, finished.value.list_id)

      const late = await addAs(person, runA.id, 'Screws')
      expect(late.error).toMatch(/run already closed/)
      expect(late.error).not.toMatch(/this list is archived/)
    })

    it('BOTH work again after an unarchive — the refusal is the stamp, not a one-way door', async () => {
      expect((await unarchiveAs(person, listA.id)).error).toBeNull()

      const added = await addAs(person, runA.id, 'Screws')
      expect(added.error).toBeNull()
      const finished = await finishAs(person, runA.id)
      expect(finished.error).toBeNull()
      // And the item rode forward, so the replaced body is `0033`'s in every
      // other respect: unbought, carried, pointing at its original.
      const { rows } = await db.query(
        'select name, carried_from_item_id from public.shopping_items where run_id = $1',
        [finished.value.id],
      )
      expect(rows).toEqual([{ name: 'Screws', carried_from_item_id: added.value.id }])
    })

    it('the OTHER household’s list is untouched by any of it', async () => {
      expect((await listById(listB.id)).archived_at).toBeNull()
      const [runB] = await openRunsOf(listB.id)
      expect((await addAs(outsider, runB.id, 'Screws')).error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — the replaces are TRUE replaces, and the locks are still there
  // -------------------------------------------------------------------------

  describe('AC 2 — the catalog: signatures, privileges, locks', () => {
    const RUN_FOR_UPDATE = /for update of r;/
    const RUN_KEY_SHARE = /for key share of r;/
    // #360 — the list's own row. The clauses carry no alias qualifier (the
    // statement locks a single table), so they are anchored on the FROM clause
    // above them to keep them off the run's.
    const LIST_FOR_UPDATE = /from public\.shopping_lists l\s+where l\.id = target\.id\s+for update;/
    const LIST_KEY_SHARE = /from public\.shopping_lists l\s+where l\.id = target_list\s+for key share;/

    it('the two replaced functions keep their exact signatures — ONE row each, no overload', async () => {
      // The failure this prevents is `PGRST203`: a second
      // `add_shopping_item(run, name, note)` with any argument renamed would be
      // an OVERLOAD, and PostgREST resolves by the SET of argument names, so
      // every call from the client would become ambiguous.
      const { rows } = await db.query(
        `select p.proname, count(*)::int as n,
                min(pg_get_function_identity_arguments(p.oid)) as args,
                bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as auth,
                bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('add_shopping_item', 'finish_shopping_run')
          group by p.proname order by p.proname`,
      )
      expect(rows).toEqual([
        { proname: 'add_shopping_item', n: 1, args: 'run uuid, name text, note text', auth: true, anon: false },
        { proname: 'finish_shopping_run', n: 1, args: 'run_id uuid', auth: true, anon: false },
      ])
    })

    it('the two NEW functions are definer, search_path-empty, executable by authenticated and not by anon', async () => {
      const { rows } = await db.query(
        `select p.proname, pg_get_function_identity_arguments(p.oid) as args,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                p.prosecdef, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('archive_shopping_list', 'unarchive_shopping_list')
          order by p.proname`,
      )
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row, row.proname).toMatchObject({ args: 'list uuid', auth: true, anon: false, prosecdef: true })
        // `set search_path = ''`, which the catalog stores quoted.
        expect(row.proconfig, row.proname).toEqual(['search_path=""'])
      }
      // The anon half is the one this harness cannot really speak to — see the
      // file header, and `0034`'s measured 0-of-1. `probe:live-grants` owns it.
    })

    it('the archive locks the LIST row FOR UPDATE, and locks no run at all', async () => {
      // THE ASSERTION THIS STORY GOT WRONG THE FIRST TIME, and what changed is
      // worth more than what is true now. The first draft locked the list's
      // open run through `closed_at is null … for update of r`, and every test
      // in this file passed: the run WAS locked, in the mode a finish takes,
      // and the count did run under it. What no test here could see is that the
      // predicate is MUTABLE — a finish committing during the lock wait retires
      // the matched row, READ COMMITTED's recheck drops it, the successor run
      // is outside the statement's snapshot, and the whole check is skipped.
      // Found by review (#360's fan-out), not by this file, and unreachable
      // here by construction: pglite is one connection.
      //
      // So the lock is now on the row whose identity cannot change. A run lock
      // in this body would be the old defect back.
      const def = await bodyOf(ARCHIVE)
      expect(def).toMatch(LIST_FOR_UPDATE)
      expect(def, 'a run lock here is the reverted defect').not.toMatch(RUN_FOR_UPDATE)
      expect(def).not.toMatch(RUN_KEY_SHARE)
      // And the count reaches the run THROUGH the list, so a list whose open
      // run changed under us is still counted correctly.
      expect(def).toMatch(/join public\.shopping_runs r on r\.id = i\.run_id/)

      // The unarchive deliberately takes no lock at all — it only ever makes
      // refused writes legal, so every interleaving of it is already correct.
      const back = await bodyOf(UNARCHIVE)
      expect(back).not.toMatch(LIST_FOR_UPDATE)
      expect(back).not.toMatch(RUN_FOR_UPDATE)
      expect(back).not.toMatch(RUN_KEY_SHARE)
    })

    it('both replaced writers take the LIST for key share FIRST, then the run, then read the stamp', async () => {
      // Position is the honest proxy for order of execution: plpgsql runs its
      // statements top to bottom. Three things in one order, each load-bearing
      // — the list lock is what an archive conflicts with, the run lock is
      // #354's, and the stamp must be read BELOW both or it comes from a
      // snapshot taken before whatever the call waited for, which is exactly
      // the failure `0033` closed for `closed_at`.
      for (const signature of [
        'public.add_shopping_item(uuid, text, text)',
        'public.finish_shopping_run(uuid)',
      ]) {
        const def = await bodyOf(signature)
        const listLock = def.search(LIST_KEY_SHARE)
        const runLock = def.search(signature.includes('finish') ? RUN_FOR_UPDATE : RUN_KEY_SHARE)
        const archiveRead = def.search(/select l\.archived_at into list_archived_at/)
        expect(listLock, `${signature} list lock present`).toBeGreaterThan(-1)
        expect(runLock, `${signature} run lock present`).toBeGreaterThan(-1)
        expect(archiveRead, `${signature} reads the stamp`).toBeGreaterThan(-1)
        expect(listLock, `${signature} locks the list before the run`).toBeLessThan(runLock)
        expect(runLock, `${signature} locks the run before reading the stamp`).toBeLessThan(archiveRead)
      }
    })

    it('the lock order is LIST -> RUN -> ITEM across the feature, and the three that skip the list say why', async () => {
      // `purchase`, `unpurchase` and `remove` take no list lock, and that is
      // safe rather than an omission: none of them can RAISE the item count on
      // an open run — a purchase and an un-purchase move a stamp, a remove only
      // lowers it — so none can falsify the emptiness an archive vouched for.
      // Asserted rather than argued, because "it needs no lock" is exactly the
      // kind of claim that stops being true when somebody widens a function.
      for (const signature of [
        'public.purchase_shopping_item(uuid)',
        'public.unpurchase_shopping_item(uuid)',
        'public.remove_shopping_item(uuid)',
      ]) {
        const def = await bodyOf(signature)
        expect(def, `${signature} needs no list lock`).not.toMatch(LIST_KEY_SHARE)
        expect(def, `${signature} keeps 0033's run lock`).toMatch(RUN_KEY_SHARE)
        expect(def, `${signature} inserts nothing`).not.toMatch(/insert into public\.shopping_items/)
      }
    })

    it('POSITIVE CONTROL: the clause regexes do not match the bodies’ own comments', async () => {
      // Both replaced bodies name their clauses in prose. Strip every line that
      // is SQL and what survives must match neither — the trap `0034`'s
      // `for key share of r;` assertion hit, where the sentence about the
      // clause satisfied a regex written for the clause.
      for (const signature of [ARCHIVE, 'public.add_shopping_item(uuid, text, text)']) {
        const commentsOnly = (await bodyOf(signature))
          .split('\n')
          .filter((line) => line.trim().startsWith('--'))
          .join('\n')
        expect(commentsOnly, signature).toMatch(/for (key share|update)/)
        expect(commentsOnly, signature).not.toMatch(RUN_FOR_UPDATE)
        expect(commentsOnly, signature).not.toMatch(RUN_KEY_SHARE)
      }
    })

    it('the three OTHER item writers are deliberately not replaced, and keep their 0033/0034 bodies', async () => {
      // The header's argument, asserted: an archived list's open run is empty
      // by the archive's own precondition, so a purchase, an un-purchase and a
      // remove have no item to name. Each keeps its lock and none of them
      // gained an archive check — a change here means the precondition moved.
      for (const signature of [
        'public.purchase_shopping_item(uuid)',
        'public.unpurchase_shopping_item(uuid)',
        'public.remove_shopping_item(uuid)',
      ]) {
        const def = await bodyOf(signature)
        expect(def, signature).toMatch(RUN_KEY_SHARE)
        expect(def, signature).not.toMatch(/archived_at/)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Re-runnability, and the two directions of the re-paste hazard
  // -------------------------------------------------------------------------

  describe('a second apply, and what an OLDER file puts back', () => {
    it('applies a second time without error and leaves what it declares', async () => {
      // Asserted against what the file DECLARES, never against a snapshot taken
      // before the re-apply: a database built THROUGH this file already holds
      // everything it grants, so before-equals-after would be true whatever the
      // file said (cairn: a snapshot around a re-run cannot see the file it
      // brackets).
      const second = await attempt(() => db.exec(migrationSql(THIS_FILE)))
      expect(second.error).toBeNull()

      const { rows } = await db.query(
        `select p.proname, count(*)::int as n,
                bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as auth,
                bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon,
                min(obj_description(p.oid, 'pg_proc')) as comment
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('archive_shopping_list', 'unarchive_shopping_list')
          group by p.proname order by p.proname`,
      )
      expect(rows.map((r) => ({ ...r, comment: undefined }))).toEqual([
        { proname: 'archive_shopping_list', n: 1, auth: true, anon: false, comment: undefined },
        { proname: 'unarchive_shopping_list', n: 1, auth: true, anon: false, comment: undefined },
      ])
      for (const row of rows) expect(row.comment, row.proname).toMatch(/Story #360/)

      // The column is not added twice and the grant survives.
      const { rows: cols } = await db.query(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and table_name = 'shopping_lists' and column_name = 'archived_at'`,
      )
      expect(cols[0].n).toBe(1)
      expect((await archiveAs(person, listA.id)).error).toBeNull()
    })

    it('HAZARD: re-pasting 0033 alone puts the PRE-ARCHIVE bodies back, and an archived list becomes writable', async () => {
      // The direction cairn records for 0004 over 0007, two files deep now.
      // Nothing errors — the older file is a perfectly valid `create or
      // replace` — and the only visible symptom is that a list nobody can see
      // starts accepting items again.
      await archiveAs(person, listA.id)
      expect((await addAs(person, runA.id, 'Screws')).error).toMatch(/this list is archived/)

      await db.exec(migrationSql('0033_finish_shopping_run.sql'))
      expect(await bodyOf('public.add_shopping_item(uuid, text, text)')).not.toMatch(/archived_at/)
      const slipped = await addAs(person, runA.id, 'Screws')
      expect(slipped.error, '0033 alone reopens an archived list to writes').toBeNull()

      // And re-applying THIS file closes it again — the safe re-paste order
      // ends here.
      await db.exec(migrationSql(THIS_FILE))
      expect((await addAs(person, runA.id, 'Nails')).error).toMatch(/this list is archived/)
    })

    it('HAZARD, worse in kind: re-pasting 0032 takes the client’s READ of the stamp away', async () => {
      // `0032` opens with `revoke all on public.shopping_lists from
      // authenticated, anon` and then grants four columns by name. `archived_at`
      // is not among them, so after that paste every list comes back to the
      // client looking ACTIVE: the picker draws the ones the household put
      // away, and nothing refuses anything, because the refusals are all in the
      // database and the client simply stops asking the right question.
      const mayRead = async () => {
        const { rows } = await db.query(
          `select count(*)::int as n from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'shopping_lists'
              and column_name = 'archived_at' and grantee = 'authenticated'
              and privilege_type = 'SELECT'`,
        )
        return rows[0].n > 0
      }
      expect(await mayRead()).toBe(true)

      await db.exec(migrationSql('0032_shopping_lists_runs_items.sql'))
      expect(await mayRead(), '0032 revokes the whole table and re-grants four columns').toBe(false)
      await db.exec(migrationSql('0033_finish_shopping_run.sql'))
      expect(await mayRead(), '0033 touches no grant on shopping_lists').toBe(false)

      await db.exec(migrationSql(THIS_FILE))
      expect(await mayRead()).toBe(true)
      // The column itself was never at risk — `add column if not exists` on a
      // table `0032` creates `if not exists` leaves the data alone.
      expect((await listById(listA.id)).archived_at).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // What archiving does NOT change
  // -------------------------------------------------------------------------

  describe('the name stays taken while the list is put away', () => {
    it('a new list may not reuse an archived list’s name — the unique index does not exclude them', async () => {
      // Stated in `0035`'s header as the better of two failures, and asserted
      // so it is a decision rather than an accident: the alternative is a
      // household holding two lists it cannot tell apart in a picker that shows
      // the name and nothing else. #358's sentence is what the person reads.
      await archiveAs(person, listA.id)
      const again = await rpc(person, 'select * from public.create_shopping_list($1, $2)', [
        hA.id,
        'hardware',
      ])
      expect(again.ok).toBe(false)
      expect(again.error).toMatch(/duplicate key value|shopping_lists_household_name_key/)
    })
  })
})
