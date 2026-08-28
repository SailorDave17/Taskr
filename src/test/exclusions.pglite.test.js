// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #37 — recording that a person cannot do a chore, against a real Postgres.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js". Not "Supabase will accept
// this" — a green run here says nothing whatever about the hosted project,
// because this harness BUILDS the schema it certifies. `0010` was pasted on
// 2026-08-24 and `npm run check:live` was red on `chore_exclusions` by design
// until it was; that check, not this file, is the authority on live state.
//
// Every access claim and every eligibility claim in this story lives HERE rather
// than in a component test, following #36 AC 10: a fake Supabase client returns
// whatever the test tells it to, so it cannot refuse, so a refusal asserted
// against one proves nothing about the database. The SQL predicate is the
// authority for the allocator, and this is the only file that can exercise it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  migrationSql,
  newDevice,
  databaseThrough,
} from './support/pgliteSupabase.js'

// A pglite test builds a real Postgres in WebAssembly, so vitest's 5000ms
// default testTimeout is a number nobody chose for this suite - it is what you
// get for not setting one. Raised deliberately, and the measurement is why.
//
// Measured 2026-08-24 on repeats.pglite.test.js's heaviest case, which runs its
// whole scenario twice under two pinned session zones and must therefore build
// TWO more databases inside the test body, on top of the one beforeEach already
// built: 3460ms on the dev machine, 7800ms and 8107ms on ubuntu-latest, where it
// timed out. The same test passed in a third CI run, so the runner straddles the
// default - which is the worst place for a limit to sit, because the suite then
// fails about two pushes in three and reads as a real defect each time.
//
// 30s is ~3.7x the worst time actually observed. A genuine hang still fails; it
// fails later, and that is the whole cost of this line.
//
// hookTimeout is NOT set here. It is set once, for every pglite suite, in
// src/test/support/pgliteSupabase.js — which this file imports — and the
// measurement behind the value is in that file's comment. #145.
//
// It used to be seven copies of a paragraph explaining why the 10s default was
// deliberate. Two suites then timed out on it, the correction reached one copy,
// and six went on asserting the opposite of what the code did. A value with one
// home has no copy-set to keep in step.
vi.setConfig({ testTimeout: 30_000 })

