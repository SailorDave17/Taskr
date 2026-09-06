import { beforeEach, describe, expect, it, vi } from 'vitest'

// The data layer, exercised against a fake Supabase client.
//
// This file deliberately does NOT test the access rules. It cannot: the rules
// live in Postgres and a fake client would happily return whatever this file
// told it to. AC 6 is `src/test/rls.integration.test.js`, which goes over the
// wire. What is tested here is the layer above — that the app asks the right
// questions and refuses the obviously wrong ones before a round trip.
//
// Every name below is synthetic, and since #19 that is a RULE rather than a
// habit: docs/data-outside-production.md, enforced by the #19 block in
// src/test/gate.test.js. Adding a name here means adding it to the declared
// vocabulary, in a diff, where somebody can see it.

const calls = []
let results = {}
let authState = {}
let invokeResult = null

/**
 * A chainable stand-in for supabase-js's query builder. It is thenable, like
 * the real one, so `await client.from('x').select('*')` resolves without a
 * terminal method.
 */
function makeQuery(table) {
  // A table's scripted result may be an ARRAY, consumed one entry per
  // resolution — #247's removeMember issues a read and then a delete against
  // the same table in one call, and the two must be able to answer
  // differently. A plain object keeps the old behaviour: every resolution
  // answers the same.
  const result = () => {
    const scripted = results[table]
    if (Array.isArray(scripted)) return scripted.shift() ?? { data: null, error: null }
    return scripted ?? { data: null, error: null }
  }
  const q = {
    select(cols) {
      calls.push({ op: 'select', table, cols })
      return q
    },
    // #159 - this recorded NOTHING until now, so the ordering of any read in
    // this file was structurally unobservable and an assertion about it would
    // have passed against a query with no `order by` at all. AC 2 turns on that
    // ordering, so the fake has to be able to see it.
    order(column, options) {
      calls.push({ op: 'order', table, column, ascending: options?.ascending })
      return q
    },
    limit(n) {
      calls.push({ op: 'limit', table, n })
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
  // #87 - the Edge Function is the only route to an auth identity, so the layer
  // above it is worth testing even though the function itself is not reachable
  // from here. What is asserted below is how a FAILURE is reported, which is the
  // half a person actually reads.
  functions: {
    invoke: (name, options) => {
      calls.push({ op: 'invoke', name, body: options?.body })
      return Promise.resolve(invokeResult ?? { data: null, error: null })
    },
  },
  rpc: (name, args) => {
    calls.push({ op: 'rpc', name, args })
    return Promise.resolve(results[name] ?? { data: null, error: null })
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session: authState.session ?? null } }),
    getUser: () => Promise.resolve({ data: { user: authState.user ?? null } }),
    // `signInAnonymously` stood here until #62. It is gone rather than left
    // unused: a stub for a call the app must never make again would let a
    // regression pass, and its absence turns one into a TypeError naming the
    // method.
    // #304 — records the ARGUMENTS, for #291's reason: a fake that pushed only
    // `{ op }` would pass identically whichever provider or redirect the call
    // named. The real one navigates the browser; this one does not, which is
    // what makes the redirect address assertable at all.
    signInWithOAuth: (args) => {
      calls.push({ op: 'signInWithOAuth', args })
      return Promise.resolve(
        authState.oauthError
          ? { data: { provider: args.provider, url: null }, error: { message: authState.oauthError } }
          : { data: { provider: args.provider, url: 'https://auth.example.test/authorize' }, error: null },
      )
    },
    signInWithPassword: (credentials) => {
      calls.push({ op: 'signInWithPassword', credentials })
      return Promise.resolve(
        authState.signInError
          ? { data: null, error: { message: authState.signInError } }
          : { data: { session: { user: { id: 'person-1' } } }, error: null },
      )
    },
    signUp: (credentials) => {
      calls.push({ op: 'signUp', credentials })
      if (authState.signUpError) {
        return Promise.resolve({ data: null, error: { message: authState.signUpError } })
      }
      return Promise.resolve({
        data: { session: authState.signUpNeedsConfirmation ? null : { user: { id: 'organizer-1' } } },
        error: null,
      })
    },
    // #291 — records the OPTIONS, not just the call. The old fake took no
    // argument and pushed `{ op: 'signOut' }`, so a test asserting the call
    // happened passed identically whichever scope the call was made with,
    // which is exactly how a `global` default shipped unnoticed.
    signOut: (options) => {
      calls.push({ op: 'signOut', options })
      return Promise.resolve({ error: authState.signOutError ? { message: authState.signOutError } : null })
    },
  },
}

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => fakeClient,
}))

const {
  addMember,
  confirmationRedirectTo,
  currentHousehold,
  listHouseholds,
  createHousehold,
  currentSession,
  describeSignInReturn,
  deviceTimezone,
  findClaimedMember,
  formatMinutes,
  listMembers,
  normalizeMemberEmail,
  normalizeMinutes,
  provisionMember,
  readSignInReturn,
  removeMember,
  signInAddressFor,
  resetMemberCredential,
  signIn,
  signInWithGoogle,
  signOut,
  signUpOrganizer,
  updateMember,
} = await import('./household.js')

