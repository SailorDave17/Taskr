import { describe, expect, it } from 'vitest'
import { firstNameOf } from './shopping.js'

// The shopping data layer's PURE half — story #353 opens the file with the one
// helper the Shop tab needs; #355's `orderShoppingItems` lands beside it. The
// impure half (what the module sends, and with what) is shopping.io.test.js.

describe('firstNameOf', () => {
  it('takes the first word of a display name', () => {
    expect(firstNameOf('Placeholder One')).toBe('Placeholder')
    expect(firstNameOf('Robin')).toBe('Robin')
  })

  it('trims, and collapses the whitespace a person typed', () => {
    expect(firstNameOf('  Placeholder   One ')).toBe('Placeholder')
  })

  it('returns null for nothing, so a caller can leave the line out rather than print "added by"', () => {
    for (const bad of ['', '   ', null, undefined]) expect(firstNameOf(bad)).toBeNull()
  })
})
