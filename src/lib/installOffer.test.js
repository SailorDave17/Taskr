// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISMISSAL_MS,
  KEY,
  NON_SAFARI_IOS_MARKERS,
  clearInstallOfferMemory,
  isIosSafariTab,
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

/**
 * A window: an EventTarget with a navigator and, optionally, matchMedia.
 *
 * `userAgent` and `maxTouchPoints` are #484's axis. The default is NO user
 * agent at all, which is deliberately not an iOS one: every #483 test above
 * was written before the iOS path existed and must keep meaning what it meant
 * — a target that is not Safari-on-iOS, offering only when the event fires.
 */
function makeTarget({
  standaloneMedia = false,
  navigatorStandalone = undefined,
  matchMedia = true,
  userAgent = undefined,
  maxTouchPoints = undefined,
} = {}) {
  const target = new EventTarget()
  target.navigator = {}
  if (navigatorStandalone !== undefined) target.navigator.standalone = navigatorStandalone
  if (userAgent !== undefined) target.navigator.userAgent = userAgent
  if (maxTouchPoints !== undefined) target.navigator.maxTouchPoints = maxTouchPoints
  if (matchMedia) {
    target.matchMedia = vi.fn((query) => ({
      matches: query === '(display-mode: standalone)' ? standaloneMedia : false,
    }))
  }
  return target
}

