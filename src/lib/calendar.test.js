import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The calendar data layer — story #95.
//
// Both halves in one file, unlike capacity and chores, because the module is
// small and the two halves are not independent here: the consent URL decides
// what Google will hand back, and `completeConnect` decides what happens to it.
// Splitting them would put the scope on one side of a file boundary and the
// exchange on the other.
//
// What this CANNOT test, and does not pretend to: the access rules on
// `calendar_connections` and `calendar_tokens` (those are Postgres, and live in
// src/test/calendar.pglite.test.js) and the Google exchange itself (that is the
// Edge Function, and lives in supabase/functions/calendar-connect/handler.test.js).
//
// Names are synthetic — see #19.

const CLIENT_ID = '1234567890-placeholder.apps.googleusercontent.com'

// Stubbed BEFORE the module is imported, because `calendar.js` reads
// `import.meta.env` once at module scope — the same shape as `supabase.js`, and
// deliberately so: a value that is inlined at build time should be read at
// import time, not re-read per call, or the module would imply it can change.
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)

const invoke = vi.fn()
const calls = []
const MEMBER_IDS = ['m1', 'm2']
let selectResult = { data: [], error: null }

vi.mock('./supabase.js', () => ({
  hasSupabaseConfig: true,
  getSupabase: () => ({
    functions: { invoke: (...args) => invoke(...args) },
    from: (table) => {
      const q = {
        select: (cols) => {
          calls.push({ op: 'select', table, cols })
          return q
        },
        in: (column, value) => {
          calls.push({ op: 'in', table, column, value })
          return q
        },
        // #96 — `listBusyWeeks` filters by the week as well as the member set,
        // and the recorded call is what proves it: a read that matched on the
        // member alone would return every week this household has ever had and
        // the roster would show whichever row came first.
        eq: (column, value) => {
          calls.push({ op: 'eq', table, column, value })
          return q
        },
        then: (onOk, onErr) => Promise.resolve(selectResult).then(onOk, onErr),
      }
      return q
    },
  }),
}))

const {
  BUSY_STALE_AFTER_HOURS,
  BUSY_STALE_AFTER_MS,
  CALENDAR_BUSY_COLUMNS,
  CALENDAR_CONNECTION_COLUMNS,
  CONSENT_HOUSEHOLD_KEY,
  CONSENT_STATE_KEY,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_FREEBUSY_SCOPE,
  completeConnect,
  connectionFor,
  consentUrl,
  hasCalendarConfig,
  isBusyWeekStale,
  isRealEmailMember,
  busyComputedLabel,
  busyWeekFor,
  fetchBusyWeek,
  listBusyWeeks,
  listCalendarConnections,
  newConsentState,
  readConsentReturn,
  redirectUriFor,
  startConnect,
} = await import('./calendar.js')

/** A `sessionStorage` that is a plain object, so a test can look inside it. */
function fakeStorage(initial = {}) {
  const store = { ...initial }
  return {
    store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value)
    },
    removeItem: (key) => {
      delete store[key]
    },
  }
}

const LOCATION = { origin: 'https://taskr.example.test' }

