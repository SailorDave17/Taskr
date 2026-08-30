// #204 — the kill conditions, and the comparison that reads a run against them.
//
// THE RATIFIED NUMBERS ARE WRITTEN OUT AGAIN IN THIS FILE, ON PURPOSE.
//
// AC 2 asks that each threshold be defined in exactly one place "rather than
// restated per call site", and this is not a call site: nothing here consumes a
// threshold to do work. `RATIFIED` is the owner's decision of 2026-08-26 —
// epic #217's table, plus the per-kind halving ratified at pickup on
// 2026-08-30 — transcribed as the thing `KILL_CONDITIONS` is checked AGAINST.
//
// It has to be an independent copy or the check is vacuous. Every fixture below
// is built from `RATIFIED`, never from `KILL_CONDITIONS`, so moving any
// threshold in the module by one unit reddens here rather than sailing through
// a suite that cheerfully re-derives its expectations from whatever the module
// now says (`prove-tests` shape 4, and the reason the mutation in AC 3 is worth
// running at all).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  KILL_CONDITIONS,
  SCOPES,
  SEVERITY,
  VERDICTS,
  killConditionRows,
  verdictOf,
} from './extractionThresholds.js'
import { CORPUS } from './extraction.corpus.js'
import { gradeExtraction, oracleExtractorFor, zeroExtractor } from './extraction.js'
import { axisLine, killConditionLines, killConditionSection } from '../../scripts/extraction-report-format.mjs'

/** The owner's numbers, transcribed. See the header for why this copy exists. */
const RATIFIED = {
  accuracy: { direction: 'atLeast', step: 1, at: { capacity: 18, chores: 18, all: 35 } },
  refusals: { direction: 'atLeast', step: 1, at: { capacity: 4, chores: 4, all: 7 } },
  overconfident: { direction: 'atMost', step: 1, at: { capacity: 1, chores: 1, all: 2 } },
  dates: { direction: 'atLeast', step: 1, at: { chores: 18, all: 18 } },
  latency: { direction: 'atMost', step: 1, at: { all: 3000 } },
  cost: { direction: 'atMost', step: 1, at: { all: 5 } },
  correctionRate: { direction: 'atMost', step: 0.1, at: { all: 0.3 } },
}

/** Which axes kill the bet, and the one that only narrows it. */
const RATIFIED_SEVERITY = {
  accuracy: SEVERITY.KILLS,
  refusals: SEVERITY.KILLS,
  overconfident: SEVERITY.KILLS,
  dates: SEVERITY.NARROWS,
  latency: SEVERITY.KILLS,
  cost: SEVERITY.KILLS,
  correctionRate: SEVERITY.KILLS,
}

/** Every (axis, scope) the ratified table names, as a flat list to drive tests. */
const RATIFIED_PAIRS = Object.entries(RATIFIED).flatMap(([key, spec]) =>
  Object.entries(spec.at).map(([scope, threshold]) => ({ key, scope, threshold, spec })),
)

/** Rounded, because 0.3 + 0.1 is not 0.4 and a fixture must not depend on it. */
const nudge = (value, by) => Number((value + by).toFixed(6))

const axisOf = (key) => KILL_CONDITIONS.find((axis) => axis.key === key)
const rowFor = (rows, key) => rows.find((row) => row.axis.key === key)

/** Everything that reads a threshold rather than defining one. */
const CONSUMERS = [
  'scripts/extraction-report-format.mjs',
  'scripts/extraction-corpus-report.mjs',
  'scripts/extraction-run.mjs',
]

/** The threshold values distinctive enough that a match means what it says. */
const DISTINCTIVE = ['3000', '0.3', '35', '18']

/**
 * Source with its comments removed, line by line.
 *
 * Deliberately not a lexer: it is only sound because no file it is pointed at
 * carries a `/*` inside a string or a regex, which the controls below and a
 * one-line grep both confirm. A cleverer stripper here would be a second thing
 * that can be wrong.
 */
