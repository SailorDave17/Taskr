// App's tests for the calendar connection and the busy minutes it suggests.
// Split out of `App.test.jsx` by #553; every describe below moved verbatim with
// the comment above it. The fakes, the `vi.mock` calls and the shared
// `beforeEach` are in `src/test/support/appHarness.jsx`, which must stay the
// FIRST import.
import { api, choresApi, capacityApi, reassignApi, announceApi, calendarApi, actualCapacity, renderApp } from './test/support/appHarness.jsx'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const atUrl = (search = '', hash = '') => {
    assign = vi.fn()
    replaceState = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      // `hash` since #304: the implicit flow's error channel is the fragment.
      value: { origin: 'https://taskr.example.test', pathname: '/', search, hash, assign },
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
    api.listHouseholds.mockResolvedValue([household])
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
    // `openid` names the consenting Google account, and reads nothing (#474).
    expect(url.searchParams.get('scope')).toBe('openid https://www.googleapis.com/auth/calendar.freebusy')
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

  describe('#304 AC 4 — the root is shared with the Google sign-in, and the calendar’s `state` tells them apart', () => {
    // Every shape below lands on the same URL the calendar consent does.
    // Google echoes the calendar's own `state` on every calendar return and
    // Supabase's returns never carry one — so a query WITHOUT a state is not the
    // calendar's, whatever else it carries, and is never sent to
    // `calendar-connect`. The app exchanges no code at all under the implicit
    // flow (gate.test.js asserts the word is absent), so the other half of the
    // criterion — a calendar code never handed to the exchange — has nothing
    // to reach.

    it('a code with no state is nobody’s: not sent to calendar-connect, and nothing is said', async () => {
      atUrl('?code=orphan-code')
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })

      expect(calendarApi.completeConnect).not.toHaveBeenCalled()
      expect(screen.queryAllByRole('alert')).toEqual([])
    })

    it('a Supabase sign-in error in the query (no state) is a sign-in failure, not a calendar one', async () => {
      // GoTrue's bad-flow-state redirect, as probed live 2026-09-04. Before
      // #304 this read as "Google could not complete that connection", which
      // sent a person to the calendar to fix a sign-in.
      api.currentSession.mockResolvedValue(null)
      atUrl('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired')
      await renderApp()
      await screen.findByRole('button', { name: /^sign in$/i })

      expect(calendarApi.completeConnect).not.toHaveBeenCalled()
      const note = screen.getByTestId('sign-in-return')
      expect(note).toHaveTextContent(/took too long or was already used/i)
      expect(note).not.toHaveTextContent(/calendar|connection/i)
      // Spent, and stripped so a reload does not announce it twice.
      expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    })

    it('AC 5: a Google refusal in the fragment says the sign-in was cancelled, on the sign-in screen (#465 wording)', async () => {
      // The implicit flow's error channel. `access_denied` is the person
      // backing out of Google's screen; the sentence says so, offers both ways
      // back in, and does not blame a password nobody typed. It no longer
      // sends them to the organizer to be "added": the test-user list gates
      // the calendar's sensitive scopes, not sign-in (measured 2026-09-16 on
      // #330's run, recorded on #339; reworded by #465). The SHAPE here is
      // GoTrue's documented one.
      api.currentSession.mockResolvedValue(null)
      atUrl('', '#error=access_denied&error_description=The+user+denied+access')
      await renderApp()
      await screen.findByRole('button', { name: /^sign in$/i })

      const note = screen.getByTestId('sign-in-return')
      expect(note).toHaveTextContent(/cancelled or did not complete/i)
      expect(note).toHaveTextContent(/Continue with Google/)
      expect(note).not.toHaveTextContent(/organizer/i)
      expect(note).not.toHaveTextContent(/did not match/i)
      expect(calendarApi.completeConnect).not.toHaveBeenCalled()
      expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    })

    it('the calendar’s own return — a code WITH a state — still reaches calendar-connect and only it', async () => {
      // The other side of the discriminator, so the three tests above cannot be
      // satisfied by an App that ignores every query string.
      atUrl('?code=the-code&state=the-state')
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })

      expect(calendarApi.completeConnect).toHaveBeenCalledWith({
        code: 'the-code',
        error: null,
        state: 'the-state',
      })
      expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    })

    it('a fresh attempt clears the notice about the last one', async () => {
      api.currentSession.mockResolvedValue(null)
      atUrl('', '#error=access_denied')
      await renderApp()
      await screen.findByTestId('sign-in-return')

      await act(async () =>
        void fireEvent.click(screen.getByRole('button', { name: /continue with google/i })),
      )
      expect(api.signInWithGoogle).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    })
  })
})

