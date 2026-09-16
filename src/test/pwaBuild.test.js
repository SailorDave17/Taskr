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
