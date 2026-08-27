// @vitest-environment node
//
// Node, not the repo-wide jsdom, for the reason chores.pglite.test.js records:
// PGlite loads its WASM through fetch/Response and jsdom's Response has no
// arrayBuffer() here. Without this line the whole file dies in beforeAll — which
// vitest reports as tests SKIPPED and zero failed, so the run looks empty rather
// than broken.
//
// #159 — ONE PERSON, TWO HOUSEHOLDS, AGAINST A REAL POSTGRES
//
// Every other test of this story drives a fake query builder and asserts which
// calls were issued. That is the right instrument for "does the client name a
// household", and it is structurally blind to the question this file exists for:
// WITH TWO HOUSEHOLDS ACTUALLY IN THE DATABASE, does the filter return one?
//
// The distinction is not academic. Before this story every list read filtered by
// nothing and leaned on row-level security, and that was CORRECT while a person
// could belong to one household — `current_household_ids()` returned one id, so
// the policy predicate and the intended filter were the same set. A fake cannot
// tell those two apart, because in a fake there is only ever the data you put
// there. Only a real predicate over a real second household can.
//
// So this file builds the state the whole story is about — ONE auth user holding
// a claimed member row in TWO households — and asks what actually comes back.
//
// WHAT THIS HARNESS CAN AND CANNOT SAY. pgliteSupabase.js is real Postgres with
// `set role authenticated`, so RLS and COLUMN GRANTS are really enforced and
// every refusal below is honest. It is NOT PostgREST: `.eq()`, `.in()` and
// resource embedding are PostgREST features and a SQL shim cannot represent
// them, so this file asserts the SQL those calls compile to rather than the
// calls themselves. The client-call half is in the `.io.test.js` files, and
// neither half is sufficient alone.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'

vi.setConfig({ testTimeout: 30_000 })