/** Every `.js`/`.jsx` file under `src/`, tests included — a query anywhere counts. */
function sourceFilesUnderSrc(dir = resolve(process.cwd(), 'src'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) sourceFilesUnderSrc(full, out)
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const paramsOf = (url) => new URL(url).searchParams

beforeEach(() => {
  invoke.mockReset()
  calls.length = 0
  selectResult = { data: [], error: null }
})

describe('AC 3 — the consent request asks for free/busy and nothing more', () => {
  it('asks for exactly one scope, and never one that reads what a meeting IS', () => {
    // Two claims, and the split matters — found by a mutation pass, round 1.
    //
    // This test was called "…and it is the free/busy one" and asserted
    // `toBe(GOOGLE_FREEBUSY_SCOPE)`. *Measured*: widening the constant to
    // `calendar.readonly` reddened 2 against a predicted 3, and this was the
    // one that stayed green — because expected and actual come from the SAME
    // constant, so it is true at every value of it. The name claimed a fact
    // about the value; the assertion could only ever testify to the WIRING.
    //
    // So the wiring claim keeps its assertion and loses the overstated name,
    // and the value claim moves to the test below, against a literal. What is
    // added here is the durable half: whatever scope this app asks for, it must
    // be ONE, and it must not be one that returns the content of a meeting.
    // That survives #101 widening the ask, which spelling the current value
    // twice would not.
    const scope = paramsOf(consentUrl({ redirectUri: 'https://x.test/', state: 's' })).get('scope')
    expect(scope, 'the URL must carry what this module declares').toBe(GOOGLE_FREEBUSY_SCOPE)
    expect(scope.split(/\s+/)).toHaveLength(1)
    expect(scope, 'a content-reading scope must never be the initial ask').not.toMatch(
      /readonly|\.events|calendar\.calendars/,
    )
  })

  it('names the free/busy scope Google publishes, not a readonly one', () => {
    // Asserted on the CONSTANT as well as on the URL. A typo in the scope string
    // is refused by Google at consent time, which is a loud failure — but a
    // silent widening (`calendar.readonly` pasted over it) is not, and it is the
    // one this criterion is actually about.
    expect(GOOGLE_FREEBUSY_SCOPE).toBe('https://www.googleapis.com/auth/calendar.freebusy')
    expect(GOOGLE_FREEBUSY_SCOPE).not.toMatch(/readonly|\bevents\b|calendar\.calendars/)
  })

  it('asks Google for a LASTING connection, or there is nothing to store', () => {
    // Both of these are load-bearing and neither is obvious. Without
    // `access_type=offline` Google returns an access token and no refresh token,
    // so the connection would work for one hour. Without `prompt=consent` it
    // withholds the refresh token on every consent AFTER the first, because it
    // has already issued one — so a member who reconnects gets a 200 with
    // nothing durable in it, which the handler has to have a whole sentence for.
    const params = paramsOf(consentUrl({ redirectUri: 'https://x.test/', state: 's' }))
    expect(params.get('access_type')).toBe('offline')
    expect(params.get('prompt')).toBe('consent')
    expect(params.get('response_type')).toBe('code')
  })

  it('keeps already-granted scopes, so #101 can widen rather than replace', () => {
    expect(
      paramsOf(consentUrl({ redirectUri: 'https://x.test/', state: 's' })).get(
        'include_granted_scopes',
      ),
    ).toBe('true')
  })

  it('goes to Google, carrying the client id and the state', () => {
    const url = consentUrl({ redirectUri: 'https://x.test/', state: 'state-123' })
    expect(url.startsWith(`${GOOGLE_AUTH_ENDPOINT}?`)).toBe(true)
    expect(paramsOf(url).get('client_id')).toBe(CLIENT_ID)
    expect(paramsOf(url).get('state')).toBe('state-123')
    expect(paramsOf(url).get('redirect_uri')).toBe('https://x.test/')
  })

  it.each([
    [{ redirectUri: 'https://x.test/', state: '' }, 'no state'],
    [{ redirectUri: '', state: 's' }, 'no redirect address'],
    [{ redirectUri: 'https://x.test/', state: 's', clientId: '' }, 'no client id'],
  ])('refuses to build a half-formed request — %s', (args) => {
    // A consent URL missing any of the three is refused by GOOGLE, on a page the
    // member is looking at, with a message written for a developer. Refusing
    // here keeps the sentence ours and keeps the member on this app.
    expect(() => consentUrl(args)).toThrow()
  })
})

describe('AC 1 — who could consent at all', () => {
  it('is a member with a real address', () => {
    expect(isRealEmailMember({ email: 'placeholder@example.test' })).toBe(true)
  })

  it('is NOT a member provisioned with a PIN', () => {
    // `0007`'s discriminator: `members.email` stays null for everybody the Edge
    // Function provisions, and their sign-in address is derived from their id as
    // `<id>@taskr.invalid` rather than stored. There is no Google identity behind
    // an address that has no mailbox by construction.
    expect(isRealEmailMember({ email: null })).toBe(false)
    expect(isRealEmailMember({})).toBe(false)
    expect(isRealEmailMember(null)).toBe(false)
  })

  it('reads the ROSTER ROW rather than sniffing for the synthetic suffix', () => {
    // A tempting alternative is `!email.endsWith('@taskr.invalid')`, which gets
    // the same answer today and is wrong for a reason that would not show up
    // until it mattered: the synthetic address is DERIVED and never stored, so
    // any row carrying it has already broken the invariant `provision-member`
    // exists to keep. Treating such a row as a PIN member would hide that.
    expect(isRealEmailMember({ email: 'anything@taskr.invalid' })).toBe(true)
  })
})

describe('the connection a row belongs to', () => {
  const rows = [
    { id: 'c1', member_id: 'm1', scope: GOOGLE_FREEBUSY_SCOPE, connected_at: '2026-08-24T00:00:00Z' },
  ]

  it('finds it', () => {
    expect(connectionFor(rows, 'm1')).toBe(rows[0])
  })

  it('is null for somebody who has not connected, never undefined', () => {
    // The roster passes this straight into a prop, and `undefined` would make
    // React treat the prop as absent — which is the same thing here, but not the
    // same thing everywhere, and a null says the question was asked.
    expect(connectionFor(rows, 'm2')).toBeNull()
    expect(connectionFor([], 'm1')).toBeNull()
  })
})

describe('the return from Google', () => {
  it('recognises a code', () => {
    expect(readConsentReturn('?code=abc&state=xyz')).toEqual({
      code: 'abc',
      error: null,
      state: 'xyz',
    })
  })

  it('recognises a refusal, which carries no code at all', () => {
    // Pressing Cancel on Google's consent screen comes back as
    // `?error=access_denied`. Reading only `code` would make a cancel
    // indistinguishable from an ordinary page load, and the member would be
    // looking at a button that apparently did nothing.
    expect(readConsentReturn('?error=access_denied&state=xyz')).toEqual({
      code: null,
      error: 'access_denied',
      state: 'xyz',
    })
  })

  it.each([
    ['', 'an empty query'],
    ['?foo=1', 'an unrelated query'],
    [undefined, 'no query at all'],
    // #304 AC 4 — the discriminator. Google echoes this flow's `state` on every
    // return, so a query WITHOUT one did not come from the calendar consent: a
    // Supabase sign-in error lands on the same root with no state, and so
    // would a PKCE `?code=`. Neither may reach `completeConnect`.
    ['?code=abc', 'a code with no state — not this flow’s, and never sent to calendar-connect'],
    ['?error=invalid_request&error_code=bad_oauth_state', 'a Supabase sign-in error, which carries no state'],
    ['?state=xyz', 'a state with neither a code nor an error'],
  ])('is null for %s — %s', (search) => {
    expect(readConsentReturn(search)).toBeNull()
  })

  it('builds the redirect address from where the app is actually running', () => {
    // Not written down anywhere, so a preview deployment, the custom domain and
    // a dev server each ask for themselves — and a host Google does not know is
    // refused BY GOOGLE, naming the address, rather than silently sending
    // somebody to a different deployment.
    expect(redirectUriFor(LOCATION)).toBe('https://taskr.example.test/')
  })
})

describe('the state token', () => {
  it('is unguessable and different every time', () => {
    const a = newConsentState()
    const b = newConsentState()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('is written down before the browser leaves, and appears in the URL', () => {
    const storage = fakeStorage()
    const url = startConnect({ householdId: 'household-1', storage, location: LOCATION })
    const stored = storage.getItem(CONSENT_STATE_KEY)
    expect(stored).toBeTruthy()
    expect(paramsOf(url).get('state')).toBe(stored)
  })

  it('#161 — the household travels with it, and is spent with it', async () => {
    // Which household a connection is for has to survive a trip to Google and
    // back. It rides in the same storage as the state token because that token
    // ALREADY has to survive it: no new way to fail, and the failure that does
    // exist is refused by the state check first.
    const storage = fakeStorage()
    startConnect({ householdId: 'household-7', storage, location: LOCATION })
    expect(storage.getItem(CONSENT_HOUSEHOLD_KEY)).toBe('household-7')

    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await completeConnect(
      { code: 'abc', state: storage.getItem(CONSENT_STATE_KEY) },
      { storage, location: LOCATION },
    )
    expect(invoke.mock.calls[0][1].body.householdId).toBe('household-7')
    expect(
      storage.getItem(CONSENT_HOUSEHOLD_KEY),
      'consumed like the state, so a later request cannot inherit it',
    ).toBeNull()
  })

  it('#161 — refuses to start without a household rather than guessing one', () => {
    // The alternative is a connection filed under whichever household came back
    // first, which is the defect this story exists to remove. Loud here beats
    // silent there.
    expect(() => startConnect({ storage: fakeStorage(), location: LOCATION })).toThrow(
      /must name one/,
    )
  })

  it('#161 — refuses a return whose household this device no longer remembers', async () => {
    // Checked AFTER the state, deliberately: a forged return is a forgery, not a
    // forgotten household, and the two sentences send a person to different
    // places.
    const storage = fakeStorage({ [CONSENT_STATE_KEY]: 'ok' })
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await expect(
      completeConnect({ code: 'abc', state: 'ok' }, { storage, location: LOCATION }),
    ).rejects.toThrow(/forgot which household/)
    expect(invoke, 'nothing reaches the server without a household').not.toHaveBeenCalled()
  })

  it('is what a return has to match, or nothing is sent to the server', async () => {
    const storage = fakeStorage({ [CONSENT_STATE_KEY]: 'the-real-one' })
    await expect(
      completeConnect({ code: 'abc', state: 'a-different-one' }, { storage, location: LOCATION }),
    ).rejects.toThrow(/did not come from this device/)
    expect(invoke, 'a mismatched state must not reach the Edge Function').not.toHaveBeenCalled()
  })

  it('is refused when this device never started a connection', async () => {
    // The case a mismatch check alone would miss: with nothing stored, comparing
    // `null` to a supplied state is only safe because the absence is checked
    // FIRST. An attacker-supplied `?code=&state=` on a fresh device must not be
    // able to attach their calendar to whoever opens the link.
    await expect(
      completeConnect({ code: 'abc', state: 'anything' }, { storage: fakeStorage(), location: LOCATION }),
    ).rejects.toThrow(/did not come from this device/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('is spent whatever happens, so a second attempt cannot reuse it', async () => {
    // The mock RESOLVES here, and the rejection is matched against OUR sentence
    // rather than left as a bare `toThrow()`. Both changes came out of a
    // mutation pass, round 1, and they are the same defect twice.
    //
    // *Measured*: removing the state check reddened 2 against a predicted 3, and
    // this test was the one that stayed green — it passed for a reason that had
    // nothing to do with the check. With `invoke` reset and returning
    // `undefined`, destructuring `{ data, error }` off it throws a TypeError, so
    // `rejects.toThrow()` was satisfied by the harness rather than by the code:
    // exactly the shape cairn records as "a bare toThrow cannot distinguish the
    // guard firing from the code breaking".
    const storage = fakeStorage({ [CONSENT_STATE_KEY]: 'once' })
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(
      completeConnect({ code: 'abc', state: 'wrong' }, { storage, location: LOCATION }),
    ).rejects.toThrow(/did not come from this device/)
    expect(storage.getItem(CONSENT_STATE_KEY)).toBeNull()
    expect(invoke, 'a spent state must not have reached the server either').not.toHaveBeenCalled()
  })
})

describe('completeConnect', () => {
  it('hands the code and the SAME redirect address to the Edge Function', async () => {
    // Google requires the `redirect_uri` at the exchange to equal the one used at
    // consent. Deriving both from `location.origin` through one function is what
    // makes that true by construction rather than by two matching literals.
    const storage = fakeStorage({ [CONSENT_STATE_KEY]: 'ok', [CONSENT_HOUSEHOLD_KEY]: 'household-1' })
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await completeConnect({ code: 'the-code', state: 'ok' }, { storage, location: LOCATION })

    expect(invoke).toHaveBeenCalledWith('calendar-connect', {
      body: {
        code: 'the-code',
        redirectUri: 'https://taskr.example.test/',
        // #161 — which household, never who. The person is `auth.uid()` on the
        // server side and no field here can say otherwise.
        householdId: 'household-1',
      },
    })
  })

  it('surfaces the function’s OWN sentence rather than the SDK’s generic one', async () => {
    // `functions.invoke` reports every non-2xx as "Edge Function returned a
    // non-2xx status code", which names nothing. The handler distinguishes a
    // refused code from an unreachable Google from a missing configuration, and
    // that distinction is the whole value — #112 is this repo's recorded case of
    // a generic message sending somebody to check the network.
    const storage = fakeStorage({ [CONSENT_STATE_KEY]: 'ok', [CONSENT_HOUSEHOLD_KEY]: 'household-1' })
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'Google refused the connection: invalid_grant' }) },
      },
    })

    await expect(
      completeConnect({ code: 'spent', state: 'ok' }, { storage, location: LOCATION }),
    ).rejects.toThrow(/invalid_grant/)
  })

  it('falls back to the SDK message when there is no body to read', async () => {
    // A genuinely dropped connection has no response to unwrap. Without this the
    // member would get an empty sentence, which reads as the app having no idea
    // — and it is the branch a happy-path test cannot reach.
    const storage = fakeStorage({ [CONSENT_STATE_KEY]: 'ok', [CONSENT_HOUSEHOLD_KEY]: 'household-1' })
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } })

    await expect(
      completeConnect({ code: 'x', state: 'ok' }, { storage, location: LOCATION }),
    ).rejects.toThrow(/Failed to send a request/)
  })
})

