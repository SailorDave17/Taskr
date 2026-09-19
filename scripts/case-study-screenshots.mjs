// The case study's split screenshots, from a placeholder household — #452.
//
//     npm run case:screenshots
//
// madcowsailing.com's Taskr case study shows two pictures of the split screen:
// one where the week reaches level, one where it cannot. Until this landed they
// were taken BY HAND — madcowsailing.com #65, on 2026-09-14, against a throwaway
// household on the LIVE project, walked in a fresh browser and deleted
// afterwards. That capture cost three of the mailer's two-an-hour emails, put a
// demo household on production, and, being a hand walk, cannot be repeated when
// `Split.jsx` changes. This command is what epic #75's D11/G7 asked for.
//
// WHAT IT RENDERS, AND WHY THAT IS THE REAL COMPONENT
//
// `src/components/Split.jsx` and `src/index.css`, mounted by Vite — not a copy
// of the markup and not a hand-drawn depiction. The whole value of a generated
// screenshot is that it goes stale the moment the component does, and a copy of
// the markup here would be a second thing to keep in step, which is the failure
// the hand capture already had.
//
// Nothing here touches Supabase. The owner's decision of 2026-09-16, recorded on
// #452, is that these render from placeholder FIXTURES with no backend: byte
// repeatable, no mailer cost, nothing written to production. So the live-project
// cleanup clause in AC 3 ("if the command writes to the live project, it deletes
// what it created") is discharged by the command not writing there at all — the
// browser it opens is a fresh context with no credentials and no session.
//
// THE BROWSER, AND WHY `playwright-core` RATHER THAN `playwright`
//
// `playwright-core` drives the Chrome already installed on the machine
// (`channel: 'chrome'`) and downloads no browser of its own, which keeps this
// out of `npm ci`'s path and off CI's critical path. It is the recipe cairn's
// `a-persistent-browser-profile-is-not-a-fresh-context` note recorded from the
// hand capture this replaces, at the same viewport.
//
// A consequence worth stating plainly: **this command does not run in CI**,
// because the runner has no Chrome. That is the same shape as `check:live`,
// `prove:finish-race` and `migrate:live` — local, on-demand, credential- or
// machine-dependent commands that `npm test` covers the PURE parts of. The pure
// parts here are `case-study-households.mjs`, and `case-study-screenshots.test.js`
// covers them plus this file's own argument handling and PNG assertions.
//
// OUTPUT IS UNTRACKED ON PURPOSE
//
// `src/test/gate.test.js`'s image allowlist (#19's other face) permits exactly
// four tracked images — the favicon and the three PWA icons — because a
// screenshot of a running app carries a whole roster at once. These land in
// `case-study/`, which `.gitignore` lists. Committing one would redden that
// guard, and it should: the consumer copies them into madcowsailing.com, which
// is where they belong.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

import { captures } from './case-study-households.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** Where the PNGs land. `.gitignore` lists this directory; see the header. */
export const OUT_DIR = resolve(REPO, 'case-study')

/**
 * The capture viewport.
 *
 * 360x780 CSS pixels at device scale 2 — AC 1 — which Chrome renders as a
 * 720x1560 PNG. That is the size the hand captures were taken at and the size
 * madcowsailing.com's case study lays out for, and #494 records that its 2.17:1
 * aspect is why the Play listing needs a target of its own rather than reusing
 * these.
 */
export const VIEWPORT = { width: 360, height: 780 }
export const DEVICE_SCALE = 2

/**
 * Read a PNG's IHDR chunk.
 *
 * Exported and pure so the test can feed it bytes: the command asserts what it
 * wrote before claiming success, and an assertion that cannot itself be tested
 * is one nobody can trust. A PNG's IHDR is always the first chunk, so the
 * offsets are fixed — 8 bytes of signature, 4 of length, 4 of type, then width
 * and height as big-endian u32, then bit depth and colour type.
 */
