// App's tests for holding, switching, leaving and deleting households. Split
// out of `App.test.jsx` by #553; every describe below moved verbatim with the
// comment above it. The fakes, the `vi.mock` calls and the shared `beforeEach`
// are in `src/test/support/appHarness.jsx`, which must stay the FIRST import.
import { api, choresApi, capacityApi, reassignApi, announceApi, exclusionsApi, calendarApi, shoppingApi, SHOPPING_CLIENT, invitationsApi, renderApp, actualRealtime, HOUSEHOLD_ONE, HOUSEHOLD_TWO } from './test/support/appHarness.jsx'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

// ---------------------------------------------------------------------------
// #164 / #165 / #166 — more than one household on one device.
//
// The three stories ship together because each is only observable through the
// next: a switcher with nothing to switch to, a remembered choice with no way
// to make one, and a second household nobody can reach. Names are synthetic —
// see #19.
//
// EVERY assertion here is about a RE-READ, not about local state. #164 AC 2
// says so in as many words ("asserted as a re-read of the five data-layer
// calls, not as a local state change"), and it is the criterion the obvious
// implementation fails: filtering data this device already holds would put the
// right household on screen and show its chores as of whenever the app last
// looked.
// ---------------------------------------------------------------------------
describe('#164 — holding more than one household and moving between them', () => {
  // The person is `person-a`, and they are the ORGANIZER of the second
  // household and an ordinary member of the first. That asymmetry is AC 5's
  // subject: organizer controls must follow the household, not the person.
  const inOne = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-b' },
    { id: 'm2', display_name: 'Placeholder Everywhere', weekly_minutes: 60, claimed_by: 'person-a' },
  ]
  // TWO members, and the second one is load-bearing: self-removal is forbidden
  // (0007's `members_delete_same_household` carries `claimed_by is distinct
  // from auth.uid()`), so a household where the organizer is the only member
  // offers no Remove control at all — and AC 5's assertion would then be
  // reading the household size rather than who organises it.
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Everywhere', weekly_minutes: 90, claimed_by: 'person-a' },
    { id: 'm10', display_name: 'Placeholder Two', weekly_minutes: 30, claimed_by: null },
  ]

  /** Answer every scoped read according to which household was asked for. */
  const scopedByHousehold = () => {
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOUSEHOLD_TWO.id
        ? [{ id: 'c9', title: 'Placeholder Other Chore', expected_minutes: 15, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }]
        : [{ id: 'c1', title: 'Placeholder Chore', expected_minutes: 30, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }],
    )
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
    scopedByHousehold()
  })

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })
  const switchTo = async (id) =>
    act(async () => void fireEvent.change(switcher(), { target: { value: id } }))

  // AC 1 — the name becomes a control listing every household, in the
  // deterministic order. Asserted through App rather than only in the
  // component's own file, because what is on trial here is that App HANDS it
  // the whole list: a version passing `[household]` renders a control the
  // component test would still pass.
  it('AC 1: the shell names every household this person belongs to, in order', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(Array.from(switcher().options).map((o) => o.textContent)).toEqual([
      'Placeholder Household',
      'Placeholder Other Household',
    ])
  })

  // AC 3 — and it is asserted as the PREVIOUS story's element, not merely as
  // the absence of a control, so a version that rendered nothing at all would
  // fail. #163's screen has to be intact for everybody who has one household.
  it('AC 3: a person in exactly one household is offered no control, and sees #163 name', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    await renderApp()
    await screen.findByText('Placeholder Household')

    expect(screen.queryByRole('combobox', { name: 'Household' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell__household')).toHaveTextContent('Placeholder Household')
  })

  // AC 4 — no stored choice, so the app opens on the deterministic default the
  // owner chose: OLDEST by created_at. The fixture's second household is the
  // NEWER one, so a version defaulting to most-recently-joined fails here.
  it('AC 4: with no choice stored, the app opens on the oldest household', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(switcher()).toHaveValue(HOUSEHOLD_ONE.id)
    expect(api.listMembers).toHaveBeenCalledWith(HOUSEHOLD_ONE.id)
    expect(api.listMembers).not.toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 2 — THE criterion. Every scoped read runs again, against the newly
  // chosen household, and the five named in the story are asserted by the id
  // they were given rather than by a call count.
  it('AC 2: choosing another household RE-READS every surface against it', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    // The reads that have happened so far all name household one.
    expect(api.listMembers).not.toHaveBeenCalledWith(HOUSEHOLD_TWO.id)

    await switchTo(HOUSEHOLD_TWO.id)

    // The reads that take a HOUSEHOLD ID, each asked about the new one.
    expect(api.listMembers).toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
    expect(choresApi.listChores).toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
    expect(shoppingApi.readShopping).toHaveBeenCalledWith(SHOPPING_CLIENT, HOUSEHOLD_TWO.id)
    expect(calendarApi.listCalendarImports).toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
    // The reads that take the MEMBER SET rather than a household id (0025's
    // reasoning), asserted through the roster that scopes them. `listCapacity`
    // is here because an earlier version of this comment NAMED it among the
    // three and asserted only the other two — a comment vouching for an
    // assertion that did not exist, found by review-fanout. It is the read that
    // decides whose minutes the split is drawn from, so leaving it unasserted
    // while claiming it was covered is the worst of the three.
    expect(exclusionsApi.listExclusions).toHaveBeenLastCalledWith(inTwo.map((m) => m.id))
    expect(calendarApi.listCalendarConnections).toHaveBeenLastCalledWith(inTwo.map((m) => m.id))
    expect(capacityApi.listCapacity).toHaveBeenLastCalledWith(
      expect.anything(),
      inTwo.map((m) => m.id),
    )
    // STILL UNASSERTED, and said out loud rather than left to be assumed:
    // `listRepeatExceptions` (its scope is the ANCHOR ids out of the chores
    // just read, so it is covered transitively by `listChores` above) and
    // `listBusyWeeks`. Neither is claimed by this test. The PERIOD half of
    // `listCapacity` is also not discriminated here and cannot be with this
    // fixture: both households carry `America/New_York`, so a period computed
    // from the stale household is byte-identical — separating it needs two
    // timezones, which is a different test than this one.
  })

  it('AC 2: and it happens without a page reload or a sign-out', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    await switchTo(HOUSEHOLD_TWO.id)

    expect(api.signOut).not.toHaveBeenCalled()
    // Still the same mounted app: the switcher is the control it was, now
    // showing the other household.
    expect(switcher()).toHaveValue(HOUSEHOLD_TWO.id)
  })

  // AC 5 — `me` and `isOrganizer` resolve WITHIN the newly active household.
  // The fixture is built so the two answers differ: `person-a` organises
  // household two and merely belongs to household one, so a version that
  // resolved identity against the wrong household would show organizer
  // controls in the household they do not organise.
  it('AC 5: who you are and what you organise are recomputed in the new household', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

    // In household one they are an ordinary member: no Remove control, which
    // #152 gates on isOrganizer. Matched on the control's ACCESSIBLE name,
    // which #152 built as `Remove <member>` so that a row's control names the
    // person it acts on — a bare /^remove$/ matches nothing here and would have
    // passed this assertion for the wrong reason.
    expect(inRoster().queryByRole('button', { name: /^remove /i })).not.toBeInTheDocument()

    await switchTo(HOUSEHOLD_TWO.id)
    await screen.findByText('Placeholder Everywhere')

    // In household two they organise, so the organizer control appears.
    expect(inRoster().getAllByRole('button', { name: /^remove /i }).length).toBeGreaterThan(0)
  })

  // AC 6 — the surface is where they are, not what they are looking at.
  it('AC 6: somebody on the Chores surface stays there, showing the other household chores', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await switchTo(HOUSEHOLD_TWO.id)

    // Still the Chores surface…
    expect(screen.getByRole('button', { name: 'Chores' })).toHaveAttribute('aria-current', 'page')
    // …and it is the other household's chore list.
    expect(await screen.findByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
  })

  // AC 8's end-to-end half. The re-read is what this asserts, and the mutation
  // that removes it is recorded in the story comment.
  it('AC 8: switching is asserted end to end — the other household roster is on screen', async () => {
    await renderApp('Who')
    await screen.findByText('Placeholder One')

    await switchTo(HOUSEHOLD_TWO.id)

    expect(await screen.findByText('Placeholder Everywhere')).toBeInTheDocument()
    // Household one's other member is gone, which is the half that proves the
    // roster was replaced rather than added to.
    expect(screen.queryByText('Placeholder One')).not.toBeInTheDocument()
  })
})

