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
    onAddMany: vi.fn().mockResolvedValue([]),
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
    <Chores
      chores={chores}
      members={members}
      capacities={capacities}
      exclusions={[]}
      repeatExceptions={[]}
      todayIso="2026-08-24"
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
    onAddMany: vi.fn().mockResolvedValue([]),
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
  const props = {
    members,
    capacities,
    exclusions: [],
    repeatExceptions: [],
    todayIso: '2026-08-24',
    ...handlers,
  }
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
    // The per-person figure this asserted moved to the split surface in #47,
    // so the household aggregate above is the only figure left on this screen.
    // What the fence was ALWAYS about is the line below, and it is unchanged:
    // nothing here ranks anybody, on either screen.
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
      // #53 — the untouched form declares no repeat, explicitly.
      repeatKind: 'none',
      repeatWeekdays: [],
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

// The load figures moved to the split surface — #47.
//
// This describe held eight tests about `Commitment`, which #36 shipped here as
// deliberately the ugliest honest form and whose own comment said #47 owned the
// presentation and would replace it. It has. Every claim in it survives, and it
// is worth saying WHERE, because a describe that simply disappears reads later
// as coverage dropped:
//
//   per-person committed minutes, and what is left ...... Split.test.jsx, c.1/c.7
//   minutes rather than a count of chores ............... Split.test.jsx, c.3
//   an over-committed person reads "over", not 0 left ... Split.test.jsx, c.7
//   a person holding nothing still appears, at zero ..... Split.test.jsx, c.7
//   roster order even when the load says otherwise ...... Split.test.jsx, c.6
//   nothing that ranks anybody ......................... Split.test.jsx, c.6
//
// TWO of the eight are SUPERSEDED rather than moved, and both were #36 saying
// what it was not doing yet:
//
//   "completed work LEAVES the figure" — #47 criterion 7 makes done work a
//   distinct segment INSIDE the bar rather than absent from it, so the claim is
//   now the opposite one and Split.test.jsx asserts it in that form.
//
//   "no bar, no rank, no percentage — the presentation is #47, not this story"
//   — there is a bar now, and a percentage in the bar's accessible name. The
//   half of that test which was never about timing (nothing ranks) is what
//   survives, on the surface that draws them.

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
    onSkip: vi.fn().mockResolvedValue(undefined),
  }
  const props = { members, capacities, repeatExceptions: [], todayIso: '2026-08-24', ...handlers }
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

describe('#53 — the repeat is set where the chore is created', () => {
  const kindSelect = () => screen.getByLabelText(/how often this chore repeats/i)
  const chooseKind = (kind) => fireEvent.change(kindSelect(), { target: { value: kind } })

  it('offers a structured schedule and no free-text field — AC 6 at the form', () => {
    setup()
    const options = within(kindSelect())
      .getAllByRole('option')
      .map((o) => o.value)
    // Monthly is #103, exceptions are #105 — named follow-ups. Their absence
    // here is the decision, so it is asserted rather than implied.
    expect(options).toEqual(['none', 'daily', 'weekly'])
  })

  it('reveals the weekday picker only for weekly', () => {
    setup()
    expect(screen.queryByLabelText(/repeat on mon/i)).not.toBeInTheDocument()
    chooseKind('weekly')
    expect(screen.getByLabelText(/repeat on mon/i)).toBeInTheDocument()
    chooseKind('daily')
    expect(screen.queryByLabelText(/repeat on mon/i)).not.toBeInTheDocument()
  })

  it('submits a weekly repeat with the chosen days', async () => {
    const { onAdd } = setup()
    fillAddForm()
    chooseKind('weekly')
    fireEvent.click(screen.getByLabelText(/repeat on mon/i))
    fireEvent.click(screen.getByLabelText(/repeat on thu/i))
    await submitAdd()

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
      repeatKind: 'weekly',
      repeatWeekdays: [1, 4],
    })
  })

  it('refuses weekly with no day chosen, with a sentence, and sends nothing', async () => {
    const { onAdd } = setup()
    fillAddForm()
    chooseKind('weekly')
    await submitAdd()

    expect(screen.getByRole('alert')).toHaveTextContent(/at least one weekday/i)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('drops stale weekday choices when the kind leaves weekly, so they cannot silently re-arm', async () => {
    const { onAdd } = setup()
    fillAddForm()
    chooseKind('weekly')
    fireEvent.click(screen.getByLabelText(/repeat on thu/i))
    chooseKind('none')
    await submitAdd()

    expect(onAdd).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
      repeatKind: 'none',
      repeatWeekdays: [],
    })
  })

  it('a repeating chore says its schedule on the row, and a generated occurrence stays ordinary', () => {
    setup({
      chores: [
        {
          ...chores[0],
          repeat_kind: 'weekly',
          repeat_weekdays: [1, 4],
        },
        {
          ...chores[1],
          repeat_kind: 'none',
          repeat_weekdays: null,
          generated_from: 'c1',
        },
      ],
    })
    const parent = screen.getByText('Placeholder Chore').closest('li')
    expect(parent).toHaveTextContent('repeats weekly on Mon, Thu')
    // AC 7: an occurrence is work like any other — no badge, no second kind of
    // chore on the screen.
    const occurrence = screen.getByText('Placeholder Other Chore').closest('li')
    expect(occurrence).not.toHaveTextContent(/repeats/i)
  })
})

