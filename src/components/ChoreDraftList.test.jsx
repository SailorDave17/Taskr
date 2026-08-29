import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ChoreDraftList from './ChoreDraftList.jsx'

// #220 AC 7 — the review list takes its rows as INPUT. Every fixture here is
// built by hand, with no batch panel, no extraction and no data layer in
// sight: this file rendering the component at all is the criterion, and #213
// feeding it extracted proposals later changes nothing this file asserts.
//
// Chore titles are lower case — the #19 name scan's rule for fixture prose.

const rows = [
  { key: 'a', title: 'sweep the porch', minutes: '15', dueOn: '2026-08-10', problem: null },
  { key: 'b', title: 'water the plants', minutes: '5', dueOn: '2026-08-11', problem: null },
]

function setup(overrides = {}) {
  const handlers = { onChange: vi.fn(), onRemove: vi.fn() }
  render(<ChoreDraftList rows={rows} {...handlers} {...overrides} />)
  return handlers
}

describe('the review list — #220 AC 7, rows as input', () => {
  it('renders each hand-built row with its title, minutes and due date', () => {
    setup()
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('sweep the porch')
    expect(screen.getByLabelText(/expected minutes for chore 1/i)).toHaveValue(15)
    expect(screen.getByLabelText(/due date for chore 1/i)).toHaveValue('2026-08-10')
    expect(screen.getByLabelText(/title for chore 2/i)).toHaveValue('water the plants')
  })

  it('reports an edit to each field through onChange, keyed to the row it happened on', () => {
    const { onChange } = setup()

    fireEvent.change(screen.getByLabelText(/title for chore 2/i), {
      target: { value: 'water the garden' },
    })
    expect(onChange).toHaveBeenLastCalledWith('b', { title: 'water the garden' })

    fireEvent.change(screen.getByLabelText(/expected minutes for chore 1/i), {
      target: { value: '25' },
    })
    expect(onChange).toHaveBeenLastCalledWith('a', { minutes: '25' })

    fireEvent.change(screen.getByLabelText(/due date for chore 1/i), {
      target: { value: '2026-08-12' },
    })
    expect(onChange).toHaveBeenLastCalledWith('a', { dueOn: '2026-08-12' })
  })

  it('offers to remove any row, and names the row it would remove', () => {
    const { onRemove } = setup()
    fireEvent.click(screen.getByRole('button', { name: /remove chore 2 from the list/i }))
    expect(onRemove).toHaveBeenCalledWith('b')
  })

  it('marks a row carrying a problem with its reason, on that row alone', () => {
    setup({
      rows: [
        rows[0],
        { ...rows[1], problem: 'That is not a real date.' },
      ],
    })
    const marked = screen.getByTestId('draft-b')
    expect(marked).toHaveTextContent('That is not a real date.')
    expect(screen.getByTestId('draft-a')).not.toHaveTextContent(/not a real date/i)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('holds no state of its own — a re-render with new rows shows exactly those rows', () => {
    const handlers = { onChange: vi.fn(), onRemove: vi.fn() }
    const view = render(<ChoreDraftList rows={rows} {...handlers} />)
    view.rerender(<ChoreDraftList rows={[rows[1]]} {...handlers} />)

    expect(screen.getAllByLabelText(/title for chore \d/i)).toHaveLength(1)
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('water the plants')
  })
})
