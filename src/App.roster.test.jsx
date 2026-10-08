// App's tests for the roster, and the invitations that fill it. Split out of
// `App.test.jsx` by #553; every describe below moved verbatim with the comment
// above it. The fakes, the `vi.mock` calls and the shared `beforeEach` are in
// `src/test/support/appHarness.jsx`, which must stay the FIRST import.
import { api, choresApi, capacityApi, announceApi, exclusionsApi, calendarApi, signInStateApi, invitationsApi, invitationFlags, renderApp, HOUSEHOLD_ONE, HOUSEHOLD_TWO } from './test/support/appHarness.jsx'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    api.listHouseholds.mockResolvedValue([household])
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
    // #166 re-aimed this assertion, and the reason is worth keeping. It read
    // `queryByRole('button', { name: /create household/i })` — using the
    // onboarding form's BUTTON LABEL as the way to say "the onboarding screen
    // is not showing". That worked while the label was unique to that screen,
    // and #166 puts a second control with the same words on the roster, where
    // it legitimately belongs. Loosening the query or dropping the assertion
    // would both have been wrong: the property this test is about — a joined
    // person does not see the onboarding screen — is still exactly right and
    // still worth guarding. So it now names that screen by its own identity
    // (`signed-in-note` is rendered only by Onboarding's household card),
    // which no other surface can produce.
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
  })

  // #291 — the SCOPE reaches the data layer, from the control a person presses.
  //
  // This is the reachability half, and it is the half that was missing. The
  // library's `signOut()` defaults to `scope: 'global'`, which the unit test
  // now catches; but a unit test calls the function directly and cannot answer
  // "does the button on the roster pass anything at all?" — cairn's
  // `exported-is-not-reachable`. So these walk from the tab to the tap.
  it('signs out of this device only from the ordinary control', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
  })

  it('signs out everywhere only through the confirmed control', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' })),
    )
    expect(api.signOut).not.toHaveBeenCalled()
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: 'Sign out on every device?' })),
    )
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: true })
  })

  // AC 3: the roster is read from the server on load. If it were cached
  // locally, a passing "survives a restart" check would be indistinguishable
  // from a device that merely remembered.
  //
  // #165 AC 4 REWROTE this test, and the rewrite is the criterion. It used to
  // assert that `taskr.household` and `taskr.members` were both absent from
  // storage — two specific KEYS — under a name claiming the app reads "not from
  // storage" at all. #165 makes that name false in the letter and leaves it
  // true in the substance: this device now remembers WHICH household was
  // chosen, and remembers nothing else.
  //
  // The cheap move was to leave the assertions alone. They would have gone on
  // passing, because #165's key is neither of the two they name — and the test
  // would then have been green while its own title described a property the app
  // no longer had. That is the move the criterion forbids by name, so the test
  // is rewritten to the property that SURVIVES: the household row and the
  // roster are never cached, and the only thing on this device is a pointer.
  //
  // #165 AC 5 pins what must not be lost in the rewrite — that the two reads
  // actually happened on this load. The criterion names `api.currentHousehold`;
  // #164 replaced it with `api.listHouseholds`, which is the same read under
  // the name it now has.
  it('reads the household and roster from the server on every load, caching neither', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    // AC 5 — the guarantee this test has always existed for.
    expect(api.listHouseholds).toHaveBeenCalled()
    expect(api.listMembers).toHaveBeenCalled()

    // The property that survives, asserted over EVERYTHING this device stored
    // rather than over two names it might have used. A future story that cached
    // the roster under a third key would pass the old assertions and fails
    // these.
    const stored = Object.fromEntries(
      Object.keys(window.localStorage).map((k) => [k, window.localStorage.getItem(k)]),
    )
    expect(stored['taskr.household']).toBeUndefined()
    expect(stored['taskr.members']).toBeUndefined()
    // Nothing anywhere in storage carries the household's name or a member's:
    // a cache under any key is a cache.
    const everything = Object.values(stored).join(' ')
    expect(everything).not.toContain('Placeholder Household')
    expect(everything).not.toContain('Placeholder One')
  })

  // #165 AC 1's other half, and the reason the test above can be honest about
  // "only the CHOICE is stored": a person who has never switched household has
  // never made a choice, so this device stores nothing at all. Nothing writes
  // on a plain load — which is also what keeps #210's "a reload starts clean"
  // reading `localStorage.length === 0`.
  it('stores nothing at all for somebody who has never chosen a household', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(window.localStorage.length).toBe(0)
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

  // -------------------------------------------------------------------------
  // #163 — the household is NAMED in the shell, above the tabs, on every
  // surface. The roster card already carried the name on the Who tab; the
  // claim here is the shell's, so every query below is scoped to the shell's
  // own element rather than to "the name appears somewhere", which the Who
  // tab would satisfy with the shell element deleted.
  // -------------------------------------------------------------------------

  const shellName = () => screen.getByText(household.name, { selector: '.shell__household' })

  it('names the household above the tabs on every surface (#163 AC 1, AC 7)', async () => {
    await renderApp()
    // The default surface first — the one with NO roster card, so this is the
    // assertion that reddens when the shell element is removed and nothing
    // else on the page happens to say the name.
    const nav = screen.getByRole('navigation', { name: /household surfaces/i })
    const above = () =>
      Boolean(shellName().compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(above(), 'the name is not above the tab strip on the split').toBe(true)

    for (const surface of ['Chores', 'Who', 'Done', 'Shop']) {
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: surface })))
      expect(above(), `the name is not above the tab strip on ${surface}`).toBe(true)
    }
  })

  it('reads as information, not as a control to pick another household (#163 AC 4)', async () => {
    await renderApp()
    const name = shellName()
    expect(name.tagName).toBe('P')
    expect(name.closest('button, a, [role="button"], [role="combobox"], select')).toBeNull()
    expect(screen.queryByRole('button', { name: household.name })).not.toBeInTheDocument()
  })

  it('shows the edited name after the roster re-reads, with no reload (#163 AC 5)', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(shellName()).toBeInTheDocument()

    // The organizer renamed it on another device; the next read returns the
    // new row. The shell must follow the re-read that every write already
    // triggers — the same refresh() path — rather than remembering the name
    // it booted with.
    const renamed = { ...household, name: 'Placeholder Household Renamed' }
    api.listHouseholds.mockResolvedValue([renamed])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /refresh/i })))

    expect(
      await screen.findByText(renamed.name, { selector: '.shell__household' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(household.name, { selector: '.shell__household' })).not.toBeInTheDocument()
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
    api.listHouseholds.mockResolvedValue([householdA])
    await renderApp('Who')

    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    // Per-row too: giving somebody ELSE a sign-in is the organizer-only act.
    expect(screen.getByTestId('provision-m-a2')).toBeInTheDocument()
  })

  it('AC 4 / AC 3 negative: a plain member of the active household gets no organizer-only control on any row', async () => {
    api.listHouseholds.mockResolvedValue([householdB])
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
    api.listHouseholds.mockResolvedValue([householdA])
    await renderApp('Who')

    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder One')
  })

  it('AC 3: the household on screen and the identity come from the SAME read', async () => {
    // The households read answers A, then B, then A… — the two-household coin
    // toss #159 removed from the data layer, made deterministic. Every refresh
    // (boot, and arriving on Who re-reads) must derive the household state AND
    // the roster scope from its OWN single read: a refresh that drew them from
    // two reads pairs one household's roster with the other's identity, `me`
    // resolves to nobody, and the badge below has no row to land on (AC 7's
    // second mutation).
    let calls = 0
    api.listHouseholds.mockImplementation(async () => [++calls % 2 ? householdA : householdB])
    await renderApp('Who')

    // Which household won depends only on how many refreshes ran, so read it
    // off the roster read's own last call rather than assuming the count.
    const lastScoped = api.listMembers.mock.calls.at(-1)[0]
    const expectedRow = lastScoped === householdA.id ? 'Placeholder One' : 'Placeholder Three'
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent(expectedRow)
  })
})