describe('#165 — remembering which household was last chosen on this device', () => {
  const inOne = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Everywhere', weekly_minutes: 90, claimed_by: 'person-a' },
  ]

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
  })

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })

  // AC 1 — the whole point. `cleanup()` between the two renders is this suite's
  // way of closing and reopening the app: the component tree is destroyed, so
  // anything that survives did so through storage rather than through React.
  it('AC 1: the household chosen before the app closed is active when it reopens', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HOUSEHOLD_TWO.id } }),
    )
    expect(switcher()).toHaveValue(HOUSEHOLD_TWO.id)

    cleanup()
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(switcher()).toHaveValue(HOUSEHOLD_TWO.id)
    // And the reads on THIS load named it — the choice reached the data layer,
    // rather than only the control.
    expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 2 — a membership that has gone. The stored id names a household the
  // person no longer belongs to, so the read no longer returns it.
  it('AC 2: a stored household outside the membership set is discarded, silently', async () => {
    window.localStorage.setItem('taskr.activeHousehold', HOUSEHOLD_TWO.id)
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])

    await renderApp()
    await screen.findByText('Placeholder Household')

    // The deterministic default, and no error anywhere on screen.
    expect(api.listMembers).toHaveBeenCalledWith(HOUSEHOLD_ONE.id)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // DISCARDED, not merely ignored: the dead id is gone from storage, so it
    // is not re-rejected on every load for the life of the device.
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBeNull()
  })

  // AC 3 — a value that was never a household id at all.
  //
  // WHAT THIS TEST CANNOT SEPARATE, measured rather than assumed: mutating the
  // uuid pattern to accept everything leaves it GREEN. With the check gone the
  // junk reaches `resolveActiveHousehold`, is not in the membership set, and
  // falls back to the same default — then App's own discard clears the same
  // key. Two different mechanisms, one observable, and at this level there is
  // no fixture that tells them apart, because a value that is not a uuid can
  // never name a household either way. So this asserts the OUTCOME the
  // criterion asks for, and the shape check itself is discriminated in
  // `activeHousehold.test.js`, where the same mutation reddens 7. Said out loud
  // because a reader counting this as coverage of the check would be wrong.
  it('AC 3: a stored value that is not a uuid is discarded and the default is used', async () => {
    window.localStorage.setItem('taskr.activeHousehold', 'not-a-uuid')

    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(switcher()).toHaveValue(HOUSEHOLD_ONE.id)
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // AC 7 — a shared tablet must not select a household for the next person.
  it('AC 7: signing out forgets the household this device had chosen', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HOUSEHOLD_TWO.id } }),
    )
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(HOUSEHOLD_TWO.id)

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))

    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBeNull()
  })

  // AC 8 — private mode. The accessor itself throws, which is what a browser
  // set to block site data actually does; the app must render on the default
  // rather than failing to boot.
  it('AC 8: a device whose storage throws still opens, on the deterministic default', async () => {
    // A getter on the global, NOT a Proxy — measured: a Proxy's `get` trap does
    // not fire when `globalThis.localStorage` is read, so the proxy form left
    // the accessor guard unexecuted. `activeHousehold.test.js` carries the
    // measurement.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      await renderApp()
      await screen.findByRole('combobox', { name: 'Household' })

      expect(switcher()).toHaveValue(HOUSEHOLD_ONE.id)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      // And a switch still works — it just is not remembered.
      await act(
        async () => void fireEvent.change(switcher(), { target: { value: HOUSEHOLD_TWO.id } }),
      )
      expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete globalThis.localStorage
    }
  })
})

describe('#166 — starting another household without signing out', () => {
  const inOne = [
    { id: 'm1', display_name: 'Placeholder Everywhere', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Everywhere', weekly_minutes: 120, claimed_by: 'person-a' },
  ]

  const inCard = () => within(screen.getByRole('region', { name: /start another household/i }))

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOUSEHOLD_TWO.id
        ? [{ id: 'c9', title: 'Placeholder Other Chore', expected_minutes: 15, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }]
        : [{ id: 'c1', title: 'Placeholder Chore', expected_minutes: 30, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }],
    )
    // The write succeeds and the read that follows sees both households — the
    // ordinary shape of `mutate()`, and the reason the fixture cannot simply
    // return a static list.
    api.createHousehold.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
      return HOUSEHOLD_TWO
    })
  })

  const startAnother = async (name = 'Placeholder Other Household') => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /start another household/i })
    fireEvent.change(inCard().getByLabelText(/household name/i), { target: { value: name } })
    await act(
      async () => void fireEvent.click(inCard().getByRole('button', { name: 'Create household' })),
    )
  }

  // The hole the story exists to fill, stated as the state BEFORE the change:
  // `createHousehold` had one call site and it was behind onboarding.
  it('AC 1: a person already in a household is offered a way to start another', async () => {
    await renderApp('Who')
    expect(
      await screen.findByRole('region', { name: /start another household/i }),
    ).toBeInTheDocument()
  })

  it('AC 1: their own name is prefilled from the household they are already in', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /start another household/i })
    expect(inCard().getByLabelText(/your name in it/i)).toHaveValue('Placeholder Everywhere')
  })

  it('AC 1: creating one names it, with this person as its organizer', async () => {
    await startAnother()

    expect(api.createHousehold).toHaveBeenCalledTimes(1)
    expect(api.createHousehold).toHaveBeenCalledWith('Placeholder Other Household', {
      organizerName: 'Placeholder Everywhere',
    })
  })

  // AC 1's second half and the one the ordering makes easy to get wrong: the
  // new household sorts LAST by created_at, so the deterministic default would
  // take the person straight back to the household they started from.
  it('AC 1: and the new household becomes the active one', async () => {
    await startAnother()

    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
    expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 6 — the switcher now lists two, and the active one is the new one.
  it('AC 6: the switcher lists both households, with the new one active', async () => {
    await startAnother()

    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(Array.from(switcher.options).map((o) => o.textContent)).toEqual([
      'Placeholder Household',
      'Placeholder Other Household',
    ])
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
  })

  // AC 5 — a reload must not silently return them to the first household.
  it('AC 5: the stored choice is updated, so a reload does not go back', async () => {
    await startAnother()
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(HOUSEHOLD_TWO.id)

    cleanup()
    await renderApp()
    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
  })

  // AC 3 — the new household's surfaces show its data ALONE.
  it('AC 3: every surface shows the new household data, and not the first', async () => {
    await startAnother()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))

    expect(await screen.findByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
    expect(choresApi.listChores).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 4 — THE ROUND TRIP, and the criterion says why it is separate: "a
  // one-way test cannot tell scoping from a coincidence of ordering". A version
  // that showed the newest household's data for every read would pass AC 3 and
  // fail here.
  it('AC 4: switching back shows the first household data alone', async () => {
    await startAnother()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await screen.findByText('Placeholder Other Chore')

    await act(
      async () =>
        void fireEvent.change(screen.getByRole('combobox', { name: 'Household' }), {
          target: { value: HOUSEHOLD_ONE.id },
        }),
    )

    expect(await screen.findByText('Placeholder Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Other Chore')).not.toBeInTheDocument()
    expect(choresApi.listChores).toHaveBeenLastCalledWith(HOUSEHOLD_ONE.id)
  })

  // AC 7 — the existing onboarding path is untouched. A person in NO household
  // gets #154's screen, and the roster's card cannot be involved because there
  // is no roster.
  it('AC 7: somebody in no household still gets the onboarding path, unchanged', async () => {
    api.listHouseholds.mockResolvedValue([])
    await renderApp()

    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Start a household', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: /start another household/i }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: 'Create household' })),
    )

    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
  })
})

