// Which actions does the DEPLOYED `provision-member` actually accept? — #191.
//
//     npm run probe:provision-actions
//
// WHAT THIS ANSWERS THAT `check:deployed` STRUCTURALLY CANNOT
//
// `npm run check:deployed` ranks a deploy timestamp against a source-commit
// timestamp. That answers *which clock reads later*, never *what code is running*
// — and this repo has now recorded THREE different false verdicts out of that one
// instrument, all presenting as the identical STALE string: a test-only commit
// moving the directory's mtime (2026-09-04), a deploy racing its own commit by
// 112 seconds (2026-09-08), and a `-04:00` offset read as local time, which
// inverts the comparison outright (2026-09-15).
//
// Worse, the repair does not settle it either. `npm run deploy:function` buys a
// CURRENCY answer and nothing more: the CLI bundles the eszip and therefore owns
// `ezbr_sha256`, so a moved hash does not imply changed source. After a redeploy
// you know the timestamps agree. You still do not know what the function does.
//
// This asks the function. #191 retired the `provision` action — `ACTIONS` is
// `invite`, `reset`, `revoke`, and `createUser` is gone from every function file
// — so the deployed artefact either refuses `provision` or it does not, and that
// is an observation rather than an inference.
//
// WHY THERE IS A NEGATIVE CONTROL, AND WHY IT IS THE WHOLE POINT
//
// "`provision` was refused" is worthless on its own. A function that is down, a
// project ref that is wrong, a malformed body, an expired key — every one of them
// refuses `provision` too, and refuses it in a way that reads exactly like
// success. **A probe that reports a refusal everywhere cannot report a
// retirement.**
//
// So this sends a KNOWN-LIVE action in the same run, over the same transport,
// with the same credential. `revoke` is the control: it survived #191, so the
// function must get PAST the action check when it sees it.
//
// What "past" looks like is a fact about this handler's ordering, and it is not
// the obvious one. `handler.ts` validates in this order: unknown action (400,
// the action list) → missing `memberId` (400, "memberId is required.") → identity
// ("Sign in first.", 401) → organizer ("Only the household organizer can do
// that.", 403). ARGUMENTS ARE CHECKED BEFORE IDENTITY. So an anonymous call
// carrying no member id never reaches 401 at all — it stops one branch earlier.
//
//   provision -> 400 "action must be ..."      (retired: unknown action)
//   revoke    -> 400 "memberId is required."   (alive: recognised, wants args)
//
// The two messages are mutually exclusive and that is the whole discrimination:
// the unknown-action branch RETURNS before argument validation, so a function
// that did not know `revoke` could not possibly ask for its member id. A
// recognised action is proof the transport, the credential and the function are
// all fine.
//
// (This probe first asserted the control must read 401/403 — reasoning about
// what a refusal "should" look like instead of reading the handler. It refused
// its own correct measurement on the first run. The predicate below now names
// the branch it actually expects.)
//
// If both come back 400-with-the-action-list, the retirement reading is
// unsupported: something ahead of the action check is refusing everything, and
// this says so rather than printing a green line.
//
// IS THIS SAFE TO RUN AGAINST PRODUCTION?
//
// Yes, and for a reason stronger than intent. It sends the anon key and no user
// JWT, so every request is unauthenticated by construction — `provision-member`
// checks the caller is an organizer of the named household before it writes
// anything, and an anonymous caller clears no such check. The bodies carry no
// member id, no household id and no address, so there is nothing to act on even
// if authorization were somehow satisfied. It takes no arguments, so there is no
// input that could make it write.
//
// The one thing to know: `revoke` is EXPECTED to be refused here. A run that
// reported it accepted would mean the function authorized an anonymous caller,
// which is a finding of a different and much louder kind — and this refuses on
// it rather than treating it as the control passing.

import { pathToFileURL } from 'node:url'

import { resolveSupabaseUrl } from './deploy-function.mjs'
import { Refusal, readEnvLocal } from './management-api.mjs'

/** The function under test. */
export const FUNCTION_NAME = 'provision-member'

/**
 * The action #191 retired. Named here rather than imported: the point of this
 * probe is to compare the DEPLOYED artefact against what the repo believes, so
 * taking the name from the repo's own source would make the two agree by
 * construction.
 */
export const RETIRED_ACTION = 'provision'

/**
 * The control action — alive after #191, and the reason a refusal of
 * `provision` means anything at all.
 */
export const CONTROL_ACTION = 'revoke'

/**
 * How `provision-member` refuses an action it does not know: a 400 whose body
 * enumerates the surviving actions (`handler.ts`, the `ACTIONS` check).
 *
 * Matching on the enumeration rather than on a status code alone is deliberate.
 * A 400 by itself is also what a malformed body earns, and those two mean
 * opposite things here.
 */
export function readsAsUnknownAction(status, body) {
  if (status !== 400) return false
  const text = String(body ?? '')
  return text.includes('action must be')
}

