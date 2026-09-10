// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearActiveHouseholdChoice,
  readActiveHouseholdChoice,
  writeActiveHouseholdChoice,
} from './activeHousehold.js'

// #165 — the one preference this app keeps on the device, and every way it can
// fail to keep it. Names are synthetic — see #19.
//
// jsdom rather than the default environment, because the SUBJECT is
// `localStorage`: there is nothing here to test without one.

const H1 = '11111111-1111-4111-8111-111111111111'
const H2 = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('#165 — remembering a choice', () => {
  it('is null when this device has never chosen', () => {
    expect(readActiveHouseholdChoice()).toBeNull()
  })

  it('reads back the household that was chosen', () => {
    writeActiveHouseholdChoice(H1)
    expect(readActiveHouseholdChoice()).toBe(H1)
  })

  it('replaces the previous choice rather than accumulating', () => {
    writeActiveHouseholdChoice(H1)
    writeActiveHouseholdChoice(H2)
    expect(readActiveHouseholdChoice()).toBe(H2)
    // One key, so a device that has switched ten times holds one value.
    expect(localStorage.length).toBe(1)
  })

  // AC 7 — the household id must not outlive the session that chose it.
  it('forgets the choice when it is cleared', () => {
    writeActiveHouseholdChoice(H1)
    clearActiveHouseholdChoice()
    expect(readActiveHouseholdChoice()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  // The key names the CHOICE, not the household — and it is deliberately not
  // either of the two names App.test.jsx asserts absent. Pinned here because
  // "pick a key that does not collide" is the cheap way to make that test green
  // while its subject moves underneath it, which is what #165 AC 4 forbids.
  it('stores the choice under a key that is neither the household nor the roster', () => {
    writeActiveHouseholdChoice(H1)
    const [key] = Object.keys(localStorage)
    expect(key).toBe('taskr.activeHousehold')
    expect(localStorage.getItem('taskr.household')).toBeNull()
    expect(localStorage.getItem('taskr.members')).toBeNull()
  })
})

describe('#165 AC 3 — a stored value that is not a household id', () => {
  // The shape check, and every input that has to fail it. `not-a-uuid` is the
  // criterion's own case; the others are what a truncated write, a colliding
  // key and a hand-edited devtools value actually look like.
  // MEASURED: the `''` row is discharged by the `if (!stored) return null`
  // guard ABOVE the shape check, not by the shape check — it stayed green when
  // the uuid pattern was mutated to accept everything, where the other five
  // reddened. It is kept because an empty stored value is a real state worth
  // covering, and labelled because a row that cannot fail for the reason its
  // block claims is the thing a reader would otherwise count as coverage.
  it.each([
    ['not-a-uuid'],
    [''],
    ['h1'],
    ['11111111-1111-4111-8111'],
    ['11111111-1111-4111-8111-111111111111-extra'],
    ['{"id":"11111111-1111-4111-8111-111111111111"}'],
  ])('discards %j and reports no choice', (junk) => {
    localStorage.setItem('taskr.activeHousehold', junk)
    expect(readActiveHouseholdChoice()).toBeNull()
  })

  // DISCARDED, not merely ignored — otherwise a junk value sits there being
  // re-rejected on every load for the life of the device.
  it('removes the junk as it reads it, so it is gone next time', () => {
    localStorage.setItem('taskr.activeHousehold', 'not-a-uuid')
    readActiveHouseholdChoice()
    expect(localStorage.getItem('taskr.activeHousehold')).toBeNull()
  })

  it('refuses to WRITE a value that is not a household id', () => {
    writeActiveHouseholdChoice('not-a-uuid')
    writeActiveHouseholdChoice(null)
    writeActiveHouseholdChoice(undefined)
    expect(localStorage.length).toBe(0)
  })

  it('accepts a uuid in either case, because Postgres returns lower and a hand copy may not', () => {
    writeActiveHouseholdChoice(H1.toUpperCase())
    expect(readActiveHouseholdChoice()).toBe(H1.toUpperCase())
  })
})

describe('#165 AC 8 — a device that offers no storage', () => {
  /**
   * A browser set to block site data throws when the PROPERTY is read —
   * `globalThis.localStorage` itself raises, before any method is called. This
   * installs a getter that does exactly that.
   *
   * MEASURED, and the measurement is why this helper exists in this shape. The
   * first version used `vi.stubGlobal('localStorage', new Proxy({}, { get() {
   * throw } }))`, which reads like the same thing and is not: a Proxy's `get`
   * trap fires on access to a property OF the proxy, so `globalThis.localStorage`
   * handed the object back without throwing and only `store.getItem(...)` raised
   * — which is a different guard, in a different function. Removing the module's
   * accessor try/catch entirely reddened **0 of a predicted 4** under that
   * fixture: the branch it was written for was never once executed. The
   * `defineProperty` form below reddens it.
   */
  const withThrowingAccessor = () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    return () => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete globalThis.localStorage
    }
  }

  /** The other half: the property reads fine and every METHOD refuses. */
  const withThrowingMethods = () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      setItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      removeItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  }

  it('reports no choice rather than throwing, when the ACCESSOR itself throws', () => {
    const restore = withThrowingAccessor()
    try {
      expect(() => readActiveHouseholdChoice()).not.toThrow()
      expect(readActiveHouseholdChoice()).toBeNull()
    } finally {
      restore()
    }
  })

  it('swallows a write refused at the accessor, so a switch the person made still happens', () => {
    const restore = withThrowingAccessor()
    try {
      expect(() => writeActiveHouseholdChoice(H1)).not.toThrow()
    } finally {
      restore()
    }
  })

  it('swallows a clear refused at the accessor, so signing out still completes', () => {
    const restore = withThrowingAccessor()
    try {
      expect(() => clearActiveHouseholdChoice()).not.toThrow()
    } finally {
      restore()
    }
  })

  it('reports no choice when the store is there and every METHOD refuses', () => {
    withThrowingMethods()
    expect(() => readActiveHouseholdChoice()).not.toThrow()
    expect(readActiveHouseholdChoice()).toBeNull()
    expect(() => writeActiveHouseholdChoice(H1)).not.toThrow()
    expect(() => clearActiveHouseholdChoice()).not.toThrow()
  })

  it('reports no choice when the object is absent altogether', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readActiveHouseholdChoice()).toBeNull()
    expect(() => writeActiveHouseholdChoice(H1)).not.toThrow()
    expect(() => clearActiveHouseholdChoice()).not.toThrow()
  })

  // A quota failure is the one where storage EXISTS and the write is refused,
  // which is a different branch from the accessor throwing.
  it('swallows a write refused for quota, having read the store successfully', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError')
      },
    })
    expect(() => writeActiveHouseholdChoice(H1)).not.toThrow()
    expect(readActiveHouseholdChoice()).toBeNull()
  })
})
