import { beforeEach, describe, expect, it, vi } from 'vitest'

// The data layer, exercised against a fake Supabase client.
//
// This file deliberately does NOT test the access rules. It cannot: the rules
// live in Postgres and a fake client would happily return whatever this file
// told it to. AC 6 is `src/test/rls.integration.test.js`, which goes over the
// wire. What is tested here is the layer above — that the app asks the right
// questions and refuses the obviously wrong ones before a round trip.
//
// Every name below is synthetic. #19 has not yet settled whether a real
// household member's name may appear in a fixture, and until it does the answer
// is treated as no.

const calls = []
let results = {}
let authState = {}

/**
 * A chainable stand-in for supabase-js's query builder. It is thenable, like
 * the real one, so `await client.from('x').select('*')` resolves without a
 * terminal method.
 */
function makeQuery(table) {
  const result = () => results[table] ?? { data: null, error: null }
  const q = {
    select(cols) {
      calls.push({ op: 'select', table, cols })
      return q
    },
    order() {
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
    maybeSingle: () => Promise.resolve(result()),
    single: () => Promise.resolve(result()),
    then: (onOk, onErr) => Promise.resolve(result()).then(onOk, onErr),
  }
  return q
}

const fakeClient = {
  from: (table) => makeQuery(table),
  rpc: (name, args) => {
    calls.push({ op: 'rpc', name, args })
    return Promise.resolve(results[name] ?? { data: null, error: null })
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session: authState.session ?? null } }),
    getUser: () => Promise.resolve({ data: { user: authState.user ?? null } }),
    signInAnonymously: () => {
      calls.push({ op: 'signInAnonymously' })
      return Promise.resolve(
        authState.signInError
          ? { data: null, error: { message: authState.signInError } }
          : { data: { session: { user: { id: 'new-device' } } }, error: null },
      )
    },
  },
}

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => fakeClient,
}))

const {
  addMember,
  claimMember,
  claimMemberWithPin,
  currentHousehold,
  createHousehold,
  deviceTimezone,
  ensureSession,
  findClaimedMember,
  formatMinutes,
  joinHousehold,
  listMembers,
  normalizeMinutes,
  setMemberPin,
  updateMember,
} = await import('./household.js')

beforeEach(() => {
  calls.length = 0
  results = {}
  authState = {}
})

describe('weekly minutes', () => {
  // Expected values are written out rather than computed, so a change in the
  // implementation cannot quietly redefine what "correct" means here.
  it.each([
    [0, 0],
    [1, 1],
    [119.4, 119],
    [119.6, 120],
    [10080, 10080],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMinutes(input)).toBe(expected)
  })

  it('refuses a negative budget in words a parent can act on', () => {
    // Matching our own wording, not a bare toThrow(): a bare assertion is
    // satisfied by ANY throw, including one from a library, so it cannot tell
    // "the guard fired" from "the code broke".
    expect(() => normalizeMinutes(-1)).toThrow(/cannot be negative/i)
  })

  it('refuses more minutes than a week contains', () => {
    expect(() => normalizeMinutes(10081)).toThrow(/only 10080 minutes/i)
  })

  it('refuses something that is not a number at all', () => {
    expect(() => normalizeMinutes('not a number')).toThrow(/must be a number/i)
  })

  it.each([
    [0, '0m'],
    [59, '59m'],
    [60, '1h 0m'],
    [125, '2h 5m'],
    [600, '10h 0m'],
  ])('formats %s minutes as %s', (input, expected) => {
    expect(formatMinutes(input)).toBe(expected)
  })
})

describe('which member this device is acting as', () => {
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', claimed_by: null },
    { id: 'm2', display_name: 'Placeholder Two', claimed_by: 'device-b' },
  ]

  it('finds the member claimed by this device', () => {
    expect(findClaimedMember(roster, 'device-b')?.id).toBe('m2')
  })

  it('is nobody when this device has claimed nobody', () => {
    expect(findClaimedMember(roster, 'device-a')).toBeNull()
  })

  // The guard that matters. An unclaimed member has `claimed_by === null`, so a
  // null device id would match the FIRST UNCLAIMED PERSON and silently attribute
  // this device's work to them. Deleting the null check in findClaimedMember
  // must redden this.
  it('is nobody when there is no device id, rather than the first unclaimed person', () => {
    expect(findClaimedMember(roster, null)).toBeNull()
  })
})

