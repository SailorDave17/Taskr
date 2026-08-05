import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { JOIN_CODE_LENGTH, isPlausibleJoinCode, normalizeJoinCode } from './joinCode.js'

const MIGRATION = resolve(
  import.meta.dirname,
  '../../supabase/migrations/0001_household_and_roster.sql',
)

describe('normalizeJoinCode', () => {
  // Expected values are written out rather than computed from the function under
  // test. A tidy `input.toUpperCase().replace(...)` here would compare the
  // implementation against itself and pass whatever either of them said.
  it.each([
    ['ab3d ef7h', 'AB3DEF7H'],
    ['AB3D-EF7H', 'AB3DEF7H'],
    ['  ab3def7h  ', 'AB3DEF7H'],
    ['AB3D.EF7H', 'AB3DEF7H'],
    ['AB3DEF7H', 'AB3DEF7H'],
  ])('normalizes %o to %o', (input, expected) => {
    expect(normalizeJoinCode(input)).toBe(expected)
  })

  it.each([[null], [undefined], [42], [{}], [[]]])(
    'returns an empty string for the non-string %o rather than throwing at the keyboard',
    (input) => {
      expect(normalizeJoinCode(input)).toBe('')
    },
  )
})

describe('isPlausibleJoinCode', () => {
  it('accepts a full-length code however it was typed', () => {
    expect(isPlausibleJoinCode('ab3d-ef7h')).toBe(true)
  })

  it.each([
    ['AB3DEF7', 'one short'],
    ['AB3DEF7HJ', 'one long'],
    ['', 'empty'],
    ['---- ----', 'punctuation only'],
  ])('rejects %o (%s)', (input) => {
    expect(isPlausibleJoinCode(input)).toBe(false)
  })

  it('does not judge the alphabet — that rule has one owner, and it is the database', () => {
    // '0', 'O', 'I' and 'U' are all excluded by the migration's check constraint.
    // The client must still consider this worth sending, or the two copies of the
    // alphabet this file exists to prevent would be back.
    expect(isPlausibleJoinCode('OOIIUU00')).toBe(true)
  })
})

describe('agreement with the migration', () => {
  // The guard that makes the duplication above safe. If someone widens the code
  // to 10 characters in SQL, this reddens instead of a family being told their
  // valid code is too short.
  it('JOIN_CODE_LENGTH matches the length quantifier in the check constraint', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const match = sql.match(/join_code ~ '\^\[[^\]]+\]\{(\d+)\}\$'/)
    expect(match, 'could not find the join_code check constraint in the migration').not.toBeNull()
    expect(Number(match[1])).toBe(JOIN_CODE_LENGTH)
  })

  it('the migration excludes the characters that are misread aloud', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const alphabet = sql.match(/join_code ~ '\^\[([^\]]+)\]/)[1]
    for (const excluded of ['0', '1', 'I', 'L', 'O', 'U']) {
      expect(alphabet, `${excluded} should not be in the join-code alphabet`).not.toContain(excluded)
    }
  })
})