beforeEach(() => {
  calls.length = 0
  results = {}
  authState = {}
  invokeResult = null
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

  // #160 — one person, two households. Since 0009 the same auth id can hold a
  // claimed member row in TWO households, and this function used to match
  // across whatever list it was handed.
  describe('within the active household — #160', () => {
    // Both rows claimed by the SAME person, the foreign household's row FIRST,
    // because list order is exactly what the unscoped match decides by.
    const twoHouseholds = [
      { id: 'm-b2', household_id: 'h-b', display_name: 'Placeholder Two', claimed_by: 'person-a' },
      { id: 'm-a1', household_id: 'h-a', display_name: 'Placeholder One', claimed_by: 'person-a' },
    ]

    it('AC 1, the hazard on record: unscoped, list order decides who you are', () => {
      // The pre-#160 behaviour, kept as a demonstration the same way
      // household-scoping.pglite.test.js keeps the unfiltered roster read: the
      // answer is not wrong, it is ARBITRARY — reverse the list and it changes.
      expect(findClaimedMember(twoHouseholds, 'person-a')?.id).toBe('m-b2')
      expect(findClaimedMember([...twoHouseholds].reverse(), 'person-a')?.id).toBe('m-a1')
    })

    it('AC 2: scoped, the active household’s row comes back whatever order the list is in', () => {
      expect(findClaimedMember(twoHouseholds, 'person-a', 'h-a')?.id).toBe('m-a1')
      expect(findClaimedMember([...twoHouseholds].reverse(), 'person-a', 'h-a')?.id).toBe('m-a1')
      expect(findClaimedMember(twoHouseholds, 'person-a', 'h-b')?.id).toBe('m-b2')
    })

    it('AC 2: nobody in a household where this person holds no claimed row — never a foreign fallback', () => {
      expect(findClaimedMember(twoHouseholds, 'person-a', 'h-c')).toBeNull()
    })

    it('a row that does not say its household is taken at face value', () => {
      // Every real read includes household_id (it is in MEMBER_COLUMNS), so
      // this tolerance never fires on data. It is what lets every pre-#160
      // caller and fixture — rosters with no household_id key — keep exactly
      // the old behaviour (#160 AC 6) rather than silently losing identity.
      const bare = [{ id: 'm1', claimed_by: 'person-a' }]
      expect(findClaimedMember(bare, 'person-a', 'h-a')?.id).toBe('m1')
    })
  })
})