describe('#54 — the repeat is edited where the chore is edited', () => {
  const repeatAnchor = { ...chores[0], repeat_kind: 'weekly', repeat_weekdays: [1, 4] }
  const occurrence = {
    ...chores[1],
    repeat_kind: 'none',
    repeat_weekdays: null,
    generated_from: 'c1',
  }
  const openAnchorEditor = () =>
    clickAndSettle(screen.getByRole('button', { name: /edit placeholder chore/i }))
  const saveEdit = () => clickAndSettle(screen.getByRole('button', { name: /^save$/i }))

  it('seeds the editor with the schedule the row actually has', async () => {
    setup({ chores: [repeatAnchor] })
    await openAnchorEditor()

    expect(screen.getByLabelText(/how often placeholder chore repeats/i)).toHaveValue('weekly')
    expect(screen.getByLabelText(/repeat placeholder chore on mon/i)).toBeChecked()
    expect(screen.getByLabelText(/repeat placeholder chore on thu/i)).toBeChecked()
    expect(screen.getByLabelText(/repeat placeholder chore on tue/i)).not.toBeChecked()
  })

  it('switching off sends the pair — kind none, days emptied', async () => {
    const { onSave } = setup({ chores: [repeatAnchor] })
    await openAnchorEditor()

    fireEvent.change(screen.getByLabelText(/how often placeholder chore repeats/i), {
      target: { value: 'none' },
    })
    await saveEdit()

    expect(onSave).toHaveBeenCalledWith('c1', {
      title: 'Placeholder Chore',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
      repeatKind: 'none',
      repeatWeekdays: [],
    })
  })

  it('an untouched schedule travels in NO save — an ordinary edit needs no repeat privilege', async () => {
    // Not an optimisation: the pair is only sent when it changed, so a
    // title-only edit works against a project where 0024 is not yet applied —
    // the client and the migration deploy on different clocks.
    const { onSave } = setup({ chores: [repeatAnchor] })
    await openAnchorEditor()

    fireEvent.change(screen.getByLabelText(/name for placeholder chore/i), {
      target: { value: 'Placeholder Renamed Chore' },
    })
    await saveEdit()

    // Exact-match on purpose: repeatKind present at all would fail this.
    expect(onSave).toHaveBeenCalledWith('c1', {
      title: 'Placeholder Renamed Chore',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
    })
  })

  it('a generated occurrence offers no schedule controls, and its save carries none', async () => {
    const { onSave } = setup({ chores: [repeatAnchor, occurrence] })
    await clickAndSettle(screen.getByRole('button', { name: /edit placeholder other chore/i }))

    expect(
      screen.queryByLabelText(/how often placeholder other chore repeats/i),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/name for placeholder other chore/i), {
      target: { value: 'Placeholder Renamed Occurrence' },
    })
    await saveEdit()

    expect(onSave).toHaveBeenCalledWith('c2', {
      title: 'Placeholder Renamed Occurrence',
      expectedMinutes: '90',
      dueOn: '2026-08-11',
    })
  })

  it('weekly with every day unchecked is refused with a sentence, and sends nothing', async () => {
    const { onSave } = setup({ chores: [repeatAnchor] })
    await openAnchorEditor()

    fireEvent.click(screen.getByLabelText(/repeat placeholder chore on mon/i))
    fireEvent.click(screen.getByLabelText(/repeat placeholder chore on thu/i))
    await saveEdit()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one weekday/i)
  })

  it('AC 4 — removing a repeat says the recorded choice out loud: occurrences stay', async () => {
    setup({ chores: [repeatAnchor, chores[1]] })

    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder chore$/i }))
    expect(screen.getByText(/ends the repeat/i)).toHaveTextContent(
      'Chores it already put on the list stay there.',
    )
    await clickAndSettle(screen.getByRole('button', { name: /keep/i }))

    // A plain chore's confirmation says no such thing — there is no schedule
    // to end and nothing generated to speak for.
    await clickAndSettle(screen.getByRole('button', { name: /remove placeholder other chore$/i }))
    expect(screen.queryByText(/ends the repeat/i)).not.toBeInTheDocument()
  })
})