// ---------------------------------------------------------------------------
// The review-fanout fixes, each with the test that makes it fail to remove.
//
// The first mutation pass on these three fixes reddened ZERO. That was
// PREDICTED — none of the three is observable from a test that only asserts
// after a switch has settled — and a predicted zero is still a zero: three
// corrections would have shipped that nothing could hold in place. These are
// the arrangements that observe them.
// ---------------------------------------------------------------------------
describe('#164/#166 — the review fan-out’s three, held in place', () => {
  const HH_A = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm1',
    created_at: '2026-01-01T00:00:00Z',
    last_rebalance: {
      contested: true,
      level: true,
      reason: null,
      boundByBudget: false,
      jobsMoved: 1,
      minutesMoved: 90,
      changeBudgetMinutes: 120,
      applied_at: '2026-08-27T18:00:00+00:00',
    },
  }
  const HH_B = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Placeholder Other Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
    created_at: '2026-02-01T00:00:00Z',
    last_rebalance: null,
  }
  const inA = [
    { id: 'm1', household_id: HH_A.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', household_id: HH_A.id, display_name: 'Placeholder Two', weekly_minutes: 300, claimed_by: null },
  ]
  const inB = [
    { id: 'm9', household_id: HH_B.id, display_name: 'Placeholder Everywhere', weekly_minutes: 200, claimed_by: 'person-a' },
  ]
  const choresA = [
    { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
    { id: 'c2', title: 'Placeholder Other Chore', expected_minutes: 50, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
  ]

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })
  // The #342 block's helper, which is scoped to that describe. Redeclared here
  // rather than hoisted, because hoisting it would touch a block this story has
  // no business editing.
  const pause = (ms) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HH_A, HH_B])
    api.listMembers.mockImplementation(async (id) => (id === HH_B.id ? inB : inA))
    choresApi.listChores.mockImplementation(async (id) => (id === HH_B.id ? [] : choresA))
  })

  // FINDING 6 — the announcement belongs to the household that produced it.
  //
  // Without the clear, household A's re-balance statement stands over B's
  // surfaces, read against B's member names — and pressing "Got it" there
  // SPENDS it, because `writeSplitSeen` advanced A's marker in the refresh that
  // produced it, so `announcementFrom` can never derive it again.
  it('an announcement about the old household does not follow the switch', async () => {
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: {
        members: [
          { id: 'm1', minutes: 90, capacityMinutes: 420 },
          { id: 'm2', minutes: 50, capacityMinutes: 300 },
        ],
      },
      seen_rebalance_at: '2026-08-27T09:00:00+00:00',
    })
    await renderApp()
    // The precondition: it really is on screen before the switch. Without this
    // the assertion below passes on a page that never had one.
    await screen.findByTestId('rebalance-announcement')

    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HH_B.id } }),
    )

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
  })

  // FINDING 1/5 — the name and the data land together.
  //
  // `setHousehold` used to sit above the roster read, so a switch whose roster
  // read FAILS left household B's name on the shell over household A's people.
  // With the two paired, a failed roster read leaves the whole screen on A and
  // puts the reason on the error strip — one household, coherently, plus a
  // sentence saying what went wrong.
  it('a switch whose roster read fails leaves the shell on the household it can still show', async () => {
    await renderApp('Who')
    await screen.findByText('Placeholder One')

    api.listMembers.mockRejectedValueOnce(new Error('the network went away for a moment'))
    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HH_B.id } }),
    )

    // The name must not have moved ahead of the people underneath it.
    expect(switcher()).toHaveValue(HH_A.id)
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
    expect(await screen.findByText(/the network went away/i)).toBeInTheDocument()
  })

  // FINDING 2 — a read older than the choice may not overrule it.
  //
  // The arrangement is the whole test: hold a background read open at its FIRST
  // await, create a household while it is suspended, then release it. Its list
  // predates the new household, so without the epoch guard its discard branch
  // fires, clears the ref and wipes the stored choice — and #166 AC 1 and AC 5
  // are both defeated by a read that did nothing wrong except start earlier.
  it('a read that started before the new household cannot wipe the choice', async () => {
    const created = {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Mutant Household',
      timezone: 'America/New_York',
      organizer_member_id: 'm99',
      created_at: '2026-03-01T00:00:00Z',
      last_rebalance: null,
    }
    api.listMembers.mockImplementation(async (id) =>
      id === created.id
        ? [{ id: 'm99', household_id: created.id, display_name: 'Placeholder Everywhere', weekly_minutes: 0, claimed_by: 'person-a' }]
        : id === HH_B.id
          ? inB
          : inA,
    )
    api.createHousehold.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([HH_A, HH_B, created])
      return created
    })

    await renderApp('Who')
    await screen.findByRole('region', { name: /start another household/i })

    // Hold the NEXT households read open — this is the background read that
    // will come back holding a list from before the household exists.
    let release
    let started = false
    api.listHouseholds.mockImplementationOnce(() => {
      started = true
      return new Promise((resolve) => {
        release = () => resolve([HH_A, HH_B])
      })
    })
    // Start it, and leave it suspended. `attachVisibilityRefresh` DEBOUNCES by
    // REFRESH_DEBOUNCE_MS, so a focus event only SCHEDULES the read — without
    // waiting past the debounce the hanging mock is consumed by the create's
    // own re-read instead, which starts after the choice and is therefore
    // entitled to judge it. The arrangement is the test: the read has to have
    // begun before the choice for the epoch to mean anything.
    act(() => void window.dispatchEvent(new Event('focus')))
    await pause(actualRealtime.REFRESH_DEBOUNCE_MS * 2)
    // POSITIVE CONTROL: if this is false the background read never began and
    // everything below is asserting about a scenario that did not happen.
    expect(started).toBe(true)

    const card = within(screen.getByRole('region', { name: /start another household/i }))
    fireEvent.change(card.getByLabelText(/household name/i), { target: { value: 'Mutant Household' } })
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Create household' }))
    })

    // Now let the stale read finish, after the choice was made.
    await act(async () => {
      release?.()
    })

    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(created.id)
  })
})