describe('listCalendarConnections', () => {
  it('asks for exactly the columns `0011` grants, never `*`', async () => {
    // `household_id` is withheld from the select grant, so `select('*')` fails
    // OUTRIGHT on this table rather than returning a subset — the device 0003,
    // 0005 and 0010 all use. This constant is what `LIVE_SCHEMA` imports, so a
    // column added to one is added to the live check too.
    await listCalendarConnections(MEMBER_IDS)
    expect(calls).toEqual([
      { op: 'select', table: 'calendar_connections', cols: CALENDAR_CONNECTION_COLUMNS },
      { op: 'in', table: 'calendar_connections', column: 'member_id', value: MEMBER_IDS },
    ])
    expect(CALENDAR_CONNECTION_COLUMNS).not.toContain('*')
    // Still withheld after 0014, which grants household_id on `members` and
    // `chores` only — this table is scoped from the already-scoped member set
    // instead, so it keeps the column back and keeps the wildcard refusal.
    expect(CALENDAR_CONNECTION_COLUMNS).not.toContain('household_id')
  })

  // #159 AC 1 — an empty member set is answered without a round trip.
  it('reads nothing at all when the household has no members', async () => {
    expect(await listCalendarConnections([])).toEqual([])
    expect(calls).toEqual([])
  })

  it('no file under src/ QUERIES the token table', () => {
    // AC 5's other half, as a property of the code rather than a promise. The
    // client is granted nothing on `calendar_tokens`, so a query would fail at
    // runtime with a permission error — the point is that no path exists that
    // would try it.
    //
    // The pattern matches a QUERY and not a MENTION, deliberately. The first
    // version matched the bare table name and refused `calendar.js` for its own
    // docblock — which has to name that table in order to explain why no client
    // may read it. Cairn calls this
    // `a-guard-that-reads-source-must-survive-its-own-docs`, and its 2026-08-13
    // repair is the one taken here: match the scan to the SUBJECT. The subject
    // is a call, and no sentence is accidentally a call.
    //
    // Written twice, in one sitting. The narrowed version then refused THIS
    // file, because the comment explaining the narrowing spelled the call out in
    // full to say what it matches — the same note's second recorded instance,
    // where knowing the rule is what produces the breach. So this paragraph
    // describes the pattern and does not reproduce it; the pattern is below,
    // once, where it is code.
    const offenders = []
    for (const file of sourceFilesUnderSrc()) {
      if (/\.from\(\s*['"]calendar_tokens['"]\s*\)/.test(readFileSync(file, 'utf8'))) {
        offenders.push(file.slice(process.cwd().length + 1))
      }
    }
    expect(offenders, `these files query the token table: ${offenders.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: the same scan DOES find the table the client may read', () => {
    // Without this the assertion above passes just as happily against a regex
    // that matches nothing — an absence proving nothing, which is exactly how a
    // guard on source text stops guarding.
    const found = sourceFilesUnderSrc().filter((file) =>
      /\.from\(\s*['"]calendar_connections['"]\s*\)/.test(readFileSync(file, 'utf8')),
    )
    expect(found.length).toBeGreaterThan(0)
  })

  it('returns an empty list when nobody has connected, rather than null', async () => {
    selectResult = { data: null, error: null }
    expect(await listCalendarConnections(MEMBER_IDS)).toEqual([])
  })

  it('reports a failure in this app’s words, keeping the cause', async () => {
    selectResult = { data: null, error: { message: 'permission denied', code: '42501' } }
    await expect(listCalendarConnections(MEMBER_IDS)).rejects.toThrow(/loading calendar connections/)
  })
})

describe('whether this build was given a Google client', () => {
  it('is true when the variable is set', () => {
    expect(hasCalendarConfig).toBe(true)
  })

  it('POSITIVE CONTROL: the flag is derived from the variable, not hard-coded', () => {
    // Without this, `hasCalendarConfig` could be a literal `true` and the
    // assertion above would pass identically — which is how a configuration flag
    // stops reporting configuration.
    expect(() => consentUrl({ redirectUri: 'https://x.test/', state: 's', clientId: '' })).toThrow(
      /VITE_GOOGLE_CLIENT_ID/,
    )
  })
})

// ===========================================================================
// #96 — the derived busy figure, client half
// ===========================================================================

const WEEK = '2026-09-07'

describe('listBusyWeeks', () => {
  it('asks for exactly the columns `0030` grants, never `*`', async () => {
    // `household_id` is withheld from the select grant, so `select('*')` fails
    // OUTRIGHT on this table — the device 0003, 0005, 0010 and 0011 all use.
    // This constant is what `LIVE_SCHEMA` imports, so a column added to one is
    // added to the live check with it.
    await listBusyWeeks(WEEK, MEMBER_IDS)
    expect(calls).toEqual([
      { op: 'select', table: 'calendar_busy', cols: CALENDAR_BUSY_COLUMNS },
      { op: 'in', table: 'calendar_busy', column: 'member_id', value: MEMBER_IDS },
      { op: 'eq', table: 'calendar_busy', column: 'period_start', value: WEEK },
    ])
    expect(CALENDAR_BUSY_COLUMNS).not.toContain('*')
    expect(CALENDAR_BUSY_COLUMNS).not.toContain('household_id')
  })

  it('asks for nothing a calendar could have put in it', () => {
    // The minimization decision as a property of the column list rather than a
    // promise in a comment. There is no column here that COULD hold a title, so
    // this is really an assertion that `0030`'s shape has not grown one.
    //
    // Asserted as the EXACT SET of names, not by substring, and that is not
    // fastidiousness — the substring form was written first and failed on
    // `period_start`, which contains `start`. A substring test that has to be
    // weakened until it passes ends up matching nothing anybody meant, which is
    // the shape cairn calls `a-substring-match-is-satisfied-by-a-longer-neighbour`.
    const columns = CALENDAR_BUSY_COLUMNS.split(',').map((c) => c.trim())
    expect(columns).toEqual([
      'id',
      'member_id',
      'period_start',
      'busy_minutes',
      'event_count',
      'computed_at',
    ])
    for (const forbidden of ['summary', 'title', 'attendee', 'location', 'event_start']) {
      expect(columns).not.toContain(forbidden)
    }
  })

  it('reads nothing at all when the household has no members', async () => {
    expect(await listBusyWeeks(WEEK, [])).toEqual([])
    expect(calls).toEqual([])
  })

  it('refuses a read that names no week', async () => {
    // The week is not optional, and the failure is loud rather than a read of
    // every week this household has ever had — which would return rows the
    // roster then matches by period anyway, so the fault would be invisible.
    await expect(listBusyWeeks(null, MEMBER_IDS)).rejects.toThrow(/Which week/)
  })

  it('refuses a read that names no member set', async () => {
    await expect(listBusyWeeks(WEEK, undefined)).rejects.toThrow(/Which household/)
  })

  it('returns an empty list when nobody has a figure, rather than null', async () => {
    selectResult = { data: null, error: null }
    expect(await listBusyWeeks(WEEK, MEMBER_IDS)).toEqual([])
  })

  it('reports a failure in this app’s words, keeping the cause', async () => {
    selectResult = { data: null, error: { message: 'permission denied', code: '42501' } }
    await expect(listBusyWeeks(WEEK, MEMBER_IDS)).rejects.toThrow(/loading calendar busy minutes/)
  })
})

describe('busyWeekFor', () => {
  const ROWS = [
    { member_id: 'm1', period_start: WEEK, busy_minutes: 300 },
    { member_id: 'm1', period_start: '2026-08-31', busy_minutes: 60 },
    { member_id: 'm2', period_start: WEEK, busy_minutes: 90 },
  ]

  it('matches on the person AND the week', () => {
    expect(busyWeekFor(ROWS, 'm1', WEEK).busy_minutes).toBe(300)
    expect(busyWeekFor(ROWS, 'm2', WEEK).busy_minutes).toBe(90)
  })

  it('does not answer with another week’s figure', () => {
    // The fault `overrideFor` had in #46 and `capacitiesFor` guards against: a
    // figure from a foreign period beside this week's minutes is invisible,
    // because every number on screen stays plausible.
    expect(busyWeekFor(ROWS, 'm1', '2026-09-14')).toBeNull()
  })

  it('returns null rather than undefined for a member with no figure', () => {
    expect(busyWeekFor(ROWS, 'm3', WEEK)).toBeNull()
    expect(busyWeekFor([], 'm1', WEEK)).toBeNull()
  })
})

describe('fetchBusyWeek', () => {
  it('names the household and the week, and never who it is about', async () => {
    // Owner decision, 2026-09-04: the function reads the CALLER'S own calendar,
    // so a member id in this body would be a value the server must ignore. The
    // cheapest way to be sure it is ignored is not to send one.
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await fetchBusyWeek({ householdId: 'h1', periodStart: WEEK })
    expect(invoke).toHaveBeenCalledWith('calendar-busy', {
      body: { householdId: 'h1', periodStart: WEEK },
    })
    const [, options] = invoke.mock.calls[0]
    expect(Object.keys(options.body).sort()).toEqual(['householdId', 'periodStart'])
  })

  it('refuses to ask without a household or a week', async () => {
    await expect(fetchBusyWeek({ periodStart: WEEK })).rejects.toThrow(/Which household/)
    await expect(fetchBusyWeek({ householdId: 'h1' })).rejects.toThrow(/Which week/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows the FUNCTION’S sentence, not the SDK’s', async () => {
    // #112's lesson. `functions.invoke` reports every non-2xx as "Edge Function
    // returned a non-2xx status code", which names nothing and reads like the
    // network is down — while the handler distinguishes a revoked connection
    // from an unreachable Google from a missing configuration, and AC 5 puts
    // that sentence on the screen.
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'That calendar connection is no longer valid.' }) },
      },
    })
    await expect(fetchBusyWeek({ householdId: 'h1', periodStart: WEEK })).rejects.toThrow(
      /no longer valid/,
    )
  })

  it('falls back to the SDK’s message when the body cannot be read', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Failed to send a request to the Edge Function',
        context: {
          json: async () => {
            throw new SyntaxError('not json')
          },
        },
      },
    })
    await expect(fetchBusyWeek({ householdId: 'h1', periodStart: WEEK })).rejects.toThrow(
      /Failed to send a request/,
    )
  })
})

// #98 AC 1 — the staleness bound, and the predicate that applies it. App.test.jsx
// proves WHEN the app asks; this proves what "older than the bound" means, with
// the clock injected so the boundary itself can be pinned rather than sampled.
describe('isBusyWeekStale', () => {
  const NOW = Date.parse('2026-09-08T18:00:00Z')
  const rowReadAt = (msAgo) => ({ computed_at: new Date(NOW - msAgo).toISOString() })

  it('names twelve hours, in hours and in the milliseconds the comparison uses', () => {
    // The constant is the criterion's "default 12 hours". Both spellings are
    // exported so a reader and the comparison cannot disagree about the unit.
    expect(BUSY_STALE_AFTER_HOURS).toBe(12)
    expect(BUSY_STALE_AFTER_MS).toBe(12 * 60 * 60 * 1000)
  })

  it('is stale strictly BEYOND the bound, and fresh at it', () => {
    expect(isBusyWeekStale(rowReadAt(BUSY_STALE_AFTER_MS + 1), NOW)).toBe(true)
    expect(isBusyWeekStale(rowReadAt(BUSY_STALE_AFTER_MS), NOW)).toBe(false)
    expect(isBusyWeekStale(rowReadAt(BUSY_STALE_AFTER_MS - 1), NOW)).toBe(false)
  })

  it('is fresh for a figure read moments ago, and stale for one read yesterday', () => {
    expect(isBusyWeekStale(rowReadAt(60 * 1000), NOW)).toBe(false)
    expect(isBusyWeekStale(rowReadAt(24 * 60 * 60 * 1000), NOW)).toBe(true)
  })

  it('measures wall-clock age, so midnight does not make a figure stale', () => {
    // 23:00 to 00:01 is one hour and one minute, whatever the date did.
    const justBeforeMidnight = { computed_at: '2026-09-08T03:00:00Z' } // 23:00 New York
    const justAfter = Date.parse('2026-09-08T04:01:00Z') // 00:01 New York
    expect(isBusyWeekStale(justBeforeMidnight, justAfter)).toBe(false)
  })

  it('reads a figure of unknown age as stale, never as current', () => {
    expect(isBusyWeekStale({ computed_at: 'whenever' }, NOW)).toBe(true)
    expect(isBusyWeekStale({ computed_at: null }, NOW)).toBe(true)
    expect(isBusyWeekStale({}, NOW)).toBe(true)
  })

  it('is not stale when there is no row — that is #96’s trigger, not this one', () => {
    expect(isBusyWeekStale(null, NOW)).toBe(false)
    expect(isBusyWeekStale(undefined, NOW)).toBe(false)
  })

  it('defaults the clock to now, so a caller need not pass one', () => {
    expect(isBusyWeekStale({ computed_at: new Date().toISOString() })).toBe(false)
    expect(isBusyWeekStale({ computed_at: '2020-01-01T00:00:00Z' })).toBe(true)
  })
})

describe('busyComputedLabel', () => {
  it('says which day the figure was read, in the household’s zone', () => {
    // 21:00 in New York on the 4th is 01:00 UTC on the 5th. The zone is what
    // decides which day this happened on, and asking UTC would name the wrong
    // one for every household west of Greenwich — which is all of them.
    expect(busyComputedLabel('2026-09-05T01:00:00Z', 'America/New_York')).toBe('Sep 4')
    expect(busyComputedLabel('2026-09-05T01:00:00Z', 'UTC')).toBe('Sep 5')
  })

  it('costs the date and never the figure when it cannot parse', () => {
    expect(busyComputedLabel('whenever', 'America/New_York')).toBeNull()
    expect(busyComputedLabel(null, 'America/New_York')).toBeNull()
    expect(busyComputedLabel('2026-09-05T01:00:00Z', null)).toBeNull()
    expect(busyComputedLabel('2026-09-05T01:00:00Z', 'Nowhere/Atlantis')).toBeNull()
  })
})