describe('signing in as a person', () => {
  // #62. Every test in this block replaced one about anonymous DEVICE sign-in,
  // and the difference they are all circling is that a session is now acquired
  // deliberately by somebody rather than minted on boot for a phone.

  it('reports no session rather than creating one', async () => {
    // The behaviour reversal. `ensureSession()` promised a session and made one;
    // this returns null and the app answers with a sign-in screen. A stub that
    // still signed in anonymously would leave every caller's null-check dead.
    await expect(currentSession()).resolves.toBeNull()
    expect(calls.filter((c) => c.op === 'signUp' || c.op === 'signInWithPassword')).toHaveLength(0)
  })

  it('returns the existing session when there is one', async () => {
    authState.session = { user: { id: 'already-here' } }
    await expect(currentSession()).resolves.toMatchObject({ user: { id: 'already-here' } })
  })

  it('signs a person in with the credential they hold', async () => {
    const session = await signIn({ email: '  alex@example.com  ', password: '4821' })
    expect(session.user.id).toBe('person-1')
    // Trimmed, because a phone keyboard offers a trailing space after an
    // autocompleted address and the auth endpoint does not forgive one.
    expect(calls).toContainEqual({
      op: 'signInWithPassword',
      credentials: { email: 'alex@example.com', password: '4821' },
    })
  })

  it('keeps the refusal vague, because a household is a small closed set of people', async () => {
    // Supabase answers a wrong password and an unknown address identically. This
    // asserts we do not helpfully undo that: "no such account" would tell a
    // guesser which addresses exist, and there are only a handful.
    authState.signInError = 'Invalid login credentials'
    await expect(signIn({ email: 'nobody@example.com', password: 'x' })).rejects.toThrow(
      /did not match/i,
    )
    await expect(signIn({ email: 'nobody@example.com', password: 'x' })).rejects.not.toThrow(
      /no such|unknown|not found/i,
    )
  })

  it('names an unconfirmed email instead of blaming the password', async () => {
    // Collapsed, this told somebody holding the RIGHT password to try again
    // forever. It leaks nothing: GoTrue checks the password BEFORE confirmation
    // state, so this code only reaches a caller who already proved they hold it.
    authState.signInError = 'Email not confirmed'
    await expect(signIn({ email: 'alex@example.com', password: 'right' })).rejects.toThrow(
      /needs its email confirmed/i,
    )
  })

  it('names the shared-NAT rate limit, which presents as a credential fault', async () => {
    // `ensureSession` carried this branch and it was dropped when the call
    // changed to signInWithPassword. The reasoning did not stop applying: a
    // household is one IP, so several people signing in on one evening trip it.
    authState.signInError = 'Request rate limit reached'
    await expect(signIn({ email: 'alex@example.com', password: 'right' })).rejects.toThrow(
      /too many sign-in attempts/i,
    )
  })

  it('POSITIVE CONTROL: an ordinary refusal is still the vague one', () => {
    // Without this, widening the branches until everything is named would pass
    // every test above while undoing the enumeration protection entirely.
    authState.signInError = 'Invalid login credentials'
    return expect(signIn({ email: 'nobody@example.com', password: 'x' })).rejects.toThrow(
      /did not match/i,
    )
  })

  it('creates the organizer their own account, which is the one signup a client may do', async () => {
    const result = await signUpOrganizer({ email: 'alex@example.com', password: 'longenough' })
    expect(result.session.user.id).toBe('organizer-1')
    expect(result.needsConfirmation).toBe(false)
    // The address and password only. `options.emailRedirectTo` rides on the
    // same object since #129 and has three tests of its own below; asserting
    // the whole object here would make this test fail whenever that value
    // changes, which is not what it is about.
    const signUpCall = calls.find((c) => c.op === 'signUp')
    expect(signUpCall.credentials.email).toBe('alex@example.com')
    expect(signUpCall.credentials.password).toBe('longenough')
  })

  it('reports that the account needs email confirmation, as a result rather than a throw', async () => {
    // Supabase returns `{ session: null }` with NO error when confirmation is
    // on — and it IS on, for the live project (`mailer_autoconfirm: false`,
    // #154). Until #154 this threw, which made the ordinary outcome of a first
    // signup against production an error. Passing a bare null back would be
    // the other wrong answer: a session-shaped null the caller has to remember
    // to check, surfacing three steps later as "not signed in". So the claim
    // is spelled out on the result.
    authState.signUpNeedsConfirmation = true
    const result = await signUpOrganizer({ email: 'alex@example.com', password: 'longenough' })
    expect(result).toEqual({ session: null, needsConfirmation: true })
  })

  it('surfaces a signup refusal with its reason, unlike sign-in', async () => {
    // Deliberately the opposite of the vagueness above, and for a reason that
    // does not conflict: you are creating your OWN account, so "that address is
    // already registered" tells you nothing you did not know and is the only
    // thing that lets you act.
    authState.signUpError = 'User already registered'
    await expect(
      signUpOrganizer({ email: 'alex@example.com', password: 'longenough' }),
    ).rejects.toThrow(/already registered/i)
  })

  // #129 AC 2 — these three assert that the confirmation link's destination
  // REACHES `auth.signUp()` and that it is DERIVED, and the second half is the
  // one that needed designing rather than writing.
  //
  // jsdom's default origin is `http://localhost:3000` — byte-identical to the
  // Supabase Site URL default that caused the defect this story repairs. So a
  // test that merely asserted the literal `http://localhost:3000` arrived would
  // pass just as well against `emailRedirectTo: 'http://localhost:3000'`
  // hard-coded at the call site, which is precisely the implementation AC 2
  // says must redden. The fixture cannot tell the two apart because the
  // environment made them identical
  // (cairn `a-fixture-copied-from-production-cannot-tell-them-apart`).
  //
  // What separates them is MOVING the origin and requiring the value to follow.
  // Hence `withOrigin` below: any constant, including the true production URL
  // and including jsdom's own default, fails at least one of these.
  const withOrigin = async (origin, run) => {
    const original = Object.getOwnPropertyDescriptor(window, 'location')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin, href: `${origin}/`, toString: () => `${origin}/` },
    })
    try {
      return await run()
    } finally {
      if (original) Object.defineProperty(window, 'location', original)
    }
  }

  it('sends the confirmation link back to the origin the signup came from', async () => {
    await withOrigin('https://taskr.example.test', () =>
      signUpOrganizer({ email: 'alex@example.com', password: 'longenough' }),
    )
    expect(calls).toContainEqual({
      op: 'signUp',
      credentials: {
        email: 'alex@example.com',
        password: 'longenough',
        options: { emailRedirectTo: 'https://taskr.example.test' },
      },
    })
  })

  it('follows the origin to a DIFFERENT one, so no constant can satisfy both', async () => {
    // The pair is the assertion. One origin is satisfiable by a literal; two
    // are satisfiable only by reading the origin. This is the mutation AC 2
    // names, written as a test rather than left to a one-off run.
    await withOrigin('http://localhost:5173', () =>
      signUpOrganizer({ email: 'alex@example.com', password: 'longenough' }),
    )
    const signUpCall = calls.find((c) => c.op === 'signUp')
    expect(signUpCall.credentials.options.emailRedirectTo).toBe('http://localhost:5173')
  })

  it('falls back to Site URL rather than inventing a default when there is no window', () => {
    // `undefined` is the value that makes supabase-js defer to the project's
    // Site URL. A string here — any string — would be the constant this story
    // exists to remove, so the absence is asserted rather than assumed.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
    try {
      expect(confirmationRedirectTo()).toBeUndefined()
    } finally {
      if (original) Object.defineProperty(globalThis, 'window', original)
    }
  })

  // #291 — these three assert the SCOPE the call is made with, and that is the
  // whole point of them. supabase-js defaults `signOut()` to `scope: 'global'`,
  // which revokes every session for the account on every device; the app called
  // it with no argument for months and nothing here could see it, because the
  // only assertion was that a sign-out happened. Asserting the option is what
  // makes the two behaviours distinguishable to a test at all.
  it('signs out of THIS device only, leaving other devices signed in', async () => {
    await signOut()
    expect(calls).toContainEqual({ op: 'signOut', options: { scope: 'local' } })
  })

  it('takes the same local scope when asked explicitly, not the library default', async () => {
    await signOut({ everywhere: false })
    expect(calls).toContainEqual({ op: 'signOut', options: { scope: 'local' } })
  })

  it('signs out everywhere when asked, which is the lost-device answer', async () => {
    await signOut({ everywhere: true })
    expect(calls).toContainEqual({ op: 'signOut', options: { scope: 'global' } })
  })

  it('never reaches the library default, whichever way it is called', async () => {
    // The defect was an ABSENT argument, so the thing worth asserting is that
    // no call leaves the scope to be decided by somebody else.
    await signOut()
    await signOut({ everywhere: true })
    await signOut({})
    const scopes = calls.filter((c) => c.op === 'signOut').map((c) => c.options?.scope)
    expect(scopes).toEqual(['local', 'global', 'local'])
    expect(scopes).not.toContain(undefined)
  })
})

