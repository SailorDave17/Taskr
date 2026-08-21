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
assertPublishableKey(process.env.VITE_SUPABASE_ANON_KEY, 'the production build')

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
      registerType: 'autoUpdate',
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
    env: { TZ: 'America/New_York' },
  },
})