// #484 — real user agents, copied from the devices rather than minimised, so a
// test that passes here is a test about a string a phone actually sends. The
// three iOS browsers all carry `Safari/`, which is why the allowlist cannot
// rest on that alone.
const UA = {
  // Safari 17 on iOS 17 — the ONE case the instruction is true for.
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ reports itself as a Mac and is told apart only by touch.
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  // Chrome on iOS: WebKit underneath, cannot add to the home screen.
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iosFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  // Three in-app browsers, and they do NOT all fail the same clause — which
  // the mutation pass is what found. Instagram's carries no `Safari/` at all,
  // so the allowlist refuses it before the marker list is consulted: a test
  // using only this one passes with the whole list deleted. Facebook's and
  // Google's DO carry `Safari/`, so for those the list is the only thing
  // refusing them, and they are what AC 8's second mutation reddens.
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 331.0.0.37.90 (iPhone14,2; iOS 17_5_1; en_US)',
  iosFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
  // Google's own in-app browser, the one a link in the Google app opens.
  iosGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/324.0.644653885 Mobile/15E148 Safari/604.1',
  // A real Mac: `Macintosh` with no touchscreen. The control for the iPad
  // clause, which would otherwise offer iOS instructions on a desktop.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  // An iOS browser nobody has heard of. The DEFAULT-DENY control: the
  // allowlist is what refuses this, not the marker list.
  iosUnknown:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NewBrowser/1.0 Mobile/15E148',
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

// ---------------------------------------------------------------------------
// #484 — iOS Safari: no event to capture, so the offer is the two taps.
//
// The subject splits in two, and the tests do too. `isIosSafariTab` is a pure
// question about a user agent, tested against real strings; the controller's
// iOS REASON is the same four gates as Android's reaching a different answer.
// ---------------------------------------------------------------------------

describe('#484 AC 2/AC 4 — isIosSafariTab allowlists real Safari on iOS', () => {
  it('an iPhone running Safari is the one case it accepts', () => {
    expect(isIosSafariTab(makeTarget({ userAgent: UA.iosSafari }))).toBe(true)
  })

  it('an iPad on iPadOS 13+ is accepted — it calls itself a Mac, and touch is the tell', () => {
    // Without the maxTouchPoints clause every current iPad is missed, which is
    // half the story's audience and would look like the feature simply not
    // working on tablets.
    expect(isIosSafariTab(makeTarget({ userAgent: UA.ipadSafari, maxTouchPoints: 5 }))).toBe(true)
  })

  it('a real Mac is refused — same user agent shape, no touchscreen', () => {
    // The control for the clause above. A Mac reporting `Macintosh` must not
    // be handed instructions for a Share sheet it does not have.
    expect(isIosSafariTab(makeTarget({ userAgent: UA.mac, maxTouchPoints: 0 }))).toBe(false)
    expect(isIosSafariTab(makeTarget({ userAgent: UA.ipadSafari }))).toBe(false)
  })

  it('AC 4: Chrome on iOS is refused', () => {
    expect(isIosSafariTab(makeTarget({ userAgent: UA.iosChrome }))).toBe(false)
  })

  it('AC 4: an in-app browser is refused — the three of them, on two different clauses', () => {
    // Instagram's user agent carries no `Safari/`, so the ALLOWLIST refuses it.
    expect(isIosSafariTab(makeTarget({ userAgent: UA.iosInstagram }))).toBe(false)
    // Facebook's and Google's DO carry it, so only the marker list refuses
    // those two. Both spellings are here because a test written with only the
    // first one passes with the entire marker list deleted — measured on this
    // story's mutation pass, where AC 8's second mutation reddened three tests
    // and the in-app one was not among them.
    expect(isIosSafariTab(makeTarget({ userAgent: UA.iosFacebook }))).toBe(false)
    expect(isIosSafariTab(makeTarget({ userAgent: UA.iosGoogleApp }))).toBe(false)
  })

  it('Firefox on iOS is refused too', () => {
    expect(isIosSafariTab(makeTarget({ userAgent: UA.iosFirefox }))).toBe(false)
  })

  it('the two in-app agents that look MOST like Safari satisfy every other condition', () => {
    // The reason the assertion above needs three agents rather than one: these
    // two are iOS devices carrying `Safari/`, so the allowlist lets them
    // through and the marker list is the whole of what stops them. A blocklist
    // and an allowlist are not interchangeable here, and this is where.
    for (const ua of [UA.iosFacebook, UA.iosGoogleApp]) {
      expect(ua).toContain('Safari/')
      expect(ua).toContain('iPhone')
      expect(NON_SAFARI_IOS_MARKERS.some((marker) => ua.includes(marker))).toBe(true)
    }
    // …and Instagram's is the contrast: refused without the list's help.
    expect(UA.iosInstagram).not.toContain('Safari/')
  })

  it('an iOS browser NOBODY has heard of is refused, by the allowlist rather than the list', () => {
    // The owner's decision at pickup, and the reason this is not a blocklist:
    // a browser shipped after today gets nothing rather than instructions for
    // a menu it does not have. Note it carries no marker from the list at all
    // — it is refused for lacking `Safari/`.
    const ua = UA.iosUnknown
    expect(NON_SAFARI_IOS_MARKERS.some((marker) => ua.includes(marker))).toBe(false)
    expect(isIosSafariTab(makeTarget({ userAgent: ua }))).toBe(false)
  })

  it('the marker list is CONSULTED, not just decoration', () => {
    // Chrome on iOS carries `Safari/` and an iPhone string, so it satisfies
    // both of the other two conditions: the only thing refusing it is the
    // list. Without this, deleting the list would redden nothing above except
    // through the allowlist, which does not cover this case.
    expect(UA.iosChrome).toContain('Safari/')
    expect(UA.iosChrome).toContain('iPhone')
    expect(NON_SAFARI_IOS_MARKERS.some((marker) => UA.iosChrome.includes(marker))).toBe(true)
  })

  it('Android and a desktop are not iOS Safari', () => {
    expect(isIosSafariTab(makeTarget({ userAgent: UA.android }))).toBe(false)
  })

  it('no user agent, or a navigator that throws, is not iOS Safari', () => {
    expect(isIosSafariTab(makeTarget())).toBe(false)
    expect(isIosSafariTab({})).toBe(false)
    const hostile = {
      get navigator() {
        throw new Error('blocked')
      },
    }
    expect(isIosSafariTab(hostile)).toBe(false)
  })
})

describe('#484 AC 2 — the iOS line is offered with no event at all', () => {
  it('Safari on iOS is offered immediately, before anything fires', () => {
    // The whole difference from #483: there is no event coming, so the answer
    // has to be taken at start. A controller that waited would never show.
    const target = makeTarget({ userAgent: UA.iosSafari })
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(true)
    expect(offer.reason()).toBe('ios')
    offer.stop()
  })

  it('Android is unchanged: nothing is offered until the browser fires, and the reason is the prompt', () => {
    const target = makeTarget({ userAgent: UA.android })
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(false)
    expect(offer.reason()).toBeNull()
    fire(target)
    expect(offer.reason()).toBe('prompt')
    offer.stop()
  })

  it('AC 4: Chrome on iOS and an in-app browser are offered NOTHING, and write nothing', () => {
    for (const userAgent of [
      UA.iosChrome,
      UA.iosFirefox,
      UA.iosInstagram,
      UA.iosFacebook,
      UA.iosGoogleApp,
      UA.iosUnknown,
    ]) {
      localStorage.clear()
      const target = makeTarget({ userAgent })
      const offer = startInstallOffer({ target, now })
      expect(offer.isOffered()).toBe(false)
      expect(offer.reason()).toBeNull()
      expect(localStorage.length).toBe(0)
      offer.stop()
    }
  })
})

describe('#484 AC 3 — launched from the home screen, the iOS line never appears', () => {
  it('navigator.standalone true on iOS Safari → never offered', () => {
    // The gate #483 built, reached by the path #484 added. `navigator.standalone`
    // is Safari's only signal that it is the home-screen app.
    const target = makeTarget({ userAgent: UA.iosSafari, navigatorStandalone: true })
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(false)
    expect(offer.reason()).toBeNull()
    offer.stop()
  })

  it('display-mode: standalone also suppresses it, on the iOS path too', () => {
    // Recent iOS reads the manifest's display mode, so both signals can be
    // true there. Either one is enough.
    const target = makeTarget({ userAgent: UA.iosSafari, standaloneMedia: true })
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(false)
    offer.stop()
  })
})

describe('#484 — the iOS line shares #483’s dismissal, one key and not two', () => {
  it('Not now on iOS holds for 30 days and is the same key', () => {
    const target = makeTarget({ userAgent: UA.iosSafari })
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(true)
    offer.dismiss()
    expect(offer.isOffered()).toBe(false)
    expect(offer.reason()).toBeNull()
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ dismissedAt: T0 }))
    offer.stop()

    // A fresh page inside the window still sees it…
    clock = T0 + 29 * DAY
    const later = startInstallOffer({ target: makeTarget({ userAgent: UA.iosSafari }), now })
    expect(later.isOffered()).toBe(false)
    later.stop()

    // …and past 30 days it is offered again.
    clock = T0 + DISMISSAL_MS + 1
    const expired = startInstallOffer({ target: makeTarget({ userAgent: UA.iosSafari }), now })
    expect(expired.isOffered()).toBe(true)
    expect(expired.reason()).toBe('ios')
    expired.stop()
  })

  it('a dismissal made on Android suppresses the iOS line, because the key is shared', () => {
    // Not a case anybody hits — one device is one platform — but it is the
    // claim "one key, not two" resting on something a test can see.
    rememberInstallOfferDismissed({ now: clock })
    const offer = startInstallOffer({ target: makeTarget({ userAgent: UA.iosSafari }), now })
    expect(offer.isOffered()).toBe(false)
    offer.stop()
  })

  it('a remembered install suppresses the iOS line with no expiry', () => {
    localStorage.setItem(KEY, JSON.stringify({ installedAt: T0 }))
    clock = T0 + 400 * DAY
    const offer = startInstallOffer({ target: makeTarget({ userAgent: UA.iosSafari }), now })
    expect(offer.isOffered()).toBe(false)
    offer.stop()
  })

  it('install() on the iOS path does nothing and writes nothing — there is no event to prompt', async () => {
    // The line renders no Install button, so nothing reaches this. It is
    // asserted anyway because `install` is on the shared controller and a
    // caller could reach it: the honest answer is a no-op, not a throw.
    const target = makeTarget({ userAgent: UA.iosSafari })
    const offer = startInstallOffer({ target, now })
    expect(offer.isOffered()).toBe(true)
    await offer.install()
    expect(offer.isOffered()).toBe(true)
    expect(offer.reason()).toBe('ios')
    expect(localStorage.length).toBe(0)
    offer.stop()
  })

  it('tells a subscriber when the iOS dismissal changes the answer', () => {
    const target = makeTarget({ userAgent: UA.iosSafari })
    const offer = startInstallOffer({ target, now })
    const listener = vi.fn()
    offer.subscribe(listener)
    offer.dismiss()
    expect(listener).toHaveBeenCalledTimes(1)
    offer.stop()
  })

  it('an event captured on an iOS-shaped target takes the prompt reason — the platform grew one', () => {
    // Cannot happen on iOS today. Asserted because the precedence is a real
    // decision in `refresh()`: a prompt beats instructions, so if Safari ever
    // fires the event the line stops telling people to use a menu.
    const target = makeTarget({ userAgent: UA.iosSafari })
    const offer = startInstallOffer({ target, now })
    expect(offer.reason()).toBe('ios')
    fire(target)
    expect(offer.reason()).toBe('prompt')
    offer.stop()
  })
})
