/**
 * The offer to install Taskr — stories #483 (Android Chrome) and #484 (iOS
 * Safari).
 *
 * `vite-plugin-pwa` has shipped an installable manifest since #4, and until
 * this story nothing in the app said so: installing was whatever the browser
 * volunteered, and the person had to know to look in a menu. The browser
 * already owns the install sheet, so the app's only job is to say the option
 * exists — one line, once — and then get out of the way.
 *
 * THREE DECISIONS, each from the owner's sentence (2026-09-16: "have an option
 * to install app, but make it be easily dismissable. Also make sure it does
 * not ask them to install if it is already installed"):
 *
 *   - "Already installed" is a HARD GATE, not something inferred from the
 *     event not firing. Chrome can fire `beforeinstallprompt` in odd states,
 *     and this is the one case the owner named explicitly, so the line checks
 *     `display-mode: standalone` and `navigator.standalone` itself (AC 2).
 *   - "Not now" MEANS IT: a dismissal is remembered on this browser for
 *     `DISMISSAL_MS` (30 days), under one `localStorage` key, every access in
 *     try/catch, and a corrupt value read as no dismissal (AC 4). The same key
 *     will carry #484's iOS dismissal — one key, not two.
 *   - The offer is captured OUTSIDE React (`src/main.jsx`), for the reason the
 *     updater is: `beforeinstallprompt` fires whenever the browser decides the
 *     criteria are met, which can be before App's dynamic import has resolved
 *     and attached anything. A listener inside a component would miss an
 *     event that fired before it mounted, and the offer would silently never
 *     show. The controller lives for the life of the page; App reads it
 *     through `useSyncExternalStore` and survives its own remounts (#440).
 *
 * #484 WIDENED THE TARGET to iOS Safari (`vite.config.js` records the decision).
 * Safari fires no event and no page can open its Share sheet, so there is
 * nothing to capture and nothing to prompt: the offer there is the two taps,
 * written out, with the same dismissal. That is a different KIND of offer
 * rather than a second copy of this one, which is why `reason()` exists — and
 * why the gates it passes through are the same four. A browser that neither
 * fires the event nor is Safari-on-iOS writes nothing (#483 AC 5, #484 AC 4).
 *
 * STATED LIMIT: `appinstalled` is remembered without an expiry, because
 * "not shown again on that browser" is what AC 3 asks. A person who installs
 * and later uninstalls on the same browser profile is not offered again; the
 * settings entry the issue leaves out of scope would be the route back.
 */

/**
 * The key. One key for the whole install offer — a dismissal and an install
 * both land here — so #484 (iOS) shares it rather than adding a second.
 * Deliberately not `taskr.household` or `taskr.members`, which App.test.jsx
 * asserts absent (see `activeHousehold.js` for why that matters).
 */
export const KEY = 'taskr.installOffer'

/** How long "Not now" holds — 30 days (AC 4). One named constant. */
export const DISMISSAL_MS = 30 * 24 * 60 * 60 * 1000

