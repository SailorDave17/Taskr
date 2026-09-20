// The two households the case-study screenshots are taken of — #452.
//
// Separated from the capture script on purpose: these are PURE data plus the
// pure functions that shape them, so `npm test` can cover them (AC 4) without
// launching a browser. The capture script is the half that cannot be unit
// tested; this is the half that carries every claim the screenshots make.
//
// WHY THE UNREACHABLE HOUSEHOLD IS THE CORPUS'S OWN SHAPE
//
// AC 2 asks that the unreachable capture be the allocation corpus's
// granularity-floor case — capacities 25, 100 and 150; jobs of 40, 35, 30, 30,
// 25, 20 and 10 — and that its verdict name a fair share of 17 min and a
// smallest job of 10 min. That is not decoration. A screenshot of an ARBITRARY
// household proves only that something rendered; a screenshot of a shape whose
// expected verdict is hand-worked in `src/lib/allocation.corpus.js` checks
// itself, because the number on the image is one the corpus already states.
// cairn's `a-persistent-browser-profile-is-not-a-fresh-context` note records
// the hand capture this command replaces reaching for the same trick.
//
// So the minutes below are NOT free parameters. They are read from the corpus
// scenario at run time rather than copied, and `case-study-screenshots.test.js`
// asserts they still match it — a copy here would be free to drift from the
// corpus the moment somebody tuned a capacity.
//
// WHY THE ASSIGNMENTS ARE THE ALLOCATOR'S OWN
//
// `Split` computes its verdict from `capacities` + `chores` through the real
// `assess`/`allocate` pair, so the sentence on the screenshot is produced by
// the shipped allocator rather than written here. What this module must get
// right is the ASSIGNMENT of each job to a member: the bars draw what people
// are actually holding. Taking those from `allocate` itself means the captured
// household is the one the allocator would have dealt out, which is what the
// case study claims Taskr does.

import { SCENARIOS } from '../src/lib/allocation.corpus.js'
import { allocate } from '../src/lib/allocation.js'

/**
 * The corpus scenario the unreachable capture reproduces.
 *
 * Looked up by name rather than by index — a scenario inserted above it would
 * silently change which household is photographed, and the failure would be a
 * screenshot of the wrong thing rather than an error.
 */
export const GRANULARITY_FLOOR_SCENARIO = 'granularity floor: a 25-minute budget against a 10-minute smallest job'

/**
 * Placeholder people, in roster order.
 *
 * Every name here is already declared in `src/test/gate.test.js`'s
 * `PLACEHOLDER_NAMES` (#19), so this module adds no new exemption. That is the
 * owner's decision at this story's pickup, and it is also the safer one for a
 * capture destined for a public case study: the word "Placeholder" on the
 * screenshot tells a reader at a glance that nobody real is on it.
 */
const PEOPLE = ['Placeholder One', 'Placeholder Two', 'Placeholder Three']

/** A chore row with only the fields `Split` reads, as PostgREST returns it. */
function choreRow(id, minutes, holder) {
  return {
    id,
    title: 'Placeholder Chore',
    expected_minutes: minutes,
    assigned_member_id: holder,
    completed_at: null,
  }
}

/**
 * Find a corpus scenario by name, refusing rather than returning undefined.
 *
 * A missing scenario must be loud: the capture would otherwise fall through to
 * a household of nobody and produce two plausible-looking PNGs of an empty
 * screen, which is the failure mode this whole module is arranged against.
 */
export function scenarioNamed(name, scenarios = SCENARIOS) {
  const found = scenarios.find((s) => s.name === name)
  if (!found) {
    throw new Error(
      `the allocation corpus has no scenario named ${JSON.stringify(name)} — ` +
        'the case-study capture reproduces it by name, so a rename there must be followed here',
    )
  }
  return found
}

/**
 * Turn a corpus scenario into the props `Split` takes, with each job assigned
 * where the allocator puts it.
 *
 * The corpus identifies members by ids like `ava`; those ids are internal and
 * would be meaningless on a screenshot, so the roster order is preserved and
 * each is given a placeholder display name. Capacities and minutes are the
 * corpus's own.
 */
export function householdFromScenario(scenario, { names = PEOPLE } = {}) {
  if (scenario.members.length > names.length) {
    throw new Error(
      `scenario ${JSON.stringify(scenario.name)} has ${scenario.members.length} members but only ` +
        `${names.length} placeholder names are declared — add one to PEOPLE and to gate.test.js`,
    )
  }

  const members = scenario.members.map((member, i) => ({
    id: member.id,
    display_name: names[i],
    weekly_minutes: member.capacityMinutes,
  }))

  const capacities = scenario.members.map((member) => ({
    id: member.id,
    capacityMinutes: member.capacityMinutes,
  }))

  // The allocator decides who holds what, so the bars show a split this repo's
  // own code produced rather than one arranged by hand to look convincing.
  // `allocate` reports the deal in `assignments` (`{ choreId, memberId }`), NOT
  // as a chore list hanging off each `load` entry — a first draft here assumed
  // the latter, and it fails SILENTLY: every chore comes back unassigned, the
  // bars all draw empty, and the PNG looks like a household nobody has touched
  // rather than like an error.
  const dealt = allocate({ members: capacities, chores: scenario.chores })
  const holderOf = new Map(dealt.assignments.map((a) => [a.choreId, a.memberId]))

  const chores = scenario.chores.map((chore) =>
    choreRow(chore.id, chore.expectedMinutes, holderOf.get(chore.id) ?? null),
  )

  return { members, capacities, chores, exclusions: [] }
}

/**
 * The level household.
 *
 * Built rather than taken from the corpus: the corpus's level scenarios are
 * chosen to exercise the allocator's edges, and the case study wants an
 * ordinary week that reaches level — three people with round budgets and work
 * that divides among them. Six 30-minute jobs over 60/300 does reach level in
 * the corpus ('the flagship'), but a two-person household under-sells the
 * screen; this is the same idea at three.
 */
export const LEVEL_HOUSEHOLD = {
  members: [
    { id: 'l1', capacityMinutes: 120 },
    { id: 'l2', capacityMinutes: 120 },
    { id: 'l3', capacityMinutes: 120 },
  ],
  chores: [30, 30, 30, 30, 30, 30, 30, 30, 30].map((m, i) => ({
    id: `k${i + 1}`,
    expectedMinutes: m,
  })),
}

/**
 * The two captures, as `{ name, props }` — the command's whole subject.
 *
 * Exported as a function rather than a constant so each call builds fresh
 * objects: a shared fixture mutated by one consumer corrupts the other, which
 * is a trap this repo has already paid for (cairn: an instrument bug that
 * presents as a broken stub graph).
 */
export function captures() {
  const floor = scenarioNamed(GRANULARITY_FLOOR_SCENARIO)
  return [
    {
      name: 'case-split-level',
      what: 'the split when level',
      props: householdFromScenario({ name: 'level', ...LEVEL_HOUSEHOLD }),
    },
    {
      name: 'case-split-unreachable',
      what: 'the split whose verdict reads "Level cannot be reached this week"',
      props: householdFromScenario(floor),
    },
  ]
}
