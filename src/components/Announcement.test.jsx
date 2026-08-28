import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { announcementFrom, splitSnapshot } from '../lib/announce.js'
import Announcement from './Announcement.jsx'

// #50 — the statement itself: what it says, and what it must never say.
// Names are synthetic — see #19.
//
// The announcements under test are built by the REAL `announcementFrom` over
// real snapshot diffs rather than hand-assembled objects, so a test here
// cannot pass against a shape the pipeline never produces.

const members = [
  { id: 'm1', display_name: 'Placeholder One' },
  { id: 'm2', display_name: 'Placeholder Two' },
]

const chore = (id, minutes, memberId) => ({
  id,
  expected_minutes: minutes,
  actual_minutes: null,
  assigned_member_id: memberId,
  completed_at: null,
})

const REBALANCE = {
  applied_at: '2026-08-27T18:00:00+00:00',
  contested: true,
  level: true,
  reason: null,
  boundByBudget: false,
  jobsMoved: 1,
  minutesMoved: 90,
  changeBudgetMinutes: 120,
}

/** One capacity cut, one 90-minute move from Placeholder One to Two. */
function movedNinety(verdict = REBALANCE) {
  const before = splitSnapshot({
    capacities: [
      { id: 'm1', capacityMinutes: 300 },
      { id: 'm2', capacityMinutes: 300 },
    ],
    chores: [chore('c1', 90, 'm1'), chore('c2', 50, 'm2')],
  })
  const after = splitSnapshot({
    capacities: [
      { id: 'm1', capacityMinutes: 180 },
      { id: 'm2', capacityMinutes: 300 },
    ],
    chores: [chore('c1', 90, 'm2'), chore('c2', 50, 'm2')],
  })
  return announcementFrom({
    seen: { snapshot: before, seen_rebalance_at: '2026-08-27T09:00:00Z' },
    current: after,
    lastRebalance: verdict,
  })
}

const renderNews = (announcement, onDismiss = () => {}) =>
  render(<Announcement announcement={announcement} members={members} onDismiss={onDismiss} />)

describe('AC 1 — the statement names the cause and the effect', () => {
  it('says whose week changed and by how many minutes', () => {
    renderNews(movedNinety())
    const region = screen.getByTestId('rebalance-announcement')
    expect(region).toHaveTextContent('Placeholder One’s week has 120 min less room')
  })

  it('says how many minutes moved to whom', () => {
    renderNews(movedNinety())
    const region = screen.getByTestId('rebalance-announcement')
    expect(region).toHaveTextContent('90 min of chores moved off Placeholder One’s list')
    expect(region).toHaveTextContent('Placeholder Two picked up 90 min')
  })

  it('a change with no capacity trace is stated at its honest width, not invented', () => {
    const news = movedNinety()
    renderNews({ ...news, capacityChanges: [] })
    expect(screen.getByTestId('rebalance-announcement')).toHaveTextContent(
      'Since you last looked, the chores were re-balanced.',
    )
  })
})

describe('AC 3 — every quantity is minutes', () => {
  // The prototype's failing narration was a chore COUNT beside a name delta.
  // This fixture is built so the two units disagree loudly: chore counts
  // barely change (one chore moves each way) while minutes move a lot.
  function countsDisagree() {
    const before = splitSnapshot({
      capacities: [
        { id: 'm1', capacityMinutes: 600 },
        { id: 'm2', capacityMinutes: 600 },
      ],
      chores: [chore('c1', 200, 'm1'), chore('c2', 5, 'm2')],
    })
    const after = splitSnapshot({
      capacities: [
        { id: 'm1', capacityMinutes: 300 },
        { id: 'm2', capacityMinutes: 600 },
      ],
      chores: [chore('c1', 200, 'm2'), chore('c2', 5, 'm1')],
    })
    return announcementFrom({
      seen: { snapshot: before, seen_rebalance_at: '2026-08-27T09:00:00Z' },
      current: after,
      lastRebalance: REBALANCE,
    })
  }

  it('states the minutes that moved, where a count would read as nothing happening', () => {
    renderNews(countsDisagree())
    const region = screen.getByTestId('rebalance-announcement')
    expect(region).toHaveTextContent('195 min of chores moved off Placeholder One’s list')
    expect(region).toHaveTextContent('Placeholder Two picked up 195 min')
  })

  it('phrases no quantity as a count of chores', () => {
    renderNews(countsDisagree())
    const text = screen.getByTestId('rebalance-announcement').textContent
    // "…moved off…" names minutes OF chores; what must never appear is a
    // NUMBER of chores. One chore moved each way here, so any count-based
    // phrasing would have said "1 chore" or "2 chores" — and read as nothing.
    expect(text).not.toMatch(/\d+\s+chores?\b/i)
    expect(text).toMatch(/\d+ min\b/)
  })
})

