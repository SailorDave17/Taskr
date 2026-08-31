import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The shell's own assertions (heading, fairness rule, build stamp) survive from
// #4 unchanged — they are what makes a deploy observable. What changed in #5 is
// everything between: the page is now a function of whether this device has
// joined a household, answered by the server on every load.
//
// Names are synthetic — see #19.

const backend = { hasSupabaseConfig: true }

const api = {
  currentSession: vi.fn(),
  currentHousehold: vi.fn(),
  listMembers: vi.fn(),
  currentUserId: vi.fn(),
  createHousehold: vi.fn(),
  signIn: vi.fn(),
  signUpOrganizer: vi.fn(),
  signOut: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
}

// #34. Mocked separately from household.js because it is a separate module, and
// the pure validators are kept real (importActual below) so a test cannot pass
// against a stub that disagrees with the rules the form actually enforces.
const choresApi = {
  listChores: vi.fn(),
  addChore: vi.fn(),
  // #220 — the batch pass. Stubbed for the same reason addChore is: the real
  // one loops over addChore, and at this level the claim is the WIRING — the
  // household on screen travels with the rows.
  addChores: vi.fn(),
  updateChore: vi.fn(),
  removeChore: vi.fn(),
  // #53 — the boot-time catch-up pass. formatSkippedNotice stays REAL
  // (importActual below): it is pure, has its own tests, and the notice a
  // person reads should be the sentence the app actually words, not a stub's.
  catchUpRepeats: vi.fn(),
  // #12 — adjusting an actual. The derivations (actualsSummary,
  // estimateSuggestion, normalizeActualMinutes) stay real for the standing
  // reason: pure, own tests, and a stub could disagree with the boundary the
  // suggestion sits on.
  recordActualMinutes: vi.fn(),
}

// #46 — only the three IMPURE capacity functions are stubbed. periodStartFor,
// effectiveCapacity and capacitiesFor stay real, because they are pure, have
// their own tests, and a stub of them could disagree with the single
// implementation capacity.test.js asserts exists. Same reasoning the household
// mock gives for leaving findClaimedMember alone.
const capacityApi = {
  listCapacity: vi.fn(),
  setCapacity: vi.fn(),
  clearCapacity: vi.fn(),
}

// #49 — the whole module is stubbed, including its exported constant: the
// orchestrator reads the server through its own client calls, and this suite's
// getSupabase throws on purpose. What App owes is WHEN it runs, which is
// exactly what a stub records.
const reassignApi = {
  reassignHousehold: vi.fn(),
  planReassignment: vi.fn(),
  REASSIGN_MAX_ATTEMPTS: 3,
}

// #50 — only the two IMPURE seen-marker functions are stubbed. `splitSnapshot`
// and `announcementFrom` stay real for the standing reason: pure, with their
// own tests, and a stub of either could disagree with the arithmetic the bars
// render from — which is the exact disagreement AC 4 forbids.
const announceApi = {
  readSplitSeen: vi.fn(),
  writeSplitSeen: vi.fn(),
  dismissFairnessNote: vi.fn(),
}

// #37 — only the three IMPURE exclusion functions are stubbed. `isExcluded`,
// `excludedMemberIds` and `eligibleMembers` stay real for the reason the
// capacity mock gives: they are pure, they have their own tests, and a stub of
// them could disagree with the single implementation those tests assert.
const exclusionsApi = {
  listExclusions: vi.fn(),
  excludeMember: vi.fn(),
  allowMember: vi.fn(),
}

// #95 — the same treatment again: only the two IMPURE calendar functions are
// stubbed. `consentUrl`, `readConsentReturn`, `isRealEmailMember`,
// `connectionFor` and `startConnect` stay real, because they are pure (or, in
// `startConnect`'s case, pure over an injected `sessionStorage`) and a stub of
// them could disagree with the scope, the parameters and the discriminator that
// `calendar.test.js` asserts. `startConnect` staying real is what makes the
// consent URL these tests read the one the app would actually send somebody to.
const calendarApi = {
  listCalendarConnections: vi.fn(),
  completeConnect: vi.fn(),
}

// Set BEFORE `calendar.js` is imported, because it reads `import.meta.env` once
// at module scope — the same shape as `supabase.js`. Without it `startConnect`
// refuses (correctly: an unconfigured build cannot build a consent URL) and the
// AC 3 test below would assert that nothing happened, which is a true statement
// about a build nobody ships.
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '1234567890-placeholder.apps.googleusercontent.com')

vi.mock('./lib/supabase.js', () => ({
  get hasSupabaseConfig() {
    return backend.hasSupabaseConfig
  },
  getSupabase: () => {
    throw new Error('App must not reach the client directly; it goes through lib/household.js')
  },
}))

vi.mock('./lib/chores.js', async () => {
  const actual = await vi.importActual('./lib/chores.js')
  return { ...actual, ...choresApi }
})

vi.mock('./lib/capacity.js', async () => {
  const actual = await vi.importActual('./lib/capacity.js')
  return { ...actual, ...capacityApi }
})

vi.mock('./lib/exclusions.js', async () => {
  const actual = await vi.importActual('./lib/exclusions.js')
  return { ...actual, ...exclusionsApi }
})

vi.mock('./lib/calendar.js', async () => {
  const actual = await vi.importActual('./lib/calendar.js')
  return { ...actual, ...calendarApi }
})

vi.mock('./lib/reassign.js', () => reassignApi)

vi.mock('./lib/announce.js', async () => {
  const actual = await vi.importActual('./lib/announce.js')
  return { ...actual, ...announceApi }
})

vi.mock('./lib/household.js', async () => {
  // findClaimedMember is pure and has its own tests, so the real one is used
  // rather than a stub that could disagree with it.
  const actual = await vi.importActual('./lib/household.js')
  return { ...actual, ...api }
})

const { default: App } = await import('./App.jsx')

// The REAL pure halves, for building #50's expected snapshot the same way
// refresh() does — through the mocked modules these would be the same
// functions, but importActual says so instead of relying on it.
const actualAnnounce = await vi.importActual('./lib/announce.js')
const actualCapacity = await vi.importActual('./lib/capacity.js')

/**
 * Render and let the boot effect settle inside act().
 *
 * App asks the server whether this device has joined before it can decide what
 * to show, so every render resolves at least one promise. Asserting before that
 * lands would be testing the loading state by accident.
 */
/**
 * Render the app and, since #47, optionally walk to the surface under test.
 *
 * The split surface opens by default (the charter's decision of 2026-08-06), so
 * a test whose subject is the roster or the chore screen needs one tap to reach
 * it. Passing the tab's label rather than reaching into state is deliberate: the
 * navigation is itself criterion 11, so a helper that set the view directly
 * would quietly stop covering the thing every one of these tests walks past.
 *
 * Nothing else about the tests below changed. Where one of them now reads
 * `renderApp('Who')`, the assertion underneath it is the one it always had.
 */
const renderApp = async (surface) => {
  await act(async () => void render(<App />))
  if (surface) {
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: surface })))
  }
}