// ---------------------------------------------------------------------------
// #430 — deleting and restoring a household, WIRED. Roster's and the banner's
// own tests prove each component; these prove App hands them the handlers that
// reach the data layer, with the household on screen. "Exported is not
// reachable" is this repo's recorded reason for the second half.
// ---------------------------------------------------------------------------
describe('deleting and restoring a household, from App (#430)', () => {
  const organized = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm1',
  }

  // Relative to now: the banner hides a household past its purge_after, so a
  // fixed date would turn these red on the day it passed.
  const DAY = 86_400_000
  const requestedAt = new Date(Date.now() - DAY).toISOString()
  const purgeAfter = new Date(Date.now() + 6 * DAY).toISOString()

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([organized])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])
  })

  it('the organizer deletes the household on screen, and the banner is re-read afterwards', async () => {
    const { GRACE_PERIOD_DAYS } = await vi.importActual('./lib/household.js')
    await renderApp('Who')
    const readsBefore = api.householdDeletionStatus.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^delete this household$/i })))
    // #430 review: the confirm says the real grace period, which reaches Roster
    // only through App's prop — the Roster suite deliberately uses another number.
    expect(screen.getByTestId('delete-household-warning')).toHaveTextContent(
      `restore it for ${GRACE_PERIOD_DAYS} days`,
    )
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: /^delete placeholder household\?$/i })),
    )
    expect(api.requestHouseholdDeletion).toHaveBeenCalledWith('h1')
    expect(api.householdDeletionStatus.mock.calls.length).toBeGreaterThan(readsBefore)
  })

  it('shows a pending household above the tabs at boot, and restores the one it names', async () => {
    api.householdDeletionStatus.mockResolvedValue([
      {
        household_id: 'h9',
        household_name: 'Placeholder Household',
        deletion_requested_at: requestedAt,
        purge_after: purgeAfter,
      },
    ])
    await renderApp()
    expect(screen.getByRole('region', { name: /scheduled for deletion/i })).toBeInTheDocument()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^restore/i })))
    expect(api.restoreHousehold).toHaveBeenCalledWith('h9')
  })

  it('shows the banner on the onboarding screen too, where deleting your only household lands you', async () => {
    api.listHouseholds.mockResolvedValue([])
    api.householdDeletionStatus.mockResolvedValue([
      {
        household_id: 'h9',
        household_name: 'Placeholder Household',
        deletion_requested_at: requestedAt,
        purge_after: purgeAfter,
      },
    ])
    await renderApp()
    expect(screen.getByRole('region', { name: /scheduled for deletion/i })).toBeInTheDocument()
  })

  it('still boots when the status read answers nothing at all, not only when it rejects', async () => {
    // The hardening's own test: a plain `.catch` covers a rejection and not a
    // read that returns no promise or no list, which is what took every boot
    // down in this story's first run (the mock reset left it answering undefined).
    api.householdDeletionStatus.mockReturnValue(undefined)
    await renderApp('Who')
    expect(screen.queryByRole('region', { name: /scheduled for deletion/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^delete this household$/i })).toBeInTheDocument()
  })

  it('still boots when the status read fails, because it must never keep anybody out', async () => {
    api.householdDeletionStatus.mockRejectedValue(new Error('status read failed'))
    await renderApp('Who')
    expect(screen.queryByRole('region', { name: /scheduled for deletion/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^delete this household$/i })).toBeInTheDocument()
  })

  it('clears the restore banner at sign-out, so the next person on this device never sees it', async () => {
    // #430 review, and the shared-tablet rule of #165 AC 7 / #172 / #173: the
    // banner names the last person's household and the day it goes.
    api.householdDeletionStatus.mockResolvedValue([
      {
        household_id: 'h9',
        household_name: 'Placeholder Household',
        deletion_requested_at: requestedAt,
        purge_after: purgeAfter,
      },
    ])
    await renderApp('Who')
    expect(screen.getByRole('region', { name: /scheduled for deletion/i })).toBeInTheDocument()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(api.signOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: /scheduled for deletion/i })).toBeNull()
  })

  it('reads the restore banner again after a sign-in, since it belongs to whoever is signed in', async () => {
    // The fake sign-in flips the fixtures the way a real one flips the
    // server's answers: signed out, nobody's banner; signed in, theirs.
    api.currentSession.mockResolvedValue(null)
    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.householdDeletionStatus.mockResolvedValue([
        {
          household_id: 'h9',
          household_name: 'Placeholder Household',
          deletion_requested_at: requestedAt,
          purge_after: purgeAfter,
        },
      ])
      return { user: { id: 'person-a' } }
    })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(screen.queryByRole('region', { name: /scheduled for deletion/i })).toBeNull()

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign in$/i })))

    expect(await screen.findByRole('region', { name: /scheduled for deletion/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #181 — closing a household nobody is left in, from App. #430 delivered the
// route (the last member is the organizer, and their way out is Delete); these
// pin where the person LANDS, which is #181 AC 1 and AC 8. `mutate` re-reads
// the list after the request and the shell follows it — asserted here as a
// re-read, since a version that merely dropped the household from local state
// would put the right thing on screen and read stale rows under it.
// ---------------------------------------------------------------------------
describe('closing the household you are the last one in, from App (#181)', () => {
  const closing = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm1',
    created_at: '2026-01-01T00:00:00Z',
  }
  const other = {
    id: 'h2',
    name: 'Placeholder Other Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
    created_at: '2026-02-01T00:00:00Z',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' }
  const inOther = [
    { id: 'm9', display_name: 'Placeholder Other Organizer', weekly_minutes: 60, claimed_by: 'person-z' },
    { id: 'm2', display_name: 'Placeholder One', weekly_minutes: 30, claimed_by: 'person-a' },
  ]

  const close = async () => {
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^delete this household$/i })))
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: /^delete placeholder household\?$/i })),
    )
  }

  it('AC 1 — the last member closes their only household and lands signed in with no household', async () => {
    api.listHouseholds.mockResolvedValue([closing])
    api.listMembers.mockResolvedValue([me])
    // The server's answer changes with the request, the way 0042's membership
    // filter changes it: the re-read that follows finds nothing.
    api.requestHouseholdDeletion.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([])
      return {}
    })
    await renderApp('Who')
    await close()
    expect(api.requestHouseholdDeletion).toHaveBeenCalledWith('h1')
    await screen.findByRole('button', { name: /create household/i })
    expect(screen.getByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Who' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
  })

  it('AC 8 — closing one of two households puts the other on screen and re-reads against it', async () => {
    api.listHouseholds.mockResolvedValue([closing, other])
    api.listMembers.mockImplementation(async (id) => (id === 'h2' ? inOther : [me]))
    api.requestHouseholdDeletion.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([other])
      return {}
    })
    await renderApp('Who')
    expect(screen.getByRole('combobox', { name: 'Household' })).toHaveValue('h1')
    expect(api.listMembers).not.toHaveBeenCalledWith('h2')

    await close()

    expect(api.requestHouseholdDeletion).toHaveBeenCalledWith('h1')
    // One household left, so #163's name and no switcher (#164 AC 3).
    expect(screen.queryByRole('combobox', { name: 'Household' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell__household')).toHaveTextContent('Placeholder Other Household')
    expect(api.listMembers).toHaveBeenCalledWith('h2')
    // A plain member there, so the organizer's Delete card is gone with the
    // household it belonged to (#164 AC 5: controls follow the household).
    expect(screen.queryByRole('button', { name: /^delete this household$/i })).not.toBeInTheDocument()
  })
})

