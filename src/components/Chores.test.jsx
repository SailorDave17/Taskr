import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Chores from './Chores.jsx'

// #34 — the chore list and the form that refuses a bad value BEFORE it becomes
// a request (AC 2). Chore names are synthetic — see #19.
//
// The re-read half of AC 6 is NOT tested here and cannot be: the re-read is
// App's `mutate()`, and this component only calls the handler it is given. It
// is covered in src/App.test.jsx, which is where deleting the re-read turns
// something red.

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

function setup(overrides = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn().mockResolvedValue(undefined),
    onUncomplete: vi.fn().mockResolvedValue(undefined),
  }
  render(<Chores chores={chores} {...handlers} {...overrides} />)
  return handlers
}

const clickAndSettle = (element) => act(async () => void fireEvent.click(element))

/** Render with a handle to re-render new props into the SAME component instance. */
function setupRerenderable() {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn().mockResolvedValue(undefined),
    onUncomplete: vi.fn().mockResolvedValue(undefined),
  }
  const view = render(<Chores chores={chores} {...handlers} />)
  return {
    handlers,
    // Deliberately view.rerender, not a fresh render: unmounting would reset the
    // very state this test exists to check.
    rerender: (next) => view.rerender(<Chores chores={next} {...handlers} />),
  }
}

/** Fill the add form. Any field may be overridden to make it invalid. */
function fillAddForm({ title = 'Dishes', minutes = '20', due = '2026-08-10' } = {}) {
  fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: title } })
  fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: minutes } })
  fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: due } })
}

const submitAdd = () => clickAndSettle(screen.getByRole('button', { name: /add chore/i }))

describe('the list — AC 1, a chore is a titled unit of minutes', () => {
  it('shows each chore with its expected minutes and its due date', () => {
    setup()
    const row = screen.getByText('Placeholder Chore').closest('li')
    expect(row).toHaveTextContent('20 min')
    expect(row).toHaveTextContent('due 2026-08-10')
  })

  it('shows the minutes in human form as a reading aid, without changing the unit', () => {
    setup()
    const row = screen.getByText('Placeholder Other Chore').closest('li')
    // The stored value is minutes; "1h 30m" is beside it, not instead of it.
    expect(row).toHaveTextContent('90 min')
    expect(row).toHaveTextContent('1h 30m')
  })

  it('says what to do when there is nothing yet, rather than showing an empty box', () => {
    setup({ chores: [] })
    expect(screen.getByText(/no chores yet/i)).toBeInTheDocument()
  })

  it('SCOPE FENCE: a household figure is allowed, a per-person one is not', () => {
    // #34's fence said "no aggregate" and its stated reason was that there was
    // nothing to aggregate — completion was #35 and assignment #36. #35 shipped
    // completion, so "still to do" is now a real quantity and the number #40's
    // allocation divides. The fence that survives is the one that was actually
    // about the thesis: nothing ranks a PERSON.
    setup()
    const section = screen.getByRole('region', { name: /what needs doing/i })
    expect(section).toHaveTextContent(/still to do/i)
    expect(section).not.toHaveTextContent(/assigned/i)
    expect(section).not.toHaveTextContent(/streak|rank|score|points|leaderboard/i)
  })
})