// #96 — the calendar's suggested busy minutes, at the level only App can answer.
//
// Roster.test.jsx covers what the readout DRAWS. Everything here is about the
// TRIGGER, which is the criterion with a boundary in it: AC 1 says the fetch
// happens when there is no derived row and does NOT happen when there is, and
// the two invocation-count assertions are what make that a fact rather than a
// preference. #98's refresh story owns the other side of the same boundary, so
// its counterpart tests will assert the mirror image — a row existing is
// precisely where this story stops.
describe('calendar-suggested busy minutes (#96)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = {
    id: 'c1',
    member_id: 'm1',
    scope: 'freebusy',
    connected_at: '2026-08-24T00:00:00Z',
  }
  /** A Monday. Every test that matters re-derives the week through the app's own
   * `periodStartFor`; this is only the fixture's default key. */
  const WEEK = '2026-09-07'
  const busyRow = {
    id: 'b1',
    member_id: 'm1',
    period_start: WEEK,
    busy_minutes: 320,
    event_count: 6,
    // Read NOW, not on a fixed date. This was '2026-09-08T14:00:00Z' until #98
    // — a date in the future when written — and #98 makes a row older than
    // twelve hours a TRIGGER, so on the evening of 2026-09-09 this fixture
    // would have aged across the bound and turned "does NOT fetch when a row
    // exists" into one call, on a diff that touched nothing. Every test in
    // this block is about a row EXISTING; none is about its age, and a fresh
    // timestamp is the only value that keeps it that way indefinitely.
    computed_at: new Date().toISOString(),
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('AC 1: fetches ONCE when a connected member has no row for this week', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    // The week is the app's OWN arithmetic: `periodStartFor` is real here (only
    // the impure capacity functions are stubbed), so this asserts the household
    // zone reached it rather than asserting a constant against itself.
    const [call] = calendarApi.fetchBusyWeek.mock.calls
    expect(call[0].householdId).toBe('h1')
    expect(call[0].periodStart).toBe(
      actualCapacity.periodStartFor(new Date(), household.timezone),
    )
  })

  it('AC 1: does NOT fetch when a row for this week already exists', async () => {
    // The disjoint half. Staleness — how OLD that row is — belongs entirely to
    // #98, and this story has no clause about it to get wrong. A trigger that
    // also fired on an old row would make the two stories' invocation counts
    // impossible to tell apart, which is what the criterion's wording guards.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks.mockResolvedValue([{ ...busyRow, period_start: week }])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not fetch on a screen that shows no capacity', async () => {
    // "When the capacity screen opens" is the whole clause. The app boots on the
    // split, and spending a member's Google credential for a figure that is not
    // on screen is exactly what the wording refuses.
    await renderApp()
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not fetch for a member who has connected nothing', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not fetch on a HOUSEMATE connection', async () => {
    // Owner decision, 2026-09-04: this device reads the signed-in member's own
    // calendar. A trigger keyed on "somebody in this household is connected"
    // would spend a housemate's credential on this person's app-open.
    calendarApi.listCalendarConnections.mockResolvedValue([{ ...connection, member_id: 'm2' }])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: stays at one call when the screen is left and re-opened', async () => {
    // "Once for that week" outlives a tab switch. Each visit re-runs the effect
    // and the guard is what makes the second one silent — a guard written after
    // the await would let a re-render during the round trip start a second call.
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 4: draws the figure the server hands back, after the fetch', async () => {
    // Re-read rather than trusting the function's answer: what the next device
    // to load will see is exactly what this one now shows.
    // TWO empty reads, not one: `renderApp('Who')` refreshes at boot AND for
    // the tab, so a single `mockResolvedValueOnce([])` let the tab-switch
    // refresh hand back the row and this test passed without the effect's own
    // re-read ever being observed (review-fanout, 2026-09-04, second pass). The
    // third read is the effect's, and it is the only one that returns the row.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...busyRow, period_start: week }])
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')
    expect(calendarApi.listBusyWeeks).toHaveBeenCalledTimes(3)
  })

  it('AC 5: a calendar that cannot be read costs the suggestion and nothing else', async () => {
    calendarApi.fetchBusyWeek.mockRejectedValue(
      new Error('That calendar connection is no longer valid. Connect it again.'),
    )
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/no longer valid/),
    )
    // The app still works. This is the assertion that separates a handled
    // failure from a swallowed one: the roster is on screen and the manual
    // control is still there to use.
    expect(
      inRoster().getByRole('button', { name: /set this week for placeholder one/i }),
    ).toBeEnabled()
  })

  it('AC 5: does not retry the same week after a failure', async () => {
    // Weak on its own, and said so: the complaint render changes none of the
    // effect's dependencies, so the effect neither re-runs nor cleans up and
    // this is one call BY CONSTRUCTION. The witness that actually reaches the
    // guard is the tab-switch test directly below (review-fanout, 2026-09-04,
    // second pass: this test's first comment claimed the opposite).
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/))
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 5: still does not retry after leaving the screen and coming back', async () => {
    // The one that reaches the guard: leaving Who changes `view`, coming back
    // re-runs the effect, and only the key kept in `askedForBusy` stands
    // between that and a second Edge Function call for a week Google already
    // refused. *Measured by the refuter*: with the once-after-failure half of
    // the guard deleted, this reads "called 2 times"; every other #96 test
    // stayed green.
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/)
  })

  it('AC 5: a derived table that is not there yet does not take the app down', async () => {
    // `0030` is unapplied on the live project until somebody pastes it, and an
    // unguarded read of a missing table would fail the whole refresh — taking
    // the roster, the chores and the manual capacity path with it. This is the
    // largest instance of "the manual path is untouched".
    calendarApi.listBusyWeeks.mockRejectedValue(
      new Error('loading calendar busy minutes: relation does not exist'),
    )
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(
      inRoster().getByRole('button', { name: /set this week for placeholder one/i }),
    ).toBeEnabled()
  })

  it('reads this week figures from the server on every refresh', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    expect(calendarApi.listBusyWeeks).toHaveBeenCalledWith(week, ['m1', 'm2'])
  })

  it('asks for nothing at all when this device has joined no household', async () => {
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /start a household/i })
    expect(calendarApi.listBusyWeeks).not.toHaveBeenCalled()
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // review-fanout, 2026-09-04 — the four the first suite could not see
  // -------------------------------------------------------------------------
  //
  // Every mock above returns the SAME reference on every call, so `useState`
  // bails out of the re-render and no dependency identity ever moves. The real
  // `refresh()` decodes fresh objects from the network every time, and the
  // first trigger effect keyed on those objects: `goTo('who')` started a
  // refresh in the same breath as the fetch, the refresh replaced `household`,
  // `members`, `connections` and `busyWeeks`, the cleanup ran, `cancelled` went
  // true, and the fetch's answer was dropped on both branches with the guard
  // then refusing a retry. Green throughout. These return fresh copies, which
  // is the one thing that lets the suite disagree with the mocks' author.
  describe('with mocks that return fresh references, as the network does', () => {
    const fresh = () => {
      api.listHouseholds.mockImplementation(async () => [{ ...household }])
      api.listMembers.mockImplementation(async () => [{ ...me }, { ...housemate }])
      calendarApi.listCalendarConnections.mockImplementation(async () => [{ ...connection }])
      calendarApi.listBusyWeeks.mockImplementation(async () => [])
    }

    it('AC 4: a fetch that finishes AFTER the refresh still puts the figure on screen', async () => {
      fresh()
      let finish
      calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })
      // The refresh goTo started has settled by now, with fresh identities
      // throughout; the fetch is still in flight. This is the ordering the
      // Edge Function's two Google round trips make the LIKELY one.
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
      const week = actualCapacity.periodStartFor(new Date(), household.timezone)
      calendarApi.listBusyWeeks.mockImplementation(async () => [{ ...busyRow, period_start: week }])
      await act(async () => finish({ ok: true }))
      await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    })

    it('AC 5: a fetch that FAILS after the refresh still puts the sentence on screen', async () => {
      fresh()
      let fail
      calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((_, reject) => (fail = reject)))
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
      await act(async () => fail(new Error('Could not reach Google. Try again in a moment.')))
      await waitFor(() =>
        expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/),
      )
      // And still once. The failure is recorded, not retried into a loop.
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    })

    it('a refresh that changes nothing this trigger decides by does not re-ask', async () => {
      // Held at one call by TWO guards at once — the value-keyed dependencies
      // and the key in `askedForBusy` — so deleting either alone leaves this
      // green. The dependencies are witnessed on their own by the two
      // late-settling tests above (a fetch that outlives the refresh lands
      // only if the refresh did not tear the effect down); this one is the
      // end-to-end statement, not a proof of either guard.
      fresh()
      await renderApp('Who')
      await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
      // Three more refreshes, each decoding fresh objects. Same ids, same
      // connection, still no row — so the trigger has nothing new to say.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
      }
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    })
  })

  it('AC 5: a figure that was on screen SURVIVES a later read failure, with the sentence under it', async () => {
    // The state the criterion actually describes — the last derived figure,
    // its date, and a notice — and the first version could not reach it: the
    // fetch fires only when there is no row, and the refresh path threw the
    // rows away on a failed read. Now the row stays and the sentence joins it.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks
      .mockResolvedValueOnce([{ ...busyRow, period_start: week }])
      .mockRejectedValue(new Error('loading calendar busy minutes: permission denied'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/permission denied/)
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('a read complaint clears once the table reads again', async () => {
    // Set by the refresh path and, until this, cleared by nothing a member who
    // already has a figure could ever reach — so one transient failure left a
    // contradiction under a perfectly good figure for the rest of the session.
    // A CONNECTED member (the describe's default), because the read notice is
    // shown only to one — see the test after this. Their fetch resolves so the
    // only complaint standing is the read's.
    calendarApi.fetchBusyWeek.mockResolvedValue({ ok: true })
    // Rejecting on EVERY read until told otherwise, because `renderApp('Who')`
    // refreshes twice — once at boot and once for the tab — and a single
    // rejection would be cleared by the second before anything could be seen.
    calendarApi.listBusyWeeks.mockRejectedValue(
      new Error('loading calendar busy minutes: permission denied'),
    )
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toBeInTheDocument())
    calendarApi.listBusyWeeks.mockResolvedValue([])
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().queryByTestId('busy-complaint')).not.toBeInTheDocument()
  })

  it('shows the read notice only to a member who has connected a calendar', async () => {
    // Owner decision, 2026-09-04: a failed read of the busy table means
    // something only to somebody whose figure would have been there. Without
    // this, every member reads a PostgREST sentence under their minutes for the
    // whole window between the merge and `0030` being applied, on a row that
    // has nothing to do with calendars.
    calendarApi.listCalendarConnections.mockResolvedValue([])
    calendarApi.listBusyWeeks.mockRejectedValue(
      new Error('loading calendar busy minutes: relation does not exist'),
    )
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(inRoster().queryByTestId('busy-complaint')).not.toBeInTheDocument()
    // POSITIVE CONTROL in the same test: connect them and the same failure is
    // on screen — so the absence above is the gate, not a mock returning nothing.
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    calendarApi.fetchBusyWeek.mockResolvedValue({ ok: true })
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/does not exist/))
  })

  it('a fetch complaint clears only when a figure for this week actually arrives', async () => {
    // Not when the table merely reads fine: a table that reads says nothing
    // about whether Google answered. The two failures were one state variable
    // once, and the read's success wiped the fetch's sentence (review-fanout,
    // 2026-09-04).
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/Google/))
    // A refresh whose read succeeds but brings no row: the sentence stands.
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/Google/)
    // A refresh that brings the row — another device fetched it — clears it.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks.mockResolvedValue([{ ...busyRow, period_start: week }])
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().queryByTestId('busy-complaint')).not.toBeInTheDocument()
    expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument()
  })
})

