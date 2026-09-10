// #106 — should a calendar read that just landed write the week? The policy
// the owner decided on 2026-09-08 (docs/capacity-model.md), tested where it is
// pure. What App does with a `true` is App.test.jsx's; what the roster shows
// for the row it writes is Roster.test.jsx's; what the constraint and the
// trigger admit is calendarAutoApply.pglite.test.js's. This file is the
// decision, its bound, and the anchor the bound is measured from.
//
// Every fixture below spells its delta beside it, because the bound is the
// whole story and a figure that happens to land inside it by accident would
// prove nothing about the comparison.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTO_APPLY_BOUND_MINUTES,
  AUTO_APPLY_REFUSED_CODE,
  autoApplyDecision,
  effectiveCapacity,
  humanFigureFor,
  isCalendarSourced,
} from './capacity.js'

const member = { id: 'm1', weekly_minutes: 300 }
const row = (minutes, source, previous = null) => ({
  member_id: 'm1',
  period_start: '2026-09-07',
  minutes,
  source,
  previous_minutes: previous,
})

describe('the bound is a named constant, and its value is the owner’s', () => {
  it('is 120 minutes — two hours, the 2026-09-08 decision', () => {
    // Pinned as a value, not merely as "a number": the model doc records why
    // 60 and 240 were rejected, and a change here is a decision to re-take
    // there first.
    expect(AUTO_APPLY_BOUND_MINUTES).toBe(120)
  })

  it('the refusal code the client recognises is the one 0039’s trigger raises', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0039_calendar_auto_apply.sql'),
      'utf8',
    )
    const codes = [...sql.matchAll(/using errcode = '([A-Z0-9]{5})'/g)].map((m) => m[1])
    expect(codes, 'POSITIVE CONTROL: the migration raises exactly one custom errcode').toEqual([
      AUTO_APPLY_REFUSED_CODE,
    ])
  })
})

describe('the anchor — the last figure a PERSON held for the week', () => {
  it('no row: the baseline', () => {
    expect(humanFigureFor(member, null)).toBe(300)
    expect(humanFigureFor(member, undefined)).toBe(300)
  })

  it('a typed, described or tap-confirmed row: that figure', () => {
    expect(humanFigureFor(member, row(100, 'manual'))).toBe(100)
    expect(humanFigureFor(member, row(100, 'extraction'))).toBe(100)
    expect(humanFigureFor(member, row(100, 'calendar'))).toBe(100)
  })

  it('an automatic row: the figure it REPLACED, carried forward — never the automatic figure', () => {
    // The whole point of the anchor (owner, at the review escalation): a chain
    // of automatic writes measures every step from what a person last held.
    expect(humanFigureFor(member, row(40, 'calendar_auto', 100))).toBe(100)
    expect(humanFigureFor(member, row(40, 'calendar_auto', 300))).toBe(300)
  })

  it('an automatic row with no previous figure (legal, never written by this client): its own figure', () => {
    expect(humanFigureFor(member, row(40, 'calendar_auto', null))).toBe(40)
  })
})

describe('AC 2 — within the bound, the suggestion applies', () => {
  it('applies over NO row when the move from the baseline is within the bound', () => {
    // 300 usual, suggestion 210: a move of 90.
    const decision = autoApplyDecision({ member, override: null, suggestion: 210 })
    expect(decision).toEqual({
      apply: true,
      reason: 'within-bound',
      from: 300,
      to: 210,
      delta: 90,
      current: 300,
    })
  })

  it('applies over a CONFIRMED calendar row — the person already said "use my calendar"', () => {
    // Confirmed at 100, the calendar now says 40: a move of 60.
    const decision = autoApplyDecision({ member, override: row(100, 'calendar'), suggestion: 40 })
    expect(decision).toMatchObject({ apply: true, from: 100, to: 40, delta: 60, current: 100 })
  })

  it('applies over an AUTOMATIC row, so an automatic week keeps following the calendar', () => {
    // The rejected "no row only" option would have refused this: the second
    // refresh of every week would have asked. Applied at 220 (was 300), the
    // calendar now says 260: 40 from the human figure, inside the bound.
    const decision = autoApplyDecision({
      member,
      override: row(220, 'calendar_auto', 300),
      suggestion: 260,
    })
    expect(decision).toMatchObject({ apply: true, from: 300, to: 260, delta: 40, current: 220 })
  })

  it('`from` is the HUMAN figure and `current` is the week’s — and they differ on an automatic row', () => {
    // `from` is what the write stores as previous_minutes and what the bound
    // is measured from; `current` is what decides no-change. On an automatic
    // row at 100 whose previous was 300, from = 300 and current = 100.
    const override = row(100, 'calendar_auto', 300)
    const decision = autoApplyDecision({ member, override, suggestion: 200 })
    expect(decision.from).toBe(humanFigureFor(member, override))
    expect(decision.from).toBe(300)
    expect(decision.current).toBe(effectiveCapacity(member, override))
    expect(decision.current).toBe(100)
    expect(decision.delta).toBe(100)
    expect(decision.apply).toBe(true)
  })

  it('a move of EXACTLY the bound applies — the boundary is pinned in one direction', () => {
    const decision = autoApplyDecision({
      member,
      override: null,
      suggestion: 300 - AUTO_APPLY_BOUND_MINUTES,
    })
    expect(decision.delta).toBe(AUTO_APPLY_BOUND_MINUTES)
    expect(decision.apply).toBe(true)
  })

  it('applies in BOTH directions — more room is a move too', () => {
    // Confirmed at 100, the calendar cleared: suggestion 190, a move of +90.
    const decision = autoApplyDecision({ member, override: row(100, 'calendar'), suggestion: 190 })
    expect(decision).toMatchObject({ apply: true, from: 100, to: 190, delta: 90 })
  })

  it('applies a ZERO — a calendar that fills the week is a legal figure, not an absence', () => {
    // Confirmed at 60, the calendar now says 0: a move of 60. `suggestion == 0`
    // must not read as "nothing to suggest".
    const decision = autoApplyDecision({ member, override: row(60, 'calendar'), suggestion: 0 })
    expect(decision).toMatchObject({ apply: true, to: 0, delta: 60 })
  })
})