beforeEach(() => {
  backend.hasSupabaseConfig = true
  Object.values(api).forEach((fn) => fn.mockReset())
  Object.values(choresApi).forEach((fn) => fn.mockReset())
  Object.values(capacityApi).forEach((fn) => fn.mockReset())
  Object.values(exclusionsApi).forEach((fn) => fn.mockReset())
  Object.values(calendarApi).forEach((fn) => fn.mockReset())
  calendarApi.listCalendarConnections.mockResolvedValue([])
  calendarApi.completeConnect.mockResolvedValue({ ok: true })
  exclusionsApi.listExclusions.mockResolvedValue([])
  exclusionsApi.excludeMember.mockResolvedValue(undefined)
  exclusionsApi.allowMember.mockResolvedValue(undefined)
  capacityApi.listCapacity.mockResolvedValue([])
  capacityApi.setCapacity.mockResolvedValue(undefined)
  capacityApi.clearCapacity.mockResolvedValue(undefined)
  reassignApi.reassignHousehold.mockReset()
  reassignApi.reassignHousehold.mockResolvedValue({ applied: 0, assignments_version: 1 })
  Object.values(announceApi).forEach((fn) => fn.mockReset())
  // No seen-marker row yet — the ordinary first-look state, which announces
  // nothing. Tests about the announcement override this.
  announceApi.readSplitSeen.mockResolvedValue(null)
  announceApi.writeSplitSeen.mockResolvedValue(undefined)
  announceApi.dismissFairnessNote.mockResolvedValue(undefined)
  choresApi.listChores.mockResolvedValue([])
  // Nothing missed and nothing skipped, which is the ordinary open. Tests
  // about the notice and the failure path override this.
  choresApi.catchUpRepeats.mockResolvedValue({ created: 0, skipped: 0 })
  choresApi.addChore.mockResolvedValue(undefined)
  choresApi.addChores.mockResolvedValue([])
  choresApi.updateChore.mockResolvedValue(undefined)
  choresApi.removeChore.mockResolvedValue(undefined)
  choresApi.recordActualMinutes.mockResolvedValue(undefined)
  // A session by default, because most tests are about a signed-in person. The
  // signed-OUT case is now a first-class state rather than a failure, and it has
  // its own describe below.
  api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
  api.currentHousehold.mockResolvedValue(null)
  api.listMembers.mockResolvedValue([])
  api.currentUserId.mockResolvedValue('person-a')
  api.signIn.mockResolvedValue({ user: { id: 'person-a' } })
  api.signUpOrganizer.mockResolvedValue({ user: { id: 'person-a' } })
  api.signOut.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('the shell, unchanged from #4', () => {
  it('renders the product name as the page heading', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { level: 1, name: 'Taskr' })).toBeInTheDocument()
  })

  it('states the fairness rule the charter is built on', async () => {
    await renderApp()
    expect(screen.getByText(/proportional to what each person actually has/i)).toBeInTheDocument()
  })

  it('stamps the running build so a deploy is observable from the browser', async () => {
    await renderApp()
    const stamp = screen.getByTestId('build-commit')
    expect(stamp).toBeInTheDocument()
    expect(stamp.textContent.replace(/^build\s+/, '')).not.toBe('')
  })
})

describe('when the build has no backend', () => {
  it('says so, instead of a network error that reads like an outage', async () => {
    backend.hasSupabaseConfig = false
    await renderApp()

    expect(await screen.findByRole('region', { name: /no backend configured/i })).toBeInTheDocument()
    // And it does not attempt a session read it cannot possibly complete.
    expect(api.currentSession).not.toHaveBeenCalled()
  })
})

describe('when nobody is signed in', () => {
  it('offers both ways in', async () => {
    // The null session is load-bearing and was missing: this test sat inside
    // "when nobody is signed in" while inheriting the default fixture, which HAS
    // a session. It passed anyway until the sign-in pane started hiding itself
    // for somebody already signed in — at which point the block's title and its
    // fixture stopped agreeing out loud.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    expect(await screen.findByRole('button', { name: /create household/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  it('asks the server nothing at all — signed out is a state, not a failure', async () => {
    // #62's reversal. This test used to assert the opposite shape: that the app
    // signed the DEVICE in anonymously BEFORE reading, so boot always ended with
    // an identity. Now there is no identity to mint, and the reads are skipped
    // rather than attempted-and-empty.
    //
    // Skipped deliberately, not incidentally: the reads would SUCCEED against a
    // signed-out caller — every policy simply returns nothing — so "signed out"
    // and "your household disappeared" would render identically, and the second
    // reading is both wrong and the more alarming one.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })

    expect(api.currentSession).toHaveBeenCalled()
    expect(api.currentHousehold).not.toHaveBeenCalled()
    expect(api.listMembers).not.toHaveBeenCalled()
  })

  it('creates the account before the household, because the order is unrecoverable', async () => {
    // `create_household` refuses an unauthenticated caller and claims the
    // organizer's member row in the same statement. Reversed, the household
    // would exist with an unclaimed organizer — visible to nobody, and not
    // fixable from the client.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })

    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText(/your email/i), {
      target: { value: 'alex@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/your password/i), {
      target: { value: 'longenough' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /create household/i })),
    )

    expect(api.signUpOrganizer).toHaveBeenCalledWith({
      email: 'alex@example.com',
      password: 'longenough',
    })
    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
    expect(api.signUpOrganizer.mock.invocationCallOrder[0]).toBeLessThan(
      api.createHousehold.mock.invocationCallOrder[0],
    )
  })

  it('does not reach create_household when the signup fails', async () => {
    // The order assertion above kills the mutation its comment describes —
    // swapping the two statements — and NOT a dropped `await`, because both
    // calls still happen in the same lexical order without one. This is the
    // assertion that reddens on a dropped await, and the review found it missing.
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockRejectedValue(new Error('User already registered'))
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })

    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText(/your email/i), {
      target: { value: 'alex@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'longenough' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /create household/i })),
    )

    expect(api.createHousehold).not.toHaveBeenCalled()
  })

  it('skips the signup when a session already exists — the half-finished state', async () => {
    // Account made, household not: two durable steps with no transaction, and
    // against a project without 0007 the second fails every time. Calling
    // `signUp` again for an address that now exists throws and never reaches the
    // RPC, which is what made this a dead end. The session is what decides.
    api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
    api.currentHousehold.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue('person-a')
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })

    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /create household/i })),
    )

    expect(api.signUpOrganizer).not.toHaveBeenCalled()
    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
  })

  it('signs an existing member in through the data layer', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign in$/i })))

    expect(api.signIn).toHaveBeenCalledWith({ email: 'kid@example.com', password: '4821' })
  })
})

