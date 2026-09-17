// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISMISSAL_MS,
  KEY,
  clearInstallOfferMemory,
  isRunningInstalled,
  readInstallOfferMemory,
  rememberInstallOfferDismissed,
  startInstallOffer,
} from './installOffer.js'

// #483 — the offer to install Taskr: captured, gated, dismissable, remembered.
//
// jsdom because the SUBJECT includes `localStorage`, and because a window-
// shaped EventTarget is where `beforeinstallprompt` arrives. The browser's
// event is faked — Chrome's `BeforeInstallPromptEvent` exists in no test
// environment — as a cancelable Event carrying `prompt()`, which is the whole
// of what the controller touches.

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_760_000_000_000

/** A window: an EventTarget with a navigator and, optionally, matchMedia. */
function makeTarget({ standaloneMedia = false, navigatorStandalone = undefined, matchMedia = true } = {}) {
  const target = new EventTarget()
  target.navigator = {}
  if (navigatorStandalone !== undefined) target.navigator.standalone = navigatorStandalone
  if (matchMedia) {
    target.matchMedia = vi.fn((query) => ({
      matches: query === '(display-mode: standalone)' ? standaloneMedia : false,
    }))
  }
  return target
}

/** Chrome's event, as far as the controller reads it. */
function makeInstallEvent({ outcome = 'accepted' } = {}) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = vi.fn(async () => ({ outcome }))
  return event
}

function fire(target, event = makeInstallEvent()) {
  target.dispatchEvent(event)
  return event
}

let clock
const now = () => clock

beforeEach(() => {
  clock = T0
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('#483 AC 1 — the browser fires the event, and the line is offered', () => {
  it('is not offered until the browser fires', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(false)
    fire(target)
    expect(offer.isOffered()).toBe(true)
    offer.stop()
  })

  it("prevents the browser's own default, so the line is the one offer on screen", () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const event = fire(target)
    expect(event.defaultPrevented).toBe(true)
    offer.stop()
  })

  it('Install calls the captured event’s prompt() — at most once — and hides the line', async () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const event = fire(target)
    await offer.install()
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(offer.isOffered()).toBe(false)
    // A second tap prompts nothing more…
    await offer.install()
    expect(event.prompt).toHaveBeenCalledTimes(1)
    // …and neither does the event Chrome re-fires after a dismissed sheet. It
    // is a NEW event with its own prompt(), so the assertion is on that one:
    // the first draft counted only the first event's and passed with the hide
    // removed (mutation pass, 2026-09-16).
    const again = fire(target)
    expect(offer.isOffered()).toBe(false)
    await offer.install()
    expect(again.prompt).not.toHaveBeenCalled()
    offer.stop()
  })

  it('prompt() runs inside the tap itself, before anything is awaited', () => {
    // Chrome refuses a prompt() outside a user gesture. The call must happen
    // synchronously in `install()`, not after a microtask.
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const event = fire(target)
    void offer.install()
    expect(event.prompt).toHaveBeenCalledTimes(1)
    offer.stop()
  })

  it('hides the line whatever the person chose at the browser’s sheet, and remembers the choice', async () => {
    for (const outcome of ['accepted', 'dismissed']) {
      localStorage.clear()
      const target = makeTarget()
      const offer = startInstallOffer({ target, now })
      fire(target, makeInstallEvent({ outcome }))
      await offer.install()
      expect(offer.isOffered()).toBe(false)
      expect(readInstallOfferMemory({ now: clock })).toBe(outcome === 'accepted' ? 'installed' : 'dismissed')
      offer.stop()
    }
  })

  it('reads the outcome from userChoice when prompt() resolves with nothing (older Chrome)', async () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = vi.fn(async () => undefined)
    event.userChoice = Promise.resolve({ outcome: 'dismissed' })
    fire(target, event)
    await offer.install()
    expect(readInstallOfferMemory({ now: clock })).toBe('dismissed')
    offer.stop()
  })

  it('a prompt() that rejects still hides the line and writes nothing', async () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = vi.fn(async () => {
      throw new Error('not in a user gesture')
    })
    fire(target, event)
    await expect(offer.install()).resolves.toBeUndefined()
    expect(offer.isOffered()).toBe(false)
    expect(localStorage.length).toBe(0)
    offer.stop()
  })

  it('tells a subscriber each time the answer changes, and stops on unsubscribe', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const listener = vi.fn()
    const unsubscribe = offer.subscribe(listener)
    fire(target)
    expect(listener).toHaveBeenCalledTimes(1)
    offer.dismiss()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    fire(target)
    expect(listener).toHaveBeenCalledTimes(2)
    offer.stop()
  })
})