describe('leaving a household, from App (#431)', () => {
  // The signed-in person is person-a (the suite's default session), on the
  // roster as m1; m9 organizes, so m1 is an ordinary member.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' }
  const organizerRow = { id: 'm9', display_name: 'Placeholder Organizer', weekly_minutes: 60, claimed_by: 'person-z' }
  const signedInOther = { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'person-b' }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([organizerRow, me])
  })

  const leave = async () => {
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^leave this household$/i })))
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: /^leave placeholder household\?$/i })),
    )
  }
  const callOrder = (mock, match) => mock.mock.invocationCallOrder[mock.mock.calls.findIndex(match)]

  it('re-deals the chores without the leaver FIRST, then leaves through the function', async () => {
    await renderApp('Who')
    await leave()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1', leavingMemberId: 'm1' })
    expect(api.leaveHousehold).toHaveBeenCalledWith('h1')
    const redeal = callOrder(reassignApi.reassignHousehold, ([args]) => args?.leavingMemberId === 'm1')
    const left = callOrder(api.leaveHousehold, () => true)
    expect(redeal).toBeLessThan(left)
  })

  it('leaves nothing when the re-deal fails: nothing has changed, and they can try again', async () => {
    reassignApi.reassignHousehold.mockRejectedValue(new Error('re-deal refused'))
    await renderApp('Who')
    await leave()
    expect(api.leaveHousehold).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/re-deal refused/)
  })

  it('shows a sign-in that survived as a warning, because they HAVE left', async () => {
    api.leaveHousehold.mockResolvedValue({
      accountDeleted: false,
      warning: 'You have left the household, but your sign-in was not deleted. It can still sign in until it is.',
    })
    await renderApp('Who')
    await leave()
    expect(await screen.findByText(/your sign-in was not deleted/i)).toBeInTheDocument()
  })

  it('signs this device out when the leave took their last household, and the sign-in with it', async () => {
    api.leaveHousehold.mockResolvedValue({ accountDeleted: true, warning: null })
    await renderApp('Who')
    await leave()
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
  })

  it('does not sign out when the sign-in is kept for another household', async () => {
    await renderApp('Who')
    await leave()
    expect(api.leaveHousehold).toHaveBeenCalledTimes(1)
    expect(api.signOut).not.toHaveBeenCalled()
  })

  it('the organizer hands it over and leaves the same way: transfer, then the re-deal without them, then the leave', async () => {
    api.listHouseholds.mockResolvedValue([{ ...household, organizer_member_id: 'm1' }])
    api.listMembers.mockResolvedValue([me, signedInOther])
    await renderApp('Who')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^leave this household$/i })))
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: /^hand it to placeholder two and leave$/i })),
    )
    expect(api.transferHousehold).toHaveBeenCalledWith('h1', 'm2')
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1', leavingMemberId: 'm1' })
    expect(api.leaveHousehold).toHaveBeenCalledWith('h1')
    const handed = callOrder(api.transferHousehold, () => true)
    const redeal = callOrder(reassignApi.reassignHousehold, ([args]) => args?.leavingMemberId === 'm1')
    const left = callOrder(api.leaveHousehold, () => true)
    expect(handed).toBeLessThan(redeal)
    expect(redeal).toBeLessThan(left)
  })

  it('re-deals after the organizer removes somebody (AC 4), which nothing did before', async () => {
    api.listHouseholds.mockResolvedValue([{ ...household, organizer_member_id: 'm1' }])
    api.listMembers.mockResolvedValue([me, { ...signedInOther, claimed_by: null }])
    api.removeMember.mockResolvedValue({ warning: null })
    await renderApp('Who')
    const before = reassignApi.reassignHousehold.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^Remove Placeholder Two$/ })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Remove Placeholder Two\?/ })))
    expect(api.removeMember).toHaveBeenCalledWith('m2')
    expect(reassignApi.reassignHousehold.mock.calls.slice(before)).toEqual([[{ householdId: 'h1' }]])
    const removed = callOrder(api.removeMember, () => true)
    expect(removed).toBeLessThan(reassignApi.reassignHousehold.mock.invocationCallOrder.at(-1))
  })

  // The four below are #431's review-fanout (2026-09-11).
  it('reports a removal as done when only its re-deal fails, and keeps the sign-in warning (#247)', async () => {
    api.listHouseholds.mockResolvedValue([{ ...household, organizer_member_id: 'm1' }])
    api.listMembers.mockResolvedValue([me, { ...signedInOther, claimed_by: null }])
    api.removeMember.mockResolvedValue({ warning: 'Their sign-in was not deleted.' })
    reassignApi.reassignHousehold.mockRejectedValue(new Error('re-deal refused'))
    await renderApp('Who')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^Remove Placeholder Two$/ })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Remove Placeholder Two\?/ })))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/sign-in was not deleted/)
    expect(alert).toHaveTextContent(/They were removed, but their chores were not dealt to the others: re-deal refused/)
    expect(api.removeMember).toHaveBeenCalledTimes(1)
  })

  it('says the chores already went when the leave fails after the re-deal, and re-reads', async () => {
    api.leaveHousehold.mockRejectedValue(new Error('Could not reach the leave service, so you are still in the household.'))
    await renderApp('Who')
    const readsBefore = api.listMembers.mock.calls.length
    await leave()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/your open chores went to the others, but you have not left yet/i)
    expect(alert).not.toHaveTextContent(/nothing was changed/i)
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(readsBefore)
  })

  it('tells the leaver when Google did not confirm the revoke, signed out or not (#99)', async () => {
    api.leaveHousehold.mockResolvedValue({ accountDeleted: true, warning: null, revokeFailed: true })
    await renderApp('Who')
    await leave()
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    expect(await screen.findByText(/Google may still list Taskr/)).toBeInTheDocument()
  })

  it('says nothing about Google when the revoke went through', async () => {
    await renderApp('Who')
    await leave()
    expect(api.leaveHousehold).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Google may still list Taskr/)).toBeNull()
  })
})

describe('deleting your own account, from App (#432)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' }
  const organizerRow = { id: 'm9', display_name: 'Placeholder Organizer', weekly_minutes: 60, claimed_by: 'person-z' }

  /** Signed in, in no household: the one screen where the delete happens. */
  async function renderNoHousehold() {
    api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
    api.listHouseholds.mockResolvedValue([])
    api.currentUserId.mockResolvedValue('person-a')
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })
  }
  const deleteAccount = async () => {
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^delete my account$/i })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^delete my account\?$/i })))
  }

  it('from inside a household, routes into Leave and deletes nothing itself', async () => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([organizerRow, me])
    await renderApp('Who')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^delete my account$/i })))
    expect(screen.getByTestId('delete-account-note')).toHaveTextContent(/leave placeholder household first/i)
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^leave this household first$/i })))
    expect(screen.getByRole('button', { name: /^leave placeholder household\?$/i })).toBeInTheDocument()
    expect(api.deleteAccount).not.toHaveBeenCalled()
    expect(api.leaveHousehold).not.toHaveBeenCalled()
    expect(api.signOut).not.toHaveBeenCalled()
  })

  it('from the no-household screen, deletes through the function and then signs this device out', async () => {
    await renderNoHousehold()
    await deleteAccount()
    expect(api.deleteAccount).toHaveBeenCalledTimes(1)
    expect(api.deleteAccount.mock.calls[0]).toEqual([])
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    // Delete first, sign-out second: the other order would leave a sign-in
    // nobody is holding a session for.
    expect(api.deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(api.signOut.mock.invocationCallOrder[0])
  })

  it('tells them when Google did not confirm the revoke, on the screen they land on (#99)', async () => {
    api.deleteAccount.mockResolvedValue({ deleted: true, revokeFailed: true })
    await renderNoHousehold()
    await deleteAccount()
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    expect(await screen.findByText(/Google may still list Taskr/)).toBeInTheDocument()
  })

  it("shows the function's refusal and keeps the session: nothing was deleted", async () => {
    api.deleteAccount.mockRejectedValue(new Error('You are still in a household. Leave it first.'))
    await renderNoHousehold()
    await deleteAccount()
    expect(await screen.findByRole('alert')).toHaveTextContent(/still in a household/i)
    expect(api.signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^delete my account$/i })).toBeInTheDocument()
  })
})

