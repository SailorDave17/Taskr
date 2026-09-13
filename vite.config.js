import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { assertPublishableKey } from './src/lib/keyShape.js'

// Refuse to build at all if the key destined for the client bundle is a SECRET
// key. This runs on the hosting provider's builder, which is the only place the
// real value exists — the variable lives in a dashboard, outside this repo, so
// no test or review could catch it.
//
// Measured 2026-08-05: VITE_SUPABASE_ANON_KEY was set to a `sb_secret_…` key
// and shipped into a world-readable preview bundle. A secret key bypasses
// row-level security, so the app worked perfectly and nothing failed. Failing
// the build is the only signal available at the point it can still be stopped.
//
// #95 widened it to a second enumerated variable (a Google client SECRET is
// one console line away from the client ID that legitimately lives in
// `VITE_GOOGLE_CLIENT_ID`, and pasting the wrong one produces a build that
// WORKS). #203 widened it again, from an enumerated list to EVERY
// `VITE_`-prefixed variable: the Anthropic key the extraction adapter's
// transport needs would arrive under a name no list here has heard of, and a
// guard keyed on names covers exactly the mistakes already made. `VITE_` is
// the property that makes a value reach the bundle, so `VITE_` is what the
// guard keys on.
//
// One exclusion, and it is for values NOBODY pasted. With "System Environment
// Variables" enabled, Vercel injects its own metadata under the framework's
// public prefix — `VITE_VERCEL_ENV`, `VITE_VERCEL_GIT_COMMIT_SHA`, and
// `VITE_VERCEL_GIT_COMMIT_MESSAGE`, which is free text quoting this repo's own
// vocabulary. *Measured 2026-09-05* (PR #346): a commit message that said
// "deleting its service_role grants" was classified as a Supabase secret and
// the Preview build refused, while CI — which has no such variable — stayed
// green. The guard exists for a human pasting the wrong key into a dashboard;
// a value Vercel wrote is not that, and the classifier knows no Vercel secret
// shape it could recognise there anyway. Reproduced locally with
// `VITE_VERCEL_GIT_COMMIT_MESSAGE="$(git log -1 --format=%B)" npx vite build`.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('VITE_VERCEL_')) continue
  if (name.startsWith('VITE_')) assertPublishableKey(value, `the production build (${name})`)
}

