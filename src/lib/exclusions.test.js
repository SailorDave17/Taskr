import { beforeEach, describe, expect, it, vi } from 'vitest'

// #37 — the exclusion data layer, both halves.
//
// One file rather than the pure/impure split chores.js has, because the pure
// half here is three folds over an array with no validators and no zone
// arithmetic — a second file would be two imports and four lines of test. The
// `vi.mock` below is the reason that split exists elsewhere, so it is worth
// stating why it is safe here: nothing in the pure describes touches the client,
// and if that stops being true the split is the repair.
//
// What this does NOT test, and cannot: the access rules. A fake client returns
// whatever this file tells it to, so it can neither refuse nor enforce. Every
// rule about who may write an exclusion, which household it may name, and what
// happens when a member is deleted lives in Postgres and is exercised by
// src/test/exclusions.pglite.test.js. Same division household.test.js states and
// #36 AC 10 turned into a check.
//
// Names are synthetic — see #19.

const calls = []
let results = {}

/** Chainable, thenable stand-in for supabase-js's query builder. */
function makeQuery(table) {
  const result = () => results[table] ?? { data: null, error: null }
  const q = {
    select(cols) {
      calls.push({ op: 'select', table, cols })
      return q
    },
    eq(column, value) {
      calls.push({ op: 'eq', table, column, value })
      return q
    },
    insert(row) {
      calls.push({ op: 'insert', table, row })
      return q
    },
    update(patch) {
      calls.push({ op: 'update', table, patch })
      return q
    },
    delete() {
      calls.push({ op: 'delete', table })
      return q
    },
    single: () => Promise.resolve(result()),
    then: (onOk, onErr) => Promise.resolve(result()).then(onOk, onErr),
  }
  return q
}

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => ({ from: (table) => makeQuery(table) }),
}))

const currentHousehold = vi.fn()
vi.mock('./household.js', async () => {
  const actual = await vi.importActual('./household.js')
  return { ...actual, currentHousehold: (...a) => currentHousehold(...a) }
})

const {
  EXCLUSION_COLUMNS,
  allowMember,
  eligibleMembers,
  excludeMember,
  excludedMemberIds,
  isExcluded,
  listExclusions,
} = await import('./exclusions.js')

const HOUSEHOLD = { id: 'h1', name: 'Placeholder Household' }
const members = [
  { id: 'm1', display_name: 'Placeholder One' },
  { id: 'm2', display_name: 'Placeholder Two' },
  { id: 'm3', display_name: 'Placeholder Three' },
]
const exclusions = [
  { id: 'x1', chore_id: 'c1', member_id: 'm2', created_at: '2026-08-21T00:00:00Z' },
  { id: 'x2', chore_id: 'c2', member_id: 'm3', created_at: '2026-08-21T00:00:00Z' },
]

const opsOn = (table) => calls.filter((c) => c.table === table)

beforeEach(() => {
  calls.length = 0
  results = {}
  currentHousehold.mockReset()
  currentHousehold.mockResolvedValue(HOUSEHOLD)
})

describe('listExclusions', () => {
  it('asks for the granted columns by name, never a wildcard', async () => {
    results.chore_exclusions = { data: exclusions, error: null }
    await listExclusions()

    const select = opsOn('chore_exclusions').find((c) => c.op === 'select')
    expect(select.cols).toBe(EXCLUSION_COLUMNS)
    // Not a style preference: 0010 withholds household_id from the select grant,
    // so `select('*')` fails outright at the server rather than omitting it.
    expect(select.cols).not.toContain('*')
  })

  it('reads the whole set rather than one chore at a time', async () => {
    // The screen renders every chore at once. A per-chore read would be one
    // round trip per row to answer a question the whole set answers in one, and
    // it would make the number of requests grow with the household's week.
    results.chore_exclusions = { data: exclusions, error: null }
    await listExclusions()
    expect(opsOn('chore_exclusions').filter((c) => c.op === 'eq')).toEqual([])
  })

  it('returns an empty array when the table is empty, so callers never fold over null', async () => {
    results.chore_exclusions = { data: null, error: null }
    expect(await listExclusions()).toEqual([])
  })
})

