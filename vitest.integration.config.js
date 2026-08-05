import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The integration run — `npm run test:rls`. Separate from vite.config.js because
// this suite needs credentials and a network, which the CI gate deliberately has
// neither of. See the header of src/test/rls.integration.test.js for why it is
// excluded rather than made to skip.

// Vitest does not put .env values on process.env by default, and the test reads
// them from there rather than from import.meta.env so that it can also be run
// with the variables exported in a shell. Prefix '' loads every key, not just
// VITE_ ones.
const env = loadEnv('development', process.cwd(), '')
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value
}

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.js'],
    environment: 'node',
    passWithNoTests: false,
    // Real network round trips against a free-tier project.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The claim-race assertions depend on ordering within one household.
    fileParallelism: false,
  },
})
