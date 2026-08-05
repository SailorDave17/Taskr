import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Roster from './Roster.jsx'

// ACs 2 and 4 (people with budgets, edited and removed) and the "pick yourself"
// half of AC 5. Names are synthetic — see #19.

const household = { id: 'h1', name: 'Placeholder Household', join_code: 'ABCD2345' }

const roster = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: null },
  { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 45, claimed_by: 'device-b' },
]

function setup(overrides = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onClaim: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
  }
  render(<Roster household={household} members={roster} me={null} {...handlers} {...overrides} />)
  return handlers
}

const rowFor = (name) => screen.getByText(name).closest('li')

/**
 * Click, and let the handler's promise settle inside act().
 *
 * The submit handlers clear their fields in a `.then()`, so the state update
 * lands a microtask after the click. Without this the assertion races it and
 * React warns — and the warning is the honest signal, not noise to silence.
 */
const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

describe('the join credential', () => {
  it('shows the code so the organizer can read it out — AC 1', () => {
    setup()
    expect(screen.getByTestId('join-code')).toHaveTextContent('ABCD2345')
  })

  it('states plainly that the code is deterrence, not a lock', () => {
    setup()
    expect(screen.getByText(/deterrence, not\s+a lock/i)).toBeInTheDocument()
  })
})

describe('sending the code — AC 1’s "or send"', () => {
  const shareButton = () => screen.getByRole('button', { name: /copy or send code/i })

  afterEach(() => {
    delete navigator.share
    delete navigator.clipboard
  })

  it('shares through the OS share sheet where one exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    navigator.share = share
    setup()

    await clickAndSettle(shareButton())

    // The message must carry the code itself, not just a link: the receiving
    // phone types it into the join box.
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('ABCD2345') }))
  })

  it('falls back to the clipboard, copying the bare code and nothing else', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }
    setup()

    await clickAndSettle(shareButton())

    // The bare code, because it is pasted into a field that expects exactly it.
    expect(writeText).toHaveBeenCalledWith('ABCD2345')
    expect(await screen.findByText(/code copied/i)).toBeInTheDocument()
  })

  it('says what to do instead when neither is available, rather than failing silently', async () => {
    setup()
    await clickAndSettle(shareButton())
    expect(await screen.findByText(/select the code above/i)).toBeInTheDocument()
  })

  it('treats a cancelled share as a non-event, not an error', async () => {
    navigator.share = vi.fn().mockRejectedValue(new Error('AbortError'))
    setup()

    await clickAndSettle(shareButton())

    // Cancelling a share sheet is the commonest outcome of opening one by
    // accident. It must not read as a failure.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('join-code')).toHaveTextContent('ABCD2345')
  })
})

describe('showing the roster', () => {
  it('lists each person with the budget that was stored', () => {
    setup()
    expect(within(rowFor('Placeholder One')).getByText(/120 min\/week/)).toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).getByText(/45 min\/week/)).toBeInTheDocument()
  })

  // 120 + 45. Written out rather than summed from the fixture, so the assertion
  // is a statement about what the total should be and not a restatement of how
  // the component computes it.
  it('totals the household budget', () => {
    setup()
    expect(screen.getByTestId('roster-total')).toHaveTextContent('165 min/week')
    expect(screen.getByTestId('roster-total')).toHaveTextContent('2 people')
  })

  it('says the roster is empty rather than showing an empty list', () => {
    setup({ members: [] })
    expect(screen.getByText(/nobody yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('roster-total')).not.toBeInTheDocument()
  })
})

