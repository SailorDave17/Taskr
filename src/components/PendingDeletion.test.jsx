// #430 — the restore banner. Values are synthetic — see #19.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PendingDeletion from './PendingDeletion.jsx'

// Relative to now, because the banner hides a household past its purge_after:
// a fixed date would turn this suite red on the day it passed.
const DAY = 86_400_000
const PENDING = {
  household_id: 'household-1',
  household_name: 'Placeholder Household',
  deletion_requested_at: new Date(Date.now() - DAY).toISOString(),
  purge_after: new Date(Date.now() + 6 * DAY).toISOString(),
}

describe('the restore banner (#430)', () => {
  it('renders nothing when no household is pending deletion', () => {
    const { container } = render(<PendingDeletion pending={[]} onRestore={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the household and the day it goes for good', () => {
    render(<PendingDeletion pending={[PENDING]} onRestore={vi.fn()} />)
    const region = screen.getByRole('region', { name: /scheduled for deletion/i })
    expect(region).toHaveTextContent(PENDING.household_name)
    // The month and the day of the month, each formatted on its own rather than
    // by formatPurgeDate — an expected value computed by the function under
    // test would agree with it whatever it printed.
    const purge = new Date(PENDING.purge_after)
    expect(region).toHaveTextContent(new Intl.DateTimeFormat(undefined, { month: 'long' }).format(purge))
    expect(region).toHaveTextContent(new RegExp(`\\b${purge.getDate()}\\b`))
  })

  it('restores the household it names, and nothing else', () => {
    const onRestore = vi.fn()
    render(<PendingDeletion pending={[PENDING]} onRestore={onRestore} />)
    fireEvent.click(screen.getByRole('button', { name: /restore/i }))
    expect(onRestore).toHaveBeenCalledWith('household-1')
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('holds the restore while another write is in flight', () => {
    render(<PendingDeletion pending={[PENDING]} onRestore={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled()
  })

  it('offers no restore once the deadline has passed, even to a tab that read the list before it', () => {
    const deadline = Date.parse(PENDING.purge_after)
    const { container } = render(<PendingDeletion pending={[PENDING]} onRestore={vi.fn()} now={deadline} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('POSITIVE CONTROL: a moment before the deadline it is still offered', () => {
    const deadline = Date.parse(PENDING.purge_after)
    render(<PendingDeletion pending={[PENDING]} onRestore={vi.fn()} now={deadline - 1} />)
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
  })
})
