import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Split from './Split.jsx'

// The split surface — story #47.
//
// Names are synthetic — see #19.
//
// WHAT THESE TESTS ARE AND ARE NOT
//
// They cover what the screen DRAWS from a given household: the fill each bar
// gets, the sentence above them, the order of the rows, and what happens at the
// two degenerate ends (nobody with capacity, somebody with none). They do NOT
// stand up a Supabase client, fake or real, and they assert no access rule —
// gate.test.js refuses a component test that does, for the reason
// docs/access-model.md records: a fake client returns whatever the test tells
// it to, so a boundary "proved" against one stays green with the policies
// dropped.
//
// Criterion 5 — that this surface and the allocator agree — is NOT here. It is
// in src/lib/allocation.test.js, because it is a claim about two functions
// rather than about a rendering, and asserting it through a component would let
// a passing test mean "the screen happened to print matching numbers".

const members = [
  { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300 },
  { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
]

const capacities = [
  { id: 'm1', capacityMinutes: 300 },
  { id: 'm2', capacityMinutes: 60 },
]

/** A chore row as PostgREST returns it, with only what this surface reads. */
const chore = (id, minutes, holder, extra = {}) => ({
  id,
  title: 'Placeholder Chore',
  expected_minutes: minutes,
  assigned_member_id: holder ?? null,
  completed_at: null,
  ...extra,
})

/** `n` identical chores held by one person — used where the fixture needs a
 *  granularity fine enough for level to be reachable, which takes more rows
 *  than anybody wants to write out. */
const jobs = (prefix, n, minutes, holder) =>
  Array.from({ length: n }, (_, i) => chore(`${prefix}${i}`, minutes, holder))

const setup = (props = {}) =>
  render(
    <Split
      members={members}
      capacities={capacities}
      chores={[]}
      exclusions={[]}
      {...props}
    />,
  )

const row = (id) => screen.getByTestId(`split-${id}`)
const fill = (id, which) => within(row(id)).getByTestId(`fill-${which}`).style.width
const verdict = () => screen.getByTestId('split-verdict')

describe('criterion 1 — proportional equality with unequal absolute loads', () => {
  // 150 of 300 and 30 of 60. Five times the minutes, the same share, and the
  // charter's whole thesis in one fixture: fair means every bar level, whatever
  // the capacities are.
  const level = [
    chore('a', 150, 'm1'),
    chore('b', 30, 'm2'),
  ]

  it('draws both bars at the same fill, though one carries five times the minutes', () => {
    setup({ chores: level })
    expect(fill('m1', 'open')).toBe('50%')
    expect(fill('m2', 'open')).toBe('50%')
  })

  it('says the split is level', () => {
    setup({ chores: level })
    expect(verdict()).toHaveTextContent('The split is level.')
  })

  it('POSITIVE CONTROL: the same two people at different SHARES are not level', () => {
    // Without this, the assertions above pass identically against a surface
    // that says "level" unconditionally and draws every bar at 50% — which is
    // exactly what a stubbed-out first draft looks like.
    setup({ chores: [chore('a', 300, 'm1'), chore('b', 6, 'm2')] })
    expect(fill('m1', 'open')).toBe('100%')
    expect(fill('m2', 'open')).toBe('10%')
    expect(verdict()).not.toHaveTextContent('The split is level.')
  })
})

describe('criterion 2 — how far from level, in minutes', () => {
  // 240 of 300 against 12 of 60 — the criterion's own numbers. Six-minute jobs
  // rather than two big ones, so that level is genuinely REACHABLE here and the
  // sentence under test is the off-level one rather than the unreachable one.
  // Fair shares are 210 and 42, so the first member is 30 minutes over: the
  // figure the criterion names.
  const lopsided = [...jobs('a', 40, 6, 'm1'), ...jobs('b', 2, 6, 'm2')]

  it('states the gap in minutes, and names whose share it is past', () => {
    setup({ chores: lopsided })
    expect(verdict()).toHaveTextContent('30 min off level')
    expect(verdict()).toHaveTextContent('Placeholder One is carrying 30 min more than their share')
  })

  it('states no chore count, on a fixture where counts and minutes disagree', () => {
    // Equal counts, unequal minutes: one 90-minute chore each is two chores,
    // and the two people are nowhere near level. A statement that reached for a
    // count would have "1" available and equal, which is the exact conflation
    // the prototype found read as broken ("10 chores moved" beside "-1 +1").
    setup({ chores: [chore('a', 90, 'm1'), chore('b', 45, 'm2')] })
    expect(verdict()).not.toHaveTextContent(/\bchores?\b/i)
    expect(verdict()).not.toHaveTextContent(/\b1\b(?!\d)/)
    expect(verdict()).toHaveTextContent(/min/)
  })

  it('POSITIVE CONTROL: a level household states no gap at all', () => {
    // A notice that fires on a healthy household is an absent notice — the
    // charter's rule, and the reason this control is here rather than assumed.
    setup({ chores: [chore('a', 150, 'm1'), chore('b', 30, 'm2')] })
    expect(verdict()).not.toHaveTextContent(/off level/)
  })
})

describe('criterion 3 — the bar is minutes over that person’s own capacity', () => {
  it('renders by MINUTES where the chore counts say the opposite', () => {
    // One 90-minute chore against three 10-minute ones, on equal capacities. By
    // minutes the first person is at 90% and the second at 30%. By COUNT the
    // ordering inverts — 1 against 3 — so a count-based bar fails here rather
    // than merely being differently scaled.
    setup({
      capacities: [
        { id: 'm1', capacityMinutes: 100 },
        { id: 'm2', capacityMinutes: 100 },
      ],
      chores: [
        chore('a', 90, 'm1'),
        chore('b', 10, 'm2'),
        chore('c', 10, 'm2'),
        chore('d', 10, 'm2'),
      ],
    })
    expect(fill('m1', 'open')).toBe('90%')
    expect(fill('m2', 'open')).toBe('30%')
  })

  it('divides by that member’s OWN capacity, not the household total', () => {
    // 30 of 60 is half of this person's week and a twelfth of the household's.
    // A bar drawn against the household total would read 8%.
    setup({ chores: [chore('b', 30, 'm2')] })
    expect(fill('m2', 'open')).toBe('50%')
  })
})

describe('criterion 4 — when level cannot be reached, say why', () => {
  // The charter's measured granularity floor: when a member's capacity
  // approaches the size of one indivisible chore, level is arithmetically
  // impossible. 25 minutes of capacity against a smallest job of 10.
  const tight = {
    members: [
      { id: 'big', display_name: 'Placeholder One', weekly_minutes: 250 },
      { id: 'small', display_name: 'Placeholder Two', weekly_minutes: 25 },
    ],
    capacities: [
      { id: 'big', capacityMinutes: 250 },
      { id: 'small', capacityMinutes: 25 },
    ],
    chores: [
      chore('a', 60, 'big'),
      chore('b', 60, 'big'),
      chore('c', 50, 'big'),
      chore('d', 20, 'big'),
      chore('e', 10, 'big'),
    ],
  }

  it('names the person, their fair share in minutes, and the smallest job', () => {
    setup(tight)
    expect(verdict()).toHaveTextContent('Level cannot be reached this week')
    expect(verdict()).toHaveTextContent('Placeholder Two')
    expect(verdict()).toHaveTextContent(/fair share is \d+ min/)
    expect(verdict()).toHaveTextContent('smallest job is 10 min')
  })

  it('never states the split IS level while the verdict says otherwise', () => {
    setup(tight)
    expect(verdict()).not.toHaveTextContent('The split is level')
  })

  it('POSITIVE CONTROL: a household the allocator CAN level says nothing about reachability', () => {
    // Without this the assertions above pass against a surface that prints the
    // unreachable sentence for every household that is not level — which would
    // be wrong for the ordinary case of a week nobody has divided yet, and
    // wrong in the direction that erodes trust in the number.
    setup({ chores: [...jobs('a', 40, 6, 'm1'), ...jobs('b', 2, 6, 'm2')] })
    expect(verdict()).toHaveTextContent('off level')
    expect(verdict()).not.toHaveTextContent('cannot be reached')
  })
})

describe('criterion 6 — roster order, and never a ranking', () => {
  it('keeps roster order when the load order differs', () => {
    // The second member carries the larger SHARE, so any sort by load — either
    // direction — inverts these two.
    setup({ chores: [chore('a', 30, 'm1'), chore('b', 54, 'm2')] })
    const names = screen
      .getAllByRole('listitem')
      .filter((li) => li.className.includes('split__row'))
      .map((li) => li.textContent)
    expect(names[0]).toMatch(/Placeholder One/)
    expect(names[1]).toMatch(/Placeholder Two/)
  })

  it('POSITIVE CONTROL: the two orders really do differ on this fixture', () => {
    // The order assertion above is vacuous on a fixture where roster order and
    // load order agree, and they agree on most fixtures. This pins that the one
    // above is a fixture where a sort would be visible.
    setup({ chores: [chore('a', 30, 'm1'), chore('b', 54, 'm2')] })
    expect(fill('m1', 'open')).toBe('10%')
    expect(fill('m2', 'open')).toBe('90%')
  })

  it('renders no rank, position, score or comparison between people', () => {
    setup({ chores: [chore('a', 30, 'm1'), chore('b', 54, 'm2')] })
    const surface = screen.getByRole('region', { name: /the split/i })
    expect(surface).not.toHaveTextContent(
      /rank|score|points|leaderboard|streak|position|1st|2nd|winner|loser|worst|best|most|least/i,
    )
  })

  it('the verdict names at most ONE person, so it cannot become a comparison', () => {
    // "A is carrying 30 min more than B" is the sentence this screen must never
    // say. Naming one person against THEIR OWN share is the whole design; naming
    // two is the inversion of it.
    setup({ chores: [chore('a', 30, 'm1'), chore('b', 54, 'm2')] })
    const named = members.filter((m) => verdict().textContent.includes(m.display_name))
    expect(named).toHaveLength(1)
  })
})

describe('criterion 7 — done and outstanding are distinct within the bar', () => {
  const done = (id, minutes, holder, extra = {}) =>
    chore(id, minutes, holder, { completed_at: '2026-08-25T10:00:00Z', ...extra })

  it('draws completed and outstanding work as separate segments', () => {
    // 60 done and 90 still to do, against 300 minutes.
    setup({ chores: [done('a', 60, 'm1'), chore('b', 90, 'm1')] })
    expect(fill('m1', 'done')).toBe('20%')
    expect(fill('m1', 'open')).toBe('30%')
  })

  it('open work contributes EXPECTED minutes and done work contributes ACTUAL', () => {
    // The decision #12's own AC 6 left open, taken here as its recommended
    // option (a). The completed chore was estimated at 20 and took 80, so a bar
    // that used the estimate for done work would read 20% rather than 80%.
    setup({ chores: [done('a', 20, 'm1', { actual_minutes: 80 })] })
    expect(fill('m1', 'done')).toBe(`${(80 / 300) * 100}%`)
    expect(fill('m1', 'done')).not.toBe(`${(20 / 300) * 100}%`)
  })

  it('falls back to the estimate when no actual was recorded, which is today', () => {
    // Nothing writes `actual_minutes` until #12, so this is the path that
    // actually runs — and the fallback is on ABSENCE, so a chore genuinely
    // recorded at zero must not silently become its estimate. That case is
    // covered in allocation.test.js, where it can be asked without a render.
    setup({ chores: [done('a', 60, 'm1')] })
    expect(fill('m1', 'done')).toBe('20%')
  })

  it('draws no member in the palette reserved for a problem state', () => {
    // Red is for work, never for people. An over-committed member gets the same
    // colours as everybody else and a line of text that says how far over.
    setup({ chores: [chore('a', 400, 'm1')] })
    expect(row('m1').querySelector('.error')).toBeNull()
    expect(row('m1').querySelector('[role="alert"]')).toBeNull()
    expect(row('m1')).toHaveTextContent('100 min over')
  })

  it('a bar cannot grow past its track, however over-committed the person is', () => {
    setup({ chores: [chore('a', 400, 'm1')] })
    expect(fill('m1', 'open')).toBe('100%')
  })
})

// The three claims #36 made on the chore screen and #47 moved here. They are in
// their own describe rather than folded into the criteria above because they
// are inherited coverage: the tests that held them were deleted from
// Chores.test.jsx in this same change, and a claim that moves without a test
// that moves with it is coverage quietly dropped.
describe('inherited from #36 — what each person is carrying, and what is left', () => {
  it('says the minutes carried and the minutes left, in plain figures', () => {
    setup({ chores: [chore('a', 20, 'm1'), chore('b', 30, 'm2')] })
    expect(row('m1')).toHaveTextContent('20 of 300 min')
    expect(row('m1')).toHaveTextContent('280 min left')
    expect(row('m2')).toHaveTextContent('30 min left')
  })

  it('a person holding nothing still appears, at zero', () => {
    // The most important row on a fairness screen, and the one an
    // implementation keyed on the chore list rather than on the roster silently
    // drops.
    setup({ chores: [chore('a', 20, 'm1')] })
    expect(row('m2')).toHaveTextContent('0 of 60 min')
    expect(row('m2')).toHaveTextContent('60 min left')
    expect(fill('m2', 'open')).toBe('0%')
  })

  it('completed work no longer LEAVES the figure — #47 criterion 7 supersedes that', () => {
    // #36 asserted the opposite here, and correctly for the screen it was
    // about: commitment there was outstanding minutes, so a finished chore left
    // the figure entirely. This surface shows the whole week, split into what
    // is done and what is not, because a bar that shrinks as work is completed
    // cannot answer "did we divide this fairly".
    setup({
      chores: [
        chore('a', 20, 'm1'),
        chore('b', 90, 'm1', { completed_at: '2026-08-25T10:00:00Z' }),
      ],
    })
    expect(row('m1')).toHaveTextContent('110 of 300 min')
    expect(row('m1')).toHaveTextContent('90 min done')
    expect(row('m1')).toHaveTextContent('20 min still to do')
  })
})

describe('criterion 8 — a member with no capacity this period', () => {
  const noneThisWeek = {
    capacities: [
      { id: 'm1', capacityMinutes: 300 },
      { id: 'm2', capacityMinutes: 0 },
    ],
  }

  it('says they have no minutes, rather than drawing them full or infinite', () => {
    setup(noneThisWeek)
    const cell = within(row('m2')).getByTestId('no-capacity')
    expect(cell).toHaveTextContent('No minutes this week')
    expect(row('m2').textContent).not.toMatch(/Infinity|NaN|100%/)
  })

  it('draws them no bar at all — a share of nothing is not a share of zero', () => {
    setup(noneThisWeek)
    expect(within(row('m2')).queryByTestId('fill-open')).toBeNull()
  })

  it('still reports work they are holding, which is the thing worth seeing', () => {
    setup({ ...noneThisWeek, chores: [chore('a', 45, 'm2')] })
    expect(within(row('m2')).getByTestId('no-capacity')).toHaveTextContent('45 min still assigned')
  })

  it('SYNTHETIC CONTROL: a member missing from `capacities` is drawn no bar either', () => {
    // The state no fixture here produces and no mutation could reach: `App.jsx`
    // builds `capacities` with one entry per member, so the roster and the
    // capacity list are the same length on every render this app performs. The
    // defence against them diverging is therefore unexercised by construction —
    // and an unexercised defence is byte-identical to dead code to whoever is
    // tidying up.
    //
    // So the condition is CREATED here. Keyed the other way round — on presence
    // in the no-capacity list rather than on absence from the split — this
    // member is drawn a bar dividing by a capacity nobody supplied, which
    // renders `NaN%`: an empty bar that reads as somebody carrying nothing,
    // on the criterion that exists to forbid exactly that.
    render(
      <Split
        members={members}
        capacities={[{ id: 'm1', capacityMinutes: 300 }]}
        chores={[chore('a', 150, 'm1')]}
        exclusions={[]}
      />,
    )
    expect(within(row('m2')).queryByTestId('fill-open')).toBeNull()
    expect(row('m2')).toHaveTextContent('No minutes this week')
    expect(screen.getByRole('region', { name: /the split/i }).innerHTML).not.toMatch(/NaN/)
  })

  it('leaves them out of the levelness verdict rather than dragging it down', () => {
    // Two people, one with no minutes: level is not a real question, and the
    // surface must not answer it as though it were.
    setup({ ...noneThisWeek, chores: [chore('a', 150, 'm1')] })
    expect(verdict()).toHaveTextContent(/nothing to level yet/)
  })
})

describe('criterion 9 — work nobody holds', () => {
  it('shows unassigned work in its own area, with its minutes', () => {
    setup({ chores: [chore('a', 150, 'm1'), chore('u', 25, null)] })
    const area = screen.getByRole('region', { name: /needs attention/i })
    expect(area).toBeInTheDocument()
    expect(screen.getByTestId('unassigned-total')).toHaveTextContent('25 min of work nobody has yet')
  })

  it('keeps it OUT of the fairness arithmetic, so nobody is reported underloaded for it', () => {
    // 240 and 12 minutes held, plus 90 nobody holds. Excluded — correctly — the
    // fair shares are 210 and 42 and the household is 30 minutes off level.
    // COUNTED, they become 285 and 57, nobody is above their share at all, and
    // the screen stops being able to say how far off level anything is: a
    // household told it is behind on work nobody has agreed to do.
    //
    // The fixture is chosen so that the two answers DIFFER in what is said.
    // A level household would not have worked: levelness is computed from
    // shares, which the orphan does not touch, so the obvious fixture agrees
    // with itself whichever rule is in force and proves nothing.
    setup({ chores: [...jobs('a', 40, 6, 'm1'), ...jobs('b', 2, 6, 'm2'), chore('u', 90, null)] })
    expect(verdict()).toHaveTextContent('30 min off level')
  })

  it('POSITIVE CONTROL: that fixture really does have orphan work in it', () => {
    // Without this the assertion above passes identically on a fixture where
    // the orphan chore was never created, which is the shape of empty fixture
    // that makes a discriminating test stop discriminating silently.
    setup({ chores: [...jobs('a', 40, 6, 'm1'), ...jobs('b', 2, 6, 'm2'), chore('u', 90, null)] })
    expect(screen.getByTestId('unassigned-total')).toHaveTextContent('90 min of work nobody has yet')
  })

  it('POSITIVE CONTROL: the area is absent when every chore has somebody', () => {
    // Without this the area could be permanently present and empty, which reads
    // as a household that always has something wrong with it.
    setup({ chores: [chore('a', 150, 'm1')] })
    expect(screen.queryByRole('region', { name: /needs attention/i })).toBeNull()
  })

  it('does not treat FINISHED work nobody was given as needing attention', () => {
    setup({
      chores: [chore('a', 150, 'm1'), chore('u', 25, null, { completed_at: '2026-08-25T10:00:00Z' })],
    })
    expect(screen.queryByRole('region', { name: /needs attention/i })).toBeNull()
  })
})

describe('the degenerate households, where "level" would be a maximum score for nothing', () => {
  it('an empty household is not told its split is level', () => {
    render(<Split members={[]} capacities={[]} chores={[]} exclusions={[]} />)
    expect(verdict()).toHaveTextContent('Nobody has any minutes this week')
    expect(verdict()).not.toHaveTextContent('The split is level')
  })

  it('a household where only one person has minutes is not told its split is level', () => {
    setup({
      capacities: [
        { id: 'm1', capacityMinutes: 300 },
        { id: 'm2', capacityMinutes: 0 },
      ],
    })
    expect(verdict()).not.toHaveTextContent('The split is level')
  })

  it('POSITIVE CONTROL: two people with minutes and nothing to do IS level', () => {
    // The boundary matters in both directions. A household that has divided
    // nothing yet is genuinely level — every share is zero — and refusing to
    // say so would be the mirror mistake.
    setup({ chores: [] })
    expect(verdict()).toHaveTextContent('The split is level.')
  })
})

describe('an exclusion is respected when judging whether level is reachable', () => {
  // 150 and 30 minutes against capacities of 300 and 60. There is a perfect
  // split — 150 to the first person and 30 to the second, both at half their
  // week — and it is the ONLY one, because the 30-minute job is the only thing
  // the smaller budget can hold. Barring that person from it is therefore what
  // makes level unreachable, and nothing else in the fixture changes.
  const both = [chore('a', 150, 'm1'), chore('b', 30, 'm1')]
  const barred = [{ id: 'x', chore_id: 'b', member_id: 'm2' }]

  it('does not claim level is reachable by giving work to somebody barred from it', () => {
    setup({ chores: both, exclusions: barred })
    expect(verdict()).toHaveTextContent('cannot be reached')
  })

  it('POSITIVE CONTROL: without the exclusion the same household is reachable', () => {
    // Byte-identical fixture but for the exclusion, so the difference between
    // these two results is the exclusion and cannot be anything else.
    setup({ chores: both })
    expect(verdict()).toHaveTextContent('off level')
    expect(verdict()).not.toHaveTextContent('cannot be reached')
  })
})
