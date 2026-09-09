import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HouseholdSwitcher from './HouseholdSwitcher.jsx'

// #164 — the control that names which household is showing, and offers the
// others. Names are synthetic — see #19.
//
// This file proves no access rule and stands up no client, which is #164 AC 7:
// the component takes an array and a callback and renders, so there is nothing
// legitimate for a Supabase client to be doing here. gate.test.js's "AC 10 — no
// component test proves an access rule" block reads every `*.test.jsx` in this
// directory, so placing the component here is what puts this file inside that
// guard's corpus rather than beside it — and the guard has an assertion of its
// own that this file is in there, so the coverage is stated rather than assumed.

const first = { id: 'h1', name: 'Placeholder Household' }
const second = { id: 'h2', name: 'Placeholder Other Household' }

describe('#164 — one household', () => {
  // AC 3, and it is the criterion most easily lost: the previous story's
  // element, not a disabled control and not a one-option picker. Somebody who
  // belongs to one household must not be shown that there is anywhere else to
  // be — every household in this app starts as somebody's only one.
  it('renders the name as the paragraph #163 shipped, with no control at all', () => {
    const { container } = render(
      <HouseholdSwitcher households={[first]} activeId="h1" onChoose={vi.fn()} />,
    )

    const name = container.querySelector('.shell__household')
    expect(name).toBeInTheDocument()
    expect(name.tagName).toBe('P')
    expect(name).toHaveTextContent('Placeholder Household')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('renders nothing at all when there is no household to name', () => {
    const { container } = render(
      <HouseholdSwitcher households={[]} activeId={null} onChoose={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('#164 — more than one household', () => {
  // AC 1. The control lists EVERY household, in the order it was handed them,
  // which is `listHouseholds()`'s created_at-then-id. Asserted as the option
  // sequence rather than as a set, because "lists both" would pass on a control
  // that reorders them — and the household at the top of this list is the one
  // the app opens on by default, so the two orders must not disagree.
  it('becomes a control listing every household, in the order it was given', () => {
    render(
      <HouseholdSwitcher households={[first, second]} activeId="h1" onChoose={vi.fn()} />,
    )

    const control = screen.getByRole('combobox', { name: 'Household' })
    expect(control).toBeInTheDocument()
    expect(
      Array.from(control.options).map((o) => [o.value, o.textContent]),
    ).toEqual([
      ['h1', 'Placeholder Household'],
      ['h2', 'Placeholder Other Household'],
    ])
  })

  it('shows the ACTIVE household, not merely the first one', () => {
    render(
      <HouseholdSwitcher households={[first, second]} activeId="h2" onChoose={vi.fn()} />,
    )
    // The distinction matters: a control hard-wired to `households[0]` renders
    // identically for the default case and is wrong for every other.
    expect(screen.getByRole('combobox', { name: 'Household' })).toHaveValue('h2')
  })

  it('reports the household that was chosen, by id', () => {
    const onChoose = vi.fn()
    render(
      <HouseholdSwitcher households={[first, second]} activeId="h1" onChoose={onChoose} />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Household' }), {
      target: { value: 'h2' },
    })

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('h2')
  })

  // The switch is a read, and a read that lands while another is running is
  // what #342's queue exists to coalesce. Disabling while busy is the same
  // treatment every other control on the shell gets.
  it('is disabled while a read is in flight', () => {
    render(
      <HouseholdSwitcher households={[first, second]} activeId="h1" onChoose={vi.fn()} busy />,
    )
    expect(screen.getByRole('combobox', { name: 'Household' })).toBeDisabled()
  })

  // An `activeId` naming a household that is not in the list is not a state App
  // produces — `resolveActiveHousehold` has already fallen back by the time this
  // renders — but a control whose `value` matches no option renders BLANK in a
  // real browser, which would show a person an empty box where their household
  // name belongs. Cheap to be sure of.
  it('falls back to the first household rather than rendering an empty control', () => {
    render(
      <HouseholdSwitcher households={[first, second]} activeId="h-gone" onChoose={vi.fn()} />,
    )
    expect(screen.getByRole('combobox', { name: 'Household' })).toHaveValue('h1')
  })
})