describe('when the signed-in person belongs to a household', () => {
  // `timezone` is `not null default 'UTC'` since 0005, so a household row always
  // carries one. #36's load figures resolve capacity for a PERIOD, and
  // periodStartFor refuses to guess a zone rather than silently using the
  // phone's — so a fixture without it is a fixture the database cannot produce.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])
  })

  /**
   * A member's name is on screen TWICE since #36 — once in the roster and once
   * in the chore card's load list — so a bare findByText is ambiguous and these
   * queries are scoped to the roster region deliberately. Scoping rather than
   * switching to findAllByText: the claim these tests make is "the ROSTER is
   * showing", and a count of two names anywhere on the page would go on passing
   * if the roster disappeared and the load list rendered the same person twice.
   */
  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('shows the roster rather than the sign-in screen', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(inRoster().getByText('Placeholder One')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
  })

  // AC 3: the roster is read from the server on load. If it were cached
  // locally, a passing "survives a restart" check would be indistinguishable
  // from a device that merely remembered.
  it('reads the household from the server on every load, not from storage', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(api.currentHousehold).toHaveBeenCalled()
    expect(api.listMembers).toHaveBeenCalled()
    expect(window.localStorage.getItem('taskr.household')).toBeNull()
    expect(window.localStorage.getItem('taskr.members')).toBeNull()
  })

  // #159 AC 1 / AC 4 - WHICH household App names, not merely that it read.
  //
  // The mutation pass is what produced these. Every assertion in this file about
  // the reads was `toHaveBeenCalled()` or a call count, so App could have passed
  // the wrong household id, a stale one, or nothing at all and nothing here
  // would have gone red. App is the ONLY place the household is chosen - the
  // data layer takes it as an argument now - so that was the one level at which
  // the story's whole claim was untested.
  it('names the active household on every read that takes one', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(api.listMembers).toHaveBeenCalledWith(household.id)
    expect(choresApi.listChores).toHaveBeenCalledWith(household.id)
  })

  it('scopes the member-keyed reads by the roster it just read, not by everything', async () => {
    // member_capacity, chore_exclusions and calendar_connections withhold
    // household_id and are scoped from the already-scoped MEMBER set (#157 AC
    // 4). That makes the roster read load-bearing for three other reads, and
    // the ORDER in refresh() load-bearing with it - a detail no other test here
    // would notice going wrong.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const memberIds = ['m1']
    expect(exclusionsApi.listExclusions).toHaveBeenCalledWith(memberIds)
    expect(calendarApi.listCalendarConnections).toHaveBeenCalledWith(memberIds)
    const capacityCall = capacityApi.listCapacity.mock.calls.at(-1)
    expect(capacityCall?.[1]).toEqual(memberIds)
  })

  it('marks the person signed in on this phone, from the live auth id', async () => {
    await renderApp('Who')
    expect(await screen.findByText(/· you/)).toBeInTheDocument()
  })

  it('re-reads from the server after a change, rather than patching what it has', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = api.listMembers.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /refresh/i })))

    await waitFor(() => expect(api.listMembers.mock.calls.length).toBeGreaterThan(readsBefore))
  })
})

describe('when the backend cannot be reached', () => {
  it('shows the reason rather than an empty household', async () => {
    api.currentSession.mockRejectedValue(new Error('Failed to fetch'))
    await renderApp()

    expect(await screen.findByRole('region', { name: /could not reach the household/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to fetch/i)
    // Critically, not the sign-in screen: offering "create a household" against
    // a backend that is refusing would send the organizer round a loop. The
    // distinction is sharper since #62, because a signed-out phone ALSO shows
    // that screen — so an unreachable backend must not be mistaken for one.
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #160 — who you are, and whether you organise, WITHIN the active household
//
// One person, two households — the state 0009 made representable. person-a
// ORGANIZES household A (their claimed row there is A's organizer_member_id)
// and is a PLAIN MEMBER of household B. `isOrganizer` must be true when A is
// active and false when B is active, asserted in BOTH directions because a
// check that is always false satisfies the negative arm trivially.
//
// These live at the App level because App is the only place `me` and
// `isOrganizer` are derived — findClaimedMember stays REAL here (the
// household.js mock keeps it), so a mutation in the identity layer reddens
// these, not just its unit tests.
// ---------------------------------------------------------------------------

describe('#160 — identity and organizer within the active household', () => {
  const householdA = {
    id: 'household-a',
    name: 'Placeholder Household',
    organizer_member_id: 'm-a1',
    timezone: 'America/New_York',
  }
  const householdB = {
    id: 'household-b',
    name: 'Placeholder Other Household',
    organizer_member_id: 'm-b1',
    timezone: 'America/New_York',
  }
  // In each roster, one row is claimed by person-a. B's roster puts that row
  // FIRST so that in the merged-roster tests below the FOREIGN claimed row is
  // the one an unscoped match would return.
  const rosterA = [
    { id: 'm-a1', household_id: 'household-a', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm-a2', household_id: 'household-a', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' },
  ]
  const rosterB = [
    { id: 'm-b2', household_id: 'household-b', display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm-b1', household_id: 'household-b', display_name: 'Placeholder Other Organizer', weekly_minutes: 200, claimed_by: 'person-b' },
  ]

  beforeEach(() => {
    // Scoped, the way the real listMembers behaves since #159: the roster of
    // the household that was asked for. The merged-roster tests below override
    // this on purpose.
    api.listMembers.mockImplementation(async (id) =>
      id === householdA.id ? rosterA : id === householdB.id ? rosterB : [],
    )
  })

  it('AC 5 / AC 3 positive: with their organized household active, the organizer-only controls are offered', async () => {
    api.currentHousehold.mockResolvedValue(householdA)
    await renderApp('Who')

    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    // Per-row too: giving somebody ELSE a sign-in is the organizer-only act.
    expect(screen.getByTestId('provision-m-a2')).toBeInTheDocument()
  })

  it('AC 4 / AC 3 negative: a plain member of the active household gets no organizer-only control on any row', async () => {
    api.currentHousehold.mockResolvedValue(householdB)
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    // The identity RESOLVED — they are somebody here, on their own row. Without
    // this, the absence below would also pass for `me === null`, which is a
    // different and worse state (nobody, rather than not-the-organizer).
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder Three')
    // ...and NO row offers an organizer-only control. Queried across the whole
    // page rather than one named row, because "any row" is the criterion.
    expect(screen.queryByTestId('provisioning-note')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/^provision-/)).toHaveLength(0)
  })

  it('AC 2: `me` resolves within the household on screen even off a roster that spans both', async () => {
    // The data-layer regression #159 exists to prevent, handed to the identity
    // layer on purpose: a merged roster with person-a's FOREIGN claimed row
    // first, so an unscoped match returns the wrong member. #159's own tests
    // pin what listMembers returns; this one asserts the identity layer does
    // not LEAN on that. Resolving `me` from the unscoped list is the mutation
    // this must redden (AC 7): unscoped, `me` becomes m-b2, `isOrganizer` goes
    // false, and both assertions below fail.
    api.listMembers.mockImplementation(async () => [...rosterB, ...rosterA])
    api.currentHousehold.mockResolvedValue(householdA)
    await renderApp('Who')

    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder One')
  })

  it('AC 3: the household on screen and the identity come from the SAME read', async () => {
    // currentHousehold answers A, then B, then A… — the two-household coin
    // toss #159 removed from the data layer, made deterministic. Every refresh
    // (boot, and arriving on Who re-reads) must derive the household state AND
    // the roster scope from its OWN single read: a refresh that drew them from
    // two reads pairs one household's roster with the other's identity, `me`
    // resolves to nobody, and the badge below has no row to land on (AC 7's
    // second mutation).
    let calls = 0
    api.currentHousehold.mockImplementation(async () => (++calls % 2 ? householdA : householdB))
    await renderApp('Who')

    // Which household won depends only on how many refreshes ran, so read it
    // off the roster read's own last call rather than assuming the count.
    const lastScoped = api.listMembers.mock.calls.at(-1)[0]
    const expectedRow = lastScoped === householdA.id ? 'Placeholder One' : 'Placeholder Three'
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent(expectedRow)
  })
})

describe('#247 — a removal that succeeds while its auth half does not', () => {
  // The two-facts warning is composed in lib/household.js and TESTED there;
  // what only this level can see is App's handleRemove — that the warning is
  // surfaced at all, and surfaced AFTER the refresh, so the screen never says
  // "removed" over a roster still listing the person. Deleting the `.then`
  // that sets it must turn this red.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    organizer_member_id: 'm1',
    timezone: 'America/New_York',
  }
  const me = { id: 'm1', household_id: 'h1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }
  const target = { id: 'm2', household_id: 'h1', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' }

  it('shows the two-facts warning over a roster the person is already gone from', async () => {
    const warning =
      'Placeholder Two was removed from the household, but their sign-in was ' +
      'NOT deleted: This function is not configured. That account can still ' +
      'sign in until it is deleted.'
    let removed = false
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockImplementation(async () => (removed ? [me] : [me, target]))
    api.removeMember.mockImplementation(async () => {
      removed = true
      return { warning }
    })

    await renderApp('Who')
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /^Remove Placeholder Two$/ })),
    )
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /Remove Placeholder Two\?/ })),
    )

    expect(api.removeMember).toHaveBeenCalledWith('m2')
    // Both facts on screen…
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Placeholder Two was removed/)
    expect(alert).toHaveTextContent(/sign-in was NOT deleted/)
    // …and the roster agrees with the first of them: the person is gone.
    const roster = within(screen.getByRole('region', { name: /who is in the household/i }))
    expect(roster.queryByText('Placeholder Two')).not.toBeInTheDocument()
  })

  it('POSITIVE CONTROL: a removal with nothing to warn about shows no alert', async () => {
    // Without this, the assertions above could be satisfied by an App that
    // shows every removal as a warning — the state most removals end in is
    // silence, and silence has to be shown reachable.
    let removed = false
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockImplementation(async () => (removed ? [me] : [me, target]))
    api.removeMember.mockImplementation(async () => {
      removed = true
      return { warning: null }
    })

    await renderApp('Who')
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /^Remove Placeholder Two$/ })),
    )
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /Remove Placeholder Two\?/ })),
    )

    const roster = within(screen.getByRole('region', { name: /who is in the household/i }))
    expect(roster.queryByText('Placeholder Two')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #34 AC 6 — the screen re-reads from the server rather than patching state
//
// These live at the App level rather than in Chores.test.jsx on purpose: the
// re-read is App's `mutate()`, and a component test of Chores.jsx cannot see
// it. Deleting the `setChores(found ? await listChores() : [])` line from
// refresh() must turn something red, and this is that something.
// ---------------------------------------------------------------------------

describe('chores — the write path and the re-read', () => {
  // `timezone` is `not null default 'UTC'` since 0005, so a household row always
  // carries one. #36's load figures resolve capacity for a PERIOD, and
  // periodStartFor refuses to guess a zone rather than silently using the
  // phone's — so a fixture without it is a fixture the database cannot produce.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const chore = {
    id: 'c1',
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([chore])
  })

  const addChoreThroughTheForm = async () => {
    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))
  }

  it('reads the chores from the server on load', async () => {
    await renderApp()
    expect(await screen.findByText('Placeholder Chore')).toBeInTheDocument()
    expect(choresApi.listChores).toHaveBeenCalled()
  })

  it('AC 6: re-reads the chores from the server after an add, rather than patching local state', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    await addChoreThroughTheForm()

    // #159 AC 4 - App passes the household it is SHOWING. That argument is the
    // whole story at this level: without it the write went wherever an unordered
    // read pointed, which with two households need not be the one on screen.
    expect(choresApi.addChore).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
      repeatKind: 'none',
      repeatWeekdays: [],
      repeatMonthday: '',
      householdId: household.id,
    })
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Order matters: a re-read issued BEFORE the write would return the old list
    // and look identical in a call count.
    expect(choresApi.addChore.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('#220: the batch confirm goes through addChores with the household on screen, then re-reads', async () => {
    choresApi.addChores.mockResolvedValue([{ ok: true }])
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /add several at once/i })),
    )
    fireEvent.change(screen.getByLabelText(/title for chore 1/i), {
      target: { value: 'sweep the porch' },
    })
    fireEvent.change(screen.getByLabelText(/expected minutes for chore 1/i), {
      target: { value: '15' },
    })
    fireEvent.change(screen.getByLabelText(/due date for chore 1/i), {
      target: { value: '2026-08-10' },
    })

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /add these chores/i })),
    )

    // #159 AC 4's rule, applied to the new write: the household THIS SCREEN is
    // showing travels with the rows, in the second argument the data layer
    // spreads last so no row can override it.
    expect(choresApi.addChores).toHaveBeenCalledWith(
      [{ title: 'sweep the porch', expectedMinutes: '15', dueOn: '2026-08-10' }],
      { householdId: household.id },
    )
    // One mutate() around the whole pass: a single re-read, issued after it.
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(choresApi.addChores.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('AC 6: re-reads after an edit', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /edit placeholder chore/i })))
    fireEvent.change(screen.getByLabelText(/name for placeholder chore/i), {
      target: { value: 'Dishes and counters' },
    })

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

    expect(choresApi.updateChore).toHaveBeenCalled()
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 6: re-reads after a delete', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /remove placeholder chore/i })))

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /remove placeholder chore\?/i })))

    expect(choresApi.removeChore).toHaveBeenCalledWith('c1')
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 6: the write goes through lib/chores.js, never the Supabase client directly', async () => {
    // The supabase.js mock at the top of this file throws if App reaches it, so
    // a component calling the client directly fails here rather than silently
    // working. This asserts the positive half: the data layer WAS used.
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')
    await addChoreThroughTheForm()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
  })

  it('does not go to the server at all when the form value is one the database would refuse', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))

    expect(choresApi.addChore).not.toHaveBeenCalled()
    // Assert OUR sentence, not merely the absence of a call. Measured
    // 2026-08-08: with noValidate removed this test stayed green, because the
    // browser's own constraint validation also blocks the submit — so the
    // absence was produced by a neighbour and the test did not discriminate.
    expect(screen.getByRole('alert')).toHaveTextContent(/at least a minute/i)
  })
})

