import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_DEBOUNCE_MS } from './realtime.js'
import {
  DEFERRED_RECHECK_MS,
  RECOVERY_CHECK_INTERVAL_MS,
  UNSEEN_INSTALL_GRACE_MS,
  UPDATE_CHECK_INTERVAL_MS,
  createEditTracker,
  startAppUpdates,
} from './appUpdate.js'

// #347 — the app updates itself when a deploy lands.
//
// Three layers, each tested where it can actually fail:
//   1. the edit tracker, against the real DOM (jsdom);
//   2. the updater's decisions, against a registerSW whose options it records;
//   3. the whole takeover, against the PLUGIN'S OWN CLIENT CODE with only
//      `workbox-window` faked — because the reload that AC 2 is about lives
//      in the plugin, not here, and a fake plugin would be this file's author
//      agreeing with himself (cairn: a-fake-cannot-disagree-with-its-author).

/**
 * A window-shaped target: the updater's timers, #342's visibility listener,
 * `navigator.serviceWorker` and `location.reload` hang off it. `controlled`
 * is whether a worker controlled the page when it REGISTERED — false is a
 * first visit, the one page the plugin never reloads. A test models the first
 * install's claim by setting `controller` afterwards.
 */
function makeTarget({ onLine = true, controlled = true } = {}) {
  const target = new EventTarget()
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  target.document = doc
  const serviceWorker = new EventTarget()
  serviceWorker.controller = controlled ? {} : null
  target.navigator = { onLine, serviceWorker }
  target.location = { reload: vi.fn() }
  target.setInterval = (...args) => setInterval(...args)
  target.clearInterval = (id) => clearInterval(id)
  target.setTimeout = (...args) => setTimeout(...args)
  target.clearTimeout = (id) => clearTimeout(id)
  return target
}

/** A ServiceWorker as the registration exposes it: a state, and `statechange`. */
function makeWorker(state = 'installing') {
  const sw = new EventTarget()
  sw.state = state
  sw.setState = (next) => {
    sw.state = next
    sw.dispatchEvent(new Event('statechange'))
  }
  return sw
}

/**
 * The cold open of #454: the page registers while an older worker controls
 * it AND a newer one is already installing — the one shape workbox-window
 * never reports. `finishInstall` moves that worker to waiting, as the browser
 * does.
 */
function makeUnseenInstall() {
  const sw = makeWorker('installing')
  const registration = { active: {}, installing: sw, waiting: null, update: vi.fn(async () => {}) }
  registration.finishInstall = () => {
    registration.installing = null
    registration.waiting = sw
    sw.setState('installed')
  }
  registration.failInstall = () => {
    registration.installing = null
    sw.setState('redundant')
  }
  return registration
}

/** A tracker the test sets by hand, for the updater's own decisions. */
function makeTracker() {
  const tracker = {
    dirty: false,
    isDirty: () => tracker.dirty,
    onClean(listener) {
      tracker.finishEdit = () => {
        tracker.dirty = false
        listener()
      }
      return () => {}
    },
  }
  return tracker
}

/** A registerSW that records what the updater asked of it. */
function makeRegisterSW() {
  const fake = { options: null, updateSW: vi.fn() }
  fake.registerSW = (options) => {
    fake.options = options
    return fake.updateSW
  }
  return fake
}

const showBecomesVisible = async (target) => {
  target.document.visibilityState = 'visible'
  target.document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS + 1)
}

const takeover = (target) => target.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))

