// App's tests for the shell: its heading and footer, moving between surfaces,
// the live re-read and the install offer. Split out of `App.test.jsx` by #553;
// every describe below moved verbatim with the comment above it. The fakes, the
// `vi.mock` calls and the shared `beforeEach` are in
// `src/test/support/appHarness.jsx`, which must stay the FIRST import.
import { pkg, api, choresApi, capacityApi, shoppingApi, SHOPPING_CLIENT, realtimeApi, App, renderApp, actualRealtime } from './test/support/appHarness.jsx'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { PRIVACY_URL } from './lib/links.js'
import { buildInfo } from './buildInfo.js'
import { startInstallOffer } from './lib/installOffer.js'

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

  it('names the release beside the commit, and the row still ends with the stamp (#540)', async () => {
    await renderApp()
    const version = screen.getByTestId('build-version')
    expect(version.textContent).toBe(`v${pkg.version}`)
    // The whole row as a reader sees it. The links row above is excluded; the
    // separators are aria-hidden spans, so they are read off textContent too.
    const stamp = screen.getByTestId('build-commit')
    const footer = stamp.closest('footer')
    const row = [...footer.children]
      .filter((child) => child.tagName === 'SPAN')
      .map((child) => child.textContent)
      .join('')
    expect(row).toBe(`${buildInfo.name} · ${buildInfo.env} · v${pkg.version} · build ${buildInfo.commit}`)
    // README's "read the page footer" paragraph and #451's comment both depend
    // on the row ENDING in `build <sha>`: the version sits before it.
    expect(footer.lastElementChild).toBe(stamp)
    expect(version.nextElementSibling.nextElementSibling).toBe(stamp)
  })

  it('offers "Report a problem" above the build stamp, as a message naming the build and the screen (#425)', async () => {
    await renderApp()
    const link = screen.getByRole('link', { name: /report a problem/i })
    const url = new URL(link.getAttribute('href'))
    expect(url.protocol).toBe('mailto:')
    const body = url.searchParams.get('body')
    const stamp = screen.getByTestId('build-commit')
    expect(body).toContain(`Build: ${stamp.textContent.replace(/^build\s+/, '')}`)
    // #540 AC 4 — and the release, from the same buildInfo the footer reads.
    expect(body).toContain(`Version: ${buildInfo.version}`)
    // A session and no household: the onboarding screen, and the report says so.
    expect(body).toContain('Screen: Onboarding screen')
    // README tells a reader the footer ENDS with the build stamp, so the links
    // sit above it rather than after it. Since #451 the link shares a row with
    // Privacy, so the footer's first child is that row and the link leads it.
    const footer = stamp.closest('footer')
    expect(footer.firstElementChild).toBe(link.parentElement)
    expect(link.parentElement.firstElementChild).toBe(link)
    expect(footer.lastElementChild).toBe(stamp)
  })

  it('links the published privacy policy beside "Report a problem", in a new tab (#451)', async () => {
    await renderApp()
    const privacy = screen.getByRole('link', { name: /^privacy$/i })
    expect(privacy).toHaveAttribute('href', PRIVACY_URL)
    // A new tab, so a person reading the policy does not lose the screen they
    // were on; `noopener` so the opened page cannot reach back through
    // `window.opener`. AC 1 asks for both.
    expect(privacy).toHaveAttribute('target', '_blank')
    // `noopener` is AC 1's; `noreferrer` is the lint gate's, and it also keeps
    // the policy page from learning which screen the reader came from.
    expect(privacy.getAttribute('rel')).toMatch(/\bnoopener\b/)
    expect(privacy.getAttribute('rel')).toMatch(/\bnoreferrer\b/)
    // "Beside": the same row as Report a problem, and that row above the stamp.
    const report = screen.getByRole('link', { name: /report a problem/i })
    expect(privacy.parentElement).toBe(report.parentElement)
    const stamp = screen.getByTestId('build-commit')
    expect(stamp.closest('footer').firstElementChild).toBe(privacy.parentElement)
  })

  it('shows the privacy link inside a household too (#451)', async () => {
    // AC 1 says "any surface". The default fixture is signed in with no
    // household; this is the joined shell, whose footer is rendered by the
    // same branch but reached by a different one.
    api.listHouseholds.mockResolvedValue([
      { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' },
    ])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])
    await renderApp('Chores')
    expect(screen.getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', PRIVACY_URL)
  })

  it('shows the privacy link to somebody signed OUT, on the sign-in screen (#451)', async () => {
    // The other half of "signed in or out" — the #425 link's own signed-out
    // test at the sign-in screen is the shape this follows.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    // The sign-in form is what is showing — the control that the signed-out
    // fixture took effect, rather than the default screen passing by luck.
    expect(screen.getByLabelText(/password or pin/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', PRIVACY_URL)
  })

  it('names the tab the person is on, inside a household, and nothing about the household (#425)', async () => {
    // The fixture of 'when the signed-in person belongs to a household' below.
    api.listHouseholds.mockResolvedValue([
      { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' },
    ])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])
    await renderApp('Chores')
    const body = () =>
      new URL(screen.getByRole('link', { name: /report a problem/i }).getAttribute('href'))
        .searchParams.get('body')
    expect(body()).toContain('Screen: Chores')
    // The allowlist, proven through the real shell: the household and the
    // person are on the screen and are not in the message.
    expect(body()).not.toContain('Placeholder Household')
    expect(body()).not.toContain('Placeholder One')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Split' })))
    expect(body()).toContain('Screen: Split')
  })

  it('offers the same link to somebody signed out, on the sign-in screen (#425)', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    // The sign-in form is what is showing, not the start-or-join screen.
    expect(screen.getByLabelText(/password or pin/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /report a problem/i })
    expect(new URL(link.getAttribute('href')).searchParams.get('body')).toContain(
      'Screen: Onboarding screen',
    )
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
    api.listHouseholds.mockResolvedValue([household])
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

  it('marks the surface you are on, so the tabs are not five identical buttons', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Who' })).not.toHaveAttribute('aria-current')

    await tab('Who')
    expect(screen.getByRole('button', { name: 'Who' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Split' })).not.toHaveAttribute('aria-current')

    // #302 AC 4 — the fourth tab is marked the same way.
    await tab('Done')
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Who' })).not.toHaveAttribute('aria-current')

    // #353 — and the fifth.
    await tab('Shop')
    expect(screen.getByRole('button', { name: 'Shop' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Done' })).not.toHaveAttribute('aria-current')
  })

  it('#353 AC 2: arriving on Shop re-reads everything, and the shopping read names the household on screen AFTER the roster read', async () => {
    await renderApp()
    const before = {
      members: api.listMembers.mock.calls.length,
      chores: choresApi.listChores.mock.calls.length,
      capacity: capacityApi.listCapacity.mock.calls.length,
      shopping: shoppingApi.readShopping.mock.calls.length,
    }

    await tab('Shop')

    expect(screen.getByRole('region', { name: 'Shop' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /the split/i })).not.toBeInTheDocument()
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(before.members)
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before.chores)
    expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(before.capacity)
    expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(before.shopping)
    // WHICH household — #159's rule — and the client App was handed. The
    // three reads inside are shopping.io.test.js's; what only this level can
    // see is that App named `found.id` and nothing else.
    expect(shoppingApi.readShopping).toHaveBeenLastCalledWith(SHOPPING_CLIENT, household.id)
    // After the roster read of the same refresh, the order the issue names.
    const rosterOrder = api.listMembers.mock.invocationCallOrder.at(-1)
    const shoppingOrder = shoppingApi.readShopping.mock.invocationCallOrder.at(-1)
    expect(shoppingOrder).toBeGreaterThan(rosterOrder)
  })

  it('#302 AC 4: arriving on Done re-reads everything, as every other tab does', async () => {
    await renderApp()
    const before = {
      members: api.listMembers.mock.calls.length,
      chores: choresApi.listChores.mock.calls.length,
      capacity: capacityApi.listCapacity.mock.calls.length,
    }

    await tab('Done')

    expect(screen.getByRole('region', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /the split/i })).not.toBeInTheDocument()
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(before.members)
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before.chores)
    expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(before.capacity)
  })

  it('#302 AC 1: the chore tab’s "done this week" line leads to Done, re-reading on the way', async () => {
    // One finished just now, so it falls in whatever capacity week App derives
    // from the real clock, and one outstanding. The chore tab must show the
    // outstanding one, count the finished one on its line, and not render it.
    choresApi.listChores.mockResolvedValue([
      {
        id: 'c1',
        household_id: 'h1',
        title: 'Placeholder Chore',
        expected_minutes: 20,
        due_on: '2026-08-10',
        completed_at: null,
        completed_by_member_id: null,
      },
      {
        id: 'c2',
        household_id: 'h1',
        title: 'Placeholder Other Chore',
        expected_minutes: 30,
        due_on: '2026-08-10',
        completed_at: new Date().toISOString(),
        completed_by_member_id: 'm1',
      },
    ])
    await renderApp('Chores')
    expect(screen.getByText('Placeholder Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Other Chore')).not.toBeInTheDocument()
    expect(screen.getByTestId('done-this-week')).toHaveTextContent(/done this week/)

    const before = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByTestId('done-this-week')))

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
    // Through goTo, not a bare setView: the arrival re-read (criterion 11)
    // holds for this route onto the surface as it does for the tab.
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before)
  })

  it('offers no surfaces at all until there is a household to look at', async () => {
    // A tab strip above the sign-in screen is three buttons that lead nowhere.
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    expect(screen.queryByRole('button', { name: 'Split' })).not.toBeInTheDocument()
  })
})