// #98 — the busy figure refreshes itself on app open when it is stale. The
// mirror of the #96 block above, and written to stay disjoint from it: that
// block proves the fetch fires on NO row and never on a row; this one proves it
// fires on a STALE row and never on a fresh one, on the APP opening rather than
// the capacity screen, and once a session. `isBusyWeekStale` is real here — the
// bound and its boundary are calendar.test.js's — so every row below is aged
// against the actual clock rather than against a stubbed answer.
describe('busy figure refreshes itself on app open (#98)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = {
    id: 'c1',
    member_id: 'm1',
    scope: 'freebusy',
    connected_at: '2026-08-24T00:00:00Z',
  }
  const HOUR = 60 * 60 * 1000
  /** This week, by the app's own arithmetic in the household's zone. */
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  /** A derived row for `me`, read `msAgo` before now. */
  const rowReadAgo = (msAgo, extra = {}) => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: 320,
    event_count: 6,
    computed_at: new Date(Date.now() - msAgo).toISOString(),
    ...extra,
  })
  // Thirteen hours and eleven — an hour either side of the twelve-hour bound,
  // so a slow run cannot walk a fixture across it. The boundary itself is
  // pinned with an injected clock in calendar.test.js, not sampled here.
  const staleRow = (extra) => rowReadAgo(13 * HOUR, extra)
  const freshRow = (extra) => rowReadAgo(11 * HOUR, extra)

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('AC 1: a row older than the bound is refreshed when the APP opens — on the split, before any tab', async () => {
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp()
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    const [call] = calendarApi.fetchBusyWeek.mock.calls
    expect(call[0]).toEqual({ householdId: 'h1', periodStart: week() })
    // The capacity screen was never opened, so #96's trigger — which keys on
    // that screen — cannot have been the caller. "When the app opens" is the
    // whole of this criterion's clause, and the split is where the app opens.
    expect(
      screen.queryByRole('region', { name: /who is in the household/i }),
    ).not.toBeInTheDocument()
  })

  it('AC 2: a row fresher than the bound is left alone, across repeated opens', async () => {
    // The rate bound, as the criterion asks for it: three opens, zero calls.
    // Each open is a fresh mount — a phone opening the app three times in a
    // morning — and each one draws the figure it already has.
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow()])
    for (let open = 0; open < 3; open += 1) {
      await renderApp('Who')
      await waitFor(() =>
        expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy'),
      )
      cleanup()
    }
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1/AC 2: the bound is the ROW’S age, so a row that never freshens costs one call per open and never a loop', async () => {
    // The other half of the rate statement. A member whose Google keeps
    // refusing keeps a stale row; each open asks once — bounded by the key —
    // and a session never asks twice. Three opens, three calls, not thirty.
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    for (let open = 0; open < 3; open += 1) {
      await renderApp()
      await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(open + 1))
      // Settle anything the mount left in flight before counting the next open.
      await act(async () => {})
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(open + 1)
      cleanup()
    }
  })

  it('AC 1: once a session — refreshes, tab switches and re-renders do not ask again', async () => {
    // Fresh references throughout, as the network hands them back, so this is
    // the version of the claim that can disagree with the mocks' author: the
    // trigger keys on the timestamp as a VALUE, and a refresh that decodes the
    // same row into a new object leaves it alone. The row stays stale on every
    // re-read (the mock never freshens it), so nothing the effect decides by
    // ever moves and this is one call BY CONSTRUCTION — the value-keyed
    // dependency list is what it witnesses. The session KEY is witnessed
    // separately, by the roster-change test at the end of this block, which is
    // the one that makes a dependency move after a failure.
    api.listHouseholds.mockImplementation(async () => [{ ...household }])
    api.listMembers.mockImplementation(async () => [{ ...me }, { ...housemate }])
    calendarApi.listCalendarConnections.mockImplementation(async () => [{ ...connection }])
    const row = staleRow()
    calendarApi.listBusyWeeks.mockImplementation(async () => [{ ...row }])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 3; i += 1) {
      await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    }
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    // Exactly one, with the capacity screen open the whole time: #96's trigger
    // saw a row and did nothing, which is the disjointness both stories claim.
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 1: does not refresh for a member who has connected nothing, however old the row', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([])
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy'),
    )
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not refresh a HOUSEMATE’s stale row', async () => {
    // Owner decision on #96, inherited: this device reads the signed-in
    // member's own calendar. My row is fresh; the housemate's is a day old and
    // is theirs to refresh when they open their own app.
    calendarApi.listBusyWeeks.mockResolvedValue([
      freshRow(),
      staleRow({ id: 'b2', member_id: 'm2', busy_minutes: 90 }),
    ])
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getAllByText(/calendar suggests:/i)).toHaveLength(2))
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 3: a refresh that lands while the capacity screen is open updates the figure in place', async () => {
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    // The stale figure is on screen and the refresh is in flight — started at
    // boot, before the tab was pressed. Both refreshes goTo started have
    // settled by now with the same stale row, so what lands next lands late.
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy'),
    )
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    calendarApi.listBusyWeeks.mockResolvedValue([rowReadAgo(0, { busy_minutes: 400, event_count: 7 })])
    await act(async () => finish({ ok: true }))
    // No reload, no refresh button, no tab: the promise settled and the screen
    // followed. The date beside it is the new read's.
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('400 min busy'),
    )
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent(/· read /)
    // And the fresh row did not re-arm the trigger: still one call.
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 4: a refresh that fails leaves the stale figure and its date on screen, and interrupts nothing', async () => {
    calendarApi.fetchBusyWeek.mockRejectedValue(
      new Error('Could not reach Google. Try again in a moment.'),
    )
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/),
    )
    // The figure the member had, with the date it was read — not zeroed, not
    // cleared, not replaced by the sentence.
    const figure = inRoster().getByText(/calendar suggests:/i)
    expect(figure).toHaveTextContent('320 min busy')
    expect(figure).toHaveTextContent(/· read /)
    // "No error interrupts the session": nothing is in the app's error strip,
    // no alert is on the page, and the manual path is there to use. The one
    // sentence that appears is a polite status beside the figure, which is
    // #96 AC 5's surface reused rather than a new one.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not reach the household/i)).not.toBeInTheDocument()
    expect(
      inRoster().getByRole('button', { name: /set this week for placeholder one/i }),
    ).toBeEnabled()
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 4: a failed refresh is not asked again when the roster changes underneath it', async () => {
    // The witness that reaches the session KEY rather than the dependency list.
    // After a failure the row is unchanged, so no dependency moves and the
    // effect is silent by construction — until something it decides by DOES
    // move. A housemate joining changes the member set the re-read names; the
    // effect re-runs, the row is still stale, and only the key stands between
    // that and a second call for a week Google just refused.
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/),
    )
    api.listMembers.mockResolvedValue([
      me,
      housemate,
      { id: 'm3', display_name: 'Placeholder Three', weekly_minutes: 60, claimed_by: null },
    ])
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    await waitFor(() => expect(inRoster().getByText('Placeholder Three')).toBeInTheDocument())
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/)
  })
})