describe('leaving one of two households, from App (#180 AC 8)', () => {
  // Real-shaped ids, because the remembered choice (#165) discards anything
  // else as it is read. person-a is an ordinary member of both households.
  const LEFT = {
    id: '18018018-0180-4180-8180-180180180180',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
  }
  const KEPT = {
    id: '18018018-0180-4180-8180-180180180181',
    name: 'Placeholder Other Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm8',
  }
  const here = [
    { id: 'm9', display_name: 'Placeholder Organizer', weekly_minutes: 60, claimed_by: 'person-z' },
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const there = [
    { id: 'm8', display_name: 'Placeholder Other Organizer', weekly_minutes: 60, claimed_by: 'person-y' },
    { id: 'm7', display_name: 'Placeholder One', weekly_minutes: 30, claimed_by: 'person-a' },
  ]
  const KEY = 'taskr.activeHousehold'

  beforeEach(() => {
    // KEPT first, so the deterministic default is NOT the household being
    // left: the combobox reading LEFT below then proves the remembered choice
    // was read (review-fanout, 2026-09-16 — with LEFT first the guard could
    // not tell the seed from the default).
    api.listHouseholds.mockResolvedValue([KEPT, LEFT])
    api.listMembers.mockImplementation(async (id) => (id === KEPT.id ? there : here))
    // #165 — this device had chosen the household about to be left.
    window.localStorage.setItem(KEY, LEFT.id)
  })

  const leave = async () => {
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^leave this household$/i })))
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: /^leave placeholder household\?$/i })),
    )
  }

  it('forgets the remembered choice of the household just left, even while the list still names it', async () => {
    // The list is held still on purpose. App's refresh discards a remembered
    // household only once the read stops returning it (#165 AC 2), so here the
    // leave's own clear is the only thing that can empty the key — which is
    // what lets this test tell the two apart (PR #435 recorded the gap).
    await renderApp('Who')
    expect(screen.getByRole('combobox', { name: 'Household' })).toHaveValue(LEFT.id)
    // Still remembered on the way in, so the null below is the leave's doing
    // and not a load-time discard's.
    expect(window.localStorage.getItem(KEY)).toBe(LEFT.id)
    await leave()
    expect(api.leaveHousehold).toHaveBeenCalledWith(LEFT.id)
    expect(api.signOut).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('lands on the other household once the re-read stops returning the one left, with no error and no stored choice', async () => {
    api.leaveHousehold.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([KEPT])
      return { accountDeleted: false, warning: null, revokeFailed: false }
    })
    await renderApp('Who')
    await leave()
    expect((await screen.findAllByText('Placeholder Other Household')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('combobox', { name: 'Household' })).toBeNull()
    expect(api.listMembers).toHaveBeenLastCalledWith(KEPT.id)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})

describe('handing the organizer role over and staying, from App (#179)', () => {
  // person-a (the suite's default session) is m1 and organizes; m2 has signed
  // in, so the row carries the control. Nobody leaves here — that is #431's
  // hand-over, one card down.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm1',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' }
  const signedInOther = { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'person-b' }
  const makeOrganizer = () => screen.queryByRole('button', { name: /^make placeholder two the organizer$/i })
  const removeOther = () => screen.queryByRole('button', { name: /^remove placeholder two$/i })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, signedInOther])
  })

  it('AC 2 — hands the household over through the RPC, and the organizer controls leave this screen on the re-read', async () => {
    // The transfer lands on the server, so the re-read App makes after the
    // write comes back with the new organizer — the way the live project
    // answers it.
    api.transferHousehold.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([{ ...household, organizer_member_id: 'm2' }])
      return { ...household, organizer_member_id: 'm2' }
    })
    await renderApp('Who')
    expect(makeOrganizer()).toBeInTheDocument()
    expect(removeOther()).toBeInTheDocument()
    await act(async () => void fireEvent.click(makeOrganizer()))
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: /^make placeholder two the organizer\?$/i })),
    )
    expect(api.transferHousehold).toHaveBeenCalledWith('h1', 'm2')
    expect(api.transferHousehold).toHaveBeenCalledTimes(1)
    // Stays: no leave, and this person is still on the roster.
    expect(api.leaveHousehold).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
    // The previous organizer no longer holds the organizer controls.
    expect(makeOrganizer()).toBeNull()
    expect(removeOther()).toBeNull()
  })

  it('AC 2 — the new organizer sees the organizer controls on their next load', async () => {
    // The same device, loading a household the server now says it organizes:
    // `isOrganizer` is derived at render from `organizer_member_id`, so a load
    // is all it takes. The load above, where m2 organized, is the other side.
    api.listHouseholds.mockResolvedValue([{ ...household, organizer_member_id: 'm2' }])
    await renderApp('Who')
    expect(makeOrganizer()).toBeNull()
    expect(removeOther()).toBeNull()
    expect(screen.queryByRole('button', { name: /^make placeholder one the organizer$/i })).toBeNull()
  })

  it('hands nothing over on the first tap, and Not now backs out', async () => {
    await renderApp('Who')
    await act(async () => void fireEvent.click(makeOrganizer()))
    expect(api.transferHousehold).not.toHaveBeenCalled()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^not now$/i })))
    expect(api.transferHousehold).not.toHaveBeenCalled()
    expect(makeOrganizer()).toBeInTheDocument()
  })

  it('puts a refused hand-over on screen and keeps the organizer where they were', async () => {
    api.transferHousehold.mockRejectedValue(new Error('hand the household to somebody who has signed in'))
    await renderApp('Who')
    await act(async () => void fireEvent.click(makeOrganizer()))
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: /^make placeholder two the organizer\?$/i })),
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/somebody who has signed in/)
    expect(makeOrganizer()).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #478 — a household switch never leaves an empty page.