describe('#342 — the app updates itself when the household changes', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 90, claimed_by: null },
  ]
  const chore = {
    id: 'c1',
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    choresApi.listChores.mockResolvedValue([chore])
    // jsdom reports the page as visible only when told to; the handler reads
    // this property, so it is pinned per test and removed after.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })
  afterEach(() => {
    delete document.visibilityState
  })

  /** The arguments of the most recent channel App opened. */
  const channel = () => realtimeApi.subscribeToHousehold.mock.calls.at(-1)[0]
  /** The `close` of the n-th channel App opened. */
  const closeOf = (n) => realtimeApi.subscribeToHousehold.mock.results[n].value.close
  /** How many full reads have run — `listHouseholds` is `refresh()`'s first call. */
  const reads = () => api.listHouseholds.mock.calls.length
  const joined = () => screen.findByRole('button', { name: 'Chores' })
  const pause = (ms) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

  it('AC 2: opens ONE channel on the household on screen, scoped by its roster, once joined', async () => {
    await renderApp()
    await joined()
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
    // The household and the member ids travel — the server filters on them.
    expect(channel()).toMatchObject({ householdId: 'h1', memberIds: ['m1', 'm2'] })
    expect(typeof channel().onChange).toBe('function')
    expect(typeof channel().onReconnect).toBe('function')
  })

  it('opens no channel for a person who is signed out, nor for one with no household yet', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(realtimeApi.subscribeToHousehold).not.toHaveBeenCalled()
    cleanup()
    api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })
    expect(realtimeApi.subscribeToHousehold).not.toHaveBeenCalled()
  })

  it('AC 2: a change another phone made is a full re-read, with nobody pressing anything', async () => {
    await renderApp()
    await joined()
    const before = reads()
    const chorReadsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    // The whole of refresh(), not a patch from the payload: the chores were
    // re-read too, and the payload carried none of them.
    await waitFor(() => expect(choresApi.listChores.mock.calls.length).toBe(chorReadsBefore + 1))
  })

  it('AC 3: a re-join after a drop is a re-read — the catch-up for what was missed', async () => {
    await renderApp()
    await joined()
    const before = reads()
    await act(async () => void channel().onReconnect())
    await waitFor(() => expect(reads()).toBe(before + 1))
  })

  it('AC 5: an own write followed by its echoes is TWO reads, never one per echo', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')
    // Hold the write's own re-read open, so the echoes land while it is in flight.
    let release
    api.listHouseholds.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([household])
        }),
    )
    const before = reads()
    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))
    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    // Three echoes — the insert on `chores`, say, seen through three bindings
    // or three phones' worth of the same second — while the write's read runs.
    await act(async () => {
      channel().onChange({ eventType: 'INSERT', table: 'chores' })
      channel().onChange({ eventType: 'INSERT', table: 'chores' })
      channel().onChange({ eventType: 'INSERT', table: 'chores' })
    })
    // Nothing ran concurrently with the read in flight.
    expect(reads()).toBe(before + 1)
    await act(async () => void release())
    // Exactly one more, for all three.
    await waitFor(() => expect(reads()).toBe(before + 2))
    await pause(30)
    expect(reads()).toBe(before + 2)
  })

  it('AC 5: an echo that lands AFTER the write has re-read is a read of its own', async () => {
    await renderApp()
    await joined()
    const before = reads()
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(before + 2))
  })

  it('AC 1: the tab coming back is ONE read, however many focus events it fires', async () => {
    await renderApp()
    await joined()
    const before = reads()
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })
    // Debounced: nothing has run yet.
    expect(reads()).toBe(before)
    await waitFor(() => expect(reads()).toBe(before + 1))
    await pause(actualRealtime.REFRESH_DEBOUNCE_MS * 2)
    expect(reads()).toBe(before + 1)
  })

  it('AC 1: a focus event on the sign-in screen reads nothing', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await pause(actualRealtime.REFRESH_DEBOUNCE_MS * 2)
    expect(api.listHouseholds).not.toHaveBeenCalled()
  })

  it('closes the channel on sign-out, and opens none for the screen that follows', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
    const close = closeOf(0)
    expect(close).not.toHaveBeenCalled()
    // After the sign-out the server has no household for nobody.
    api.listHouseholds.mockResolvedValue([])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(api.signOut).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
  })

  it('a household switch closes the old channel and opens one on the new household', async () => {
    await renderApp()
    await joined()
    const close = closeOf(0)
    // #164 built the switcher, and this test deliberately does NOT use it: the
    // subject here is the READ coming back different, which is what a Realtime
    // echo produces and what a switch also produces. Driving it through the
    // read keeps this about the channel rather than about the control.
    api.listHouseholds.mockResolvedValue([{ ...household, id: 'h2' }])
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'households' }))
    await waitFor(() => expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(2))
    expect(close).toHaveBeenCalledTimes(1)
    expect(channel()).toMatchObject({ householdId: 'h2', memberIds: ['m1', 'm2'] })
  })

  it('a roster change re-scopes the channel to the new member set, and a re-read that changes nothing does not', async () => {
    await renderApp()
    await joined()
    // A re-read returning the same ids: refresh() hands back new objects, and
    // the channel must not be torn down for them.
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(2))
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
    expect(closeOf(0)).not.toHaveBeenCalled()
    // A member joins on another phone.
    api.listMembers.mockResolvedValue([
      ...roster,
      { id: 'm3', display_name: 'Placeholder Three', weekly_minutes: 60, claimed_by: null },
    ])
    await act(async () => void channel().onChange({ eventType: 'INSERT', table: 'members' }))
    await waitFor(() => expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(2))
    expect(closeOf(0)).toHaveBeenCalledTimes(1)
    expect(channel().memberIds).toEqual(['m1', 'm2', 'm3'])
  })

  it('a failed background read lands on the error strip and takes nothing else down', async () => {
    await renderApp()
    await joined()
    api.listHouseholds.mockRejectedValueOnce(new Error('the network went away for a moment'))
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    expect(await screen.findByText(/the network went away for a moment/)).toBeInTheDocument()
    // Still the joined shell, still listening.
    expect(screen.getByRole('button', { name: 'Chores' })).toBeInTheDocument()
    expect(closeOf(0)).not.toHaveBeenCalled()
  })
})