function codeOf(source) {
  let inBlock = false
  return source
    .split('\n')
    .map((line) => {
      let out = ''
      let rest = line
      while (rest.length) {
        if (inBlock) {
          const end = rest.indexOf('*/')
          if (end === -1) return out
          rest = rest.slice(end + 2)
          inBlock = false
          continue
        }
        const block = rest.indexOf('/*')
        const lineComment = rest.indexOf('//')
        if (lineComment !== -1 && (block === -1 || lineComment < block)) return out + rest.slice(0, lineComment)
        if (block === -1) return out + rest
        out += rest.slice(0, block)
        rest = rest.slice(block + 2)
        inBlock = true
      }
      return out
    })
    .join('\n')
}

/** The denominators the corpus actually has, per scope. */
const DENOMINATORS = {
  capacity: { answerable: 25, ambiguous: 5, dueApplicable: 0 },
  chores: { answerable: 25, ambiguous: 5, dueApplicable: 25 },
  all: { answerable: 50, ambiguous: 10, dueApplicable: 25 },
}

function summaryFor(scope, over = {}) {
  const { answerable, ambiguous, dueApplicable } = DENOMINATORS[scope]
  return {
    total: answerable + ambiguous,
    answerable,
    ambiguous,
    withinTolerance: 0,
    overconfident: 0,
    dueApplicable,
    dueExact: 0,
    dueInvented: 0,
    ...over,
    refusals: { total: 0, onAmbiguous: 0, onAnswerable: 0, ...(over.refusals ?? {}) },
  }
}

const gradedOf = (per = {}) => ({
  byKind: {
    capacity: summaryFor('capacity', per.capacity),
    chores: summaryFor('chores', per.chores),
  },
  overall: summaryFor('all', per.all),
})

/**
 * A figure set in which ONE axis at ONE scope reads `value`, built from nothing
 * the module says. Everything else is left at whatever the zero row holds — the
 * assertions only ever read the axis under test.
 */
function figuresWith(key, scope, value) {
  if (key === 'latency') return { latency: { transportP95Ms: 0, providerCallP95Ms: value } }
  if (key === 'cost') return { costPerHouseholdPerYearUsd: value }
  if (key === 'correctionRate') return { correctionRate: value }
  const field = {
    accuracy: (v) => ({ withinTolerance: v }),
    refusals: (v) => ({ refusals: { onAmbiguous: v } }),
    overconfident: (v) => ({ overconfident: v }),
    dates: (v) => ({ dueExact: v }),
  }[key]
  return { graded: gradedOf({ [scope === 'all' ? 'all' : scope]: field(value) }) }
}