/**
 * How the function refuses a KNOWN action that it recognised but cannot act on.
 *
 * `handler.ts` checks arguments BEFORE identity, so the deepest an anonymous,
 * argument-less call can reach is the `memberId` branch. Reaching it is the
 * proof the control exists for: the unknown-action branch returns earlier, so a
 * function that did not know this action could never ask for its member id.
 *
 * A 401/403 counts too — that is the same "recognised, then refused" reading one
 * branch deeper, and it is what a call WITH a member id would earn.
 */
export function readsAsRecognisedAction(status, body) {
  const text = String(body ?? '')
  if (status === 401 || status === 403) return text.length > 0
  if (status !== 400) return false
  // Recognised-but-unsatisfied, and explicitly NOT the unknown-action message.
  return !readsAsUnknownAction(status, text) && text.length > 0
}

/** Reads `VITE_SUPABASE_ANON_KEY` the same way the deploy script reads the URL. */
export function resolveAnonKey(env, readFile) {
  if (env.VITE_SUPABASE_ANON_KEY) return String(env.VITE_SUPABASE_ANON_KEY).trim()
  try {
    const match = String(readFile()).match(/^VITE_SUPABASE_ANON_KEY=(.*)$/m)
    return match ? match[1].trim() : ''
  } catch {
    return ''
  }
}

/** One unauthenticated POST naming an action. Returns `{ status, body }`. */
export async function postAction(url, anonKey, action, fetchImpl = fetch) {
  const response = await fetchImpl(`${url}/functions/v1/${FUNCTION_NAME}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ action }),
  })
  return { status: response.status, body: (await response.text()).slice(0, 400) }
}

/**
 * The verdict, as a pure function of the two readings, so a test can drive it
 * without a network.
 */
export function verdictFrom(retired, control) {
  const retiredRefused = readsAsUnknownAction(retired.status, retired.body)
  const controlRecognised = readsAsRecognisedAction(control.status, control.body)
  const controlAlsoUnknown = readsAsUnknownAction(control.status, control.body)

  if (controlAlsoUnknown) {
    return {
      ok: false,
      reason:
        `both \`${RETIRED_ACTION}\` and the control \`${CONTROL_ACTION}\` read as UNKNOWN ACTION.\n\n` +
        'That is not a retirement reading. A deployed function that knows neither\n' +
        'action is a function older than #191 in a different way, or a different\n' +
        'function entirely. Check the project ref and redeploy before reading\n' +
        'anything into the `provision` result.',
    }
  }
  if (!controlRecognised) {
    return {
      ok: false,
      reason:
        `the control \`${CONTROL_ACTION}\` was not RECOGNISED (got ${control.status}).\n\n` +
        'The control exists to prove a refusal of `provision` is about the ACTION\n' +
        'rather than about the transport, the credential or the function being\n' +
        'down. A recognised action earns a refusal about its ARGUMENTS or about\n' +
        'IDENTITY; this earned neither, so nothing can be read into the\n' +
        '`provision` result.\n\n' +
        'If it reads 2xx, an anonymous caller was AUTHORIZED — a much louder\n' +
        'finding than the one this was written for.',
    }
  }
  if (!retiredRefused) {
    return {
      ok: false,
      reason:
        `\`${RETIRED_ACTION}\` was NOT refused as an unknown action (got ${retired.status}).\n\n` +
        'The control passed, so the transport and the credential are fine and the\n' +
        'function is answering. This is the real reading: the DEPLOYED function\n' +
        'still knows the action #191 retired. `check:deployed` can read 8 of 8\n' +
        'current and this still be true — a timestamp is not the code.\n\n' +
        'The fix is `npm run deploy:function`, then run this again.',
    }
  }
  return { ok: true }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

export async function main(env = process.env) {
  const url = resolveSupabaseUrl(env, readEnvLocal)
  const anonKey = resolveAnonKey(env, readEnvLocal)
  if (!anonKey) {
    throw new Refusal(
      'no VITE_SUPABASE_ANON_KEY, so there is nothing to call the function with.\n\n' +
        'This probe deliberately uses the ANON key and no user JWT — every request\n' +
        'it sends is unauthenticated by construction, which is what makes it safe\n' +
        'to run against production. Set it in `.env.local` or the environment.',
    )
  }

  const retired = await postAction(url, anonKey, RETIRED_ACTION)
  const control = await postAction(url, anonKey, CONTROL_ACTION)

  console.log(`\n${FUNCTION_NAME} on ${url}\n`)
  console.log(`  ${RETIRED_ACTION.padEnd(10)} -> ${retired.status}  ${retired.body}`)
  console.log(`  ${CONTROL_ACTION.padEnd(10)} -> ${control.status}  ${control.body}\n`)

  const verdict = verdictFrom(retired, control)
  if (!verdict.ok) throw new Refusal(verdict.reason)

  console.log(
    `The deployed function REFUSES \`${RETIRED_ACTION}\` as an unknown action, while the\n` +
      `control \`${CONTROL_ACTION}\` got PAST that branch and was refused further in —\n` +
      'so the refusal is about the action, not about the transport, the\n' +
      "credential, or the function being down. #191's retirement is live.\n",
  )
}

if (isMain) {
  try {
    await main(process.env)
  } catch (error) {
    // `process.exitCode`, never `process.exit()` — see `Refusal` in
    // scripts/management-api.mjs.
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}
