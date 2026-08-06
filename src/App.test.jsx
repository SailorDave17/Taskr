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

vi.mock('./lib/supabase.js', () => ({
  get hasSupabaseConfig() {
    return backend.hasSupabaseConfig
  },
  getSupabase: () => {
    throw new Error('App must not reach the client directly; it goes through lib/household.js')
  },
}))

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
