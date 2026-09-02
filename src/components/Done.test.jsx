import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Done from './Done.jsx'

// #302 — completed work on its own surface, grouped by capacity week.
//
// Two kinds of test live here. The ones headed #35 and #12 MOVED from
// Chores.test.jsx with the group they were about, fixtures copied verbatim
// (`chores`, `mixed`, `doneOneOff` below are Chores.test.jsx's, character for
// character) — that is #302 AC 2's condition, and it is what shows the row
// on this surface is the same row. The ones headed #302 are new. Chore names
// are synthetic — see #19.

const chores = [
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
    expected_minutes: 90,
    due_on: '2026-08-11',
    completed_at: null,
    completed_by_member_id: null,
  },
]

/** The same two chores with the second one finished — #35's mixed fixture. */
const mixed = [chores[0], { ...chores[1], completed_at: '2026-08-08T10:00:00Z', completed_by_member_id: 'm1' }]

/** #12's finished one-off, verbatim from Chores.test.jsx. */
const doneOneOff = {
  id: 'c7',
  household_id: 'h1',
  title: 'Placeholder Done Chore',
  expected_minutes: 30,
  due_on: '2026-08-12',
  completed_at: '2026-08-12T10:00:00Z',
  completed_by_member_id: 'm1',
  actual_minutes: 45,
}

/**
 * #302 AC 5 — completed chores from TWO capacity weeks (New York): the second
 * chore finished in the week of Aug 24, the one-off in the week of Aug 10,
 * plus one outstanding row that must appear nowhere on this surface. The same
 * fixture, by construction, as Chores.test.jsx's `twoWeeks`.
 */
const twoWeeks = [
  chores[0],
  { ...chores[1], completed_at: '2026-08-25T10:00:00Z', completed_by_member_id: 'm1' },
  doneOneOff,
]

const members = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'device-a' },
  { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null },
]

