// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// #347 AC 1 — the registration path is the app's, and a REAL build is what
// proves it. The config can say anything; what ships is `index.html`, `sw.js`
// and the bundle, and before #347 all three disagreed with what `autoUpdate`
// read as promising (cairn: vite-plugin-pwa-autoupdate-ships-no-reload). So
// this builds the app into a temporary directory with the real config and
// reads the three artefacts.
//
// It builds rather than reading `dist/`, because CI runs this suite BEFORE its
// build step and a local `dist/` can be any age.

let out
let indexHtml
let worker
let bundle
let bundlePath

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'taskr-347-build-'))
  await build({
    configFile: resolve(process.cwd(), 'vite.config.js'),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true },
  })
  indexHtml = readFileSync(join(out, 'index.html'), 'utf8')
  worker = readFileSync(join(out, 'sw.js'), 'utf8')
  // Found from the page itself, not by listing the directory.
  const script = indexHtml.match(/src="\/(assets\/index-[\w-]+\.js)"/)
  expect(script, 'index.html names its bundle').not.toBeNull()
  bundlePath = script[1]
  bundle = readFileSync(join(out, bundlePath), 'utf8')
}, 180_000)

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true })
})

describe('#347 AC 1 — one registration path, and it is the app’s', () => {
  it('index.html carries no inline registration script, and no registerSW.js is emitted', () => {
    expect(indexHtml).not.toMatch(/vite-plugin-pwa:register-sw/)
    expect(indexHtml).not.toMatch(/registerSW\.js/)
    expect(existsSync(join(out, 'registerSW.js'))).toBe(false)
  })

  it('the bundle carries the plugin client, which is where the takeover lives', () => {
    // `messageSkipWaiting` is workbox-window's, pulled in only by
    // `virtual:pwa-register`. A build that dropped the import in main.jsx
    // tree-shakes it away.
    expect(bundle).toMatch(/messageSkipWaiting/)
  })

  it('the worker waits for the app to take it: its one skipWaiting() sits in the SKIP_WAITING handler', () => {
    // Under `autoUpdate` the worker calls skipWaiting() unconditionally, with
    // no handler, and the page cannot defer anything. Under `prompt` it waits
    // for the message the app sends once nothing is being edited.
    expect(worker).toMatch(/SKIP_WAITING/)
    expect(worker.match(/skipWaiting\(\)/g) ?? []).toHaveLength(1)
  })

  it('and it claims pages it does not yet control, so a first-visit page is reached too', () => {
    // Measured on #347 without it: a first-visit page took the update and the
    // new worker activated without ever taking the page over.
    expect(worker).toMatch(/clientsClaim\(\)/)
  })

  it('the updater loads before the app, so a module that throws inside App cannot stop it', () => {
    // Measured on #347: a bundle that threw on load registered nothing, and
    // the next good deploy's worker waited until every window was closed. The
    // entry bundle must carry the updater and NOT the app; the app arrives as
    // the chunk the entry imports. `build-commit` is the footer's test id,
    // which lives in App and nowhere in the updater.
    expect(bundle).not.toMatch(/build-commit/)
    const appChunk = bundle.match(/import\(\s*["'`]\.\/(App-[\w-]+\.js)["'`]\s*\)/)
    expect(appChunk, 'the entry imports App as a separate chunk').not.toBeNull()
    expect(readFileSync(join(out, 'assets', appChunk[1]), 'utf8')).toMatch(/build-commit/)
  })

  it('the manifest and worker still ship, and the worker still precaches the bundle', () => {
    expect(existsSync(join(out, 'manifest.webmanifest'))).toBe(true)
    expect(indexHtml).toMatch(/manifest\.webmanifest/)
    // Passing a `workbox` block must not have dropped the plugin's defaults.
    expect(worker).toContain(bundlePath)
  })
})

// #540 AC 5 — `/version.json`, emitted by the build and never precached.
//
// A REAL build for #347's reason: the file is written by a plugin, and the
// precache list is written by another plugin reading what the first left on
// disk, so only the artefacts can say what the two agreed on.
describe('#540 AC 5 — the build emits /version.json, and the worker does not precache it', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
  // What buildInfo.commit reads in the same build: the host's sha cut to
  // seven, or `local` off Vercel (vite.config.js).
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'local'

  it('holds exactly the release version and the commit, and nothing else', () => {
    const path = join(out, 'version.json')
    expect(existsSync(path), 'dist/version.json was not emitted').toBe(true)
    const body = JSON.parse(readFileSync(path, 'utf8'))
    expect(Object.keys(body)).toEqual(['version', 'commit'])
    expect(body).toEqual({ version: pkg.version, commit })
  })

  it('is emitted by the build, not committed under public/', () => {
    // A committed copy would be copied into dist/ verbatim and go on naming
    // whatever release it was written for.
    expect(existsSync(resolve(process.cwd(), 'public', 'version.json'))).toBe(false)
  })

  it('is absent from the service worker, so the network answers it, not a precached copy', () => {
    // A precached copy is answered by the worker, and would name the release
    // the worker was installed with — the stale-page shape #347 removed.
    expect(worker).not.toMatch(/version\.json/)
  })

  it('POSITIVE CONTROL: the worker text is the precache list, so an absence in it means something', () => {
    // Without this, a worker read as empty or wrong would satisfy the absence
    // above perfectly. These are entries workbox does precache.
    expect(worker).toMatch(/precacheAndRoute/)
    expect(worker).toMatch(/"index\.html"|url:"index\.html"/)
    expect(worker).toContain('manifest.webmanifest')
  })
})

// #484 AC 1 — the three things iOS does not read from the manifest.
//
// A REAL build again, for the reason above: the link and the two metas are in
// `index.html`, the icon is in `public/`, and Vite's copy of `public/` is
// what puts it in `dist/`. Each half fails silently on its own — a link to a
// file that did not ship gives iOS nothing to use, and a file that shipped
// with no link is never looked for — so the test asserts both and the same
// filename in each.
describe('#484 AC 1 — the iOS home-screen icon and meta tags ship', () => {
  const ICON = 'icons/apple-touch-icon-180.png'

  it('index.html links the apple-touch-icon, and the file is in the build', () => {
    // Read the href out of the page rather than asserting a string, so the
    // two halves cannot drift: the file checked is the file linked.
    const link = indexHtml.match(/<link[^>]+rel="apple-touch-icon"[^>]*>/)
    expect(link, 'index.html carries an apple-touch-icon link').not.toBeNull()
    const href = link[0].match(/href="\/([^"]+)"/)
    expect(href, 'the link names a file').not.toBeNull()
    expect(href[1]).toBe(ICON)
    expect(existsSync(join(out, href[1])), `${href[1]} ships in the build`).toBe(true)
  })

  it('the icon that shipped is a 180px PNG, which is the size iOS asks for', () => {
    // Without this the link and the file could both be right and the icon
    // still wrong — iOS would scale whatever it found. Read from the PNG's
    // own IHDR, so it is the bytes that are checked and not the filename.
    const png = readFileSync(join(out, ICON))
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(180)
    expect(png.readUInt32BE(20)).toBe(180)
  })

  it('the two Apple metas ship: full screen on older iOS, and the name under the icon', () => {
    expect(indexHtml).toMatch(/<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/)
    expect(indexHtml).toMatch(/<meta[^>]+name="apple-mobile-web-app-title"[^>]+content="Taskr"/)
  })
})