describe('signing in with Google — #304', () => {
  // The flow is Supabase's and the browser leaves the page, so what this layer
  // owns is the CALL: which provider, where the person comes back to, and that
  // it is the app's own client asking. Everything after the redirect is
  // Supabase's and Google's, and is what the confirmation story verifies live.

  it('asks the app’s own client for Google, coming back to the origin the person is on', async () => {
    const realWindow = globalThis.window
    globalThis.window = { location: { origin: 'https://taskr.example.test' } }
    try {
      await signInWithGoogle()
    } finally {
      globalThis.window = realWindow
    }
    expect(calls).toContainEqual({
      op: 'signInWithOAuth',
      args: { provider: 'google', options: { redirectTo: 'https://taskr.example.test' } },
    })
    // One call, through the ONE client. A second OAuth client or an ID-token
    // flow would show up here as a different op or a second entry.
    expect(calls.filter((c) => c.op === 'signInWithOAuth')).toHaveLength(1)
    expect(calls.filter((c) => c.op === 'signInWithPassword')).toHaveLength(0)
  })

  it('falls back to Site URL when there is no window, like the confirmation email does', async () => {
    const realWindow = globalThis.window
    delete globalThis.window
    try {
      await signInWithGoogle()
    } finally {
      globalThis.window = realWindow
    }
    expect(calls).toContainEqual({
      op: 'signInWithOAuth',
      args: { provider: 'google', options: { redirectTo: undefined } },
    })
  })

  it('names Google when the start is refused, since nothing about a password was wrong', async () => {
    // The live project's answer until the provider is enabled: "Unsupported
    // provider: provider is not enabled". Collapsing that into "did not match"
    // would send somebody to reset a password they never typed.
    authState.oauthError = 'Unsupported provider: provider is not enabled'
    await expect(signInWithGoogle()).rejects.toThrow(/signing in with Google.*provider is not enabled/)
  })

  describe('the return, when a sign-in did not complete', () => {
    const at = (search = '', hash = '') => ({ search, hash })

    it('reads a provider refusal out of the fragment, which is where the implicit flow puts errors', () => {
      expect(
        readSignInReturn(at('', '#error=access_denied&error_code=provider_refused&error_description=the+user+denied+access')),
      ).toEqual({
        error: 'access_denied',
        code: 'provider_refused',
        description: 'the user denied access',
        source: 'fragment',
      })
    })

    it('reads GoTrue’s bad-flow-state redirect out of the query — it carries no state', () => {
      // The shape probed live 2026-09-04: `GET /auth/v1/callback?state=probe` is
      // a 303 to Site URL with exactly these three parameters and nothing else.
      expect(
        readSignInReturn(
          at('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+parameter+is+invalid'),
        ),
      ).toEqual({
        error: 'invalid_request',
        code: 'bad_oauth_state',
        description: 'OAuth state parameter is invalid',
        source: 'query',
      })
    })

    it('leaves a query that carries a state alone — that is the calendar’s return', () => {
      // AC 4, from this side. `?error=access_denied&state=…` is a member
      // pressing Cancel on the CALENDAR consent, and readConsentReturn owns it.
      expect(readSignInReturn(at('?error=access_denied&state=xyz'))).toBeNull()
      expect(readSignInReturn(at('?code=abc&state=xyz'))).toBeNull()
    })

    it('is null for a code with no state — this app never exchanges one', () => {
      // Under the implicit flow nothing this app starts comes back as `?code=`
      // without a state. So the parameter is nobody’s: not read here, and not
      // handed to the calendar either (calendar.test.js).
      expect(readSignInReturn(at('?code=abc'))).toBeNull()
    })

    it.each([
      [at(), 'an ordinary load'],
      [at('?foo=1', '#bar=2'), 'unrelated parameters'],
      [at('', '#access_token=t&refresh_token=r&expires_in=3600&token_type=bearer'), 'a SUCCESSFUL return'],
      [{ search: undefined, hash: undefined }, 'a location with neither'],
      [undefined, 'no location at all, when globalThis.location is absent'],
    ])('is null for %o — %s', (location) => {
      expect(readSignInReturn(location ?? {})).toBeNull()
    })

    it('names the organizer on a Google refusal, and does NOT say the password was wrong', () => {
      // AC 5. The consent screen is in Testing, so an account the organizer has
      // not registered is refused by Google — and the organizer is the one
      // person who can change that. The collapsed credential sentence is the
      // wrong answer here because no credential was involved.
      const sentence = describeSignInReturn({ error: 'access_denied', code: null, description: null })
      expect(sentence).toMatch(/has not been opened to your account/i)
      expect(sentence).toMatch(/organizer/i)
      expect(sentence).not.toMatch(/did not match/i)
    })

    it.each(['bad_oauth_state', 'bad_oauth_callback', 'flow_state_already_used'])(
      'tells a stale flow (%s) to press the control again, keyed on the code and not the prose',
      (code) => {
        // Keyed on `error_code`: GoTrue rewords descriptions without versioning
        // them, and `bad_oauth_state` alone has three. The description here is
        // deliberately nonsense so a branch on it cannot be what passes.
        const sentence = describeSignInReturn({ error: 'invalid_request', code, description: 'zzz' })
        expect(sentence).toMatch(/Continue with Google again/)
        expect(sentence).not.toMatch(/zzz/)
      },
    )

    it('lets an expired confirmation link keep GoTrue’s own words — that is #129’s flow, not this one', () => {
      const sentence = describeSignInReturn({
        error: 'access_denied',
        code: 'otp_expired',
        description: 'Email link is invalid or has expired',
      })
      expect(sentence).toMatch(/Email link is invalid or has expired/)
      expect(sentence).not.toMatch(/organizer/i)
    })

    it('quotes the description for anything else, and says so when there is none', () => {
      expect(
        describeSignInReturn({ error: 'server_error', code: 'unexpected_failure', description: 'something broke' }),
      ).toMatch(/Sign-in did not complete: something broke/)
      expect(describeSignInReturn({ error: null, code: null, description: null })).toMatch(/no reason was given/)
    })
  })
})

