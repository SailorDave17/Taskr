// Deploy this repo's Edge Functions — #112, extended by #95 to a list.
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

/**
 * The Edge Functions this deploys. One place, matching `LIVE_EDGE_FUNCTIONS`.
 *
 * A LIST since #95 added `calendar-connect`, and deploying all of them by
 * default is the deliberate choice. The alternative — requiring a name — makes
 * the safe, complete action the one with more typing, and this script exists
 * because a command with more typing is a command that gets got wrong. Re-
 * deploying a function that has not changed costs a few seconds and changes
 * nothing observable, so there is no reason to make somebody choose.
 *
 * `npm run deploy:function -- <name>` narrows it when that is genuinely wanted.
 */
export const FUNCTION_NAMES = Object.freeze([
  'provision-member',
  'calendar-connect',
  // #96. Deploying it is the other half of `0030` — the migration creates the
  // table this function is the only writer of, and neither action does anything
  // useful without the other.
  'calendar-busy',
])

/**
 * Functions the CLIENT already invokes that the tree does not carry yet — #210.
 *
 * The capacity capture flow calls `extract-description` (`src/lib/capture.js`)
 * ahead of #208 writing the function, by owner decision at that story's
 * pickup (2026-09-04). `LIVE_EDGE_FUNCTIONS` lists what the app invokes, so it
 * carries the name and `check:live` reads one honest red until #209 deploys
 * it. THIS list is what keeps that red from becoming a failed deploy: a bare
 * `npm run deploy:function` deploys `FUNCTION_NAMES` and not these, and naming
 * one on the command line is refused with a sentence that says why.
 *
 * SELF-EXPIRING. `deploy-function.test.js` refuses an entry here whose
 * directory EXISTS, so the day #208 lands `supabase/functions/extract-description/`
 * the suite reddens until the name moves up into `FUNCTION_NAMES` — the
 * exemption cannot outlive the gap it was written for.
 */
export const PENDING_FUNCTIONS = Object.freeze(['extract-description'])

/**
 * Which functions this invocation should deploy.
 *
 * REFUSES an unknown name rather than passing it to the CLI. A typo would
 * otherwise reach `supabase functions deploy`, which fails with its own message
 * about a directory — sending somebody to look at the filesystem rather than at
 * what they typed.
 */
export function functionsToDeploy(argv, known = FUNCTION_NAMES, pending = PENDING_FUNCTIONS) {
  const named = argv.filter((arg) => !arg.startsWith('-'))
  if (named.length === 0) return [...known]

  // #210 — a name the client calls and the tree does not carry. Refused with
  // the reason rather than folded into "no such function", because the person
  // typing it has just read that name in `check:live`'s red line.
  const notYet = named.filter((name) => pending.includes(name))
  if (notYet.length) {
    throw new Error(
      `${notYet.join(', ')}: named by the client but not in this tree yet — ` +
        'the endpoint is #208 and its deploy is #209. Nothing to deploy.',
    )
  }

  const unknown = named.filter((name) => !known.includes(name))
  if (unknown.length) {
    throw new Error(
      `No such Edge Function in this repo: ${unknown.join(', ')}.\n` +
        `Known functions: ${known.join(', ')}.`,
    )
  }
  return named
}

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
      `VITE_SUPABASE_URL is not a hosted Supabase project URL: ${redactForRefusal(value)}\n` +
        'A local stack (127.0.0.1) has no project ref — deploy targets the hosted project only.',
    )
  }
  return match[1]
}

/** The most of a value any refusal here may quote back. */
export const REFUSAL_VALUE_LIMIT = 80

/**
 * Everything a refusal is allowed to SAY about a value it was handed - #285.
 *
 * A refusal is right to name what it saw; it must never say more than the one
 * value it was asked about. During #52 a `projectRefFrom` refusal printed the
 * WHOLE of `.env.local` - `SUPABASE_ACCESS_TOKEN` and `TASKR_TEST_PASSWORD`
 * included - because the "value" it interpolated was the entire file.
 *
 * Three rules, in order, each closing a different route to that:
 *
 *   1. ONE LINE. A value spanning lines is not one variable's value, so
 *      everything after the first newline is by construction something this
 *      function was not asked about, and is never quoted.
 *   2. NO ASSIGNMENTS. If what arrived looks like env-file content - a line
 *      beginning `NAME=` - the VALUE is elided and the NAME kept. A caller that
 *      handed us a file needs to be told it handed us a file; it does not need
 *      the file read back to it. This is the rule that holds when the secret is
 *      on line ONE, which is exactly where rule 1 and the cap both fail.
 *   3. A LENGTH CAP, so one enormous line cannot fill a terminal.
 *
 * All three are STRUCTURAL: none carries a list of secret variable names, so
 * none goes stale when a new secret joins `.env.local` - which happens next
 * (#206 adds `ANTHROPIC_API_KEY`). Redacting BY NAME was the other candidate
 * and the one #285's body suggested; it was rejected because a guard whose
 * subject is what a variable is CALLED must be edited every time somebody adds
 * one, and the edit that gets forgotten is the silent one. A name list written
 * today would not have covered `ANTHROPIC_API_KEY`, and nothing would have said so.
 *
 * A legitimate Supabase URL passes all three untouched, which is what keeps the
 * refusal diagnostic - asserted as a POSITIVE CONTROL, because a sanitiser that
 * ate every value would pass every leak test here while helping nobody.
 */
export function redactForRefusal(value) {
  const text = String(value ?? '')
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  const deassigned = firstLine.replace(/^([ \t]*[A-Z][A-Z0-9_]{2,}[ \t]*=).*$/, '$1<redacted>')
  const capped =
    deassigned.length > REFUSAL_VALUE_LIMIT
      ? deassigned.slice(0, REFUSAL_VALUE_LIMIT) + '...'
      : deassigned
  return capped === text ? capped : capped + ' [truncated]'
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

  let names
  try {
    names = functionsToDeploy(process.argv.slice(2))
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const commandFor = (name) => [
    'supabase',
    'functions',
    'deploy',
    name,
    '--project-ref',
    ref,
    '--use-api',
  ]

  console.log(`\nproject   : ${ref}   (derived from VITE_SUPABASE_URL)`)
  console.log(`functions : ${names.join(', ')}`)
  for (const name of names) console.log(`command   : npx ${commandFor(name).join(' ')}`)
  console.log('')

  if (process.argv.includes('--dry-run')) {
    console.log('--dry-run: nothing was deployed.\n')
    process.exit(0)
  }

  // ONE AT A TIME, and stopping at the first failure rather than carrying on.
  // The CLI takes a single function name, and a loop that pressed on would end
  // with a success line under a failure — the shape this script exists to
  // prevent, since a deploy that did not happen must never read as one that did.
  //
  // `shell: true` because `npx` on Windows is a .cmd shim, which cannot be
  // spawned directly. The arguments are not user input — the only variables are
  // a project ref already matched against a strict pattern above and a name
  // already checked against the list in this file.
  const deployNext = (remaining) => {
    if (remaining.length === 0) {
      console.log('\nDeployed. Confirm with:  npm run check:live')
      console.log('Every Edge Function line in it goes green only once that name is deployed.\n')
      process.exit(0)
    }
    const [name, ...rest] = remaining
    const child = spawn('npx', commandFor(name), { stdio: 'inherit', shell: true })
    child.on('exit', (code) => {
      if (code !== 0) {
        console.error(`\nDeploy of ${name} failed (exit ${code}). Stopping.\n`)
        process.exit(code ?? 1)
      }
      deployNext(rest)
    })
  }
  deployNext(names)
}
