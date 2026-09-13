import { attachVisibilityRefresh } from './realtime.js'

/**
 * The app updates itself when a deploy lands — story #347.
 *
 * #342 made the app notice DATA another phone changed. This is the other half
 * of the owner's sentence: CODE changed on the dev side and pushed to
 * production. Before this story `registerType: 'autoUpdate'` sat in
 * `vite.config.js` and read as though it did exactly this. It did half: the
 * generated worker called `skipWaiting()` and `clientsClaim()`, so a new
 * worker took control of an open page — and nothing in `src/` imported the
 * plugin's client module, so the page kept running the OLD JavaScript until
 * its next navigation, which an installed PWA left on the counter never makes
 * (measured 2026-09-05; cairn's `vite-plugin-pwa-autoupdate-ships-no-reload`).
 *
 * WHY `prompt` AND NOT `autoUpdate` (owner decision at pickup, 2026-09-13).
 * The plugin's `autoUpdate` client calls `window.location.reload()` on an
 * update unconditionally (`vite-plugin-pwa/dist/client/build/register.js`),
 * with no hook, so it cannot wait for somebody to finish typing — and a reload
 * is a destructive act against unsaved input. Under `prompt` the new worker
 * WAITS, the plugin reports it through `onNeedRefresh`, and this module
 * decides when to take it: at once when nothing is being edited, otherwise
 * the moment the edit is finished. Taking it is one call, `updateSW()`, after
 * which the plugin reloads on the takeover. A second tab mid-edit that the
 * plugin controls reloads too — it reloads every tab the new worker takes
 * over — and that is the accepted cost; the household runs one installed
 * window.
 *
 * AND WHY THE APP ALSO ASKS. A page that never navigates never looks for a new
 * worker, so nothing would even be waiting. `registration.update()` is called
 * every `UPDATE_CHECK_INTERVAL_MS` and whenever the tab becomes visible again,
 * behind the plugin's documented guard: skip while offline, and fetch the
 * worker URL with `no-store` first, updating only on a 200, so an offline or
 * captive-portal phone does not queue a check that fails.
 */

/**
 * How often an open app looks for a new build — one hour. The longest an idle
 * member can wait for a deploy to reach them is this, and in practice it is
 * the next time they come back to the app (`docs/deploy-runbook.md` states
 * both). One named constant, because a number buried in a `setInterval` is a
 * number nobody can find when the runbook and the code disagree.
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * While an update waits on an unfinished edit, how often the page looks again
 * (#347 review). Edits end in ways no event reports — a save that clears its
 * own field, or closes its editor, a moment after its request returns — so
 * waiting only for an event would leave the update held until the next tap.
 * It runs only while an update is waiting AND something is being edited.
 */
export const DEFERRED_RECHECK_MS = 1000

/**
 * How often a page whose app FAILED TO LOAD looks for a new build — one minute
 * (owner decision at #347, 2026-09-13). A page a broken deploy left blank has
 * nothing on it to protect, and nobody comes back to it on purpose, so an hour
 * is an hour of a phone showing nothing. With this, a fix or a rollback
 * reaches it within a minute. `src/main.jsx` makes the switch.
 */
export const RECOVERY_CHECK_INTERVAL_MS = 60 * 1000