describe('#172 — the invitation card, through App', () => {
  // `person-a` ORGANISES one household and merely BELONGS to the other — #160's
  // shape, and AC 6's whole subject: the control must follow the organizer
  // role in the ACTIVE household, not the person. Reusing #160's names so the
  // #19 vocabulary needs nothing new.
  const HOME = {
    id: 'household-a',
    name: 'Placeholder Household',
    organizer_member_id: 'm-a1',
    timezone: 'America/New_York',
  }
  const AWAY = {
    id: 'household-b',
    name: 'Placeholder Other Household',
    organizer_member_id: 'm-b1',
    timezone: 'America/New_York',
  }
  const rosterHome = [
    { id: 'm-a1', household_id: HOME.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm-a2', household_id: HOME.id, display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' },
  ]
  const rosterAway = [
    { id: 'm-b2', household_id: AWAY.id, display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm-b1', household_id: AWAY.id, display_name: 'Placeholder Other Organizer', weekly_minutes: 200, claimed_by: 'person-b' },
  ]
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

  const switcher = () => screen.getByRole('combobox', { name: /^household$/i })
  const switchTo = async (id) =>
    act(async () => void fireEvent.change(switcher(), { target: { value: id } }))
  const click = async (element) => act(async () => void fireEvent.click(element))

  beforeEach(() => {
    api.listMembers.mockImplementation(async (id) =>
      id === HOME.id ? rosterHome : id === AWAY.id ? rosterAway : [],
    )
    invitationsApi.mintInvitation.mockResolvedValue({
      code: 'k7m3qp4rwn',
      invitation: { id: 'inv-1', household_id: HOME.id },
    })
  })

  it('AC 1 / AC 3 — reads the organizer’s invitations for the household on screen, and offers the card', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-9')])
    await renderApp('Who')

    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
    expect(invitationsApi.listInvitations).toHaveBeenCalledWith(HOME.id)
    expect(screen.getByTestId('invitation-inv-9')).toBeInTheDocument()
  })

  it('AC 5 — a plain member of the active household gets no card, and App never asks for the rows', async () => {
    api.listHouseholds.mockResolvedValue([AWAY])
    await renderApp('Who')
    // The identity RESOLVED — they are somebody here — so the absence below is
    // "not the organizer" and not "nobody", which is a different state.
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder Three')

    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create an invitation code/i })).not.toBeInTheDocument()
    // The read is not made at all. The policy would answer it with nothing, so
    // this is the round trip #351 priced, not the guard — the guard is proven
    // in invitationMint.pglite.test.js through the exact statement.
    expect(invitationsApi.listInvitations).not.toHaveBeenCalled()
  })

  it('AC 6 — the card follows the organizer role in the ACTIVE household, not the person', async () => {
    api.listHouseholds.mockResolvedValue([HOME, AWAY])
    await renderApp('Who')
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()

    await switchTo(AWAY.id)
    // Same person, same session — and in the household they merely belong to,
    // no card and no read on its behalf.
    await waitFor(() => expect(api.listMembers).toHaveBeenCalledWith(AWAY.id))
    await waitFor(() => expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument())
    expect(invitationsApi.listInvitations).not.toHaveBeenCalledWith(AWAY.id)

    await switchTo(HOME.id)
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
  })

  it('AC 2 — minting names the household on screen and the organizer’s own row in it, then shows the code', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')

    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))

    // The ARGUMENTS, not the call: a mint naming the first household by name, or
    // somebody else's member row, is the fault #159 measured on `addMember`.
    expect(invitationsApi.mintInvitation).toHaveBeenCalledWith({
      householdId: HOME.id,
      createdByMemberId: 'm-a1',
    })
    expect(await screen.findByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
    // Both are on screen once the mint has settled. That is ALL this pair can
    // see: `act` has flushed the re-read and the set before either assertion
    // runs, so the order between them is the next test's (#420 — this comment
    // used to claim the ordering, and the mutation that set the code a round
    // trip early left this test green).
    expect(screen.getByTestId('invitation-inv-1')).toBeInTheDocument()
  })

  it('#420 — the code waits for the re-read: nothing is shown until its row has been read back', async () => {
    // The ORDER `handleMintInvitation` states — the code is set after its own
    // re-read — observed from inside the window rather than after it. The
    // refresh reconciles the shown code against the rows it just read and
    // clears one whose row is missing, so a code set a round trip early is
    // wiped by the very re-read that would have carried its row. Three
    // sibling tests here redden on that only because their fixtures never
    // return the row; this one holds the list read open and looks.
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')

    let release = null
    invitationsApi.listInvitations.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    // The mint has committed and the refresh is parked on the invitation read.
    await waitFor(() => expect(invitationsApi.mintInvitation).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(release).not.toBeNull())
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()

    await act(async () => release([invitationRow('inv-1')]))
    expect(await screen.findByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
    expect(screen.getByTestId('invitation-inv-1')).toBeInTheDocument()
  })

  it('AC 2 — a refused mint shows the refusal and no code', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')

    invitationsApi.mintInvitation.mockRejectedValue(new Error('creating the invitation: permission denied'))
    await click(screen.getByRole('button', { name: /create an invitation code/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
  })

  it('AC 4 — withdrawing the invitation whose code is on screen takes the code away with it', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    invitationsApi.listInvitations.mockResolvedValue([])
    const item = screen.getByTestId('invitation-inv-1')
    await click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    await click(within(item).getByRole('button', { name: /withdraw this code\?/i }))

    expect(invitationsApi.withdrawInvitation).toHaveBeenCalledWith('inv-1')
    // A withdrawn code is dead; leaving it on screen would invite somebody to
    // read out a code the server now refuses.
    await waitFor(() => expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument())
    expect(screen.queryByTestId('invitation-inv-1')).not.toBeInTheDocument()
  })

  it('AC 4 — withdrawing a DIFFERENT invitation leaves the shown code where it is', async () => {
    // The other direction of the same condition. Without it, a version that
    // cleared the code on ANY withdrawal would pass the test above.
    api.listHouseholds.mockResolvedValue([HOME])
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-2')])
    await renderApp('Who')
    await screen.findByTestId('invitation-inv-2')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1'), invitationRow('inv-2')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    const older = screen.getByTestId('invitation-inv-2')
    await click(within(older).getByRole('button', { name: /withdraw the code created/i }))
    await click(within(older).getByRole('button', { name: /withdraw this code\?/i }))

    expect(invitationsApi.withdrawInvitation).toHaveBeenCalledWith('inv-2')
    await waitFor(() => expect(screen.queryByTestId('invitation-inv-2')).not.toBeInTheDocument())
    expect(screen.getByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
  })

  it('AC 2 — a code minted for one household does not survive a switch, even back to it', async () => {
    // "Even back to it" is the discriminating half. Leaving the other household
    // hides the card by the ROLE gate whatever the state holds, so only coming
    // back shows whether the code was CLEARED or merely out of sight.
    api.listHouseholds.mockResolvedValue([HOME, AWAY])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    await switchTo(AWAY.id)
    await waitFor(() => expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument())
    await switchTo(HOME.id)
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
  })

  it('AC 2 — the code can be hidden once it has been passed on', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    // Create is hidden while the code is up (design-bar re-measure), so the
    // only route to a second code runs through this button.
    expect(screen.queryByRole('button', { name: /create an invitation code/i })).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: /hide the code/i }))
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create an invitation code/i })).toBeInTheDocument()
  })

  it('AC 2 — the shown code does not survive signing out and back in on the same device', async () => {
    // #165 AC 7's reason: on a shared tablet the next person to sign in must
    // not find somebody else's invitation code on their screen. The harder case
    // is the one tested — the SAME organizer back into the SAME household — so
    // the role gate would show the card again either way, and only a CLEARED
    // code is absent rather than merely out of sight while signed out.
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    api.signOut.mockImplementation(async () => {
      api.currentSession.mockResolvedValue(null)
      api.currentUserId.mockResolvedValue(null)
      api.listHouseholds.mockResolvedValue([])
    })
    await click(screen.getByRole('button', { name: /^sign out$/i }))
    await screen.findByRole('button', { name: /^sign in$/i })

    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      api.listHouseholds.mockResolvedValue([HOME])
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    // #440 — a sign-out remounts the app, so signing back in opens on the
    // default tab the way a fresh boot does, not on the tab the last session
    // was showing. Walk to the card.
    await click(await screen.findByRole('button', { name: 'Who' }))
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
  })

  it('the flag — no card and no read while an invitation cannot yet be redeemed', async () => {
    // Owner decision at the review escalation, 2026-09-10: the card is wired
    // only while this is true. It WAS false from #172 until #173 shipped
    // redemption, so a promotion of develop between them could not put an
    // unspendable code in front of real organizers; the gate stays as the
    // record of that coupling, and this test forces it off to prove it holds.
    invitationFlags.redeemable = false
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    // Positive control: this person IS the organizer here (the note is
    // organizer-only), so the absence below is the flag's and not the role's.
    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
    expect(invitationsApi.listInvitations).not.toHaveBeenCalled()
  })

  it('review — a mint that commits but whose re-read fails still shows the code', async () => {
    // review-fanout's headline, three lenses: the code used to be read off
    // `mutate`'s return, which a failed re-read never produces, so the only
    // copy was thrown away while its row stayed live.
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    let committed = false
    invitationsApi.mintInvitation.mockImplementation(async () => {
      committed = true
      return { code: 'k7m3qp4rwn', invitation: { id: 'inv-1', household_id: HOME.id } }
    })
    api.listMembers.mockImplementation(async (id) => {
      if (committed) throw new Error('loading the roster: the network went away')
      return id === HOME.id ? rosterHome : []
    })

    await click(screen.getByRole('button', { name: /create an invitation code/i }))

    expect(await screen.findByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
    // Beside the read's error, which is the honest pair: the code worked, the
    // re-read did not.
    expect(screen.getByRole('alert')).toHaveTextContent(/network went away/i)
  })

  it('review — a withdrawal that commits but whose re-read fails still takes the code away', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    let withdrawn = false
    invitationsApi.withdrawInvitation.mockImplementation(async () => {
      withdrawn = true
    })
    api.listMembers.mockImplementation(async (id) => {
      if (withdrawn) throw new Error('loading the roster: the network went away')
      return id === HOME.id ? rosterHome : []
    })
    const item = screen.getByTestId('invitation-inv-1')
    await click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    await click(within(item).getByRole('button', { name: /withdraw this code\?/i }))

    expect(invitationsApi.withdrawInvitation).toHaveBeenCalledWith('inv-1')
    await waitFor(() => expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/network went away/i)
  })

  it('review — a code withdrawn from another device leaves this screen on the next refresh', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    // The organizer's tablet withdrew it; this phone learns on its next read.
    invitationsApi.listInvitations.mockResolvedValue([])
    const roster = screen.getByRole('region', { name: /who is in the household/i })
    await click(within(roster).getByRole('button', { name: /^refresh$/i }))

    await waitFor(() => expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument())
    // Nothing on THIS device withdrew anything.
    expect(invitationsApi.withdrawInvitation).not.toHaveBeenCalled()
  })

  it('review — switching between two households you organise never shows the first one’s codes under the second', async () => {
    const OTHER = {
      id: 'household-c',
      name: 'Placeholder Other Household',
      organizer_member_id: 'm-c1',
      timezone: 'America/New_York',
    }
    const rosterOther = [
      { id: 'm-c1', household_id: OTHER.id, display_name: 'Placeholder One', weekly_minutes: 90, claimed_by: 'person-a' },
      { id: 'm-c2', household_id: OTHER.id, display_name: 'Placeholder Two', weekly_minutes: 30, claimed_by: null },
    ]
    api.listHouseholds.mockResolvedValue([HOME, OTHER])
    api.listMembers.mockImplementation(async (id) =>
      id === HOME.id ? rosterHome : id === OTHER.id ? rosterOther : [],
    )
    // OTHER's invitation read never settles — the window the finding is about,
    // held open so the test can look inside it.
    invitationsApi.listInvitations.mockImplementation((id) =>
      id === HOME.id ? Promise.resolve([invitationRow('inv-9')]) : new Promise(() => {}),
    )
    await renderApp('Who')
    expect(await screen.findByTestId('invitation-inv-9')).toBeInTheDocument()

    await switchTo(OTHER.id)
    await waitFor(() => expect(invitationsApi.listInvitations).toHaveBeenCalledWith(OTHER.id))

    // OTHER's card, because this person organises OTHER too — and none of
    // HOME's codes under it.
    expect(screen.getByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.queryByTestId('invitation-inv-9')).not.toBeInTheDocument()
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
    api.listHouseholds.mockResolvedValue([household])
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
    api.listHouseholds.mockResolvedValue([household])
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

// #191 AC 1 — adding somebody sends their invitation, at the level only App can
// answer: the roster's Add form calls `onAdd` and then `onInvite` with the id
// the add returned, and it is App that wires both to the data layer. The
// component test proves the ORDER and the id on the props; this proves the
// props reach `addMember` and `inviteMember`, with the household on screen.
describe('#191 — adding somebody sends their invitation, from App', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm1',
  }
  const organizer = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const NEW_ADDRESS = 'placeholder.three@example.com'

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([organizer])
    api.addMember.mockResolvedValue({
      id: 'm9',
      display_name: 'Placeholder Three',
      weekly_minutes: 0,
      claimed_by: null,
      email: NEW_ADDRESS,
    })
    api.inviteMember.mockResolvedValue({ ok: true, action: 'invite', memberId: 'm9' })
  })

  const addSomeone = async () => {
    await renderApp('Who')
    const form = (await screen.findByRole('button', { name: /add to household/i })).closest('form')
    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    fireEvent.change(within(form).getByLabelText(/email address/i), {
      target: { value: NEW_ADDRESS },
    })
    await act(
      async () =>
        void fireEvent.click(within(form).getByRole('button', { name: /add to household/i })),
    )
    return form
  }

  it('adds with the household on screen, then invites the row the add returned', async () => {
    await addSomeone()

    expect(api.addMember).toHaveBeenCalledWith({
      displayName: 'Placeholder Three',
      weeklyMinutes: 0,
      email: NEW_ADDRESS,
      householdId: 'h1',
    })
    expect(api.inviteMember).toHaveBeenCalledWith({ memberId: 'm9' })
    // The row first, then the invitation FOR that row — never the other way,
    // and never both at once.
    expect(api.addMember.mock.invocationCallOrder[0]).toBeLessThan(
      api.inviteMember.mock.invocationCallOrder[0],
    )
    expect(await screen.findByTestId('add-note')).toHaveTextContent(
      `Invitation sent to ${NEW_ADDRESS}`,
    )
  })

  it("a refused send puts the function's sentence on the strip and claims no send", async () => {
    // The mailer's refusal (#341 AC 4's one fact) reaches the shell through
    // `mutate`, and the form must not say "sent" beside it. The row exists.
    api.inviteMember.mockRejectedValueOnce(
      new Error(
        `The sign-in was not created and no email was sent to ${NEW_ADDRESS} — ` +
          'the mail service refused it. Try again in a little while.',
      ),
    )
    await addSomeone()

    expect(api.addMember).toHaveBeenCalledTimes(1)
    expect(api.inviteMember).toHaveBeenCalledWith({ memberId: 'm9' })
    // The function's own sentence reaches the form's alert (design-bar,
    // 2026-09-12) — asserted INSIDE the form, because the shell's strip carries
    // it too and a page-wide query would pass with the local one missing.
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')
    expect(await within(form).findByRole('alert')).toHaveTextContent(/no email was sent/i)
    expect(screen.queryByTestId('add-note')).not.toBeInTheDocument()
  })
})

