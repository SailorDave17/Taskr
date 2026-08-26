import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allocate,
  assess,
  fairShare,
  isLevel,
  minutesOf,
  offLevelOf,
  spreadOf,
  LEVEL_TOLERANCE,
} from './allocation.js'
import { SCENARIOS } from './allocation.corpus.js'

// #40 — the allocator, and the honesty half of it.
//
// The behaviour tests below are ordinary. The two SOURCE-reading describes are
// not decoration: AC 1 and AC 9 state properties about the shape of the code
// rather than its output, and no behavioural test can see them. An allocator
// that imported household.js would pass every scenario in the corpus while
// having quietly baked capacity-as-constant into its inputs — the exact thing
// the charter says every competitor gets wrong. Same idiom as the
// passWithNoTests and reachability guards in src/test/gate.test.js.

const SOURCE = readFileSync(resolve(process.cwd(), 'src/lib/allocation.js'), 'utf8')

/**
 * The source with its comments removed.
 *
 * The scans below assert that certain names do not APPEAR, and this module's
 * prose explains at length why it does not read `members.weekly_minutes` and
 * does not call `Math.random` — so scanning the raw file makes an accurate
 * comment indistinguishable from the defect it is warning about. MEASURED: both
 * scans failed on their first run for exactly that reason, on a module that was
 * correct.
 *
 * A stripper that silently returned nothing would make every scan pass, so
 * `codeOf` has its own positive control below.
 */
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every .js/.jsx file under src/, so a second implementation cannot hide. */
function sourceFiles(dir = resolve(process.cwd(), 'src')) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(js|jsx)$/.test(entry)) found.push(path)
  }
  return found
}