/** The storage this browser offers, or null where it offers none. */
function storage() {
  try {
    // The ACCESSOR is what throws in a browser configured to block site data,
    // so it is inside the try rather than beside it (#165 AC 8).
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The stored value, or null for anything that is not one. Exactly two shapes
 * are stored — `{"dismissedAt":<ms>}` and `{"installedAt":<ms>}` — and only
 * a finite, non-negative timestamp under exactly one of those keys is read
 * back. A truncated write, a hand-edited devtools value, or a different app's
 * key colliding all fail this and are discarded by the caller.
 */
function parseMemory(stored) {
  let parsed
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const keys = Object.keys(parsed)
  if (keys.length !== 1) return null
  const [kind] = keys
  if (kind !== 'dismissedAt' && kind !== 'installedAt') return null
  const at = parsed[kind]
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null
  return { kind, at }
}

/**
 * What this browser remembers about the offer: `'installed'`, `'dismissed'`
 * (within the last `DISMISSAL_MS`), or null.
 *
 * Null covers every failure identically and on purpose: nothing stored,
 * storage unavailable, a corrupt value, and an expired dismissal all mean
 * "nothing stops the offer", which is the only answer the caller acts on. A
 * value that fails the shape check, or a dismissal that has expired, is
 * DISCARDED as it is read, so junk cannot sit there being re-rejected on
 * every load.
 */
export function readInstallOfferMemory({ now = Date.now() } = {}) {
  const store = storage()
  if (!store) return null
  let stored = null
  try {
    stored = store.getItem(KEY)
  } catch {
    return null
  }
  if (stored === null || stored === undefined) return null
  const memory = parseMemory(stored)
  if (!memory) {
    clearInstallOfferMemory()
    return null
  }
  if (memory.kind === 'installedAt') return 'installed'
  if (now - memory.at < DISMISSAL_MS) return 'dismissed'
  clearInstallOfferMemory()
  return null
}

function write(value) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(value))
  } catch {
    // A full or refused quota is not a reason to fail the tap the person just
    // made. The line goes away now; the next load may offer again.
  }
}

/** Remember a "Not now" — the offer stays away for `DISMISSAL_MS` (AC 4). */
export function rememberInstallOfferDismissed({ now = Date.now() } = {}) {
  write({ dismissedAt: now })
}

/** Remember that the app was installed from this browser (AC 3). */
export function rememberInstallOfferInstalled({ now = Date.now() } = {}) {
  write({ installedAt: now })
}

/** Forget both. Nothing in the app calls this today; the tests and #484 may. */
export function clearInstallOfferMemory() {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(KEY)
  } catch {
    // A browser that cannot forget also could not have remembered.
  }
}

/**
 * Whether the app is running INSTALLED — as the home-screen app rather than
 * in a browser tab (AC 2). Two checks, because the two platforms answer
 * differently: Chrome (and the spec) through the `display-mode` media query,
 * which reports the manifest's `display: 'standalone'` when launched from the
 * home screen; Safari on iOS through the non-standard `navigator.standalone`,
 * which #484 relies on. Either being true is enough. Each is in its own
 * try, because jsdom has no `matchMedia` at all and a browser that cannot
 * answer is a browser tab.
 */
export function isRunningInstalled(target = globalThis) {
  try {
    if (typeof target.matchMedia === 'function' && target.matchMedia('(display-mode: standalone)')?.matches) {
      return true
    }
  } catch {
    // A matchMedia that throws cannot say "installed"; fall through.
  }
  try {
    if (target.navigator?.standalone === true) return true
  } catch {
    // Same.
  }
  return false
}

/**
 * The browsers on iOS that CANNOT add anything to the home screen — #484 AC 4.
 *
 * Every one of these renders through the same WebKit Safari does, so nothing
 * about the page can tell them apart: the user agent is the only signal, and
 * these are the markers the common ones carry. Chrome is `CriOS`, Firefox is
 * `FxiOS`, Edge is `EdgiOS`, Opera is `OPiOS`; the rest are the in-app browsers
 * a link opens inside an app — Google's own (`GSA`), Facebook and Messenger
 * (`FBAN`/`FBAV`/`FB_IAB`), Instagram, LinkedIn, Twitter, Snapchat, Pinterest,
 * TikTok's `BytedanceWebview`, and WebView-hosted apps generally (`; wv`).
 *
 * The list is NOT the gate, and that is the point of `isIosSafariTab` below:
 * a marker nobody here has heard of yet is refused by the allowlist rather
 * than by this list, so a browser shipped after today shows nothing instead of
 * showing the wrong instruction. Kept as a named export so the tests can prove
 * the list is consulted at all, rather than passing on the allowlist alone.
 */