// ---------------------------------------------------------------------------
// #46 — setting this week's capacity by hand.
//
// The write path and the re-read, from App's side. What the CONTROL looks like
// is Roster.test.jsx's; what the data layer sends is capacity.io.test.js's.
// ---------------------------------------------------------------------------

// #47 criterion 11 — the three surfaces, and moving between them.
//
// At the level only App can answer. The component tests cover what each surface
// DRAWS; these cover the three things that are App's alone:
//
//   which surface opens, the re-read on arrival, and that a round trip costs
//   neither a page load nor a re-authentication.
//
// The route ENUMERATION — that every view the state machine can hold is offered
// by the tab strip — is in gate.test.js, which can see the file this one has
// mocked away.
describe('moving between surfaces — #47 criterion 11', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
    ])
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  /**
   * jsdom's own `location.assign` is unimplemented, so calling it emits a
   * jsdomError rather than doing anything — which means "was the browser
   * navigated?" cannot be asked of the real one. Replaced for this describe,
   * and restored after, exactly as the calendar describe does.
   */
  let realLocation
  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search: '', assign: vi.fn() },
    })
  })
  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
  })

  it('opens on the split — the charter decision of 2026-08-06', async () => {
    // "The load surface opens by default, with the roster reachable from it."
    // The thing judged at arm's length has to be the thing on screen.
    await renderApp()
    expect(screen.getByRole('region', { name: /the split/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /who is in the household/i })).not.toBeInTheDocument()
  })

  it('reaches the roster from the split, and the split from the roster', async () => {
    await renderApp()
    await tab('Who')
    expect(screen.getByRole('region', { name: /who is in the household/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /the split/i })).not.toBeInTheDocument()

    await tab('Split')
    expect(screen.getByRole('region', { name: /the split/i })).toBeInTheDocument()
  })

  it('re-reads the household from the server on arrival, rather than showing what it cached', async () => {
    // The criterion, in the form that would actually bite: another phone edits
    // the roster while this one is looking at the split. Arriving on the roster
    // must show the edit, and it only can if arrival performs a read.
    api.listMembers.mockResolvedValueOnce([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
    ])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
    ])

    await renderApp()
    await tab('Who')

    expect(screen.getByText('Placeholder Two')).toBeInTheDocument()
  })

  it('POSITIVE CONTROL: the second person is genuinely absent from the first read', async () => {
    // Without this the assertion above passes against an app that never
    // re-reads, provided the fixture happened to contain both people all along
    // — which is what an unarmed mock would do.
    api.listMembers.mockResolvedValueOnce([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
    ])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
    ])

    await renderApp()
    expect(screen.queryByText('Placeholder Two')).not.toBeInTheDocument()
  })

  it('reads every surface’s data on arrival, not only the roster', async () => {
    // The split divides capacity and the chore screen lists chores, so a read
    // that fetched members alone would leave two of the three surfaces stale.
    // `refresh()` is one call for all of it, and this pins that arrival uses it
    // rather than something narrower.
    await renderApp()
    const before = {
      members: api.listMembers.mock.calls.length,
      chores: choresApi.listChores.mock.calls.length,
      capacity: capacityApi.listCapacity.mock.calls.length,
    }

    await tab('Chores')

    expect(api.listMembers.mock.calls.length).toBeGreaterThan(before.members)
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before.chores)
    expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(before.capacity)
  })

  it('costs no page load and no re-authentication', async () => {
    // "without a full page reload and without re-entering a join code". There
    // is no join code any more — #62 replaced it with per-person sign-in — so
    // the surviving claim is that a round trip never returns anybody to the
    // onboarding screen, and never navigates the browser.
    await renderApp()
    await tab('Who')
    await tab('Chores')
    await tab('Split')

    expect(globalThis.location.assign).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(api.signIn).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: /the split/i })).toBeInTheDocument()
  })

  it('marks the surface you are on, so the tabs are not three identical buttons', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Who' })).not.toHaveAttribute('aria-current')

    await tab('Who')
    expect(screen.getByRole('button', { name: 'Who' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Split' })).not.toHaveAttribute('aria-current')
  })

  it('offers no surfaces at all until there is a household to look at', async () => {
    // A tab strip above the sign-in screen is three buttons that lead nowhere.
    api.currentHousehold.mockResolvedValue(null)
    await renderApp()
    expect(screen.queryByRole('button', { name: 'Split' })).not.toBeInTheDocument()
  })
})