describe('excludeMember', () => {
  it('writes exactly one row, naming this device’s household', async () => {
    results.chore_exclusions = { data: exclusions[0], error: null }
    await excludeMember('c1', 'm2')

    const insert = opsOn('chore_exclusions').find((c) => c.op === 'insert')
    expect(insert.row).toEqual({ household_id: 'h1', chore_id: 'c1', member_id: 'm2' })
  })

  it('takes the household from the session rather than from the caller', async () => {
    // `addChore`'s rule, and the same reason: the UI does not get to choose which
    // household it writes into. The with-check policy in 0010 would refuse any
    // other value, and this keeps the client from ever trying.
    results.chore_exclusions = { data: exclusions[0], error: null }
    await excludeMember('c1', 'm2')
    expect(currentHousehold).toHaveBeenCalled()
  })

  it('refuses before any request when there is no household', async () => {
    currentHousehold.mockResolvedValue(null)
    await expect(excludeMember('c1', 'm2')).rejects.toThrow(/not signed in to a household/i)
    expect(opsOn('chore_exclusions')).toEqual([])
  })

  it('refuses a missing chore or person, rather than sending a row with a null in it', async () => {
    // A dropped variable would otherwise become a `not null` violation reported
    // as "recording that they cannot do this chore: null value in column...",
    // which reads like the database rejecting a legitimate act.
    await expect(excludeMember(null, 'm2')).rejects.toThrow(/which chore/i)
    await expect(excludeMember('c1', null)).rejects.toThrow(/who cannot do it/i)
    expect(opsOn('chore_exclusions')).toEqual([])
  })

  it('turns a duplicate into a sentence about the household, not about Postgres', async () => {
    // 23505 on this table can only be `chore_exclusions_one_per_pair`. The screen
    // never offers an already-excluded person, so this arrives when two devices
    // act at once — and the row the person wanted exists either way.
    results.chore_exclusions = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }
    await expect(excludeMember('c1', 'm2')).rejects.toThrow(/already marked as unable/i)
    await expect(excludeMember('c1', 'm2')).rejects.not.toThrow(/duplicate key/i)
  })

  it('POSITIVE CONTROL: any other error still surfaces with its own message', async () => {
    // Without this, the translation above is indistinguishable from one that
    // swallows every failure into one reassuring sentence.
    results.chore_exclusions = {
      data: null,
      error: { code: '42501', message: 'permission denied for table chore_exclusions' },
    }
    await expect(excludeMember('c1', 'm2')).rejects.toThrow(/permission denied/i)
  })
})

describe('allowMember', () => {
  it('deletes the pair, keyed on both halves', async () => {
    await allowMember('c1', 'm2')

    const ops = opsOn('chore_exclusions')
    expect(ops.some((c) => c.op === 'delete')).toBe(true)
    expect(ops.filter((c) => c.op === 'eq')).toEqual([
      { op: 'eq', table: 'chore_exclusions', column: 'chore_id', value: 'c1' },
      { op: 'eq', table: 'chore_exclusions', column: 'member_id', value: 'm2' },
    ])
  })

  it('never issues an UPDATE, because 0010 grants none', async () => {
    // An exclusion has no editable content. A "revoked" flag would be a second
    // way to express eligibility that the SQL predicate would then have to agree
    // with — one representation, and absence is the default.
    await allowMember('c1', 'm2')
    expect(opsOn('chore_exclusions').some((c) => c.op === 'update')).toBe(false)
  })
})