describe('chaining — automatic writes cannot walk a week further than one bound from a person’s figure', () => {
  // Owner decision at the review escalation, 2026-09-08. The first draft
  // measured every step from the current figure, so three refreshes could
  // move a week 360 minutes in 120-minute steps with "(was N)" naming only the
  // last step. Every case here is written so that the STEP is inside the bound
  // and the DISTANCE FROM THE HUMAN FIGURE is what decides.
  it('refuses a small step that would take the week past one bound from the human figure', () => {
    // Human figure 300; automatic row at 200 (a 100 move, applied earlier);
    // the calendar now says 150 — a 50 step, but 150 from what a person held.
    const decision = autoApplyDecision({
      member,
      override: row(200, 'calendar_auto', 300),
      suggestion: 150,
    })
    expect(decision).toMatchObject({ apply: false, reason: 'outside-bound', from: 300, delta: 150 })
  })

  it('applies a step BACK toward the human figure, however large the step', () => {
    // Automatic row at 180 (was 300); the calendar cleared to 290 — a 110
    // step, and 10 from the human figure.
    const decision = autoApplyDecision({
      member,
      override: row(180, 'calendar_auto', 300),
      suggestion: 290,
    })
    expect(decision).toMatchObject({ apply: true, from: 300, to: 290, delta: 10, current: 180 })
  })

  it('carries the human figure forward: the write records the anchor, not the automatic figure it replaces', () => {
    const decision = autoApplyDecision({
      member,
      override: row(220, 'calendar_auto', 300),
      suggestion: 240,
    })
    expect(decision.apply).toBe(true)
    // App stores `decision.from` as previous_minutes — 300, so the NEXT read
    // measures from 300 too, and "(was 300 min)" stays a figure a person held.
    expect(decision.from).toBe(300)
  })

  it('a chain of within-bound steps is still refused once past the bound — three reads, one anchor', () => {
    let override = null
    const steps = [220, 180, 170] // 80, 120, then 130 from the baseline 300
    const verdicts = steps.map((suggestion) => {
      const decision = autoApplyDecision({ member, override, suggestion })
      if (decision.apply) override = row(decision.to, 'calendar_auto', decision.from)
      return decision.apply
    })
    expect(verdicts).toEqual([true, true, false])
    expect(override).toMatchObject({ minutes: 180, previous_minutes: 300 })
  })
})

describe('AC 3 — outside the bound, it only proposes', () => {
  it('refuses a move one minute past the bound', () => {
    const decision = autoApplyDecision({
      member,
      override: null,
      suggestion: 300 - AUTO_APPLY_BOUND_MINUTES - 1,
    })
    expect(decision.delta).toBe(AUTO_APPLY_BOUND_MINUTES + 1)
    expect(decision).toMatchObject({ apply: false, reason: 'outside-bound' })
  })

  it('refuses a move of 121 by the number, so the value and the comparison are pinned separately', () => {
    // The test above derives its fixture from the constant, so a wider bound
    // moves the fixture with it (measured on the first mutation pass: 120→240
    // reddened the literal pin and not that test). This one is the literal.
    expect(autoApplyDecision({ member, override: null, suggestion: 179 })).toMatchObject({
      apply: false,
      reason: 'outside-bound',
      delta: 121,
    })
    expect(autoApplyDecision({ member, override: null, suggestion: 180 })).toMatchObject({
      apply: true,
      delta: 120,
    })
  })

  it('refuses a large move over a calendar row too — the bound is on the CAPACITY, not on the word', () => {
    // Confirmed at 250, the calendar now says 0: a move of 250. The row's
    // word permits an automatic write; the size of the move forbids it.
    const decision = autoApplyDecision({ member, override: row(250, 'calendar'), suggestion: 0 })
    expect(decision).toMatchObject({ apply: false, reason: 'outside-bound', delta: 250 })
  })

  it('measures from the human figure, never suggestion-to-suggestion', () => {
    // The rejected measurement: a week at its baseline (300) with a previous
    // suggestion of 60 whose new suggestion is 30 has "moved 30" — and would
    // be written 270 minutes away from what the week is. Nothing about the
    // previous suggestion enters this function, so the only delta it can
    // compute is the honest one.
    const decision = autoApplyDecision({ member, override: null, suggestion: 30 })
    expect(decision).toMatchObject({ apply: false, reason: 'outside-bound', from: 300, delta: 270 })
  })
})