// #106 — a refreshed suggestion applies itself within the bound. The DECISION
// is capacity.autoApply.test.js's (the bound, the floor, the boundary), the
// ROW is calendarAutoApply.pglite.test.js's and the MARK is Roster.test.jsx's.
// What App owes is the wiring only it can prove: that the write happens at the
// seam a landed read passes through, with the word and the previous figure,
// against the override the SERVER holds rather than the one the screen had;
// that the re-assignment and the re-read follow; that a refused decision
// writes nothing and leaves "Use this" standing; and that the cause reaches
// #50's statement. `autoApplyDecision` and `calendarSuggestion` are REAL here
// (the capacity mock spreads the actual module), so a decision the pure suite
// proves is the decision these tests exercise.
describe('a refreshed suggestion applies itself within the bound (#106)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  // 300 usual. With a confirmed 100 standing, a read of 260 busy suggests 40:
  // a move of 60, inside the bound. A read of 30 busy suggests 270: a move of
  // 170, outside it. With NO row, a read of 90 busy suggests 210: a move of 90
  // from the baseline, inside.
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 300,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' }
  const HOUR = 60 * 60 * 1000
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  const rowReadAgo = (msAgo, busy) => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: busy,
    event_count: 4,
    computed_at: new Date(Date.now() - msAgo).toISOString(),
  })
  const staleRow = (busy = 200) => rowReadAgo(13 * HOUR, busy)
  const freshRow = (busy) => rowReadAgo(0, busy)
  const override = (minutes, source, previous = null) => ({
    id: 'o1',
    member_id: 'm1',
    period_start: week(),
    minutes,
    note: null,
    source,
    previous_minutes: previous,
    created_at: '2026-09-07T00:00:00Z',
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  /**
   * Boot with a stale row so #98's refresh fires, hold the fetch, then let it
   * land with `busy` — the #98 AC 3 shape. Returns once the fetch has settled
   * and everything it started has too.
   */
  async function refreshLandsWith(busy, { surface } = {}) {
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp(surface)
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(busy)])
    await act(async () => finish({ ok: true }))
    await act(async () => {})
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
  })

  it('AC 2: a refresh within the bound writes the week with source calendar_auto and the figure it replaced', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    await refreshLandsWith(260)
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    expect(capacityApi.setCapacity).toHaveBeenCalledWith({
      memberId: 'm1',
      periodStart: week(),
      minutes: 40,
      source: 'calendar_auto',
      previousMinutes: 100,
      householdId: 'h1',
    })
  })

  it('AC 2: the write is followed by the same re-assignment a tap causes, then a re-read', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    await refreshLandsWith(260)
    await waitFor(() => expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' }))
    // Ordered: the row lands, THEN the re-assignment reads it, THEN the screen
    // re-reads what the re-assignment stored — a re-assignment before the
    // write would divide by last week's figure. All three legs by CALL ORDER:
    // the first draft compared the read count against a number captured
    // before the render, which the boot's own read exceeded whatever happened
    // after the write (review-fanout, 2026-09-08 — an assertion that could not
    // fail on any mutation).
    const setAt = capacityApi.setCapacity.mock.invocationCallOrder[0]
    const reassignAt = reassignApi.reassignHousehold.mock.invocationCallOrder[0]
    expect(setAt).toBeLessThan(reassignAt)
    await waitFor(() =>
      expect(api.listHouseholds.mock.invocationCallOrder.some((n) => n > reassignAt)).toBe(true),
    )
  })

  it('AC 2: decides against the BASELINE the server holds too — a housemate’s edit during the round trip is the baseline used', async () => {
    // No override. Booted at 300 usual; during the fetch a housemate saved the
    // baseline as 200 on another device. The read lands at 120 busy: from the
    // fresh 200 the suggestion is 80 (a move of 120, inside); from the stale
    // 300 it would have been 180. The write must carry the fresh pair.
    capacityApi.listCapacity.mockResolvedValue([])
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp()
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    api.listMembers.mockResolvedValue([{ ...me, weekly_minutes: 200 }, housemate])
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(120)])
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    expect(capacityApi.setCapacity.mock.calls[0][0]).toMatchObject({
      minutes: 80,
      previousMinutes: 200,
      source: 'calendar_auto',
    })
  })

  it('the trigger’s refusal (a person won the race) is quiet: no error strip, no re-assignment, a re-read', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    const refusal = new Error('saving this week’s capacity: an automatic calendar figure cannot replace a figure a person set (manual)')
    refusal.cause = { code: 'TA106', message: 'refused' }
    capacityApi.setCapacity.mockRejectedValue(refusal)
    await refreshLandsWith(260)
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    const setAt = capacityApi.setCapacity.mock.invocationCallOrder[0]
    await waitFor(() =>
      expect(api.listHouseholds.mock.invocationCallOrder.some((n) => n > setAt)).toBe(true),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('AC 2: decides against the override the SERVER holds, re-read at the moment the figure lands', async () => {
    // The screen booted with a confirmed 100; a housemate typed 100 during
    // the round trip. The re-read sees `manual`, and the floor refuses.
    capacityApi.listCapacity.mockResolvedValueOnce([override(100, 'calendar')])
    capacityApi.listCapacity.mockResolvedValue([override(100, 'manual')])
    await refreshLandsWith(260)
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    // And the re-read was scoped to this member and this week.
    const mine = capacityApi.listCapacity.mock.calls.filter(([, ids]) => ids.length === 1 && ids[0] === 'm1')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine[0][0]).toBe(week())
  })

  it('AC 2: fires on #96’s FIRST read of a week too, from the baseline — the seam is shared', async () => {
    // No row and no override: opening the roster asks (#96), the read lands
    // at 90 busy, the baseline 300 becomes 210 — a move of 90, inside.
    capacityApi.listCapacity.mockResolvedValue([])
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(90)])
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    expect(capacityApi.setCapacity.mock.calls[0][0]).toMatchObject({
      minutes: 210,
      source: 'calendar_auto',
      previousMinutes: 300,
    })
  })

  it('AC 3: a refresh outside the bound writes nothing, and the readout only proposes', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    await refreshLandsWith(30, { surface: 'Who' })
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('30 min busy'),
    )
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
    // Exactly as in the confirm story: the tap is there, and it is the way in.
    expect(
      inRoster().getByRole('button', { name: /use the calendar’s figure for placeholder one/i }),
    ).toBeEnabled()
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 100 min')
  })

  it('the manual floor: a refresh within the bound over a TYPED week writes nothing', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'manual')])
    await refreshLandsWith(260)
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('a refresh that confirms the figure already there writes nothing and re-assigns nothing', async () => {
    // Confirmed at 40, the calendar still says 260 busy → 40. No row, no run,
    // no event (#50 AC 8, inherited).
    capacityApi.listCapacity.mockResolvedValue([override(40, 'calendar')])
    await refreshLandsWith(260)
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('a failed refresh writes nothing — there is no new figure to apply', async () => {
    // The stale row suggests 40 against a confirmed 100 — a move of 60,
    // INSIDE the bound — so a build that reached the decision on the stale
    // figure after the failed fetch WOULD write, and only the early return
    // discharges the assertion. The first draft's stale row suggested exactly
    // the standing figure, so the no-change rule discharged it instead
    // (review-fanout, 2026-09-08; prove-tests shape 9).
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow(260)])
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/))
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
  })

  it('AC 4: after the write the roster shows the week as set automatically, with the figure it replaced', async () => {
    // A fake that MODELS the write: every read returns the confirmed row
    // until setCapacity has been called, and the automatic row after — so the
    // re-read after the write returns what the database now holds whatever
    // number of refreshes the boot and the tab press happen to run.
    capacityApi.listCapacity.mockImplementation(async () =>
      capacityApi.setCapacity.mock.calls.length > 0
        ? [override(40, 'calendar_auto', 100)]
        : [override(100, 'calendar')],
    )
    await refreshLandsWith(260, { surface: 'Who' })
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(inRoster().getByTestId('week-auto-m1')).toHaveTextContent(
        /set from calendar automatically \(was 100 min\)/,
      ),
    )
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 40 min')
  })

  it('a write that fails lands on the error strip rather than vanishing', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    capacityApi.setCapacity.mockRejectedValue(new Error('saving this week’s capacity: refused'))
    await refreshLandsWith(260)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/refused/))
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('AC 2: the change is announced with its cause — the statement says the week was set from their calendar', async () => {
    // The seen-marker says this member last saw Placeholder One at 100 with
    // c1; the re-balance moved c1 to Placeholder Two and the override rows
    // now carry `calendar_auto`. The whole #50 pipeline is real here; what is
    // new is the `sources` App passes it.
    const APPLIED_AT = new Date().toISOString()
    api.listHouseholds.mockResolvedValue([{
      ...household,
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
    }])
    choresApi.listChores.mockResolvedValue([
      { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
    ])
    capacityApi.listCapacity.mockResolvedValue([override(40, 'calendar_auto', 100)])
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(260)])
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: {
        members: [
          { id: 'm1', minutes: 90, capacityMinutes: 100 },
          { id: 'm2', minutes: 0, capacityMinutes: 300 },
        ],
      },
      seen_rebalance_at: '2026-08-27T09:00:00+00:00',
    })
    await renderApp()
    const news = await screen.findByTestId('rebalance-announcement')
    expect(news).toHaveTextContent('Placeholder One’s week has 60 min less room (set from their calendar)')
    expect(news).toHaveTextContent('90 min of chores moved off Placeholder One’s list')
  })
})