describe('isExcluded — the screen’s mirror of is_member_eligible', () => {
  it('is true only for a pair that has a row', () => {
    expect(isExcluded(exclusions, 'c1', 'm2')).toBe(true)
    expect(isExcluded(exclusions, 'c1', 'm3')).toBe(false)
    expect(isExcluded(exclusions, 'c2', 'm2')).toBe(false)
  })

  it('is false when there are no exclusions at all — the state a household starts in', () => {
    expect(isExcluded([], 'c1', 'm2')).toBe(false)
  })

  it('is false for an absent person, which an unassigned chore asks on every render', () => {
    expect(isExcluded(exclusions, 'c1', null)).toBe(false)
    expect(isExcluded(exclusions, 'c1', undefined)).toBe(false)
    expect(isExcluded(exclusions, null, 'm2')).toBe(false)
  })

  it('SYNTHETIC CONTROL: and still false against a row the database could not have sent', () => {
    // MEASURED during the mutation pass: with only the test above, deleting the
    // absent-id guard reddens NOTHING. Both columns are `not null` in 0010, so no
    // real row carries a null and the comparison is false whether the guard is
    // there or not — an unexercised defence, which is indistinguishable from dead
    // code to whoever is next tidying up.
    //
    // These rows cannot come from the database. That is the point: they are the
    // only way to make the guard observable, and without them the line survives
    // on the reader's goodwill rather than on evidence.
    const malformed = [
      ...exclusions,
      { id: 'x8', chore_id: 'c1', member_id: null },
      { id: 'x9', chore_id: null, member_id: 'm2' },
    ]
    expect(isExcluded(malformed, 'c1', null)).toBe(false)
    expect(isExcluded(malformed, null, 'm2')).toBe(false)
    // POSITIVE CONTROL: the same malformed set still answers the real question,
    // so the two assertions above are the guard rather than a broken fold.
    expect(isExcluded(malformed, 'c1', 'm2')).toBe(true)
  })
})

describe('excludedMemberIds', () => {
  it('returns the people excluded from one chore and nobody else', () => {
    expect(excludedMemberIds(exclusions, 'c1')).toEqual(['m2'])
    expect(excludedMemberIds(exclusions, 'c2')).toEqual(['m3'])
    expect(excludedMemberIds(exclusions, 'c3')).toEqual([])
  })

  it('returns nothing for an absent chore rather than every row', () => {
    expect(excludedMemberIds(exclusions, null)).toEqual([])
  })

  it('SYNTHETIC CONTROL: and nothing against a null-keyed row either', () => {
    // Same measurement, same reason as isExcluded's control above: `chore_id` is
    // `not null`, so without a row the database could not send, deleting this
    // guard reddens nothing at all.
    const malformed = [...exclusions, { id: 'x9', chore_id: null, member_id: 'm2' }]
    expect(excludedMemberIds(malformed, null)).toEqual([])
    expect(excludedMemberIds(malformed, 'c1'), 'the real question still answers').toEqual(['m2'])
  })
})

describe('eligibleMembers — the screen’s mirror of eligible_members', () => {
  it('leaves out the excluded and keeps everyone else', () => {
    expect(eligibleMembers(members, exclusions, 'c1').map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('is the whole roster when nothing is excluded', () => {
    expect(eligibleMembers(members, [], 'c1')).toHaveLength(3)
  })

  it('is in ROSTER order, never an order derived from the exclusions', () => {
    // `commitmentByMember`'s rule: any other order is a ranking, and a household
    // must not be able to read "who is most eligible" off a list that was only
    // ever meant to say who is allowed. Asserted against a fixture whose
    // exclusion names the LAST member, so a filter that appended survivors in
    // exclusion order would come back in a different sequence.
    const late = [{ id: 'x3', chore_id: 'c4', member_id: 'm1' }]
    expect(eligibleMembers(members, late, 'c4').map((m) => m.id)).toEqual(['m2', 'm3'])
  })

  it('returns the EMPTY array when everyone is excluded, not the whole roster', () => {
    // AC 5's JavaScript half. Falling back to everyone is the failure that would
    // be silent and plausible — three names on screen, and an allocator handing
    // the mower to the six-year-old.
    const all = members.map((m, i) => ({ id: `x${i}`, chore_id: 'c9', member_id: m.id }))
    expect(eligibleMembers(members, all, 'c9')).toEqual([])
  })
})