describe('finding the household the signed-in person belongs to', () => {
  // #62 turned this from two reads into one. Under device auth it resolved
  // `household_devices` and then fetched the household by id; the table is gone
  // and membership is `members.claimed_by = auth.uid()`, which the households
  // SELECT policy resolves inside the database. So the client asks for
  // households and gets its own — the filtering that used to be a second query
  // is now the policy.
  it('is null when nobody is signed in as a member, rather than an error', async () => {
    results.households = { data: [], error: null }
    await expect(currentHousehold()).resolves.toBeNull()
  })

  it('loads the household the policy returns, without naming an id itself', async () => {
    results.households = { data: [{ id: 'h1', name: 'Placeholder Household' }], error: null }

    await expect(currentHousehold()).resolves.toMatchObject({ id: 'h1' })
    // The absence is the point: an `eq('id', …)` here would mean the client is
    // choosing which household to load, and it has nothing to choose from.
    expect(calls).not.toContainEqual(
      expect.objectContaining({ op: 'eq', table: 'households', column: 'id' }),
    )
  })

  // #159 AC 2 - the read is PLURAL and ORDERED, and no path picks a household by
  // an unordered limit. This is what the old assertion becomes: it read
  // `toContainEqual({ op: 'limit', n: 1 })`, which is precisely the shape this
  // story exists to remove, so the check is inverted rather than dropped.
  it('issues no limit at all, and orders by created_at then id', async () => {
    results.households = { data: [{ id: 'h1' }], error: null }
    await listHouseholds()

    expect(calls.filter((c) => c.op === 'limit' && c.table === 'households')).toEqual([])
    const orders = calls.filter((c) => c.op === 'order' && c.table === 'households')
    expect(orders.map((o) => o.column)).toEqual(['created_at', 'id'])
    expect(orders.every((o) => o.ascending === true)).toBe(true)
  })

  // #159 AC 3 - both rows come back, and the ORDER is asserted rather than
  // assumed. Proving the read is plural is what everything downstream rests on:
  // if this quietly returned one row, every scoping test in this repo would pass
  // against a world that only ever had one household in it.
  it('returns BOTH households, in the order the query asked for', async () => {
    results.households = {
      data: [
        { id: 'h1', name: 'Placeholder Household', created_at: '2026-01-01T00:00:00Z' },
        { id: 'h2', name: 'Placeholder Other Household', created_at: '2026-02-01T00:00:00Z' },
      ],
      error: null,
    }

    const all = await listHouseholds()
    expect(all).toHaveLength(2)
    expect(all.map((h) => h.id)).toEqual(['h1', 'h2'])
    // And the active one is the FIRST of that order - today's placeholder for a
    // switcher, asserted so the seam is visible rather than implied.
    await expect(currentHousehold()).resolves.toMatchObject({ id: 'h1' })
  })

  it('is an empty array, not null, when nobody is signed in', async () => {
    results.households = { data: null, error: null }
    await expect(listHouseholds()).resolves.toEqual([])
  })

  it('names what it was doing when the query fails, not just the driver message', async () => {
    results.households = { data: null, error: { message: 'connection reset' } }
    await expect(currentHousehold()).rejects.toThrow(/loading your households: connection reset/)
  })
})

describe('maintaining the roster', () => {
  beforeEach(() => {
    results.households = { data: [{ id: 'h1', name: 'Placeholder Household' }], error: null }
    results.members = { data: { id: 'm9' }, error: null }
  })

  // The same shape the provisioning block below defines for itself, and kept
  // local for the same reason it is local there: asserting that the call threw
  // AT ALL is the half that stops every message assertion being skipped on a
  // call that quietly succeeded.
  async function failureFrom(call) {
    let thrown = null
    try {
      await call()
    } catch (error) {
      thrown = error
    }
    expect(thrown, 'the call was supposed to fail and did not').toBeTruthy()
    return thrown
  }

  // #159 AC 4 - rewritten, not deleted, and the title's claim is the part that
  // changed. It asserted the household came from "this device", which was one
  // unordered read standing in for a choice nobody had made. The caller names it
  // now, and the property that survives is that the row is BUILT here field by
  // field - so a stray snake_case `household_id` cannot smuggle one past the
  // named argument. RLS still refuses any id outside current_household_ids().
  it('writes the household it was given, and ignores a stray household_id', async () => {
    await addMember({
      displayName: 'Placeholder One',
      weeklyMinutes: 120,
      householdId: 'h1',
      household_id: 'somewhere-else',
    })

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row.household_id).toBe('h1')
    expect(insert.row).toMatchObject({ display_name: 'Placeholder One', weekly_minutes: 120 })
  })

  // The discriminating half: a DIFFERENT id has to reach the row, or the test
  // above passes just as well against a function that hard-codes the first
  // household it can find.
  it('writes into the household it was asked for, not the first one going', async () => {
    await addMember({ displayName: 'Placeholder Two', weeklyMinutes: 60, householdId: 'h2' })

    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row.household_id).toBe('h2')
  })

  it('trims a name before storing it', async () => {
    await addMember({ displayName: '  Placeholder One  ', weeklyMinutes: 0, householdId: 'h1' })
    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row.display_name).toBe('Placeholder One')
  })

  it('refuses a blank name before spending a round trip', async () => {
    await expect(addMember({ displayName: '   ', weeklyMinutes: 60, householdId: 'h1' })).rejects.toThrow(
      /needs a name/i,
    )
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0)
  })

  // #159 - rewritten. addMember no longer reads `households` at all, so an empty
  // fixture there cannot be what stops it any more; asserting against that
  // fixture would now pass VACUOUSLY, which is the exact trap the comment this
  // replaces had recorded about the PREVIOUS rewrite of this same test. The
  // property is restated against what the function actually reads.
  it('refuses to add anyone when no household is named', async () => {
    await expect(
      addMember({ displayName: 'Placeholder One', weeklyMinutes: 60, householdId: undefined }),
    ).rejects.toThrow(/which household/i)
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0)
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
    await expect(listMembers('h1')).resolves.toEqual([])
  })

  // #242 — the address. `0007` granted `members.email` for insert AND update and
  // nothing has ever written through either; these are the writes that do.
  it('stores an address given at add time, which is what makes the sign-in typeable', async () => {
    await addMember({
      displayName: 'Placeholder One',
      weeklyMinutes: 60,
      householdId: 'h1',
      email: 'placeholder.one@example.com',
    })
    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row.email).toBe('placeholder.one@example.com')
  })

  // The half that keeps the OLD insert byte for byte what it was: a caller that
  // does not mention an address must not start writing nulls into the column.
  // `0007`'s null means "no real inbox, so a synthetic address and a PIN", and a
  // write is a different act from an omission even when the stored value agrees.
  it('omits the column entirely when nobody typed an address', async () => {
    await addMember({ displayName: 'Placeholder One', weeklyMinutes: 60, householdId: 'h1' })
    const insert = calls.find((c) => c.op === 'insert' && c.table === 'members')
    expect(insert.row).not.toHaveProperty('email')
  })

  it('clears the address when the field is emptied, rather than ignoring the edit', async () => {
    await updateMember('m9', { email: '   ' })
    const update = calls.find((c) => c.op === 'update')
    expect(update.patch).toEqual({ email: null })
  })

  it('edits the address without touching the name or the budget', async () => {
    await updateMember('m9', { email: 'placeholder.one@example.com' })
    const update = calls.find((c) => c.op === 'update')
    expect(update.patch).toEqual({ email: 'placeholder.one@example.com' })
  })

  it('refuses an address that the check constraint would refuse, before the round trip', async () => {
    await expect(updateMember('m9', { email: 'not-an-address' })).rejects.toThrow(/@/)
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  // The two constraint violations `0007` can raise, translated. Without this the
  // organizer is shown a Postgres string naming an index they have never heard
  // of, on the one screen where they are trying to admit somebody.
  it('names a colliding address rather than surfacing the index', async () => {
    results.members = {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "members_email_key"' },
    }
    const thrown = await failureFrom(() =>
      addMember({
        displayName: 'Placeholder One',
        weeklyMinutes: 60,
        householdId: 'h1',
        email: 'placeholder.one@example.com',
      }),
    )
    expect(thrown.message).toMatch(/already on a roster entry/i)
    // Not "in this household": the index is on `lower(email)` across the WHOLE
    // table, so the collision can be with somebody this organizer cannot see,
    // and a message scoping it to their household sends them looking at a
    // roster where the address is genuinely absent.
    expect(thrown.message).not.toMatch(/this household/i)
  })

  it('names a malformed address the database refused, if one gets past the client', async () => {
    results.members = {
      data: null,
      error: { code: '23514', message: 'violates check constraint "members_email_shape"' },
    }
    const thrown = await failureFrom(() => updateMember('m9', { email: 'placeholder.one@example.com' }))
    expect(thrown.message).toMatch(/does not look like an email address/i)
  })

  // POSITIVE CONTROL. Every assertion above is about a failure being renamed, so
  // all of them would pass against a layer that renamed EVERY failure — which
  // would bury the message that says what actually went wrong.
  it('POSITIVE CONTROL: leaves an unrelated failure saying what it was doing', async () => {
    results.members = { data: null, error: { code: '08006', message: 'connection failure' } }
    const thrown = await failureFrom(() => updateMember('m9', { weeklyMinutes: 30 }))
    expect(thrown.message).toMatch(/saving the change: connection failure/i)
  })
})

