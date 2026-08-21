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

// #36 — the roster the assignee control and the load list are built from.
// Two people with DIFFERENT capacities, because a fixture where everyone has the
// same budget cannot tell "remaining" from "capacity minus committed".
const members = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'device-a' },
  { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null },
]

// The allocator's shape, which is what App builds through capacitiesFor. Equal
// to the baselines here because no override can exist yet (#46).
const capacities = [
  { id: 'm1', capacityMinutes: 120 },
  { id: 'm2', capacityMinutes: 60 },
]

function setup(overrides = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn().mockResolvedValue(undefined),
    onUncomplete: vi.fn().mockResolvedValue(undefined),
    onAssign: vi.fn().mockResolvedValue(undefined),
    onUnassign: vi.fn().mockResolvedValue(undefined),
    onExclude: vi.fn().mockResolvedValue(undefined),
    onAllow: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Chores
      chores={chores}
      members={members}
      capacities={capacities}
      exclusions={[]}
      {...handlers}
      {...overrides}
    />,
  )
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
    onAssign: vi.fn().mockResolvedValue(undefined),
    onUnassign: vi.fn().mockResolvedValue(undefined),
    onExclude: vi.fn().mockResolvedValue(undefined),
    onAllow: vi.fn().mockResolvedValue(undefined),
  }
  const props = { members, capacities, exclusions: [], ...handlers }
  const view = render(<Chores chores={chores} {...props} />)
  return {
    handlers,
    // Deliberately view.rerender, not a fresh render: unmounting would reset the
    // very state this test exists to check.
    rerender: (next) => view.rerender(<Chores chores={next} {...props} />),
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

  it('SCOPE FENCE: a household figure and a per-person one are allowed, a RANKING is not', () => {
    // #34's fence said "no aggregate" and its stated reason was that there was
    // nothing to aggregate — completion was #35 and assignment #36. Both have now
    // shipped, so the per-person figure this test used to forbid is the thing
    // #36 exists to produce. What survives is the fence that was always about the
    // thesis rather than about timing: nothing RANKS a person.
    setup()
    const section = screen.getByRole('region', { name: /what needs doing/i })
    expect(section).toHaveTextContent(/still to do/i)
    expect(section).toHaveTextContent(/committed/i)
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

// ---------------------------------------------------------------------------
// #36 — assignment, and the load figures.
//
// AC 10, stated as a place rather than as a rule: nothing below asserts an
// ACCESS rule. A fake Supabase client cannot refuse, so a refusal proved here
// would be a refusal this file invented. Every access claim in #36 lives in
// src/test/assignment.pglite.test.js against a real Postgres. What is tested
// here is what a person sees and which handler a gesture reaches.
// ---------------------------------------------------------------------------

describe('assignment — #36 AC 1, 4', () => {
  const assignedChores = [
    { ...chores[0], assigned_member_id: 'm1' },
    { ...chores[1], assigned_member_id: null },
  ]

  it('offers every member plus an explicit nobody, and shows who currently holds it', () => {
    setup({ chores: assignedChores })
    const select = screen.getByLabelText(/who is doing placeholder chore/i)

    expect(select).toHaveValue('m1')
    expect(
      [...select.options].map((o) => o.textContent),
      'the roster, in roster order, with an explicit way to hold nobody',
    ).toEqual(['Nobody yet', 'Placeholder One', 'Placeholder Two'])
  })

  it('AC 1: choosing a person calls onAssign with the chore and that member', () => {
    const { onAssign } = setup({ chores: assignedChores })
    fireEvent.change(screen.getByLabelText(/who is doing placeholder other chore/i), {
      target: { value: 'm2' },
    })
    expect(onAssign).toHaveBeenCalledWith('c2', 'm2')
  })

  it('AC 4: choosing nobody calls onUnassign, never onAssign with a null person', () => {
    const { onAssign, onUnassign } = setup({ chores: assignedChores })
    fireEvent.change(screen.getByLabelText(/who is doing placeholder chore/i), {
      target: { value: '' },
    })
    expect(onUnassign).toHaveBeenCalledWith('c1')
    expect(onAssign).not.toHaveBeenCalled()
  })

  it('keeps an assignee this device cannot see rather than silently re-pointing it', () => {
    // Between another phone removing a person and this one refreshing, the id
    // names nobody in `members`. A bare value= would fall back to the first
    // option, and the next change would look like a deliberate re-assignment.
    setup({ chores: [{ ...chores[0], assigned_member_id: 'gone' }, chores[1]] })
    const select = screen.getByLabelText(/who is doing placeholder chore/i)
    expect(select).toHaveValue('gone')
    expect(select).toHaveTextContent(/someone not on the roster/i)
  })

  it('disables the control while a write is in flight, so a double tap is not two assignments', () => {
    setup({ chores: assignedChores, busy: true })
    expect(screen.getByLabelText(/who is doing placeholder chore/i)).toBeDisabled()
  })

  it('a rejected assign does not escape as an unhandled rejection', () => {
    let handlerAttached = false
    const rejecting = () => {
      const p = Promise.reject(new Error('refused'))
      const then = p.then.bind(p)
      p.then = (...a) => {
        if (a[1]) handlerAttached = true
        return then(...a)
      }
      return p
    }
    setup({ chores: assignedChores, onAssign: rejecting })
    fireEvent.change(screen.getByLabelText(/who is doing placeholder other chore/i), {
      target: { value: 'm2' },
    })
    expect(handlerAttached, 'the assign change ignored the promise it was given').toBe(true)
  })
})

describe('the load figures — #36 AC 5, 6, 9', () => {
  const held = (chore, member) => ({ ...chore, assigned_member_id: member })

  const renderLoad = (list) =>
    render(
      <Chores
        chores={list}
        members={members}
        capacities={capacities}
        exclusions={[]}
        onAdd={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onComplete={vi.fn()}
        onUncomplete={vi.fn()}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onExclude={vi.fn()}
        onAllow={vi.fn()}
      />,
    )

  it('AC 5: says what each person is carrying and what is left, in plain minutes', () => {
    setup({ chores: [held(chores[0], 'm1'), held(chores[1], 'm2')] })

    // Placeholder One: 120 minutes of capacity, holding the 20-minute chore.
    expect(screen.getByTestId('load-m1')).toHaveTextContent('20 min committed')
    expect(screen.getByTestId('load-m1')).toHaveTextContent('100 min left')
    // Placeholder Two: 60 minutes, holding the 90-minute one.
    expect(screen.getByTestId('load-m2')).toHaveTextContent('90 min committed')
  })

  it('AC 5: it is MINUTES, not a count of chores', () => {
    // Two chores of 20 and 90 on one person. A count would read "2".
    setup({ chores: [held(chores[0], 'm1'), held(chores[1], 'm1')] })
    expect(screen.getByTestId('load-m1')).toHaveTextContent('110 min committed')
    expect(screen.getByTestId('load-m1')).not.toHaveTextContent(/\b2 chores?\b/)
  })

  it('AC 6: an over-committed person reads "over", not "0 min left"', () => {
    // 90 minutes on a 60-minute budget. formatMinutes clamps at zero, so this is
    // the assertion that catches the remainder being routed through it.
    setup({ chores: [held(chores[1], 'm2')] })
    expect(screen.getByTestId('load-m2')).toHaveTextContent('30 min over')
    expect(screen.getByTestId('load-m2')).not.toHaveTextContent('0 min left')
  })

  it('AC 6: a person holding nothing still appears, at zero', () => {
    setup({ chores: [held(chores[0], 'm1')] })
    expect(screen.getByTestId('load-m2')).toHaveTextContent('0 min committed')
    expect(screen.getByTestId('load-m2')).toHaveTextContent('60 min left')
  })

  it('AC 5: completed work leaves the figure — commitment is OUTSTANDING minutes', () => {
    const finished = { ...chores[1], assigned_member_id: 'm1', completed_at: '2026-08-08T10:00:00Z' }
    setup({ chores: [held(chores[0], 'm1'), finished] })
    expect(screen.getByTestId('load-m1')).toHaveTextContent('20 min committed')
    expect(screen.getByTestId('load-m1')).not.toHaveTextContent('110 min committed')
  })

  it('AC 9: people are in ROSTER order even when the load says otherwise', () => {
    // m2 carries 90 and m1 carries 20, so a sort-by-load would invert these.
    setup({ chores: [held(chores[0], 'm1'), held(chores[1], 'm2')] })
    const names = screen
      .getAllByRole('listitem')
      .filter((li) => li.className.includes('chore-load__row'))
      .map((li) => li.textContent)
    expect(names[0]).toMatch(/Placeholder One/)
    expect(names[1]).toMatch(/Placeholder Two/)
  })

  it('AC 9: no bar, no rank, no percentage — the presentation is #47, not this story', () => {
    const { container } = renderLoad([held(chores[0], 'm1'), held(chores[1], 'm2')])
    const load = container.querySelector('.chore-load')

    expect(load).not.toHaveTextContent(/%|percent/i)
    expect(load).not.toHaveTextContent(/streak|rank|score|points|leaderboard|worst/i)
    // A bar is an element, not a word, so the text assertions above cannot see
    // one. These are the three ways it would actually arrive.
    expect(load.querySelector('progress'), 'a progress element is a bar').toBeNull()
    expect(load.querySelector('meter'), 'a meter element is a bar').toBeNull()
    expect(
      load.querySelector('[style*="width"]'),
      'an inline width is how a hand-rolled bar is drawn',
    ).toBeNull()
  })

  it('POSITIVE CONTROL: the load section is on screen, so the absences above are not an empty query', () => {
    const { container } = renderLoad([held(chores[0], 'm1')])
    expect(container.querySelector('.chore-load')).not.toBeNull()
    expect(screen.getByRole('region', { name: /who is carrying what/i })).toBeInTheDocument()
  })

  it('shows nothing at all when the roster is empty, rather than an empty heading', () => {
    setup({ members: [], capacities: [] })
    expect(screen.queryByRole('region', { name: /who is carrying what/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #37 — who cannot do a chore
//
// Everything here is about the SCREEN. The rules — who may write an exclusion,
// which household a row may name, what happens when a member is deleted — live
// in Postgres and are exercised by src/test/exclusions.pglite.test.js, because a
// fake client cannot refuse and so cannot prove a refusal (#36 AC 10, which
// src/test/gate.test.js turns into a check over this very file).
// ---------------------------------------------------------------------------

/** Render with a handle to change chores AND exclusions on the same instance. */
function setupExclusionRerender(initialChores, initialExclusions) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn().mockResolvedValue(undefined),
    onUncomplete: vi.fn().mockResolvedValue(undefined),
    onAssign: vi.fn().mockResolvedValue(undefined),
    onUnassign: vi.fn().mockResolvedValue(undefined),
    onExclude: vi.fn().mockResolvedValue(undefined),
    onAllow: vi.fn().mockResolvedValue(undefined),
  }
  const props = { members, capacities, ...handlers }
  const view = render(
    <Chores chores={initialChores} exclusions={initialExclusions} {...props} />,
  )
  return {
    handlers,
    // view.rerender rather than a fresh render: unmounting would reset the state
    // this exists to observe changing, which is exactly what a refresh does not do.
    rerender: (nextChores, nextExclusions) =>
      view.rerender(<Chores chores={nextChores} exclusions={nextExclusions} {...props} />),
  }
}

describe('recording an exclusion — #37 ACs 2, 3', () => {
  const cannotMow = [{ id: 'x1', chore_id: 'c2', member_id: 'm2' }]

  it('AC 2: choosing somebody records exactly that pair, from the chore itself', () => {
    const { onExclude } = setup()
    fireEvent.change(screen.getByLabelText(/mark someone as unable to do placeholder chore/i), {
      target: { value: 'm2' },
    })
    expect(onExclude).toHaveBeenCalledTimes(1)
    expect(onExclude).toHaveBeenCalledWith('c1', 'm2')
  })

  it('offers everybody when nothing is excluded, and stops offering a person once they are', () => {
    setup({ exclusions: cannotMow })
    const stillOpen = screen.getByLabelText(/mark someone as unable to do placeholder other chore/i)
    expect([...stillOpen.options].map((o) => o.textContent)).toEqual([
      'Everyone can',
      'Placeholder One',
    ])
    // The other chore has no exclusions and its control is untouched — this is a
    // fold over the rows per chore, not a setting on the screen.
    const other = screen.getByLabelText(/mark someone as unable to do placeholder chore/i)
    expect([...other.options]).toHaveLength(3)
  })

  it('says who cannot do it, in words rather than by absence from a list', () => {
    setup({ exclusions: cannotMow })
    const row = screen.getByTestId('exclusions-c2')
    expect(within(row).getByText(/placeholder two cannot do this/i)).toBeInTheDocument()
  })

  it('undoing one calls onAllow with the pair', async () => {
    const { onAllow } = setup({ exclusions: cannotMow })
    await clickAndSettle(
      screen.getByRole('button', {
        name: /let placeholder two do placeholder other chore again/i,
      }),
    )
    expect(onAllow).toHaveBeenCalledWith('c2', 'm2')
  })

  it('never shows a selection, because the control is an action and the list is the state', () => {
    // A select that kept the last choice would read as "this is who cannot do
    // it" while meaning "this is who I last added", and the two diverge the
    // moment a second person is added.
    setup({ exclusions: cannotMow })
    const select = screen.getByLabelText(/mark someone as unable to do placeholder other chore/i)
    expect(select).toHaveValue('')
  })

  it('offers no control at all once every member is excluded, rather than an empty one', () => {
    const nobody = [
      { id: 'x1', chore_id: 'c1', member_id: 'm1' },
      { id: 'x2', chore_id: 'c1', member_id: 'm2' },
    ]
    setup({ exclusions: nobody })
    expect(
      screen.queryByLabelText(/mark someone as unable to do placeholder chore/i),
    ).not.toBeInTheDocument()
    // The people are still named, so the state stays legible rather than blank.
    const row = screen.getByTestId('exclusions-c1')
    expect(within(row).getAllByText(/cannot do this/i)).toHaveLength(2)
  })

  it('disables both halves while a write is in flight, so a double tap is not two rows', () => {
    setup({ exclusions: cannotMow, busy: true })
    expect(screen.getByLabelText(/mark someone as unable to do placeholder chore/i)).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /let placeholder two do placeholder other chore again/i }),
    ).toBeDisabled()
  })

  it('AC 3: there is ONE control per chore, never one per chore-and-person pair', () => {
    // The grid #8 asked for, refused as a rendered fact rather than as a
    // paragraph. Two chores and two members: a capability matrix would put four
    // controls on this screen, and the count is what tells the two shapes apart.
    setup()
    expect(screen.getAllByLabelText(/mark someone as unable to do/i)).toHaveLength(chores.length)
    expect(chores.length).toBe(2)
    expect(members.length).toBe(2)
  })

  it('a rejected exclude does not escape as an unhandled rejection', () => {
    let handlerAttached = false
    const rejecting = () => {
      const p = Promise.reject(new Error('refused'))
      const then = p.then.bind(p)
      p.then = (...a) => {
        if (a[1]) handlerAttached = true
        return then(...a)
      }
      return p
    }
    setup({ onExclude: rejecting })
    fireEvent.change(screen.getByLabelText(/mark someone as unable to do placeholder chore/i), {
      target: { value: 'm2' },
    })
    expect(handlerAttached, 'the exclude change ignored the promise it was given').toBe(true)
  })

  it('a rejected undo does not either', async () => {
    let handlerAttached = false
    const rejecting = () => {
      const p = Promise.reject(new Error('refused'))
      const then = p.then.bind(p)
      p.then = (...a) => {
        if (a[1]) handlerAttached = true
        return then(...a)
      }
      return p
    }
    setup({ exclusions: cannotMow, onAllow: rejecting })
    await clickAndSettle(
      screen.getByRole('button', {
        name: /let placeholder two do placeholder other chore again/i,
      }),
    )
    expect(handlerAttached, 'the undo click ignored the promise it was given').toBe(true)
  })
})

describe('an excluded person holding the chore anyway — #37 ACs 6, 7', () => {
  // ONE fixture for both criteria, because they are the same rendered state
  // reached by two orders of events: exclude then assign (AC 6), or assign then
  // exclude (AC 7). The component cannot tell them apart and must not try — two
  // sentences for one situation would leave the household guessing which of them
  // they had caused.
  const heldByTwo = [{ ...chores[0], assigned_member_id: 'm2' }, chores[1]]
  const cannot = [{ id: 'x1', chore_id: 'c1', member_id: 'm2' }]

  it('AC 6: names the excluded person, in the warning own wording', () => {
    setup({ chores: heldByTwo, exclusions: cannot })
    expect(
      screen.getByText('Placeholder Two is marked as unable to do this, and has it anyway.'),
    ).toBeInTheDocument()
  })

  it('AC 6: and the assignment still stands — the screen warns, it does not refuse', () => {
    // Owner decision, option (a): a parent overriding is signal, not error. The
    // database agrees, and exclusions.pglite.test.js asserts the write succeeds
    // so nobody later "fixes" this into a block.
    setup({ chores: heldByTwo, exclusions: cannot })
    expect(screen.getByLabelText(/who is doing placeholder chore/i)).toHaveValue('m2')
  })

  it('AC 6: the excluded person is STILL offered in the assignee picker', () => {
    // Option (b) was to drop them from the list. It was declined, and this is
    // the assertion that fails if somebody implements it by accident while
    // tidying up the picker.
    setup({ chores: heldByTwo, exclusions: cannot })
    const select = screen.getByLabelText(/who is doing placeholder chore/i)
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Nobody yet',
      'Placeholder One',
      'Placeholder Two',
    ])
  })

  it('AC 7: the note appears when the exclusion arrives AFTER the assignment', async () => {
    // The same end state reached the other way round, and reached by a props
    // change into the SAME component instance — which is what a refresh is.
    const { rerender } = setupExclusionRerender(heldByTwo, [])
    expect(screen.queryByText(/marked as unable/i)).not.toBeInTheDocument()
    await act(async () => rerender(heldByTwo, cannot))
    expect(screen.getByText(/placeholder two is marked as unable/i)).toBeInTheDocument()
  })

  it('AC 7: and the chore stays where it was, rather than returning to the unassigned group', async () => {
    // Option (b) — automatically unassigning — was declined: it would drop the
    // work into the unassigned pile with no allocator to re-place it. Asserted
    // ACROSS the change rather than on a static fixture, because "it was never
    // unassigned" is the claim and a single render cannot make it.
    const { rerender } = setupExclusionRerender(heldByTwo, [])
    await act(async () => rerender(heldByTwo, cannot))
    expect(screen.getByLabelText(/who is doing placeholder chore/i)).toHaveValue('m2')
  })

  it('says nothing when the holder is NOT excluded, so the note is not permanent furniture', () => {
    setup({ chores: heldByTwo, exclusions: [{ id: 'x9', chore_id: 'c1', member_id: 'm1' }] })
    expect(screen.queryByText(/marked as unable/i)).not.toBeInTheDocument()
  })

  it('says nothing about an UNASSIGNED chore, whoever is excluded from it', () => {
    // The null-assignee case, which every render asks. A bare equality against
    // assigned_member_id would match a row whose member_id was null; no such row
    // can exist, and isExcluded guards it anyway because the wrong answer would
    // be a plausible sentence rather than a crash.
    setup({ chores, exclusions: cannot })
    expect(screen.queryByText(/marked as unable/i)).not.toBeInTheDocument()
  })

  it('is a STATEMENT, not a demand: it offers nothing to click', () => {
    // #8's answer was a conflict flag with somewhere to go and fix it, and that
    // was recommended against — a flag asking a human to resolve something is the
    // negotiation the signature moment exists to remove.
    setup({ chores: heldByTwo, exclusions: cannot })
    const note = screen.getByText(/marked as unable/i)
    expect(note.querySelector('button')).toBeNull()
    expect(note.querySelector('a')).toBeNull()
  })

  it('is not styled or announced as an error — red is for work, never for people', () => {
    // The rule #35 AC 9 states for completed work, applied to the one sentence in
    // this app that is about a person and a problem at once.
    setup({ chores: heldByTwo, exclusions: cannot })
    const note = screen.getByText(/marked as unable/i)
    expect(note.className).not.toMatch(/error/)
    expect(note.getAttribute('role')).toBe('status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still says something when the holder has left the roster, rather than vanishing', () => {
    // The pairing is what is wrong, not the label. Between another phone removing
    // a person and this one refreshing the id names nobody, and the exclusion row
    // is still there until its cascade lands.
    setup({
      chores: [{ ...chores[0], assigned_member_id: 'gone' }, chores[1]],
      exclusions: [{ id: 'x1', chore_id: 'c1', member_id: 'gone' }],
    })
    expect(screen.getByText(/someone not on the roster is marked as unable/i)).toBeInTheDocument()
  })
})
