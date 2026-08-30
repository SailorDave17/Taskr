// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WASM through fetch/Response. Same docblock
// and same reason as the other pglite files.
//
// #50 AC 2 — what each member was last shown is persisted PER MEMBER, against a
// real Postgres. The announcement cannot be defined without this record, and
// the record has a property no other table here has: it is SELF-scoped, not
// household-scoped. What a member was last shown feeds only their own
// announcement, and a household-scoped write policy would let one phone
// silently mark another member's announcement as seen — the one thing the
// table exists to prevent. Every access claim lives HERE rather than in a
// component test (#36 AC 10): a fake client cannot refuse, so a refusal
// asserted against one proves nothing about the database.
//
// What a pass means: "consistent with Postgres, given the Supabase-shaped
// environment stubbed in support/pgliteSupabase.js" — never "the live project
// is healthy". `0020` was RED in `npm run check:live` by design until it was
// applied — measured both sides in #50's own session, 25 of 26 then 26 of 26 —
// and that check, not this file, is the authority on live state.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asDevice,
  attempt,
  freshDatabase,
  newDevice,
  provisionMember,
} from './support/pgliteSupabase.js'

// Same value and same reasoning as the other pglite suites (#145): the 5000ms
// default is a number nobody chose for a suite that boots a WebAssembly
// Postgres per test. hookTimeout is set once in support/pgliteSupabase.js.
vi.setConfig({ testTimeout: 30_000 })