describe('signing this device in', () => {
  it('reuses an existing session instead of creating a second anonymous user', async () => {
    authState.session = { user: { id: 'already-here' } }
    const session = await ensureSession()

    expect(session.user.id).toBe('already-here')
    expect(calls.filter((c) => c.op === 'signInAnonymously')).toHaveLength(0)
  })

  it('signs in anonymously when there is no session yet', async () => {
    const session = await ensureSession()

    expect(session.user.id).toBe('new-device')
    expect(calls.filter((c) => c.op === 'signInAnonymously')).toHaveLength(1)
  })

  it('says the provider may be disabled, because that failure does not say so itself', async () => {
    authState.signInError = 'Anonymous sign-ins are disabled'
    await expect(ensureSession()).rejects.toThrow(/Anonymous Sign-Ins are enabled/i)
  })

  it('distinguishes the per-IP rate limit, which presents as a bug in our own code', async () => {
    authState.signInError = 'Request rate limit reached'
    await expect(ensureSession()).rejects.toThrow(/from this network in the last hour/i)
  })
})

describe('finding the household this device belongs to', () => {
  it('is null when this device has joined nothing, rather than an error', async () => {
    results.household_devices = { data: null, error: null }
    await expect(currentHousehold()).resolves.toBeNull()
  })

  it('loads the household named by the membership row', async () => {
    results.household_devices = { data: { household_id: 'h1' }, error: null }
    results.households = { data: { id: 'h1', name: 'Placeholder Household' }, error: null }

    await expect(currentHousehold()).resolves.toMatchObject({ id: 'h1' })
    expect(calls).toContainEqual({ op: 'eq', table: 'households', column: 'id', value: 'h1' })
  })

  it('names what it was doing when the query fails, not just the driver message', async () => {
    results.household_devices = { data: null, error: { message: 'connection reset' } }
    await expect(currentHousehold()).rejects.toThrow(
      /checking whether this device has joined a household: connection reset/,
    )
  })
})

describe('maintaining the roster', () => {
  beforeEach(() => {
    results.household_devices = { data: { household_id: 'h1' }, error: null }
    results.households = { data: { id: 'h1', name: 'Placeholder Household' }, error: null }
    results.members = { data: { id: 'm9' }, error: null }
  })

  it('writes into the household this device belongs to, not one the caller names', async () => {
    // The security claim this mirrors is enforced by RLS, not here. What this
    // asserts is that the app never even asks to write elsewhere, so a refusal
    // from the database would mean something has genuinely gone wrong.
    await addMember({ displayName: 'Placeholder One', weeklyMinutes: 120, household_id: 'somewhere-else' })

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row.household_id).toBe('h1')
    expect(insert.row).toMatchObject({ display_name: 'Placeholder One', weekly_minutes: 120 })
  })

  it('trims a name before storing it', async () => {
    await addMember({ displayName: '  Placeholder One  ', weeklyMinutes: 0 })
    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row.display_name).toBe('Placeholder One')
  })

  it('refuses a blank name before spending a round trip', async () => {
    await expect(addMember({ displayName: '   ', weeklyMinutes: 60 })).rejects.toThrow(
      /needs a name/i,
    )
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0)
  })

  it('refuses to add anyone when this device has joined no household', async () => {
    results.household_devices = { data: null, error: null }
    await expect(addMember({ displayName: 'Placeholder One', weeklyMinutes: 60 })).rejects.toThrow(
      /has not joined a household/i,
    )
  })

  it('edits only the fields it was given', async () => {
    await updateMember('m9', { weeklyMinutes: 240 })
    const update = calls.find((c) => c.op === 'update')
    expect(update.patch).toEqual({ weekly_minutes: 240 })
  })

  it('validates an edited budget with the same rule as a new one', async () => {
    await expect(updateMember('m9', { weeklyMinutes: -5 })).rejects.toThrow(/cannot be negative/i)
  })

  it('lists an empty roster as an empty array, never null', async () => {
    results.members = { data: null, error: null }
    await expect(listMembers()).resolves.toEqual([])
  })
})