//
// The mechanism was MEASURED on the owner's account on production (2026-09-17,
// recorded on the issue): `refresh()` landed household B's roster a round trip
// before B's chores, Split handed `allocate()` B's members with A's chores,
// `place()` threw on a chore held by somebody outside that roster, and with no
// error boundary React unmounted the whole app. These tests hold the two
// fixes — everything lands in one render, and a render throw costs a surface
// rather than the page — plus the criteria written before the mechanism was
// known.
// ---------------------------------------------------------------------------
describe('#478 — switching households never leaves an empty page', () => {
  // UUIDs, not the readable ids other describes use: the stored choice is
  // written only for a uuid (`writeActiveHouseholdChoice`), and the failed-
  // switch test below reads it back.
  const HOME = { id: '4780a000-0000-4000-8000-00000000000a', name: 'Placeholder Household', organizer_member_id: 'm-a1', timezone: 'America/New_York' }
  const AWAY = { id: '4780b000-0000-4000-8000-00000000000b', name: 'Placeholder Other Household', organizer_member_id: 'm-b1', timezone: 'America/New_York' }
  const STORED_CHOICE = 'taskr.activeHousehold'
  const invitationRow = (id) => ({
    id,
    household_id: HOME.id,
    created_by_member_id: 'm-a1',
    created_at: '2026-09-10T19:04:00.000Z',
    expires_at: '2099-09-17T19:04:00.000Z',
    withdrawn_at: null,
    redeemed_at: null,
    redeemed_by_member_id: null,
  })
  const rosterHome = [
    { id: 'm-a1', household_id: HOME.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm-a2', household_id: HOME.id, display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' },
  ]
  const rosterAway = [
    { id: 'm-b2', household_id: AWAY.id, display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm-b1', household_id: AWAY.id, display_name: 'Placeholder Other Organizer', weekly_minutes: 200, claimed_by: 'person-b' },
  ]
  // A chore DONE THIS WEEK and held by a member who exists only in HOME — the
  // shape of the owner's chore `7875e977` (done, held by `992be3b7`). Done
  // matters: Split's reachability probe frees outstanding work and pins only
  // done work to its holder, so only a done chore reaches `place()`'s refusal
  // when it is paired with AWAY's roster. Written first as an OUTSTANDING
  // chore, the measured-mechanism test below passed with the fix reverted.
  const chore = (id, householdId, holder) => ({
    id,
    household_id: householdId,
    title: 'Placeholder Chore',
    expected_minutes: 30,
    due_on: '2026-09-18',
    created_at: '2026-09-10T00:00:00Z',
    completed_at: new Date().toISOString(),
    completed_by_member_id: holder,
    missed_at: null,
    assigned_member_id: holder,
    assigned_source: 'manual',
    repeat_kind: 'none',
    actual_minutes: 30,
    source: 'manual',
  })
  const choresHome = [chore('c-home', HOME.id, 'm-a2')]
  const choresAway = [chore('c-away', AWAY.id, 'm-b1')]

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })
  const tabs = () => screen.queryByRole('navigation', { name: 'Household surfaces' })
  const switchTo = async (id) =>
    act(async () => void fireEvent.change(switcher(), { target: { value: id } }))

  /** A promise the test resolves or rejects by hand. */
  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOME, AWAY])
    api.listMembers.mockImplementation(async (id) => (id === HOME.id ? rosterHome : id === AWAY.id ? rosterAway : []))
    choresApi.listChores.mockImplementation(async (id) => (id === HOME.id ? choresHome : id === AWAY.id ? choresAway : []))
  })

  it('MEASURED MECHANISM: while the new household’s chores are in flight, the page shows the old household whole, never the new roster beside the old chores', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    expect(switcher()).toHaveValue(HOME.id)

    const held = deferred()
    choresApi.listChores.mockImplementation((id) => (id === AWAY.id ? held.promise : Promise.resolve(choresHome)))
    await switchTo(AWAY.id)
    // The roster read for AWAY has answered; its chores have not. Under the
    // measured code the roster landed here and Split threw.
    await waitFor(() => expect(api.listMembers).toHaveBeenLastCalledWith(AWAY.id))
    await act(async () => {})
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
    expect(tabs()).toBeInTheDocument()
    // Still the household that was on screen: nothing of AWAY has landed.
    expect(switcher()).toHaveValue(HOME.id)

    await act(async () => held.resolve(choresAway))
    await waitFor(() => expect(switcher()).toHaveValue(AWAY.id))
    expect(tabs()).toBeInTheDocument()
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
  })

  it('MEASURED MECHANISM, the other way round: a LATER read in flight lands nothing either, so the new chores never sit beside the old roster', async () => {
    // The first test holds the chores read, so it cannot see chores landing
    // early. This holds the exclusions read, which comes after the chores:
    // if the chores landed on their own, HOME's roster would sit beside
    // AWAY's done chore held by `m-b1`, and Split would throw.
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    const held = deferred()
    exclusionsApi.listExclusions.mockImplementation((ids) =>
      ids.includes('m-b1') ? held.promise : Promise.resolve([]),
    )
    await switchTo(AWAY.id)
    await waitFor(() => expect(choresApi.listChores).toHaveBeenLastCalledWith(AWAY.id))
    await act(async () => {})
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
    expect(tabs()).toBeInTheDocument()
    expect(switcher()).toHaveValue(HOME.id)
    await act(async () => held.resolve([]))
    await waitFor(() => expect(switcher()).toHaveValue(AWAY.id))
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
  })

  it('AC 4: mid-switch on the Split view, the tab strip and the switcher stay on screen, disabled, on the household still shown', async () => {
    // On Split, where the measured throw happens — review-fanout found the
    // first draft of this test ran on Chores, where nothing can throw, and
    // asserted only what `busy` already guaranteed before the fix.
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    const held = deferred()
    choresApi.listChores.mockImplementation((id) => (id === AWAY.id ? held.promise : Promise.resolve(choresHome)))
    await switchTo(AWAY.id)
    await waitFor(() => expect(api.listMembers).toHaveBeenLastCalledWith(AWAY.id))
    await act(async () => {})
    expect(tabs()).toBeInTheDocument()
    expect(switcher()).toBeDisabled()
    expect(switcher()).toHaveValue(HOME.id)
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-current', 'page')
    await act(async () => held.resolve(choresAway))
    await waitFor(() => expect(switcher()).not.toBeDisabled())
    expect(switcher()).toHaveValue(AWAY.id)
  })

  it('a failed switch puts the choice back: the stored choice and the next read follow the household on screen', async () => {
    // review-fanout, 2026-09-17: the read landed nothing, HOME stayed on
    // screen, and the remembered choice still said AWAY — so the next
    // background read swapped to AWAY with nobody asking.
    await renderApp('Who')
    await screen.findByRole('combobox', { name: 'Household' })
    choresApi.listChores.mockImplementation((id) =>
      id === AWAY.id ? Promise.reject(new Error('loading the chores: placeholder refusal')) : Promise.resolve(choresHome),
    )
    await switchTo(AWAY.id)
    expect(await screen.findByText(/placeholder refusal/)).toBeInTheDocument()
    expect(switcher()).toHaveValue(HOME.id)
    expect(window.localStorage.getItem(STORED_CHOICE)).toBe(HOME.id)

    // The next read — the roster's own Refresh here, a focus or an echo in
    // life — reads HOME, not the household that failed.
    choresApi.listChores.mockImplementation(async (id) => (id === HOME.id ? choresHome : choresAway))
    const readsBefore = api.listMembers.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^refresh$/i })))
    await waitFor(() => expect(api.listMembers.mock.calls.length).toBeGreaterThan(readsBefore))
    expect(api.listMembers).toHaveBeenLastCalledWith(HOME.id)
    expect(switcher()).toHaveValue(HOME.id)
  })

  it('a switch in flight leaves the household on screen whole: its invitations stay until the new household lands', async () => {
    // review-fanout, 2026-09-17: the choice cleared HOME's list at once,
    // and with the landing deferred HOME's organizer card read as though
    // its codes had been withdrawn for the whole switch.
    invitationsApi.listInvitations.mockImplementation(async (id) => (id === HOME.id ? [invitationRow('inv-478')] : []))
    await renderApp('Who')
    expect(await screen.findByTestId('invitation-inv-478')).toBeInTheDocument()
    const held = deferred()
    choresApi.listChores.mockImplementation((id) => (id === AWAY.id ? held.promise : Promise.resolve(choresHome)))
    await switchTo(AWAY.id)
    await waitFor(() => expect(api.listMembers).toHaveBeenLastCalledWith(AWAY.id))
    await act(async () => {})
    expect(screen.getByTestId('invitation-inv-478')).toBeInTheDocument()
    // And when AWAY lands, HOME's code goes with HOME.
    await act(async () => held.resolve(choresAway))
    await waitFor(() => expect(switcher()).toHaveValue(AWAY.id))
    expect(screen.queryByTestId('invitation-inv-478')).not.toBeInTheDocument()
  })

  it('AC 2: a chores read that rejects mid-switch keeps the shell and the household that was showing, with the error visible once, beside the surface', async () => {
    await renderApp('Chores')
    await screen.findByRole('combobox', { name: 'Household' })
    choresApi.listChores.mockImplementation((id) =>
      id === AWAY.id ? Promise.reject(new Error('loading the chores: placeholder refusal')) : Promise.resolve(choresHome),
    )
    await switchTo(AWAY.id)
    expect(await screen.findByText(/placeholder refusal/)).toBeInTheDocument()
    expect(tabs()).toBeInTheDocument()
    expect(switcher()).toHaveValue(HOME.id)
    // The surface is up, so it says it; the shell's strip does not repeat it
    // (owner decision 2026-09-17: the strip is for when no surface is up).
    expect(screen.queryByTestId('shell-error')).not.toBeInTheDocument()
    expect(screen.getAllByText(/placeholder refusal/)).toHaveLength(1)
  })

  it('AC 2 / AC 6: with no surface up to say it, a read that rejects is shown in the shell’s own strip — and removing the strip reddens this', async () => {
    const restore = quietRenderErrors()
    onTestFinished(restore)
    // HOME's Split has failed (the render-failure card is up), so no surface
    // draws `error`. A switch whose chores read rejects lands nothing, HOME's
    // failed Split stays keyed as it was, and the only place the refusal can
    // appear is the strip.
    choresApi.listChores.mockImplementation((id) =>
      id === HOME.id
        ? Promise.resolve([chore('c-orphan', HOME.id, 'm-nobody')])
        : Promise.reject(new Error('loading the chores: placeholder refusal')),
    )
    await renderApp()
    const failure = await screen.findByTestId('render-failure')
    await switchTo(AWAY.id)
    const strip = await screen.findByTestId('shell-error')
    expect(strip).toHaveTextContent('placeholder refusal')
    expect(strip).toHaveAttribute('role', 'alert')
    expect(failure).not.toContainElement(strip)
    expect(tabs()).toBeInTheDocument()
    expect(switcher()).toHaveValue(HOME.id)
  })

  it('AC 2: an invitations read that rejects after the household landed keeps the new household on screen, with the error visible', async () => {
    // person-a organises neither fixture household here, so make them AWAY's
    // organizer: the invitations read happens only for the organizer.
    api.listHouseholds.mockResolvedValue([HOME, { ...AWAY, organizer_member_id: 'm-b2' }])
    invitationsApi.listInvitations.mockImplementation((id) =>
      id === AWAY.id ? Promise.reject(new Error('loading the invitations: placeholder refusal')) : Promise.resolve([]),
    )
    await renderApp('Who')
    await screen.findByRole('combobox', { name: 'Household' })
    await switchTo(AWAY.id)
    expect(await screen.findByText(/placeholder refusal/)).toBeInTheDocument()
    expect(invitationsApi.listInvitations).toHaveBeenCalledWith(AWAY.id)
    expect(tabs()).toBeInTheDocument()
    expect(switcher()).toHaveValue(AWAY.id)
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
  })

  it('AC 3: a switch whose household read comes back empty leaves the joined state for the household form, never an empty shell', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    api.listHouseholds.mockResolvedValue([])
    await switchTo(AWAY.id)
    await waitFor(() => expect(tabs()).not.toBeInTheDocument())
    expect(screen.getByRole('region', { name: /start a household/i })).toBeInTheDocument()
  })

  // The three tests below throw during render ON PURPOSE. React and jsdom both
  // report a caught render error on the console; silenced here so the run
  // output carries only what is unexpected.
  const quietRenderErrors = () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    return () => spy.mockRestore()
  }

  it('AC 6: a surface that throws while rendering costs only that surface — the shell and the tabs stay, with the reason and a Reload', async () => {
    const restore = quietRenderErrors()
    onTestFinished(restore)
    // A done chore held by somebody in NO roster, in the same read: `place()`
    // refuses it on an ordinary load. Remove the surface boundary and the
    // root one catches it instead — with no tabs and a different heading.
    choresApi.listChores.mockResolvedValue([chore('c-orphan', HOME.id, 'm-nobody')])
    await renderApp()
    const failure = await screen.findByTestId('render-failure')
    expect(failure).toHaveTextContent(/could not show this household/i)
    expect(within(failure).getByRole('alert')).toHaveTextContent(/taskr hit a problem showing this/i)
    expect(within(failure).getByTestId('render-failure-detail')).toHaveTextContent(
      /assigned to unknown member m-nobody/,
    )
    expect(within(failure).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(tabs()).toBeInTheDocument()
    expect(switcher()).toBeInTheDocument()
  })

  it('AC 6: the failure clears when another household is chosen — the next move is the retry', async () => {
    const restore = quietRenderErrors()
    onTestFinished(restore)
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOME.id ? [chore('c-orphan', HOME.id, 'm-nobody')] : choresAway,
    )
    await renderApp()
    await screen.findByTestId('render-failure')
    await switchTo(AWAY.id)
    await waitFor(() => expect(switcher()).toHaveValue(AWAY.id))
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()

    // Back on HOME with its data mended, the SAME boundary key is up again
    // with a working surface. A read that fails now is the surface's to say,
    // so the shell's strip must not speak over it: the failure it answered
    // belonged to the boundary that has since gone.
    choresApi.listChores.mockImplementation(async (id) => (id === HOME.id ? choresHome : choresAway))
    await switchTo(HOME.id)
    await waitFor(() => expect(switcher()).toHaveValue(HOME.id))
    expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument()
    choresApi.listChores.mockImplementation((id) =>
      id === AWAY.id ? Promise.reject(new Error('loading the chores: placeholder refusal')) : Promise.resolve(choresHome),
    )
    await switchTo(AWAY.id)
    expect(await screen.findByText(/placeholder refusal/)).toBeInTheDocument()
    expect(screen.queryByTestId('shell-error')).not.toBeInTheDocument()
  })

  it('AC 6: the failure clears when another TAB is chosen — the card says so, and a test holds it', async () => {
    const restore = quietRenderErrors()
    onTestFinished(restore)
    // Split throws; Chores does not call the allocator. review-fanout found
    // the tab half of the boundary's key untested while the card's own
    // sentence tells a person to try another tab.
    choresApi.listChores.mockResolvedValue([chore('c-orphan', HOME.id, 'm-nobody')])
    await renderApp()
    await screen.findByTestId('render-failure')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await waitFor(() => expect(screen.queryByTestId('render-failure')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Chores' })).toHaveAttribute('aria-current', 'page')
  })

  it('the last resort: a throw ABOVE the surfaces draws a sentence and a Reload inside the page frame, never an empty page', async () => {
    const restore = quietRenderErrors()
    onTestFinished(restore)
    // A household name that is not text makes the switcher itself throw —
    // outside the surface boundary, so only the root one can catch it.
    api.listHouseholds.mockResolvedValue([{ ...HOME, name: { unexpected: true } }, AWAY])
    await renderApp()
    const failure = await screen.findByTestId('render-failure')
    expect(failure).toHaveTextContent(/taskr could not draw this screen/i)
    expect(within(failure).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(failure.closest('main.shell')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Taskr' })).toBeInTheDocument()
  })
})