export const NON_SAFARI_IOS_MARKERS = [
  'CriOS',
  'FxiOS',
  'EdgiOS',
  'OPiOS',
  'GSA',
  'FBAN',
  'FBAV',
  'FB_IAB',
  'Instagram',
  'LinkedInApp',
  'Twitter',
  'Snapchat',
  'Pinterest',
  'BytedanceWebview',
  '; wv',
]

/**
 * Whether this is a REAL Safari tab on iOS — the one place the two-tap
 * instruction is true (#484 AC 2 and AC 4).
 *
 * An ALLOWLIST, decided with the owner at pickup: the line shows only for a
 * user agent that looks like Safari on an iOS device, and everything
 * unrecognised gets nothing. A blocklist of the markers above would be the
 * literal reading of AC 4 and ages badly in the one direction that hurts — a
 * browser released after today would be shown instructions for a Share menu
 * it does not have, and telling somebody to tap a button that is not there is
 * worse than saying nothing at all.
 *
 * Three conditions, all required:
 *
 *   - An iOS DEVICE. `iPhone`/`iPad`/`iPod`, plus the iPadOS 13+ case, which
 *     reports itself as `Macintosh` and is told apart from a real Mac only by
 *     having a touchscreen (`maxTouchPoints > 1`). Without that clause every
 *     iPad on a current OS is missed, which is half the story's audience.
 *   - `Safari/` PRESENT. Every non-Safari browser above still carries it, so
 *     this alone proves nothing — it is here to refuse a WebView that has
 *     dropped it, which is the shape most in-app browsers take.
 *   - NO marker from the list above.
 *
 * Reads `navigator` rather than a feature, because there is no feature to
 * read: the Share sheet is not scriptable and nothing on the page distinguishes
 * Safari from the WebView inside another app. Sniffing is the wrong tool and
 * the only one available, so it is aimed at the narrowest possible target and
 * fails closed. In its own try/catch: a `navigator` that throws is not iOS
 * Safari as far as this is concerned.
 */
export function isIosSafariTab(target = globalThis) {
  try {
    const nav = target.navigator
    if (!nav) return false
    const ua = typeof nav.userAgent === 'string' ? nav.userAgent : ''
    if (!ua) return false
    const touchPoints = typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0
    const isIosDevice = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
    if (!isIosDevice) return false
    if (!ua.includes('Safari/')) return false
    return !NON_SAFARI_IOS_MARKERS.some((marker) => ua.includes(marker))
  } catch {
    return false
  }
}

/**
 * Capture the browser's install offer and decide whether to show it.
 *
 * Started once, before the app loads (`src/main.jsx`). `beforeinstallprompt`
 * is captured and its default prevented — the browser's own bar is suppressed
 * either way, so "Not now" silences the nag as well as the line. The offer is
 * SHOWN only while all four hold: an event was captured, nothing on this page
 * has hidden it, the app is not running installed, and this browser remembers
 * neither a dismissal in the last 30 days nor an install. The decision is
 * recomputed at each thing that can change it, never on every render, so
 * `isOffered()` is a plain read and `useSyncExternalStore` can take it.
 *
 * `install()` calls the captured event's `prompt()` AT MOST ONCE (AC 1) — the
 * event itself refuses a second call — and hides the line whatever the person
 * chooses at the browser's sheet. What they chose is remembered the way the
 * line's own buttons are: accepted is an install, dismissed is a "Not now".
 * An outcome the browser does not report writes nothing.
 *
 * TWO REASONS TO OFFER, one controller (#484, owner decision at pickup). The
 * Android reason is a captured event; the iOS reason is the platform itself,
 * since Safari fires nothing and the person has to use its Share menu. So
 * `reason()` answers `'prompt'`, `'ios'` or null, and the four conditions that
 * gate the offer are unchanged and shared — the already-installed gate, the
 * 30-day "Not now", the one storage key, the one page-level hide. A second
 * controller would have duplicated the 30-day read and needed a precedence
 * rule for a page where both could speak.
 *
 * The iOS reason is decided ONCE, at start: a user agent does not change
 * under a live page, and re-reading it on every refresh would suggest it can.
 * It is refused when an event was captured, which cannot happen on iOS today
 * and would mean the platform had grown a real prompt — in which case the
 * prompt is the better offer and the instruction is stale.
 *
 * `target` and `now` are injected for the tests; `target` is the window.
 *
 * @returns {{ subscribe: (listener: () => void) => () => void, isOffered: () => boolean,
 *   reason: () => 'prompt' | 'ios' | null, install: () => Promise<void>,
 *   dismiss: () => void, stop: () => void }}
 */