describe('the two ways into a household', () => {
  it('creates a household through the server function, never a direct insert', async () => {
    results.create_household = { data: { id: 'h1', join_code: 'ABCD2345' }, error: null }
    const household = await createHousehold('  Placeholder Household  ', {
      organizerName: '  Placeholder Organizer  ',
      organizerPin: '4821',
    })

    expect(household.join_code).toBe('ABCD2345')
    // The organizer and their PIN go in the SAME call. A household that exists
    // for even one round trip without an organizer is one nobody can administer,
    // and is_household_organizer() fails closed on it.
    expect(calls).toContainEqual({
      op: 'rpc',
      name: 'create_household',
      args: {
        household_name: 'Placeholder Household',
        organizer_name: 'Placeholder Organizer',
        organizer_pin: '4821',
        // #44: the household's timezone goes in the same statement too, and for
        // a related reason — a week boundary is a local-time fact, and a second
        // round trip to set it can fail on its own, leaving the household filing
        // capacity under UTC weeks nobody lives in.
        household_tz: deviceTimezone(),
      },
    })
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'households')).toHaveLength(0)
  })

  it('sends a REAL zone from this device, not a placeholder — #44 AC 6', async () => {
    // Asserting `household_tz: deviceTimezone()` above compares the code to
    // itself: it passes whatever both say, including both wrong together. This
    // is the half that says the value is an actual IANA zone the device
    // resolved, so a 4th parameter nobody meaningfully fills would fail here.
    results.create_household = { data: { id: 'h1', join_code: 'ABCD2345' }, error: null }
    await createHousehold('A Household', {
      organizerName: 'Organizer',
      organizerPin: '4821',
    })
    const call = calls.find((c) => c.op === 'rpc' && c.name === 'create_household')
    expect(call.args.household_tz).toMatch(/^[A-Za-z]+\/[A-Za-z_+-]+$|^UTC$/)
    expect(Intl.DateTimeFormat(undefined, { timeZone: call.args.household_tz })).toBeTruthy()
  })

  it('refuses a household with no name', async () => {
    await expect(createHousehold('  ')).rejects.toThrow(/needs a name/i)
  })

  it('sends the code to the server rather than validating the alphabet locally', async () => {
    results.join_household = { data: { id: 'h1' }, error: null }
    await joinHousehold('abcd-2345')

    // Passed through as typed. The server normalises, and it is the only holder
    // of the alphabet — a second copy here could drift and reject a valid code.
    expect(calls).toContainEqual({ op: 'rpc', name: 'join_household', args: { code: 'abcd-2345' } })
  })

  it('surfaces the deliberately vague refusal without decorating it', async () => {
    results.join_household = { data: null, error: { message: 'no household matches that code' } }
    await expect(joinHousehold('ZZZZZZZZ')).rejects.toThrow(/no household matches that code/)
  })

  it('claims a person through the server function, so a race is serialised there', async () => {
    results.claim_member = { data: { id: 'm9' }, error: null }
    await claimMember('m9')

    expect(calls).toContainEqual({ op: 'rpc', name: 'claim_member', args: { member_id: 'm9' } })
    expect(calls.filter((c) => c.op === 'update' && c.table === 'members')).toHaveLength(0)
  })
})

describe('per-member credentials', () => {
  it('sets a PIN through the server function — there is no column a client could write', async () => {
    // members.pin_hash is not in the grant list in migration 0002, so a direct
    // update is refused by Postgres. This asserts the app does not even try,
    // which is manners; the database is what makes it a rule.
    results.set_member_pin = { data: { id: 'm1', has_pin: true }, error: null }
    await setMemberPin('m1', '4821')
    expect(calls).toContainEqual({
      op: 'rpc',
      name: 'set_member_pin',
      args: { member_id: 'm1', new_pin: '4821' },
    })
    expect(calls.filter((c) => c.op === 'update' && c.table === 'members')).toHaveLength(0)
  })

  it('refuses a PIN too short to be one before spending a round trip', async () => {
    await expect(setMemberPin('m1', '12')).rejects.toThrow(/between 4 and 12/i)
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(0)
  })

  it('claims a person by proving you are them, via the PIN route', async () => {
    results.claim_member_with_pin = { data: { id: 'm1' }, error: null }
    await claimMemberWithPin('m1', '4821')
    expect(calls).toContainEqual({
      op: 'rpc',
      name: 'claim_member_with_pin',
      args: { member_id: 'm1', pin: '4821' },
    })
  })

  it('never asks for pin_hash, because the grants would refuse the whole select', async () => {
    // `select('*')` on members now fails outright rather than quietly omitting
    // the column, so this is a working/not-working distinction, not tidiness.
    results.members = { data: [], error: null }
    await listMembers()
    const selects = calls.filter((c) => c.op === 'select' && c.table === 'members')
    expect(selects.length).toBeGreaterThan(0)
    for (const call of selects) {
      expect(call.cols).not.toBe('*')
      expect(call.cols).not.toMatch(/pin_hash/)
      expect(call.cols).toMatch(/has_pin/)
    }
  })

  it('creating a household needs an organizer name, not just a household name', async () => {
    await expect(createHousehold('A Household', { organizerPin: '4821' })).rejects.toThrow(
      /organizer needs a name/i,
    )
  })

  it('creating a household needs a usable organizer PIN', async () => {
    await expect(
      createHousehold('A Household', { organizerName: 'Placeholder Organizer', organizerPin: '1' }),
    ).rejects.toThrow(/between 4 and 12/i)
  })
})