describe('AC 1 — the allocator is a pure module and is GIVEN capacity', () => {
  it('imports nothing from react, the supabase client, or household.js', () => {
    const imports = [...SOURCE.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    // Stated as an empty-list assertion so the failure names the offender.
    const forbidden = imports.filter((spec) =>
      /^react$|^react\/|@supabase\/supabase-js|household\.js$/.test(spec),
    )
    expect(forbidden, `forbidden imports: ${forbidden.join(', ')}`).toEqual([])
  })

  it('POSITIVE CONTROL: the import scan can actually see an import statement', () => {
    // Without this the test above passes vacuously the moment the regex stops
    // matching — a switch to `import x = require()`, a formatting change, a
    // double-quote style. An empty forbidden list would then mean "found
    // nothing" rather than "found nothing bad".
    const chores = readFileSync(resolve(process.cwd(), 'src/lib/chores.js'), 'utf8')
    const imports = [...chores.matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
    // Was './household.js' until #159, which removed that dependency from
    // chores.js - addChore no longer resolves a household for itself. A
    // control pointing at an import that no longer exists is not a weaker
    // control, it is a failing one, so it is re-pointed at what remains.
    expect(imports).toContain('./supabase.js')
    expect(imports.length).toBeGreaterThan(0)
  })

  it('never reads the members table column, so capacity cannot leak in that way', () => {
    expect(codeOf(SOURCE)).not.toMatch(/weekly_minutes/)
  })

  it('POSITIVE CONTROL: stripping comments leaves the code, not an empty string', () => {
    // Without this, a broken stripper would make this describe and AC 6's
    // random-call scan pass by having nothing left to find.
    const code = codeOf(SOURCE)
    expect(code).toMatch(/export function allocate\b/)
    expect(code).toMatch(/export const LEVEL_TOLERANCE\b/)
    // And it really did remove the prose the scans would otherwise trip on.
    expect(SOURCE).toMatch(/weekly_minutes/)
    expect(code).not.toMatch(/capacity-as-constant/)
  })

  it('refuses a member who arrives without a capacity rather than defaulting one', () => {
    // The signature half of AC 1. A caller still passing member rows is a
    // caller that thinks capacity is a property of the member — the shape #44
    // exists to end. Defaulting would let that caller work and hide it.
    expect(() =>
      allocate({ members: [{ id: 'a' }], chores: [] }),
    ).toThrow(/capacityMinutes/)
    expect(() =>
      allocate({ members: [{ id: 'a', weekly_minutes: 100 }], chores: [] }),
    ).toThrow(/capacityMinutes/)
  })

  it('accepts capacity as an argument, with no reference to any stored baseline', () => {
    const result = allocate({
      members: [{ id: 'a', capacityMinutes: 100 }],
      chores: [{ id: 'c', expectedMinutes: 50 }],
    })
    expect(result.load[0]).toMatchObject({ memberId: 'a', assignedMinutes: 50, share: 0.5 })
  })
})

describe('AC 3 — five chores against one is what equal shares look like', () => {
  const result = allocate({
    members: [
      { id: 'kid', capacityMinutes: 60 },
      { id: 'parent', capacityMinutes: 300 },
    ],
    chores: Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}`, expectedMinutes: 30 })),
  })
  const count = (id) => result.assignments.filter((a) => a.memberId === id).length
  const share = (id) => result.load.find((l) => l.memberId === id).share

  it('gives the kid exactly one chore and the parent exactly five', () => {
    expect(count('kid')).toBe(1)
    expect(count('parent')).toBe(5)
  })

  it('puts both at 50% of their own capacity', () => {
    expect(share('kid')).toBeCloseTo(0.5, 10)
    expect(share('parent')).toBeCloseTo(0.5, 10)
  })

  it('and the chore counts are UNEQUAL, which is the point of the whole thesis', () => {
    expect(count('kid')).not.toBe(count('parent'))
  })
})

describe('AC 4 — level is unreachable, and the reason says why', () => {
  const result = allocate({
    members: [
      { id: 'ava', capacityMinutes: 25 },
      { id: 'nora', capacityMinutes: 100 },
      { id: 'sam', capacityMinutes: 150 },
    ],
    chores: [40, 35, 30, 30, 25, 20, 10].map((m, i) => ({ id: `j${i + 1}`, expectedMinutes: m })),
  })

  it('does NOT report level — a verdict of level over this set fails the test', () => {
    expect(result.level).toBe(false)
  })

  it('names the member the floor bites, their fair share, and the smallest job', () => {
    expect(result.reason).toEqual({
      memberId: 'ava',
      fairShareMinutes: 17,
      smallestJobMinutes: 10,
    })
  })

  it('and the fair share it quotes is the one the module computes, not a second copy', () => {
    const total = 40 + 35 + 30 + 30 + 25 + 20 + 10
    expect(result.reason.fairShareMinutes).toBe(Math.round(fairShare(25, total, 275)))
  })
})

describe('AC 5 — a healthy household gets no unreachable notice at all', () => {
  const result = allocate({
    members: [
      { id: 'm1', capacityMinutes: 300 },
      { id: 'm2', capacityMinutes: 300 },
      { id: 'm3', capacityMinutes: 300 },
    ],
    chores: [30, 30, 30, 20, 20, 20].map((m, i) => ({ id: `r${i + 1}`, expectedMinutes: m })),
  })

  it('reports level', () => {
    expect(result.level).toBe(true)
  })

  it('carries no reason — a notice that fires on healthy households is an absent notice', () => {
    expect(result.reason).toBeNull()
  })
})

describe('AC 6 — the same household in a different order is the same answer', () => {
  const members = [
    { id: 'ava', capacityMinutes: 25 },
    { id: 'nora', capacityMinutes: 100 },
    { id: 'sam', capacityMinutes: 150 },
  ]
  const chores = [40, 35, 30, 30, 25, 20, 10].map((m, i) => ({
    id: `j${i + 1}`,
    expectedMinutes: m,
  }))

  it('is byte-for-byte identical under permuted input', () => {
    const forwards = JSON.stringify(allocate({ members, chores }))
    const backwards = JSON.stringify(
      allocate({ members: [...members].reverse(), chores: [...chores].reverse() }),
    )
    expect(backwards).toBe(forwards)
  })

  it('is identical across every corpus scenario permuted, not just this one', () => {
    for (const scenario of SCENARIOS) {
      const run = (m, c) =>
        JSON.stringify(allocate({ members: m, chores: c, isEligible: scenario.isEligible }))
      expect(
        run([...scenario.members].reverse(), [...scenario.chores].reverse()),
        `permuting "${scenario.name}" changed the answer`,
      ).toBe(run(scenario.members, scenario.chores))
    }
  })

  it('contains no shuffle and no random call anywhere in the module', () => {
    // Comments stripped: the module explains that it calls neither, and an
    // explanation must not read as the thing it warns about.
    expect(codeOf(SOURCE)).not.toMatch(/Math\.random|shuffle|crypto\.getRandomValues|Date\.now/)
  })
})

describe('AC 7 — eligibility, an impossible chore, and a member with no minutes', () => {
  it('never gives a chore to a member the predicate excludes', () => {
    // The kid deliberately has the LARGER budget. MEASURED while proving these
    // tests: with the capacities the other way round this assertion passed with
    // the eligibility check deleted outright — the parent won the knife on the
    // share rule anyway, so the test named the right property and could not
    // fail on it. The excluded member must be the one the allocator would
    // otherwise choose, or the scenario proves nothing about eligibility.
    const result = allocate({
      members: [
        { id: 'kid', capacityMinutes: 200 },
        { id: 'parent', capacityMinutes: 120 },
      ],
      chores: [
        { id: 'knife', expectedMinutes: 40 },
        { id: 'a', expectedMinutes: 30 },
        { id: 'b', expectedMinutes: 30 },
      ],
      isEligible: (chore, member) => chore.id !== 'knife' || member.id === 'parent',
    })
    const knife = result.assignments.find((a) => a.choreId === 'knife')
    expect(knife.memberId).toBe('parent')
  })

  it('POSITIVE CONTROL: without the exclusion that chore WOULD go to the kid', () => {
    // The other half of the repair. This is what makes the assertion above a
    // test of eligibility rather than a test of arithmetic that happens to
    // agree with it.
    const result = allocate({
      members: [
        { id: 'kid', capacityMinutes: 200 },
        { id: 'parent', capacityMinutes: 120 },
      ],
      chores: [
        { id: 'knife', expectedMinutes: 40 },
        { id: 'a', expectedMinutes: 30 },
        { id: 'b', expectedMinutes: 30 },
      ],
    })
    expect(result.assignments.find((a) => a.choreId === 'knife').memberId).toBe('kid')
  })

  it('flags a chore nobody is eligible for, in its own state, without throwing', () => {
    const result = allocate({
      members: [{ id: 'a', capacityMinutes: 100 }],
      chores: [
        { id: 'ladder', expectedMinutes: 30 },
        { id: 'cups', expectedMinutes: 10 },
      ],
      isEligible: (chore) => chore.id !== 'ladder',
    })
    expect(result.unassignable).toEqual(['ladder'])
    // Distinct means distinct: it is not silently in the assignment list too.
    expect(result.assignments.map((a) => a.choreId)).toEqual(['cups'])
  })

  it('leaves an impossible chore OUT of the fairness arithmetic', () => {
    // Counting work no split of this household can carry would inflate every
    // fair share and then report everybody underloaded against it.
    const result = allocate({
      members: [{ id: 'a', capacityMinutes: 100 }],
      chores: [
        { id: 'ladder', expectedMinutes: 500 },
        { id: 'cups', expectedMinutes: 10 },
      ],
      isEligible: (chore) => chore.id !== 'ladder',
    })
    expect(result.load[0].fairShareMinutes).toBe(10)
  })

  it('reports a zero-capacity member as having no capacity, never as infinitely loaded', () => {
    const result = allocate({
      members: [
        { id: 'away', capacityMinutes: 0 },
        { id: 'home', capacityMinutes: 100 },
      ],
      chores: [
        { id: 'z1', expectedMinutes: 30 },
        { id: 'z2', expectedMinutes: 20 },
      ],
    })
    // Spelled in full rather than relaxed to toMatchObject: #47 gave every load
    // entry a done/open split, and an exact assertion that is widened to an
    // inexact one to accommodate a change stops being able to see the next one.
    expect(result.noCapacity).toEqual([
      { memberId: 'away', assignedMinutes: 0, doneMinutes: 0, openMinutes: 0 },
    ])
    expect(result.load.map((l) => l.memberId)).toEqual(['home'])
    for (const entry of result.load) {
      expect(Number.isFinite(entry.share)).toBe(true)
    }
    expect(result.assignments.every((a) => a.memberId !== 'away')).toBe(true)
  })

  it('does not divide by zero even when a zero-capacity member is the only one', () => {
    const result = allocate({
      members: [{ id: 'away', capacityMinutes: 0 }],
      chores: [{ id: 'z1', expectedMinutes: 30 }],
    })
    expect(result.unassignable).toEqual(['z1'])
    expect(result.load).toEqual([])
    expect(result.level).toBe(true)
    expect(result.reason).toBeNull()
  })
})

describe('AC 8 — a human placement is never moved', () => {
  const result = allocate({
    members: [
      { id: 'kid', capacityMinutes: 60 },
      { id: 'parent', capacityMinutes: 300 },
    ],
    chores: [
      { id: 'pinned', expectedMinutes: 60, assignedMemberId: 'kid' },
      ...[30, 30, 30].map((m, i) => ({ id: `q${i + 1}`, expectedMinutes: m })),
    ],
  })

  it('leaves the pinned chore with the member the human chose', () => {
    expect(result.assignments.find((a) => a.choreId === 'pinned').memberId).toBe('kid')
  })

  it('counts its minutes against that member’s capacity', () => {
    expect(result.load.find((l) => l.memberId === 'kid').assignedMinutes).toBe(60)
  })

  it('holds it even when moving it is the only way to reach level', () => {
    // The discriminating half. Without it, an allocator that quietly re-homed
    // the pin would pass the two assertions above on a household where the pin
    // happened to be where the allocator wanted it anyway.
    expect(result.level).toBe(false)
    expect(result.load.find((l) => l.memberId === 'kid').share).toBe(1)
  })

  it('refuses a placement naming a member who is not in the household', () => {
    expect(() =>
      allocate({
        members: [{ id: 'kid', capacityMinutes: 60 }],
        chores: [{ id: 'p', expectedMinutes: 10, assignedMemberId: 'ghost' }],
      }),
    ).toThrow(/ghost/)
  })
})

describe('AC 9 — one definition of fair share, one of level', () => {
  it('exports exactly one implementation of each, across the whole of src/', () => {
    // #47 criterion 5 added the last three. The criterion is that the household
    // surface takes fair share, off-level and levelness FROM HERE rather than
    // computing them again — because two copies of the level rule would let the
    // screen say "level" while the verdict beside it disagreed, which the
    // charter names as the fastest way to destroy trust in the number the whole
    // product rests on.
    const definitions = {
      fairShare: [],
      isLevel: [],
      offLevelOf: [],
      assess: [],
      minutesOf: [],
    }
    for (const file of sourceFiles()) {
      if (/\.test\.jsx?$/.test(file)) continue
      const text = codeOf(readFileSync(file, 'utf8'))
      for (const name of Object.keys(definitions)) {
        // Any definition at all, exported or not — a private second copy is
        // exactly the drift this criterion exists to prevent.
        const pattern = new RegExp(`(function\\s+${name}\\b|(const|let)\\s+${name}\\s*=)`, 'g')
        const found = text.match(pattern) ?? []
        for (let i = 0; i < found.length; i += 1) definitions[name].push(file)
      }
    }
    for (const [name, files] of Object.entries(definitions)) {
      expect(files, `${name} is defined in: ${files.join(', ')}`).toHaveLength(1)
      expect(files[0], `${name} is not defined in allocation.js`).toMatch(/allocation\.js$/)
    }
  })

  it('POSITIVE CONTROL: the definition scan can find a definition when there is one', () => {
    // Guards the assertion above against passing at zero. A regex that matches
    // nothing would report length 0, not 1 — but a future rename could leave
    // this scan silently blind, so prove it sees a known definition.
    const text = readFileSync(resolve(process.cwd(), 'src/lib/allocation.js'), 'utf8')
    expect(text).toMatch(/export function fairShare\b/)
    expect(text).toMatch(/export function isLevel\b/)
    expect(text).toMatch(/export function offLevelOf\b/)
    expect(text).toMatch(/export function assess\b/)
    expect(text).toMatch(/export function minutesOf\b/)
  })

  it('#47 criterion 5: the household surface takes them from here, and defines none', () => {
    // The consumer side of the rule above, and it is a different claim: the
    // scan proves there is one implementation, this proves the surface uses it.
    // A screen that imported nothing and computed its own numbers would satisfy
    // the first and fail the product.
    //
    // Asserted against the SOURCE because there is nothing else to assert it
    // against: a surface with its own copy would render the same numbers today
    // and drift the first time either rule changed, so no rendering can tell
    // the two apart. Same reasoning, same shape, as capacity.test.js's
    // allowlist for `weekly_minutes`.
    const surface = readFileSync(resolve(process.cwd(), 'src/components/Split.jsx'), 'utf8')
    expect(surface).toMatch(/from '\.\.\/lib\/allocation\.js'/)
    const imported = surface.match(/import \{([^}]*)\} from '\.\.\/lib\/allocation\.js'/)
    expect(imported, 'the split surface imports nothing from allocation.js').not.toBeNull()
    for (const name of ['assess', 'allocate']) {
      expect(imported[1], `the split surface does not import ${name}`).toMatch(
        new RegExp(`\\b${name}\\b`),
      )
    }
  })

  it('POSITIVE CONTROL: the import scan sees the imports that are there', () => {
    // Without this the assertion above passes the moment the regex stops
    // matching, which is how an empty result reads as a clean bill of health —
    // the same control App.test.jsx keeps for its own import scans.
    const surface = readFileSync(resolve(process.cwd(), 'src/components/Split.jsx'), 'utf8')
    expect([...surface.matchAll(/from '([^']+)'/g)].length).toBeGreaterThan(2)
  })

  it('derives the verdict from isLevel, over every scenario in the corpus', () => {
    // The behavioural half. A second, drifting copy of the levelness rule
    // inside allocate() would show up here as a scenario where the exported
    // function disagrees with the verdict the module reported.
    for (const scenario of SCENARIOS) {
      const result = allocate({
        members: scenario.members,
        chores: scenario.chores,
        isEligible: scenario.isEligible,
      })
      expect(
        isLevel(result.load.map((l) => l.share)),
        `verdict and isLevel disagree on "${scenario.name}"`,
      ).toBe(result.level)
    }
  })

  it('derives every reported fair share from fairShare, over every scenario', () => {
    for (const scenario of SCENARIOS) {
      const result = allocate({
        members: scenario.members,
        chores: scenario.chores,
        isEligible: scenario.isEligible,
      })
      const totalWork = result.load.reduce((s, l) => s + l.assignedMinutes, 0)
      const totalCapacity = scenario.members
        .filter((m) => m.capacityMinutes > 0)
        .reduce((s, m) => s + m.capacityMinutes, 0)
      for (const entry of result.load) {
        const capacity = scenario.members.find((m) => m.id === entry.memberId).capacityMinutes
        expect(
          entry.fairShareMinutes,
          `fair share for ${entry.memberId} in "${scenario.name}"`,
        ).toBeCloseTo(fairShare(capacity, totalWork, totalCapacity), 9)
      }
    }
  })

  it('thresholds on the stated tolerance and nothing else', () => {
    expect(LEVEL_TOLERANCE).toBe(0.1)
    expect(isLevel([0.5, 0.6])).toBe(true)
    expect(isLevel([0.5, 0.61])).toBe(false)
    expect(spreadOf([0.4, 0.65, 0.767])).toBeCloseTo(0.367, 3)
  })

  it('stays below the 15% spread the charter records as ragged', () => {
    // The bound that constrains the constant. A tolerance at or above 0.15
    // would call the prototype's measured-ragged set level, which is the one
    // failure this module exists to prevent.
    expect(LEVEL_TOLERANCE).toBeLessThan(0.15)
  })
})

describe('AC 2 — the scenario corpus, every expectation written by hand', () => {
  it('covers at least ten household shapes', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10)
  })

  it('gives every scenario a name and a stated reason for existing', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.name, 'a scenario with no name').toBeTruthy()
      expect(scenario.why, `"${scenario.name}" has no stated reason`).toBeTruthy()
    }
  })

  for (const scenario of SCENARIOS) {
    it(`matches the hand-written outcome: ${scenario.name}`, () => {
      const result = allocate({
        members: scenario.members,
        chores: scenario.chores,
        isEligible: scenario.isEligible,
      })

      const actualLoad = {}
      for (const entry of result.load) {
        actualLoad[entry.memberId] = [
          entry.assignedMinutes,
          result.assignments.filter((a) => a.memberId === entry.memberId).length,
        ]
      }
      expect(actualLoad).toEqual(scenario.expect.load)
      expect(result.level).toBe(scenario.expect.level)
      expect(result.reason).toEqual(scenario.expect.reason)
      expect(result.unassignable).toEqual(scenario.expect.unassignable)
      expect(result.noCapacity.map((n) => n.memberId)).toEqual(scenario.expect.noCapacity)
    })
  }

  it('records a proportion in docs/allocation-corpus.md that the corpus still supports', () => {
    // AC 2's "recorded in the repo ... so the figure can be re-derived rather
    // than trusted". `npm run allocation:corpus` prints it; this is what stops
    // the recorded number drifting from the corpus it describes, which is the
    // failure mode of every hand-maintained figure in this repo so far.
    const doc = readFileSync(resolve(process.cwd(), 'docs/allocation-corpus.md'), 'utf8')

    const results = SCENARIOS.map((scenario) => ({
      contested: scenario.workingMembers >= 2,
      level: allocate({
        members: scenario.members,
        chores: scenario.chores,
        isEligible: scenario.isEligible,
      }).level,
    }))
    const total = results.length
    const level = results.filter((r) => r.level).length
    const contested = results.filter((r) => r.contested)
    const contestedLevel = contested.filter((r) => r.level).length

    const row = (a, b) => new RegExp(`\\|\\s*${a}\\s*\\|\\s*${b}\\s*\\|`)
    expect(doc, `the document does not record ${level} of ${total}`).toMatch(row(level, total))
    expect(
      doc,
      `the document does not record ${contestedLevel} of ${contested.length}`,
    ).toMatch(row(contestedLevel, contested.length))

    const asPct = (n, d) => ((n / d) * 100).toFixed(1)
    expect(doc).toContain(`${asPct(level, total)}%`)
    expect(doc).toContain(`${asPct(contestedLevel, contested.length)}%`)
  })

  it('POSITIVE CONTROL: the corpus is not vacuously all-level or all-unreachable', () => {
    // A corpus that never reaches level, or always does, would satisfy the
    // "at least ten shapes" count while measuring nothing about the verdict.
    const verdicts = SCENARIOS.map(
      (s) => allocate({ members: s.members, chores: s.chores, isEligible: s.isEligible }).level,
    )
    expect(verdicts.filter(Boolean).length).toBeGreaterThan(0)
    expect(verdicts.filter((v) => !v).length).toBeGreaterThan(0)
  })

  it('states workingMembers independently rather than counting it from the answer', () => {
    // The report groups on this field, and it must not be inferred from the
    // result it is reporting on — that is the same circle AC 2 forbids in the
    // expected column, one level up.
    for (const scenario of SCENARIOS) {
      const counted = scenario.members.filter((m) => m.capacityMinutes > 0).length
      expect(scenario.workingMembers, `workingMembers wrong for "${scenario.name}"`).toBe(counted)
    }
  })
})


// ---------------------------------------------------------------------------
// #47 — the arithmetic the household surface shares with the allocator.
// ---------------------------------------------------------------------------

describe('#47 criterion 7 — what one chore contributes', () => {
  it('open work contributes its ESTIMATE', () => {
    expect(minutesOf({ expectedMinutes: 20, actualMinutes: 80, done: false })).toBe(20)
  })

  it('done work contributes what it ACTUALLY took', () => {
    expect(minutesOf({ expectedMinutes: 20, actualMinutes: 80, done: true })).toBe(80)
  })

  it('falls back to the estimate when nothing was recorded — which is every chore today', () => {
    expect(minutesOf({ expectedMinutes: 20, done: true })).toBe(20)
    expect(minutesOf({ expectedMinutes: 20, actualMinutes: null, done: true })).toBe(20)
  })

  it('a chore genuinely recorded at ZERO contributes zero, not its estimate', () => {
    // The fallback is on absence, not on falsiness. `actual || expected` reads
    // identically and silently substitutes the estimate for exactly the
    // completion that most contradicts it — a job somebody found took no time
    // at all, which is the single most useful datum #12 will collect.
    expect(minutesOf({ expectedMinutes: 20, actualMinutes: 0, done: true })).toBe(0)
  })
})

describe('#47 criterion 5 — off level, in minutes', () => {
  const load = (memberId, assignedMinutes, fairShareMinutes) => ({
    memberId,
    assignedMinutes,
    fairShareMinutes,
  })

  it('is the largest overshoot past a fair share, and names whose', () => {
    expect(offLevelOf([load('a', 240, 210), load('b', 12, 42)])).toEqual({
      memberId: 'a',
      minutes: 30,
    })
  })

  it('names the person furthest ABOVE their share, never the one furthest below', () => {
    // A product decision rather than an arithmetic one. "Carrying 40 minutes
    // more than their share" is the sentence the household is arguing about;
    // its mirror points at a person as the problem, and red is for work.
    expect(offLevelOf([load('a', 100, 60), load('b', 20, 60)]).memberId).toBe('a')
  })

  it('is null when nobody is over — a household exactly on its shares', () => {
    expect(offLevelOf([load('a', 60, 60), load('b', 40, 40)])).toBeNull()
  })

  it('is null when there is nobody to be uneven with', () => {
    expect(offLevelOf([load('a', 100, 40)])).toBeNull()
    expect(offLevelOf([])).toBeNull()
  })
})

describe('#47 criterion 5 — the surface and the allocator cannot disagree', () => {
  // A scenario chosen so that the plausible WRONG implementations are visibly
  // wrong on it, rather than one where every method happens to agree:
  //
  //   - capacities are unequal (300 / 100 / 40), so "everybody carries the same
  //     minutes" and "everybody carries the same share" give different answers;
  //   - one member has NO capacity, so a fair share computed over the whole
  //     roster differs from one computed over the people who can carry work;
  //   - one chore is impossible for everybody, so counting it in the total
  //     inflates every fair share.
  const members = [
    { id: 'a', capacityMinutes: 300 },
    { id: 'b', capacityMinutes: 100 },
    { id: 'c', capacityMinutes: 40 },
    { id: 'away', capacityMinutes: 0 },
  ]
  const chores = [
    { id: 'big', expectedMinutes: 90 },
    { id: 'mid', expectedMinutes: 60 },
    { id: 'small', expectedMinutes: 20 },
    { id: 'tiny', expectedMinutes: 10 },
    { id: 'impossible', expectedMinutes: 45 },
  ]
  const isEligible = (chore) => chore.id !== 'impossible'

  const allocated = allocate({ members, chores, isEligible })

  /**
   * The allocator's answer, re-derived the way the SURFACE derives it: from the
   * assignments as they now stand, with no knowledge of how they got there.
   * This is the same call `Split.jsx` makes, on the same module.
   */
  const placed = new Map(allocated.assignments.map((a) => [a.choreId, a.memberId]))
  const reassessed = assess({
    members,
    chores: chores.map((c) => ({
      id: c.id,
      expectedMinutes: c.expectedMinutes,
      assignedMemberId: placed.get(c.id) ?? null,
    })),
  })

  it('POSITIVE CONTROL: the scenario is one where the answer is not trivially anything', () => {
    // Every assertion below is vacuous on a household that is level with
    // nothing assigned. This pins that work was placed, that somebody was left
    // out for having no minutes, and that a chore was genuinely impossible.
    expect(allocated.assignments.length).toBe(4)
    expect(allocated.unassignable).toEqual(['impossible'])
    expect(allocated.noCapacity.map((n) => n.memberId)).toEqual(['away'])
    expect(allocated.load.length).toBe(3)
  })

  it('agrees on levelness', () => {
    expect(reassessed.level).toBe(allocated.level)
  })

  it('agrees on the spread, to the last bit', () => {
    expect(reassessed.spread).toBe(allocated.spread)
  })

  it('agrees on every fair share, in minutes', () => {
    const shares = (result) =>
      Object.fromEntries(result.load.map((e) => [e.memberId, e.fairShareMinutes]))
    expect(shares(reassessed)).toEqual(shares(allocated))
  })

  it('agrees on how far off level the household is', () => {
    expect(reassessed.offLevel).toEqual(allocated.offLevel)
  })

  it('agrees on who is holding what', () => {
    const carried = (result) =>
      Object.fromEntries(result.load.map((e) => [e.memberId, e.assignedMinutes]))
    expect(carried(reassessed)).toEqual(carried(allocated))
  })

  it('agrees that the impossible chore is nobody’s, and excludes it from both totals', () => {
    // The rule that would be easiest to re-implement differently, and the one
    // with the most misleading failure: counting the orphan chore inflates
    // every fair share against work no split of this household can carry, and
    // then reports everybody underloaded for it.
    expect(reassessed.unassigned).toEqual(allocated.unassignable)
    const fairTotal = reassessed.load.reduce((sum, e) => sum + e.fairShareMinutes, 0)
    expect(Math.round(fairTotal)).toBe(90 + 60 + 20 + 10)
  })

  it('POSITIVE CONTROL: a plausible re-implementation really would differ here', () => {
    // Equal MINUTES each, rather than equal shares — the rule the charter says
    // every competitor gets wrong, and the one a second implementation would
    // most likely reach for. If it agreed with the real answer on this
    // scenario, the six assertions above would prove nothing.
    const equalMinutes = 180 / 3
    for (const entry of allocated.load) {
      expect(entry.fairShareMinutes).not.toBe(equalMinutes)
    }
  })
})

describe('#47 — assess, over the assignments a human made', () => {
  const members = [
    { id: 'a', capacityMinutes: 300 },
    { id: 'b', capacityMinutes: 60 },
  ]

  const chore = (id, expectedMinutes, assignedMemberId, extra = {}) => ({
    id,
    expectedMinutes,
    assignedMemberId,
    ...extra,
  })

  it('divides each person’s minutes by their OWN capacity', () => {
    const result = assess({ members, chores: [chore('x', 150, 'a'), chore('y', 30, 'b')] })
    expect(result.load.map((e) => e.share)).toEqual([0.5, 0.5])
    expect(result.level).toBe(true)
  })

  it('splits what each person carries into done and outstanding', () => {
    const result = assess({
      members,
      chores: [chore('x', 90, 'a'), chore('y', 60, 'a', { done: true })],
    })
    expect(result.load[0]).toMatchObject({
      assignedMinutes: 150,
      openMinutes: 90,
      doneMinutes: 60,
    })
  })

  it('returns work nobody holds separately, and keeps it out of the arithmetic', () => {
    const result = assess({
      members,
      chores: [chore('x', 150, 'a'), chore('y', 30, 'b'), chore('orphan', 150, null)],
    })
    expect(result.unassigned).toEqual(['orphan'])
    // 180 minutes of held work over 360 of capacity: 150 and 30 are exactly the
    // fair shares. Counting the orphan would make them 300 and 60.
    expect(result.load.map((e) => e.fairShareMinutes)).toEqual([150, 30])
  })

  it('does not treat FINISHED work nobody holds as outstanding', () => {
    const result = assess({
      members,
      chores: [chore('orphan', 30, null, { done: true })],
    })
    expect(result.unassigned).toEqual([])
  })

  it('holds a zero-capacity member out of the split and names what they carry', () => {
    const result = assess({
      members: [...members, { id: 'away', capacityMinutes: 0 }],
      chores: [chore('x', 45, 'away')],
    })
    expect(result.load.map((e) => e.memberId)).toEqual(['a', 'b'])
    expect(result.noCapacity).toEqual([
      { memberId: 'away', assignedMinutes: 45, doneMinutes: 0, openMinutes: 45 },
    ])
    for (const entry of result.load) {
      expect(Number.isFinite(entry.share)).toBe(true)
    }
  })

  it('says when level was not a real question', () => {
    // `isLevel` is true for fewer than two shares, correctly — a set that small
    // has no spread. `contested` is what lets a caller tell that apart from a
    // household that actually reached level, which is the difference between an
    // honest screen and one that scores full marks for an empty house.
    expect(assess({ members: [], chores: [] }).contested).toBe(false)
    expect(assess({ members: [members[0]], chores: [] }).contested).toBe(false)
    expect(assess({ members, chores: [] }).contested).toBe(true)
    expect(assess({ members: [], chores: [] }).level).toBe(true)
  })

  it('cannot be told a capacity through the member row, any more than allocate can', () => {
    // #44 AC 7's rule, inherited rather than restated: capacity is an argument.
    expect(() => assess({ members: [{ id: 'a', weekly_minutes: 300 }], chores: [] })).toThrow(
      /capacityMinutes/,
    )
  })

  it('is not moved by the order its inputs arrive in', () => {
    const forwards = assess({ members, chores: [chore('x', 150, 'a'), chore('y', 30, 'b')] })
    const backwards = assess({
      members: [...members].reverse(),
      chores: [chore('y', 30, 'b'), chore('x', 150, 'a')],
    })
    expect(backwards).toEqual(forwards)
  })
})
