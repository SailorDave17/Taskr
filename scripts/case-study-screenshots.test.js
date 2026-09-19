import { describe, expect, it } from 'vitest'

import {
  GRANULARITY_FLOOR_SCENARIO,
  captures,
  householdFromScenario,
  scenarioNamed,
} from './case-study-households.mjs'
import {
  DEVICE_SCALE,
  VIEWPORT,
  captureFaults,
  readIhdr,
  unexpectedNames,
} from './case-study-screenshots.mjs'
import { SCENARIOS } from '../src/lib/allocation.corpus.js'
import { allocate } from '../src/lib/allocation.js'

// The pure half of #452's screenshot command — AC 4.
//
// The command itself launches Chrome and cannot run in CI, which is the same
// shape as `check:live` and `prove:finish-race`. What `npm test` CAN cover is
// every judgement the command makes: which household is photographed, what its
// verdict must say, and whether a PNG it wrote is the size and colour type it
// claims. Those are the parts a mistake would be in.
//
// `captureFaults` is fed states it must REFUSE, for the reason
// `scripts/prove-finish-race.test.js` gives about its own checkers: a real run
// only ever produces healthy PNGs, so nothing in a real run can tell a working
// checker from one that returns "no faults" unconditionally.

/** A synthetic PNG header — the first 26 bytes are all `readIhdr` reads. */
function pngBytes({ width, height, bitDepth = 8, colorType = 2, signature = true }) {
  const buf = Buffer.alloc(26)
  const sig = signature
    ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    : [0, 0, 0, 0, 0, 0, 0, 0]
  for (const [i, b] of sig.entries()) buf[i] = b
  buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf[24] = bitDepth
  buf[25] = colorType
  return buf
}

const FULL = { width: VIEWPORT.width * DEVICE_SCALE, height: VIEWPORT.height * DEVICE_SCALE }

describe('#452 — which household the case study photographs', () => {
  it('reproduces the corpus granularity-floor shape, by reading it rather than copying it', () => {
    // AC 2. The capacities and jobs are NOT written here: they are read from
    // the corpus, so a change there is either reflected or caught, never
    // silently diverged from.
    const scenario = scenarioNamed(GRANULARITY_FLOOR_SCENARIO)
    expect(scenario.members.map((m) => m.capacityMinutes)).toEqual([25, 100, 150])
    expect(scenario.chores.map((c) => c.expectedMinutes)).toEqual([40, 35, 30, 30, 25, 20, 10])
  })

  it('names a fair share of 17 min and a smallest job of 10 min', () => {
    // AC 2's other half, asserted against the SHIPPED allocator rather than
    // against a number typed here — this is the sentence that appears on the
    // screenshot, and `Split` computes it through this same call.
    const scenario = scenarioNamed(GRANULARITY_FLOOR_SCENARIO)
    const verdict = allocate({
      members: scenario.members.map((m) => ({ id: m.id, capacityMinutes: m.capacityMinutes })),
      chores: scenario.chores,
    })
    expect(verdict.level).toBe(false)
    expect(verdict.reason.fairShareMinutes).toBe(17)
    expect(verdict.reason.smallestJobMinutes).toBe(10)
  })

  it('refuses a scenario name the corpus does not carry, rather than drawing an empty household', () => {
    // The loud-failure property. Without it a renamed corpus scenario produces
    // two plausible PNGs of nobody, which is far worse than a crash.
    expect(() => scenarioNamed('a scenario nobody wrote', SCENARIOS)).toThrow(
      /has no scenario named/,
    )
  })

  it('gives every job a holder, so the bars draw what the allocator dealt', () => {
    // The defect this catches is silent: `allocate` reports the deal in
    // `assignments`, and a first draft read it off `load[].choreIds`, which
    // does not exist. Every chore came back unassigned and the household
    // rendered with empty bars — a picture of nobody doing anything.
    const household = householdFromScenario(scenarioNamed(GRANULARITY_FLOOR_SCENARIO))
    const unassigned = household.chores.filter((c) => c.assigned_member_id == null)
    expect(unassigned, 'every job must be held by somebody on the capture').toEqual([])
  })

  it('carries the corpus load: 10 minutes on one, 65 on another, 115 on the third', () => {
    const household = householdFromScenario(scenarioNamed(GRANULARITY_FLOOR_SCENARIO))
    const held = new Map()
    for (const chore of household.chores) {
      held.set(
        chore.assigned_member_id,
        (held.get(chore.assigned_member_id) ?? 0) + chore.expected_minutes,
      )
    }
    expect([...held.values()].sort((a, b) => a - b)).toEqual([10, 65, 115])
  })

  it('shows only placeholder names', () => {
    // AC 3. Every name is one `src/test/gate.test.js` already declares in
    // PLACEHOLDER_NAMES, so this story adds no exemption to that vocabulary.
    for (const capture of captures()) {
      for (const member of capture.props.members) {
        expect(member.display_name).toMatch(/^Placeholder /)
      }
    }
  })

  it('builds fresh objects per call, so one capture cannot corrupt the other', () => {
    const first = captures()
    first[0].props.members[0].display_name = 'Mutated'
    expect(captures()[0].props.members[0].display_name).toBe('Placeholder One')
  })
})