describe('AC 2 — the form refuses with a sentence, before any request is sent', () => {
  it('POSITIVE CONTROL: a valid chore IS submitted, so a refusal below is the guard working', async () => {
    const { onAdd } = setup()
    fillAddForm()
    await submitAdd()

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  for (const [label, minutes, sentence] of [
    ['blank', '', /how many minutes/i],
    ['zero', '0', /at least a minute/i],
    ['negative', '-30', /at least a minute/i],
    ['a fraction', '20.5', /whole number/i],
    ['above a day of work', '1441', /split it into smaller chores/i],
  ]) {
    it(`refuses ${label} minutes with a sentence, and sends nothing`, async () => {
      const { onAdd } = setup()
      fillAddForm({ minutes })
      await submitAdd()

      expect(onAdd).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(sentence)
    })
  }

  it('refuses a missing title, and sends nothing', async () => {
    const { onAdd } = setup()
    fillAddForm({ title: '   ' })
    await submitAdd()

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/needs a name/i)
  })

  it('refuses a missing due date, and sends nothing', async () => {
    const { onAdd } = setup()
    fillAddForm({ due: '' })
    await submitAdd()

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/when is this chore due/i)
  })

  it('clears the complaint once the value is corrected', async () => {
    const { onAdd } = setup()
    fillAddForm({ minutes: '0' })
    await submitAdd()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fillAddForm({ minutes: '20' })
    await submitAdd()

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('empties the form after a successful add, so the next chore starts clean', async () => {
    setup()
    fillAddForm()
    await submitAdd()

    expect(screen.getByLabelText(/^chore$/i)).toHaveValue('')
    expect(screen.getByLabelText(/expected minutes/i)).toHaveValue(null)
  })

  it('keeps what was typed when the add fails, so nothing has to be retyped', async () => {
    setup({ onAdd: vi.fn().mockRejectedValue(new Error('the network is down')) })
    fillAddForm()
    await submitAdd()

    expect(screen.getByLabelText(/^chore$/i)).toHaveValue('Dishes')
  })
})

describe('AC 6 — editing and removing go through the handler', () => {
  const openEditor = () => clickAndSettle(screen.getByRole('button', { name: /edit placeholder chore/i }))

  it('saves an edited title, minutes and due date', async () => {
    const { onSave } = setup()
    await openEditor()

    fireEvent.change(screen.getByLabelText(/name for placeholder chore/i), {
      target: { value: 'Dishes and counters' },
    })
    fireEvent.change(screen.getByLabelText(/expected minutes for placeholder chore/i), {
      target: { value: '30' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).toHaveBeenCalledWith('c1', {
      title: 'Dishes and counters',
      expectedMinutes: '30',
      dueOn: '2026-08-10',
    })
  })

  it('applies the same refusal in the editor as in the add form', async () => {
    const { onSave } = setup()
    await openEditor()

    fireEvent.change(screen.getByLabelText(/expected minutes for placeholder chore/i), {
      target: { value: '0' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least a minute/i)
  })

  it('cancelling an edit restores what was there', async () => {
    const { onSave } = setup()
    await openEditor()

    fireEvent.change(screen.getByLabelText(/name for placeholder chore/i), {
      target: { value: 'Something else' },
    })
    await clickAndSettle(screen.getByRole('button', { name: /cancel/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Placeholder Chore')).toBeInTheDocument()
  })

  it('asks before removing, and removes on the second click', async () => {
    const { onRemove } = setup()

    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder chore/i }))
    expect(onRemove).not.toHaveBeenCalled()

    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder chore\?/i }))
    expect(onRemove).toHaveBeenCalledWith('c1')
  })

  it('lets the confirmation be backed out of', async () => {
    const { onRemove } = setup()

    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder chore/i }))
    await clickAndSettle(screen.getByRole('button', { name: /keep/i }))
    expect(onRemove).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Defects found by review-fanout on 2026-08-08 and fixed in the same story.
// Each of these is the test that was missing when the defect shipped into the
// branch, not a test written after the fact to describe the fix.
// ---------------------------------------------------------------------------

describe('a failed write reports itself beside the form that caused it', () => {
  it('renders the server error inside the chore card', () => {
    // It used to appear only in the Roster card, a different section of the
    // page, because <Chores> was passed no `error` prop at all.
    setup({ error: 'adding the chore: network unreachable' })
    const section = screen.getByRole('region', { name: /what needs doing/i })
    expect(within(section).getByRole('alert')).toHaveTextContent(/network unreachable/i)
  })

  it('shows nothing when there is no error, so the alert is not permanent furniture', () => {
    setup()
    const section = screen.getByRole('region', { name: /what needs doing/i })
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('a rejected remove does not escape as an unhandled rejection', () => {
  it('attaches a rejection handler to the promise the remove returns', async () => {
    // FIRST ATTEMPT AT THIS TEST WAS VACUOUS, and mutation is what said so:
    // it listened on process.on('unhandledRejection'), which never fires under
    // vitest, so reverting the fix reddened NOTHING. What is observable is the
    // property itself — whether the component attaches a rejection handler to
    // the promise this call hands back — so that is what is asserted.
    let handlerAttached = false

    const settled = Promise.reject(new Error('removing the chore: gone'))
    // Consumed here so the runner never sees a genuinely unhandled rejection
    // whichever way the component behaves; the flag below records what the
    // COMPONENT did, which is the thing under test.
    settled.catch(() => {})

    const thenable = {
      then(onOk, onErr) {
        handlerAttached = handlerAttached || typeof onErr === 'function'
        return settled.then(onOk, onErr ?? (() => {}))
      },
      catch(onErr) {
        handlerAttached = true
        return settled.catch(onErr)
      },
    }
    const onRemove = vi.fn(() => thenable)

    setup({ onRemove })
    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder chore/i }))
    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder chore\?/i }))

    expect(onRemove).toHaveBeenCalledWith('c1')
    expect(handlerAttached, 'the remove click ignored the promise it was given').toBe(true)
  })
})

describe('the editor opens on the row as it is now, not as it was at mount', () => {
  it('re-seeds from the current props when another device has changed the chore', async () => {
    // The row is keyed by chore.id and never unmounts, so useState initialisers
    // run once. Without re-seeding on open, the list showed the new value while
    // the editor opened on the old one — and saving wrote the stale value back
    // over the other device's edit.
    const { rerender, handlers } = setupRerenderable()

    const changed = [{ ...chores[0], title: 'Dishes and counters', expected_minutes: 35 }, chores[1]]
    rerender(changed)
    expect(screen.getByText('Dishes and counters')).toBeInTheDocument()

    await clickAndSettle(screen.getByRole('button', { name: /edit dishes and counters/i }))
    expect(screen.getByLabelText(/name for dishes and counters/i)).toHaveValue('Dishes and counters')
    expect(screen.getByLabelText(/expected minutes for dishes and counters/i)).toHaveValue(35)

    await clickAndSettle(screen.getByRole('button', { name: /^save$/i }))
    expect(handlers.onSave).toHaveBeenCalledWith('c1', {
      title: 'Dishes and counters',
      expectedMinutes: '35',
      dueOn: '2026-08-10',
    })
  })
})

describe('while a write is in flight', () => {
  it('disables the controls, so a double tap is not two chores', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: /add chore/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /edit placeholder chore/i })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// #35 — completion. ACs 5, 8 and 9.
// ---------------------------------------------------------------------------

describe('completion — #35', () => {
  const outstandingRow = () => screen.getByText('Placeholder Chore').closest('li')

  it('offers Done on an outstanding chore and calls the handler', async () => {
    const { onComplete } = setup()
    await clickAndSettle(within(outstandingRow()).getByRole('button', { name: /mark placeholder chore done/i }))
    expect(onComplete).toHaveBeenCalledWith('c1')
  })

  it('offers the undo on a completed one instead', async () => {
    const { onUncomplete, onComplete } = setup({ chores: mixed })
    const doneRow = screen.getByText('Placeholder Other Chore').closest('li')
    expect(within(doneRow).queryByRole('button', { name: /mark .* done/i })).not.toBeInTheDocument()

    await clickAndSettle(within(doneRow).getByRole('button', { name: /put placeholder other chore back/i }))
    expect(onUncomplete).toHaveBeenCalledWith('c2')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('AC 5: the outstanding total counts only unfinished work', () => {
    // The fixture is mixed ON PURPOSE and the two totals differ: outstanding is
    // 20, all-rows is 110. A sum over every row fails this test, which is the
    // whole point — committed minutes that can only grow make the load figure
    // drift upward all week.
    setup({ chores: mixed })
    const total = screen.getByTestId('outstanding-total')
    expect(total).toHaveTextContent('20 min')
    expect(total).not.toHaveTextContent('110')
    expect(total).toHaveTextContent(/1 still to do/i)
  })

  it('AC 8: completed chores stay visible, in their own group', () => {
    setup({ chores: mixed })
    const done = screen.getByRole('region', { name: /done this week/i })
    expect(within(done).getByText('Placeholder Other Chore')).toBeInTheDocument()
    // And the outstanding one is NOT in that group.
    expect(within(done).queryByText('Placeholder Chore')).not.toBeInTheDocument()
  })

  it('AC 9: the completed group carries no streak, rank, score or per-person total', () => {
    setup({ chores: mixed })
    const done = screen.getByRole('region', { name: /done this week/i })
    expect(done).not.toHaveTextContent(/streak|rank|score|points|leaderboard|best|winner/i)
    // No per-person figure: the member id in the fixture must not surface.
    expect(done).not.toHaveTextContent(/m1/)
  })

  it('AC 9: and nothing in it is styled as an error or an alert — red is for work, never people', () => {
    setup({ chores: mixed })
    const done = screen.getByRole('region', { name: /done this week/i })
    expect(within(done).queryByRole('alert')).not.toBeInTheDocument()
    expect(done.querySelector('.error')).toBeNull()
  })

  it('shows no completed group at all when nothing is done', () => {
    setup()
    expect(screen.queryByRole('region', { name: /done this week/i })).not.toBeInTheDocument()
  })
})
