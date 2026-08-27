// @vitest-environment node
//
// Node, not the repo-wide jsdom: PGlite loads its WASM through fetch/Response
// and jsdom's Response has no arrayBuffer() here. Without this the file dies in
// beforeAll, which vitest reports as tests SKIPPED and zero failed — an empty
// run rather than a broken one.
//
// #152 — REMOVING A MEMBER IS THE ORGANIZER'S ALONE.
//
// This is the guard. `Roster.jsx` gates the control too, and that gate is a
// courtesy: it stops the app offering a button the database would refuse. Every
// assertion here holds with no client involved.
//
// WHAT WAS WRONG. `members_delete_same_household` (0001, re-pointed by 0007)
// permitted any member of a household to delete any OTHER member of it. The
// self-removal clause 0007 added is not the gap — it stops you locking yourself
// out, and 0016 preserves it exactly. The gap is A removing B, and when B is the
// organizer the household loses `organizer_member_id` to `on delete set null`
// with no route to appoint a successor, because `create_household` is the only
// thing that ever writes it. Provisioning then ends for that household forever.
//
// A NOTE ON WHAT A REFUSAL LOOKS LIKE. RLS does not raise on a delete it
// disallows — the row simply does not match the policy, and the statement
// reports zero rows affected. So every assertion below counts rows rather than
// catching an error, and each one is paired with a read proving the row was
// there to begin with. Without that pairing, "nothing was deleted" and "there
// was nothing to delete" are the same observation.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { freshDatabase, asDevice, newDevice, provisionMember } from './support/pgliteSupabase.js'

// One database per test, because these tests DELETE from the shared roster and a
// leaked deletion would make a later test pass for the wrong reason. The measured
// p90 for a boot is ~6.2s idle and ~9.7s under contention; 30s is the house value.
vi.setConfig({ testTimeout: 30_000 })