describe('AC 6 — the verdict is the run’s own, carried rather than recomputed', () => {
  it('a budget-bound run says so, in the stored figures', () => {
    renderNews(
      movedNinety({
        ...REBALANCE,
        level: false,
        boundByBudget: true,
        minutesMoved: 90,
        changeBudgetMinutes: 120,
      }),
    )
    const verdict = screen.getByTestId('announcement-verdict')
    expect(verdict).toHaveTextContent('moved 90 min and stopped there')
    expect(verdict).toHaveTextContent('change budget (120 min)')
  })

  it('a run that could not reach level names the stored reason', () => {
    renderNews(
      movedNinety({
        ...REBALANCE,
        level: false,
        reason: { memberId: 'm2', fairShareMinutes: 17, smallestJobMinutes: 25 },
      }),
    )
    const verdict = screen.getByTestId('announcement-verdict')
    expect(verdict).toHaveTextContent('could not be made level')
    expect(verdict).toHaveTextContent('Placeholder Two’s fair share is 17 min')
    expect(verdict).toHaveTextContent('smallest job is 25 min')
  })

  it('a level run announces no verdict line — the statement does not claim level either', () => {
    renderNews(movedNinety())
    expect(screen.queryByTestId('announcement-verdict')).toBeNull()
    expect(screen.getByTestId('rebalance-announcement').textContent).not.toMatch(/level/i)
  })
})

describe('AC 9 — a circumstance, never a person’s failing', () => {
  it('renders no blame, streak, score, rank or comparison vocabulary', () => {
    renderNews(movedNinety({ ...REBALANCE, level: false, boundByBudget: true }))
    const text = screen.getByTestId('rebalance-announcement').textContent
    expect(text).not.toMatch(
      /\b(behind|late|lazy|fail|failed|failing|blame|fault|slack|streak|score|points|rank|position|leaderboard|winner|loser|worst|best)\b/i,
    )
  })

  it('uses no class from the error palette on any element', () => {
    const { container } = renderNews(movedNinety())
    expect(container.querySelector('.error')).toBeNull()
    expect(container.querySelector('.button--danger')).toBeNull()
  })

  it('the announce styles use none of the error palette’s colours', () => {
    // jsdom applies no stylesheet, so the colour half of the criterion is
    // asserted against the stylesheet itself — the same reasoning as
    // gate.test.js's phone-width checks. The error palette is #7f2b2b on
    // #ffdada; a rule for any announce class carrying either would be a
    // member marked as a problem.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const classes = ['announce', 'announce__statement', 'announce__cause', 'announce__moves', 'announce__verdict', 'announce__dismiss']
    for (const name of classes) {
      const rule = css.match(new RegExp(`\\.${name}(?![\\w-])[^{]*\\{([^}]*)\\}`))
      expect(rule, `no CSS rule found for .${name}`).not.toBeNull()
      expect(rule[1]).not.toMatch(/7f2b2b|ffdada|ffeaea/i)
    }
  })
})

describe('the dismiss control', () => {
  it('hands the tap to the caller — hiding is App’s job, forgetting is the marker’s', () => {
    const onDismiss = vi.fn()
    renderNews(movedNinety(), onDismiss)
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
