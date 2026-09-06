// #97 — the calendar's suggestion as a capacity prefill, and the word the row
// carries once it is confirmed.
//
// Pure functions only: no client, no database. What the constraint does with
// the third word is calendarCapacity.pglite.test.js; what the roster does with
// the prefill is Roster.test.jsx. This file is the arithmetic and the list.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAPACITY_SOURCES,
  MIN_CAPACITY_MINUTES,
  calendarSuggestion,
  effectiveCapacity,
} from './capacity.js'

const member = { id: 'm1', weekly_minutes: 300 }
const busy = (minutes) => ({ member_id: 'm1', period_start: '2026-09-07', busy_minutes: minutes })

describe('AC 1 — the prefill is max(0, baseline − busy), the owner’s formula', () => {
  it('subtracts the busy minutes from the BASELINE, not from this week’s override', () => {
    // The formula names the baseline (owner decision, 2026-08-16). A version
    // that read the effective figure would compound: confirm 240, re-open,
    // and the calendar would now suggest 180 against the 240 it just wrote.
    expect(calendarSuggestion(member, busy(60))).toBe(240)
  })

  it('floors at zero when the calendar says the whole week is spoken for', () => {
    expect(calendarSuggestion(member, busy(300))).toBe(0)
    expect(calendarSuggestion(member, busy(10140))).toBe(0)
    expect(MIN_CAPACITY_MINUTES, 'the floor is the constraint’s floor').toBe(0)
  })

  it('suggests exactly the baseline for an empty week — zero busy is an answer', () => {
    expect(calendarSuggestion(member, busy(0))).toBe(300)
  })

  it('has NOTHING to suggest without a derived row, rather than suggesting zero', () => {
    // `null`, not 0: the readout offers a tap only when there is a figure to
    // take, and "no time this week" is too plausible an answer to invent.
    expect(calendarSuggestion(member, null)).toBeNull()
    expect(calendarSuggestion(member, undefined)).toBeNull()
  })

  it('has nothing to suggest for a figure that is not a number', () => {
    expect(calendarSuggestion(member, busy(null))).toBeNull()
    expect(calendarSuggestion(member, busy('soon'))).toBeNull()
  })

  it('treats a member with no baseline as zero, so the floor holds', () => {
    expect(calendarSuggestion({ id: 'm9' }, busy(30))).toBe(0)
  })
})

describe('AC 4 — a confirmed calendar figure resolves like any other override', () => {
  // The shipped rules, restated against a row whose `source` is the new word,
  // so a resolver that started reading `source` would redden here. The
  // resolver does not read it: the presence of the row decides, never what
  // put it there.
  const calendarRow = (minutes) => ({ member_id: 'm1', period_start: '2026-09-07', minutes, source: 'calendar' })

  it('override wins — the confirmed figure is the week’s capacity', () => {
    expect(effectiveCapacity(member, calendarRow(240))).toBe(240)
  })

  it('zero wins — a calendar that fills the week yields no time, not the baseline', () => {
    expect(effectiveCapacity(member, calendarRow(0))).toBe(0)
  })

  it('baseline otherwise — no row means the usual minutes', () => {
    expect(effectiveCapacity(member, null)).toBe(300)
    expect(effectiveCapacity(member, undefined)).toBe(300)
  })

  it('REGRESSION: a manual row resolves exactly as before', () => {
    expect(effectiveCapacity(member, { ...calendarRow(90), source: 'manual' })).toBe(90)
    expect(effectiveCapacity(member, { ...calendarRow(0), source: 'manual' })).toBe(0)
  })
})

describe('the words a capacity row may carry', () => {
  it('lists exactly what 0031’s constraint admits, read out of the migration', () => {
    // The same discipline as the minutes bounds against 0005: the list in the
    // module and the list in the constraint are two copies, and this is what
    // holds them equal. A fourth proposer has to arrive in both.
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0031_calendar_capacity_source.sql'),
      'utf8',
    )
    const match = sql.match(/check \(source in \(([^)]*)\)\)/)
    expect(match, 'the constraint must be spelled as `check (source in (...))`').not.toBeNull()
    const admitted = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    expect([...CAPACITY_SOURCES]).toEqual(admitted)
  })

  it('is frozen — a caller cannot grow it at runtime', () => {
    expect(Object.isFrozen(CAPACITY_SOURCES)).toBe(true)
    expect(CAPACITY_SOURCES).toContain('calendar')
  })
})