function setup(overrides = {}) {
  const handlers = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn().mockResolvedValue(undefined),
    onUncomplete: vi.fn().mockResolvedValue(undefined),
    onAssign: vi.fn().mockResolvedValue(undefined),
    onUnassign: vi.fn().mockResolvedValue(undefined),
    onExclude: vi.fn().mockResolvedValue(undefined),
    onAllow: vi.fn().mockResolvedValue(undefined),
    onSkip: vi.fn().mockResolvedValue(undefined),
    onRecordActual: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Done
      chores={mixed}
      members={members}
      exclusions={[]}
      repeatExceptions={[]}
      todayIso="2026-08-24"
      timezone="America/New_York"
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

/** The whole surface: the region the h2 names, as distinct from any week group. */
const surface = () => screen.getByRole('region', { name: 'Done' })

// ---------------------------------------------------------------------------
// #302 — the grouping, ACs 2 and 5.
// ---------------------------------------------------------------------------

describe('#302 — completed work by capacity week', () => {
  it('AC 2 / AC 5: two capacity weeks are two groups, newest week first, each headed by its dates', () => {
    setup({ chores: twoWeeks })
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Aug 24 – Aug 30, 2026', 'Aug 10 – Aug 16, 2026'])

    const thisWeek = screen.getByRole('region', { name: 'Aug 24 – Aug 30, 2026' })
    const earlier = screen.getByRole('region', { name: 'Aug 10 – Aug 16, 2026' })
    expect(within(thisWeek).getByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(within(earlier).getByText('Placeholder Done Chore')).toBeInTheDocument()
    // Both rows in ONE group is the failure AC 5 names, and it reads red here.
    expect(within(thisWeek).queryByText('Placeholder Done Chore')).not.toBeInTheDocument()
    expect(within(earlier).queryByText('Placeholder Other Chore')).not.toBeInTheDocument()
  })

  it('opens only the NEWEST week; earlier weeks sit closed behind their heading (owner decision, design-bar 2026-09-01)', () => {
    setup({ chores: twoWeeks })
    const weeks = [...document.querySelectorAll('details.chore-done__week')]
    expect(weeks).toHaveLength(2)
    expect(weeks[0].open).toBe(true)
    expect(weeks[1].open).toBe(false)
    // The closed week still says how much it holds, so nobody has to open it
    // to learn whether anything happened.
    expect(weeks[1]).toHaveTextContent(/1 chore/)
    // And the heading is the disclosure's own summary, not a sibling of it.
    expect(weeks[1].querySelector('summary h3')).toHaveTextContent('Aug 10 – Aug 16, 2026')
  })

  it('AC 5: the outstanding chore is on this surface nowhere', () => {
    setup({ chores: twoWeeks })
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark .* done/i })).not.toBeInTheDocument()
  })

  it('AC 2: two completions in ONE capacity week share one group', () => {
    setup({
      chores: [chores[0], twoWeeks[1], { ...doneOneOff, completed_at: '2026-08-27T10:00:00Z' }],
    })
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
    const group = screen.getByRole('region', { name: 'Aug 24 – Aug 30, 2026' })
    expect(within(group).getByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(within(group).getByText('Placeholder Done Chore')).toBeInTheDocument()
  })

  it('AC 2: the week is decided in the household’s zone, not UTC', () => {
    // Sunday 23:30 in New York is already Monday in UTC. Grouped in UTC this
    // row lands in the week of Aug 31; in the household's zone it is Aug 24's.
    setup({ chores: [{ ...doneOneOff, completed_at: '2026-08-31T03:30:00Z' }] })
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Aug 24 – Aug 30, 2026')
  })

  it('says so when nothing has been finished yet', () => {
    setup({ chores })
    expect(surface()).toHaveTextContent(/nothing finished yet/i)
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('reports a failed write beside the rows, outside every week group', () => {
    setup({ chores: mixed, error: 'the server said no' })
    expect(within(surface()).getByRole('alert')).toHaveTextContent('the server said no')
    const group = screen.getByRole('region', { name: 'Aug 3 – Aug 9, 2026' })
    expect(within(group).queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #35 — ACs 8 and 9, moved here with the group. AC 8 asked that completed
// chores stay visible SOMEWHERE; this surface is where. AC 9 binds it exactly
// as it bound the old group (#302 AC 3).
// ---------------------------------------------------------------------------

describe('completion — #35 ACs 8 and 9, on the Done surface', () => {
  it('offers the undo on a completed one instead', async () => {
    const { onUncomplete, onComplete } = setup({ chores: mixed })
    const doneRow = screen.getByText('Placeholder Other Chore').closest('li')
    expect(within(doneRow).queryByRole('button', { name: /mark .* done/i })).not.toBeInTheDocument()

    await clickAndSettle(within(doneRow).getByRole('button', { name: /put placeholder other chore back/i }))
    expect(onUncomplete).toHaveBeenCalledWith('c2')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('AC 8: completed chores stay visible, in their own group', () => {
    setup({ chores: mixed })
    const done = screen.getByRole('region', { name: 'Aug 3 – Aug 9, 2026' })
    expect(within(done).getByText('Placeholder Other Chore')).toBeInTheDocument()
    // And the outstanding one is NOT in that group.
    expect(within(done).queryByText('Placeholder Chore')).not.toBeInTheDocument()
  })

  it('AC 9: the surface carries no streak, rank, score or per-person total', () => {
    setup({ chores: twoWeeks })
    expect(surface()).not.toHaveTextContent(/streak|rank|score|points|leaderboard|best|winner/i)
    // No per-person figure: the member id in the fixture must not surface.
    expect(surface()).not.toHaveTextContent(/m1/)
  })

  it('AC 9: and nothing in it is styled as an error or an alert — red is for work, never people', () => {
    setup({ chores: twoWeeks })
    expect(within(surface()).queryByRole('alert')).not.toBeInTheDocument()
    expect(surface().querySelector('.error')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// #12 — the "Took (minutes)" control, moved here with the done row it sits on.
// ---------------------------------------------------------------------------

describe('#12 — expected-vs-actual capture, on the Done surface', () => {
  it('AC 2 — a completed chore says what it took beside what was expected', () => {
    setup({ chores: [doneOneOff] })
    const row = screen.getByText('Placeholder Done Chore').closest('li')
    expect(row).toHaveTextContent('30 min')
    expect(row).toHaveTextContent('took 45 min')
  })

  it('AC 1 — the done row offers the stored actual, prefilled', () => {
    setup({ chores: [doneOneOff] })
    const input = screen.getByLabelText('Minutes Placeholder Done Chore actually took')
    expect(input).toHaveValue(45)
  })

  it('AC 1 — a row completed before the column existed prefills with the estimate', () => {
    setup({ chores: [{ ...doneOneOff, actual_minutes: null }] })
    const input = screen.getByLabelText('Minutes Placeholder Done Chore actually took')
    expect(input).toHaveValue(30)
  })

  it('AC 1 — saving an adjusted actual calls the handler with the normalized value', async () => {
    const handlers = setup({ chores: [doneOneOff] })
    const input = screen.getByLabelText('Minutes Placeholder Done Chore actually took')
    fireEvent.change(input, { target: { value: '50' } })
    const row = screen.getByText('Placeholder Done Chore').closest('li')
    await clickAndSettle(within(row).getByRole('button', { name: /^save$/i }))
    expect(handlers.onRecordActual).toHaveBeenCalledWith('c7', 50)
  })

  it('AC 1 — a bad actual is refused with a sentence before any request', async () => {
    const handlers = setup({ chores: [doneOneOff] })
    const input = screen.getByLabelText('Minutes Placeholder Done Chore actually took')
    fireEvent.change(input, { target: { value: '-5' } })
    const row = screen.getByText('Placeholder Done Chore').closest('li')
    await clickAndSettle(within(row).getByRole('button', { name: /^save$/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/negative/i)
    expect(handlers.onRecordActual).not.toHaveBeenCalled()
  })

  it('AC 1 — zero is a legal actual: "it was already done" saves rather than argues', async () => {
    const handlers = setup({ chores: [doneOneOff] })
    const input = screen.getByLabelText('Minutes Placeholder Done Chore actually took')
    fireEvent.change(input, { target: { value: '0' } })
    const row = screen.getByText('Placeholder Done Chore').closest('li')
    await clickAndSettle(within(row).getByRole('button', { name: /^save$/i }))
    expect(handlers.onRecordActual).toHaveBeenCalledWith('c7', 0)
  })
})