describe('#204 AC 2 — every kill number is defined in exactly one place', () => {
  it('holds the ratified threshold for every axis and scope, and no others', () => {
    for (const { key, scope, threshold } of RATIFIED_PAIRS) {
      expect(axisOf(key), `no axis named ${key}`).toBeDefined()
      expect(axisOf(key).thresholds[scope], `${key} at ${scope}`).toBe(threshold)
    }
    // ...and the table carries nothing the owner did not name. Without this the
    // assertion above is satisfied by a module that has quietly grown an eighth
    // axis, or a scope the verdict was never meant to be taken at.
    const declared = KILL_CONDITIONS.flatMap((axis) =>
      Object.keys(axis.thresholds).map((scope) => `${axis.key}@${scope}`),
    )
    expect(declared.sort()).toEqual(
      RATIFIED_PAIRS.map(({ key, scope }) => `${key}@${scope}`).sort(),
    )
  })

  it('compares in the ratified direction, so a floor cannot become a ceiling', () => {
    // A direction flip leaves every number in place and inverts every verdict,
    // which no assertion on the values alone can see.
    for (const [key, spec] of Object.entries(RATIFIED)) {
      expect(axisOf(key).direction, `${key} compares the wrong way`).toBe(spec.direction)
    }
  })

  it('records which failures kill the bet and which only narrow it', () => {
    for (const [key, severity] of Object.entries(RATIFIED_SEVERITY)) {
      expect(axisOf(key).severity, `${key} has the wrong severity`).toBe(severity)
    }
    // The date axis is the whole reason severity exists as a field. If it ever
    // becomes a killing axis the epic's wording has changed, and this should
    // stop rather than follow along.
    expect(axisOf('dates').severity).toBe(SEVERITY.NARROWS)
  })

  it('is the only place a threshold is written: no consumer restates one', () => {
    // Scoped to the values distinctive enough to grep for. 1, 2, 4 and 5 are
    // not — a scan for them would match padding widths and array indices and
    // report drift that is not there, which is worse than not scanning.
    //
    // COMMENTS ARE STRIPPED, because the subject is a CALL SITE and prose is
    // not one. Both consumer files explain WHY the per-kind split exists, and
    // that explanation cannot be written without quoting the numbers — so a
    // scan over raw source would refuse the very sentence that documents the
    // rule it enforces, and the fix would be to delete the explanation.
    for (const path of CONSUMERS) {
      const code = codeOf(readFileSync(resolve(process.cwd(), path), 'utf8'))
      for (const value of DISTINCTIVE) {
        expect(code, `${path} restates the threshold ${value}`).not.toContain(value)
      }
    }
  })

  it('POSITIVE CONTROL: those values are genuinely in the module that defines them', () => {
    // Without this the scan above passes identically against four values that
    // are no longer any axis's threshold — a clean result over a stale needle.
    const module = readFileSync(resolve(process.cwd(), 'src/lib/extractionThresholds.js'), 'utf8')
    for (const value of DISTINCTIVE) expect(module).toContain(value)
  })

  it('POSITIVE CONTROL: stripping comments keeps the code and drops only the prose', () => {
    // A stripper that ate the middle of a file would leave the scan above
    // clean for the worst possible reason. So it is controlled in the shape of
    // the damage: the same number survives in code and disappears in a comment,
    // and every consumer still carries landmarks from its start, middle and end.
    expect(codeOf("const x = 35 // 35 in prose")).toContain('35')
    expect(codeOf('// 35 in prose\nconst x = 1')).not.toContain('35')
    expect(codeOf('/* 35\n * 35\n */\nconst x = 1')).not.toContain('35')

    const landmarks = {
      'scripts/extraction-report-format.mjs': ['export const pct', 'scoreLines', 'killConditionSection'],
      'scripts/extraction-corpus-report.mjs': ['gradeExtraction', 'FLOOR', 'export const FIGURES'],
      'scripts/extraction-run.mjs': ['transcriptKeyOf', 'runReportLines', 'process.exitCode'],
    }
    for (const [path, expected] of Object.entries(landmarks)) {
      const code = codeOf(readFileSync(resolve(process.cwd(), path), 'utf8'))
      for (const landmark of expected) {
        expect(code, `stripping comments ate ${landmark} out of ${path}`).toContain(landmark)
      }
    }
  })

  it('reports a verdict with no figure in band, rather than killing the report', () => {
    // The defence the AC 6 mutation found: `render` reached `.toFixed` on an
    // undefined value and threw, which on a live run destroys a report every
    // provider call has already been paid for. Exercised here rather than left
    // to trust — an unexercised defence is byte-identical to dead code to
    // whoever is next tidying up, and this branch is unreachable through
    // `killConditionRows` by construction.
    const broken = { axis: axisOf('cost'), scope: 'all', threshold: 5, verdict: VERDICTS.PASS }
    let line
    expect(() => {
      line = axisLine(broken)
    }, 'a malformed row killed the renderer').not.toThrow()
    expect(line).toContain('!! BROKEN')
    expect(line, 'the broken cell does not say which axis').toContain('cost')
    expect(line, 'a broken row must not read as a pass').not.toContain('PASS ')
  })

  it('renders each axis as its figure, its threshold and a verdict', () => {
    const rows = killConditionRows({ graded: gradedOf({ all: { withinTolerance: 50 } }) }, 'all')
    const line = axisLine(rowFor(rows, 'accuracy'))
    expect(line).toContain('within tolerance')
    expect(line).toContain('50 of 50')
    expect(line).toContain('PASS')
    expect(line).toContain('threshold >= 35 of 50')
  })
})