// #458 — the roster's invited state, at the level only App can answer: that
// the sign-in read names the household on screen, reaches the roster, is taken
// again after a re-send, and that its failure costs the label and not the tab.
describe('#458 — an invited member reads as invited, from App', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'UTC',
    organizer_member_id: 'm1',
  }
  const organizer = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const invited = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 60,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const SENT = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([organizer, invited])
    signInStateApi.listSignInStates.mockResolvedValue([
      { member_id: 'm1', invited_at: null, confirmed_at: '2026-08-01T00:00:00Z' },
      { member_id: 'm2', invited_at: SENT, confirmed_at: null },
    ])
    api.inviteMember.mockResolvedValue({
      ok: true,
      action: 'invite',
      memberId: 'm2',
      email: invited.email,
      resent: true,
    })
  })

  it('reads the sign-in states for the household on screen, and the roster shows the invited row', async () => {
    await renderApp('Who')
    expect(signInStateApi.listSignInStates).toHaveBeenCalledWith('h1')
    expect(await screen.findByTestId('access-m2')).toHaveTextContent(/^Invited .* · not joined yet$/)
    expect(screen.getByTestId('access-m1')).toHaveTextContent(/^Signed in$/)
  })

  it('re-sends through inviteMember, then reads the states again', async () => {
    await renderApp('Who')
    const before = signInStateApi.listSignInStates.mock.calls.length
    await act(
      async () =>
        void fireEvent.click(await screen.findByRole('button', { name: /their invitation again/i })),
    )
    expect(api.inviteMember).toHaveBeenCalledWith({ memberId: 'm2' })
    expect(api.sendPasswordReset).not.toHaveBeenCalled()
    expect(signInStateApi.listSignInStates.mock.calls.length).toBeGreaterThan(before)
    expect(await screen.findByTestId('invite-note-m2')).toHaveTextContent(
      `Invitation sent again to ${invited.email}.`,
    )
  })

  it('a refused sign-in read leaves the roster on screen with the pre-#458 label, and no error', async () => {
    signInStateApi.listSignInStates.mockRejectedValue(new Error('Could not read who has joined: PGRST202'))
    await renderApp('Who')
    expect(await screen.findByTestId('access-m2')).toHaveTextContent(/^Signed in$/)
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
    expect(screen.queryByText(/could not read who has joined/i)).not.toBeInTheDocument()
  })
})