// #483 — the offer to install Taskr, in the shell. The DECISION (captured
// event, already-installed gate, 30-day "Not now") is `installOffer.test.js`'s
// subject; what this file proves is where the line lands and what the two
// buttons reach, through the real shell. The controller is faked in the shape
// `startInstallOffer` returns, driven by hand.
describe('#483 — the install offer, in the shell', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
  }
  // #484 — the fake carries a REASON as well as a boolean, because the real
  // controller does: the two are set together there, so a fake that held only
  // the boolean could not reproduce the state the shell reads. #517 adds the
  // DEVICE, a phone by default — #483's line was written for one.
  const makeOffer = (offered = true, reason = 'prompt', device = 'phone') => {
    const listeners = new Set()
    const offer = {
      offered,
      why: reason,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      isOffered: () => offer.offered,
      reason: () => (offer.offered ? offer.why : null),
      device: () => device,
      install: vi.fn(),
      dismiss: vi.fn(),
      set(next) {
        offer.offered = next
        for (const listener of listeners) listener()
      },
    }
    return offer
  }
  const renderWithOffer = async (offer) => {
    await act(async () => void render(<App installOffer={offer} />))
  }
  const line = () => screen.queryByTestId('install-offer')

  const joined = () => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])
  }

  it('AC 1: with a household showing, one line offers Install and Not now, in the shell and not over anything', async () => {
    joined()
    const offer = makeOffer(true)
    await renderWithOffer(offer)
    await screen.findByRole('button', { name: 'Who' })
    const strip = line()
    expect(strip).toBeInTheDocument()
    expect(within(strip).getByText(/install taskr on this phone/i)).toBeInTheDocument()
    // In the flow of the shell, above the tab strip, and not a modal.
    expect(strip.closest('main.shell')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(strip.compareDocumentPosition(screen.getByRole('button', { name: 'Who' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // The two answers reach the controller, and nothing else does.
    await act(async () => void fireEvent.click(within(strip).getByRole('button', { name: /^install$/i })))
    expect(offer.install).toHaveBeenCalledTimes(1)
    expect(offer.dismiss).not.toHaveBeenCalled()
    await act(async () => void fireEvent.click(within(strip).getByRole('button', { name: /not now/i })))
    expect(offer.dismiss).toHaveBeenCalledTimes(1)
  })

  it('follows the controller: the line appears when the browser fires, and goes when it is answered', async () => {
    joined()
    const offer = makeOffer(false)
    await renderWithOffer(offer)
    await screen.findByRole('button', { name: 'Who' })
    expect(line()).not.toBeInTheDocument()
    await act(async () => offer.set(true))
    expect(line()).toBeInTheDocument()
    await act(async () => offer.set(false))
    expect(line()).not.toBeInTheDocument()
  })

  it('never on the sign-in screen, even while the browser is offering', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderWithOffer(makeOffer(true))
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(line()).not.toBeInTheDocument()
  })

  it('never on the onboarding screen, even while the browser is offering', async () => {
    // The shared default: a session and no household.
    await renderWithOffer(makeOffer(true))
    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(line()).not.toBeInTheDocument()
  })

  it('survives the remount a sign-out causes: the next person, joined, is offered again', async () => {
    // #440 remounts the app on session end; the controller outlives it and
    // the subscription follows the new instance.
    joined()
    let session = { user: { id: 'person-a' } }
    api.currentSession.mockImplementation(async () => session)
    api.sessionIsGone.mockImplementation(async () => session === null)
    api.signOut.mockImplementation(async () => {
      session = null
    })
    const offer = makeOffer(true)
    await renderWithOffer(offer)
    await act(async () => void fireEvent.click(await screen.findByRole('button', { name: 'Who' })))
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(line()).toBeInTheDocument()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign out$/i })))
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(line()).not.toBeInTheDocument()
    api.signIn.mockImplementation(async () => {
      session = { user: { id: 'person-a' } }
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign in$/i })))
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(line()).toBeInTheDocument()
  })

  it('with no controller at all (the tests’ default), nothing is shown and nothing is stored', async () => {
    joined()
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(line()).not.toBeInTheDocument()
    expect(window.localStorage.length).toBe(0)
  })

  // #484 — the same host, the other line. What this adds over the component's
  // own tests is that the SHELL passes the reason through: a shell that
  // ignored it would render Android's copy to somebody on an iPhone, and every
  // component test would still pass.
  it('#484: an iOS reason renders the two-tap line in the shell, with no Install button', async () => {
    joined()
    const offer = makeOffer(true, 'ios')
    await renderWithOffer(offer)
    await screen.findByRole('button', { name: 'Who' })
    const strip = line()
    expect(strip).toBeInTheDocument()
    expect(strip).toHaveAttribute('data-variant', 'ios')
    expect(strip).toHaveTextContent(/tap share, then add to home screen/i)
    expect(within(strip).queryByRole('button', { name: /^install$/i })).toBeNull()
    // Same placement as #483's: in the shell, above the tab strip, not modal.
    expect(strip.closest('main.shell')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(strip.compareDocumentPosition(screen.getByRole('button', { name: 'Who' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // Not now is the one answer, and it reaches the shared controller.
    await act(async () => void fireEvent.click(within(strip).getByRole('button', { name: /not now/i })))
    expect(offer.dismiss).toHaveBeenCalledTimes(1)
    expect(offer.install).not.toHaveBeenCalled()
  })

  it('#484: the iOS line is on the same gate — never on the sign-in screen', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderWithOffer(makeOffer(true, 'ios'))
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(line()).not.toBeInTheDocument()
  })

  it('#484: an iOS dismissal takes the line away, through the same subscription', async () => {
    joined()
    const offer = makeOffer(true, 'ios')
    await renderWithOffer(offer)
    await screen.findByRole('button', { name: 'Who' })
    expect(line()).toBeInTheDocument()
    await act(async () => offer.set(false))
    expect(line()).not.toBeInTheDocument()
  })

  // #517 — what this adds over the component's own tests is that the SHELL
  // passes the device through: a shell that dropped it, or pinned a word,
  // would render one line everywhere and every component test would pass.
  it.each(['phone', 'tablet', 'computer'])('#517 AC 2: on a %s, the line in the shell names it', async (device) => {
    joined()
    await renderWithOffer(makeOffer(true, 'prompt', device))
    await screen.findByRole('button', { name: 'Who' })
    expect(line().querySelector('.shell__install-text')).toHaveTextContent(new RegExp(`^Install Taskr on this ${device}$`))
  })

  it('#517 AC 3: the real controller in a browser with no matchMedia — this one — says "this device" and does not throw', async () => {
    // The precondition, asserted rather than assumed: jsdom has no
    // matchMedia, which is the old-browser case the AC names. A setup file
    // that polyfilled it would make this test about something else.
    expect(typeof window.matchMedia).toBe('undefined')
    joined()
    const offer = startInstallOffer({ target: window })
    onTestFinished(() => offer.stop())
    expect(offer.device()).toBeNull()
    await renderWithOffer(offer)
    await screen.findByRole('button', { name: 'Who' })
    expect(line()).not.toBeInTheDocument()
    // Chrome's event, as far as the controller reads it.
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = vi.fn(async () => ({ outcome: 'dismissed' }))
    await act(async () => void window.dispatchEvent(event))
    expect(line()).toBeInTheDocument()
    expect(line().querySelector('.shell__install-text')).toHaveTextContent(/^Install Taskr on this device$/)
  })
})