// Input types whose value is text a person typed. Everything else an <input>
// can be (a checkbox, a date picker, a radio) is judged by whether it sits in
// a form, because "empty" means nothing for it.
const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'])
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * What "somebody is mid-edit" means here — owner decisions at pickup and at
 * the review, 2026-09-13: a field somebody typed into or changed, for as long
 * as it still holds what they put there. One listener on the document covers
 * every form in the app, so a form added later is protected without anybody
 * wiring it, which is the failure a per-form registration would have had.
 *
 * A TEXT field stops counting when it is empty or leaves the page. A SUBMIT
 * DOES NOT RELEASE IT (owner decision at the review's escalation): the save a
 * submit starts is still in flight, and a save the server refuses leaves its
 * text in the field — reloading then would lose exactly what deferring exists
 * to protect. A successful save that clears the field or closes its editor
 * releases it, and the updater's re-check (`DEFERRED_RECHECK_MS`) is what
 * notices, since neither fires an event.
 *
 * A select, checkbox or other non-text field counts only INSIDE a form, until
 * it leaves the page. The app's form-less controls save the moment they change
 * — a chore row's assignee, skip and exclusion pickers, the household switcher
 * — so nothing about them is unsaved. Counting them held every update for as
 * long as they stayed on screen (review-fanout's high finding, 2026-09-13).
 *
 * Stated limit: an edit form that keeps its text after a successful save holds
 * an update until it is closed.
 */
export function createEditTracker({ doc = globalThis.document } = {}) {
  const edited = new Set()
  const cleanListeners = new Set()
  let dirty = false

  const stillCounts = (field) => {
    if (!field.isConnected) return false
    if (field.tagName === 'TEXTAREA') return field.value !== ''
    if (field.tagName === 'INPUT' && TEXT_TYPES.has(field.type)) return field.value !== ''
    return Boolean(field.form)
  }
  const isDirty = () => {
    for (const field of edited) {
      if (stillCounts(field)) return true
      edited.delete(field)
    }
    return false
  }
  // Called after anything that can end an edit. Announces the dirty → clean
  // transition only, so a listener fires once per finished edit, not once per
  // keystroke or click.
  const recheck = () => {
    const now = isDirty()
    if (dirty && !now) for (const listener of cleanListeners) listener()
    dirty = now
  }
  const onInput = (event) => {
    const field = event.target
    if (field && FIELD_TAGS.has(field.tagName)) edited.add(field)
    recheck()
  }
  // A Cancel or a close unmounts the editor. React has already committed by
  // the time a click bubbles to the document, but the re-check runs again a
  // task later for anything that settles asynchronously.
  const onSettle = () => {
    recheck()
    setTimeout(recheck, 0)
  }

  doc.addEventListener('input', onInput)
  doc.addEventListener('change', onInput)
  doc.addEventListener('submit', onSettle)
  doc.addEventListener('click', onSettle)
  doc.addEventListener('keyup', onSettle)

  return {
    isDirty,
    /** Called each time the page goes from mid-edit to not. Returns an unsubscribe. */
    onClean(listener) {
      cleanListeners.add(listener)
      return () => cleanListeners.delete(listener)
    },
    dispose() {
      doc.removeEventListener('input', onInput)
      doc.removeEventListener('change', onInput)
      doc.removeEventListener('submit', onSettle)
      doc.removeEventListener('click', onSettle)
      doc.removeEventListener('keyup', onSettle)
      cleanListeners.clear()
    },
  }
}

/**
 * Register the service worker through the plugin's client module and keep the
 * page on the newest build — #347 AC 1 to AC 4.
 *
 * `registerSW` is `virtual:pwa-register`'s, injected so the tests can drive
 * the plugin's REAL client with only `workbox-window` faked (a fake of the
 * plugin itself would be a second opinion written by the same author).
 *
 * @returns {{ check: () => Promise<string>, apply: () => boolean, appFailed: () => void, stop: () => void }}
 */
export function startAppUpdates({
  registerSW,
  tracker = createEditTracker(),
  target = globalThis,
  fetchImpl = (...args) => globalThis.fetch(...args),
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  recheckMs = DEFERRED_RECHECK_MS,
  recoveryMs = RECOVERY_CHECK_INTERVAL_MS,
} = {}) {
  const worker = target.navigator?.serviceWorker
  // Whether a worker controlled this page when it REGISTERED — the value the
  // plugin's reload keys on (`workbox-window` fixes `isUpdate` at
  // registration). Read here, once, and never when an update arrives: measured
  // on #347, `clientsClaim` takes a first-visit page over during its first
  // install, so by the time an update is found the page reads as controlled
  // while the plugin still treats it as a first visit and never reloads it.
  const controlledAtRegistration = Boolean(worker?.controller)
  let waiting = false
  let applied = false
  let takenOver = false
  let watchingTakeover = false
  let reloading = false
  let registration = null
  let workerUrl = null
  let timer = null
  let recheckTimer = null
  let failed = false

  // The periodic check: hourly, or every `recoveryMs` once the app has failed
  // to load. Restarted, never stacked, when that switch happens.
  const startChecks = () => {
    if (timer) target.clearInterval(timer)
    timer = target.setInterval(() => void check(), failed ? recoveryMs : intervalMs)
  }

  const reloadOnce = () => {
    if (reloading) return
    reloading = true
    target.location.reload()
  }
  const stopRecheck = () => {
    if (recheckTimer) target.clearInterval(recheckTimer)
    recheckTimer = null
  }

  // Take the waiting worker if nothing is being edited. Exactly once: the
  // plugin reloads on the takeover, and a second `updateSW()` before that
  // reload lands would be a second skip-waiting message for nothing. Refused
  // while mid-edit, and then the page looks again every `recheckMs` until the
  // edit has ended — including the ends no event reports.
  const apply = () => {
    if (!waiting || applied) return false
    if (tracker.isDirty()) {
      if (!recheckTimer) recheckTimer = target.setInterval(apply, recheckMs)
      return false
    }
    stopRecheck()
    applied = true
    // Another tab already took this update and the new worker took this page
    // over (see `onTakeover`): there is no waiting worker left to message, so
    // the only thing still to do is move this page onto the build it now runs
    // under.
    if (takenOver) reloadOnce()
    else updateSW()
    return true
  }

  // A page NO worker controlled when it registered — its first visit — is the
  // one page the plugin will not reload: its reload keys on `isUpdate`, fixed
  // at registration, and here that was false. `clientsClaim` (vite.config.js)
  // makes the new worker take the page over, and this is what moves it onto
  // the new build. Measured on #347, twice: without `clientsClaim` the page was
  // never taken over; with it, but keyed on the controller at the moment the
  // update arrived (the first draft), the first install had already claimed the
  // page, so it read as controlled, nothing reloaded, and it stayed old.
  //
  // Watched only from the moment an update is REPORTED, never from startup,
  // so the first install's own claim — which is also a `controllerchange` —
  // cannot reload a brand-new page over whatever is being typed. And if the
  // takeover comes from ANOTHER tab while this one is mid-edit (#347 review),
  // it is remembered rather than acted on: this page reloads when its edit
  // ends, instead of messaging a worker that is no longer waiting.
  const onTakeover = () => {
    if (applied) {
      reloadOnce()
      return
    }
    takenOver = true
    apply()
  }

  // The plugin's documented periodic-update recipe, and the same guard for the
  // check a return to the tab makes: offline, skip it rather than queue a
  // failing one; otherwise fetch the worker with no-store and update on a 200.
  // Both callers discard the promise, so nothing here may reject.
  const check = async () => {
    if (!registration || registration.installing) return 'no-registration'
    const nav = target.navigator
    if (nav && 'onLine' in nav && !nav.onLine) return 'offline'
    let response
    try {
      response = await fetchImpl(workerUrl, {
        cache: 'no-store',
        headers: { cache: 'no-store', 'cache-control': 'no-cache' },
      })
    } catch {
      return 'unreachable'
    }
    if (response?.status !== 200) return 'unreachable'
    try {
      await registration.update()
    } catch {
      return 'update-failed'
    }
    return 'checked'
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      if (worker && !controlledAtRegistration && !watchingTakeover) {
        watchingTakeover = true
        worker.addEventListener('controllerchange', onTakeover)
      }
      apply()
    },
    onRegisteredSW(url, reg) {
      workerUrl = url
      registration = reg ?? null
      if (registration) startChecks()
    },
  })

  // The edit finishing is what releases a deferred update (AC 3)…
  const stopClean = tracker.onClean(apply)
  // …and coming back to the app looks for a new build (AC 4). It deliberately
  // does NOT override an unfinished edit (owner decision, 2026-09-13): `apply`
  // still refuses while anything typed is unsaved. #342's listener, reused.
  const stopVisible = attachVisibilityRefresh(
    () => {
      apply()
      void check()
    },
    { target },
  )

  return {
    check,
    apply,
    /**
     * The app failed to load (`src/main.jsx`): from now on, look for a new
     * build every `recoveryMs`. If the worker has not registered yet, the
     * switch takes effect when it does.
     */
    appFailed() {
      failed = true
      if (registration) startChecks()
    },
    stop() {
      if (timer) target.clearInterval(timer)
      timer = null
      stopRecheck()
      if (watchingTakeover) worker.removeEventListener('controllerchange', onTakeover)
      stopClean()
      stopVisible()
    },
  }
}