describe('#204 AC 1 — the kill conditions are recorded beside the measured scale', () => {
  const doc = readFileSync(resolve(process.cwd(), 'docs/extraction-corpus.md'), 'utf8')

  it('tables every axis, with its threshold at every scope it applies to', async () => {
    // Anchored on the axis's own LABEL and read left to right, never on the
    // values alone: a row matched only by its numbers is satisfied by any other
    // row of the same table that happens to share them, and this table has
    // three rows carrying "18 of 25".
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    const denominatorField = {
      accuracy: 'answerable',
      refusals: 'ambiguous',
      overconfident: 'ambiguous',
      dates: 'dueApplicable',
    }
    const summaryAt = (scope) => (scope === 'all' ? ceiling.overall : ceiling.byKind[scope])

    for (const axis of KILL_CONDITIONS) {
      const cells = SCOPES.map((scope) => {
        const threshold = axis.thresholds[scope]
        if (threshold === undefined) return '—'
        const field = denominatorField[axis.key]
        return axis.renderThreshold(threshold, field ? summaryAt(scope)[field] : undefined)
      })
      const severity = axis.severity === SEVERITY.KILLS ? 'kills the bet' : 'narrows the bet'
      const row = `| ${axis.label} | ${cells.join(' | ')} | ${severity} |`
      expect(doc, `docs/extraction-corpus.md has no row for ${axis.key}`).toContain(row)
    }
  })

  it('names what each unmeasured axis is waiting for, rather than leaving it blank', () => {
    const rows = killConditionRows({ graded: gradedOf() }, 'all')
    for (const key of ['latency', 'cost', 'correctionRate']) {
      const row = rowFor(rows, key)
      expect(row.verdict).toBe(VERDICTS.NOT_MEASURED)
      expect(doc, `the doc does not say what ${key} is waiting for`).toContain(
        `| ${row.axis.label} | ${row.pending} |`,
      )
    }
  })

  it('POSITIVE CONTROL: the row match is strict enough to notice a moved threshold', () => {
    // Without this, `toContain` over a row built from the module would pass
    // against a document that merely mentions the label somewhere — and would
    // keep passing after a threshold moved, which is the whole failure the
    // doc-agreement test exists to catch.
    expect(doc).not.toContain('| within tolerance | >= 19 of 25 |')
    expect(doc).toContain('| within tolerance | >= 18 of 25 |')
  })
})

describe('#204 AC 3 — every threshold is load-bearing at its own boundary', () => {
  // One pair per (axis, scope): the figure exactly ON the threshold must pass,
  // and the figure one unit the wrong side of it must fail. Both are computed
  // from RATIFIED, so moving the module's number by one unit inverts one of
  // them whichever way it moves.
  for (const { key, scope, threshold, spec } of RATIFIED_PAIRS) {
    it(`${key} at ${scope}: ${threshold} passes, one unit worse fails`, () => {
      const worse = spec.direction === 'atLeast' ? -spec.step : spec.step
      const onIt = killConditionRows(figuresWith(key, scope, threshold), scope)
      const past = killConditionRows(figuresWith(key, scope, nudge(threshold, worse)), scope)
      expect(rowFor(onIt, key).verdict, `${key} at exactly ${threshold}`).toBe(VERDICTS.PASS)
      expect(rowFor(past, key).verdict, `${key} one unit past ${threshold}`).toBe(VERDICTS.FAIL)
    })
  }

  it('POSITIVE CONTROL: the fixtures reach the axis they name', () => {
    // A `figuresWith` that wrote the wrong field would leave every axis at its
    // zero row, and half the pairs above would pass for the wrong reason —
    // an at-most axis reads PASS at zero whatever the fixture did.
    for (const { key, scope, threshold } of RATIFIED_PAIRS) {
      const rows = killConditionRows(figuresWith(key, scope, threshold), scope)
      expect(rowFor(rows, key).value, `${key} at ${scope} never received its figure`).toBe(threshold)
    }
  })
})

