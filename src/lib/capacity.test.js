import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CAPACITY_COLUMNS,
  MAX_CAPACITY_MINUTES,
  MIN_CAPACITY_MINUTES,
  WEEK_STARTS_ON,
  WEEK_START_ISO_DOW,
  capacitiesFor,
  effectiveCapacity,
  normalizeCapacityMinutes,
  periodStartFor,
} from './capacity.js'

// #44 — capacity as a fact about a particular week.
//
// The database half (row-level security, column grants, the cascade, the Monday
// constraint) is src/test/capacity.pglite.test.js against a real Postgres. What
// is here is the part that has to be right in the client: which week an instant
// belongs to, and which number wins when a member has both a baseline and an
// override.

const SOURCE = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')

/** Comments stripped, so prose describing a hazard does not read as the hazard. */
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function sourceFiles(dir = resolve(process.cwd(), 'src')) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(js|jsx)$/.test(entry)) found.push(path)
  }
  return found
}

describe('AC 1 — the week begins on Monday, and the constant is named', () => {
  it('names the day rather than inlining it', () => {
    expect(WEEK_STARTS_ON).toBe('Monday')
    expect(WEEK_START_ISO_DOW).toBe(1)
  })

  it('agrees with the check constraint the migration enforces', () => {
    // The constant and the database are two statements of one decision. This
    // reads the migration rather than restating it, so a change to either that
    // is not a change to both fails here. Same idiom as chores.test.js reading
    // the bounds out of 0003.
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0005_weekly_capacity.sql'),
      'utf8',
    )
    const constraint = sql.match(/extract\(isodow from period_start\)\s*=\s*(\d)/)
    expect(constraint, 'no isodow check constraint found in 0005').not.toBeNull()
    expect(Number(constraint[1])).toBe(WEEK_START_ISO_DOW)
  })

  it('returns a Monday for every day of a week, in any zone', () => {
    for (const day of ['09', '10', '11', '12', '13', '14', '15', '16']) {
      const start = periodStartFor(`2026-08-${day}T12:00:00Z`, 'UTC')
      const [y, m, d] = start.split('-').map(Number)
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), `${start} is not a Monday`).toBe(1)
    }
  })

  it('puts a week together: Monday through Sunday share one period key', () => {
    // 2026-08-10 is a Monday. The whole week must key to it, and the next
    // Monday must not — the boundary is the assertion, not the middle.
    const week = ['10', '11', '12', '13', '14', '15', '16'].map((d) =>
      periodStartFor(`2026-08-${d}T12:00:00Z`, 'UTC'),
    )
    expect(new Set(week).size).toBe(1)
    expect(week[0]).toBe('2026-08-10')
    expect(periodStartFor('2026-08-17T12:00:00Z', 'UTC')).toBe('2026-08-17')
    expect(periodStartFor('2026-08-09T12:00:00Z', 'UTC')).toBe('2026-08-03')
  })
})

