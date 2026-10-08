// App's tests for the chore surface: its writes, re-reads, catch-up and
// capture. Split out of `App.test.jsx` by #553; every describe below moved
// verbatim with the comment above it. The fakes, the `vi.mock` calls and the
// shared `beforeEach` are in `src/test/support/appHarness.jsx`, which must stay
// the FIRST import.
import { api, choresApi, captureApi, exclusionsApi, calendarApi, actualCapacity, renderApp } from './test/support/appHarness.jsx'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    api.listHouseholds.mockResolvedValue([household])
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

  it('#305: "Didn’t happen" goes through missChore with the chore on screen, then re-reads', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /say placeholder chore did not happen/i })),
    )

    expect(choresApi.missChore).toHaveBeenCalledWith('c1')
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Written before it is re-read, as every other write here is.
    expect(choresApi.missChore.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('#305: "Put it back" on the Done tab goes through unmissChore, then re-reads', async () => {
    choresApi.listChores.mockResolvedValue([{ ...chore, missed_at: '2026-08-25T09:00:00Z' }])
    await renderApp('Done')
    const back = await screen.findByRole('button', {
      name: /put placeholder chore back on the list — it was marked not done/i,
    })

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(back))

    expect(choresApi.unmissChore).toHaveBeenCalledWith('c1')
    expect(choresApi.missChore).not.toHaveBeenCalled()
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
    api.listHouseholds.mockResolvedValue([household])
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
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /start a household/i })
    expect(exclusionsApi.listExclusions).not.toHaveBeenCalled()
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
    api.listHouseholds.mockResolvedValue([household])
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
      '3 repeat occurrences older than the catch-up window were skipped rather than piled onto this week.',
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
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([doneChore])
  })

  it('saves the adjusted value through the data layer, then re-reads from the server', async () => {
    // On the Done tab since #302 — a completed row no longer renders on the
    // chore tab. The subject (the write, then the re-read) is unchanged; only
    // the arrangement moved with the row.
    await renderApp('Done')
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

// #213 — the chore capture flow, wired. What App owes, as for #210: that a
// description reaches lib/capture.js with the household ON SCREEN, today on
// the household's calendar and the person typing (and NOT the Supabase
// client); that asking is not a mutation — nothing re-reads and nothing is
// written; and that confirming goes through the same addChores a typed batch
// uses, with the household on screen and `source: 'extraction'` on every row,
// followed by the same re-read.
describe('chores — described in plain language (#213)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }
  const chore = { id: 'c1', household_id: 'h1', title: 'Placeholder Chore', expected_minutes: 20, due_on: '2026-08-10' }
  const PROPOSAL = {
    outcome: 'proposal',
    rows: [
      {
        key: 'proposed-1',
        title: 'mow the grass',
        minutes: '45',
        dueOn: '2026-08-29',
        problem: null,
        note: 'Read as “mow the grass”, 45 min, due “Saturday”.',
        derivedFrom: { title: 'mow the grass', expectedMinutes: 45, dueDate: 'Saturday', repeat: null, assignee: null },
      },
    ],
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    choresApi.listChores.mockResolvedValue([chore])
    captureApi.extractChores.mockResolvedValue(PROPOSAL)
  })

  const onTheChores = async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')
  }

  const describeChores = async (text) => {
    fireEvent.change(screen.getByLabelText(/what needs doing this week/i), { target: { value: text } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /work out the chores/i })))
  }

  it('asks through lib/capture.js with the household on screen, today on its calendar and the person typing — and writes nothing', async () => {
    await onTheChores()
    const readsBefore = choresApi.listChores.mock.calls.length
    await describeChores('takes about 45 min to mow the grass')

    expect(captureApi.extractChores).toHaveBeenCalledTimes(1)
    expect(captureApi.extractChores).toHaveBeenCalledWith({
      householdId: 'h1',
      text: 'takes about 45 min to mow the grass',
      // Today in America/New_York, as `localTodayIn` says it — the same call
      // the tab's skip picker is handed, never the phone's zone.
      todayIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      speaker: 'Placeholder One',
    })
    // The proposal is on screen, editable, and NOTHING has been written or
    // re-read: a proposal is not a mutation.
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('mow the grass')
    expect(choresApi.addChores).not.toHaveBeenCalled()
    expect(choresApi.addChore).not.toHaveBeenCalled()
    expect(choresApi.listChores.mock.calls.length).toBe(readsBefore)
  })

  it('confirming goes through addChores with the household on screen and source extraction on every row, then re-reads', async () => {
    choresApi.addChores.mockResolvedValue([{ ok: true, chore: { id: 'n1' } }])
    await onTheChores()
    await describeChores('takes about 45 min to mow the grass')

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add these chores/i })))

    expect(choresApi.addChores).toHaveBeenCalledTimes(1)
    expect(choresApi.addChores).toHaveBeenCalledWith(
      [{ title: 'mow the grass', expectedMinutes: '45', dueOn: '2026-08-29', source: 'extraction' }],
      { householdId: household.id },
    )
    await waitFor(() => expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore))
    expect(choresApi.addChores.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
    // Everything landed, so the list is gone.
    expect(screen.queryByLabelText(/title for chore 1/i)).not.toBeInTheDocument()
  })

  it('AC 6: when the endpoint fails, the typed form is the road in, and it is the SAME add path', async () => {
    captureApi.extractChores.mockResolvedValue({ outcome: 'failed', sentence: 'The extraction service could not answer.' })
    await onTheChores()
    await describeChores('takes about 45 min to mow the grass')

    expect(screen.getByTestId('capture-failure')).toHaveTextContent(/could not answer/)
    expect(screen.getByLabelText(/^chore$/i)).toHaveFocus()
    expect(choresApi.addChores).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))
    expect(choresApi.addChore).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dishes', expectedMinutes: '20', dueOn: '2026-08-10', householdId: 'h1' }),
    )
  })

  it('the proposer never touches the Supabase client from App — it goes through lib/capture.js', async () => {
    // getSupabase throws in this file's mock, so the flow completing to a
    // proposal on screen is the assertion — #210's shape.
    await onTheChores()
    await describeChores('takes about 45 min to mow the grass')
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('mow the grass')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// #101 — importing a calendar event as a chore, at the level only App can
// answer: the WIRING. Chores.test.jsx covers what the section DRAWS and which
// handler a tap reaches; everything here is about what App does with that —
// which read fills the "already imported" marks, which write the confirm
// reaches and in what order, and what happens on the phone that loses the race.
describe('importing a calendar event as a chore (#101)', () => {
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
  const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'
  const READONLY = 'https://www.googleapis.com/auth/calendar.readonly'
  const narrow = { id: 'c1', member_id: 'm1', scope: FREEBUSY, connected_at: '2026-08-24T00:00:00Z' }
  const widened = { ...narrow, scope: `${FREEBUSY} ${READONLY}` }
  const event = {
    id: 'evt-1',
    title: 'Placeholder Event',
    start: '2026-09-10T17:00:00.000Z',
    end: '2026-09-10T18:30:00.000Z',
    allDay: false,
    durationMinutes: 90,
    dueOn: '2026-09-10',
  }

  let assign
  let realLocation

  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    assign = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search: '', hash: '', assign },
    })
    globalThis.sessionStorage?.clear?.()
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([widened])
    calendarApi.fetchCalendarEvents.mockResolvedValue({ ok: true, events: [event] })
    choresApi.addChore.mockResolvedValue({ id: 'c-new', title: 'Placeholder Event' })
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
  })

  const inChores = () => within(screen.getByRole('region', { name: /what needs doing/i }))
  const openImport = () =>
    act(
      async () =>
        void fireEvent.click(inChores().getByRole('button', { name: /import from calendar/i })),
    )
  const pickEvent = () =>
    act(
      async () =>
        void fireEvent.click(inChores().getByRole('button', { name: /import placeholder event/i })),
    )
  const submitAdd = () =>
    act(async () => void fireEvent.click(inChores().getByRole('button', { name: /add chore/i })))

  it('reads the import ledger BY HOUSEHOLD on every refresh, like every other row', async () => {
    await renderApp('Chores')
    expect(calendarApi.listCalendarImports).toHaveBeenCalledWith('h1')
  })

  it('offers the import on the Chores tab to a member whose OWN calendar is connected', async () => {
    await renderApp('Chores')
    expect(inChores().getByRole('button', { name: /import from calendar/i })).toBeInTheDocument()
  })

  it('offers nothing when only a housemate is connected — their calendar is not this phone’s to read', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([{ ...widened, member_id: 'm2' }])
    await renderApp('Chores')
    expect(inChores().queryByRole('button', { name: /import from calendar/i })).not.toBeInTheDocument()
  })

  it('AC 1: a free/busy-only connection gets the consent step, and Allow leaves for Google with the readonly scope ADDED', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([narrow])
    await renderApp('Chores')
    await openImport()
    expect(inChores().getByTestId('import-consent')).toBeInTheDocument()
    // Nothing was asked of the Edge Function: the row already says the scope
    // is too narrow, and a call would only be refused.
    expect(calendarApi.fetchCalendarEvents).not.toHaveBeenCalled()

    await act(
      async () =>
        void fireEvent.click(inChores().getByRole('button', { name: /allow reading events/i })),
    )
    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0])
    // `startConnect` is REAL here, so this is the URL the app would send.
    expect(url.searchParams.get('scope')).toBe(`openid ${READONLY}`)
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('prompt')).toBe('consent')
    // The household on screen travels with the state, so the widened token
    // lands on the connection the member was looking at (#161's rule).
    expect(globalThis.sessionStorage.getItem('taskr.calendar.consent-household')).toBe('h1')
  })

  it('AC 2: opening the section asks the function for THIS household and THIS week, and lists what came back', async () => {
    await renderApp('Chores')
    await openImport()
    await waitFor(() => expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledTimes(1))
    const [call] = calendarApi.fetchCalendarEvents.mock.calls
    expect(call[0].householdId).toBe('h1')
    expect(call[0].periodStart).toBe(actualCapacity.periodStartFor(new Date(), household.timezone))
    expect(await inChores().findByText('Placeholder Event')).toBeInTheDocument()
    // Listing wrote nothing: no addChore, no ledger row.
    expect(choresApi.addChore).not.toHaveBeenCalled()
    expect(calendarApi.recordCalendarImport).not.toHaveBeenCalled()
  })

  it('AC 3 / AC 4: Use prefills the form, and Add writes the chore through addChore with source calendar, THEN the ledger row naming it', async () => {
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    await pickEvent()

    // The prefill is the data layer's, shown in the form the member already knows.
    expect(inChores().getByLabelText(/^chore$/i)).toHaveValue('Placeholder Event')
    expect(inChores().getByLabelText(/expected minutes/i)).toHaveValue(90)
    expect(inChores().getByLabelText(/^due$/i)).toHaveValue('2026-09-10')
    expect(inChores().getByTestId('import-source')).toHaveTextContent(/from your calendar/i)
    // Nothing written by picking.
    expect(choresApi.addChore).not.toHaveBeenCalled()

    // The member edits the minutes — editable before save is the criterion —
    // and confirms with the ordinary Add.
    fireEvent.change(inChores().getByLabelText(/expected minutes/i), { target: { value: '60' } })
    await submitAdd()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    expect(choresApi.addChore).toHaveBeenCalledWith({
      title: 'Placeholder Event',
      expectedMinutes: '60',
      dueOn: '2026-09-10',
      repeatKind: 'none',
      repeatWeekdays: [],
      repeatMonthday: '',
      source: 'calendar',
      householdId: 'h1',
    })
    expect(calendarApi.recordCalendarImport).toHaveBeenCalledWith({
      householdId: 'h1',
      memberId: 'm1',
      calendarEventId: 'evt-1',
      choreId: 'c-new',
    })
    // ORDER: the chore first, then the row naming it — the ledger needs the id
    // the write returned, and this is what makes the race resolve the way
    // 0038's header says.
    expect(choresApi.addChore.mock.invocationCallOrder[0]).toBeLessThan(
      calendarApi.recordCalendarImport.mock.invocationCallOrder[0],
    )
    // No second write path: addChores was never touched.
    expect(choresApi.addChores).not.toHaveBeenCalled()
    // And the screen re-read, like every other write.
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('AC 5: already-imported events are marked from the ledger and offer no Use', async () => {
    calendarApi.listCalendarImports.mockResolvedValue([
      { id: 'i1', household_id: 'h1', member_id: 'm2', calendar_event_id: 'evt-1', chore_id: 'c9' },
    ])
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    expect(inChores().getByTestId('imported-evt-1')).toHaveTextContent(/already imported/i)
    expect(
      inChores().queryByRole('button', { name: /import placeholder event/i }),
    ).not.toBeInTheDocument()
  })

  it('AC 5: on the phone that LOSES the race, the ledger’s refusal removes the chore just created and says so', async () => {
    const refused = new Error('That event is already on the list as a chore.')
    refused.alreadyImported = true
    calendarApi.recordCalendarImport.mockRejectedValue(refused)
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    await pickEvent()
    await submitAdd()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    expect(choresApi.removeChore).toHaveBeenCalledWith('c-new')
    expect(await inChores().findByText(/already on the list as a chore/i)).toBeInTheDocument()
  })

  it('a ledger failure for any OTHER reason leaves the chore standing — the household still wants it', async () => {
    calendarApi.recordCalendarImport.mockRejectedValue(
      new Error('recording the import: the network went away'),
    )
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    await pickEvent()
    await submitAdd()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    expect(choresApi.removeChore).not.toHaveBeenCalled()
    expect(await inChores().findByText(/the network went away/i)).toBeInTheDocument()
  })

  it('a stale connection row: the function’s own scope refusal lands as the consent step, not as an outage', async () => {
    const refused = new Error(
      'This calendar is connected for free/busy only. Allow Taskr to read events to import one.',
    )
    refused.needsScope = true
    calendarApi.fetchCalendarEvents.mockRejectedValue(refused)
    await renderApp('Chores')
    await openImport()
    expect(await inChores().findByTestId('import-consent')).toBeInTheDocument()
    expect(inChores().getByRole('button', { name: /allow reading events/i })).toBeInTheDocument()
  })
})