describe('picking who you are on this device — AC 5', () => {
  it('offers unclaimed people when this device is nobody yet', () => {
    setup()
    expect(within(rowFor('Placeholder One')).getByRole('button', { name: /this is me/i })).toBeInTheDocument()
  })

  it('does not offer someone already claimed on another device', () => {
    setup()
    expect(
      within(rowFor('Placeholder Two')).queryByRole('button', { name: /this is me/i }),
    ).not.toBeInTheDocument()
  })

  it('offers nobody once this device already is someone', () => {
    setup({ me: roster[0] })
    expect(screen.queryByRole('button', { name: /this is me/i })).not.toBeInTheDocument()
  })

  it('marks which person this device is acting as', () => {
    setup({ me: roster[0] })
    expect(within(rowFor('Placeholder One')).getByText(/· you/)).toBeInTheDocument()
    expect(within(rowFor('Placeholder Two')).queryByText(/· you/)).not.toBeInTheDocument()
  })

  it('claims by member id, not by name', async () => {
    const { onClaim } = setup()
    await clickAndSettle(
      within(rowFor('Placeholder One')).getByRole('button', { name: /this is me/i }),
    )
    expect(onClaim).toHaveBeenCalledWith('m1')
  })
})

describe('adding someone — AC 2', () => {
  it('will not add a person with no name', () => {
    setup()
    expect(screen.getByRole('button', { name: /add to household/i })).toBeDisabled()
  })

  it('adds the name and budget that were typed', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    fireEvent.change(within(form).getByLabelText(/available minutes per week/i), {
      target: { value: '90' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({ displayName: 'Placeholder Three', weeklyMinutes: '90' })
  })

  it('clears the form after a person is added, so the next one starts empty', async () => {
    setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('')
  })

  it('keeps what was typed when the add fails, so nothing has to be retyped', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('network down'))
    render(
      <Roster
        household={household}
        members={roster}
        me={null}
        onAdd={onAdd}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClaim={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    const form = screen.getAllByRole('button', { name: /add to household/i })[0].closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    await clickAndSettle(within(form).getByRole('button', { name: /add to household/i }))

    expect(within(form).getByLabelText(/^name$/i)).toHaveValue('Placeholder Three')
  })

  it('defaults an omitted budget to zero rather than sending nothing', async () => {
    const { onAdd } = setup()
    const form = screen.getByRole('button', { name: /add to household/i }).closest('form')

    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: 'Placeholder Three' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /add to household/i }))

    expect(onAdd).toHaveBeenCalledWith({ displayName: 'Placeholder Three', weeklyMinutes: 0 })
  })
})

describe('editing and removing — AC 4', () => {
  it('saves the edited name and budget against the right person', async () => {
    const { onSave } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /^edit$/i }))

    fireEvent.change(screen.getByLabelText(/name for placeholder one/i), {
      target: { value: 'Placeholder One Renamed' },
    })
    fireEvent.change(screen.getByLabelText(/weekly minutes for placeholder one/i), {
      target: { value: '200' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith('m1', {
      displayName: 'Placeholder One Renamed',
      weeklyMinutes: '200',
    })
  })

  it('abandons an edit without saving it', () => {
    const { onSave } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /^edit$/i }))
    fireEvent.change(screen.getByLabelText(/name for placeholder one/i), {
      target: { value: 'Discard me' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
  })

  // Removing a person is destructive and there is no undo, so it takes two
  // deliberate taps. One tap on a phone in a pocket is not a decision.
  it('does not remove anyone on the first tap', () => {
    const { onRemove } = setup()
    fireEvent.click(within(rowFor('Placeholder One')).getByRole('button', { name: /remove placeholder one/i }))
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('removes only after the confirmation is tapped', async () => {
    const { onRemove } = setup()
    const row = rowFor('Placeholder One')
    fireEvent.click(within(row).getByRole('button', { name: /remove placeholder one/i }))
    await clickAndSettle(within(row).getByRole('button', { name: /remove placeholder one\?/i }))
    expect(onRemove).toHaveBeenCalledWith('m1')
  })

  it('can be backed out of after the first tap', () => {
    const { onRemove } = setup()
    const row = rowFor('Placeholder One')
    fireEvent.click(within(row).getByRole('button', { name: /remove placeholder one/i }))
    fireEvent.click(within(row).getByRole('button', { name: /^keep$/i }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
  })
})

describe('seeing another phone’s changes — AC 2', () => {
  // The agreed bar is "visible on next load/refresh", not live push, so the
  // refresh has to be reachable without closing the app.
  it('offers a refresh that re-reads from the server', () => {
    const { onRefresh } = setup()
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalled()
  })
})