// The install target is Android Chrome only — the household is single-platform
// (owner-confirmed at pickup of #4). iOS Safari meta tags are deliberately absent
// rather than added speculatively; see docs/hosting-decision.md.
// Which commit is live. Vercel sets VERCEL_GIT_COMMIT_SHA at build time; it is
// not VITE_-prefixed, so it does not reach the client on its own. Mapping it in
// is what makes #4's "the deployed URL updates" observable at all — without it
// a docs-only change produces a byte-identical bundle and a deploy is
// indistinguishable from no deploy. Empty locally, which is the point: 'local'
// tells you that you are not looking at a hosted build.
const commitSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(commitSha),
  },
  plugins: [
    react(),
    VitePWA({
      // #347 — `prompt`, with registration done by `src/lib/appUpdate.js`
      // through the plugin's client module. Until #347 this read `autoUpdate`
      // with the default `injectRegister`, which shipped a worker that took
      // control of an open page while the page went on running the OLD
      // JavaScript: the reload lives in `virtual:pwa-register`, and nothing
      // imported it. Two facts read from the plugin's source decide the
      // shape. Its `autoUpdate` client reloads on an update unconditionally,
      // so it cannot wait for somebody to finish typing. And it sets the
      // worker's `skipWaiting`/`clientsClaim` ONLY while `injectRegister` is
      // `auto` or unset (`dist/index.js`), so turning the inline registration
      // off under `autoUpdate` would have left a new worker waiting forever.
      // Under `prompt` the worker waits on purpose, workbox emits the
      // SKIP_WAITING handler, and the app decides when to take the update.
      registerType: 'prompt',
      // One registration path: the app's. `false` stops the plugin emitting
      // `registerSW.js` and its `<script id="vite-plugin-pwa:register-sw">`,
      // which src/test/pwaBuild.test.js refuses in a real build.
      injectRegister: false,
      // #347 — and the new worker claims open pages it does not yet control.
      // Measured on #347 without it: a page on its FIRST visit (no worker
      // controlled it when it loaded) found an update, the app took it, the new
      // worker activated — and the page was never taken over, so it went on
      // running the old build until it navigated. `clientsClaim` makes the
      // takeover reach that page too; the SKIP_WAITING handler still decides
      // WHEN, and src/lib/appUpdate.js reloads that one page itself, because
      // the plugin only reloads a page that had a controller at registration.
      workbox: { clientsClaim: true },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Taskr',
        short_name: 'Taskr',
        description: 'Fair, time-budget allocation of household chores',
        theme_color: '#1f6f5c',
        background_color: '#12171c',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // AC 4: a suite with zero tests must FAIL, not pass vacuously. This is
    // Vitest's default, but it is set explicitly because a default can change
    // under us and a check that cannot fail is worse than none.
    passWithNoTests: false,
    // The RLS test (#5 AC 6) talks to a live Supabase project and CI has no
    // credentials for one. It is excluded here, and run by `npm run test:rls`
    // against vitest.integration.config.js — never made to skip itself, because
    // a security test that quietly passes when unconfigured is the same defect
    // as a gate with zero tests in it. The exclusion is stated in-band, in
    // src/test/rls.integration.test.js and docs/access-model.md, so a reader
    // counting the checks does not mistake four for five.
    // The same argument covers `*.functions.test.js` (#87), which drives the
    // Edge Function against a LOCAL Supabase stack — it needs Docker, Postgres,
    // GoTrue and a service_role key, none of which CI has. It is loud rather
    // than skipped for the same reason: its beforeAll FAILS with instructions
    // when the stack is down. `npm run test:functions`, against
    // vitest.functions.config.js. It is a third runner rather than joining the
    // integration one because that config includes rls.integration.test.js,
    // which needs a hosted project and a seeded account while this one needs a
    // LOCAL stack and a service_role key — two different environments, so one
    // runner would be unsatisfiable by either. (#88 migrated that file off the
    // retired model on 2026-08-21; it is no longer known-red, and this reason
    // is the one that survives.)
    exclude: [
      ...configDefaults.exclude,
      '**/*.integration.test.js',
      '**/*.functions.test.js',
    ],
    // Pin a NON-UTC zone. Dates here are calendar dates (`chores.due_on`), and
    // the classic fault is a Date round-trip that parses YYYY-MM-DD as UTC
    // midnight and formats it back with local getters — returning the previous
    // day everywhere behind UTC, and INVISIBLE in UTC itself.
    //
    // Measured 2026-08-08 (#34): mutating normalizeDueDate to do exactly that
    // reddened 3 tests on a GMT-0400 machine and ZERO under TZ=UTC. CI runs
    // UTC, so without this pin the guard exists and cannot fire on the runner
    // that actually gates the branch — the same defect shape as a suite with
    // zero tests in it, which is why the pin sits beside passWithNoTests and is
    // asserted by src/test/gate.test.js rather than left to trust.
    //
    // Marquesas rather than America/New_York since #75, for three properties at
    // once. It is BEHIND UTC, which is the side of UTC where the local-getter
    // fault shows at all — the issue floated Pacific/Chatham (+12:45), and
    // measured, UTC midnight in Chatham is 12:45 the SAME day, so the very bug
    // this pin exists to expose is invisible there. It is 30 minutes off the
    // hour, which whole-hour zones cannot check. And no developer machine is
    // plausibly in it, which is the #75 fix itself: the positive control in
    // gate.test.js compares the process zone against this value, and that
    // comparison only discriminates when the machine's own zone is something
    // else. America/New_York was the one zone guaranteed to defeat it here.
    //
    // Measured 2026-08-24 (#75): the same normalizeDueDate mutation under this
    // pin reddens 5 tests (the suite has grown since #34) and the same run
    // under TZ=UTC still reddens ZERO — the bar the zone change had to clear.
    env: { TZ: 'Pacific/Marquesas' },
  },
})
