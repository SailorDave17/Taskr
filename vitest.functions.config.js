import { defineConfig } from 'vitest/config'

// The Edge Function run — `npm run test:functions`.
//
// Separate from BOTH other configs, and each separation has its own reason:
//
//   vite.config.js       CI. No Docker, no Postgres, no service_role key. This
//                        suite is excluded there by pattern, not by a skip.
//   vitest.integration   `npm run test:rls`, which includes every
//     .config.js         *.integration.test.js — and rls.integration.test.js
//                        still targets the model #62 retired, so that runner is
//                        known-red until #88 migrates it. Sharing a runner would
//                        make this story's result unreadable.
//
// Target is the LOCAL stack (`npx supabase start`), never the hosted project:
// provisioning creates auth users, and a test must not do that to production.

export default defineConfig({
  test: {
    include: ['src/**/*.functions.test.js'],
    environment: 'node',
    passWithNoTests: false,
    // Real HTTP to a local edge runtime, plus GoTrue signups.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test builds its own household, but they share one Auth instance and
    // one rate limiter; serial keeps the failures legible.
    fileParallelism: false,
  },
})