/
// #210 — the capture flow, wired. What App owes is three things the roster
// cannot prove on its own: that a description reaches lib/capture.js with the
// household ON SCREEN and this member (and NOT the Supabase client); that it
// is not a mutation — nothing re-reads and nothing is written until a submit;
// and that the one submit carries the source through the same setCapacity a
// typed figure uses, once, followed by the same re-assignment and re-read.
// #99 — disconnecting, from App.
//
// The DELETIONS are the Edge Function's and are proven against a fake client in
// supabase/functions/calendar-disconnect/handler.test.js; the CONTROL is the
// roster's and is proven in Roster.test.jsx. What is left, and what this file
// owes, is the wiring: which household travels with the call, that the screen
// re-reads the server rather than patching itself, and what a member is told
// afterwards.
describe('disconnecting a calendar (#99)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = {
    id: 'c1',
    member_id: 'm1',
    scope: 'freebusy',
    connected_at: '2026-08-24T00:00:00Z',
  }
  /** This week, by the app's own arithmetic in the household's zone. */
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  const busyRow = () => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: 320,
    event_count: 6,
    // NOW, so the row is never stale — #98's refresh trigger keys on age, and a
    // fixture that aged across the bound mid-run would add a fetch this block
    // says nothing about. The same reason #96's fixture reads the clock.
    computed_at: new Date().toISOString(),
  })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    calendarApi.listBusyWeeks.mockResolvedValue([busyRow()])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  /**
   * What the SERVER says once the three rows are gone.
   *
   * The point of driving it this way rather than asserting on local state: AC 2
   * says the connect action returns when the capacity screen RE-RENDERS, and the
   * only honest way to produce that is to change what the reads answer and let
   * `mutate()`'s refresh find it — which is what the running app does.
   */
  const serverForgets = () => {
    calendarApi.listCalendarConnections.mockResolvedValue([])
    calendarApi.listBusyWeeks.mockResolvedValue([])
  }

  /** Both taps of the house confirm idiom. */
  const disconnect = async () => {
    await act(
      async () => void fireEvent.click(inRoster().getByRole('button', { name: /^disconnect$/i })),
    )
    await act(
      async () =>
        void fireEvent.click(
          inRoster().getByRole('button', { name: /disconnect google calendar\?/i }),
        ),
    )
  }

  it('AC 1: names the household on screen, and nothing about who', async () => {
    // The function acts on the CALLER'S own member row, so a member id here
    // would be a value the server must ignore — `completeConnect` and
    // `fetchBusyWeek` send none for the same reason.
    await renderApp('Who')
    await disconnect()
    expect(calendarApi.disconnectCalendar).toHaveBeenCalledTimes(1)
    expect(calendarApi.disconnectCalendar).toHaveBeenCalledWith({ householdId: 'h1' })
  })

  it('AC 2: the connect action returns and the suggestion goes with the rows', async () => {
    await renderApp('Who')
    // The before state, so the after state is a CHANGE rather than an
    // arrangement that could never have shown either one.
    expect(inRoster().getByText(/calendar connected/i)).toBeInTheDocument()
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')

    serverForgets()
    await disconnect()

    expect(
      inRoster().getByRole('button', { name: /connect google calendar/i }),
    ).toBeInTheDocument()
    expect(inRoster().queryByText(/calendar connected/i)).not.toBeInTheDocument()
    expect(inRoster().queryByText(/calendar suggests:/i)).not.toBeInTheDocument()
  })

  it('AC 2: re-reads the server rather than patching what is on screen', async () => {
    // `mutate()`'s refresh is what produces the state above. Asserting the
    // re-read is what separates "the screen changed" from "the screen changed
    // because the server said so" — a locally patched roster would satisfy
    // every assertion in the test above and show a connected calendar again on
    // the next reload.
    await renderApp('Who')
    const readsBefore = calendarApi.listCalendarConnections.mock.calls.length
    serverForgets()
    await disconnect()
    expect(calendarApi.listCalendarConnections.mock.calls.length).toBeGreaterThan(readsBefore)
  })

  it('AC 3: the confirmed capacity row is not touched, and the week still reads from it', async () => {
    // An accepted figure is the member's own whatever produced it. The write
    // path this story owns can only delete calendar rows, so the assertion is
    // that a `calendar`-sourced override outlives the disconnect on screen —
    // and that nothing in App reached for the capacity writers.
    capacityApi.listCapacity.mockResolvedValue([
      { id: 'cap1', member_id: 'm1', period_start: week(), minutes: 90, source: 'calendar' },
    ])
    await renderApp('Who')
    serverForgets()
    await disconnect()
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 90 min')
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent(/set from calendar/i)
    expect(capacityApi.clearCapacity).not.toHaveBeenCalled()
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
  })

  it('AC 4: says so when Google could not confirm the revocation', async () => {
    calendarApi.disconnectCalendar.mockResolvedValue({ ok: true, memberId: 'm1', revoked: false })
    await renderApp('Who')
    serverForgets()
    await disconnect()
    // The sentence is `revokeNoteFor`'s, left REAL in this file's mock, so this
    // is the wording a member would actually read.
    expect(inRoster().getByTestId('calendar-note')).toHaveTextContent(/google may still list/i)
  })

  it('AC 4: says nothing when Google accepted it', async () => {
    await renderApp('Who')
    serverForgets()
    await disconnect()
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('AC 4: says nothing when there was no credential to revoke', async () => {
    // `null` is not `false`. A member who never had a grant outstanding must
    // not be told Google may still hold one.
    calendarApi.disconnectCalendar.mockResolvedValue({ ok: true, memberId: 'm1', revoked: null })
    await renderApp('Who')
    serverForgets()
    await disconnect()
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('a refused disconnect shows the function’s sentence and leaves the connection alone', async () => {
    calendarApi.disconnectCalendar.mockRejectedValue(
      new Error('Could not finish disconnecting that calendar. Part of it was removed.'),
    )
    await renderApp('Who')
    await disconnect()
    expect(screen.getByRole('alert')).toHaveTextContent(/Part of it was removed/)
    // Still connected, because the reads still say so — and still offering the
    // control, which is the repair the sentence asks for.
    expect(inRoster().getByText(/calendar connected/i)).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('clears the calendar complaint, which now describes a calendar the member does not have', async () => {
    // #99's review, test-vacuity: `setBusyFetchComplaint(null)` in
    // `handleDisconnectCalendar` was defended by nothing, because every other
    // case in this block mocks `fetchBusyWeek` resolved and a complaint can
    // only arise when it REJECTS. So the sentence a member is left looking at
    // is the thing to arrange first.
    //
    // The sentence itself is the Edge Function's own, read off the failure by
    // `fetchBusyWeek` — "no longer valid. Connect it again." under a row with
    // no calendar at all is true of nothing.
    calendarApi.listBusyWeeks.mockResolvedValue([])
    calendarApi.fetchBusyWeek.mockRejectedValue(
      new Error('That calendar connection is no longer valid. Connect it again.'),
    )
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/no longer valid/i),
    )

    serverForgets()
    await disconnect()

    expect(screen.queryByTestId('busy-complaint')).not.toBeInTheDocument()
  })

  it('lets a member connect again in the same session and still get a figure', async () => {
    // #96's trigger is once per (member, week) PER SESSION, and #98's refresh
    // keeps a second such set. Neither knew about a disconnect until this
    // story: without clearing them, re-connecting would find the key already
    // present, fetch nothing, and leave the member looking at a connected
    // calendar with no figure until they reloaded. Forgetting what was read
    // includes forgetting that it was asked for.
    calendarApi.listBusyWeeks.mockResolvedValue([])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))

    calendarApi.listCalendarConnections.mockResolvedValue([])
    await disconnect()
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)

    // The calendar comes back — a second consent, landing on the next read.
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(2))
  })
})

