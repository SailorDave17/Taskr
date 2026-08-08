import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHORE_COLUMNS,
  MAX_EXPECTED_MINUTES,
  MIN_EXPECTED_MINUTES,
  normalizeDueDate,
  normalizeExpectedMinutes,
  normalizeTitle,
} from './chores.js'

// #34 — the validators the form and the data layer share.
//
// These are not the security boundary and none of them can be: the rules that
// hold are the check constraints and column grants in 0003, exercised in
// src/test/chores.pglite.test.js against a real Postgres. What is tested here is
// that a person gets a sentence instead of a constraint violation, and that the
// bounds this file states match the ones the database enforces.

describe('expected minutes — the unit the fairness split divides', () => {
  it('accepts a whole number inside the bounds', () => {
    expect(normalizeExpectedMinutes(20)).toBe(20)
    expect(normalizeExpectedMinutes('45')).toBe(45)
  })

  it('accepts both ends, matching the check constraint exactly', () => {
    expect(normalizeExpectedMinutes(MIN_EXPECTED_MINUTES)).toBe(1)
    expect(normalizeExpectedMinutes(MAX_EXPECTED_MINUTES)).toBe(1440)
  })

  it('states the bounds 0003 actually enforces, read out of the migration itself', () => {
    // This test previously asserted `MIN).toBe(1)` and `MAX).toBe(1440)` and
    // carried a comment claiming it would catch the constants drifting from the
    // constraint. It could not: it never opened the SQL, and it was fully
    // subsumed by the test three lines above — every mutation that reddened it
    // reddened that one too, so it carried no independent signal. Reading the
    // migration is what the name always promised. Same idiom as
    // src/test/gate.test.js, which readFileSyncs vite.config.js and App.jsx.
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0003_chores.sql'), 'utf8')
    expect(sql).toMatch(
      new RegExp(`between\\s+${MIN_EXPECTED_MINUTES}\\s+and\\s+${MAX_EXPECTED_MINUTES}`),
    )
  })

  for (const [label, value] of [
    ['blank', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
  ]) {
    it(`refuses ${label} by asking the question rather than reporting a type error`, () => {
      expect(() => normalizeExpectedMinutes(value)).toThrow(/how many minutes/i)
    })
  }

  it('refuses zero rather than rounding it up to one', () => {
    // A chore costing no time cannot be allocated against a budget of minutes.
    // Clamping it to 1 would put a meaningless row into the calculation the
    // fairness claim rests on.
    expect(() => normalizeExpectedMinutes(0)).toThrow(/at least a minute/i)
  })

  it('refuses a negative', () => {
    expect(() => normalizeExpectedMinutes(-30)).toThrow(/at least a minute/i)
  })

  it('refuses a fraction, because the column is an integer', () => {
    expect(() => normalizeExpectedMinutes(20.5)).toThrow(/whole number/i)
  })

  it('refuses more than a day of work, and says what to do instead', () => {
    expect(() => normalizeExpectedMinutes(1441)).toThrow(/split it into smaller chores/i)
  })

  it('refuses text that is not a number at all', () => {
    expect(() => normalizeExpectedMinutes('a while')).toThrow(/must be a number/i)
  })
})

describe('the due date is a calendar date, all the way down', () => {
  it('passes a well-formed date through unchanged', () => {
    expect(normalizeDueDate('2026-08-10')).toBe('2026-08-10')
  })

  it('does NOT shift the day for anyone west of UTC', () => {
    // The bug this guards: parsing '2026-08-10' with `new Date()` gives UTC
    // midnight, and formatting it back with local getters returns the 9th for
    // every timezone behind UTC. A chore due Monday would be stored as Sunday
    // for half the world. Asserting identity is what proves no Date round-trip
    // was introduced.
    for (const date of ['2026-01-01', '2026-08-10', '2026-12-31']) {
      expect(normalizeDueDate(date)).toBe(date)
    }
  })

  it('asks for a date when one is missing', () => {
    expect(() => normalizeDueDate('')).toThrow(/when is this chore due/i)
    expect(() => normalizeDueDate(null)).toThrow(/when is this chore due/i)
  })

  it('refuses a shape the date column would not take', () => {
    expect(() => normalizeDueDate('Monday')).toThrow(/look like/i)
    expect(() => normalizeDueDate('10/08/2026')).toThrow(/look like/i)
    expect(() => normalizeDueDate('2026-8-10')).toThrow(/look like/i)
  })

  it('refuses a date that is well-shaped and not real', () => {
    // The regex is happy with all of these; only the round-trip catches them.
    expect(() => normalizeDueDate('2026-02-31')).toThrow(/not a real date/i)
    expect(() => normalizeDueDate('2026-13-01')).toThrow(/not a real month/i)
    expect(() => normalizeDueDate('2026-04-31')).toThrow(/not a real date/i)
  })

  it('accepts a real leap day and refuses one that is not', () => {
    expect(normalizeDueDate('2028-02-29')).toBe('2028-02-29')
    expect(() => normalizeDueDate('2026-02-29')).toThrow(/not a real date/i)
  })
})

describe('the title', () => {
  it('trims, because a trailing space is not part of a chore name', () => {
    expect(normalizeTitle('  Dishes  ')).toBe('Dishes')
  })

  it('refuses an empty or whitespace-only name', () => {
    expect(() => normalizeTitle('')).toThrow(/needs a name/i)
    expect(() => normalizeTitle('   ')).toThrow(/needs a name/i)
  })

  it('refuses a name longer than the column takes', () => {
    expect(normalizeTitle('x'.repeat(80))).toHaveLength(80)
    expect(() => normalizeTitle('x'.repeat(81))).toThrow(/too long/i)
  })
})

describe('the readable column list', () => {
  it('matches 0003 select grant exactly, so select(*) is never needed', () => {
    // A column grant makes `select('*')` fail outright rather than quietly
    // returning a narrower row, so this list is load-bearing rather than tidy.
    expect(CHORE_COLUMNS.split(',').map((c) => c.trim()).sort()).toEqual([
      'created_at',
      'due_on',
      'expected_minutes',
      'id',
      'title',
    ])
  })

  it('does not ask for household_id, which 0003 withholds', () => {
    // Asking for it would make every read fail with a permission error. The
    // column is written on insert and never read back — see 0003.
    expect(CHORE_COLUMNS).not.toContain('household_id')
  })

  it('does not contain a wildcard', () => {
    expect(CHORE_COLUMNS).not.toContain('*')
  })
})