describe('#12 — expected-vs-actual capture and feedback', () => {
  // An anchor due back this week with three finished occurrences behind it.
  // Literal values: expected 20, actuals averaging exactly 25 — the 25%
  // boundary — so the offer below is asserted AT the threshold, not past it.
  const anchor = {
    id: 'r1',
    household_id: 'h1',
    title: 'Placeholder Repeat',
    expected_minutes: 20,
    due_on: '2026-08-24',
    completed_at: null,
    completed_by_member_id: null,
    repeat_kind: 'daily',
  }
  const occurrence = (id, actual) => ({
    id,
    household_id: 'h1',
    title: 'Placeholder Repeat',
    expected_minutes: 20,
    due_on: '2026-08-17',
    completed_at: '2026-08-17T10:00:00Z',
    completed_by_member_id: 'm1',
    generated_from: 'r1',
    actual_minutes: actual,
  })
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

  it('AC 2 — a completed chore says what it took beside what was expected', () => {
    setup({ chores: [doneOneOff] })
    const row = screen.getByText('Placeholder Done Chore').closest('li')
    expect(row).toHaveTextContent('30 min')
    expect(row).toHaveTextContent('took 45 min')
  })

  it('AC 2 — the anchor shows expected versus average-actual, side by side', () => {
    setup({ chores: [anchor, occurrence('o1', 24), occurrence('o2', 32)] })
    // (24 + 32) / 2 = 28.
    expect(screen.getByTestId('feedback-r1')).toHaveTextContent(
      'expected 20 min · actually ~28 min over 2 completions',
    )
  })

  it('AC 3 — a repeat with no completed instances says "no data yet", never an average', () => {
    setup({ chores: [anchor] })
    expect(screen.getByTestId('feedback-r1')).toHaveTextContent('no data yet')
    expect(screen.getByTestId('feedback-r1')).not.toHaveTextContent(/actually/)
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

  it('an outstanding chore offers no actual control — there is nothing to have taken time yet', () => {
    setup({ chores: [anchor] })
    expect(screen.queryByLabelText(/actually took/)).not.toBeInTheDocument()
  })

  it('AC 4 — at exactly 3 completions and exactly 25%, the one-tap update is offered and applies', async () => {
    const handlers = setup({
      chores: [anchor, occurrence('o1', 25), occurrence('o2', 25), occurrence('o3', 25)],
    })
    const button = screen.getByRole('button', { name: /update estimate to 25 min/i })
    await clickAndSettle(button)
    // The anchor's ordinary estimate edit: occurrences copy minutes at
    // creation (0012), so this reaches future occurrences only — #54's
    // ratified propagation option (b) by construction.
    expect(handlers.onSave).toHaveBeenCalledWith('r1', { expectedMinutes: 25 })
  })

  it('AC 4 — below either threshold, no update is offered', () => {
    // Two completions at a huge deviation, then three at a small one.
    setup({ chores: [anchor, occurrence('o1', 120), occurrence('o2', 120)] })
    expect(screen.queryByRole('button', { name: /update estimate/i })).not.toBeInTheDocument()
  })

  it('AC 4 — three completions inside 25% offer nothing either', () => {
    setup({ chores: [anchor, occurrence('o1', 24), occurrence('o2', 24), occurrence('o3', 24)] })
    expect(screen.queryByRole('button', { name: /update estimate/i })).not.toBeInTheDocument()
  })
})

describe('batch entry — #220, several chores in one pass', () => {
  const openBatch = () =>
    clickAndSettle(screen.getByRole('button', { name: /add several at once/i }))
  const confirmBatch = () =>
    clickAndSettle(screen.getByRole('button', { name: /add these chores/i }))

  /** Fill draft row at 1-based position. Any field may be omitted. */
  function fillDraft(position, { title, minutes, due } = {}) {
    if (title !== undefined) {
      fireEvent.change(screen.getByLabelText(new RegExp(`title for chore ${position}$`, 'i')), {
        target: { value: title },
      })
    }
    if (minutes !== undefined) {
      fireEvent.change(
        screen.getByLabelText(new RegExp(`expected minutes for chore ${position}$`, 'i')),
        { target: { value: minutes } },
      )
    }
    if (due !== undefined) {
      fireEvent.change(screen.getByLabelText(new RegExp(`due date for chore ${position}$`, 'i')), {
        target: { value: due },
      })
    }
  }

  it('AC 6: closed by default — the single form is the default path, the batch an addition', () => {
    setup()
    expect(screen.getByRole('button', { name: /add chore/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add several at once/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/title for chore 1/i)).not.toBeInTheDocument()
  })

  it('AC 1: rows are entered and edited as a list, and NOTHING is written until the list is confirmed', async () => {
    const handlers = setup()
    await openBatch()

    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    fillDraft(2, { title: 'water the plants', minutes: '5', due: '2026-08-11' })
    await clickAndSettle(screen.getByRole('button', { name: /add another row/i }))
    fillDraft(3, { title: 'fold the laundry', minutes: '20', due: '2026-08-12' })

    // Three rows entered, edited, on screen — and no write has happened.
    expect(screen.getAllByLabelText(/title for chore \d/i)).toHaveLength(3)
    expect(handlers.onAddMany).not.toHaveBeenCalled()
    expect(handlers.onAdd).not.toHaveBeenCalled()
  })

  it('confirming hands every entered row to the batch write, in entry order', async () => {
    const handlers = setup()
    handlers.onAddMany.mockResolvedValue([{ ok: true }, { ok: true }])
    await openBatch()

    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    fillDraft(2, { title: 'water the plants', minutes: '5', due: '2026-08-11' })
    await confirmBatch()

    expect(handlers.onAddMany).toHaveBeenCalledTimes(1)
    expect(handlers.onAddMany).toHaveBeenCalledWith([
      { title: 'sweep the porch', expectedMinutes: '15', dueOn: '2026-08-10' },
      { title: 'water the plants', expectedMinutes: '5', dueOn: '2026-08-11' },
    ])
    // Everything landed, so the panel closes and the button returns.
    expect(screen.getByRole('button', { name: /add several at once/i })).toBeInTheDocument()
  })

  it('AC 2: any row can be removed before confirming, and only the rest are written', async () => {
    const handlers = setup()
    handlers.onAddMany.mockResolvedValue([{ ok: true }])
    await openBatch()

    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    fillDraft(2, { title: 'water the plants', minutes: '5', due: '2026-08-11' })
    await clickAndSettle(screen.getByRole('button', { name: /remove chore 1 from the list/i }))
    await confirmBatch()

    expect(handlers.onAddMany).toHaveBeenCalledWith([
      { title: 'water the plants', expectedMinutes: '5', dueOn: '2026-08-11' },
    ])
  })

  it('AC 3: a row that fails validation is marked with the reason, the others stay entered, and nothing is written', async () => {
    const handlers = setup()
    await openBatch()

    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    // The bad value is an EMPTY due date, and the choice is forced rather than
    // convenient: a date input cannot hold '2026-02-31' — jsdom and real
    // browsers alike coerce an unreal date to the empty string — so the
    // normalizer's own not-a-real-date refusal is unreachable through this
    // control and lives in dueDates.test.js. Empty is what this UI can produce.
    fillDraft(2, { title: 'water the plants', minutes: '5' })
    await confirmBatch()

    expect(handlers.onAddMany).not.toHaveBeenCalled()
    // The bad row carries the normalizer's own sentence, on that row.
    expect(screen.getByRole('alert')).toHaveTextContent(/when is this chore due/i)
    // And the good row is still entered, not discarded — the failure that
    // would make this worse than the single form it augments.
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('sweep the porch')
    expect(screen.getByLabelText(/title for chore 2/i)).toHaveValue('water the plants')
  })

  it('AC 3: fixing the marked row and re-confirming writes the batch', async () => {
    const handlers = setup()
    handlers.onAddMany.mockResolvedValue([{ ok: true }, { ok: true }])
    await openBatch()

    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    fillDraft(2, { title: 'water the plants', minutes: '0', due: '2026-08-11' })
    await confirmBatch()
    expect(handlers.onAddMany).not.toHaveBeenCalled()
    // OUR sentence, not merely the absence of a call — the same discrimination
    // the single form's AC 2 test earned: without noValidate on the batch form,
    // the browser's own min-constraint interception also blocks the submit, and
    // the absence would be produced by a neighbour.
    expect(screen.getByRole('alert')).toHaveTextContent(/at least a minute/i)

    fillDraft(2, { minutes: '5' })
    await confirmBatch()
    expect(handlers.onAddMany).toHaveBeenCalledWith([
      { title: 'sweep the porch', expectedMinutes: '15', dueOn: '2026-08-10' },
      { title: 'water the plants', expectedMinutes: '5', dueOn: '2026-08-11' },
    ])
  })

  it('a row left entirely blank is dropped rather than refused — the spare row costs nothing', async () => {
    const handlers = setup()
    handlers.onAddMany.mockResolvedValue([{ ok: true }])
    await openBatch()

    // The panel opened with two rows; only the first is filled.
    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    await confirmBatch()

    expect(handlers.onAddMany).toHaveBeenCalledWith([
      { title: 'sweep the porch', expectedMinutes: '15', dueOn: '2026-08-10' },
    ])
  })

  it('confirming with nothing entered refuses with a sentence and writes nothing', async () => {
    const handlers = setup()
    await openBatch()
    await confirmBatch()

    expect(handlers.onAddMany).not.toHaveBeenCalled()
    expect(screen.getByTestId('batch-notice')).toHaveTextContent(/nothing entered yet/i)
  })

  it('AC 5: a partial failure says how many saved, keeps the refused rows marked, and re-confirming submits only those', async () => {
    const handlers = setup()
    // A neutral server refusal, deliberately NOT Postgres vocabulary: the AC 10
    // gate refuses any component test whose stub speaks as the database, and
    // this component only displays whatever sentence it is handed.
    handlers.onAddMany
      .mockResolvedValueOnce([
        { ok: true, chore: { id: 'n1' } },
        { ok: false, message: 'adding the chore: the server refused this row' },
      ])
      .mockResolvedValueOnce([{ ok: true, chore: { id: 'n2' } }])
    await openBatch()

    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    fillDraft(2, { title: 'water the plants', minutes: '5', due: '2026-08-11' })
    await confirmBatch()

    // Told which saved and which did not — the summary and the marked row.
    expect(screen.getByTestId('batch-notice')).toHaveTextContent(/1 of 2 saved/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/the server refused this row/i)
    // The saved row is GONE from the list — that is what makes re-confirming
    // unable to duplicate it.
    expect(screen.getAllByLabelText(/title for chore \d/i)).toHaveLength(1)
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('water the plants')

    await confirmBatch()
    expect(handlers.onAddMany).toHaveBeenLastCalledWith([
      { title: 'water the plants', expectedMinutes: '5', dueOn: '2026-08-11' },
    ])
    // Everything is in now; the panel closes.
    expect(screen.getByRole('button', { name: /add several at once/i })).toBeInTheDocument()
  })

  it('cancelling discards the drafts — they were never written, so nothing has to be undone', async () => {
    const handlers = setup()
    await openBatch()
    fillDraft(1, { title: 'sweep the porch', minutes: '15', due: '2026-08-10' })
    await clickAndSettle(screen.getByRole('button', { name: /^cancel$/i }))

    expect(handlers.onAddMany).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/title for chore 1/i)).not.toBeInTheDocument()

    // Reopening starts fresh rather than resurrecting the discarded list.
    await openBatch()
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('')
  })

  it('AC 6: the single form still adds one chore while the panel is open', async () => {
    const handlers = setup()
    handlers.onAddMany.mockResolvedValue([])
    await openBatch()

    // Queried WITHIN the single form's own element, because the draft rows
    // reuse the same visible field labels and an unscoped query would match
    // both — the collision is the panel's, not the form's, which is the point:
    // the form itself is untouched.
    const singleForm = screen.getByRole('button', { name: /add chore/i }).closest('form')
    const form = within(singleForm)
    fireEvent.change(form.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(form.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(form.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await submitAdd()
    expect(handlers.onAdd).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
      repeatKind: 'none',
      repeatWeekdays: [],
    })
  })
})

// ---------------------------------------------------------------------------
// #105 — skipping one occurrence of a repeat
//
// Everything here is about the SCREEN: what is offered, what is said, and which
// handler fires. The rules — the exception stored, the uncompleted instance
// removed and a completed one kept, the pass honouring the stored date — live
// in Postgres and are exercised by src/test/repeats.pglite.test.js, exactly as
// the #37 block above splits its story.
// ---------------------------------------------------------------------------

describe('skipping one occurrence — #105', () => {
  // A weekly-on-Monday anchor with one completed instance (history) and one
  // outstanding one (today's). todayIso is the setup default, 2026-08-24 — a
  // Monday — so the upcoming offers are the following Mondays.
  const anchor = {
    id: 'r1',
    household_id: 'h1',
    title: 'Placeholder Repeat',
    expected_minutes: 10,
    due_on: '2026-08-10',
    completed_at: null,
    completed_by_member_id: null,
    repeat_kind: 'weekly',
    repeat_weekdays: [1],
  }
  const doneInstance = {
    id: 'r2',
    household_id: 'h1',
    title: 'Placeholder Repeat',
    expected_minutes: 10,
    due_on: '2026-08-17',
    generated_from: 'r1',
    completed_at: '2026-08-17T20:00:00Z',
    completed_by_member_id: 'm1',
  }
  const openInstance = {
    id: 'r3',
    household_id: 'h1',
    title: 'Placeholder Repeat',
    expected_minutes: 10,
    due_on: '2026-08-24',
    generated_from: 'r1',
    completed_at: null,
    completed_by_member_id: null,
  }
  const repeatFixture = [anchor, doneInstance, openInstance]

  const skipSelect = () =>
    screen.getByLabelText(/skip one date placeholder repeat repeats on/i)

  it('offers the upcoming schedule dates from the anchor, and choosing one calls onSkip', () => {
    const { onSkip } = setup({ chores: repeatFixture })
    const options = within(skipSelect())
      .getAllByRole('option')
      .map((o) => o.value)
      .filter(Boolean)
    // Today's generated instance, then the next Mondays inside the horizon.
    expect(options).toEqual(['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'])

    fireEvent.change(skipSelect(), { target: { value: '2026-08-31' } })
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledWith('r1', '2026-08-31')
  })

  it("a generated outstanding date is offered as already on the list; a completed one is history and is not", () => {
    setup({ chores: repeatFixture })
    const select = within(skipSelect())
    expect(select.getByRole('option', { name: /2026-08-24 — already on the list/i })).toBeInTheDocument()
    // 2026-08-17 was completed: skipping it would read as a way to un-do work.
    expect(select.queryByRole('option', { name: /2026-08-17/ })).toBeNull()
  })

  it('a date already skipped is not offered again, and is announced', () => {
    setup({
      chores: repeatFixture,
      repeatExceptions: [{ id: 'e1', chore_id: 'r1', excluded_on: '2026-08-31' }],
    })
    expect(within(skipSelect()).queryByRole('option', { name: '2026-08-31' })).toBeNull()
    expect(screen.getByText(/won't repeat on 2026-08-31/i)).toBeInTheDocument()
  })

  it('a spent skip — today or older — is neither offered nor restated', () => {
    setup({
      chores: repeatFixture,
      repeatExceptions: [{ id: 'e1', chore_id: 'r1', excluded_on: '2026-08-24' }],
    })
    // The instance's date is skipped, so it is not offered again; its effect
    // (the row leaving the list on the next refresh) is not a future fact to
    // announce.
    expect(within(skipSelect()).queryByRole('option', { name: /2026-08-24/ })).toBeNull()
    expect(screen.queryByText(/won't repeat on/i)).toBeNull()
  })

  it('no skip control on a one-off, and none on a generated occurrence row', () => {
    setup({ chores: repeatFixture })
    // The default fixtures c1/c2 are one-offs; r3 is a generated occurrence.
    // Exactly one control exists on this screen and it is the anchor's.
    expect(screen.getAllByLabelText(/skip one date/i)).toHaveLength(1)
    expect(screen.queryByTestId('skip-c1')).toBeNull()
    expect(screen.queryByTestId('skip-r3')).toBeNull()
    expect(screen.getByTestId('skip-r1')).toBeInTheDocument()
  })

  it('with no todayIso the control renders nothing rather than guessing a calendar', () => {
    setup({ chores: repeatFixture, todayIso: null })
    expect(screen.queryByLabelText(/skip one date/i)).toBeNull()
  })
})