describe('applying the calendar suggestion to the week (#97)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const connection = { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' }
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  // 120 usual, 45 busy: a prefill of 75. Read NOW for #98's reason — a fixed
  // timestamp ages across the refresh bound and turns a row that EXISTS into
  // a fetch on a diff that touched nothing.
  const busyRow = () => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: 45,
    event_count: 3,
    computed_at: new Date().toISOString(),
  })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    calendarApi.listBusyWeeks.mockResolvedValue([busyRow()])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))
  const onTheRoster = async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
  }
  const useIt = () =>
    act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /use the calendar’s figure for placeholder one/i })),
    )
  const save = () => act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

  it('AC 1 / AC 2: the tap prefills 75 and writes nothing; Save writes ONCE with source calendar, re-assigns and re-reads', async () => {
    await onTheRoster()
    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await useIt()
    expect(screen.getByLabelText(/minutes this week for placeholder one/i)).toHaveValue(75)
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
    // A prefill is not a change: nothing re-reads after it.
    expect(capacityApi.listCapacity.mock.calls.length).toBe(readsBefore)

    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith({
      memberId: 'm1',
      periodStart: week(),
      minutes: '75',
      source: 'calendar',
      householdId: 'h1',
    })
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 2: a figure edited before Save goes through the same call as manual', async () => {
    await onTheRoster()
    await useIt()
    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value: '60' },
    })
    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', minutes: '60', source: 'manual' }),
    )
  })

  it('AC 6: after the re-read the roster shows the week as set from the calendar', async () => {
    await onTheRoster()
    await useIt()
    // What the server will hand back once the write lands — the re-read after
    // `mutate()` is what puts the provenance on screen, not the tap.
    capacityApi.listCapacity.mockResolvedValue([
      { id: 'o1', member_id: 'm1', period_start: week(), minutes: 75, note: null, source: 'calendar' },
    ])
    await save()
    await waitFor(() => expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 75 min'))
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent(/set from calendar/i)
  })

  it('the tap touches no calendar read — the figure is already on the device', async () => {
    // Taking the suggestion is arithmetic on a row already read. It must not
    // spend a Google call: #96 fetches when there is no row and #98 when the
    // row is stale, and this is neither.
    await onTheRoster()
    const fetches = calendarApi.fetchBusyWeek.mock.calls.length
    await useIt()
    await save()
    expect(calendarApi.fetchBusyWeek.mock.calls.length).toBe(fetches)
  })
})