describe('#347 — what counts as mid-edit: something typed or changed, while it is still there', () => {
  let tracker
  let form
  let field

  beforeEach(() => {
    form = document.createElement('form')
    field = document.createElement('input')
    field.type = 'text'
    form.append(field)
    document.body.append(form)
    tracker = createEditTracker({ doc: document })
  })

  afterEach(() => {
    tracker.dispose()
    document.body.replaceChildren()
  })

  const type = (el, value) => {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const pick = (el) => el.dispatchEvent(new Event('change', { bubbles: true }))

  it('a field with typed text makes the page mid-edit, and nothing else does', () => {
    expect(tracker.isDirty()).toBe(false)
    type(field, 'half a chore title')
    expect(tracker.isDirty()).toBe(true)
  })

  it('a submit alone does not finish an edit: its save may be in flight, or refused, and the text is still there', () => {
    type(field, 'half a chore title')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(tracker.isDirty()).toBe(true)
  })

  it('a save that clears its own field finishes the edit, with no event at all', () => {
    type(field, 'saved')
    field.value = ''
    expect(tracker.isDirty()).toBe(false)
  })

  it('clearing the text by typing finishes it, and says so once', () => {
    const finished = vi.fn()
    tracker.onClean(finished)
    type(field, 'x')
    type(field, '')
    expect(tracker.isDirty()).toBe(false)
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('a field that leaves the page — a Cancel closing its editor — stops counting', async () => {
    const finished = vi.fn()
    tracker.onClean(finished)
    type(field, 'abandoned')
    form.remove()
    document.body.dispatchEvent(new Event('click', { bubbles: true }))
    expect(tracker.isDirty()).toBe(false)
    expect(finished).toHaveBeenCalledTimes(1)
    // The tracker re-checks again a task later; a finished edit is announced
    // once, not once per re-check.
    await new Promise((done) => setTimeout(done, 0))
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('a select or checkbox changed inside a form counts until it leaves the page', () => {
    const select = document.createElement('select')
    select.append(new Option('one', '1'), new Option('two', '2'))
    const box = document.createElement('input')
    box.type = 'checkbox'
    form.append(select, box)

    select.value = '2'
    pick(select)
    expect(tracker.isDirty()).toBe(true)
    select.remove()
    expect(tracker.isDirty()).toBe(false)

    box.checked = true
    pick(box)
    expect(tracker.isDirty()).toBe(true)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(tracker.isDirty()).toBe(true)
    form.remove()
    expect(tracker.isDirty()).toBe(false)
  })

  it('a select or checkbox with no form never counts: it saved the moment it changed', () => {
    // The chore row's assignee, skip and exclusion pickers and the household
    // switcher are form-less and save on change. Counting them held every
    // update for as long as they were on screen (#347 review, high).
    const select = document.createElement('select')
    select.append(new Option('one', '1'), new Option('two', '2'))
    const box = document.createElement('input')
    box.type = 'checkbox'
    document.body.append(select, box)
    select.value = '2'
    pick(select)
    box.checked = true
    pick(box)
    expect(tracker.isDirty()).toBe(false)
  })
})

describe('#347 — the updater decides when a waiting build is taken', () => {
  let target
  let tracker
  let fake
  let fetchImpl
  let registration
  let app

  const start = (options = {}) => {
    app?.stop()
    target = makeTarget(options)
    fake = makeRegisterSW()
    app = startAppUpdates({ registerSW: fake.registerSW, tracker, target, fetchImpl })
    fake.options.onRegisteredSW('/sw.js', registration)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    tracker = makeTracker()
    fetchImpl = vi.fn(async () => ({ status: 200 }))
    registration = { installing: null, update: vi.fn(async () => {}) }
    app = null
    start()
  })

  afterEach(() => {
    app.stop()
    vi.useRealTimers()
  })

  it('AC 1 — registers through the plugin client, immediately', () => {
    expect(fake.options.immediate).toBe(true)
    expect(fake.options.onNeedRefresh).toBeTypeOf('function')
    expect(fake.options.onRegisteredSW).toBeTypeOf('function')
  })

  it('AC 2 — a waiting build is taken at once when nothing is being edited', () => {
    fake.options.onNeedRefresh()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
  })

  it('AC 2 — nothing is taken when nothing is waiting (a first install)', async () => {
    await showBecomesVisible(target)
    expect(app.apply()).toBe(false)
    expect(fake.updateSW).not.toHaveBeenCalled()
  })

  it('AC 3 — mid-edit, the build waits, and is taken exactly once when the edit finishes', () => {
    tracker.dirty = true
    fake.options.onNeedRefresh()
    expect(fake.updateSW).not.toHaveBeenCalled()
    tracker.finishEdit()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    // A later edit finishing, or the build being reported again, takes nothing more.
    tracker.finishEdit()
    fake.options.onNeedRefresh()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
  })

  it('AC 3 — while the build waits on an edit, the page looks again, and takes it once the edit ends silently', async () => {
    // A save that clears its field, or closes its editor, fires nothing the
    // tracker hears; the re-check is what notices.
    expect(DEFERRED_RECHECK_MS).toBe(1000)
    tracker.dirty = true
    fake.options.onNeedRefresh()
    await vi.advanceTimersByTimeAsync(DEFERRED_RECHECK_MS * 3)
    expect(fake.updateSW).not.toHaveBeenCalled()
    tracker.dirty = false
    await vi.advanceTimersByTimeAsync(DEFERRED_RECHECK_MS)
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DEFERRED_RECHECK_MS * 3)
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
  })

  it('AC 3, as amended — coming back to the app does not override an unfinished edit', async () => {
    tracker.dirty = true
    fake.options.onNeedRefresh()
    target.document.visibilityState = 'hidden'
    target.document.dispatchEvent(new Event('visibilitychange'))
    await showBecomesVisible(target)
    expect(fake.updateSW).not.toHaveBeenCalled()
  })

  it('AC 3 — an edit that ended with no event the tracker heard is caught on the way back into the app', async () => {
    tracker.dirty = true
    fake.options.onNeedRefresh()
    tracker.dirty = false
    expect(fake.updateSW).not.toHaveBeenCalled()
    await showBecomesVisible(target)
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
  })

  it('AC 2 — a first-visit page is moved onto the new build when the new worker takes it over', () => {
    start({ controlled: false })
    // The first install claims the page (clientsClaim) before any update is
    // found — so it reads as controlled NOW. Measured on #347: keying on this
    // moment instead of registration left the page on the old build.
    target.navigator.serviceWorker.controller = {}
    fake.options.onNeedRefresh()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    expect(target.location.reload).not.toHaveBeenCalled()
    takeover(target)
    takeover(target)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('AC 2 — a first-visit page is not reloaded by its first install’s own takeover', () => {
    // The first install's claim is a controllerchange too, and it arrives
    // before any update exists. Nothing may reload on it — least of all over
    // something being typed.
    start({ controlled: false })
    tracker.dirty = true
    takeover(target)
    tracker.dirty = false
    takeover(target)
    expect(target.location.reload).not.toHaveBeenCalled()
    fake.options.onNeedRefresh()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('AC 3 — a first-visit tab mid-edit that another tab updates reloads itself once its edit ends', () => {
    // #347 review: tab B takes the update while this tab is mid-edit; the new
    // worker takes this tab over but the plugin does not reload it. It must
    // not message a worker that is no longer waiting, and must not strand.
    start({ controlled: false })
    target.navigator.serviceWorker.controller = {}
    tracker.dirty = true
    fake.options.onNeedRefresh()
    takeover(target)
    expect(target.location.reload).not.toHaveBeenCalled()
    tracker.finishEdit()
    expect(target.location.reload).toHaveBeenCalledTimes(1)
    expect(fake.updateSW).not.toHaveBeenCalled()
  })

  it('AC 2 — a page a worker already controlled at registration leaves the reload to the plugin', () => {
    fake.options.onNeedRefresh()
    takeover(target)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('AC 4 — an hour open with no navigation checks for a new build', async () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(60 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1)
    expect(registration.update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledWith('/sw.js', expect.objectContaining({ cache: 'no-store' }))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('a page whose app failed to load looks every minute, not every hour', async () => {
    // Owner decision at #347, 2026-09-13: a blank page has nothing to protect,
    // so a fix or a rollback should reach it within a minute.
    expect(RECOVERY_CHECK_INTERVAL_MS).toBe(60 * 1000)
    app.appFailed()
    await vi.advanceTimersByTimeAsync(RECOVERY_CHECK_INTERVAL_MS - 1)
    expect(registration.update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(registration.update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RECOVERY_CHECK_INTERVAL_MS)
    expect(registration.update).toHaveBeenCalledTimes(2)
    // The hourly check is replaced, not kept alongside: one check per minute
    // across the hour, not one extra at the hour mark.
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 2 * RECOVERY_CHECK_INTERVAL_MS)
    expect(registration.update).toHaveBeenCalledTimes(UPDATE_CHECK_INTERVAL_MS / RECOVERY_CHECK_INTERVAL_MS)
  })

  it('a page whose app failed before the worker registered still looks every minute', async () => {
    // The app chunk and the plugin's client load in parallel, so the failure
    // can land first.
    app.stop()
    target = makeTarget()
    fake = makeRegisterSW()
    app = startAppUpdates({ registerSW: fake.registerSW, tracker, target, fetchImpl })
    app.appFailed()
    fake.options.onRegisteredSW('/sw.js', registration)
    await vi.advanceTimersByTimeAsync(RECOVERY_CHECK_INTERVAL_MS)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('AC 4 — coming back to the app checks too', async () => {
    await showBecomesVisible(target)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('AC 4 — offline, the check is skipped rather than queued', async () => {
    target.navigator.onLine = false
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    await showBecomesVisible(target)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('AC 4 — a worker URL that does not answer 200 is not updated from', async () => {
    fetchImpl.mockResolvedValue({ status: 503 })
    expect(await app.check()).toBe('unreachable')
    fetchImpl.mockRejectedValue(new TypeError('network down'))
    expect(await app.check()).toBe('unreachable')
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('AC 4 — an update() that fails is reported, not thrown into a promise nobody holds', async () => {
    registration.update.mockRejectedValue(new TypeError('script fetch failed'))
    await expect(app.check()).resolves.toBe('update-failed')
  })
})

describe('#454 — a worker already installing when the page registered, on a page an older worker controls', () => {
  let target
  let tracker
  let fake
  let registration
  let app

  const start = (options = {}) => {
    app?.stop()
    target = makeTarget(options)
    fake = makeRegisterSW()
    app = startAppUpdates({ registerSW: fake.registerSW, tracker, target, fetchImpl: async () => ({ status: 200 }) })
    fake.options.onRegisteredSW('/sw.js', registration)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    tracker = makeTracker()
    registration = makeUnseenInstall()
    app = null
    start()
  })

  afterEach(() => {
    app.stop()
    vi.useRealTimers()
  })

  it('AC 2 — the plugin gets half a second to report it; unreported and still waiting, the app takes it and reloads on the takeover', async () => {
    expect(UNSEEN_INSTALL_GRACE_MS).toBe(500)
    registration.finishInstall()
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS - 1)
    expect(fake.updateSW).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    // The plugin never armed its reload for a worker it did not see, so the
    // takeover is this page's to act on — once.
    takeover(target)
    takeover(target)
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('AC 3 — one the plugin does report within the grace is the plugin’s: taken once, and the reload left to the plugin', async () => {
    registration.finishInstall()
    await vi.advanceTimersByTimeAsync(200)
    fake.options.onNeedRefresh()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS)
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
    takeover(target)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('AC 3 — mid-edit, the unseen worker waits like any other, and is taken once the edit ends', async () => {
    tracker.dirty = true
    registration.finishInstall()
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS + DEFERRED_RECHECK_MS * 3)
    expect(fake.updateSW).not.toHaveBeenCalled()
    tracker.finishEdit()
    expect(fake.updateSW).toHaveBeenCalledTimes(1)
  })

  it('an install that fails is nothing to take', async () => {
    registration.failInstall()
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS)
    expect(fake.updateSW).not.toHaveBeenCalled()
  })

  it('a worker that stopped waiting during the grace — another tab took it — is not messaged again', async () => {
    registration.finishInstall()
    await vi.advanceTimersByTimeAsync(100)
    registration.waiting = null
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS)
    expect(fake.updateSW).not.toHaveBeenCalled()
  })

  it('a first visit’s own install is not an update: no worker controlled the page, so nothing is taken and nothing reloads', async () => {
    registration = makeUnseenInstall()
    registration.active = null
    start({ controlled: false })
    registration.finishInstall()
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS)
    expect(fake.updateSW).not.toHaveBeenCalled()
    takeover(target)
    expect(target.location.reload).not.toHaveBeenCalled()
  })

  it('stop() cancels a pending grace', async () => {
    registration.finishInstall()
    app.stop()
    await vi.advanceTimersByTimeAsync(UNSEEN_INSTALL_GRACE_MS)
    expect(fake.updateSW).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The takeover end to end, through the plugin's real client.
// ---------------------------------------------------------------------------

const CLIENT_PATH = resolve(process.cwd(), 'node_modules/vite-plugin-pwa/dist/client/build/register.js')
const WORKBOX_IMPORT = 'import("workbox-window")'
const CLIENT_EXPORT = /export\s*\{\s*registerSW\s*\};?\s*$/
const PLACEHOLDERS = ['__SW__', '__SCOPE__', '__SW_AUTO_UPDATE__', '__SW_SELF_DESTROYING__', '__TYPE__']
// The mode the client is generated in comes from THIS repo's config, as the
// plugin does it. Hard-coding `prompt` here meant switching vite.config.js back
// to `autoUpdate` reddened nothing (predicted 0 while writing the mutation
// pass): these tests went on proving prompt mode against a config that no
// longer asked for it.
const REGISTER_TYPES = [
  ...readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8').matchAll(/registerType:\s*'(\w+)'/g),
].map((match) => match[1])

/**
 * Load `virtual:pwa-register`'s code as the build ships it for THIS config.
 * The placeholders are substituted exactly as the plugin does
 * (`vite-plugin-pwa/dist/index.js`: `__SW_AUTO_UPDATE__` becomes
 * `registerType === "autoUpdate"`), and the one dynamic import of
 * `workbox-window` is swapped for the fake. Every anchor is asserted — the
 * import exactly once, each placeholder present before and absent after — so
 * a plugin upgrade that renames one fails here instead of silently testing a
 * different mode. `window` and `navigator` are handed in.
 */
function loadPluginClient({ reload, Workbox }) {
  expect(REGISTER_TYPES, 'vite.config.js names exactly one registerType').toHaveLength(1)
  let source = readFileSync(CLIENT_PATH, 'utf8')
  expect(source.split(WORKBOX_IMPORT)).toHaveLength(2)
  expect(source).toMatch(CLIENT_EXPORT)
  for (const placeholder of PLACEHOLDERS) expect(source, `the client carries ${placeholder}`).toContain(placeholder)
  source = source
    .replace(WORKBOX_IMPORT, 'Promise.resolve({ Workbox: __Workbox })')
    .replace(CLIENT_EXPORT, '')
    .replace(/__SW__/g, '/sw.js')
    .replace('__SCOPE__', '/')
    .replace('__SW_AUTO_UPDATE__', String(REGISTER_TYPES[0] === 'autoUpdate'))
    .replace('__SW_SELF_DESTROYING__', 'false')
    .replace('__TYPE__', 'classic')
  for (const placeholder of PLACEHOLDERS) expect(source, `${placeholder} substituted`).not.toContain(placeholder)
  // The plugin's own source, run as shipped.
  return new Function('window', 'navigator', '__Workbox', `${source}\nreturn registerSW;`)(
    { location: { reload } },
    { serviceWorker: {} },
    Workbox,
  )
}

/**
 * workbox-window, faked only as far as the plugin client touches it. A
 * skip-waiting message PERFORMS the takeover the way the browser does: the
 * page's `controllerchange` fires, then workbox-window's `controlling`, with
 * the `isUpdate` it fixed at registration — so a reload happens only if the
 * app actually sent the message, never because a test emitted the event.
 */
class FakeWorkbox {
  static last = null
  static serviceWorker = null
  /** The registration `register()` resolves with next, when a test needs one already installing (#454). */
  static nextRegistration = null
  constructor(url, options) {
    this.url = url
    this.options = options
    this.listeners = {}
    this.skipWaitingMessages = 0
    this.takeoverIsUpdate = true
    this.registration = FakeWorkbox.nextRegistration ?? { installing: null, update: vi.fn(async () => {}) }
    FakeWorkbox.nextRegistration = null
    FakeWorkbox.last = this
  }
  addEventListener(type, listener) {
    ;(this.listeners[type] ||= []).push(listener)
  }
  emit(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event)
  }
  register() {
    return Promise.resolve(this.registration)
  }
  messageSkipWaiting() {
    this.skipWaitingMessages += 1
    FakeWorkbox.serviceWorker?.dispatchEvent(new Event('controllerchange'))
    this.emit('controlling', { isUpdate: this.takeoverIsUpdate })
  }
}

describe('#347 — the takeover, through vite-plugin-pwa’s own client', () => {
  let reload
  let tracker
  let target
  let app
  let wb

  // The plugin registers asynchronously (a dynamic import, then register()).
  const settle = () => new Promise((done) => setTimeout(done, 0))

  const start = async ({ unseenGraceMs, ...options } = {}) => {
    app?.stop()
    reload = vi.fn()
    target = makeTarget(options)
    FakeWorkbox.serviceWorker = target.navigator.serviceWorker
    app = startAppUpdates({
      registerSW: loadPluginClient({ reload, Workbox: FakeWorkbox }),
      tracker,
      target,
      fetchImpl: async () => ({ status: 200 }),
      ...(unseenGraceMs === undefined ? {} : { unseenGraceMs }),
    })
    await settle()
    wb = FakeWorkbox.last
  }

  beforeEach(async () => {
    tracker = makeTracker()
    app = null
    await start()
  })

  afterEach(() => app.stop())

  it('AC 2 — an update waiting while nothing is edited is taken, and the page reloads onto it', async () => {
    wb.emit('waiting', { isUpdate: true })
    await settle()
    expect(wb.skipWaitingMessages).toBe(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('AC 2 — a first install does not reload', async () => {
    wb.emit('installed', { isUpdate: false })
    await settle()
    expect(wb.skipWaitingMessages).toBe(0)
    expect(reload).not.toHaveBeenCalled()
  })

  it('AC 3 — mid-edit, nothing is taken and nothing reloads until the edit finishes, then exactly once', async () => {
    tracker.dirty = true
    wb.emit('waiting', { isUpdate: true })
    await settle()
    expect(wb.skipWaitingMessages).toBe(0)
    expect(reload).not.toHaveBeenCalled()

    tracker.finishEdit()
    await settle()
    expect(wb.skipWaitingMessages).toBe(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('AC 2 — a first-visit page: the plugin stays silent on the takeover, and the app reloads it', async () => {
    // What was measured live on #347: no worker controlled the page when it
    // registered, so workbox-window reports the takeover with isUpdate false
    // and the plugin does not reload. The app's own reload is what moves it.
    await start({ controlled: false })
    // Claimed by its first install before the update is found, as measured.
    target.navigator.serviceWorker.controller = {}
    wb.takeoverIsUpdate = false
    wb.emit('waiting', { isUpdate: false })
    await settle()
    expect(wb.skipWaitingMessages).toBe(1)
    expect(reload).not.toHaveBeenCalled()
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })

  it('AC 1 — the plugin registers at once and hands the updater its registration', async () => {
    expect(wb.url).toBe('/sw.js')
    await app.check()
    expect(wb.registration.update).toHaveBeenCalledTimes(1)
  })

  it('#454 — a worker already waiting when the page registered is reported without isUpdate, and still taken and reloaded onto', async () => {
    // workbox-window reports a worker it finds waiting at registration as
    // `{ sw, wasWaitingBeforeRegister: true }` — no `isUpdate` on the event.
    // The plugin must not key on it: the reload keys on the controller at
    // registration, which is what a cold open of a stale device has.
    wb.emit('waiting', { sw: {}, wasWaitingBeforeRegister: true })
    await settle()
    expect(wb.skipWaitingMessages).toBe(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('#454 — a worker already installing when the page registered is never reported by the plugin; the app takes it and reloads the page itself', async () => {
    const registration = makeUnseenInstall()
    FakeWorkbox.nextRegistration = registration
    await start({ unseenGraceMs: 10 })
    expect(wb.registration).toBe(registration)
    registration.finishInstall()
    await new Promise((done) => setTimeout(done, 30))
    // Through the plugin's real updateSW → workbox-window's skip-waiting message.
    expect(wb.skipWaitingMessages).toBe(1)
    // The plugin never saw the worker, so it never armed its own reload…
    expect(reload).not.toHaveBeenCalled()
    // …and the page reloaded itself on the takeover the message caused.
    expect(target.location.reload).toHaveBeenCalledTimes(1)
  })
})
