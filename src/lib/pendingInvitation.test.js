// The held invitation — story #173, AC 4 and AC 5.
//
// What this file can answer: that a code and the chosen name survive a write
// and a read on this device in the normalised form they will be sent in, that
// nothing is stored for a blank or impossible value, that junk is discarded on
// read, and that a browser refusing storage degrades to "nothing held" rather
// than a throw. What it cannot answer is WHEN the invitation is applied — that
// is App's, and `App.test.jsx` asserts both halves of the per-browser
// guarantee.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingInvitation,
  normalizePendingName,
  readPendingInvitation,
  writePendingInvitation,
} from './pendingInvitation.js'

const KEY = 'taskr.pendingInvitation'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('#173 — holding an invitation on this device', () => {
  it('reads back what was written', () => {
    expect(writePendingInvitation({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })).toBe(true)
    expect(readPendingInvitation()).toEqual({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })
  })

  it('stores the NORMALISED code — lowered, and trimmed of the four characters the server trims', () => {
    // The line ending a paste carries never reaches storage, so what comes
    // back is exactly what `redeemInvitation` will send.
    expect(writePendingInvitation({ code: '  K7M3QP4RWN\r\n', name: 'Placeholder Three' })).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(KEY))).toEqual({
      code: 'k7m3qp4rwn',
      name: 'Placeholder Three',
    })
  })

  it('stores the name trimmed', () => {
    expect(writePendingInvitation({ code: 'k7m3qp4rwn', name: '  Placeholder Three  ' })).toBe(true)
    expect(readPendingInvitation().name).toBe('Placeholder Three')
  })

  it('stores nothing for a blank code, and says so', () => {
    expect(writePendingInvitation({ code: '   \n', name: 'Placeholder Three' })).toBe(false)
    expect(writePendingInvitation({ code: null, name: 'Placeholder Three' })).toBe(false)
    expect(window.localStorage.length).toBe(0)
    expect(readPendingInvitation()).toBeNull()
  })

  it('stores nothing for a blank name — the row would be born a placeholder', () => {
    expect(writePendingInvitation({ code: 'k7m3qp4rwn', name: '   ' })).toBe(false)
    expect(writePendingInvitation({ code: 'k7m3qp4rwn' })).toBe(false)
    expect(window.localStorage.length).toBe(0)
  })

  it('stores nothing for a value no code or name could be', () => {
    // Built rather than written as a literal, so the #19 name-position scan
    // reads no person's name here.
    const tooLong = 'n'.repeat(41)
    expect(writePendingInvitation({ code: 'x'.repeat(65), name: 'Placeholder Three' })).toBe(false)
    expect(writePendingInvitation({ code: 'k7m3qp4rwn', name: tooLong })).toBe(false)
    expect(window.localStorage.length).toBe(0)
  })

  it('reads null and clears the key when what is stored could not be a held invitation', () => {
    // A colliding key, a devtools edit, or the pre-name shape: discarded as it
    // is read, so it cannot sit there being re-rejected on every boot.
    for (const junk of ['k7m3qp4rwn', '{"code":"k7m3qp4rwn"}', '{"name":"Placeholder Three"}', 'not json', JSON.stringify({ code: 'y'.repeat(65), name: 'Placeholder Three' })]) {
      window.localStorage.setItem(KEY, junk)
      expect(readPendingInvitation(), junk).toBeNull()
      expect(window.localStorage.getItem(KEY), junk).toBeNull()
    }
  })

  it('reads null once cleared', () => {
    writePendingInvitation({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })
    clearPendingInvitation()
    expect(readPendingInvitation()).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('holds exactly one key, and never the household or the roster', () => {
    // `App.test.jsx`'s "reads the household from the server on every load"
    // asserts `taskr.household` and `taskr.members` absent; this must not be
    // either of them, and must not be a second key.
    writePendingInvitation({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })
    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.key(0)).toBe(KEY)
  })

  it('bounds the name at the roster’s own forty characters', () => {
    expect(normalizePendingName(' Placeholder Three ')).toBe('Placeholder Three')
    expect(normalizePendingName('n'.repeat(40))).toHaveLength(40)
    expect(normalizePendingName('n'.repeat(41))).toBe('')
    expect(normalizePendingName(null)).toBe('')
  })
})

describe('#173 — a browser that refuses storage', () => {
  // The accessor itself throws in a browser set to block site data (#165 AC 8
  // measured it), so the failure has to be reproduced on the GETTER.
  //
  // SEEDED FIRST, then blocked — review finding: with an empty store the read
  // and clear cases were green whether or not the accessor threw, because an
  // un-overridden `getItem` of nothing is null and `removeItem` of nothing
  // cannot throw. A value written BEFORE the block is what makes "reads null"
  // and "clears nothing" say the guard ran.
  let descriptor
  const SEEDED = JSON.stringify({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })

  const block = () => {
    descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
  }
  const unblock = () => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    descriptor = null
  }

  beforeEach(() => {
    window.localStorage.setItem(KEY, SEEDED)
    block()
  })

  afterEach(() => {
    unblock()
  })

  it('cannot hold an invitation, and says so rather than throwing', () => {
    expect(writePendingInvitation({ code: 'k7m3qp4rwn', name: 'Housemate' })).toBe(false)
    unblock()
    // Nothing was written over the seeded value.
    expect(window.localStorage.getItem(KEY)).toBe(SEEDED)
  })

  it('reads nothing rather than throwing, even though a value is stored', () => {
    expect(readPendingInvitation()).toBeNull()
    unblock()
    // POSITIVE CONTROL: the value IS there once the accessor works again.
    expect(readPendingInvitation()).toEqual({ code: 'k7m3qp4rwn', name: 'Placeholder Three' })
  })

  it('clears without throwing, and could not reach the value to clear it', () => {
    expect(() => clearPendingInvitation()).not.toThrow()
    unblock()
    expect(window.localStorage.getItem(KEY)).toBe(SEEDED)
  })
})
