/**
 * The offer to install Taskr — story #483.
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
 * The install target is Android Chrome (`vite.config.js`). Safari never fires
 * the event, so on iOS this shows nothing rather than instructions — that is
 * #484's story. A browser that never fires the event writes nothing (AC 5).
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
 * which #484 will rely on. Either being true is enough. Each is in its own
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
 * `target` and `now` are injected for the tests; `target` is the window.
 *
 * @returns {{ subscribe: (listener: () => void) => () => void, isOffered: () => boolean,
 *   install: () => Promise<void>, dismiss: () => void, stop: () => void }}
 */
export function startInstallOffer({ target = globalThis, now = () => Date.now() } = {}) {
  let captured = null
  // Set by anything that ends the offer on THIS page — a tap on either
  // button, an install — and never unset: a second `beforeinstallprompt` on
  // the same page (Chrome does re-fire after a dismissed sheet) is refused
  // here, which is also what keeps `prompt()` to one call. (A separate
  // "prompted" flag guarded `install()` in the first draft; the mutation pass
  // showed it unreachable — clearing `captured` and setting this already
  // refuse a second prompt — so it was removed rather than left as a guard
  // nothing could fail.)
  let hidden = false
  let offered = false
  const listeners = new Set()

  const refresh = () => {
    const next =
      Boolean(captured) &&
      !hidden &&
      !isRunningInstalled(target) &&
      readInstallOfferMemory({ now: now() }) === null
    if (next === offered) return
    offered = next
    for (const listener of listeners) listener()
  }

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
    isOffered: () => offered,
    async install() {
      const event = captured
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
