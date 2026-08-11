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
  updateChore: vi.fn(),
  removeChore: vi.fn(),
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

vi.mock('./lib/household.js', async () => {
  // findClaimedMember is pure and has its own tests, so the real one is used
  // rather than a stub that could disagree with it.
  const actual = await vi.importActual('./lib/household.js')
  return { ...actual, ...api }
})

const { default: App } = await import('./App.jsx')

/**
 * Render and let the boot effect settle inside act().
 *
 * App asks the server whether this device has joined before it can decide what
 * to show, so every render resolves at least one promise. Asserting before that
 * lands would be testing the loading state by accident.
 */
const renderApp = () => act(async () => void render(<App />))

beforeEach(() => {
  backend.hasSupabaseConfig = true
  Object.values(api).forEach((fn) => fn.mockReset())
  Object.values(choresApi).forEach((fn) => fn.mockReset())
  Object.values(capacityApi).forEach((fn) => fn.mockReset())
  capacityApi.listCapacity.mockResolvedValue([])
  capacityApi.setCapacity.mockResolvedValue(undefined)
  capacityApi.clearCapacity.mockResolvedValue(undefined)
  choresApi.listChores.mockResolvedValue([])
  choresApi.addChore.mockResolvedValue(undefined)
  choresApi.updateChore.mockResolvedValue(undefined)
  choresApi.removeChore.mockResolvedValue(undefined)
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
    await renderApp()
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(inRoster().getByText('Placeholder One')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
  })

  // AC 3: the roster is read from the server on load. If it were cached
  // locally, a passing "survives a restart" check would be indistinguishable
  // from a device that merely remembered.
  it('reads the household from the server on every load, not from storage', async () => {
    await renderApp()
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(api.currentHousehold).toHaveBeenCalled()
    expect(api.listMembers).toHaveBeenCalled()
    expect(window.localStorage.getItem('taskr.household')).toBeNull()
    expect(window.localStorage.getItem('taskr.members')).toBeNull()
  })

  it('marks the person signed in on this phone, from the live auth id', async () => {
    await renderApp()
    expect(await screen.findByText(/· you/)).toBeInTheDocument()
  })

  it('re-reads from the server after a change, rather than patching what it has', async () => {
    await renderApp()
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
    await renderApp()
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    await addChoreThroughTheForm()

    expect(choresApi.addChore).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
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

  it('AC 6: re-reads after an edit', async () => {
    await renderApp()
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
    await renderApp()
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
    await renderApp()
    await screen.findByText('Placeholder Chore')
    await addChoreThroughTheForm()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
  })

  it('does not go to the server at all when the form value is one the database would refuse', async () => {
    await renderApp()
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
    await renderApp()
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
    await renderApp()
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
    await renderApp()
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
    await renderApp()
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
    await renderApp()
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
    expect(imports.sort()).toEqual(['./household.js', './supabase.js'])

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

  it('the chore screen’s load figures follow THIS WEEK, not the baseline', async () => {
    overrideThisWeek(120)
    await renderApp()
    await screen.findByRole('region', { name: /who is carrying what/i })

    // Baseline 300, this week 120, nothing assigned. "180 min left" would mean
    // the override reached the roster and not the allocator's input — which is
    // precisely the half-wired state this story exists to end.
    const row = screen.getByTestId('load-m1')
    expect(row).toHaveTextContent('0 min committed')
    expect(row).toHaveTextContent('120 min left')
    expect(row, 'the baseline must not be what the load surface divides').not.toHaveTextContent(
      '300 min left',
    )
  })

  it('POSITIVE CONTROL: with no override the same screen shows the baseline', async () => {
    // Without this, the assertion above passes identically if the load figures
    // were broken in some other way that happened to yield 120 — and it pins
    // that the difference is the OVERRIDE rather than anything else on screen.
    capacityApi.listCapacity.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /who is carrying what/i })
    expect(screen.getByTestId('load-m1')).toHaveTextContent('300 min left')
  })

  it('AC 6: POSITIVE CONTROL — the import scan sees the imports that are there', () => {
    // Without this the assertion above passes identically if the regex stops
    // matching, which is how an empty result reads as a clean bill of health.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    expect([...source.matchAll(/from\s+'([^']+)'/g)].length).toBeGreaterThan(1)
  })
})