// #242 — the address a person types to sign in.
//
// There is no name-based sign-in and there never was, so this is half the
// credential. `access-model.md` called the synthetic form an address they
// "never see or type", which the sign-in form has never been able to honour:
// `signIn` is `signInWithPassword`, so somebody has to type it.
describe('the address a member signs in with', () => {
  it('is the real one when the row has one', () => {
    expect(signInAddressFor({ id: 'm1', email: 'placeholder.one@example.com' })).toBe(
      'placeholder.one@example.com',
    )
  })

  it('is the synthetic form when the row has none, which is every member so far', () => {
    expect(signInAddressFor({ id: 'm1', email: null })).toBe('m1@taskr.invalid')
  })

  it('treats a blank address as none, so whitespace cannot produce an unusable one', () => {
    expect(signInAddressFor({ id: 'm1', email: '   ' })).toBe('m1@taskr.invalid')
  })

  it('folds case, so the roster shows what the person will actually be able to type', () => {
    expect(normalizeMemberEmail('  Placeholder.One@Example.COM ')).toBe(
      'placeholder.one@example.com',
    )
  })

  it('leaves the column alone when the caller is not talking about it', () => {
    expect(normalizeMemberEmail(undefined)).toBeUndefined()
  })
})

describe('creating a household', () => {
  it('creates it through the server function, never a direct insert', async () => {
    results.create_household = { data: { id: 'h1', name: 'Placeholder Household' }, error: null }
    const household = await createHousehold('  Placeholder Household  ', {
      organizerName: '  Placeholder Organizer  ',
    })

    expect(household.id).toBe('h1')
    // The organizer goes in the SAME call, and #62 raised the stakes on that
    // rather than changing it: `create_household` claims their member row to
    // `auth.uid()`, and a household whose organizer row is unclaimed is visible
    // to NOBODY under the new predicate — including the person who just made it.
    // A second round trip to attach them would leave a window with no way out.
    //
    // THREE arguments, not four. 0007 dropped the PIN and the third position is
    // now the timezone, which is why the old shape did not fail cleanly: the PIN
    // landed in the timezone slot and Postgres refused with `not a known
    // timezone: 4821` — an error naming neither the caller nor the migration.
    expect(calls).toContainEqual({
      op: 'rpc',
      name: 'create_household',
      args: {
        household_name: 'Placeholder Household',
        organizer_name: 'Placeholder Organizer',
        // #44: the household's timezone goes in the same statement too, and for
        // a related reason — a week boundary is a local-time fact, and a second
        // round trip to set it can fail on its own, leaving the household filing
        // capacity under UTC weeks nobody lives in.
        household_timezone: deviceTimezone(),
      },
    })
    expect(calls.filter((c) => c.op === 'insert' && c.table === 'households')).toHaveLength(0)
  })

  it('sends no credential to create_household at all', async () => {
    // The specific regression. Any leftover PIN key would be silently accepted
    // by this fake and refused by Postgres, so asserting the exact arg set above
    // is not enough on its own — that assertion would still pass if a fifth key
    // were added, since toContainEqual compares the object it is given.
    results.create_household = { data: { id: 'h1' }, error: null }
    await createHousehold('A Household', { organizerName: 'Organizer' })
    const call = calls.find((c) => c.op === 'rpc' && c.name === 'create_household')
    expect(Object.keys(call.args).sort()).toEqual([
      'household_name',
      'household_timezone',
      'organizer_name',
    ])
  })

  it('sends a REAL zone from this device, not a placeholder — #44 AC 6', async () => {
    // Asserting `household_timezone: deviceTimezone()` above compares the code to
    // itself: it passes whatever both say, including both wrong together. This
    // is the half that says the value is an actual IANA zone the device
    // resolved, so a parameter nobody meaningfully fills would fail here.
    results.create_household = { data: { id: 'h1' }, error: null }
    await createHousehold('A Household', { organizerName: 'Organizer' })
    const call = calls.find((c) => c.op === 'rpc' && c.name === 'create_household')
    expect(call.args.household_timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_+-]+$|^UTC$/)
    expect(Intl.DateTimeFormat(undefined, { timeZone: call.args.household_timezone })).toBeTruthy()
  })

  it('refuses a household with no name', async () => {
    await expect(createHousehold('  ')).rejects.toThrow(/needs a name/i)
  })

  it('needs an organizer name, not just a household name', async () => {
    await expect(createHousehold('A Household', {})).rejects.toThrow(/organizer needs a name/i)
  })
})

