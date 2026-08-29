import { describe, expect, it } from 'vitest'
import { normalizeDueDate } from './dueDates.js'

// #202 — the widened normalizeDueDate: a stated date plus an explicit
// reference date, string in and string out.
//
// The reference used throughout is 2026-08-26, a WEDNESDAY — the same
// reference the extraction corpus pins (DUE_REFERENCE), so every expected
// value here was hand-computed on the same calendar the corpus's expectations
// were. Weekday names in these fixtures are written in lower case where the
// assertion does not need otherwise: gate.test.js scans this file for
// name-shaped literals, and the capitalised weekdays it does declare exist for
// other files' reasons — not a licence to scatter more.

const WEDNESDAY = '2026-08-26'

describe('the one-argument form path — #34 behaviour, unchanged by the move', () => {
  it('accepts ISO and nothing else without a reference', () => {
    expect(normalizeDueDate('2026-08-10')).toBe('2026-08-10')
    expect(() => normalizeDueDate('tuesday')).toThrow(/look like/i)
    expect(() => normalizeDueDate('tomorrow')).toThrow(/look like/i)
  })
})

describe('AC 2 — the four stated forms, resolved against an explicit reference', () => {
  it('passes an ISO date through unchanged', () => {
    expect(normalizeDueDate('2026-09-18', WEDNESDAY)).toBe('2026-09-18')
  })

  it('still refuses an impossible ISO date, reference or not', () => {
    expect(() => normalizeDueDate('2026-02-31', WEDNESDAY)).toThrow(/not a real date/i)
    expect(() => normalizeDueDate('2026-13-01', WEDNESDAY)).toThrow(/not a real month/i)
  })

  it('resolves a weekday to the next such day ON OR AFTER the reference', () => {
    // From a Wednesday: tomorrow's name lands this week, an earlier name wraps
    // to next week, and the reference's own name means TODAY — "take the bins
    // out on Wednesday", said on a Wednesday, is about tonight's bins.
    expect(normalizeDueDate('thursday', WEDNESDAY)).toBe('2026-08-27')
    expect(normalizeDueDate('sunday', WEDNESDAY)).toBe('2026-08-30')
    expect(normalizeDueDate('monday', WEDNESDAY)).toBe('2026-08-31')
    expect(normalizeDueDate('tuesday', WEDNESDAY)).toBe('2026-09-01')
    expect(normalizeDueDate('wednesday', WEDNESDAY)).toBe('2026-08-26')
  })

  it('reads a weekday whatever its case, because a phone keyboard decides that', () => {
    expect(normalizeDueDate('Tuesday', WEDNESDAY)).toBe('2026-09-01')
    expect(normalizeDueDate('TUESDAY', WEDNESDAY)).toBe('2026-09-01')
  })

  it('resolves today, tonight and tomorrow', () => {
    expect(normalizeDueDate('today', WEDNESDAY)).toBe('2026-08-26')
    expect(normalizeDueDate('tonight', WEDNESDAY)).toBe('2026-08-26')
    expect(normalizeDueDate('tomorrow', WEDNESDAY)).toBe('2026-08-27')
  })

  it('carries tomorrow across a month boundary', () => {
    expect(normalizeDueDate('tomorrow', '2026-08-31')).toBe('2026-09-01')
  })

  it('resolves a bare day-and-month in every spelling the corpus uses', () => {
    expect(normalizeDueDate('september 12', WEDNESDAY)).toBe('2026-09-12')
    expect(normalizeDueDate('12 september', WEDNESDAY)).toBe('2026-09-12')
    expect(normalizeDueDate('the 12th of september', WEDNESDAY)).toBe('2026-09-12')
    expect(normalizeDueDate('september the 12th', WEDNESDAY)).toBe('2026-09-12')
  })

  it('infers the year as the next occurrence on or after the reference', () => {
    // January has passed by late August, so a bare "january 5" is next year's.
    expect(normalizeDueDate('january 5', WEDNESDAY)).toBe('2027-01-05')
    // The reference's own date is "on or after", not "after".
    expect(normalizeDueDate('august 26', WEDNESDAY)).toBe('2026-08-26')
    // A leap day rolls to the next year in which it exists at all.
    expect(normalizeDueDate('february 29', WEDNESDAY)).toBe('2028-02-29')
  })

  it('refuses a day-and-month that exists in no year', () => {
    expect(() => normalizeDueDate('february 30', WEDNESDAY)).toThrow(/not a real date/i)
    expect(() => normalizeDueDate('the 0th of september', WEDNESDAY)).toThrow(/not a real date/i)
  })

  it('collapses surrounding and internal whitespace before reading the phrase', () => {
    expect(normalizeDueDate('  tomorrow  ', WEDNESDAY)).toBe('2026-08-27')
    expect(normalizeDueDate('the  12th   of  september', WEDNESDAY)).toBe('2026-09-12')
  })

  it('refuses what it does not understand rather than guessing', () => {
    // "next tuesday" is deliberately OUT of the vocabulary: English does not
    // agree on which Tuesday it names, and a normaliser that picks one
    // silently is inventing a fact — the corpus's whole reason for the
    // no-date-stated rule. The grader turns this refusal into a date miss.
    expect(() => normalizeDueDate('next tuesday', WEDNESDAY)).toThrow(/not a date this understands/i)
    expect(() => normalizeDueDate('whenever', WEDNESDAY)).toThrow(/not a date this understands/i)
    expect(() => normalizeDueDate('soonish', WEDNESDAY)).toThrow(/not a date this understands/i)
  })

  it('refuses a reference that is not a date string', () => {
    expect(() => normalizeDueDate('tomorrow', 'someday')).toThrow(/reference date/i)
    expect(() => normalizeDueDate('tomorrow', '2026-02-31')).toThrow(/not a real date/i)
  })

  it('is string in, string out — a Date object is refused in either position', () => {
    // AC 2's boundary clause. Tolerating a Date on the way in reintroduces the
    // UTC-midnight parse this module exists to keep out; producing one on the
    // way out hands the fault to the caller instead. Both directions refused.
    expect(() => normalizeDueDate(new Date(), WEDNESDAY)).toThrow(/Date object/i)
    expect(() => normalizeDueDate('tomorrow', new Date())).toThrow(/Date object/i)
    expect(typeof normalizeDueDate('tomorrow', WEDNESDAY)).toBe('string')
  })
})

