import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The shell's own assertions (heading, fairness rule, build stamp) survive from
// #4 unchanged — they are what makes a deploy observable. What changed in #5 is
// everything between: the page is now a function of whether this device has
// joined a household, answered by the server on every load.
//
// Names are synthetic — see #19.

const backend = { hasSupabaseConfig: true }

const api = {
  ensureSession: vi.fn(),
  currentHousehold: vi.fn(),
  listMembers: vi.fn(),
  currentDeviceId: vi.fn(),
  createHousehold: vi.fn(),
  joinHousehold: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
  claimMember: vi.fn(),
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
  choresApi.listChores.mockResolvedValue([])
  choresApi.addChore.mockResolvedValue(undefined)
  choresApi.updateChore.mockResolvedValue(undefined)
  choresApi.removeChore.mockResolvedValue(undefined)
  api.ensureSession.mockResolvedValue({ user: { id: 'device-a' } })
  api.currentHousehold.mockResolvedValue(null)
  api.listMembers.mockResolvedValue([])
  api.currentDeviceId.mockResolvedValue('device-a')
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
    // And it does not attempt a sign-in it cannot possibly complete.
    expect(api.ensureSession).not.toHaveBeenCalled()
  })
})

describe('when this device has joined nothing', () => {
  it('offers both ways in', async () => {
    await renderApp()
    expect(await screen.findByRole('button', { name: /create household/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /join household/i })).toBeInTheDocument()
  })

  it('signs the device in before asking the server anything', async () => {
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })

    expect(api.ensureSession).toHaveBeenCalled()
    expect(api.ensureSession.mock.invocationCallOrder[0]).toBeLessThan(
      api.currentHousehold.mock.invocationCallOrder[0],
    )
  })
})

describe('when this device has joined a household', () => {
  const household = { id: 'h1', name: 'Placeholder Household', join_code: 'ABCD2345' }

  beforeEach(() => {
    api.currentHousehold.mockResolvedValue(household)
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'device-a' },
    ])
  })

  it('shows the roster rather than the join screen', async () => {
    await renderApp()
    expect(await screen.findByText('Placeholder One')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join household/i })).not.toBeInTheDocument()
  })

  // AC 3: the roster is read from the server on load. If it were cached
  // locally, a passing "survives a restart" check would be indistinguishable
  // from a device that merely remembered.
  it('reads the household from the server on every load, not from storage', async () => {
    await renderApp()
    await screen.findByText('Placeholder One')

    expect(api.currentHousehold).toHaveBeenCalled()
    expect(api.listMembers).toHaveBeenCalled()
    expect(window.localStorage.getItem('taskr.household')).toBeNull()
    expect(window.localStorage.getItem('taskr.members')).toBeNull()
  })

  it('marks the person this device is acting as, from the live auth id', async () => {
    await renderApp()
    expect(await screen.findByText(/· you/)).toBeInTheDocument()
  })

  it('re-reads from the server after a change, rather than patching what it has', async () => {
    await renderApp()
    await screen.findByText('Placeholder One')

    const readsBefore = api.listMembers.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /refresh/i })))

    await waitFor(() => expect(api.listMembers.mock.calls.length).toBeGreaterThan(readsBefore))
  })
})

describe('when the backend cannot be reached', () => {
  it('shows the reason rather than an empty household', async () => {
    api.ensureSession.mockRejectedValue(new Error('Anonymous sign-ins are disabled'))
    await renderApp()

    expect(await screen.findByRole('region', { name: /could not reach the household/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/anonymous sign-ins are disabled/i)
    // Critically, not the join screen: offering "create a household" against a
    // backend that is refusing would send the organizer round a loop.
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
  const household = { id: 'h1', name: 'Placeholder Household', join_code: 'ABCD2345' }
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
