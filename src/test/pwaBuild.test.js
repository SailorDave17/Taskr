// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { brotliCompressSync, constants as zlib } from 'node:zlib'
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
let appChunk

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'taskr-347-build-'))
  // A PRODUCTION build, which is not what `build()` gives inside vitest (#555).
  // Vite picks `production` only when NODE_ENV is unset, and vitest sets it to
  // `test`, so until #555 this file built React's development flavour: 183,216
  // Brotli bytes of entry chunk against 130,355 from `vite build`, measured.
  // Every assertion here is about what ships, so the build is the one that does.
  const nodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await build({
      configFile: resolve(process.cwd(), 'vite.config.js'),
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true },
    })
  } finally {
    process.env.NODE_ENV = nodeEnv
  }
  indexHtml = readFileSync(join(out, 'index.html'), 'utf8')
  worker = readFileSync(join(out, 'sw.js'), 'utf8')
  // Found from the page itself, not by listing the directory.
  const script = indexHtml.match(/src="\/(assets\/index-[\w-]+\.js)"/)
  expect(script, 'index.html names its bundle').not.toBeNull()
  bundlePath = script[1]
  bundle = readFileSync(join(out, bundlePath), 'utf8')
  // The App chunk, found the same way: through the import the entry makes.
  const appImport = bundle.match(/import\(\s*["'`]\.\/(App-[\w-]+\.js)["'`]\s*\)/)
  if (appImport) appChunk = readFileSync(join(out, 'assets', appImport[1]))
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

// #555 AC 1 — the entry and App chunks stay under a Brotli budget.
//
// The tune-up (#550) is a run of stories that each make these two files
// smaller. Without a budget every gain is a gain once: the next feature spends
// it back and nothing says so. A REAL build again, for #347's reason — the
// chunk split is decided by the bundler, and only its output can say what a
// phone downloads.
//
// MEASURED 2026-09-22, `develop` at aa155c3, with this file's own instrument:
//   entry chunk  438,481 bytes raw → 130,355 Brotli
//   App chunk    155,105 bytes raw →  43,111 Brotli
// Each budget is that figure plus about 7%, so a change has to be small to
// fit under it and a ~20 kB import does not.
//
// BROTLI AT QUALITY 3, because that is what production serves. Node's default
// (quality 11) reads the entry chunk as 108,570 bytes; quality 3 reads
// 130,355, against 130,315 on the wire from https://taskr.madcowhq.com the same
// day (the tune-up report on #550). A budget over the q11 figure would have
// ~20 kB of slack the phone never sees.
//
// When a story moves these numbers on purpose it moves the constant here, with
// its own measurement and date. #560 is expected to lower the entry budget and
// RAISE the App one: the supabase client moves into App, it does not leave.
const BUNDLE_BUDGET_MEASURED = '2026-09-22'
const ENTRY_BUDGET_BROTLI_BYTES = 140_000
const APP_BUDGET_BROTLI_BYTES = 46_000
const BROTLI_QUALITY = 3

/** What a phone downloads for these bytes, at production's compression. */
const brotliBytes = (bytes) =>
  brotliCompressSync(bytes, {
    params: {
      [zlib.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [zlib.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  }).length

describe(`#555 AC 1 — the entry and App chunks stay under their Brotli budgets (measured ${BUNDLE_BUDGET_MEASURED})`, () => {
  it('POSITIVE CONTROL: both chunks were found and are the real ones', () => {
    // Without this a budget passes against a chunk that was never read, or
    // against the wrong file. The same markers #347's test uses: the updater's
    // takeover in the entry, the footer's test id in App.
    expect(appChunk, 'the entry imports no App chunk').toBeDefined()
    expect(bundle).toMatch(/messageSkipWaiting/)
    expect(appChunk.toString('utf8')).toMatch(/build-commit/)
    // It is the production build, not vitest's `test` one: React's
    // production bundle carries its minified-error text and none of the
    // development checks. Measured on #555 with `NODE_ENV=test vite build`:
    // 0 and 3, against 1 and 0 here.
    expect(bundle).toMatch(/Minified React error/)
    expect(bundle).not.toMatch(/validateDOMNesting/)
    // And the instrument reads a real size, not an empty buffer's.
    expect(brotliBytes(Buffer.from(bundle))).toBeGreaterThan(ENTRY_BUDGET_BROTLI_BYTES / 2)
    expect(brotliBytes(appChunk)).toBeGreaterThan(APP_BUDGET_BROTLI_BYTES / 2)
  })

  it(`the entry chunk is at most ${ENTRY_BUDGET_BROTLI_BYTES} bytes Brotli`, () => {
    const size = brotliBytes(Buffer.from(bundle))
    expect(size, `entry chunk ${bundlePath} is ${size} bytes Brotli`).toBeLessThanOrEqual(ENTRY_BUDGET_BROTLI_BYTES)
  })

  it(`the App chunk is at most ${APP_BUDGET_BROTLI_BYTES} bytes Brotli`, () => {
    const size = brotliBytes(appChunk)
    expect(size, `the App chunk is ${size} bytes Brotli`).toBeLessThanOrEqual(APP_BUDGET_BROTLI_BYTES)
  })

  it('and each budget is tight: 20 kB of new code that does not compress would break it', () => {
    // Guards the constants rather than the build. A budget loosened far past
    // what ships is a budget no change can break, and it reads exactly like
    // this one. Random bytes because they do not compress, so the added weight
    // is the full 20 kB whatever the bundler would have made of real code.
    const planted = randomBytes(20_000)
    expect(brotliBytes(Buffer.concat([Buffer.from(bundle), planted]))).toBeGreaterThan(ENTRY_BUDGET_BROTLI_BYTES)
    expect(brotliBytes(Buffer.concat([appChunk, planted]))).toBeGreaterThan(APP_BUDGET_BROTLI_BYTES)
  })
})