describe('AC 3 — the reference is a local calendar date, never a Date round trip', () => {
  it('POSITIVE CONTROL: the suite really is pinned behind UTC', () => {
    // Without the pin, the midnight assertions below pass against the very
    // implementation they exist to refuse — at UTC, local midnight IS UTC
    // midnight and a toISOString round trip cannot shift the date. Asserting
    // the precondition here keeps the next two tests from going quietly
    // vacuous if the pin ever moves (vite.config.js explains the zone choice).
    expect(process.env.TZ).toBe('Pacific/Marquesas')
  })

  it('answers the same one minute before local midnight as at local midday', () => {
    // Pacific/Marquesas is UTC-9:30, so 23:59 local is 09:29 the NEXT day in
    // UTC. An implementation that reaches the reference's date via
    // `new Date(ref).toISOString()` calls tomorrow the 28th at one minute to
    // midnight and the 27th at noon; reading the date part of the string —
    // which IS the local date — cannot split.
    expect(normalizeDueDate('tomorrow', '2026-08-26T23:59')).toBe('2026-08-27')
    expect(normalizeDueDate('tomorrow', '2026-08-26T12:00')).toBe('2026-08-27')
  })

  it('holds for weekdays and today as well as for tomorrow', () => {
    expect(normalizeDueDate('tuesday', '2026-08-26T23:59')).toBe('2026-09-01')
    expect(normalizeDueDate('tuesday', '2026-08-26T12:00')).toBe('2026-09-01')
    expect(normalizeDueDate('today', '2026-08-26T23:59')).toBe('2026-08-26')
  })
})
