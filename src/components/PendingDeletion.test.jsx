// #430 — the restore banner. Values are synthetic — see #19.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PendingDeletion, { formatPurgeDate } from './PendingDeletion.jsx'

const PENDING = {
  household_id: 'household-1',
  household_name: 'Placeholder Household',
  deletion_requested_at: '2026-09-11T15:00:00Z',
  purge_after: '2026-09-18T15:00:00Z',
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
    expect(region).toHaveTextContent(formatPurgeDate(PENDING.purge_after))
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
})
