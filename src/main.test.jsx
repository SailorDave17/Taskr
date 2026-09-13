import { expect, it, vi } from 'vitest'

// #347 — `src/main.jsx` starts the updater before the app, and an app that
// fails to load switches the updater to its one-minute recovery check (owner
// decision, 2026-09-13). Measured live on #347: a deploy whose app chunk threw
// left the page blank, and only the updater could move it off.

const { updates, startAppUpdates } = vi.hoisted(() => {
  const updates = { appFailed: vi.fn() }
  return { updates, startAppUpdates: vi.fn(() => updates) }
})
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
vi.mock('./lib/appUpdate.js', () => ({ startAppUpdates }))
vi.mock('./App.jsx', () => {
  throw new Error('probe: the app chunk throws on load')
})

it('an app that fails to load switches the updater to its recovery check, and the error is still reported', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await import('./main.jsx')
    await vi.waitFor(() => expect(updates.appFailed).toHaveBeenCalledTimes(1))
    expect(startAppUpdates).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(expect.any(Error))
  } finally {
    logged.mockRestore()
  }
})