export function readIhdr(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const ok = signature.every((b, i) => bytes[i] === b)
  if (!ok) throw new Error('not a PNG: the 8-byte signature does not match')
  if (bytes.slice(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error("not a PNG: the first chunk is not IHDR")
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  }
}

/**
 * What every capture must be true of, as a list of refusals.
 *
 * Returns the failures rather than throwing on the first, so one run reports
 * everything wrong with it. A checker that returns `[]` unconditionally would
 * print the same reassuring sentence as a working one, which is why
 * `case-study-screenshots.test.js` feeds this states it must REFUSE —
 * `scripts/prove-finish-race.test.js` is the house pattern for that.
 */
export function captureFaults({ name, bytes, expected = {} }) {
  const faults = []
  let ihdr
  try {
    ihdr = readIhdr(bytes)
  } catch (error) {
    return [`${name}: ${error.message}`]
  }

  const width = expected.width ?? VIEWPORT.width * DEVICE_SCALE
  const height = expected.height ?? VIEWPORT.height * DEVICE_SCALE

  if (ihdr.width !== width) faults.push(`${name}: width ${ihdr.width}, expected ${width}`)
  if (ihdr.height !== height) faults.push(`${name}: height ${ihdr.height}, expected ${height}`)
  if (ihdr.bitDepth !== 8) faults.push(`${name}: bit depth ${ihdr.bitDepth}, expected 8`)
  // Colour type 2 is 24-bit RGB with no alpha, which is what Chrome writes for
  // an opaque page and what Play's rules want (#494). Type 6 would be RGBA.
  if (ihdr.colorType !== 2 && ihdr.colorType !== 6) {
    faults.push(`${name}: colour type ${ihdr.colorType}, expected 2 (RGB) or 6 (RGBA)`)
  }
  return faults
}

/**
 * Every name-shaped thing the rendered page shows, for AC 3.
 *
 * The criterion is that every name on the capture is a placeholder, and the
 * honest way to check that is to read the text off the RENDERED page rather
 * than to trust the fixture that fed it — the fixture is what a mistake would
 * be in. Returns the display names found, so the caller can compare them with
 * what it supplied.
 */
export function unexpectedNames(shown, allowed) {
  const permitted = new Set(allowed)
  return shown.filter((name) => !permitted.has(name))
}

/**
 * Serve the built capture page.
 *
 * Vite's dev server would do, but it listens on IPv6 `localhost` only here
 * (recorded on #210) and brings a websocket client and a HMR runtime into a
 * page whose whole job is to hold still for a screenshot. A build plus this
 * 20-line static server is both simpler and more repeatable.
 */
function serve(dir) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = resolve(dir, `.${path}`)
    if (!file.startsWith(dir)) {
      res.writeHead(403).end('outside the served directory')
      return
    }
    try {
      const { readFileSync } = await import('node:fs')
      const body = readFileSync(file)
      const ext = path.slice(path.lastIndexOf('.'))
      res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }))
  })
}

/** Build the capture page with Vite, into a temporary directory. */
async function buildPage(entryDir, outDir) {
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    root: entryDir,
    plugins: [react()],
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, assetsDir: 'assets' },
    resolve: { alias: { '@repo': REPO } },
  })
}