describe('capacity — this week, set by hand (#46)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
    ])
  })

  /**
   * An override for WHATEVER week the app asks about.
   *
   * Deliberately not a hard-coded date. The period is computed from today and
   * the household's zone, so a literal is right for a few days and then silently
   * stops matching — the row comes back, `capacitiesFor` filters it out, and the
   * test fails for a reason that has nothing to do with the code. Measured:
   * the first version of this file pinned 2026-08-10 while the app computed
   * 2026-08-03, and the mismatch is what exposed the roster matching on
   * member_id alone.
   */
  const overrideThisWeek = (minutes) =>
    capacityApi.listCapacity.mockImplementation((period) =>
      Promise.resolve([
        { id: 'c1', member_id: 'm1', period_start: period, minutes, source: 'manual' },
      ]),
    )

  const openTheWeekEditor = async () => {
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set this week for placeholder one/i })),
    )
  }

  const saveMinutes = async (value) => {
    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))
  }

  it('reads this week’s overrides from the server on load', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(capacityApi.listCapacity).toHaveBeenCalled()
    // The period is a MONDAY, derived from the household's own zone. A period
    // key computed from the phone's zone would file two members of one household
    // under different weeks.
    const period = capacityApi.listCapacity.mock.calls[0][0]
    expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${period}T00:00:00Z`).getUTCDay(), 'the period must start on a Monday').toBe(1)
  })

  it('AC 4: re-reads from the SERVER after the write, rather than patching local state', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await saveMinutes('120')

    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', minutes: '120' }),
    )
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Order matters: a re-read issued BEFORE the write returns the old list and
    // is indistinguishable from a correct one in a call count alone.
    expect(capacityApi.setCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      capacityApi.listCapacity.mock.invocationCallOrder[readsBefore],
    )
  })

  it('AC 4: the write names the same period the screen was showing', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    const readPeriod = capacityApi.listCapacity.mock.calls[0][0]

    await openTheWeekEditor()
    await saveMinutes('120')

    // If these could differ, capacity would be filed into a week the household
    // is not looking at — every number stays plausible and the split responds to
    // the wrong week, which is the failure #44 AC 7 already calls invisible.
    expect(capacityApi.setCapacity.mock.calls[0][0].periodStart).toBe(readPeriod)
  })

  it('clearing an override goes through the data layer and re-reads too', async () => {
    overrideThisWeek(120)
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await act(async () =>
      void fireEvent.click(
        screen.getByRole('button', { name: /use the usual weekly minutes for placeholder one/i }),
      ),
    )

    expect(capacityApi.clearCapacity).toHaveBeenCalledWith('m1', expect.any(String))
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 6: the write goes through lib/capacity.js, never the Supabase client directly', async () => {
    // getSupabase throws in this file's mock, so reaching for it is a failure
    // rather than a silent bypass. The flow completing is the assertion.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await openTheWeekEditor()
    await saveMinutes('120')
    expect(capacityApi.setCapacity).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 6: the manual path depends on nothing but the data layer', () => {
    // The charter's fallback principle, as a check rather than a promise: manual
    // entry must work on day one and the extraction bet (#57) is an accelerator
    // on top of it, never the only road in. If capacity.js ever grows a model
    // client, an HTTP call or a second credential, the floor has quietly become
    // the ceiling — and by then the story that would notice is the one that
    // added it.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    // './household.js' left this list with #159: capacity.js no longer
    // resolves a household for itself, the caller names it. Still asserted
    // EXACTLY rather than loosened to `toContain`, because the property is
    // that nothing NEW may appear here.
    expect(imports.sort()).toEqual(['./supabase.js'])

    // Named separately from the import list, because these arrive without an
    // import statement and the list above would not see them.
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(/)
    expect(source).not.toMatch(/openai|anthropic|api[_-]?key|Bearer /i)
  })


  // -------------------------------------------------------------------------
  // The integration this story actually delivers, and it was protected by a
  // regex alone until this test existed.
  //
  // *Measured while mutating*: changing App to `capacitiesFor(members, [], …)` —
  // the exact line #36 shipped and #46 replaced — reddened ONE assertion, and it
  // was the static grep in gate.test.js. Nothing behavioural noticed that the
  // load figures had stopped following this week, because every number on screen
  // stayed plausible. That is the failure mode #44 already calls invisible, and
  // a grep is a poor last line against it: it fails the moment the code is
  // written a different way rather than a wrong way.
  // -------------------------------------------------------------------------

  it('the split surface’s figures follow THIS WEEK, not the baseline', async () => {
    // The subject of this test moved from the chore screen to the split surface
    // in #47. The CLAIM is unchanged and is the one #46 exists for: what gets
    // divided is this week's capacity, not the stored baseline.
    overrideThisWeek(120)
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    // Baseline 300, this week 120, nothing assigned. "180 min left" would mean
    // the override reached the roster and not the allocator's input — which is
    // precisely the half-wired state this story exists to end.
    const row = screen.getByTestId('split-m1')
    expect(row).toHaveTextContent('0 of 120 min')
    expect(row).toHaveTextContent('120 min left')
    expect(row, 'the baseline must not be what the split divides').not.toHaveTextContent(
      '300 min left',
    )
  })

  it('POSITIVE CONTROL: with no override the same screen shows the baseline', async () => {
    // Without this, the assertion above passes identically if the figures were
    // broken in some other way that happened to yield 120 — and it pins that
    // the difference is the OVERRIDE rather than anything else on screen.
    capacityApi.listCapacity.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getByTestId('split-m1')).toHaveTextContent('300 min left')
  })

  it('AC 6: POSITIVE CONTROL — the import scan sees the imports that are there', () => {
    // Without this the assertion above passes identically if the regex stops
    // matching, which is how an empty result reads as a clean bill of health.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    // Was `toBeGreaterThan(1)`: capacity.js had two imports and #159 removed
    // one of them. The control's job is to prove the regex MATCHES, so the
    // threshold is the one that still means that.
    expect([...source.matchAll(/from\s+'([^']+)'/g)].length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // #49 — the assignments follow a capacity change on their own. What App owes
  // is WHEN the re-assignment runs and for WHICH household; what it does is
  // reassign.io.test.js's subject, and what the database enforces is
  // reassignment.pglite.test.js's.
  // -------------------------------------------------------------------------

  it('#49 AC 2: setting this week’s capacity re-assigns, nobody pressing an assign button', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await saveMinutes('120')

    // The household on screen, AFTER the write that changed it, BEFORE the
    // refresh — so the re-read that follows shows the stored result rather
    // than racing it.
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
    expect(capacityApi.setCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      reassignApi.reassignHousehold.mock.invocationCallOrder[0],
    )
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(reassignApi.reassignHousehold.mock.invocationCallOrder[0]).toBeLessThan(
      capacityApi.listCapacity.mock.invocationCallOrder[readsBefore],
    )
  })

  it('#49: clearing an override re-assigns too — a week back to normal is a capacity change', async () => {
    overrideThisWeek(120)
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await openTheWeekEditor()
    await act(async () =>
      void fireEvent.click(
        screen.getByRole('button', { name: /use the usual weekly minutes for placeholder one/i }),
      ),
    )

    expect(capacityApi.clearCapacity).toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
  })

  it('#49: a baseline edit that MOVES the minutes re-assigns; a name-only save does not', async () => {
    // Owner decision at pickup: a weekly_minutes edit is a capacity change.
    // The roster's save always sends the minutes field, so the discriminator
    // is whether the value moved — a name fix must not overwrite
    // `last_rebalance` with a run nothing prompted.
    api.updateMember.mockResolvedValue({})
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^edit$/i })))
    fireEvent.change(screen.getByLabelText(/name for placeholder one/i), {
      target: { value: 'placeholder renamed' },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))
    expect(api.updateMember).toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^edit$/i })))
    fireEvent.change(screen.getByLabelText(/weekly minutes for/i), {
      target: { value: '150' },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
  })

  it('#49 AC 7: the stored verdict reaches the split surface from the household row', async () => {
    api.currentHousehold.mockResolvedValue({
      ...household,
      last_rebalance: {
        contested: true,
        level: true,
        reason: null,
        boundByBudget: true,
        jobsMoved: 2,
        minutesMoved: 90,
        changeBudgetMinutes: 120,
        applied_at: '2026-08-27T12:00:00Z',
      },
    })
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    // Rendered from the STORED verdict — no allocator call could produce this
    // sentence here, because nothing on this screen knows what the last run's
    // budget did.
    expect(screen.getByTestId('rebalance-note')).toHaveTextContent(/moved 90 min/)
    expect(screen.getByTestId('rebalance-note')).toHaveTextContent(/change/)
  })
})

// #50 — the re-balance announced as an event, at the level only App can answer:
// WHEN the statement appears, when it must not, and what advances the marker
// that makes it an event seen once. The wording itself is Announcement.test.jsx's
// subject; the arithmetic is announce.test.js's. `splitSnapshot` and
// `announcementFrom` are REAL here (the mock spreads the actual module), so
// these tests exercise the same pipeline a phone would.
describe('#50 — a re-balance is announced as an event', () => {
  const APPLIED_AT = '2026-08-27T18:00:00+00:00'

  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
    last_rebalance: {
      contested: true,
      level: true,
      reason: null,
      boundByBudget: false,
      jobsMoved: 1,
      minutesMoved: 90,
      changeBudgetMinutes: 120,
      applied_at: APPLIED_AT,
    },
  }

  const members = [
    { id: 'm1', household_id: 'h1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', household_id: 'h1', display_name: 'Placeholder Two', weekly_minutes: 300, claimed_by: null },
  ]

  // The state NOW: both chores on Placeholder Two. What this member was last
  // shown (the seen fixture below): c1 on Placeholder One, whose week was then
  // 420 min — so the re-balance reads as 120 min less room and 90 min moved.
  const chores = [
    { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
    { id: 'c2', title: 'Placeholder Other Chore', expected_minutes: 50, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
  ]

  const seenEarlier = {
    member_id: 'm1',
    snapshot: {
      members: [
        { id: 'm1', minutes: 90, capacityMinutes: 420 },
        { id: 'm2', minutes: 50, capacityMinutes: 300 },
      ],
    },
    seen_rebalance_at: '2026-08-27T09:00:00+00:00',
  }

  /** The snapshot refresh() computes for these fixtures, built the same way. */
  const currentSnapshot = () =>
    actualAnnounce.splitSnapshot({
      capacities: actualCapacity.capacitiesFor(
        members,
        [],
        actualCapacity.periodStartFor(new Date(), household.timezone),
      ),
      chores,
    })

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue(members)
    choresApi.listChores.mockResolvedValue(chores)
  })

  it('AC 1: opening the app on a re-balance this member has not seen shows the statement', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenEarlier)
    await renderApp()

    const region = await screen.findByTestId('rebalance-announcement')
    expect(region).toHaveTextContent('Placeholder One’s week has 120 min less room')
    expect(region).toHaveTextContent('90 min of chores moved off Placeholder One’s list')
    expect(region).toHaveTextContent('Placeholder Two picked up 90 min')
  })

  it('advances the seen-marker to this re-balance when the statement is shown', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenEarlier)
    await renderApp()
    await screen.findByTestId('rebalance-announcement')

    expect(announceApi.writeSplitSeen).toHaveBeenCalledWith({
      memberId: 'm1',
      snapshot: currentSnapshot(),
      seenRebalanceAt: APPLIED_AT,
    })
  })

  it('AC 7: opened again with no further change, the statement is not shown a second time', async () => {
    // The row the write above left behind: marker at the re-balance, snapshot
    // at what the member was shown. The same open now announces nothing — and
    // writes nothing, because there is nothing new to record.
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: currentSnapshot(),
      seen_rebalance_at: APPLIED_AT,
    })
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
    expect(announceApi.writeSplitSeen).not.toHaveBeenCalled()
  })

  it('dismissing hides the statement, and a later refresh does not resurrect it', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenEarlier)
    await renderApp()
    await screen.findByTestId('rebalance-announcement')

    // The marker has advanced on the server by now; later reads see it.
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: currentSnapshot(),
      seen_rebalance_at: APPLIED_AT,
    })

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /got it/i })))
    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()

    // A tab switch re-reads everything (#47 criterion 11); the event must not
    // come back with it.
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
  })

  it('a first look announces nothing and records the baseline the next statement diffs against', async () => {
    announceApi.readSplitSeen.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
    expect(announceApi.writeSplitSeen).toHaveBeenCalledWith({
      memberId: 'm1',
      snapshot: currentSnapshot(),
      seenRebalanceAt: APPLIED_AT,
    })
  })
})

// #59 — the fairness note's dismissal, at the level only App can answer: WHOSE
// dismissal the write records, and that the standing/dismissed state comes from
// the SERVER's seen-marker row rather than from a local flag. The wording and
// the on-demand toggle are Split.test.jsx's subject.
describe('#59 — the fairness note is dismissed per member, on the server', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  const members = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null },
  ]

  const seenRow = (dismissed) => ({
    member_id: 'm1',
    snapshot: { members: [] },
    seen_rebalance_at: null,
    fairness_note_dismissed: dismissed,
  })

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue(members)
  })

  it('stands when this member has never dismissed it', async () => {
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getByTestId('fairness-note')).toHaveTextContent(/does not count/i)
  })

  it('does not stand when the server says this member dismissed it', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenRow(true))
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.queryByTestId('fairness-note')).toBeNull()
    expect(screen.getByRole('button', { name: /what the split counts/i })).toBeInTheDocument()
  })

  it('dismissing records THIS member and re-reads, after which the note stops standing', async () => {
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    // The server accepts the dismissal; the re-read that follows reports it.
    // Armed by changing the mock, not `mockResolvedValueOnce` — the read count
    // is refresh()'s business, not this test's (#37's lesson).
    announceApi.readSplitSeen.mockResolvedValue(seenRow(true))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /noted/i })))

    // The ARGUMENT, not just the call: the layer that chooses whose dismissal
    // this is is exactly the layer nothing else asserts about.
    expect(announceApi.dismissFairnessNote).toHaveBeenCalledWith('m1')
    expect(screen.queryByTestId('fairness-note')).toBeNull()
    expect(screen.getByRole('button', { name: /what the split counts/i })).toBeInTheDocument()
  })
})

// #37 — who cannot do a chore, at the level only App can answer.
//
// The component tests cover what the screen DRAWS; these cover the two things
// that are App's alone and that a component test cannot see, because the
// component only calls the handler it is given:
//
//   AC 9 — the exclusions come from the SERVER on every refresh, and a write is
//          followed by a re-read rather than by patching what is already here.
//   AC 3 — the write path exists at all, and reaches a person through the chore
//          screen. The route ENUMERATION is in gate.test.js, which can see the
//          files this one has mocked away.
describe('exclusions — the write path and the re-read (#37)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  const members = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null },
  ]

  const chore = {
    id: 'c1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
    completed_at: null,
    completed_by_member_id: null,
    assigned_member_id: null,
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue(members)
    choresApi.listChores.mockResolvedValue([chore])
  })

  const onScreen = () => screen.findByRole('region', { name: /what needs doing/i })

  const markUnable = async (memberId) => {
    fireEvent.change(screen.getByLabelText(/mark someone as unable to do placeholder chore/i), {
      target: { value: memberId },
    })
    await act(async () => {})
  }

  it('AC 9: reads the exclusions from the server on load', async () => {
    await renderApp('Chores')
    await onScreen()
    expect(exclusionsApi.listExclusions).toHaveBeenCalled()
  })

  it('AC 9: re-reads from the SERVER after a write, rather than patching local state', async () => {
    await renderApp('Chores')
    await onScreen()

    const readsBefore = exclusionsApi.listExclusions.mock.calls.length
    await markUnable('m2')

    // #159 AC 4 - the third argument is the household on screen.
    expect(exclusionsApi.excludeMember).toHaveBeenCalledWith('c1', 'm2', household.id)
    await waitFor(() =>
      expect(exclusionsApi.listExclusions.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 9: what another device recorded is on this screen after the re-read', async () => {
    // The whole point of re-reading rather than patching: the row this device
    // did not write arrives anyway, because the state is the server's. Asserted
    // through the RENDERED sentence, not through the mock, since a call count
    // says nothing about whether the answer reached the screen.
    // Armed by CHANGING the mock between the two assertions rather than by
    // `mockResolvedValueOnce`. The "once" form counted reads implicitly, and
    // #47 added one — arriving on a surface re-reads — so it landed on the
    // wrong read and the row was on screen before the write. This form says
    // what it means: nothing, then another device records something, then the
    // next read this device performs must show it.
    exclusionsApi.listExclusions.mockResolvedValue([])

    await renderApp('Chores')
    await onScreen()
    expect(screen.queryByText(/placeholder one cannot do this/i)).not.toBeInTheDocument()

    exclusionsApi.listExclusions.mockResolvedValue([
      { id: 'x1', chore_id: 'c1', member_id: 'm1' },
    ])
    await markUnable('m2')
    await waitFor(() =>
      expect(screen.getByText(/placeholder one cannot do this/i)).toBeInTheDocument(),
    )
  })

  it('undoing one goes through the data layer and re-reads too', async () => {
    exclusionsApi.listExclusions.mockResolvedValue([
      { id: 'x1', chore_id: 'c1', member_id: 'm2' },
    ])
    await renderApp('Chores')
    await onScreen()

    const readsBefore = exclusionsApi.listExclusions.mock.calls.length
    await act(async () =>
      void fireEvent.click(
        screen.getByRole('button', {
          name: /let placeholder two do placeholder chore again/i,
        }),
      ),
    )

    expect(exclusionsApi.allowMember).toHaveBeenCalledWith('c1', 'm2')
    await waitFor(() =>
      expect(exclusionsApi.listExclusions.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('the write goes through lib/exclusions.js, never the Supabase client directly', async () => {
    // getSupabase() throws in this file's mock, so a component reaching past the
    // data layer fails loudly here rather than shipping.
    await renderApp('Chores')
    await onScreen()
    await markUnable('m2')
    expect(screen.queryByText(/must not reach the client directly/i)).not.toBeInTheDocument()
  })

  it('a failed write reports itself and leaves the screen usable', async () => {
    exclusionsApi.excludeMember.mockRejectedValue(
      new Error('That person is already marked as unable to do this chore.'),
    )
    await renderApp('Chores')
    await onScreen()
    await markUnable('m2')

    // Scoped to the chore card. App hands the same `error` to the roster too, so
    // an unscoped query finds two nodes and fails on the count rather than on
    // the claim — and the claim is that the message lands BESIDE the control
    // that caused it, which is the repair #34 made for exactly this.
    const card = await onScreen()
    expect(await within(card).findByText(/already marked as unable/i)).toBeInTheDocument()
    // And the control is not left disabled — `mutate` clears busy in a finally,
    // so a refusal must not end with a screen nobody can use.
    expect(
      screen.getByLabelText(/mark someone as unable to do placeholder chore/i),
    ).not.toBeDisabled()
  })

  it('reads nothing when there is no household, rather than asking for another one’s rows', async () => {
    api.currentHousehold.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('region', { name: /start a household/i })
    expect(exclusionsApi.listExclusions).not.toHaveBeenCalled()
  })
})

// #95 — the calendar connection, at the level only App can answer.
//
// The component tests cover what the roster DRAWS. These cover the three things
// that belong to App and that a component test structurally cannot see:
//
//   AC 5 — the connections come from the SERVER on load, through the same
//          refresh as everything else.
//   AC 6 — Google fails, and the member is told, on an app that still works.
//   AC 3 — pressing Connect actually leaves for a Google consent URL asking for
//          the free/busy scope. `startConnect` is left REAL in this file's mock
//          precisely so this is the URL the app would really send somebody to,
//          rather than one a stub agreed to.
describe('connecting a calendar (#95)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }

  let assign
  let replaceState
  let realLocation
  let realHistory

  /**
   * Replace `location` and `history` for one test.
   *
   * jsdom's own `location.assign` is unimplemented and its `href` is not
   * writable, so a real navigation would emit a jsdomError rather than doing
   * anything — and the query string has to be on the URL BEFORE App boots, which
   * cannot be arranged with the real one either.
   */
  const atUrl = (search = '') => {
    assign = vi.fn()
    replaceState = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search, assign },
    })
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      writable: true,
      value: { replaceState },
    })
  }

  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    realHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([me])
    globalThis.sessionStorage?.clear?.()
    atUrl('')
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
    if (realHistory) Object.defineProperty(globalThis, 'history', realHistory)
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('AC 5: reads the connections from the server on load and draws them', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([
      { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' },
    ])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.listCalendarConnections).toHaveBeenCalled()
    expect(inRoster().getByText(/calendar connected/i)).toBeInTheDocument()
  })

  it('AC 3: pressing Connect leaves for Google, asking for free/busy alone', async () => {
    // End to end through the REAL `startConnect`, so this is the URL a member
    // would actually be sent to. A stub here would assert that the app calls a
    // function, which is a fact about this test file.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(async () =>
      void fireEvent.click(inRoster().getByRole('button', { name: /connect google calendar/i })),
    )

    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.freebusy')
    // Built from where the app is running, so a preview and the custom domain
    // each ask for themselves rather than for a hard-coded host.
    expect(url.searchParams.get('redirect_uri')).toBe('https://taskr.example.test/')
  })

  it('completes the exchange when Google sends the member back, then cleans the URL', async () => {
    calendarApi.completeConnect.mockResolvedValue({ ok: true })
    atUrl('?code=the-code&state=the-state')
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(calendarApi.completeConnect).toHaveBeenCalledWith({
      code: 'the-code',
      error: null,
      state: 'the-state',
    })
    // A spent code must not survive a reload: exchanging it twice is refused by
    // Google, and that refusal reads as the connection having failed.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('reads the roster AFTER the exchange, or the screen shows the state it just changed', async () => {
    // The ordering, asserted rather than implied. `refresh()` is what puts
    // "Calendar connected" on screen, so completing afterwards would leave a
    // member who has just connected looking at a Connect button.
    const order = []
    calendarApi.completeConnect.mockImplementation(async () => {
      order.push('exchange')
      return { ok: true }
    })
    calendarApi.listCalendarConnections.mockImplementation(async () => {
      order.push('read')
      return []
    })
    atUrl('?code=the-code&state=the-state')
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(order.indexOf('exchange')).toBeLessThan(order.indexOf('read'))
  })

  it('AC 6: says so when the exchange fails, on an app that still works', async () => {
    // The failure state AC 6 asks for. "No token row exists" is the Edge
    // Function's half and is proven in handler.test.js — nothing this side can
    // observe a table it is granted nothing on.
    calendarApi.completeConnect.mockRejectedValue(
      new Error('Google refused the connection: invalid_grant'),
    )
    atUrl('?code=spent&state=the-state')
    await renderApp()

    // Still loaded: a failed connection is not a failed app, and rendering the
    // boot-failure card here would hide a working household behind one refused
    // OAuth code.
    //
    // Asserted on the surface the person LANDS on, which since #47 is the split
    // rather than the roster. Deliberately not navigated: arriving on another
    // surface performs a successful re-read, and `mutate` clears the error strip
    // when it does — correct behaviour, and it would take the evidence with it.
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(
      /invalid_grant/,
    )
    expect(replaceState).toHaveBeenCalled()
  })

  it('AC 6: treats a refusal at Google as a failure state, without calling the function', async () => {
    // Pressing Cancel comes back as an error parameter with no code at all.
    // There is nothing to exchange, so the function must not be called — and the
    // member must still be told something, or a cancel is indistinguishable from
    // a button that did nothing.
    atUrl('?error=access_denied&state=the-state')
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(calendarApi.completeConnect).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(
      /was not connected/i,
    )
  })

  it('POSITIVE CONTROL: an ordinary load exchanges nothing and shows no complaint', async () => {
    // Without this, every assertion above is satisfied by an App that calls
    // `completeConnect` never — and by one that reports an error on every load.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.completeConnect).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('#53 — the boot-time catch-up pass', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([])
  })

  it('runs BEFORE the first read, so a created occurrence is in the first list a person sees', async () => {
    await renderApp('Chores')
    await screen.findByRole('region', { name: /what needs doing/i })

    expect(choresApi.catchUpRepeats).toHaveBeenCalledTimes(1)
    // Order is the claim, not the call: catch-up after the read would show a
    // week with holes in it until the next mutation happened to refresh.
    expect(choresApi.catchUpRepeats.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[0],
    )
  })

  it('tells the household when occurrences older than the bound were skipped — AC 4', async () => {
    choresApi.catchUpRepeats.mockResolvedValue({ created: 2, skipped: 3 })
    await renderApp()

    // The REAL formatSkippedNotice words this (the mock keeps pure functions
    // real), so the sentence asserted is the sentence a person reads.
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(
      '3 repeat occurrences more than 7 days old were skipped rather than piled onto this week.',
    )
    // Told, not alarmed: nothing failed, so the error surface stays empty.
    expect(screen.queryAllByRole('alert')).toEqual([])
  })

  it('says nothing when nothing was skipped', async () => {
    await renderApp('Chores')
    await screen.findByRole('region', { name: /what needs doing/i })
    expect(screen.queryByText(/skipped rather than piled/i)).not.toBeInTheDocument()
  })

  it('a failing pass costs the error strip, never the household', async () => {
    // The live shape of this failure: 0012 not yet pasted, so the RPC is
    // unknown to the project. Boot must degrade to a working app with the
    // failure REPORTED — a red nobody can see is how a paste stays forgotten,
    // and a boot-failure card would hide a working household behind it.
    choresApi.catchUpRepeats.mockRejectedValue(
      new Error('catching up repeats: function public.catch_up_repeats does not exist'),
    )
    await renderApp()

    // The split surface, for the reason the calendar failure above records: a
    // person lands here, and navigating elsewhere would re-read successfully
    // and clear the strip this test is about.
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(
      /catching up repeats/i,
    )
  })
})

// ---------------------------------------------------------------------------
// #12 — the actual-minutes write and its re-read. At the App level for the
// standing reason: the wiring from the done row's control to the data layer,
// and the mutate() re-read after it, are both invisible to Chores.test.jsx —
// its handlers are spies, so handing the control the WRONG handler (say,
// onComplete) would leave every component test green.
// ---------------------------------------------------------------------------

describe('#12 — adjusting how long a chore took', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const doneChore = {
    id: 'c1',
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
    completed_at: '2026-08-10T15:00:00Z',
    completed_by_member_id: 'm1',
    actual_minutes: 20,
  }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([doneChore])
  })

  it('saves the adjusted value through the data layer, then re-reads from the server', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    fireEvent.change(screen.getByLabelText('Minutes Placeholder Chore actually took'), {
      target: { value: '35' },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

    // The argument, not merely the call: a handler wired to the wrong id or a
    // string value would round-trip green through a bare toHaveBeenCalled.
    expect(choresApi.recordActualMinutes).toHaveBeenCalledWith('c1', 35)
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(choresApi.recordActualMinutes.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })
})