describe('#204 AC 5 — an axis with no figure is not an axis that passed', () => {
  it('prints "not measured" for latency, cost and correction rate before any live run', () => {
    // The figure set a graded corpus run produces TODAY: three axes absent.
    const lines = killConditionLines('all', { graded: gradedOf() }, 'all')
    for (const label of ['p95, deployed path', 'cost per household per year', 'correction rate']) {
      const line = lines.find((text) => text.includes(label))
      expect(line, `no row for ${label}`).toBeDefined()
      expect(line, `${label} does not say it is unmeasured`).toContain('not measured')
      expect(line, `${label} claims a pass`).not.toContain('PASS')
    }
  })

  it('says WHY there is no figure, rather than only that there is none', () => {
    const rows = killConditionRows({ graded: gradedOf() }, 'all')
    expect(rowFor(rows, 'latency').pending).toContain('#205')
    expect(rowFor(rows, 'cost').pending).toContain('#206')
    expect(rowFor(rows, 'correctionRate').pending).toContain('production')
  })

  it('reads a measured ZERO as a measurement, not as an absence', () => {
    // The trap this axis type exists around: `!value` treats a zero-millisecond
    // p95 and a missing one as the same thing. A free extractor costs $0 and
    // must PASS the cost axis, not disappear from the verdict.
    const rows = killConditionRows({ graded: gradedOf(), costPerHouseholdPerYearUsd: 0 }, 'all')
    expect(rowFor(rows, 'cost').verdict).toBe(VERDICTS.PASS)
    expect(rowFor(rows, 'cost').value).toBe(0)
  })

  it('needs BOTH halves of the deployed path before it will report a latency', () => {
    // A local run times this machine to the provider and knows nothing about a
    // phone's transport or the function's cold start. Feeding half the path in
    // would be a real measurement of the wrong thing, which is worse than none.
    const providerOnly = killConditionRows({ graded: gradedOf(), latency: { providerCallP95Ms: 900 } }, 'all')
    expect(rowFor(providerOnly, 'latency').verdict).toBe(VERDICTS.NOT_MEASURED)
    expect(rowFor(providerOnly, 'latency').pending).toContain('transport')

    const bothHalves = killConditionRows(
      { graded: gradedOf(), latency: { transportP95Ms: 800, providerCallP95Ms: 900 } },
      'all',
    )
    expect(rowFor(bothHalves, 'latency').verdict).toBe(VERDICTS.PASS)
    expect(rowFor(bothHalves, 'latency').value, 'the axis is the whole path, not one leg').toBe(1700)
  })

  it('reports a scope as incomplete while any axis is unmeasured, even when nothing failed', () => {
    const perfect = gradedOf({
      all: { withinTolerance: 50, refusals: { onAmbiguous: 10 }, dueExact: 25 },
    })
    const summary = verdictOf(killConditionRows({ graded: perfect }, 'all'))
    expect(summary.verdict, 'nothing measured has failed').toBe(VERDICTS.PASS)
    expect(summary.complete, 'a pass over an incomplete sheet is not a complete pass').toBe(false)
    expect(summary.notMeasured.map((row) => row.axis.key)).toEqual([
      'latency',
      'cost',
      'correctionRate',
    ])
  })

  it('refuses a scope it does not know rather than silently reporting nothing', () => {
    // An empty row list renders as a block with no axes in it, which reads as a
    // clean sheet. A typo in a scope name must be loud.
    expect(() => killConditionRows({ graded: gradedOf() }, 'chore')).toThrow(/unknown scope/)
    expect(SCOPES).toEqual(['capacity', 'chores', 'all'])
  })
})

