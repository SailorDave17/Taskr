import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocate, fairShare, isLevel, spreadOf, LEVEL_TOLERANCE } from './allocation.js'
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
    expect(imports).toContain('./household.js')
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
    expect(result.noCapacity).toEqual([{ memberId: 'away', assignedMinutes: 0 }])
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
    const definitions = { fairShare: [], isLevel: [] }
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
    expect(definitions.fairShare).toHaveLength(1)
    expect(definitions.isLevel).toHaveLength(1)
    expect(definitions.fairShare[0]).toMatch(/allocation\.js$/)
    expect(definitions.isLevel[0]).toMatch(/allocation\.js$/)
  })

  it('POSITIVE CONTROL: the definition scan can find a definition when there is one', () => {
    // Guards the assertion above against passing at zero. A regex that matches
    // nothing would report length 0, not 1 — but a future rename could leave
    // this scan silently blind, so prove it sees a known definition.
    const text = readFileSync(resolve(process.cwd(), 'src/lib/allocation.js'), 'utf8')
    expect(text).toMatch(/export function fairShare\b/)
    expect(text).toMatch(/export function isLevel\b/)
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