describe('the retired credential path', () => {
  // #62 AC 5 — "a test asserts no client-reachable route to the old credential
  // path survives". The database half is asserted in migrations.pglite.test.js,
  // which checks the functions are absent from the catalog. This is the client
  // half, and it is worth having separately: a wrapper left behind here would
  // turn a compile-time absence into a runtime `PGRST202 function not found`,
  // discovered by a child on a phone rather than by CI.
  it('exports no wrapper for any dropped RPC', async () => {
    const household = await import('./household.js')
    for (const gone of [
      'joinHousehold',
      'claimMember',
      'claimMemberWithPin',
      'setMemberPin',
      'ensureSession',
      'currentDeviceId',
    ]) {
      expect(household[gone], `${gone} is still exported`).toBeUndefined()
    }
  })

  it('POSITIVE CONTROL: the module does still export the functions that replaced them', () => {
    // Without this, a typo in the import above — or a module that failed to load
    // — would make every assertion vacuously true.
    expect(typeof signIn).toBe('function')
    expect(typeof signUpOrganizer).toBe('function')
    expect(typeof currentSession).toBe('function')
  })
})

describe('the roster read', () => {
  // #159 AC 1 - the roster names ONE household. Nothing asserted this until the
  // mutation pass went looking: every other scoped read had a filter assertion
  // and this one did not, so removing `.eq('household_id', ...)` from
  // listMembers would have reddened nothing at all.
  it('filters to the one household it was given, and refuses to guess', async () => {
    results.members = { data: [], error: null }
    await listMembers('h2')

    expect(calls).toContainEqual(
      expect.objectContaining({ op: 'eq', table: 'members', column: 'household_id', value: 'h2' }),
    )
  })

  it('issues no request at all when no household is named', async () => {
    await expect(listMembers(undefined)).rejects.toThrow(/which household/i)
    expect(calls.filter((c) => c.table === 'members')).toHaveLength(0)
  })

  it('asks for a column list, never `*`, because the grants would refuse the whole select', async () => {
    // `select('*')` on members fails outright rather than quietly omitting a
    // column, so this is a working/not-working distinction, not tidiness.
    //
    // #62: the credential columns this used to name are gone. `pin_hash` was
    // withheld from the client on purpose and `has_pin` was the boolean the UI
    // read instead; 0007 drops both, and `email` is what the roster now reads to
    // tell the two credential kinds apart. Asserting their ABSENCE as well as
    // email's presence, because a column list that still named them would fail
    // against the live project rather than degrade.
    results.members = { data: [], error: null }
    await listMembers('h1')
    const selects = calls.filter((c) => c.op === 'select' && c.table === 'members')
    expect(selects.length).toBeGreaterThan(0)
    for (const call of selects) {
      expect(call.cols).not.toBe('*')
      expect(call.cols).not.toMatch(/pin_hash/)
      expect(call.cols).not.toMatch(/has_pin/)
      expect(call.cols).toMatch(/email/)
    }
  })

  it('creating a household needs an organizer name, not just a household name', async () => {
    await expect(createHousehold('A Household', { organizerPin: '4821' })).rejects.toThrow(
      /organizer needs a name/i,
    )
  })

})

// Stand-ins for the SDK's error classes, shared by the #87 and #247 describes.
// `callProvisioning` branches on `name`, which is what the real classes set,
// and constructing the real ones would mean importing the client this file
// deliberately fakes.
function fetchError() {
  const error = new Error('Failed to send a request to the Edge Function')
  error.name = 'FunctionsFetchError'
  return error
}

function httpError(body) {
  const error = new Error('Edge Function returned a non-2xx status code')
  error.name = 'FunctionsHttpError'
  error.context = { json: () => Promise.resolve(body) }
  return error
}