describe('AC 6 — the boundary comes from the household zone, never the machine', () => {
  const ORIGINAL_TZ = process.env.TZ
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ
  })

  /** Run a thunk with the PROCESS timezone forced to `zone`. */
  function underProcessZone(zone, thunk) {
    const before = process.env.TZ
    process.env.TZ = zone
    try {
      return thunk()
    } finally {
      process.env.TZ = before
    }
  }

  it('POSITIVE CONTROL: changing the process zone actually changes anything at all', () => {
    // Without this the two-zone test below is vacuous: if Node ignored the
    // change, both arms would run in the same zone and agree for that reason
    // rather than because the code is zone-independent. Measured 2026-08-08 —
    // Node 22 does honour a runtime TZ change, and this is what keeps that true.
    const instant = '2026-08-10T03:30:00Z'
    const utc = underProcessZone('UTC', () => new Date(instant).getHours())
    const ny = underProcessZone('America/New_York', () => new Date(instant).getHours())
    expect(utc).not.toBe(ny)
  })

  it('gives the same period under TZ=UTC and TZ=America/New_York', () => {
    const instants = [
      '2026-08-10T00:00:00Z',
      '2026-08-10T03:30:00Z',
      '2026-08-13T23:30:00Z',
      '2026-08-17T04:00:00Z',
      '2026-03-08T06:30:00Z', // inside a US daylight-saving transition
      '2026-11-01T05:30:00Z', // and the other one
    ]
    for (const zone of ['UTC', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata']) {
      for (const instant of instants) {
        const inUtc = underProcessZone('UTC', () => periodStartFor(instant, zone))
        const inNy = underProcessZone('America/New_York', () => periodStartFor(instant, zone))
        expect(inNy, `${instant} in ${zone} moved with the process zone`).toBe(inUtc)
      }
    }
  })

  it('CROSS-MIDNIGHT: 23:30 local Sunday is still last week, and 00:30 Monday is not', () => {
    // The fixture AC 6 names. 2026-08-10 is a Monday, so 23:30 on Sunday the
    // 9th belongs to the week beginning Monday the 3rd. In New York that
    // instant is 2026-08-10T03:30Z — already Monday in UTC, which is exactly
    // how a boundary computed in the wrong zone lands a week early.
    const sundayLate = '2026-08-10T03:30:00Z' // 23:30 Sun 9 Aug in New York
    expect(periodStartFor(sundayLate, 'America/New_York')).toBe('2026-08-03')
    expect(periodStartFor(sundayLate, 'UTC')).toBe('2026-08-10')

    const mondayEarly = '2026-08-10T04:30:00Z' // 00:30 Mon 10 Aug in New York
    expect(periodStartFor(mondayEarly, 'America/New_York')).toBe('2026-08-10')
  })

  it('and the two households genuinely disagree, which is why the zone is stored', () => {
    // If this passed with both zones giving the same answer, the cross-midnight
    // test above would prove nothing about zones.
    const instant = '2026-08-10T03:30:00Z'
    expect(periodStartFor(instant, 'America/New_York')).not.toBe(
      periodStartFor(instant, 'Australia/Sydney'),
    )
  })

  it('never calls a local-time getter, which is the only way it could drift', () => {
    const code = codeOf(SOURCE)
    // getUTC* is fine and used deliberately; the bare local getters are not.
    expect(code).not.toMatch(/\.getHours\(|\.getDate\(|\.getDay\(|\.getMonth\(|\.getFullYear\(/)
    expect(code).not.toMatch(/toLocaleDateString\(|toLocaleString\(/)
  })

  it('POSITIVE CONTROL: stripping comments leaves the code', () => {
    const code = codeOf(SOURCE)
    expect(code).toMatch(/export function periodStartFor\b/)
    expect(code).toMatch(/getUTCDay\(/)
  })

  it('refuses to guess when no zone is supplied', () => {
    expect(() => periodStartFor('2026-08-10T12:00:00Z')).toThrow(/timezone/i)
    expect(() => periodStartFor('not a date', 'UTC')).toThrow(/real instant/i)
  })
})

describe('AC 7 — one function answers what a member actually has', () => {
  const member = { id: 'm1', weekly_minutes: 300 }

  it('returns the baseline when there is no override', () => {
    expect(effectiveCapacity(member, null)).toBe(300)
    expect(effectiveCapacity(member, undefined)).toBe(300)
  })

  it('returns the override when there is one', () => {
    expect(effectiveCapacity(member, { minutes: 90 })).toBe(90)
  })

  it('an override of ZERO wins — the case the feature most exists for', () => {
    // `override?.minutes || baseline` returns 300 here, silently telling the
    // split that someone who said they have no time this week has a normal one.
    // The PRESENCE of the row decides, never the truthiness of its value.
    expect(effectiveCapacity(member, { minutes: 0 })).toBe(0)
  })

  it('an override for a DIFFERENT period does not apply', () => {
    const capacities = capacitiesFor(
      [member],
      [{ member_id: 'm1', period_start: '2026-08-03', minutes: 30 }],
      '2026-08-10',
    )
    expect(capacities).toEqual([{ id: 'm1', capacityMinutes: 300 }])
  })

  it('and the same override DOES apply to its own period', () => {
    // The other half. Without it the test above passes on a function that
    // ignores overrides entirely.
    const capacities = capacitiesFor(
      [member],
      [{ member_id: 'm1', period_start: '2026-08-10', minutes: 30 }],
      '2026-08-10',
    )
    expect(capacities).toEqual([{ id: 'm1', capacityMinutes: 30 }])
  })

  it('hands the allocator its own input shape, so it never sees a member row', () => {
    const capacities = capacitiesFor(
      [member, { id: 'm2', weekly_minutes: 60 }],
      [{ member_id: 'm2', period_start: '2026-08-10', minutes: 0 }],
      '2026-08-10',
    )
    expect(capacities).toEqual([
      { id: 'm1', capacityMinutes: 300 },
      { id: 'm2', capacityMinutes: 0 },
    ])
    for (const entry of capacities) {
      expect(Object.keys(entry).sort()).toEqual(['capacityMinutes', 'id'])
    }
  })

  it('refuses to resolve capacities without saying which week', () => {
    expect(() => capacitiesFor([member], [])).toThrow(/particular week/i)
  })

  it('exports exactly one implementation of effective capacity, across all of src/', () => {
    const definitions = []
    for (const file of sourceFiles()) {
      if (/\.test\.jsx?$/.test(file)) continue
      const text = codeOf(readFileSync(file, 'utf8'))
      const found = text.match(/(function\s+effectiveCapacity\b|(const|let)\s+effectiveCapacity\s*=)/g) ?? []
      for (let i = 0; i < found.length; i += 1) definitions.push(file)
    }
    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toMatch(/capacity\.js$/)
  })

  it('no module RESOLVES capacity by reading members.weekly_minutes', () => {
    // The property, stated as narrowly as it is true. Three files may name the
    // column and each for a different reason:
    //
    //   household.js  — the data layer that SELECTs it. Somebody has to.
    //   capacity.js   — this module, the one place baseline and override meet.
    //   Roster.jsx    — renders the BASELINE, which is what it means to show.
    //                   #46 is where that screen starts showing this week's
    //                   number, and it will come through effectiveCapacity.
    //
    // The allocator (#40) is the one that matters and it is deliberately not on
    // the list: it receives capacity and cannot read it. An allowlist has to be
    // edited before a fourth legitimate reader can exist, which is the cost —
    // and is also the point, because that edit is where somebody asks whether
    // the new reader should be calling effectiveCapacity instead.
    const allowed = ['household.js', 'capacity.js', 'Roster.jsx']
    const readers = sourceFiles()
      .filter((file) => !/\.test\.jsx?$/.test(file))
      .filter((file) => /weekly_minutes/.test(codeOf(readFileSync(file, 'utf8'))))
      .map((file) => file.split(/[\\/]/).pop())
      .sort()
    expect(readers.filter((name) => !allowed.includes(name))).toEqual([])
    expect(readers, 'the allocator must never read the column').not.toContain('allocation.js')
  })

  it('POSITIVE CONTROL: the reader scan finds the readers that are supposed to be there', () => {
    // An empty result would satisfy the assertion above while meaning the scan
    // is blind. It must see household.js, which certainly does read the column.
    const readers = sourceFiles()
      .filter((file) => !/\.test\.jsx?$/.test(file))
      .filter((file) => /weekly_minutes/.test(codeOf(readFileSync(file, 'utf8'))))
      .map((file) => file.split(/[\\/]/).pop())
    expect(readers).toContain('household.js')
    expect(readers).toContain('capacity.js')
  })
})

describe('the minutes a person can claim for a week', () => {
  it('accepts both ends of the range the constraint enforces', () => {
    expect(normalizeCapacityMinutes(MIN_CAPACITY_MINUTES)).toBe(0)
    expect(normalizeCapacityMinutes(MAX_CAPACITY_MINUTES)).toBe(10080)
  })

  it('states the bounds 0005 actually enforces, read out of the migration', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0005_weekly_capacity.sql'),
      'utf8',
    )
    const range = sql.match(/minutes >= (\d+) and minutes <= (\d+)/)
    expect(range, 'no minutes range constraint found in 0005').not.toBeNull()
    expect(Number(range[1])).toBe(MIN_CAPACITY_MINUTES)
    expect(Number(range[2])).toBe(MAX_CAPACITY_MINUTES)
  })

  it('refuses what the column would refuse, with a sentence instead', () => {
    expect(() => normalizeCapacityMinutes('')).toThrow(/how many minutes/i)
    expect(() => normalizeCapacityMinutes(-1)).toThrow(/negative/i)
    expect(() => normalizeCapacityMinutes(10081)).toThrow(/more than a week/i)
    expect(() => normalizeCapacityMinutes(4.5)).toThrow(/whole number/i)
    expect(() => normalizeCapacityMinutes('lots')).toThrow(/a number/i)
  })

  it('lists exactly the columns 0005 grants, so select(*) is never attempted', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0005_weekly_capacity.sql'),
      'utf8',
    )
    const granted = sql
      .match(/grant select \(([^)]+)\)\s*\n?\s*on public\.member_capacity/)[1]
      .split(',')
      .map((s) => s.trim())
      .sort()
    expect(CAPACITY_COLUMNS.split(',').map((s) => s.trim()).sort()).toEqual(granted)
  })
})