describe('what a member was last shown, run against a real Postgres', () => {
  let db, personA, personB, outsider
  let organizerA, memberTwo, householdA

  /** The client's write, exactly as PostgREST issues an upsert on the PK. */
  const upsertSeen = (memberId, snapshot, seenAt) =>
    db.query(
      `insert into public.member_split_seen (member_id, snapshot, seen_rebalance_at)
       values ($1, $2::jsonb, $3)
       on conflict (member_id) do update
         set snapshot = excluded.snapshot,
             seen_rebalance_at = excluded.seen_rebalance_at`,
      [memberId, JSON.stringify(snapshot), seenAt],
    )

  /** The client's read — every granted column, no filter beyond the id. */
  const readSeen = async (memberId) => {
    const { rows } = await db.query(
      `select member_id, snapshot, seen_rebalance_at
         from public.member_split_seen where member_id = $1`,
      [memberId],
    )
    return rows[0] ?? null
  }

  beforeEach(async () => {
    db = await freshDatabase()
    personA = await newDevice(db)
    personB = await newDevice(db)
    outsider = await newDevice(db)

    householdA = await asDevice(db, personA, async () => {
      const { rows } = await db.query('select * from public.create_household($1, $2)', [
        'Placeholder Household',
        'Placeholder Organizer',
      ])
      return rows[0]
    })
    organizerA = householdA.organizer_member_id

    const { rows } = await db.query(
      `insert into public.members (household_id, display_name, weekly_minutes)
       values ($1, 'Placeholder Two', 60) returning id`,
      [householdA.id],
    )
    memberTwo = rows[0].id
    await provisionMember(db, memberTwo, personB)

    // The outsider organizes a DIFFERENT household — a real signed-in member,
    // just of somewhere else, which is what makes the cross-household read
    // below a test of scope rather than of authentication.
    await asDevice(db, outsider, () =>
      db.query('select * from public.create_household($1, $2)', [
        'Placeholder Other Household',
        'Placeholder Other Organizer',
      ]),
    )
  })

  // -------------------------------------------------------------------------
  // AC 2 — the record exists, per member, and the upsert path works end to end
  // -------------------------------------------------------------------------

  it('a member records what they were shown and reads it back', async () => {
    await asDevice(db, personA, async () => {
      await upsertSeen(organizerA, { members: [{ id: organizerA, minutes: 90 }] }, null)
      const row = await readSeen(organizerA)
      expect(row.snapshot.members[0].minutes).toBe(90)
      expect(row.seen_rebalance_at).toBeNull()
    })
  })

  it('AC 7: a second look is a correction — the marker advances, one row survives', async () => {
    await asDevice(db, personA, async () => {
      await upsertSeen(organizerA, { members: [] }, null)
      await upsertSeen(organizerA, { members: [] }, '2026-08-27T18:00:00Z')
    })
    const { rows } = await db.query(
      'select count(*)::int as n from public.member_split_seen where member_id = $1',
      [organizerA],
    )
    expect(rows[0].n).toBe(1)
    const marker = await asDevice(db, personA, async () => (await readSeen(organizerA)).seen_rebalance_at)
    expect(marker).not.toBeNull()
  })

  it('AC 2: two members hold two rows, and each sees only their own', async () => {
    await asDevice(db, personA, () => upsertSeen(organizerA, { members: [{ id: organizerA, minutes: 10 }] }, null))
    await asDevice(db, personB, () => upsertSeen(memberTwo, { members: [{ id: memberTwo, minutes: 99 }] }, null))

    // An UNFILTERED read as each person: RLS is what narrows it, not the
    // client's where-clause — which is the difference between a scope and a
    // convention.
    const mineOnly = async () => {
      const { rows } = await db.query('select member_id from public.member_split_seen')
      return rows.map((r) => r.member_id)
    }
    expect(await asDevice(db, personA, mineOnly)).toEqual([organizerA])
    expect(await asDevice(db, personB, mineOnly)).toEqual([memberTwo])
  })

  // -------------------------------------------------------------------------
  // Self-scope — the writes another member's phone must not be able to make
  // -------------------------------------------------------------------------

  it('cannot record a seen-marker for somebody else in the same household', async () => {
    const result = await asDevice(db, personB, () =>
      attempt(() => upsertSeen(organizerA, { members: [] }, '2026-08-27T18:00:00Z')),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/row-level security/i)
  })

  it('cannot advance another member’s marker with an update', async () => {
    await asDevice(db, personA, () => upsertSeen(organizerA, { members: [] }, null))

    // The update policy FILTERS rather than errors: zero rows moved is the
    // refusal. The row is then read back as its owner to prove nothing changed
    // — asserting only the row count would trust the same mechanism twice.
    await asDevice(db, personB, async () => {
      await db.query(
        `update public.member_split_seen set seen_rebalance_at = '2026-08-27T18:00:00Z'
          where member_id = $1`,
        [organizerA],
      )
    })
    const row = await asDevice(db, personA, () => readSeen(organizerA))
    expect(row.seen_rebalance_at).toBeNull()
  })

  it('cannot read across households either', async () => {
    await asDevice(db, personA, () => upsertSeen(organizerA, { members: [] }, null))
    const seen = await asDevice(db, outsider, () => readSeen(organizerA))
    expect(seen).toBeNull()
  })

  // The claim here is unchanged and the MECHANISM behind it moved, so the test
  // is rewritten rather than deleted. Until 0022, `member_id` was outside the
  // update grant and this was refused as `permission denied` — but that was
  // never what held the line, because 0020's policies are SELF-scoped: a member
  // may not name a row that is not theirs, in the USING half or the WITH CHECK
  // half. 0022 grants UPDATE on `member_id` because PostgREST's upsert names it
  // in its SET list, and RLS goes on refusing exactly this, one layer down.
  //
  // Asserting the message rather than only the refusal is deliberate: a
  // `permission denied` here after 0022 would mean the upsert path is broken
  // again, which is the defect 0022 exists for, and the two failures must not
  // be able to wear each other's clothes.
  it('cannot move a row to another member — RLS refuses it, grant or no grant', async () => {
    await asDevice(db, personA, () => upsertSeen(organizerA, { members: [] }, null))
    const result = await asDevice(db, personA, () =>
      attempt(() =>
        db.query('update public.member_split_seen set member_id = $1 where member_id = $2', [
          memberTwo,
          organizerA,
        ]),
      ),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/row-level security policy/i)
  })

  // -------------------------------------------------------------------------
  // #59 — the fairness note's dismissal, one flag on the same row
  // -------------------------------------------------------------------------

  /** The client's dismissal, exactly as PostgREST issues it — an update read
   *  back with RETURNING, which needs the select grant on what it returns. */
  const dismiss = (memberId) =>
    db.query(
      `update public.member_split_seen set fairness_note_dismissed = true
        where member_id = $1
        returning member_id, fairness_note_dismissed`,
      [memberId],
    )

  const readDismissed = async (memberId) => {
    const { rows } = await db.query(
      `select fairness_note_dismissed from public.member_split_seen where member_id = $1`,
      [memberId],
    )
    return rows[0]?.fairness_note_dismissed ?? null
  }

  it('#59: the flag defaults false — a first look has dismissed nothing', async () => {
    await asDevice(db, personA, async () => {
      await upsertSeen(organizerA, { members: [] }, null)
      expect(await readDismissed(organizerA)).toBe(false)
    })
  })

  it('#59 AC 3: a member dismisses their own note, and the routine seen-marker upsert does not un-dismiss it', async () => {
    await asDevice(db, personA, async () => {
      await upsertSeen(organizerA, { members: [] }, null)
      const { rows } = await dismiss(organizerA)
      expect(rows).toHaveLength(1)
      expect(rows[0].fairness_note_dismissed).toBe(true)

      // The load-bearing half. Every refresh runs this upsert, so if its
      // conflict-update touched the flag, a dismissal would survive exactly
      // until the next tab switch — "does not reappear every time" (AC 3)
      // would be false in the way no component test can see.
      await upsertSeen(organizerA, { members: [] }, '2026-08-28T18:00:00Z')
      expect(await readDismissed(organizerA)).toBe(true)
    })
  })

  it('#59: cannot dismiss another member’s note — the update filters, and their flag stays false', async () => {
    await asDevice(db, personA, () => upsertSeen(organizerA, { members: [] }, null))
    const { rows } = await asDevice(db, personB, () => dismiss(organizerA))
    expect(rows).toHaveLength(0)
    expect(await asDevice(db, personA, () => readDismissed(organizerA))).toBe(false)
  })

  it('anon holds nothing on the table', async () => {
    await db.exec('set role anon')
    try {
      const result = await attempt(() => db.query('select * from public.member_split_seen'))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/permission denied/i)
    } finally {
      await db.exec('reset role')
    }
  })

  // -------------------------------------------------------------------------
  // The shapes the schema itself holds
  // -------------------------------------------------------------------------

  it('refuses a snapshot that is not an object', async () => {
    const result = await asDevice(db, personA, () =>
      attempt(() => upsertSeen(organizerA, [1, 2, 3], null)),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/member_split_seen_snapshot_is_object/)
  })

  it('the row dies with its member', async () => {
    await asDevice(db, personA, () => upsertSeen(organizerA, { members: [] }, null))
    await db.query('delete from public.members where id = $1', [organizerA])
    const { rows } = await db.query(
      'select count(*)::int as n from public.member_split_seen where member_id = $1',
      [organizerA],
    )
    expect(rows[0].n).toBe(0)
  })

  it('POSITIVE CONTROL: the harness would show a widened write — the refusals above are grants and policies, not accidents', async () => {
    // As the owning role, the same statements the self-scope tests saw refused
    // all succeed: the refusals came from the layer under test, not from the
    // fixture being broken.
    await upsertSeen(organizerA, { members: [] }, '2026-08-27T18:00:00Z')
    const { rows } = await db.query(
      'select seen_rebalance_at from public.member_split_seen where member_id = $1',
      [organizerA],
    )
    expect(rows[0].seen_rebalance_at).not.toBeNull()
  })
})