export function startInstallOffer({ target = globalThis, now = () => Date.now() } = {}) {
  let captured = null
  // #484 — read once, for the life of the page. See above.
  const iosSafariTab = isIosSafariTab(target)
  // Set by anything that ends the offer on THIS page — a tap on either
  // button, an install — and never unset: a second `beforeinstallprompt` on
  // the same page (Chrome does re-fire after a dismissed sheet) is refused
  // here, which is also what keeps `prompt()` to one call. (A separate
  // "prompted" flag guarded `install()` in the first draft; the mutation pass
  // showed it unreachable — clearing `captured` and setting this already
  // refuse a second prompt — so it was removed rather than left as a guard
  // nothing could fail.)
  let hidden = false
  // #484 — null, `'prompt'` or `'ios'`. The boolean `isOffered()` is derived
  // from it, so the two can never disagree about whether a line is showing.
  let reason = null
  const listeners = new Set()

  const refresh = () => {
    // The event wins where both are available: a real install sheet beats
    // instructions for a menu. On iOS today only the second can happen.
    const why = captured ? 'prompt' : iosSafariTab ? 'ios' : null
    const next =
      why !== null && !hidden && !isRunningInstalled(target) && readInstallOfferMemory({ now: now() }) === null
        ? why
        : null
    if (next === reason) return
    reason = next
    for (const listener of listeners) listener()
  }

  // #484 — the iOS line has no event to wait for, so the first decision is
  // taken now rather than when something fires. On Android this is a no-op:
  // nothing is captured yet, so `reason` stays null until Chrome speaks.
  refresh()

  const onBeforeInstallPrompt = (event) => {
    event.preventDefault()
    if (hidden) return
    captured = event
    refresh()
  }
  // Fires on an install from this line's prompt AND from the browser's own
  // menu, so it is the one signal that covers both routes (AC 3).
  const onAppInstalled = () => {
    rememberInstallOfferInstalled({ now: now() })
    captured = null
    hidden = true
    refresh()
  }

  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  target.addEventListener('appinstalled', onAppInstalled)

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isOffered: () => reason !== null,
    // #484 — WHICH offer is showing, so the line can carry the right copy:
    // a button on Android, two taps to describe on iOS.
    reason: () => reason,
    async install() {
      const event = captured
      // Nothing to prompt with. On iOS this is the ordinary case and not an
      // error: the line there has no Install button to reach this at all.
      if (!event) return
      hidden = true
      captured = null
      refresh()
      // `prompt()` must run inside the tap's own task — nothing awaited before
      // it. Chrome resolves it with the outcome; older builds resolve it with
      // nothing and report the outcome on `userChoice`.
      let outcome = null
      try {
        const result = await event.prompt()
        outcome = result?.outcome ?? (await event.userChoice)?.outcome ?? null
      } catch {
        outcome = null
      }
      if (outcome === 'accepted') rememberInstallOfferInstalled({ now: now() })
      else if (outcome === 'dismissed') rememberInstallOfferDismissed({ now: now() })
    },
    dismiss() {
      rememberInstallOfferDismissed({ now: now() })
      captured = null
      hidden = true
      refresh()
    },
    stop() {
      target.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      target.removeEventListener('appinstalled', onAppInstalled)
      listeners.clear()
    },
  }
}