describe('the manual floor — a person’s figure is never overwritten by a machine', () => {
  it('refuses over a MANUAL row whatever the delta', () => {
    // Typed 100, the calendar says 90: a move of 10, well inside the bound.
    const decision = autoApplyDecision({ member, override: row(100, 'manual'), suggestion: 90 })
    expect(decision).toMatchObject({ apply: false, reason: 'person-set', from: 100, to: 90, delta: 10 })
  })

  it('refuses over an EXTRACTION row — a described week is a person’s too', () => {
    const decision = autoApplyDecision({ member, override: row(100, 'extraction'), suggestion: 90 })
    expect(decision).toMatchObject({ apply: false, reason: 'person-set' })
  })

  it('refuses over a row whose word it does not know — unknown is a person until proven otherwise', () => {
    const decision = autoApplyDecision({ member, override: row(100, 'guess'), suggestion: 90 })
    expect(decision).toMatchObject({ apply: false, reason: 'person-set' })
    expect(autoApplyDecision({ member, override: { minutes: 100 }, suggestion: 90 })).toMatchObject({
      apply: false,
      reason: 'person-set',
    })
  })

  it('the floor is checked BEFORE the bound, so the reason names the person and not the size', () => {
    // Typed 100, the calendar says 0 — outside the bound AND a person's row.
    // Either refuses; the reason that wins is the one a reader should see.
    const decision = autoApplyDecision({ member, override: row(100, 'manual'), suggestion: 0 })
    expect(decision.reason).toBe('person-set')
  })

  it('isCalendarSourced names exactly the two words the automatic path may replace', () => {
    expect(isCalendarSourced('calendar')).toBe(true)
    expect(isCalendarSourced('calendar_auto')).toBe(true)
    expect(isCalendarSourced('manual')).toBe(false)
    expect(isCalendarSourced('extraction')).toBe(false)
    expect(isCalendarSourced(undefined)).toBe(false)
  })
})

describe('nothing to write, so nothing to re-assign and nothing to announce', () => {
  it('a suggestion equal to the week’s CURRENT figure is no change', () => {
    expect(autoApplyDecision({ member, override: row(100, 'calendar'), suggestion: 100 })).toEqual({
      apply: false,
      reason: 'no-change',
      from: 100,
      to: 100,
      delta: 0,
      current: 100,
    })
    // No row, and the calendar says exactly the baseline: same answer.
    expect(autoApplyDecision({ member, override: null, suggestion: 300 })).toMatchObject({
      apply: false,
      reason: 'no-change',
    })
  })

  it('no-change is decided by the CURRENT figure, not the anchor — an automatic row at the calendar’s figure writes nothing', () => {
    // Automatic at 200 (was 300); the calendar still says 200. The anchor is
    // 300 and the delta from it is 100, but nothing on screen would change.
    expect(
      autoApplyDecision({ member, override: row(200, 'calendar_auto', 300), suggestion: 200 }),
    ).toMatchObject({ apply: false, reason: 'no-change', from: 300, current: 200 })
  })

  it('no-change wins even over a person’s row — there is nothing to protect them from', () => {
    expect(autoApplyDecision({ member, override: row(100, 'manual'), suggestion: 100 })).toMatchObject({
      apply: false,
      reason: 'no-change',
    })
  })

  it('has nothing to do with nothing to suggest — the null from calendarSuggestion carries through', () => {
    expect(autoApplyDecision({ member, override: null, suggestion: null })).toEqual({
      apply: false,
      reason: 'nothing-to-suggest',
      from: null,
      to: null,
      delta: null,
      current: null,
    })
    expect(autoApplyDecision({ member, override: null, suggestion: undefined }).apply).toBe(false)
    expect(autoApplyDecision({ member, override: null, suggestion: 'soon' }).apply).toBe(false)
  })
})
