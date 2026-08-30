// Due dates as strings, all the way down — #34's rule, widened by #202.
//
// This module is a LEAF on purpose: it imports nothing, so the extraction
// grader can import it without breaking its own no-network wall
// (extraction.test.js asserts the grader's import list, and chores.js — the
// previous home of normalizeDueDate — imports supabase.js). chores.js
// re-exports it, so every existing caller is untouched.
//
// WHY EVERYTHING IS A STRING
//
// The column is a calendar date (`chores.due_on`), and the classic fault is a
// Date round-trip that parses YYYY-MM-DD as UTC midnight and formats it back
// with local getters — returning the previous day everywhere behind UTC, and
// invisible in UTC itself. The suite pins TZ to Pacific/Marquesas (see
// vite.config.js) precisely so that fault is observable; this module's defence
// is stronger — no Date object crosses its boundary in either direction, and
// its internal arithmetic runs entirely in Date.UTC space, where there is no
// zone to shift the answer.

/** ISO weekday number per lower-cased name, 1 = Monday … 7 = Sunday. */
const ISO_DOW_BY_NAME = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
}

/** Month number per lower-cased full name. Full names only — a vocabulary an
 * extractor's output can be held to, stated in docs/extraction-corpus.md. */
const MONTH_BY_NAME = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

function isRealDate(year, month, day) {
  const asUtc = new Date(Date.UTC(year, month - 1, day))
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  )
}

function isoOf(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Calendar arithmetic in UTC space — no local zone is ever consulted. */
function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
  return isoOf(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

function isoDowOf(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return sundayFirst === 0 ? 7 : sundayFirst
}

/**
 * The local calendar date named by a reference string.
 *
 * Accepts `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM…` and takes the DATE PART OF THE
 * STRING, never a Date round trip. That is the whole of the timezone defence:
 * `new Date('2026-08-26T23:59').toISOString()` at Pacific/Marquesas is already
 * the 27th, so an implementation that goes through a Date answers "tomorrow"
 * differently at one minute to local midnight than at local midday. Slicing
 * the string cannot — the date part of a local datetime IS the local date.
 */
function referenceDateOf(reference) {
  const match = /^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/.exec(String(reference).trim())
  if (!match) throw new Error('A reference date needs to look like 2026-08-10, with or without a time.')
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12) throw new Error('That is not a real month.')
  if (!isRealDate(year, month, day)) throw new Error('That is not a real date.')
  return isoOf(year, month, day)
}

/** The next calendar date bearing `month`/`day`, on or after `refIso`. */
function nextOccurrenceOf(refIso, month, day) {
  const refYear = Number(refIso.slice(0, 4))
  // Eight years covers the longest gap between leap days; a day/month that is
  // real in no year (30 february) falls out of the loop instead.
  for (let year = refYear; year <= refYear + 8; year += 1) {
    if (!isRealDate(year, month, day)) continue
    const candidate = isoOf(year, month, day)
    if (candidate >= refIso) return candidate
  }
  throw new Error('That is not a real date.')
}

/**
 * A due date as the `date` column wants it: `YYYY-MM-DD`, no time, no zone.
 *
 * TWO CALLING SHAPES, one function:
 *
 * - `normalizeDueDate(value)` — the form path, unchanged from #34: ISO only,
 *   and anything else is refused with a sentence. The date picker produces
 *   ISO, so a phrase arriving here is a bug, not an input.
 * - `normalizeDueDate(value, referenceDate)` — the extraction path, #202: a
 *   date as a person STATES it, resolved against an explicit reference. The
 *   vocabulary is deliberately small and stated (docs/extraction-corpus.md):
 *
 *     ISO            '2026-09-18'        → itself, validated
 *     weekday        'tuesday'           → the next such day ON OR AFTER the
 *                                          reference — said on a Tuesday,
 *                                          "Tuesday" means today
 *     relative       'today' | 'tonight' | 'tomorrow'
 *     bare date      'september 3', '3 september', 'the 3rd of september',
 *                    'september the 3rd' → the next such date on or after the
 *                                          reference (year inferred)
 *
 *   'next tuesday' is REFUSED, deliberately: English does not agree on whether
 *   it means this week's or the following week's, and a normaliser that picks
 *   one silently is inventing a fact. Extraction never invents a date — a
 *   description stating no date yields no date, and the confirm form supplies
 *   it (#202, decided at the filing gate).
 *
 * String in, string out, in BOTH positions: a Date object is refused rather
 * than tolerated, because tolerating one reintroduces the UTC-midnight fault
 * this module exists to keep out.
 */
export function normalizeDueDate(value, referenceDate) {
  if (value instanceof Date || referenceDate instanceof Date) {
    throw new Error('A due date is a string here — a Date object must not cross this boundary.')
  }
  const text = String(value ?? '').trim()
  if (!text) throw new Error('When is this chore due?')

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number)
    if (month < 1 || month > 12) throw new Error('That is not a real month.')
    if (!isRealDate(year, month, day)) throw new Error('That is not a real date.')
    return text
  }

  if (referenceDate === undefined || referenceDate === null) {
    // The one-argument form is the pre-#202 contract, kept byte-for-byte: the
    // form path has no "today" to resolve a phrase against.
    throw new Error('A due date needs to look like 2026-08-10.')
  }

  const ref = referenceDateOf(referenceDate)
  const phrase = text.toLowerCase().replace(/\s+/g, ' ')

  if (phrase === 'today' || phrase === 'tonight') return ref
  if (phrase === 'tomorrow') return addDays(ref, 1)

  const weekday = ISO_DOW_BY_NAME[phrase]
  if (weekday) {
    return addDays(ref, (weekday - isoDowOf(ref) + 7) % 7)
  }

  const dayFirst = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)$/.exec(phrase)
  const monthFirst = /^([a-z]+)(?: the)? (\d{1,2})(?:st|nd|rd|th)?$/.exec(phrase)
  const bare = dayFirst
    ? { day: Number(dayFirst[1]), monthName: dayFirst[2] }
    : monthFirst
      ? { day: Number(monthFirst[2]), monthName: monthFirst[1] }
      : null
  if (bare && MONTH_BY_NAME[bare.monthName]) {
    if (bare.day < 1) throw new Error('That is not a real date.')
    return nextOccurrenceOf(ref, MONTH_BY_NAME[bare.monthName], bare.day)
  }

  throw new Error(
    'That is not a date this understands — a weekday, today, tonight, tomorrow, a day and month, or 2026-08-10.',
  )
}