describe('#483 AC 2 — running installed, the offer never appears', () => {
  it('display-mode: standalone matches → not offered, even though the browser fired', () => {
    const target = makeTarget({ standaloneMedia: true })
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(false)
    expect(target.matchMedia).toHaveBeenCalledWith('(display-mode: standalone)')
    offer.stop()
  })

  it('navigator.standalone is true → not offered, even though the browser fired', () => {
    const target = makeTarget({ navigatorStandalone: true })
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(false)
    offer.stop()
  })

  it('navigator.standalone false in a browser tab is not "installed"', () => {
    // Safari's own value in a tab (#484 will read it); a browser tab is a tab.
    expect(isRunningInstalled(makeTarget({ navigatorStandalone: false }))).toBe(false)
  })

  it('a window with no matchMedia at all (jsdom) is a browser tab, not a crash', () => {
    const target = makeTarget({ matchMedia: false })
    expect(isRunningInstalled(target)).toBe(false)
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(true)
    offer.stop()
  })

  it('a matchMedia that throws is answered "not installed" rather than propagated', () => {
    const target = makeTarget()
    target.matchMedia = () => {
      throw new TypeError('not a valid media query')
    }
    expect(isRunningInstalled(target)).toBe(false)
  })
})

describe('#483 AC 3 — appinstalled while the app is open in the browser', () => {
  it('hides the offer, and a later page on this browser is not offered again', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(true)
    target.dispatchEvent(new Event('appinstalled'))
    expect(offer.isOffered()).toBe(false)
    expect(readInstallOfferMemory({ now: clock })).toBe('installed')
    offer.stop()

    // The next load, a year on, still nothing: an install has no expiry.
    clock = T0 + 365 * DAY
    const later = makeTarget()
    const next = startInstallOffer({ target: later, now })
    fire(later)
    expect(next.isOffered()).toBe(false)
    next.stop()
  })

  it('is remembered even when the install came from the browser’s own menu (no event captured)', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    target.dispatchEvent(new Event('appinstalled'))
    expect(readInstallOfferMemory({ now: clock })).toBe('installed')
    offer.stop()
  })
})

