// App's tests for the split: capacity, the re-balance and the fairness note.
// Split out of `App.test.jsx` by #553; every describe below moved verbatim with
// the comment above it. The fakes, the `vi.mock` calls and the shared
// `beforeEach` are in `src/test/support/appHarness.jsx`, which must stay the
// FIRST import.
import { api, choresApi, captureApi, capacityApi, reassignApi, announceApi, calendarApi, actualAnnounce, actualCapacity, renderApp } from './test/support/appHarness.jsx'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('capacity — this week, set by hand (#46)', () => {
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
    // entry must work on day one and the extraction bet (#210) is an accelerator
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

  // -------------------------------------------------------------------------
  // #471 — the split's done minutes are THIS WEEK's, not the household's
  // whole history.
  //
  // At the App level rather than in Split.test.jsx, because the week filter
  // lives where the period and the zone live: App hands the split
  // `choresInWeek(chores, …)` and the component draws what it is given. A
  // component test could only prove the component sums what it is handed —
  // which it did, correctly, for three weeks while the owner's phone read
  // 1045 min done against 150 this week. The dates are relative to NOW for the
  // same reason `overrideThisWeek` refuses a literal: the period is computed
  // from today.
  // -------------------------------------------------------------------------

  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

  it('#471: a completion from an earlier capacity week contributes nothing to the split', async () => {
    capacityApi.listCapacity.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([
      // Still to do — counts as open whatever its due date.
      { id: 'c-open', title: 'Placeholder Chore', expected_minutes: 20, due_on: '2026-08-10', completed_at: null, missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
      // Done this week — the only completion the bar may count.
      { id: 'c-now', title: 'Placeholder Other Chore', expected_minutes: 30, due_on: null, completed_at: daysAgo(0), missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
      // Done two weeks ago — history. Before #471 this was "done" every week
      // for ever, and its 200 min is what turns "50 of 300" into "250 of 300".
      { id: 'c-then', title: 'Placeholder Done Chore', expected_minutes: 200, due_on: null, completed_at: daysAgo(14), missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
    ])
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    const row = screen.getByTestId('split-m1')
    expect(row).toHaveTextContent('30 min done')
    expect(row).toHaveTextContent('20 min still to do')
    expect(row).toHaveTextContent('50 of 300 min')
    expect(row, 'the lifetime sum must not reach the bar').not.toHaveTextContent('230 min done')
  })

  it('#471: the seen-marker snapshot is the split this member was shown — this week only', async () => {
    // The announcement compares what a member last saw with what they see
    // now (#50). Both must be built from the same week-scoped list, or a
    // completion from July would sit in the snapshot for ever and every
    // "since you last looked" delta would carry it.
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    ])
    capacityApi.listCapacity.mockResolvedValue([])
    announceApi.readSplitSeen.mockResolvedValue(null)
    choresApi.listChores.mockResolvedValue([
      { id: 'c-open', title: 'Placeholder Chore', expected_minutes: 20, due_on: '2026-08-10', completed_at: null, missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
      { id: 'c-now', title: 'Placeholder Other Chore', expected_minutes: 30, due_on: null, completed_at: daysAgo(0), missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
      { id: 'c-then', title: 'Placeholder Done Chore', expected_minutes: 200, due_on: null, completed_at: daysAgo(14), missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
    ])
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(announceApi.writeSplitSeen).toHaveBeenCalledWith({
      memberId: 'm1',
      snapshot: { members: [{ id: 'm1', minutes: 50, capacityMinutes: 300 }] },
      seenRebalanceAt: null,
    })
  })

  it('#471 POSITIVE CONTROL: the same completion dated THIS week is counted', async () => {
    // Without this, the assertion above passes identically if completions
    // stopped counting altogether — the opposite defect, and #47 criterion 7's
    // own test only covers the component.
    capacityApi.listCapacity.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([
      { id: 'c-open', title: 'Placeholder Chore', expected_minutes: 20, due_on: '2026-08-10', completed_at: null, missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
      { id: 'c-then', title: 'Placeholder Done Chore', expected_minutes: 200, due_on: null, completed_at: daysAgo(0), missed_at: null, assigned_member_id: 'm1', actual_minutes: null },
    ])
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getByTestId('split-m1')).toHaveTextContent('200 min done')
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
    api.listHouseholds.mockResolvedValue([{
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
    }])
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
    api.listHouseholds.mockResolvedValue([household])
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
    api.listHouseholds.mockResolvedValue([household])
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

describe('#284 — dealing out the work nobody has, from the split', () => {
  // The state #52's driven setup run stalled in: two people with minutes,
  // every chore entered, nothing assigned, and the household on its FIRST
  // screen. Two chores stand in for thirteen.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const nobodyHas = [
    {
      id: 'c1',
      household_id: 'h1',
      title: 'Placeholder Chore',
      expected_minutes: 60,
      due_on: '2026-08-10',
      assigned_member_id: null,
    },
    {
      id: 'c2',
      household_id: 'h1',
      title: 'Placeholder Other Chore',
      expected_minutes: 45,
      due_on: '2026-08-10',
      assigned_member_id: null,
    },
  ]

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 200, claimed_by: 'person-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 240 },
    ])
    choresApi.listChores.mockResolvedValue(nobodyHas)
  })

  const pressDealOut = async () => {
    await act(async () =>
      void fireEvent.click(await screen.findByRole('button', { name: /deal these out/i })),
    )
  }

  it('AC 1: the action runs the stored re-assignment for the household on screen, then re-reads', async () => {
    await renderApp()
    const readsBefore = choresApi.listChores.mock.calls.length
    await pressDealOut()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
    // Re-read from the server after the run, never patched from the response:
    // what the next device to load will see is what this one now shows.
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore)
    expect(reassignApi.reassignHousehold.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('AC 3: one press on the first screen — no capacity write, no per-chore assignment, no tab', async () => {
    // `renderApp()` with no surface: the split is where a joined household
    // lands (the 2026-08-06 decision), so the route is reachable with no
    // navigation at all. Nothing that a capacity edit or a Who dropdown would
    // reach is touched — the side door #52 named stays shut.
    await renderApp()
    await pressDealOut()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(capacityApi.clearCapacity).not.toHaveBeenCalled()
    expect(api.updateMember).not.toHaveBeenCalled()
    expect(choresApi.updateChore).not.toHaveBeenCalled()
  })

  it('AC 2: it is the one run a capacity change makes — no planner of its own', async () => {
    // The manual pin (#49 AC 4) is a property of `reassignHousehold`, so the
    // claim at this level is that App reached THAT and built no second path:
    // `planReassignment` is stubbed too and must stay untouched.
    await renderApp()
    await pressDealOut()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    expect(reassignApi.planReassignment).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL: with every chore held, the split offers no such action', async () => {
    choresApi.listChores.mockResolvedValue(
      nobodyHas.map((c, i) => ({ ...c, assigned_member_id: i ? 'm2' : 'm1', assigned_source: 'manual' })),
    )
    await renderApp()
    await screen.findByTestId('split-verdict')
    expect(screen.queryByRole('button', { name: /deal these out/i })).toBeNull()
  })

  it('is disabled while the run is in flight — the tabs and this control alike', async () => {
    let finish
    reassignApi.reassignHousehold.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await renderApp()
    const button = await screen.findByRole('button', { name: /deal these out/i })
    await act(async () => void fireEvent.click(button))
    expect(button).toBeDisabled()
    await act(async () => void finish({ applied: 2, assignments_version: 1 }))
    expect(screen.getByRole('button', { name: /deal these out/i })).not.toBeDisabled()
  })

  it('a refused run reports itself on the split and leaves the control usable', async () => {
    reassignApi.reassignHousehold.mockRejectedValue(
      new Error('applying the re-assignment: the household moved'),
    )
    await renderApp()
    await pressDealOut()
    expect(await screen.findByRole('alert')).toHaveTextContent(/the household moved/i)
    expect(screen.getByRole('button', { name: /deal these out/i })).not.toBeDisabled()
  })
})

describe('capacity — described in plain language (#210)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }
  const PROPOSAL = { outcome: 'proposal', minutes: 180, derivedFrom: { who: 'me', minutes: 180 } }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    captureApi.extractCapacity.mockResolvedValue(PROPOSAL)
  })

  const openTheWeekEditor = async () =>
    act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set this week for placeholder one/i })),
    )

  const describeWeek = async (text) => {
    fireEvent.change(screen.getByLabelText(/describe this week for placeholder one/i), {
      target: { value: text },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /work out the minutes/i })))
  }

  const saveProposed = () =>
    act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /save the proposed figure for placeholder one/i })),
    )

  const save = () => act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

  const onTheRoster = async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
  }

  it('asks through lib/capture.js with the household on screen and this member, and writes nothing', async () => {
    await onTheRoster()
    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')

    expect(captureApi.extractCapacity).toHaveBeenCalledTimes(1)
    expect(captureApi.extractCapacity).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        text: 'I have three hours this week',
        member: expect.objectContaining({ id: 'm1' }),
        members: [expect.objectContaining({ id: 'm1' })],
      }),
    )
    expect(screen.getByTestId('proposal-m1')).toHaveTextContent('180 min')
    expect(screen.getByLabelText(/minutes this week for placeholder one/i)).toHaveValue(180)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
    // Not a mutation: a proposal is not a change, so nothing re-reads after it.
    expect(capacityApi.listCapacity.mock.calls.length).toBe(readsBefore)
  })

  it('AC 9: one tap on the proposal writes capacity ONCE, with source extraction, then re-assigns and re-reads', async () => {
    await onTheRoster()
    const readsBefore = capacityApi.listCapacity.mock.calls.length
    const readPeriod = capacityApi.listCapacity.mock.calls[0][0]
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your description/i)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()

    await saveProposed()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith({
      memberId: 'm1',
      periodStart: readPeriod,
      minutes: '180',
      source: 'extraction',
      householdId: 'h1',
    })
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('a typed figure still goes through the same call, with source manual', async () => {
    await onTheRoster()
    await openTheWeekEditor()
    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value: '120' },
    })
    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', minutes: '120', source: 'manual' }),
    )
  })

  it('AC 3: leaving for another surface after a proposal writes nothing', async () => {
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Split' })))
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('AC 3: a reload starts clean — nothing was kept on the device to apply later', async () => {
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    // Nothing persisted: a proposal lives in component state and nowhere else.
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)

    cleanup()
    await onTheRoster()
    await openTheWeekEditor()
    expect(screen.getByLabelText(/minutes this week for placeholder one/i)).toHaveValue(300)
    expect(screen.queryByTestId('capture-proposal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
  })

  it('AC 2: when the service cannot answer, the same flow saves a typed figure as manual', async () => {
    captureApi.extractCapacity.mockResolvedValue({
      outcome: 'failed',
      sentence: 'The extraction service could not answer: Failed to send a request to the Edge Function',
    })
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    expect(screen.getByTestId('capture-failure')).toHaveTextContent(/could not answer/)
    expect(screen.queryByRole('alert'), 'a failed proposal is not an app error').not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value: '90' },
    })
    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ minutes: '90', source: 'manual' }),
    )
  })

  it('the proposer never touches the Supabase client from App — it goes through lib/capture.js', async () => {
    // getSupabase throws in this file's mock, so the flow completing to a
    // proposal on screen is the assertion.
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    expect(screen.getByTestId('proposal-m1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #480 — a week's budget suggested from the last weeks' completions. The
// arithmetic is capacity.suggest.test.js and the block is Roster.test.jsx;
// what App owes is the READ (once per refresh, for the whole household, not
// waited for) and the FOLD reaching the roster, and that the automatic path
// is never handed the figure.
// ---------------------------------------------------------------------------
describe('#480 — a week suggested from the last weeks', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  const mondays = () => actualCapacity.priorPeriodStarts(week(), 4)
  // Joined at the start of the second-to-last prior week, so exactly two
  // completed prior weeks exist — the floor, and a median that is easy to
  // read off the fixture.
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 300,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
    created_at: `${mondays()[2]}T12:00:00Z`,
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
    created_at: `${mondays()[2]}T12:00:00Z`,
  }
  const doneOn = (id, monday, minutes, holder = 'm1') => ({
    id,
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: minutes,
    actual_minutes: null,
    due_on: monday,
    completed_at: `${monday}T16:00:00Z`,
    completed_by_member_id: holder,
    assigned_member_id: holder,
    missed_at: null,
    repeat_kind: 'none',
  })
  const twoWeeks = () => [doneOn('c1', mondays()[2], 100), doneOn('c2', mondays()[3], 120)]
  const region = () => screen.findByRole('region', { name: /who is in the household/i })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
  })

  it('AC 5: reads the prior weeks’ busy figures ONCE per refresh, for the whole household and the whole window', async () => {
    await renderApp('Who')
    await region()
    await waitFor(() => expect(calendarApi.listBusyHistory).toHaveBeenCalled())
    // One per refresh — the roster read is once per refresh too, so the two
    // counts agree; a read per member or per week would be 2× or 4× it.
    expect(calendarApi.listBusyHistory.mock.calls.length).toBe(api.listMembers.mock.calls.length)
    const [periods, memberIds] = calendarApi.listBusyHistory.mock.calls.at(-1)
    expect(periods).toEqual(mondays())
    expect(memberIds).toEqual(['m1', 'm2'])
  })

  it('AC 5: the roster paints — suggestion included — while the history read is still in flight', async () => {
    // A read that never settles. The roster, this week's figure and the
    // suggestion (from the chores the foreground read carries) must all be
    // on screen regardless; the calendar half of the reason says it is
    // missing rather than the block waiting for it.
    calendarApi.listBusyHistory.mockImplementation(() => new Promise(() => {}))
    choresApi.listChores.mockResolvedValue(twoWeeks())
    await renderApp('Who')
    await region()
    expect(screen.getByTestId('week-m1')).toHaveTextContent(/This week: 300 min/)
    expect(calendarApi.listBusyHistory).toHaveBeenCalled()
    const block = await screen.findByTestId('suggested-m1')
    expect(block).toHaveTextContent(/suggested: 110 min/i)
    expect(block).toHaveTextContent(/typically 110 min done over 2 weeks/)
  })

  it('the fold reaches the roster: completions and the prior weeks’ busy rows become the figure', async () => {
    choresApi.listChores.mockResolvedValue(twoWeeks())
    calendarApi.listBusyHistory.mockResolvedValue([
      { id: 'h1', member_id: 'm1', period_start: mondays()[2], busy_minutes: 60, event_count: 1, computed_at: '2026-09-01T00:00:00Z' },
      { id: 'h2', member_id: 'm1', period_start: mondays()[3], busy_minutes: 60, event_count: 1, computed_at: '2026-09-08T00:00:00Z' },
    ])
    calendarApi.listBusyWeeks.mockResolvedValue([
      { id: 'b1', member_id: 'm1', period_start: week(), busy_minutes: 90, event_count: 2, computed_at: new Date().toISOString() },
    ])
    await renderApp('Who')
    await region()
    // Median of 100 and 120 is 110; this week is 30 busier than the usual 60.
    const block = await screen.findByTestId('suggested-m1')
    await waitFor(() => expect(block).toHaveTextContent(/calendar 30 min busier this week/))
    expect(block).toHaveTextContent(/suggested: 80 min/i)
    // The housemate did nothing in EITHER week — no history, not a history of
    // zero (design-bar verdict, 2026-09-16), so their row offers nothing.
    expect(screen.queryByTestId('suggested-m2')).not.toBeInTheDocument()
  })

  it('AC 4: history alone writes nothing — the automatic path is handed the calendar, never the suggestion', async () => {
    // #106's seam, fired the way its own tests fire it: a connection, a stale
    // row, the fetch lands. The calendar says 0 busy, so its suggestion is the
    // baseline and the decision is no-change. The HISTORY says 200 — inside
    // the bound of 300 — and if it reached the decision the week would be
    // written. It must not be.
    const connection = { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' }
    const HOUR = 60 * 60 * 1000
    const rowReadAgo = (msAgo, busy) => ({
      id: 'b1',
      member_id: 'm1',
      period_start: week(),
      busy_minutes: busy,
      event_count: 0,
      computed_at: new Date(Date.now() - msAgo).toISOString(),
    })
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    choresApi.listChores.mockResolvedValue([doneOn('c1', mondays()[2], 200), doneOn('c2', mondays()[3], 200)])
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([rowReadAgo(13 * HOUR, 0)])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    calendarApi.listBusyWeeks.mockResolvedValue([rowReadAgo(0, 0)])
    await act(async () => finish({ ok: true }))
    await act(async () => {})
    // POSITIVE CONTROL: the suggestion exists and differs from the week.
    expect(await screen.findByTestId('suggested-m1')).toHaveTextContent(/suggested: 200 min/i)
    expect(screen.getByTestId('week-m1')).toHaveTextContent(/This week: 300 min/)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('a failed history read costs the calendar half of the reason and nothing else', async () => {
    calendarApi.listBusyHistory.mockRejectedValue(new Error('permission denied'))
    choresApi.listChores.mockResolvedValue(twoWeeks())
    await renderApp('Who')
    await region()
    const block = await screen.findByTestId('suggested-m1')
    expect(block).toHaveTextContent(/suggested: 110 min/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
