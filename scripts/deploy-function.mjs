// Deploy the provisioning Edge Function — #112.
//
// WHY THIS IS A SCRIPT AND NOT A LINE IN A RUNBOOK
//
// The correct invocation is about ninety characters. Twice on 2026-08-20 it was
// copied out of a document into a narrow terminal, wrapped, and ran as two
// commands — the second of which was a bare `--use-api`, which cmd.exe reports
// as an unrecognised command. Both times the deploy did not happen and the
// terminal said nothing about a deploy at all.
//
// That is not a typing problem, it is a delivery problem: a command that only
// exists as prose has to be transcribed correctly every time by whoever is
// least likely to know what the flags mean. `npm run deploy:function` is short
// enough that no terminal wraps it, and the flags stop being something a person
// carries.
//
// WHY THE PROJECT REF IS DERIVED RATHER THAN WRITTEN DOWN
//
// It comes out of `VITE_SUPABASE_URL` — the same value the browser client is
// built against — for the reason `LIVE_SCHEMA` imports its column lists instead
// of restating them: a copied value drifts from its source, and this particular
// drift is invisible. Deploying to the wrong project succeeds, prints success,
// and leaves the app failing exactly as it did before, because the function the
// browser calls is still absent. There would be nothing to see.
//
// WHAT THE FLAGS ARE FOR
//
// `--project-ref` makes a separate `supabase link` unnecessary, so there is one
// command rather than two and no stored state to be stale.
// `--use-api` bundles server-side, so Docker is not required — worth keeping,
// because "Docker's daemon is down on the build machine" was recorded in this
// repo, twice, as the reason this deploy never happened.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The Edge Function this deploys. One place, matching `LIVE_EDGE_FUNCTIONS`. */
export const FUNCTION_NAME = 'provision-member'

/**
 * `https://abcdefgh.supabase.co` → `abcdefgh`.
 *
 * Refuses rather than guesses. A wrong ref deploys successfully to somewhere
 * nobody is looking, so every failure mode here must be loud: an absent value, a
 * value that is not a Supabase URL, and a local stack URL (which has no project
 * ref at all and would otherwise yield `127`).
 */
export function projectRefFrom(url) {
  const value = String(url ?? '').trim()
  if (!value) throw new Error('VITE_SUPABASE_URL is not set.')
  const match = value.match(/^https:\/\/([a-z0-9]{16,})\.supabase\.(co|in)\/?$/i)
  if (!match) {
    throw new Error(
      `VITE_SUPABASE_URL is not a hosted Supabase project URL: ${value}\n` +
        'A local stack (127.0.0.1) has no project ref — deploy targets the hosted project only.',
    )
  }
  return match[1]
}

/** `KEY=value` lines, enough for a two-line .env.local and no more. */
export function parseEnvFile(text) {
  const out = {}
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) out[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

/** The environment first, then `.env.local`, which is gitignored and holds the real value. */
export function resolveSupabaseUrl(env, readFile) {
  if (env.VITE_SUPABASE_URL) return env.VITE_SUPABASE_URL
  try {
    return parseEnvFile(readFile()).VITE_SUPABASE_URL ?? ''
  } catch {
    return ''
  }
}

// `pathToFileURL` rather than string-building the URL: on Windows
// `import.meta.url` is `file:///C:/...` with three slashes while a hand-built
// `file://` + path has two, so the comparison silently fails, this whole block
// never runs, and the script exits 0 having deployed nothing - which is the
// precise failure it exists to prevent. Caught by the dry run, not by review.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isMain) {
  const url = resolveSupabaseUrl(process.env, () =>
    readFileSync(resolve(process.cwd(), '.env.local'), 'utf8'),
  )

  let ref
  try {
    ref = projectRefFrom(url)
  } catch (error) {
    console.error(`\nCannot work out which project to deploy to.\n\n${error.message}\n`)
    console.error('Set VITE_SUPABASE_URL in .env.local, or in the environment.\n')
    process.exit(1)
  }

  const args = [
    'supabase',
    'functions',
    'deploy',
    FUNCTION_NAME,
    '--project-ref',
    ref,
    '--use-api',
  ]

  console.log(`\nproject : ${ref}   (derived from VITE_SUPABASE_URL)`)
  console.log(`command : npx ${args.join(' ')}\n`)

  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run: nothing was deployed.\n')
    process.exit(0)
  }

  // `shell: true` because `npx` on Windows is a .cmd shim, which cannot be
  // spawned directly. The arguments are not user input — the only variable is a
  // project ref already matched against a strict pattern above.
  const child = spawn('npx', args, { stdio: 'inherit', shell: true })
  child.on('exit', (code) => {
    if (code === 0) {
      console.log('\nDeployed. Confirm with:  npm run check:live')
      console.log('It reads 19 of 20 before this lands and 20 of 20 after.\n')
    }
    process.exit(code ?? 1)
  })
}