describe('#483 AC 4 — Not now', () => {
  it('hides the line for the session, under the one key, holding the dismissal time', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    offer.dismiss()
    expect(offer.isOffered()).toBe(false)
    expect(Object.keys(localStorage)).toEqual([KEY])
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ dismissedAt: T0 })
    // The browser firing again on the same page changes nothing.
    fire(target)
    expect(offer.isOffered()).toBe(false)
    offer.stop()
  })

  it('HIDDEN: a page 29 days later is not offered', () => {
    rememberInstallOfferDismissed({ now: T0 })
    clock = T0 + 29 * DAY
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(false)
    expect(readInstallOfferMemory({ now: clock })).toBe('dismissed')
    offer.stop()
  })

  it('EXPIRED: a page 31 days later is offered again, and the stale value is gone', () => {
    rememberInstallOfferDismissed({ now: T0 })
    clock = T0 + 31 * DAY
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
    offer.stop()
  })

  it('the boundary is DISMISSAL_MS exactly: one ms short is hidden, DISMISSAL_MS is expired', () => {
    rememberInstallOfferDismissed({ now: T0 })
    expect(readInstallOfferMemory({ now: T0 + DISMISSAL_MS - 1 })).toBe('dismissed')
    rememberInstallOfferDismissed({ now: T0 })
    expect(readInstallOfferMemory({ now: T0 + DISMISSAL_MS })).toBeNull()
  })

  // Every input that has to fail the shape check: a truncated write, a
  // different app colliding on the key, a hand-edited value, a timestamp that
  // is not one, and a value carrying more than it should.
  it.each([
    ['not json'],
    [''],
    ['null'],
    ['[]'],
    ['42'],
    ['{}'],
    ['{"dismissedAt":"yesterday"}'],
    ['{"dismissedAt":null}'],
    ['{"dismissedAt":-1}'],
    ['{"dismissedAt":1e999}'],
    ['{"dismissedAt":1,"installedAt":1}'],
    // A RECENT timestamp under the wrong key, deliberately. The first draft
    // used `1`, and the mutation pass showed the row passing with the key
    // check removed: a timestamp that old reads as an expired dismissal and is
    // discarded on that ground, so the row never reached the check it names.
    [`{"somethingElse":${T0}}`],
    ['{"dismissedAt":'],
  ])('CORRUPT: %j is treated as no dismissal, and discarded', (value) => {
    localStorage.setItem(KEY, value)
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(true)
    // Including `''`: the read guards only an ABSENT value, so an empty string
    // reaches the shape check and is discarded like the rest. (The first draft
    // guarded `!stored` and left the empty string sitting there — this row
    // reddened, which is what it is for.)
    expect(localStorage.getItem(KEY)).toBeNull()
    offer.stop()
  })
})

describe('#483 AC 5 — a browser that never fires the event', () => {
  it('shows nothing and writes nothing', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(false)
    // The taps a person cannot make, made anyway: still nothing written.
    void offer.install()
    expect(offer.isOffered()).toBe(false)
    expect(localStorage.length).toBe(0)
    offer.stop()
    expect(localStorage.length).toBe(0)
  })

  it('stop() detaches, so a later event reaches nothing', () => {
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    const listener = vi.fn()
    offer.subscribe(listener)
    offer.stop()
    fire(target)
    expect(offer.isOffered()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('#483 — a browser that offers no storage', () => {
  // The accessor form, as `activeHousehold.test.js` measured it: a Proxy's
  // `get` trap does not fire on `globalThis.localStorage` itself.
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

  it('still offers, and a dismissal does not throw, when the ACCESSOR throws', () => {
    const restore = withThrowingAccessor()
    try {
      const target = makeTarget()
      const offer = startInstallOffer({ target, now })
      fire(target)
      expect(offer.isOffered()).toBe(true)
      expect(() => offer.dismiss()).not.toThrow()
      expect(offer.isOffered()).toBe(false)
      expect(() => clearInstallOfferMemory()).not.toThrow()
      offer.stop()
    } finally {
      restore()
    }
  })

  it('still offers when the store is there and every METHOD refuses', () => {
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
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(offer.isOffered()).toBe(true)
    expect(() => offer.dismiss()).not.toThrow()
    expect(readInstallOfferMemory({ now: clock })).toBeNull()
    offer.stop()
  })

  it('reads no memory when the object is absent altogether', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readInstallOfferMemory({ now: clock })).toBeNull()
    expect(() => rememberInstallOfferDismissed({ now: clock })).not.toThrow()
  })

  it('swallows a write refused for quota, having read the store successfully', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError')
      },
    })
    const target = makeTarget()
    const offer = startInstallOffer({ target, now })
    fire(target)
    expect(() => offer.dismiss()).not.toThrow()
    expect(offer.isOffered()).toBe(false)
    offer.stop()
  })
})
