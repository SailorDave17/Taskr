// The suggestion corpus — #480 AC 1.
//
// Every expected figure below was worked out BY HAND before `suggestCapacity`
// was run against it, `allocation.corpus.js`'s discipline and for its reason:
// a corpus whose expectations were produced by calling the code under test
// asserts only that the code still does what it did. The arithmetic is shown
// beside each case so a reader can check it without the module.
//
// `shape` names which of the story's shapes the case covers (steady person,
// busier week, quieter week, one blank week, no calendar); the test asserts
// every one is present, so a deleted case cannot leave the corpus quietly
// covering four. The story named a sixth, work hours only — that case, and
// the two others that ran a work term, were retired with #479 (#518; the
// reason is in docs/capacity-model.md). The rest are the edges the rule has:
// the window, the floor, rounding, a calendar read on one side only.
//
// Fixtures are ONE member's weeks. `member` is `{ id }` only — the function
// never reads the baseline, and a fixture that carried `weekly_minutes` would
// invite a reader to think the suggestion is derived from it.
//
// Names are synthetic — see #19.

const MEMBER = { id: 'm1' }

/** This week, and the four Mondays before it, oldest first. */
export const THIS_WEEK = '2026-09-14'
export const PRIOR_MONDAYS = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']
/** Six Mondays back, for the case that proves the window forgets the fifth and sixth. */
const SIX_MONDAYS = ['2026-08-03', '2026-08-10', ...PRIOR_MONDAYS]

/**
 * History rows from parallel arrays, most recent LAST. `busy` may be omitted
 * (every week unread) or carry nulls for unread weeks.
 */
export function weeks(done, busy = null) {
  if (done.length > SIX_MONDAYS.length) throw new Error('the corpus helper knows six Mondays')
  const mondays = SIX_MONDAYS.slice(-done.length)
  return done.map((doneMinutes, i) => ({
    memberId: MEMBER.id,
    periodStart: mondays[i],
    doneMinutes,
    busyMinutes: busy ? busy[i] : null,
  }))
}

const busyThisWeek = (minutes) => ({
  member_id: MEMBER.id,
  period_start: THIS_WEEK,
  busy_minutes: minutes,
})