describe('provisioning a sign-in - #87, and how it fails - #112', () => {

  async function failureFrom(call) {
    let thrown = null
    try {
      await call()
    } catch (error) {
      thrown = error
    }
    // Asserted rather than assumed: if the call ever stopped throwing, every
    // message assertion below would be skipped and the test would still be
    // green, having checked nothing.
    expect(thrown, 'the call was supposed to fail and did not').toBeTruthy()
    return thrown
  }

  it("passes the function's own refusal through verbatim", () => {
    // The function answers in sentences on purpose: "Only the household
    // organizer can do that" is something the person can act on, and replacing
    // it with a generic message would throw away the only useful part.
    invokeResult = {
      data: null,
      error: httpError({ error: 'Only the household organizer can do that.' }),
    }
    return failureFrom(() => provisionMember({ memberId: 'm1', password: 'a good one' })).then(
      (thrown) => {
        expect(thrown.message).toBe('Only the household organizer can do that.')
      },
    )
  })

  it('says what is wrong and what to do when the request never got an answer', async () => {
    // #112, reported from a phone as: "Could not provision that sign-in: Failed
    // to send a request to the Edge Function". A fetch-level failure has no
    // status and no body, so there is nothing to quote - and the SDK's own
    // message names no header, mentions no preflight, and reads like the network
    // dropped. In a browser it is far more often a refused CORS preflight or a
    // function that was never deployed.
    invokeResult = { data: null, error: fetchError() }
    const thrown = await failureFrom(() =>
      provisionMember({ memberId: 'm1', password: 'a good one' }),
    )

    expect(thrown.message).not.toMatch(/Failed to send a request/)
    expect(thrown.message).toMatch(/connection/i)
    expect(thrown.message).toMatch(/provision-member/)
    expect(thrown.message).toMatch(/deployed/i)
    // The one thing that IS certain: a request that never left cannot have
    // half-provisioned anybody, and saying so stops an organizer retrying into a
    // state they are afraid of.
    expect(thrown.message).toMatch(/nothing was changed/i)
  })

  it('keeps the original error as the cause, so the detail survives for a console', async () => {
    const original = fetchError()
    invokeResult = { data: null, error: original }
    const thrown = await failureFrom(() =>
      resetMemberCredential({ memberId: 'm1', password: 'a good one' }),
    )
    expect(thrown.cause).toBe(original)
  })

  it('refuses a short credential without a round trip', async () => {
    // The floor is Supabase's own, stated here so the refusal is a sentence
    // rather than a 400 from the admin API - and checked before the call, so a
    // typo costs nothing.
    invokeResult = { data: null, error: fetchError() }
    const thrown = await failureFrom(() => provisionMember({ memberId: 'm1', password: 'abc' }))
    expect(thrown.message).toMatch(/at least 6/)
    expect(calls.filter((call) => call.op === 'invoke')).toEqual([])
  })

  it('POSITIVE CONTROL: a successful provision reaches the function and returns its answer', async () => {
    // Without this, every assertion above could be satisfied by a client that
    // always fails - and the fake would be proving nothing about the happy path
    // it is standing in for.
    invokeResult = { data: { ok: true, action: 'provision', memberId: 'm1' }, error: null }
    const result = await provisionMember({ memberId: 'm1', password: 'a good one' })
    expect(result).toEqual({ ok: true, action: 'provision', memberId: 'm1' })
    expect(calls).toContainEqual({
      op: 'invoke',
      name: 'provision-member',
      body: { action: 'provision', memberId: 'm1', password: 'a good one' },
    })
  })
})

describe('removing a member takes their sign-in with it - #247', () => {
  // What this file CAN prove is the client's half: which calls are made, in
  // what order, and what the caller is told. Whether the function really
  // deletes the auth user — and refuses to when another household still claims
  // it — is `src/test/provisioning.functions.test.js`, over a real stack.
  const row = (claimedBy) => ({
    data: { id: 'm1', display_name: 'Placeholder One', claimed_by: claimedBy },
    error: null,
  })
  const ok = { data: null, error: null }

  it('revokes the sign-in FIRST and deletes the row second - the recoverable order', async () => {
    results.members = [row('person-a'), ok]
    invokeResult = {
      data: { ok: true, action: 'revoke', memberId: 'm1', deleted: true },
      error: null,
    }

    const result = await removeMember('m1')

    expect(result.warning).toBeNull()
    // Order is load-bearing: `members_claimed_by_fkey` is ON DELETE SET NULL,
    // so auth-first leaves a "No sign-in yet" row if the second half dies,
    // where row-first leaves an account that can still sign in — the orphan
    // #247 was filed about.
    const ops = calls
      .filter((c) => c.op === 'invoke' || (c.op === 'delete' && c.table === 'members'))
      .map((c) => c.op)
    expect(ops).toEqual(['invoke', 'delete'])
    // No password travels with a revoke — there is no credential to set.
    expect(calls.find((c) => c.op === 'invoke').body).toEqual({
      action: 'revoke',
      memberId: 'm1',
    })
  })

  it('AC 3: a member with no sign-in is removed with no auth call at all', async () => {
    results.members = [row(null), ok]

    const result = await removeMember('m1')

    expect(result.warning).toBeNull()
    expect(calls.filter((c) => c.op === 'invoke')).toEqual([])
    expect(calls.filter((c) => c.op === 'delete' && c.table === 'members')).toHaveLength(1)
  })

  it('AC 4: a failed revoke does not stop the removal, and the warning states both facts', async () => {
    results.members = [row('person-a'), ok]
    invokeResult = {
      data: null,
      error: httpError({ error: 'This function is not configured.' }),
    }

    const result = await removeMember('m1')

    // The removal itself went through...
    expect(calls.filter((c) => c.op === 'delete' && c.table === 'members')).toHaveLength(1)
    // ...and the warning carries both facts plus the function's own sentence,
    // so the organizer neither retries the removal nor mistakes which half
    // failed.
    expect(result.warning).toMatch(/Placeholder One was removed/)
    expect(result.warning).toMatch(/sign-in was NOT deleted/)
    expect(result.warning).toMatch(/This function is not configured\./)
  })

  it('a row that is already gone is left alone - no revoke, no delete', async () => {
    results.members = [{ data: null, error: null }]

    const result = await removeMember('m1')

    expect(result.warning).toBeNull()
    expect(calls.filter((c) => c.op === 'invoke')).toEqual([])
    expect(calls.filter((c) => c.op === 'delete')).toEqual([])
  })

  it('a failed row delete still throws - that half really did fail', async () => {
    results.members = [row(null), { data: null, error: { message: 'permission denied' } }]

    await expect(removeMember('m1')).rejects.toThrow(/removing the person: permission denied/)
  })
})