describe('#204 AC 4 — the summary names the failing axis, never one combined verdict', () => {
  it('names the one axis that failed when every other clears', () => {
    const rows = killConditionRows(
      {
        graded: gradedOf({ all: { withinTolerance: 50, refusals: { onAmbiguous: 10 }, dueExact: 25 } }),
        latency: { transportP95Ms: 3000, providerCallP95Ms: 3000 },
        costPerHouseholdPerYearUsd: 1,
        correctionRate: 0.1,
      },
      'all',
    )
    const summary = verdictOf(rows)
    expect(summary.kills.map((row) => row.axis.key)).toEqual(['latency'])
    expect(summary.complete).toBe(true)

    const line = killConditionLines('all', {
      graded: gradedOf({ all: { withinTolerance: 50, refusals: { onAmbiguous: 10 }, dueExact: 25 } }),
      latency: { transportP95Ms: 3000, providerCallP95Ms: 3000 },
      costPerHouseholdPerYearUsd: 1,
      correctionRate: 0.1,
    }, 'all').at(-1)
    expect(line).toContain('FAILS on latency')
    expect(line, 'the summary blamed an axis that passed').not.toContain('accuracy')
  })

  it('keeps a date shortfall separate, because it narrows the bet rather than killing it', () => {
    const rows = killConditionRows(
      { graded: gradedOf({ all: { withinTolerance: 50, refusals: { onAmbiguous: 10 }, dueExact: 0 } }) },
      'all',
    )
    const summary = verdictOf(rows)
    expect(summary.narrows.map((row) => row.axis.key)).toEqual(['dates'])
    expect(summary.kills, 'a date shortfall was reported as a kill').toEqual([])
    expect(summary.verdict, 'narrowing is not failing').toBe(VERDICTS.PASS)
  })

  it('stops chore capture while sparing capacity — the shape a combined verdict cannot express', () => {
    // The case the per-kind decision was taken for. Capacity 25 of 25 and
    // chores 10 of 25 sum to 35 of 50, which CLEARS the overall accuracy kill
    // number on a run whose chore half is broken.
    const graded = gradedOf({
      capacity: { withinTolerance: 25, refusals: { onAmbiguous: 5 } },
      chores: { withinTolerance: 10, refusals: { onAmbiguous: 5 }, dueExact: 25 },
      all: { withinTolerance: 35, refusals: { onAmbiguous: 10 }, dueExact: 25 },
    })
    expect(verdictOf(killConditionRows({ graded }, 'all')).verdict, 'the combined figure clears').toBe(
      VERDICTS.PASS,
    )
    expect(verdictOf(killConditionRows({ graded }, 'capacity')).verdict).toBe(VERDICTS.PASS)
    const chores = verdictOf(killConditionRows({ graded }, 'chores'))
    expect(chores.verdict, 'the broken half was not caught').toBe(VERDICTS.FAIL)
    expect(chores.kills.map((row) => row.axis.key)).toEqual(['accuracy'])
  })

  it('prints all three verdicts, so neither kind can hide inside the other', () => {
    const section = killConditionSection({ graded: gradedOf() })
    for (const scope of SCOPES) expect(section.some((line) => line.trim() === scope)).toBe(true)
    expect(section.filter((line) => line.includes('verdict'))).toHaveLength(3)
  })

  it('gives capacity no due-date row, because a week has no due date', () => {
    const keys = killConditionRows({ graded: gradedOf() }, 'capacity').map((row) => row.axis.key)
    expect(keys, 'the date axis reached the capacity block').not.toContain('dates')
    expect(keys, 'a run-level axis was taken per kind').not.toContain('latency')
    expect(keys).toEqual(['accuracy', 'refusals', 'overconfident'])
  })
})