describe('#159 — one person in two households, over a real Postgres', () => {
  let db
  let person // ONE auth user, in both households
  let outsider
  let hA
  let hB
  let memberInA
  let memberInB

  beforeEach(async () => {
    db = await freshDatabase()
    person = await newDevice(db)
    outsider = await newDevice(db)

    // Two households, each created by somebody else, so neither is "the
    // caller's own" by construction. `person` is then admitted to both — which
    // is the state 0009 made representable and nothing had yet tested.
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

    const seedMember = async (householdId, name, minutes) => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, $2, $3) returning id`,
        [householdId, name, minutes],
      )
      return rows[0].id
    }

    memberInA = await seedMember(hA.id, 'Placeholder One', 300)
    memberInB = await seedMember(hB.id, 'Placeholder Two', 120)

    // The load-bearing line: ONE auth user claims a member row in EACH
    // household. Two member rows, one `claimed_by`.
    await provisionMember(db, memberInA, person)
    await provisionMember(db, memberInB, person)

    await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, 'Placeholder Chore', 30, current_date),
              ($2, 'Placeholder Other Chore', 45, current_date)`,
      [hA.id, hB.id],
    )
  })

  afterEach(async () => {
    await db?.close?.()
  })

  // -------------------------------------------------------------------------
  // The premise. If this fails, nothing below means anything.
  // -------------------------------------------------------------------------

  it('PREMISE: the fixture really does put one person in two households', async () => {
    // Read as OWNER, not as the person. A direct `auth.uid()` call from role
    // `authenticated` is refused `permission denied for schema auth` on this
    // harness — the policies call it fine because they store the function's OID,
    // but a query naming the schema needs `grant usage on schema auth`, which
    // the hand-built auth schema does not give the client roles. Recorded in
    // cairn's supabase-rls-column-grants note; the premise does not need RLS
    // anyway, it needs the raw fact about the fixture.
    const { rows } = await db.query(
      'select household_id from public.members where claimed_by = $1 order by household_id',
      [person],
    )
    const seen = rows.map((r) => r.household_id)
    expect(seen).toHaveLength(2)
    expect(new Set(seen)).toEqual(new Set([hA.id, hB.id]))
  })

  // -------------------------------------------------------------------------
  // #159 AC 2 / AC 3 — the plural read, and the ORDER
  // -------------------------------------------------------------------------

  it('AC 3: the households read returns BOTH rows, and in the stated order', async () => {
    // `listHouseholds()` issues `select('*').order('created_at').order('id')`.
    // This is that SQL. The point is the COUNT first — a `limit(1)` here would
    // return one row and every scoping assertion below would still pass, which
    // is exactly how the old code looked correct.
    const rows = await asDevice(db, person, async () => {
      const { rows } = await db.query(
        'select id, created_at from public.households order by created_at asc, id asc',
      )
      return rows
    })

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([hA.id, hB.id]))

    // The ORDER is asserted rather than assumed, and it is total: `created_at`
    // then `id`. Two households created in the same clock tick would otherwise
    // reopen the ambiguity the ordering exists to close, and in this fixture
    // they very nearly are — both are created inside one beforeEach.
    //
    // Asserted as NON-DECREASING plus DETERMINISTIC rather than by re-sorting in
    // JavaScript. Postgres orders `uuid` by its binary value and JS
    // `localeCompare` does not reproduce that, so a JS re-sort would be asserting
    // my model of Postgres's collation rather than the ordering — and it would
    // fail on correct data, which is worse than not checking.
    const times = rows.map((r) => new Date(r.created_at).getTime())
    expect(times[0]).toBeLessThanOrEqual(times[1])

    // Determinism is the property the ordering actually buys, and precisely what
    // the old unordered `limit(1)` did not have. Same query, same answer.
    const again = await asDevice(db, person, async () => {
      const { rows } = await db.query(
        'select id from public.households order by created_at asc, id asc',
      )
      return rows.map((r) => r.id)
    })
    expect(again).toEqual(rows.map((r) => r.id))
  })

  it('AC 2: an unordered limit(1) is not deterministic here — which is why it went', async () => {
    // Not a test of our code: a demonstration of the hazard it removes, so a
    // future reader can see WHY the ordering is load-bearing rather than tidy.
    // A `limit 1` with no `order by` is free to return either row, and Postgres
    // is under no obligation to be consistent between calls.
    const picked = await asDevice(db, person, async () => {
      const { rows } = await db.query('select id from public.households limit 1')
      return rows[0].id
    })
    expect([hA.id, hB.id]).toContain(picked)
  })

  // -------------------------------------------------------------------------
  // #159 AC 1 — every read returns ONE household's rows
  // -------------------------------------------------------------------------

  it('AC 1: unfiltered, the roster read returns BOTH households — the defect', async () => {
    // The behaviour before this story, asserted so the fix has something to be
    // a fix OF. RLS is working perfectly here: every row IS one this caller may
    // see. It is simply not one household.
    const all = await asDevice(db, person, async () => {
      const { rows } = await db.query('select id, household_id from public.members')
      return rows
    })
    expect(new Set(all.map((r) => r.household_id))).toEqual(new Set([hA.id, hB.id]))
    expect(all.length).toBeGreaterThan(2)
  })

  it('AC 1: filtered by household_id, the roster read returns ONE household', async () => {
    const inA = await asDevice(db, person, async () => {
      const { rows } = await db.query(
        'select id, household_id from public.members where household_id = $1',
        [hA.id],
      )
      return rows
    })
    expect(inA.length).toBeGreaterThan(0)
    expect(new Set(inA.map((r) => r.household_id))).toEqual(new Set([hA.id]))
    expect(inA.map((r) => r.id)).toContain(memberInA)
    expect(inA.map((r) => r.id)).not.toContain(memberInB)
  })

  it('AC 1: the same holds for chores', async () => {
    const inB = await asDevice(db, person, async () => {
      const { rows } = await db.query(
        'select id, household_id, title from public.chores where household_id = $1',
        [hB.id],
      )
      return rows
    })
    expect(inB).toHaveLength(1)
    expect(inB[0].household_id).toBe(hB.id)
    expect(inB[0].title).toBe('Placeholder Other Chore')
  })

  it('AC 1: capacity and exclusions scope by MEMBER set, with no grant of their own', async () => {
    // These tables withhold household_id and #157 measured that they need no
    // grant change: a row belongs to a household exactly when its member does.
    await db.query(
      `insert into public.member_capacity (household_id, member_id, period_start, minutes)
       values ($1, $2, date_trunc('week', current_date)::date, 60),
              ($3, $4, date_trunc('week', current_date)::date, 90)`,
      [hA.id, memberInA, hB.id, memberInB],
    )

    const forA = await asDevice(db, person, async () => {
      const { rows } = await db.query(
        'select member_id, minutes from public.member_capacity where member_id = any($1::uuid[])',
        [[memberInA]],
      )
      return rows
    })
    expect(forA).toHaveLength(1)
    expect(forA[0].member_id).toBe(memberInA)
    expect(forA[0].minutes).toBe(60)
  })

  // -------------------------------------------------------------------------
  // #159 AC 5 — the DATABASE refuses, so the client filter is defence in depth
  // -------------------------------------------------------------------------

  it('AC 5: a write naming a household the caller does not belong to is refused BY POSTGRES', async () => {
    const stranger = await newDevice(db)
    const strangerHousehold = await asDevice(db, stranger, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Mutant Household',
        'Mutant Organizer',
      ])
      return rows[0]
    })

    const refused = await attempt(() =>
      asDevice(db, person, () =>
        db.query(
          `insert into public.members (household_id, display_name, weekly_minutes)
           values ($1, 'Intruder', 10)`,
          [strangerHousehold.id],
        ),
      ),
    )
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/row-level security|permission denied/i)
  })

  it('AC 5: and the same for a chore', async () => {
    const stranger = await newDevice(db)
    const strangerHousehold = await asDevice(db, stranger, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Other Household',
        'Other Organizer',
      ])
      return rows[0]
    })

    const refused = await attempt(() =>
      asDevice(db, person, () =>
        db.query(
          `insert into public.chores (household_id, title, expected_minutes, due_on)
           values ($1, 'Smuggled', 10, current_date)`,
          [strangerHousehold.id],
        ),
      ),
    )
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/row-level security|permission denied/i)
  })

  it('AC 5: a write into EITHER of the caller’s own households is allowed', async () => {
    // The negative control that stops the two refusals above passing for the
    // wrong reason. Without it, `using (false)` on the insert policy would
    // satisfy both — the app would simply be unable to write anywhere, which is
    // a different and worse bug.
    for (const household of [hA, hB]) {
      const allowed = await attempt(() =>
        asDevice(db, person, () =>
          db.query(
            `insert into public.members (household_id, display_name, weekly_minutes)
             values ($1, 'Spare', 10)`,
            [household.id],
          ),
        ),
      )
      expect(allowed.ok, `writing into a household the caller belongs to`).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // #159 AC 9 — a no-op for anybody in exactly one household
  // -------------------------------------------------------------------------

  it('AC 9: for a one-household person, the filter changes nothing at all', async () => {
    // The criterion that lets this story ship before any switcher exists. For a
    // caller in one household the filtered and unfiltered reads must be
    // IDENTICAL — same rows, same order — because their `current_household_ids()`
    // already had one element in it.
    const solo = await newDevice(db)
    const soloMember = await asDevice(db, outsider, async () => {
      const { rows } = await db.query(
        `insert into public.members (household_id, display_name, weekly_minutes)
         values ($1, 'Placeholder Three', 200) returning id`,
        [hA.id],
      )
      return rows[0].id
    })
    await provisionMember(db, soloMember, solo)

    const [unfiltered, filtered] = await asDevice(db, solo, async () => {
      const a = await db.query('select id from public.members order by created_at, id')
      const b = await db.query(
        'select id from public.members where household_id = $1 order by created_at, id',
        [hA.id],
      )
      return [a.rows.map((r) => r.id), b.rows.map((r) => r.id)]
    })

    expect(filtered).toEqual(unfiltered)
    expect(filtered.length).toBeGreaterThan(0)
  })
})