// #341 — following an invitation, at the level only App can answer.
//
// The component test covers what `ChoosePassword` DRAWS. These cover the three
// things that belong to App and that a component test structurally cannot see:
// that the fragment is read at all, that it is read EARLY ENOUGH, and that the
// household shell does not render behind the screen.
//
// THE SECOND ONE IS THE WHOLE REASON THIS BLOCK EXISTS, and it needs a word
// about the fake. `createClient` runs with `detectSessionInUrl` at its default
// of true, so supabase-js reads the URL once, at construction, and CLEARS the
// fragment — and `currentSession()` is the call that constructs it. A read
// placed after that line finds an empty hash, the password screen never appears,
// and the person lands in the app signed in with no password of their own.
// Silent, plausible, and indistinguishable from success.
//
// A test that merely rendered with a fragment would pass either way here,
// because `currentSession` is a stub and a stub constructs nothing. So the stub
// REPRODUCES THE PLATFORM'S BEHAVIOUR: it clears the hash when it is called.
// That is the difference between asserting the app's ordering and asserting the
// fake's (cairn's `a-fake-cannot-disagree-with-its-author`).
describe('#341 — following an invitation, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }

  let replaceState
  let realLocation
  let realHistory

  /** A completed auth link: a token in the fragment, and the type that says why. */
  const TOKEN = 'access_token=t&refresh_token=r&expires_in=3600&token_type=bearer'

  const atFragment = (hash) => {
    replaceState = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search: '', hash },
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
    api.setOwnPassword.mockResolvedValue(undefined)
    atFragment('')
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
    if (realHistory) Object.defineProperty(globalThis, 'history', realHistory)
  })

  it('POSITIVE CONTROL: with no fragment the ordinary shell renders', async () => {
    // Without this, every "the password screen is shown" assertion below passes
    // just as well against an app that shows it always — and every "the shell is
    // not rendered" assertion passes against an app that renders nothing at all.
    await renderApp()
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('shows Choose your password when an invitation link is followed', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()

    expect(
      await screen.findByRole('heading', { name: /choose your password/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('choose-password-input')).toBeInTheDocument()
  })

  it('renders nothing of the household behind it — one screen, one job', async () => {
    // AC 2 asks for "one field, one button". Asserted as the ABSENCE of the
    // shell rather than the presence of the field, because the failure this
    // guards is a household's data rendering to somebody who has not finished
    // setting up their account — and that failure is invisible to any assertion
    // about the field.
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    expect(screen.queryByRole('button', { name: 'Who' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chores' })).not.toBeInTheDocument()
    expect(screen.queryByText(household.name)).not.toBeInTheDocument()
  })

  it('reads the fragment BEFORE the client can consume it', async () => {
    // The hazard, reproduced. See this block's docblock: the stub clears the
    // hash exactly as supabase-js does at construction, so moving the read below
    // `currentSession()` makes this test — and only this test — go red.
    atFragment(`#${TOKEN}&type=invite`)
    api.currentSession.mockImplementation(async () => {
      globalThis.location.hash = ''
      return { user: { id: 'person-a' } }
    })

    await renderApp()
    expect(
      await screen.findByRole('heading', { name: /choose your password/i }),
    ).toBeInTheDocument()
  })

  it('strips the token off the URL, so a reload does not replay it', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  /** #191 — an invite arrival asks for a name too, so every submit below types one. */
  const typeName = (name = 'Placeholder Three') =>
    fireEvent.change(screen.getByTestId('choose-name-input'), { target: { value: name } })

  it('sets the password and lands them in their household', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    typeName()
    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).toHaveBeenCalledWith('a-good-password')
    // The screen goes, and what is underneath is their household — not a second
    // loading pass, because boot loaded it while this screen was up.
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // #191 AC 2 — the recipient names themselves, on the EMAIL path
  // -------------------------------------------------------------------------

  it('#191 AC 2: writes the name the person chose to THEIR row, after the password', async () => {
    // The organizer's typed name is on the row when the invitation goes out;
    // the person's own word replaces it here. Their row is the one the invite
    // action claimed to this session's user — `me` — and the write goes AFTER
    // the password, because a password that failed to set strands them and a
    // name that failed to save does not.
    atFragment(`#${TOKEN}&type=invite`)
    // review-fanout on #191: with ONE row in the fixture, `members[0]` passes
    // this test as well as `findClaimedMember` does. An unclaimed row listed
    // FIRST is what makes the claimed-by match the only way to reach 'm1'.
    api.listMembers.mockResolvedValue([
      { id: 'm0', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null, email: null },
      me,
    ])
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    typeName(' Placeholder Three ')
    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.updateMember).toHaveBeenCalledTimes(1)
    expect(api.updateMember).toHaveBeenCalledWith('m1', { displayName: 'Placeholder Three' })
    expect(api.setOwnPassword.mock.invocationCallOrder[0]).toBeLessThan(
      api.updateMember.mock.invocationCallOrder[0],
    )
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
  })

  it('#191 AC 2: when no row is theirs, the password is still set and the strip says so', async () => {
    // The `!mine` branch had no test (review-fanout). The password write is
    // the thing that lets them back in and goes first regardless; the name is
    // the recoverable half, and the sentence names where.
    atFragment(`#${TOKEN}&type=invite`)
    api.listMembers.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    typeName()
    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).toHaveBeenCalledWith('a-good-password')
    expect(api.updateMember).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/your row was not found/i)
  })

  it('#191 AC 2: the submit waits for the household to load, so the row is there to rename', async () => {
    // review-fanout on #191: boot renders this screen BEFORE `requestRefresh`
    // has populated `members`/`userId` (~6–7 s on Slow 4G), and a submit in
    // that window used to set the password and drop the name. The button is
    // disabled until the load settles; asserted by holding the household read
    // open, then releasing it.
    let release
    api.listHouseholds.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([household])
        }),
    )
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })
    expect(screen.getByRole('button', { name: /set my password/i })).toBeDisabled()

    await act(async () => {
      release()
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /set my password/i })).toBeEnabled(),
    )
  })

  it('#191 AC 2: refuses to submit with no name, before any write', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).not.toHaveBeenCalled()
    expect(api.updateMember).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/what the household should call you/i)
  })

  it('#191 AC 2: a refused rename keeps the password set and says so, in the household', async () => {
    // #173's shape on the code path, repeated here: the person is IN, with the
    // organizer's word still on their row and a sentence saying how to fix it.
    // The password write is not undone and the screen is not kept up — both
    // would be worse than the name being wrong for a minute.
    atFragment(`#${TOKEN}&type=invite`)
    api.updateMember.mockRejectedValueOnce(new Error('saving the change: permission denied'))
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    typeName()
    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).toHaveBeenCalledWith('a-good-password')
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/your name could not be saved/i)
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('#191 AC 2: a RECOVERY asks for no name and writes none', async () => {
    // The other arrival on the same screen: somebody replacing a lost password
    // already has a name on their row, and asking again would be a second
    // spelling to keep in step.
    atFragment(`#${TOKEN}&type=recovery`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose a new password/i })

    expect(screen.queryByTestId('choose-name-input')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /save my password/i })),
    )

    expect(api.setOwnPassword).toHaveBeenCalledWith('a-good-password')
    expect(api.updateMember).not.toHaveBeenCalled()
  })

  it('keeps the screen up when the write fails, and says so', async () => {
    // A password that was not set is a person who cannot sign in again once they
    // leave. Dismissing the screen on a failure would strand them with no way
    // back and nothing on screen to say why.
    atFragment(`#${TOKEN}&type=invite`)
    api.setOwnPassword.mockRejectedValue(new Error('Could not set that password: nope'))
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    typeName()
    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(screen.getByRole('heading', { name: /choose your password/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not set that password/i)
  })

  it('refuses a short password before the round trip', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    typeName()
    fireEvent.change(screen.getByTestId('choose-password-input'), { target: { value: 'abc' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 6 characters/i)
  })

  it('an EXPIRED invitation goes to the sign-in screen, not to the password screen', async () => {
    // The trap this exists for: an expired link carries `type=invite` too,
    // alongside an error and NO token. Reading `type` alone would show a
    // password screen for a session that does not exist, and the write would
    // then fail with a sentence about the write rather than about the link.
    atFragment(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=invite',
    )
    api.currentSession.mockResolvedValue(null)

    await renderApp()
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('does not show the password screen when the link left no session', async () => {
    // The other half of the same rule, with a token that GoTrue rejected: there
    // is nothing to set a password ON, so the sign-in screen is the honest state.
    atFragment(`#${TOKEN}&type=invite`)
    api.currentSession.mockResolvedValue(null)

    await renderApp()
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('a recovery link lands on the same screen, in its own words', async () => {
    // AC 2's "build it once and both types route to it", asserted as the two
    // headings differing — if the copy were shared, this and the invite test
    // above would both pass against a screen that could not tell them apart.
    atFragment(`#${TOKEN}&type=recovery`)
    await renderApp()

    expect(
      await screen.findByRole('heading', { name: /choose a new password/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('#155 AC 5: a recovery return and a calendar consent return on ONE URL do not consume each other', async () => {
    // Measured, not asserted (the issue's own words): the recovery rides the
    // FRAGMENT on the implicit flow and the consent rides the QUERY, keyed by
    // `state`. Boot reads the fragment first, strips ONLY the fragment, then
    // reads the query and strips that once the code is spent. The screen alone
    // could not catch a strip that took the whole URL — the password screen
    // renders either way — so the strip's own argument is the assertion.
    calendarApi.completeConnect.mockResolvedValue({ ok: true })
    atFragment(`#${TOKEN}&type=recovery`)
    globalThis.location.search = '?code=the-code&state=the-state'
    await renderApp()

    expect(
      await screen.findByRole('heading', { name: /choose a new password/i }),
    ).toBeInTheDocument()
    expect(calendarApi.completeConnect).toHaveBeenCalledWith({
      code: 'the-code',
      error: null,
      state: 'the-state',
    })
    // First strip: the fragment only, the query still on the URL for the read
    // that follows. Second: the spent code.
    expect(replaceState.mock.calls[0]).toEqual([null, '', '/?code=the-code&state=the-state'])
    expect(replaceState.mock.calls[1]).toEqual([null, '', '/'])
  })

  it('#155 AC 5: a bad-flow-state return in the QUERY still strips whole — it carries no state and is nobody else’s', async () => {
    // The one query the fragment-side strip does own. Without `state` the
    // calendar reader refuses it, so there is nothing to keep it for, and a
    // reload holding it would announce the same spent failure twice.
    api.currentSession.mockResolvedValue(null)
    atFragment('')
    globalThis.location.search = '?error=invalid_request&error_code=bad_oauth_state'
    await renderApp()

    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    expect(calendarApi.completeConnect).not.toHaveBeenCalled()
  })

  it('#155: the sign-in screen asks GoTrue for the reset directly — no session, so no re-read', async () => {
    api.currentSession.mockResolvedValue(null)
    api.sendPasswordReset.mockResolvedValue(undefined)
    atFragment('')
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    api.listHouseholds.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /forgot your password/i }))
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /email me a reset link/i })),
    )

    expect(api.sendPasswordReset).toHaveBeenCalledWith('kid@example.com')
    // Not through `mutate`: its re-read would run with no session, as `anon`,
    // which 0017 stripped — and the refusal would land over the top of a mail
    // that went (#440's shape). The fake would have answered that read with a
    // household, so a re-read here is not merely wasteful, it is visible.
    expect(api.listHouseholds).not.toHaveBeenCalled()
    expect(screen.getByTestId('reset-note')).toHaveTextContent(/on its way/i)
    expect(screen.queryByRole('navigation', { name: /household surfaces/i })).not.toBeInTheDocument()
  })

  it('ignores a fragment whose type is neither', async () => {
    // A Google sign-in return carries a token and no `type` this screen owns.
    // Treating any token as an arrival would put a password screen in front of
    // every OAuth sign-in.
    atFragment(`#${TOKEN}`)
    await renderApp()

    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })
})

describe('#173 — redeeming an invitation code, from App', () => {
  const PENDING_KEY = 'taskr.pendingInvitation'
  const CHOICE_KEY = 'taskr.activeHousehold'
  const alone = [
    { id: 'm1', display_name: 'Placeholder Everywhere', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const joinedRow = { id: 'm9', household_id: HOUSEHOLD_TWO.id, display_name: 'New member' }
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Three', weekly_minutes: 0, claimed_by: 'person-a' },
    { id: 'm10', display_name: 'Placeholder Other Organizer', weekly_minutes: 30, claimed_by: 'person-b' },
  ]
  const UNUSABLE =
    'That code cannot be used — it may have expired, been withdrawn, or already been used. Ask whoever gave it to you for a fresh one.'

  const click = async (element) => act(async () => void fireEvent.click(element))
  const codeField = (scope = screen) => scope.getByLabelText(/invitation code/i)
  const nameField = (scope = screen) => scope.getByLabelText(/join as/i)
  const joinButton = (scope = screen) => scope.getByRole('button', { name: /join household/i })
  const fillJoin = (scope = screen, code = 'k7m3qp4rwn', name = 'Placeholder Three') => {
    fireEvent.change(codeField(scope), { target: { value: code } })
    fireEvent.change(nameField(scope), { target: { value: name } })
  }
  /** What `pendingInvitation.js` writes — the shape the boot reads. */
  const hold = (code = 'k7m3qp4rwn', name = 'Placeholder Three') =>
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ code, name }))

  /** The write succeeds and the read that follows sees the new household — `mutate()`'s shape. */
  const redemptionJoins = (from = []) =>
    invitationsApi.redeemInvitation.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([...from, HOUSEHOLD_TWO])
      return joinedRow
    })

  let scrollTo

  beforeEach(() => {
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : alone))
    api.updateMember.mockResolvedValue({})
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    scrollTo.mockRestore()
  })

  // -------------------------------------------------------------------------
  // AC 1 — signed in, no household: the join card
  // -------------------------------------------------------------------------

  it('AC 1: a signed-in person with no household is offered the join card beside the household form', async () => {
    await renderApp()
    expect(await screen.findByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start a household' })).toBeInTheDocument()
  })

  it('AC 1: entering a code creates the member row through the function and the app switches to that household', async () => {
    redemptionJoins()
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledWith('k7m3qp4rwn')
    // The shell, on the household the code named — and no client insert.
    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(api.addMember).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /join with a code/i })).not.toBeInTheDocument()
  })

  it('AC 1: the joined household is the one this device now remembers', async () => {
    redemptionJoins()
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())
    await screen.findByText('Placeholder Other Household')

    expect(window.localStorage.getItem(CHOICE_KEY)).toBe(HOUSEHOLD_TWO.id)
  })

  // -------------------------------------------------------------------------
  // The name — #191 AC 2's half that sits on this surface
  // -------------------------------------------------------------------------

  it('renames the row the function created to the name the person chose, after the join', async () => {
    redemptionJoins()
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin(screen, 'k7m3qp4rwn', ' Placeholder Three ')
    await click(joinButton())
    await screen.findByText('Placeholder Other Household')

    expect(api.updateMember).toHaveBeenCalledTimes(1)
    expect(api.updateMember).toHaveBeenCalledWith('m9', { displayName: 'Placeholder Three' })
    // ORDER: the join first, then the rename — the row has to exist to be renamed.
    expect(invitationsApi.redeemInvitation.mock.invocationCallOrder[0]).toBeLessThan(
      api.updateMember.mock.invocationCallOrder[0],
    )
  })

  it('a refused rename does not undo the join — the person lands in the household and is told', async () => {
    redemptionJoins()
    api.updateMember.mockRejectedValue(new Error('saving the change: permission denied'))
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/your name could not be saved/i)
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe(HOUSEHOLD_TWO.id)
  })

  // -------------------------------------------------------------------------
  // AC 2 and AC 3 — refusals
  // -------------------------------------------------------------------------

  it('AC 2: an existing member is refused with a sentence saying the code was not spent, and stays where they were', async () => {
    invitationsApi.redeemInvitation.mockRejectedValue(
      new Error('You are already in that household, so the code was left unused.'),
    )
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/left unused/)
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    // The code stays in the field beside the sentence that refused it, and
    // nothing was renamed.
    expect(codeField()).toHaveValue('k7m3qp4rwn')
    expect(api.updateMember).not.toHaveBeenCalled()
  })

  it('AC 3: an unusable code is refused with the one sentence, naming no household', async () => {
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/cannot be used/)
    expect(alert).not.toHaveTextContent(/Placeholder/)
    expect(alert).not.toHaveTextContent(HOUSEHOLD_TWO.id)
  })

  // -------------------------------------------------------------------------
  // AC 4 — the code survives the leave-for-inbox round trip, on this device
  // -------------------------------------------------------------------------

  it('AC 4: signed out, the join link takes the code and the name FIRST and keeps them on this device', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    await click(screen.getByRole('button', { name: /join a household/i }))

    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    fireEvent.change(codeField(), { target: { value: '  K7M3QP4RWN\t' } })
    fireEvent.change(nameField(), { target: { value: ' Placeholder Three ' } })
    await click(screen.getByRole('button', { name: /keep this code/i }))

    // Normalised into storage, and nothing redeemed — there is no session.
    expect(JSON.parse(window.localStorage.getItem(PENDING_KEY))).toEqual({
      code: 'k7m3qp4rwn',
      name: 'Placeholder Three',
    })
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    // Back on the sign-in card, which says the code is held.
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.getByTestId('held-invitation-note')).toHaveTextContent(/saved on this device/i)
  })

  it('AC 4: a held code is applied on sign-in without being re-typed, under the held name, then forgotten', async () => {
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    hold()
    redemptionJoins()
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(screen.getByTestId('held-invitation-note')).toBeInTheDocument()

    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    // ONE tap, naming the held name, and nothing typed again (AC 4's letter).
    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))

    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledWith('k7m3qp4rwn')
    expect(api.updateMember).toHaveBeenCalledWith('m9', { displayName: 'Placeholder Three' })
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
  })

  it('AC 4: the confirmation link opened in THIS browser offers the held code at boot, one tap applies it', async () => {
    // Back from the inbox: the client picked the session up off the URL, the
    // person has no household yet, and this device is still holding the code.
    // The offer, not a silent apply — the account that signed in is not
    // necessarily the one that held the code (review escalation, 2026-09-11).
    hold()
    redemptionJoins()
    await renderApp()

    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(confirm).toHaveTextContent(/Placeholder Three/)
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))

    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledWith('k7m3qp4rwn')
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(screen.queryByRole('heading', { name: /join with a code/i })).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // AC 5 — what the mechanism guarantees in a DIFFERENT browser
  // -------------------------------------------------------------------------

  it('AC 5: the confirmation link opened in a DIFFERENT browser finds no code — nothing is redeemed and the join form is shown', async () => {
    // The mechanism is `localStorage` on the device that entered the code
    // (pendingInvitation.js), so another browser holds nothing. The guarantee
    // is that the person is shown the join form and types the code again —
    // asserted here rather than left to the happy path above.
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    await renderApp()

    expect(await screen.findByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    // And typing it there works exactly as if it had been carried.
    redemptionJoins()
    fillJoin()
    await click(joinButton())
    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
  })

  it('a held code that is refused is forgotten, so a boot cannot loop on it', async () => {
    hold()
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp()
    const confirm = await screen.findByTestId('held-invitation-confirm')
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be used/)
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    // The join form is there for the next attempt, which is theirs to make.
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
  })

  it('a held code does not outlive the session on a shared tablet — sign-out forgets it', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    await renderApp('Who')
    await screen.findByRole('region', { name: /join another household/i })
    // Left behind by somebody else on this device, after this boot's read.
    hold()

    // #440 — the session goes too, as auth-js's does: the remounted boot
    // then takes the signed-out branch rather than reading with a stale one.
    api.signOut.mockImplementation(async () => {
      api.currentSession.mockResolvedValue(null)
      api.currentUserId.mockResolvedValue(null)
      api.listHouseholds.mockResolvedValue([])
    })
    await click(screen.getByRole('button', { name: /^sign out$/i }))
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // AC 7 — a second household, from inside the first
  // -------------------------------------------------------------------------

  it('AC 7: a person already in a household is offered a way to join another', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    await renderApp('Who')
    expect(
      await screen.findByRole('region', { name: /join another household/i }),
    ).toBeInTheDocument()
  })

  it('AC 7: after joining, the switcher lists both and the newly joined one is active', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    redemptionJoins([HOUSEHOLD_ONE])
    await renderApp('Who')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    await click(joinButton(card))

    const switcher = await screen.findByRole('combobox', { name: /^household$/i })
    expect(within(switcher).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Placeholder Household',
      'Placeholder Other Household',
    ])
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe(HOUSEHOLD_TWO.id)
  })

  it('AC 7: the join scrolls to the top, where the switcher names the new household', async () => {
    // Owner decision at the design pass, 2026-09-11: from the roster card the
    // person was ~2,300px down and, after the re-read, still there — looking
    // at the NEW household's "Start another household" card with nothing in
    // view saying they had moved. jsdom has no layout, so the scroll is
    // asserted as a request.
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    redemptionJoins([HOUSEHOLD_ONE])
    await renderApp('Who')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    expect(scrollTo).not.toHaveBeenCalled()
    await click(joinButton(card))
    await screen.findByRole('combobox', { name: /^household$/i })

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('a refused join scrolls nowhere — the sentence is beside the control', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp('Who')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    await click(joinButton(card))
    await screen.findByText(/cannot be used/)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('AC 7: the first household’s notices do not come along — the switch path’s rule', async () => {
    // A re-balance announcement about household ONE must not stand over TWO's
    // surfaces after the join, for exactly `chooseHousehold`'s reason (#164's
    // finding 6, whose fixture this is): a refresh never clears it, so only
    // the join path can. The precondition below is what keeps this from
    // passing on a page that never had one.
    const rebalanced = {
      ...HOUSEHOLD_ONE,
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
    const inOne = [
      { id: 'm1', household_id: rebalanced.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
      { id: 'm2', household_id: rebalanced.id, display_name: 'Placeholder Two', weekly_minutes: 300, claimed_by: null },
    ]
    api.listHouseholds.mockResolvedValue([rebalanced])
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOUSEHOLD_TWO.id
        ? []
        : [
            { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
            { id: 'c2', title: 'Placeholder Other Chore', expected_minutes: 50, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
          ],
    )
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
    redemptionJoins([rebalanced])
    await renderApp('Who')
    // The precondition: the announcement really is on screen before the join.
    await screen.findByTestId('rebalance-announcement')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    await click(joinButton(card))
    await screen.findByRole('combobox', { name: /^household$/i })

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // The review round's three behaviour findings
  // -------------------------------------------------------------------------

  it('a refusal on the strip is answered by the person’s next join attempt on the no-household screen', async () => {
    // Review finding: App's error prop has no setter on the screen, so a
    // refusal stayed under the form after the person moved on. What THIS test
    // exercises: a signed-in join refused (the strip shows), then a second
    // attempt submitted — the old sentence must be gone before the new call
    // resolves. The signed-out move-between-views case, and a NEW App
    // sentence showing after the old one was answered, are the Onboarding
    // component tests' (`Onboarding.test.jsx`, the latch describe).
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    hold()
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))
    // The held code is offered, taken, and refused; the person is on the
    // no-household screen with the strip.
    await click(await screen.findByRole('button', { name: /^join as placeholder three$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be used/)

    // Their next act — typing and trying again — answers the old sentence
    // before the new call resolves.
    invitationsApi.redeemInvitation.mockImplementation(() => new Promise(() => {}))
    fillJoin()
    await click(joinButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a held code is offered only after the sign-in’s own refresh has settled', async () => {
    // Review finding: keyed on `userId` alone, the effect fired mid-refresh
    // and the redemption ran while the sign-in's read of household ONE was
    // still writing ONE's seen marker. The split-seen read is held open here;
    // nothing may be offered, let alone redeemed, until it resolves.
    let release
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    api.listHouseholds.mockResolvedValue([])
    hold()
    redemptionJoins([HOUSEHOLD_ONE])
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
      return { user: { id: 'person-a' } }
    })
    announceApi.readSplitSeen.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve(null) }),
    )
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    // The sign-in's refresh is parked on the seen-marker read, with the id set.
    expect(api.currentUserId).toHaveBeenCalled()
    expect(release).toBeTypeOf('function')
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()

    await act(async () => release())
    // Settled: the member of ONE is now offered the code — above ONE's shell.
    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(confirm).toHaveTextContent(/Placeholder Three/)
    expect(screen.getByText('Placeholder Household')).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))
    await waitFor(() => expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('combobox', { name: /^household$/i })).toHaveValue(HOUSEHOLD_TWO.id)
  })

  it('Not me forgets the held code without spending it, and leaves the join form', async () => {
    // The shared-tablet ordering the sign-out clear does not cover (review
    // escalation, owner decision 2026-09-11): B held a code and left for the
    // inbox; A signs in first. A must be able to decline, and the code must
    // not be redeemed on A's account.
    hold()
    await renderApp()
    const confirm = await screen.findByTestId('held-invitation-confirm')
    await click(within(confirm).getByRole('button', { name: /^not me$/i }))

    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(api.updateMember).not.toHaveBeenCalled()
  })

  it('a boot that FAILED after setting the session offers nothing, and keeps its own reason', async () => {
    // Review finding: the effect ran after a boot whose refresh threw past
    // `setUserId` — an organizer whose invitations read alone refused — and a
    // redemption's refusal replaced the boot's sentence. `listInvitations` is
    // the one uncaught read after the id is set, and it runs only for the
    // organizer of an existing household.
    const organised = { ...HOUSEHOLD_ONE, organizer_member_id: 'm1' }
    api.listHouseholds.mockResolvedValue([organised])
    invitationsApi.listInvitations.mockRejectedValue(new Error('loading the invitations: the network went away'))
    hold()
    await renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent(/the network went away/)
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    // The code is still held for a boot that succeeds.
    expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull()
  })

  it('the held note follows the store when another tab changes it', async () => {
    // Review finding: `heldInvitation` was a mount-time snapshot. Another tab
    // redeeming, being refused on, or signing out clears the same key, and
    // this tab kept promising a code that was gone.
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    hold()
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(screen.getByTestId('held-invitation-note')).toBeInTheDocument()

    window.localStorage.removeItem(PENDING_KEY)
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: PENDING_KEY, newValue: null }))
    })
    expect(screen.queryByTestId('held-invitation-note')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /join a household/i })).toBeInTheDocument()

    // And the other direction: a code held in another tab shows here.
    hold()
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: PENDING_KEY, newValue: 'x' }))
    })
    expect(screen.getByTestId('held-invitation-note')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // AC 10 — the organizer's card is back
  // -------------------------------------------------------------------------

  it('AC 10: with redemption shipped the organizer’s invitation card renders again', async () => {
    // The flag is read through the module, not through the test's getter, so
    // this is the real constant: TRUE since this story.
    const real = await vi.importActual('./lib/invitations.js')
    expect(real.INVITATIONS_REDEEMABLE).toBe(true)
  })
})