describe('#452 — the two shapes are opposite, and swapping them is caught', () => {
  // THE MUTATION AC 4 NAMES. The command's whole claim is that one capture
  // reaches level and the other cannot; a fixture edit that swapped the two
  // households would produce two valid-looking PNGs making the wrong claim, and
  // every dimension check above would still pass. These are the tests named
  // before the mutation ran.
  const verdictOf = (props) =>
    allocate({ members: props.capacities, chores: props.chores.map((c) => ({ id: c.id, expectedMinutes: c.expected_minutes })) })

  it('the capture named level reaches level', () => {
    const level = captures().find((c) => c.name === 'case-split-level')
    expect(verdictOf(level.props).level).toBe(true)
    expect(verdictOf(level.props).reason).toBeNull()
  })

  it('the capture named unreachable does not reach level, and says why', () => {
    const unreachable = captures().find((c) => c.name === 'case-split-unreachable')
    const verdict = verdictOf(unreachable.props)
    expect(verdict.level).toBe(false)
    expect(verdict.reason).toMatchObject({ fairShareMinutes: 17, smallestJobMinutes: 10 })
  })
})

describe('#452 — what the command asserts about a PNG it wrote', () => {
  it('reads width, height, bit depth and colour type out of an IHDR', () => {
    expect(readIhdr(pngBytes({ width: 720, height: 1560 }))).toEqual({
      width: 720,
      height: 1560,
      bitDepth: 8,
      colorType: 2,
    })
  })

  it('refuses bytes that are not a PNG at all', () => {
    expect(() => readIhdr(pngBytes({ width: 1, height: 1, signature: false }))).toThrow(
      /signature/,
    )
  })

  it('passes a full-frame capture at the viewport AC 1 names', () => {
    // The positive control. Without it every refusal below is satisfied by a
    // checker that refuses everything.
    expect(captureFaults({ name: 'ok', bytes: pngBytes(FULL) })).toEqual([])
  })

  it('REFUSES a capture of the wrong width', () => {
    expect(captureFaults({ name: 'narrow', bytes: pngBytes({ ...FULL, width: 360 }) })).toEqual([
      'narrow: width 360, expected 720',
    ])
  })

  it('REFUSES a capture of the wrong height', () => {
    // The device-scale mistake specifically: 780 rather than 1560 is what a
    // forgotten `deviceScaleFactor: 2` produces, and it is the likeliest way
    // this command would quietly emit half-size images.
    expect(captureFaults({ name: 'short', bytes: pngBytes({ ...FULL, height: 780 }) })).toEqual([
      'short: height 780, expected 1560',
    ])
  })

  it('REFUSES a capture at a bit depth other than 8', () => {
    expect(captureFaults({ name: 'deep', bytes: pngBytes({ ...FULL, bitDepth: 16 }) })).toEqual([
      'deep: bit depth 16, expected 8',
    ])
  })

  it('REFUSES a palette PNG, which no viewer would render as the app looks', () => {
    expect(captureFaults({ name: 'paletted', bytes: pngBytes({ ...FULL, colorType: 3 }) })).toEqual(
      ['paletted: colour type 3, expected 2 (RGB) or 6 (RGBA)'],
    )
  })

  it('REFUSES bytes that are not a PNG, naming the file rather than throwing', () => {
    const faults = captureFaults({ name: 'garbage', bytes: pngBytes({ width: 1, height: 1, signature: false }) })
    expect(faults).toHaveLength(1)
    expect(faults[0]).toMatch(/^garbage: /)
  })

  it('reports EVERY fault in one run, not just the first', () => {
    const faults = captureFaults({
      name: 'bad',
      bytes: pngBytes({ width: 100, height: 200, bitDepth: 16, colorType: 3 }),
    })
    expect(faults).toHaveLength(4)
  })

  it('accepts a card crop measured against its own height but held to the frame width', () => {
    expect(
      captureFaults({ name: 'card', bytes: pngBytes({ width: 720, height: 812 }), expected: { width: 720, height: 812 } }),
    ).toEqual([])
  })
})

describe('#452 — the names read off the rendered page', () => {
  it('finds nothing when every name shown was supplied by the fixture', () => {
    expect(unexpectedNames(['Placeholder One', 'Placeholder Two'], ['Placeholder One', 'Placeholder Two'])).toEqual([])
  })

  it('REPORTS a name on the page that the fixture never supplied', () => {
    // The criterion is about what is ON the capture, so the check reads the
    // rendered page rather than the fixture — the fixture is what a mistake
    // would be in, and a check that reads it would agree with its own error.
    expect(unexpectedNames(['Placeholder One', 'A Real Person'], ['Placeholder One'])).toEqual([
      'A Real Person',
    ])
  })
})