async function main(argv = process.argv.slice(2)) {
  const only = argv.find((a) => !a.startsWith('-'))
  const wanted = captures().filter((c) => !only || c.name === only)
  if (wanted.length === 0) {
    console.error(`no capture named ${JSON.stringify(only)}; known: ${captures().map((c) => c.name).join(', ')}`)
    process.exitCode = 2
    return
  }

  // The scaffolding is built INSIDE the repo's ignored output directory, not in
  // the system temp directory. Measured: a temp-dir entry cannot resolve `react`
  // or `react/jsx-runtime` at all — module resolution walks up from the entry's
  // own path, and nothing above `%TEMP%` has a `node_modules`. Keeping it under
  // the repo makes resolution ordinary, and `case-study/` is gitignored, so
  // nothing here reaches git either way.
  const work = resolve(OUT_DIR, '.build')
  const entryDir = resolve(work, 'src')
  const buildDir = resolve(work, 'dist')
  mkdirSync(entryDir, { recursive: true })

  // The page, written out rather than kept in the repo: it is scaffolding for
  // this command and nothing else imports it. It mounts the REAL Split with the
  // REAL stylesheet, and reads which household to draw from the URL.
  writeFileSync(
    resolve(entryDir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>`,
  )
  writeFileSync(
    resolve(entryDir, 'main.jsx'),
    [
      `import { createRoot } from 'react-dom/client'`,
      `import Split from '@repo/src/components/Split.jsx'`,
      `import '@repo/src/index.css'`,
      `const props = JSON.parse(decodeURIComponent(location.hash.slice(1)))`,
      `createRoot(document.getElementById('root')).render(`,
      // The fairness note is shown DISMISSED: it is a disclosure the reader of
      // a case study has not been offered, and an open one would push the bars
      // — the subject of both pictures — down the viewport.
      `  <Split {...props} lastRebalance={null} error={null} fairnessNoteDismissed={true}`,
      `    onDismissFairnessNote={() => {}} onDealOut={() => {}} />,`,
      `)`,
    ].join('\n'),
  )

  await buildPage(entryDir, buildDir)
  const { server, port } = await serve(buildDir)

  const pw = await import('playwright-core')
  // `playwright-core` is CommonJS, so under ESM the named export arrives on the
  // namespace for some resolvers and on `.default` for others. Measured on this
  // machine: `mod.chromium` was undefined and `mod.default.chromium` was not.
  const chromium = pw.chromium ?? pw.default?.chromium
  const browser = await chromium.launch({ channel: 'chrome', headless: true })

  mkdirSync(OUT_DIR, { recursive: true })
  const faults = []
  const written = []

  try {
    for (const capture of wanted) {
      // A fresh context per capture: no cookies, no storage, no session. This
      // is what "fresh browser context" means when the tool at hand might keep
      // a profile — cairn's a-persistent-browser-profile note, whose incident
      // was a capture that opened signed in to the owner's real household.
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      })
      const page = await context.newPage()
      const hash = encodeURIComponent(JSON.stringify(capture.props))
      await page.goto(`http://127.0.0.1:${port}/#${hash}`, { waitUntil: 'load' })
      await page.waitForSelector('.split__verdict', { timeout: 15000 })

      // Read the verdict and the names OFF THE PAGE, not out of the fixture.
      const shown = await page.evaluate(() => ({
        verdict: document.querySelector('[data-testid="split-verdict"]')?.textContent?.trim() ?? '',
        names: [...document.querySelectorAll('.split__name')].map((n) => n.textContent.trim()),
      }))

      const expectedNames = capture.props.members.map((m) => m.display_name)
      const strays = unexpectedNames(shown.names, expectedNames)
      if (strays.length > 0) {
        faults.push(`${capture.name}: names on the capture that are not placeholders: ${strays.join(', ')}`)
      }
      if (shown.names.length === 0) {
        faults.push(`${capture.name}: no member names rendered at all — the household did not draw`)
      }

      // TWO framings per household, and the reason is measured rather than
      // stylistic. The split card does not fill a phone viewport: *measured on
      // this story*, the card ends at y=284.6 of 780 on the level household and
      // y=405.2 on the unreachable one, so a straight viewport capture is
      // **63.5%** and **48.1%** empty black respectively, and the two come out
      // with different content heights inside identically-sized frames.
      //
      //   <name>.png           the card alone — what the case study lays out,
      //                        and what the hand capture this replaces settled
      //                        on (cairn: "element captures of the split card
      //                        read better in a 224-px case-study column")
      //   <name>-viewport.png  the literal 360x780 at device scale 2 that AC 1
      //                        names, kept because it is the criterion's own
      //                        wording and because #494's Play target needs a
      //                        full phone frame to build on
      const card = await page.locator('.split')
      const file = resolve(OUT_DIR, `${capture.name}.png`)
      const bytes = await card.screenshot({ path: file })

      const viewportFile = resolve(OUT_DIR, `${capture.name}-viewport.png`)
      const viewportBytes = await page.screenshot({ path: viewportFile, fullPage: false })

      // The card crop has no fixed height — it is as tall as the household
      // makes it — so it is checked on the two things that ARE fixed: its width
      // is the viewport's at device scale 2, and it must be shorter than a full
      // frame, which is the whole reason this framing exists. Asserting its
      // height against its own IHDR would compare the file with itself and pass
      // on anything, including a 1px strip.
      const cardIhdr = readIhdr(bytes)
      const fullHeight = VIEWPORT.height * DEVICE_SCALE
      faults.push(
        ...captureFaults({
          name: `${capture.name} (card)`,
          bytes,
          expected: { width: VIEWPORT.width * DEVICE_SCALE, height: cardIhdr.height },
        }),
      )
      if (cardIhdr.height >= fullHeight) {
        faults.push(
          `${capture.name} (card): ${cardIhdr.height}px tall, not shorter than a full ${fullHeight}px ` +
            'frame — the card crop exists because the card does not fill the viewport',
        )
      }
      if (cardIhdr.height < 200) {
        faults.push(
          `${capture.name} (card): only ${cardIhdr.height}px tall — the card did not render its rows`,
        )
      }
      faults.push(...captureFaults({ name: `${capture.name} (viewport)`, bytes: viewportBytes }))

      written.push({
        ...capture,
        file,
        viewportFile,
        verdict: shown.verdict,
        names: shown.names,
        bytes: bytes.length,
        viewportBytes: viewportBytes.length,
      })

      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }

  console.log('Case-study screenshots — #452')
  console.log('='.repeat(78))
  const { readFileSync } = await import('node:fs')
  for (const w of written) {
    const card = readIhdr(readFileSync(w.file))
    const frame = readIhdr(readFileSync(w.viewportFile))
    console.log(`${w.name}`)
    console.log(`  ${w.what}`)
    console.log(
      `  card:     ${w.name}.png  ${card.width}x${card.height}  ` +
        `colour type ${card.colorType}  ${w.bytes} bytes`,
    )
    console.log(
      `  viewport: ${w.name}-viewport.png  ${frame.width}x${frame.height}  ` +
        `colour type ${frame.colorType}  ${w.viewportBytes} bytes`,
    )
    console.log(`  roster:   ${w.names.join(', ')}`)
    console.log(`  verdict:  ${w.verdict}`)
  }
  console.log('')
  console.log(`written to ${OUT_DIR} (untracked — gate.test.js's image allowlist permits four tracked images)`)

  if (faults.length > 0) {
    console.error('')
    console.error('FAULTS')
    for (const f of faults) console.error(`  ${f}`)
    process.exitCode = 1
    return
  }
  console.log('no faults.')
}

// Run only when invoked directly, so the test can import the pure parts above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