describe('who cannot do a chore, run against a real Postgres', () => {
  let db, deviceA, deviceB, householdA, householdB
  let organizerA, memberTwo, memberThree, outsiderMember
  let dishes, mowing, oven, bins, outsiderChore

  const seedChore = async (household, title, minutes = 20) => {
    const { rows } = await db.query(
      `insert into public.chores (household_id, title, expected_minutes, due_on)
       values ($1, $2, $3, '2026-08-10') returning id`,
      [household, title, minutes],
    )
    return rows[0].id
  }

  const seedMember = async (household, name, minutes) => {
    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, $2, $3) returning id`,
      [household, name, minutes],
    )
    return rows[0].id
  }

  /** Every exclusion row, read as the OWNER — the ground truth AC 1 counts. */
  const exclusionCount = async () => {
    const { rows } = await db.query('select count(*)::int as n from public.chore_exclusions')
    return rows[0].n
  }

  /** Record a pair as the owner, bypassing grants — setup, not the thing tested. */
  const exclude = async (household, chore, member) =>
    db.query(
      `insert into public.chore_exclusions (household_id, chore_id, member_id)
       values ($1, $2, $3)`,
      [household, chore, member],
    )

  const eligible = async (chore, member) => {
    const { rows } = await db.query('select public.is_member_eligible($1, $2) as ok', [
      chore,
      member,
    ])
    return rows[0].ok
  }

  const eligibleNames = async (chore) => {
    const { rows } = await db.query(
      'select display_name from public.eligible_members($1) order by display_name',
      [chore],
    )
    return rows.map((r) => r.display_name)
  }

  beforeEach(async () => {
    db = await freshDatabase()
    deviceA = await newDevice(db)
    deviceB = await newDevice(db)

    householdA = await asDevice(db, deviceA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    householdB = await asDevice(db, deviceB, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ])
      return rows[0]
    })

    // THREE members and FOUR chores, which is AC 4's fixture and not an
    // arbitrary size. Three people is the smallest roster where "excluding one
    // leaves the others alone" and "excluding two leaves one" are different
    // assertions; four chores is the smallest set where a chore with no
    // exclusion, a chore with one, and a chore with all of them can coexist in a
    // single statement's result.
    organizerA = householdA.organizer_member_id
    memberTwo = await seedMember(householdA.id, 'Placeholder Two', 60)
    memberThree = await seedMember(householdA.id, 'Placeholder Three', 30)
    outsiderMember = householdB.organizer_member_id

    dishes = await seedChore(householdA.id, 'Placeholder Chore')
    mowing = await seedChore(householdA.id, 'Placeholder Other Chore', 45)
    oven = await seedChore(householdA.id, 'Placeholder Third Chore', 30)
    bins = await seedChore(householdA.id, 'Placeholder Fourth Chore', 10)
    outsiderChore = await seedChore(householdB.id, 'Placeholder Chore')
  })

  // -------------------------------------------------------------------------
  // AC 1 — zero rows means everyone is eligible, and stays that way
  // -------------------------------------------------------------------------

  describe('AC 1 — the default is capable, and it costs no writes', () => {
    it('every member is eligible for every chore when no exclusion exists', async () => {
      expect(await exclusionCount(), 'the fixture writes no exclusions').toBe(0)

      // Every pair, in ONE statement — the shape AC 4 names, used here to make
      // the claim exhaustive rather than sampled.
      const { rows } = await db.query(
        `select count(*)::int as pairs,
                count(*) filter (where public.is_member_eligible(c.id, m.id))::int as ok
           from public.chores c
           join public.members m on m.household_id = c.household_id
          where c.household_id = $1`,
        [householdA.id],
      )
      expect(rows[0].pairs, 'three members times four chores').toBe(12)
      expect(rows[0].ok).toBe(12)
    })

    it('and a member added afterwards is eligible for every existing chore, with zero writes', async () => {
      const before = await exclusionCount()
      const late = await seedMember(householdA.id, 'Placeholder Child', 15)
      const after = await exclusionCount()

      // The row COUNT before and after, which is what the AC asks for. A
      // predicate-only assertion would pass just as well against a design that
      // backfills an "allowed" row per pair on member creation — the exact
      // inversion 0010's header exists to prevent — because such rows would say
      // eligible too.
      expect(after, 'adding a person must write no eligibility rows at all').toBe(before)
      expect(after).toBe(0)

      for (const chore of [dishes, mowing, oven, bins]) {
        expect(await eligible(chore, late)).toBe(true)
      }
    })

    it('POSITIVE CONTROL: the predicate can say false, so the trues above are not a constant', async () => {
      // Without this, every assertion in this describe is satisfied by a
      // function that returns true unconditionally — which is exactly what
      // option (d) would have shipped.
      await exclude(householdA.id, dishes, memberTwo)
      expect(await eligible(dishes, memberTwo)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // AC 2 — one pair, one row
  // -------------------------------------------------------------------------

  describe('AC 2 — recording an exclusion creates exactly one row for that pair', () => {
    it('writes one row, and only that member becomes ineligible', async () => {
      await asDevice(db, deviceA, () =>
        db.query(
          `insert into public.chore_exclusions (household_id, chore_id, member_id)
           values ($1, $2, $3)`,
          [householdA.id, mowing, memberThree],
        ),
      )

      expect(await exclusionCount()).toBe(1)
      expect(await eligible(mowing, memberThree)).toBe(false)

      // The half that catches the parameter-shadowing bug 0010's comment
      // describes: if `where x.chore_id = chore_id` resolved to the COLUMN on
      // both sides it would be true for every row, and everybody would read as
      // ineligible for everything. These two assertions are what fail then.
      expect(await eligible(mowing, memberTwo), 'excluding one person is not excluding all').toBe(
        true,
      )
      expect(await eligible(dishes, memberThree), 'and not from every chore either').toBe(true)
    })

    it('refuses a second row for the same pair, so "exactly one" is structural', async () => {
      await exclude(householdA.id, mowing, memberThree)
      const again = await attempt(() => exclude(householdA.id, mowing, memberThree))

      expect(again.ok).toBe(false)
      expect(again.error).toMatch(/chore_exclusions_one_per_pair/)
      expect(await exclusionCount()).toBe(1)
    })

    it('undoing one removes the row rather than marking it, so absence stays the only default', async () => {
      await exclude(householdA.id, mowing, memberThree)
      await asDevice(db, deviceA, () =>
        db.query('delete from public.chore_exclusions where chore_id = $1 and member_id = $2', [
          mowing,
          memberThree,
        ]),
      )

      expect(await exclusionCount()).toBe(0)
      expect(await eligible(mowing, memberThree)).toBe(true)
    })

    it('a client may not UPDATE an exclusion, because there is nothing about one to edit', async () => {
      await exclude(householdA.id, mowing, memberThree)
      const edited = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('update public.chore_exclusions set member_id = $1 where chore_id = $2', [
            memberTwo,
            mowing,
          ]),
        ),
      )

      // 0010 grants no update and writes no update policy. Moving an exclusion
      // from one person to another by UPDATE would be a delete plus an insert
      // wearing a disguise, and it would slip past the unique constraint's
      // intent the same way 0005 describes for capacity.
      expect(edited.ok).toBe(false)
      expect(edited.error).toMatch(/permission denied/i)
    })
  })

  // -------------------------------------------------------------------------
  // AC 4 — answerable in SQL, in one statement, with no JavaScript
  // -------------------------------------------------------------------------

  describe('AC 4 — the predicate is usable in the shape an allocator RPC needs', () => {
    beforeEach(async () => {
      // Two exclusions across the four chores, per the AC's fixture.
      await exclude(householdA.id, mowing, memberThree)
      await exclude(householdA.id, oven, memberTwo)
    })

    it('is_member_eligible answers correctly for every pair in ONE statement joining chores to members', async () => {
      const { rows } = await db.query(
        `select c.title, m.display_name, public.is_member_eligible(c.id, m.id) as ok
           from public.chores c
           join public.members m on m.household_id = c.household_id
          where c.household_id = $1
          order by c.title, m.display_name`,
        [householdA.id],
      )

      const ineligible = rows
        .filter((r) => !r.ok)
        .map((r) => `${r.title}/${r.display_name}`)
        .sort()

      expect(rows, 'three members times four chores').toHaveLength(12)
      expect(ineligible).toEqual([
        'Placeholder Other Chore/Placeholder Three',
        'Placeholder Third Chore/Placeholder Two',
      ])
    })

    it('eligible_members returns the right set per chore, also in one statement', async () => {
      const { rows } = await db.query(
        `select c.title,
                (select count(*)::int from public.eligible_members(c.id)) as n
           from public.chores c
          where c.household_id = $1
          order by c.title`,
        [householdA.id],
      )

      expect(Object.fromEntries(rows.map((r) => [r.title, r.n]))).toEqual({
        'Placeholder Chore': 3,
        'Placeholder Fourth Chore': 3,
        'Placeholder Other Chore': 2,
        'Placeholder Third Chore': 2,
      })
    })

    it('and it returns the PEOPLE, not a count, so the allocator can iterate them', async () => {
      expect(await eligibleNames(mowing)).toEqual(['Placeholder Organizer', 'Placeholder Two'])
      expect(await eligibleNames(dishes)).toEqual([
        'Placeholder Organizer',
        'Placeholder Three',
        'Placeholder Two',
      ])
    })

    it('never reaches into another household, even though it is security definer', async () => {
      // The definer property is what makes the answer independent of who asks;
      // it must not also make the SET household-blind. `eligible_members` draws
      // its roster from the CHORE's household, so the other family never appears.
      expect(await eligibleNames(outsiderChore)).toEqual(['Placeholder Other Organizer'])
      const { rows } = await db.query(
        'select count(*)::int as n from public.eligible_members($1)',
        [dishes],
      )
      expect(rows[0].n, 'household A has three members and B is not among them').toBe(3)
    })

    it('the two functions agree, which is the property the allocator will rest on', async () => {
      // They are separate implementations of one rule. #40 will call whichever
      // reads better at each site, and a household where they disagree is one
      // where the allocator and its own explanation say different things.
      const { rows } = await db.query(
        `select count(*)::int as disagreements
           from public.chores c
           join public.members m on m.household_id = c.household_id
          where public.is_member_eligible(c.id, m.id)
             <> exists (select 1 from public.eligible_members(c.id) e where e.id = m.id)`,
      )
      expect(rows[0].disagreements).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC 5 — a chore nobody may do
  // -------------------------------------------------------------------------

  describe('AC 5 — a chore excluding everybody returns the empty set', () => {
    it('returns no rows rather than raising, and rather than falling back to everyone', async () => {
      for (const member of [organizerA, memberTwo, memberThree]) {
        await exclude(householdA.id, bins, member)
      }

      const all = await attempt(() =>
        db.query('select * from public.eligible_members($1)', [bins]),
      )
      expect(all.ok, 'an impossible chore must not raise — the allocator has to report it').toBe(
        true,
      )
      expect(all.value.rows).toEqual([])

      // The falling-back failure would be silent and plausible: three names on
      // screen and an allocator handing the mower to the six-year-old. Asserted
      // as a count against a roster that is NOT empty, so "no rows" cannot be
      // confused with "no members".
      const { rows: roster } = await db.query(
        'select count(*)::int as n from public.members where household_id = $1',
        [householdA.id],
      )
      expect(roster[0].n).toBe(3)
    })

    it('and every pair reads ineligible, so the empty set is not a query that missed', async () => {
      for (const member of [organizerA, memberTwo, memberThree]) {
        await exclude(householdA.id, bins, member)
      }
      for (const member of [organizerA, memberTwo, memberThree]) {
        expect(await eligible(bins, member)).toBe(false)
      }
    })

    it('a chore id naming nothing is the empty set too, and is asserted rather than assumed', async () => {
      // "Empty" and "empty for a different reason" are indistinguishable at the
      // call site, so the second reason is pinned here rather than discovered by
      // #40 with a household on the phone.
      const { rows } = await db.query('select * from public.eligible_members($1)', [
        '00000000-0000-0000-0000-000000000000',
      ])
      expect(rows).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // AC 6 / AC 7 — an exclusion does not block a person who means it
  // -------------------------------------------------------------------------

  describe('ACs 6 and 7 — the database never refuses an assignment over an exclusion', () => {
    it('AC 6: assigning an excluded member SUCCEEDS — warn-and-allow is a UI rule, not a constraint', async () => {
      await exclude(householdA.id, mowing, memberThree)

      const assigned = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select * from public.assign_chore($1, $2)', [
          mowing,
          memberThree,
        ])
        return rows[0]
      })

      // Owner decision, 2026-08-21, option (a): a parent overriding is signal,
      // not error, and blocking them is the nagging the charter names as the
      // enemy. The ALLOCATOR still treats an exclusion as hard — that half is
      // #40's, and it is why the predicate exists at all.
      expect(assigned.assigned_member_id).toBe(memberThree)
      expect(await eligible(mowing, memberThree), 'and the person is still ineligible').toBe(false)
    })

    it('AC 7: excluding somebody who already holds the chore leaves the assignment standing', async () => {
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [mowing, memberThree]),
      )
      await asDevice(db, deviceA, () =>
        db.query(
          `insert into public.chore_exclusions (household_id, chore_id, member_id)
           values ($1, $2, $3)`,
          [householdA.id, mowing, memberThree],
        ),
      )

      // Option (a), same decision: leave it assigned and say so. Automatically
      // unassigning would drop the work into the unassigned pile with no
      // allocator to re-place it, which is (b) and becomes free once #49 exists.
      const { rows } = await db.query('select assigned_member_id from public.chores where id = $1', [
        mowing,
      ])
      expect(rows[0].assigned_member_id).toBe(memberThree)
    })
  })

  // -------------------------------------------------------------------------
  // AC 8 — the household boundary, with its own positive control
  // -------------------------------------------------------------------------

  describe('AC 8 — a device may write an exclusion for its own household and no other', () => {
    it('POSITIVE CONTROL: the permitted write succeeds, so the refusals below are not a dead grant', async () => {
      const allowed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chore_exclusions (household_id, chore_id, member_id)
             values ($1, $2, $3)`,
            [householdA.id, dishes, memberTwo],
          ),
        ),
      )
      expect(allowed.ok, 'the grant set must not be simply empty').toBe(true)
      expect(await exclusionCount()).toBe(1)
    })

    it('refuses a row naming another household outright', async () => {
      const refused = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chore_exclusions (household_id, chore_id, member_id)
             values ($1, $2, $3)`,
            [householdB.id, outsiderChore, outsiderMember],
          ),
        ),
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/row-level security policy/i)
      expect(await exclusionCount()).toBe(0)
    })

    it('and cannot smuggle another household\'s chore in under its own household_id', async () => {
      // The attack the with-check policy alone does NOT stop: the row claims
      // household A, which the policy permits, while naming a chore of household
      // B. The composite foreign key is what refuses it, and this is the
      // assertion that makes 0010's key load-bearing rather than decorative.
      const smuggled = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chore_exclusions (household_id, chore_id, member_id)
             values ($1, $2, $3)`,
            [householdA.id, outsiderChore, memberTwo],
          ),
        ),
      )
      expect(smuggled.ok).toBe(false)
      expect(smuggled.error).toMatch(/chore_exclusions_chore_in_household/)
    })

    it('and cannot name another household\'s PERSON either', async () => {
      const smuggled = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query(
            `insert into public.chore_exclusions (household_id, chore_id, member_id)
             values ($1, $2, $3)`,
            [householdA.id, dishes, outsiderMember],
          ),
        ),
      )
      expect(smuggled.ok).toBe(false)
      expect(smuggled.error).toMatch(/chore_exclusions_member_in_household/)
    })

    it('BACKSTOP: the composite keys refuse a cross-household pair even as the OWNER', async () => {
      // Run as the table owner, which bypasses RLS and every column grant — so
      // the only thing that can refuse this is the constraint itself. Without
      // this, all four assertions above are consistent with the policies being
      // the entire rule, and a policy is one `to anon` away from a hole.
      const forced = await attempt(() => exclude(householdA.id, outsiderChore, memberTwo))
      expect(forced.ok).toBe(false)
      expect(forced.error).toMatch(/chore_exclusions_chore_in_household/)
    })

    it('sees nothing of another household\'s exclusions, and is not merely refused the write', async () => {
      await exclude(householdB.id, outsiderChore, outsiderMember)
      const visible = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query('select id from public.chore_exclusions')
        return rows
      })
      expect(visible).toEqual([])
    })

    it('an unauthenticated caller sees nothing and writes nothing', async () => {
      await exclude(householdA.id, dishes, memberTwo)
      const read = await asDevice(db, null, async () => {
        const { rows } = await db.query('select id from public.chore_exclusions')
        return rows
      })
      expect(read).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // AC 9 — the rows are the state, and there is no other copy of them
  // -------------------------------------------------------------------------

  describe('AC 9 — another device reads exclusions from the database, holding none itself', () => {
    it('a second device in the same household reads what the first one wrote', async () => {
      // Device B is provisioned onto a member row of household A — the only way
      // anybody joins a household since 0007 — so this is two PEOPLE in one
      // family rather than a fiction about sessions.
      await db.query('update public.members set claimed_by = $1 where id = $2', [
        deviceB,
        memberTwo,
      ])

      await asDevice(db, deviceA, () =>
        db.query(
          `insert into public.chore_exclusions (household_id, chore_id, member_id)
           values ($1, $2, $3)`,
          [householdA.id, mowing, memberThree],
        ),
      )

      const seen = await asDevice(db, deviceB, async () => {
        const { rows } = await db.query(
          'select chore_id, member_id from public.chore_exclusions order by created_at',
        )
        return rows
      })
      expect(seen).toEqual([{ chore_id: mowing, member_id: memberThree }])
    })

    it('and a re-read after an undo shows the row gone, so nothing is held across reads', async () => {
      await db.query('update public.members set claimed_by = $1 where id = $2', [
        deviceB,
        memberTwo,
      ])
      await exclude(householdA.id, mowing, memberThree)

      const before = await asDevice(db, deviceB, async () =>
        (await db.query('select id from public.chore_exclusions')).rows.length,
      )
      await asDevice(db, deviceA, () =>
        db.query('delete from public.chore_exclusions where chore_id = $1 and member_id = $2', [
          mowing,
          memberThree,
        ]),
      )
      const after = await asDevice(db, deviceB, async () =>
        (await db.query('select id from public.chore_exclusions')).rows.length,
      )

      expect(before).toBe(1)
      expect(after).toBe(0)
    })

    it('the wildcard select refuses, because household_id is withheld', async () => {
      // 0003's device, third table. A client that can `select('*')` here has a
      // grant set with nothing withheld, which is the state where the whole
      // revoke-and-grant ceremony has no effect at all.
      const wildcard = await attempt(() =>
        asDevice(db, deviceA, () => db.query('select * from public.chore_exclusions')),
      )
      expect(wildcard.ok).toBe(false)
      expect(wildcard.error).toMatch(/permission denied/i)

      const listed = await attempt(() =>
        asDevice(db, deviceA, () =>
          db.query('select id, chore_id, member_id, created_at from public.chore_exclusions'),
        ),
      )
      expect(listed.ok, 'the column list the client actually uses must work').toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // AC 10 — an exclusion does not outlive either half of its pair
  // -------------------------------------------------------------------------

  describe('AC 10 — deleting a member or a chore takes its exclusions with it', () => {
    it('removing the PERSON removes the exclusions naming them, and leaves the others alone', async () => {
      await exclude(householdA.id, mowing, memberThree)
      await exclude(householdA.id, oven, memberTwo)

      await asDevice(db, deviceA, () =>
        db.query('delete from public.members where id = $1', [memberThree]),
      )

      const { rows } = await db.query('select member_id from public.chore_exclusions')
      expect(rows).toEqual([{ member_id: memberTwo }])
    })

    it('removing the CHORE removes them too, so a rebuilt chore inherits nothing', async () => {
      await exclude(householdA.id, mowing, memberThree)
      await asDevice(db, deviceA, () =>
        db.query('delete from public.chores where id = $1', [mowing]),
      )
      expect(await exclusionCount()).toBe(0)

      // The failure this AC names, stated as the thing that must NOT happen: a
      // chore written again under the same title is a NEW row, and it must not
      // arrive carrying a rule about somebody who may no longer be here.
      const rebuilt = await seedChore(householdA.id, 'Placeholder Other Chore', 45)
      expect(await eligible(rebuilt, memberThree)).toBe(true)
    })

    it('and removing a member still RELEASES their chores rather than deleting them — 0006 unchanged', async () => {
      // The contrast worth pinning, because the two cascades point opposite ways
      // and both are deliberate: a chore survives the person who was doing it, an
      // exclusion does not, because the exclusion IS the pairing. A `cascade`
      // pasted onto 0006's foreign key by analogy with this file would delete
      // household work when somebody leaves.
      await asDevice(db, deviceA, () =>
        db.query('select * from public.assign_chore($1, $2)', [dishes, memberThree]),
      )
      await exclude(householdA.id, dishes, memberThree)
      await asDevice(db, deviceA, () =>
        db.query('delete from public.members where id = $1', [memberThree]),
      )

      const { rows } = await db.query(
        'select id, assigned_member_id from public.chores where id = $1',
        [dishes],
      )
      expect(rows, 'the chore must survive the person').toHaveLength(1)
      expect(rows[0].assigned_member_id).toBeNull()
      expect(await exclusionCount(), 'while the exclusion goes with them').toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // 0010 is applied by a human pasting it, twice
  // -------------------------------------------------------------------------

  describe('0010 is re-runnable, because a re-paste is the normal path', () => {
    it('applies a second time without error', async () => {
      const at0010 = await databaseThrough('0010_chore_exclusions.sql')
      const second = await attempt(() => at0010.exec(migrationSql('0010_chore_exclusions.sql')))
      expect(second.error).toBeNull()
    })

    it('and a re-run neither widens the grants nor adds an update grant', async () => {
      const fresh = await databaseThrough('0010_chore_exclusions.sql')
      await fresh.exec(migrationSql('0010_chore_exclusions.sql'))
      const { rows } = await fresh.query(
        `select privilege_type, column_name from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'chore_exclusions'
            and grantee = 'authenticated'
          order by privilege_type, column_name`,
      )
      const byPrivilege = {}
      for (const row of rows) (byPrivilege[row.privilege_type] ??= []).push(row.column_name)

      expect(byPrivilege.SELECT).toEqual(['chore_id', 'created_at', 'id', 'member_id'])
      expect(byPrivilege.INSERT).toEqual(['chore_id', 'household_id', 'member_id'])
      expect(byPrivilege.UPDATE, 'an exclusion has nothing about it to edit').toBeUndefined()
    })

    it('and an exclusion recorded before the re-paste survives it', async () => {
      await exclude(householdA.id, mowing, memberThree)
      await db.exec(migrationSql('0010_chore_exclusions.sql'))
      expect(await exclusionCount()).toBe(1)
      expect(await eligible(mowing, memberThree)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // The privilege posture of the two functions, which is easy to widen by accident
  // -------------------------------------------------------------------------

  describe('the predicate is server-side only, and that is a decision', () => {
    it('a signed-in client may not execute either function', async () => {
      for (const call of [
        'select public.is_member_eligible($1, $2)',
        'select * from public.eligible_members($1)',
      ]) {
        const refused = await attempt(() =>
          asDevice(db, deviceA, () =>
            db.query(call, call.includes('is_member') ? [dishes, memberTwo] : [dishes]),
          ),
        )
        expect(refused.ok, `${call} must not be client-callable`).toBe(false)
        expect(refused.error).toMatch(/permission denied/i)
      }
    })

    it('POSITIVE CONTROL: the owner can, so the refusal above is a grant and not a broken function', async () => {
      // Without this, "permission denied" and "this function does not work" are
      // the same observation. Every other assertion in this file runs as the
      // owner, so they are that control too — this states it in one place.
      expect(await eligible(dishes, memberTwo)).toBe(true)
    })

    it('and the client reads the ROWS instead, which is what the screen is built from', async () => {
      await exclude(householdA.id, mowing, memberThree)
      const seen = await asDevice(db, deviceA, async () => {
        const { rows } = await db.query(
          'select chore_id, member_id from public.chore_exclusions',
        )
        return rows
      })
      expect(seen).toEqual([{ chore_id: mowing, member_id: memberThree }])
    })
  })
})