describe('#152 — only the organizer may remove a member', () => {
  let db
  let organizerDevice
  let memberDevice
  let household
  let organizerMember
  let plainMember

  beforeEach(async () => {
    db = await freshDatabase()
    organizerDevice = await newDevice(db, 'organizer@example.com')
    memberDevice = await newDevice(db, 'member@example.com')

    household = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    organizerMember = household.organizer_member_id

    // A second person, claimed — which is what makes the defect reachable. With
    // only the organizer claimed there is no second signed-in caller to do it,
    // and 0007's header says that is the usual state. `provision-member` (#87)
    // is what made two claimed members ordinary.
    const { rows } = await db.query(
      'insert into public.members (household_id, display_name, weekly_minutes) values ($1, $2, $3) returning id',
      [household.id, 'Placeholder Two', 60],
    )
    plainMember = rows[0].id
    await provisionMember(db, plainMember, memberDevice)
  })

  afterEach(async () => {
    await db?.close?.()
  })

  const countMember = async (id) => {
    const { rows } = await db.query('select count(*)::int as n from public.members where id = $1', [
      id,
    ])
    return rows[0].n
  }

  it('refuses a non-organizer removing the ORGANIZER — the unrecoverable case', async () => {
    expect(await countMember(organizerMember)).toBe(1) // positive control

    const deleted = await asDevice(db, memberDevice, async () => {
      const { rows } = await db.query('delete from public.members where id = $1 returning id', [
        organizerMember,
      ])
      return rows.length
    })

    expect(deleted).toBe(0)
    expect(await countMember(organizerMember)).toBe(1)
    // And the consequence that made this worth filing ahead of the backlog: the
    // household still has an organizer, so provisioning still works.
    const { rows } = await db.query(
      'select organizer_member_id from public.households where id = $1',
      [household.id],
    )
    expect(rows[0].organizer_member_id).toBe(organizerMember)
  })

  it('refuses a non-organizer removing ANOTHER ordinary member', async () => {
    // Not just the organizer's row. The rule is about who may remove, not about
    // which row is precious — a household where any member can delete any other
    // is a product decision nobody took.
    const { rows: seeded } = await db.query(
      'insert into public.members (household_id, display_name, weekly_minutes) values ($1, $2, $3) returning id',
      [household.id, 'Placeholder Three', 30],
    )
    const third = seeded[0].id
    expect(await countMember(third)).toBe(1)

    const deleted = await asDevice(db, memberDevice, async () => {
      const { rows } = await db.query('delete from public.members where id = $1 returning id', [
        third,
      ])
      return rows.length
    })

    expect(deleted).toBe(0)
    expect(await countMember(third)).toBe(1)
  })

  it('lets the ORGANIZER remove an ordinary member', async () => {
    // The positive control for the whole file. Without it, a policy refusing
    // everybody would pass every other assertion here.
    expect(await countMember(plainMember)).toBe(1)

    const deleted = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query('delete from public.members where id = $1 returning id', [
        plainMember,
      ])
      return rows.length
    })

    expect(deleted).toBe(1)
    expect(await countMember(plainMember)).toBe(0)
  })

  it('still refuses the organizer removing THEMSELVES — 0007’s clause is untouched', async () => {
    // 0016 adds a clause; it must not weaken the one already there. Deleting
    // your own row is "lock myself out forever" after 0007 made `claimed_by` the
    // sole membership predicate.
    const deleted = await asDevice(db, organizerDevice, async () => {
      const { rows } = await db.query('delete from public.members where id = $1 returning id', [
        organizerMember,
      ])
      return rows.length
    })

    expect(deleted).toBe(0)
    expect(await countMember(organizerMember)).toBe(1)
  })

  it('refuses everybody in a household that already has no organizer — fails closed', async () => {
    // 0016 prevents this state being created; it cannot repair one that exists.
    // What it must not do is leave such a household removable-by-anyone, which
    // is what a predicate that failed OPEN on a null organizer would produce.
    // `is_household_organizer` joins `organizer_member_id` to a member row, so a
    // NULL there matches nothing and the answer is false for everyone.
    await db.query('update public.households set organizer_member_id = null where id = $1', [
      household.id,
    ])

    for (const [who, device] of [
      ['the former organizer', organizerDevice],
      ['an ordinary member', memberDevice],
    ]) {
      const deleted = await asDevice(db, device, async () => {
        const { rows } = await db.query('delete from public.members where id = $1 returning id', [
          plainMember,
        ])
        return rows.length
      })
      expect(deleted, `${who} should not be able to remove anybody`).toBe(0)
    }
    expect(await countMember(plainMember)).toBe(1)
  })

  it('refuses somebody from another household outright', async () => {
    // Unchanged by 0016 and asserted because 0016 rewrites the whole policy: the
    // household clause has to survive the rewrite, and a test that only covered
    // the new clause would not notice it going missing.
    //
    // WHAT THIS TEST CANNOT TELL YOU, stated rather than left to be assumed.
    // *Measured*: replacing the household clause with `true` reddens NOTHING —
    // predicted 0, actual 0. That is not a hole, it is a redundancy the new
    // clause created: being the ORGANIZER of the household a row belongs to
    // implies membership of it, so `is_household_organizer(household_id)` now
    // subsumes `household_id in (select current_household_ids())` for DELETE
    // specifically. Two guards, one observable — `prove-a-guard-test-can-fail`'s
    // sixteenth outcome — so this test proves the outsider is refused and cannot
    // say by which clause.
    //
    // The clause is kept anyway: it is 0007's, it is load-bearing on the other
    // three policies that share its shape, and narrowing a policy on the grounds
    // that another clause happens to cover it today is how a guard quietly stops
    // guarding when the covering clause later changes. Removing it is not this
    // story's to do.
    const outsider = await newDevice(db, 'outsider@example.com')
    await asDevice(db, outsider, async () => {
      await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
    })

    const deleted = await asDevice(db, outsider, async () => {
      const { rows } = await db.query('delete from public.members where id = $1 returning id', [
        plainMember,
      ])
      return rows.length
    })

    expect(deleted).toBe(0)
    expect(await countMember(plainMember)).toBe(1)
  })
})