describe('#204 — the corpus the per-kind numbers were halved against', () => {
  it('is symmetric, which is what makes the halving clean rather than a fudge', async () => {
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    for (const kind of ['capacity', 'chores']) {
      expect(ceiling.byKind[kind].answerable, `${kind} answerable`).toBe(25)
      expect(ceiling.byKind[kind].ambiguous, `${kind} ambiguous`).toBe(5)
    }
    // The two per-kind thresholds are the same number BECAUSE the two halves
    // are the same size. If a kind ever grows, this reddens before a stale
    // halving quietly reprices a decided bet.
    expect(RATIFIED.accuracy.at.capacity).toBe(RATIFIED.accuracy.at.chores)
    expect(RATIFIED.refusals.at.capacity).toBe(RATIFIED.refusals.at.chores)
    expect(RATIFIED.overconfident.at.capacity).toBe(RATIFIED.overconfident.at.chores)
  })

  it('gives the date axis the same denominator at chores and overall', async () => {
    // Why one number serves both scopes: capacity contributes no applicable
    // item, so the overall date figure IS the chore figure. Adding a due
    // expectation to a capacity description would break that silently, and the
    // `all` threshold would then be a number nobody chose.
    const ceiling = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    expect(ceiling.byKind.capacity.dueApplicable).toBe(0)
    expect(ceiling.overall.dueApplicable).toBe(ceiling.byKind.chores.dueApplicable)
    expect(RATIFIED.dates.at.all).toBe(RATIFIED.dates.at.chores)
  })
})

describe('#204 — the comparison mechanism, controlled in both directions', () => {
  // The floor and the ceiling are not candidate extractors and neither verdict
  // is a verdict on the bet. They are the two-sided control on the comparator:
  // one that could only ever print PASS would look identical to a working one
  // until the day it mattered.
  it('FLOOR: the do-nothing extractor fails every axis that has a figure', async () => {
    const graded = await gradeExtraction(zeroExtractor, CORPUS)
    for (const scope of SCOPES) {
      const rows = killConditionRows({ graded }, scope).filter(
        (row) => row.verdict !== VERDICTS.NOT_MEASURED,
      )
      expect(rows.length, `${scope} had no measured axis to fail`).toBeGreaterThan(0)
      expect(
        rows.filter((row) => row.verdict !== VERDICTS.FAIL).map((row) => row.axis.key),
        `${scope}: the floor cleared an axis`,
      ).toEqual([])
    }
  })

  it('CEILING: the corpus’s own answers clear every axis that has a figure', async () => {
    const graded = await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS)
    for (const scope of SCOPES) {
      const rows = killConditionRows({ graded }, scope).filter(
        (row) => row.verdict !== VERDICTS.NOT_MEASURED,
      )
      expect(rows.length, `${scope} had no measured axis to clear`).toBeGreaterThan(0)
      expect(
        rows.filter((row) => row.verdict !== VERDICTS.PASS).map((row) => row.axis.key),
        `${scope}: the ceiling failed an axis`,
      ).toEqual([])
    }
  })

  it('and the two controls disagree on every measured axis, which is what makes them a scale', async () => {
    // Without this, both assertions above would still pass against a comparator
    // whose PASS and FAIL happened to be the same word.
    const floor = killConditionRows({ graded: await gradeExtraction(zeroExtractor, CORPUS) }, 'all')
    const ceiling = killConditionRows({ graded: await gradeExtraction(oracleExtractorFor(CORPUS), CORPUS) }, 'all')
    const measured = floor.filter((row) => row.verdict !== VERDICTS.NOT_MEASURED)
    for (const row of measured) {
      expect(rowFor(ceiling, row.axis.key).verdict).not.toBe(row.verdict)
    }
    expect(measured).toHaveLength(4)
  })
})