export const SCENARIOS = [
  {
    shape: 'steady',
    name: 'steady: four alike weeks, calendar as busy as usual',
    why:
      'Done 180, 210, 210, 260 → sorted the same, median (210 + 210) / 2 = 210. Busy 90 in every ' +
      'prior week and 90 this week → difference 0. 210. The mean would be 215, ' +
      'which is the number this case exists to NOT produce.',
    member: MEMBER,
    history: weeks([180, 210, 210, 260], [90, 90, 90, 90]),
    busyWeek: busyThisWeek(90),
    expect: {
      minutes: 210,
      weeks: 4,
      typicalMinutes: 210,
      calendarDelta: 0,
      reason: ['typically 210 min done over 4 weeks', 'calendar about as busy as usual'],
    },
  },

  {
    shape: 'busier',
    name: 'busier: the same person, with a calendar 90 minutes fuller than usual',
    why: 'Typical 210 as above. Busy 180 this week against a median of 90 → 90 busier → 210 − 90 = 120.',
    member: MEMBER,
    history: weeks([180, 210, 210, 260], [90, 90, 90, 90]),
    busyWeek: busyThisWeek(180),
    expect: {
      minutes: 120,
      weeks: 4,
      typicalMinutes: 210,
      calendarDelta: 90,
      reason: ['typically 210 min done over 4 weeks', 'calendar 90 min busier this week'],
    },
  },

  {
    shape: 'quieter',
    name: 'quieter: the same person, with a calendar 60 minutes emptier than usual',
    why: 'Typical 210. Busy 30 this week against 90 → 60 quieter, ADDED BACK → 210 + 60 = 270.',
    member: MEMBER,
    history: weeks([180, 210, 210, 260], [90, 90, 90, 90]),
    busyWeek: busyThisWeek(30),
    expect: {
      minutes: 270,
      weeks: 4,
      typicalMinutes: 210,
      calendarDelta: -60,
      reason: ['typically 210 min done over 4 weeks', 'calendar 60 min quieter this week'],
    },
  },

  {
    shape: 'blank',
    name: 'one blank week: a fortnight ago nothing was done, and it counts as zero',
    why:
      'Done 240, 0, 200, 220 → sorted 0, 200, 220, 240 → median (200 + 220) / 2 = 210. The blank week ' +
      'is IN the list; skipping it would give the median of 200, 220, 240 = 220, and a mean would ' +
      'give 165. No calendar anywhere → the calendar term is 0 and the line says so. 210.',
    member: MEMBER,
    history: weeks([240, 0, 200, 220]),
    busyWeek: null,
    expect: {
      minutes: 210,
      weeks: 4,
      typicalMinutes: 210,
      calendarDelta: 0,
      reason: ['typically 210 min done over 4 weeks', 'no calendar read this week'],
    },
  },

  {
    shape: 'no-calendar',
    name: 'no calendar: three completed weeks and no calendar connected at all',
    why:
      'Three weeks is above the floor of two and below the window of four, so the line says 3. ' +
      'Done 150, 180, 160 → sorted 150, 160, 180 → median 160 (odd count, the middle value; the ' +
      'mean is 163.3). Nothing to compare the calendar against → 160.',
    member: MEMBER,
    history: weeks([150, 180, 160]),
    busyWeek: null,
    expect: {
      minutes: 160,
      weeks: 3,
      typicalMinutes: 160,
      calendarDelta: 0,
      reason: ['typically 160 min done over 3 weeks', 'no calendar read this week'],
    },
  },

  {
    shape: 'edge',
    name: 'the floor: a calendar so full the arithmetic goes negative, clamped to zero',
    why:
      'Done 30, 40, 30, 40 → median 35. Busy 600 this week against 60 → 540 busier → 35 − 540 = −505 → ' +
      'MIN_CAPACITY_MINUTES, which is 0. The reason still names the whole difference, because the ' +
      'clamp is on the figure and not on the sentence.',
    member: MEMBER,
    history: weeks([30, 40, 30, 40], [60, 60, 60, 60]),
    busyWeek: busyThisWeek(600),
    expect: {
      minutes: 0,
      weeks: 4,
      typicalMinutes: 35,
      calendarDelta: 540,
      reason: ['typically 35 min done over 4 weeks', 'calendar 540 min busier this week'],
    },
  },

  {
    shape: 'edge',
    name: 'the window: six weeks of history, and only the last four are read',
    why:
      'Six weeks 900, 900, 180, 210, 210, 260 (oldest first). The last four are 180, 210, 210, 260 → ' +
      'median 210. Over all six the median would be (210 + 260) / 2 = 235 — the two heroic weeks in ' +
      'July are exactly what the window exists to forget. The line says 4, not 6.',
    member: MEMBER,
    history: weeks([900, 900, 180, 210, 210, 260], [90, 90, 90, 90, 90, 90]),
    busyWeek: busyThisWeek(90),
    expect: {
      minutes: 210,
      weeks: 4,
      typicalMinutes: 210,
      calendarDelta: 0,
      reason: ['typically 210 min done over 4 weeks', 'calendar about as busy as usual'],
    },
  },

  {
    shape: 'edge',
    name: 'calendar read this week only: nothing in those weeks to compare it with',
    why:
      'Typical 210. The calendar was connected this week (300 busy) and never read before, so there ' +
      'is no usual to be busier than: the term is 0, not −300 and not 300, and the line says which ' +
      'side is missing. 210.',
    member: MEMBER,
    history: weeks([180, 210, 210, 260]),
    busyWeek: busyThisWeek(300),
    expect: {
      minutes: 210,
      weeks: 4,
      typicalMinutes: 210,
      calendarDelta: 0,
      reason: ['typically 210 min done over 4 weeks', 'no calendar read in those weeks'],
    },
  },

  {
    shape: 'edge',
    name: 'rounding: an even count whose median lands on a half minute',
    why:
      'Done 200, 205, 210, 220 → median (205 + 210) / 2 = 207.5 → rounded to a whole minute, 208. ' +
      'The mean is 208.75, which would round to 209. Calendar as usual → 208.',
    member: MEMBER,
    history: weeks([200, 205, 210, 220], [90, 90, 90, 90]),
    busyWeek: busyThisWeek(90),
    expect: {
      minutes: 208,
      weeks: 4,
      typicalMinutes: 208,
      calendarDelta: 0,
      reason: ['typically 208 min done over 4 weeks', 'calendar about as busy as usual'],
    },
  },
]

/** The story's shapes, less work-only (#518); the test holds the corpus to all of them. */
export const REQUIRED_SHAPES = ['steady', 'busier', 'quieter', 'blank', 'no-calendar']
