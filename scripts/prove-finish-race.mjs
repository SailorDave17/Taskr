// Two phones pressing Done at the same instant, against the LIVE project — #356.
//
//     npm run prove:finish-race
//
// WHAT THIS ANSWERS THAT NOTHING ELSE IN THE REPO CAN
//
// `finish_shopping_run` (`0033`, #354) closes a list's open run and opens the
// next one with every unbought item carried forward, in one transaction under
// `select … for update`. The property the epic protects is "exactly one next
// list, nothing lost", and the hard case for it is two callers arriving at the
// same run at the same moment.
//
// `finish-shopping-run.pglite.test.js` cannot reach that case, and the reason is
// structural rather than a gap somebody could close: pglite is ONE connection.
// It runs the two calls back to back, so what it proves is that a SECOND caller
// arriving after the first has committed is refused — the stale-screen case. The
// row lock in the middle of the function is never contended there, because there
// is nothing to contend with. A test that ran the two calls sequentially and
// called the result a race would be measuring the guard, not the lock.
//
// So this script talks to the hosted project over the wire, with two independent
// authenticated clients, and issues both calls before awaiting either.
//
// WHY "EXACTLY ONE WINNER" IS NOT ON ITS OWN A PROOF OF ANYTHING NEW
//
// This is the trap the whole design is built around, and it is worth stating
// before the numbers rather than after them. A pair of calls that the platform
// happened to run ONE AFTER THE OTHER produces exactly the same outcome as a
// genuine race: one new run, one `run already closed`. That outcome is precisely
// what pglite already demonstrates. So a script that asserted only the outcome
// would report ten green repetitions and prove nothing this repo did not already
// know — a clean result whichever world it is in, which is the shape cairn's
// `prove-an-instrument-could-have-shown-the-opposite` records.
//
// **There is exactly ONE piece of evidence for concurrency here, and it is
// database-side.** The WITNESS phase catches the lock wait in `pg_stat_activity`
// while it is happening. A normal finish is over in tens of milliseconds, far
// inside one Management API round trip, so the witness fixture is deliberately
// FAT — the run is bulk-loaded with `WITNESS_ITEMS` rows through the Management
// API, which makes the carry take long enough to sample. What a hit looks like:
// **one sample** holding two distinct ACTIVE backends running
// `finish_shopping_run`, with a `Lock` wait among them. That is the interleaving
// itself, read out of the server, and it is the one observation separating this
// run from a sequential pair.
//
// A miss is reported as a miss. The window is real and the sampler can be too
// slow; what must never happen is a missed witness being quietly folded into the
// ten green repetitions and read as if it had been seen. A sample that FAILED is
// counted apart from one that came back empty, for the same reason — an
// apparatus that never asked and one that asked and saw nothing otherwise print
// identically (cairn: `an-absent-result-reads-as-a-clean-one`).
//
// **What is deliberately NOT evidence**: the client-side in-flight overlap. A
// first draft offered it as a cheap "necessary but not sufficient" second
// signal, and review established it is structurally always true — see
// `overlapOf` for why. Its timings are still printed, because durations are
// worth reading; none of them is a claim about concurrency.
//
// THE SECOND CASE — a purchase racing a finish (recorded, not an AC)
//
// `0033` also replaced `0032`'s three item writers so each takes `for key share`
// on the RUN row before it touches an item, which serialises a tick against a
// finish. A single pglite connection can see that only in the catalog. The same
// harness reaches it for free, so it is measured here and reported beside the
// story's own criteria (owner decision at this story's pickup, 2026-09-06). Its
// invariant is one sentence and it holds whichever side wins: every item on the
// closed run is EITHER bought there OR carried forward exactly once — never both
// (the household would buy it twice) and never neither (it would be lost).
//
// WHAT THE FIXTURE IS, AND WHY IT IS ITS OWN HOUSEHOLD
//
// The seeded account (`TASKR_TEST_EMAIL`, the `test:rls` precondition) creates a
// throwaway household, and everything this script writes lives inside it. Two
// reasons, and the second is the one that decides it:
//
//   * a client holds NO delete grant on `shopping_lists` or `shopping_runs` — it
//     may delete an unbought item on an open run and nothing else — so the
//     fixture cannot be tidied up from the client whatever shape it takes, and
//     cleanup goes through the Management API regardless;
//   * with the fixture in a household of its own, cleanup is ONE delete and one
//     absence to verify. Everything below cascades from `households` (`0001`,
//     `0032`), so nothing can be missed by forgetting to name it.
//
// The token is proven ALIVE before the first write, not at cleanup time. A dead
// token discovered in the `finally` would leave a household nothing in this repo
// can delete, which is the state the whole cleanup exists to avoid.
//
// SAFE TO RUN AGAINST PRODUCTION?
//
// It writes, so it is not `probe:live-grants`. What it writes is confined to a
// household it creates and deletes: no existing household, list, run or item is
// read or touched, no auth user is created (the seeded account already exists
// and is only signed in), and nothing outside `public.households`' cascade is
// named. Cleanup runs in a `finally` and is verified by a read; a failed cleanup
// exits non-zero naming the household id, so a leftover is loud rather than
// discovered later (cairn: `a-rehearsal-is-verified-after-its-cleanup`).

import { pathToFileURL } from 'node:url'

import { createClient } from '@supabase/supabase-js'

import { addItem, createList, finishRun, purchaseItem, readShopping } from '../src/lib/shopping.js'
import { parseEnvFile, projectRefFrom, resolveSupabaseUrl } from './deploy-function.mjs'
import {
  Refusal,
  explainHttpFailure,
  readEnvLocal,
  requireAccessToken,
  resolveAccessToken,
  runQuery,
} from './management-api.mjs'

// ---------------------------------------------------------------------------
// The shape of the run. Exported so the tests below assert against the same
// numbers the script uses rather than a second copy of them.
// ---------------------------------------------------------------------------

/** AC 4: ten repetitions against fresh fixtures, all producing the same counts. */
export const REPETITIONS = 10

/** AC 1: one list, one open run, three unpurchased items. */
export const FIXTURE_ITEMS = Object.freeze(['first', 'second', 'third'])

/** How many purchase-versus-finish repetitions the recorded second case runs. */
export const PURCHASE_REPETITIONS = 5

/**
 * How many rows the witness run carries.
 *
 * Big enough that the carry — an `insert … select … for update` over every one
 * of them — outlasts a Management API round trip, which is the only way a
 * sampler can catch the second caller waiting. Loaded in ONE statement through
 * the Management API rather than through `add_shopping_item`, because eight
 * thousand RPC round trips is not a fixture, it is an afternoon.
 *
 * The number is bounded from ABOVE as well, and that bound was measured rather
 * than reasoned. At 20,000 the carry took **1.26 s** on one run and **over 8 s**
 * on the next, minutes apart, on the same project — and 8 s is `authenticated`'s
 * `statement_timeout`, so the second run's winner was killed mid-carry and BOTH
 * callers came back refused. A witness fixture has to be slow enough to sample
 * and fast enough to survive, and on a shared-CPU project those two bounds are
 * closer together than they look. Hence this number, the staggered sampling
 * below, and the retries: one attempt on a variable machine is a coin toss.
 */
export const WITNESS_ITEMS = 8000

/** How many times the witness phase asks `pg_stat_activity` during one race. */
export const WITNESS_SAMPLES = 8

/**
 * How far apart the samples are DISPATCHED, in milliseconds.
 *
 * They are fired in parallel on a stagger rather than in sequence, because a
 * sequential sampler's resolution is its own round trip — measured at 0.6 s to
 * 1.3 s against the Management API — and a race that is over inside one of them
 * is invisible however many samples follow. Staggered, the observations land
 * across the race instead of after it.
 */
export const WITNESS_SAMPLE_STAGGER_MS = 200

/**
 * How many witness races to try before reporting a miss.
 *
 * Each attempt builds its own fixture. The loop stops at the first attempt that
 * both finished cleanly and caught the lock wait — a retry after a WITNESSED
 * attempt could only lower the evidence, and a retry after a timeout is the
 * measurement the machine denied, not a second chance at a verdict.
 */
export const WITNESS_ATTEMPTS = 3

// ---------------------------------------------------------------------------
// The pure half — every judgement this script makes, as functions over plain
// data. They are exported and unit-tested in `prove-finish-race.test.js`, which
// feeds each of them a state that must FAIL: a checker whose only exercise is
// the healthy path is a checker nobody has asked whether it can refuse.
// ---------------------------------------------------------------------------

/** SQLSTATE the `run already closed` guard raises, and the index behind it. */
export const GUARD_SQLSTATE = 'P0001'
export const UNIQUE_VIOLATION_SQLSTATE = '23505'

/**
 * Which of the two refusal paths the loser took, from its error.
 *
 * AC 2 admits both and asks which: the row lock should produce the RPC's own
 * `run already closed`, because the second caller waits, re-reads the row and
 * finds the close. `shopping_runs_one_open_per_list` is the belt under those
 * braces, and a loser refused by the INDEX instead would mean the second call
 * reached its insert — a different story, and one #357's error copy would have
 * to map from `23505` as well as from the sentence.
 */
export function refusalPath(error) {
  const code = error?.cause?.code ?? error?.code ?? null
  const message = error?.cause?.message ?? error?.message ?? ''
  if (code === UNIQUE_VIOLATION_SQLSTATE) return 'index'
  if (/run already closed/i.test(message)) return 'guard'
  return 'other'
}

/**
 * Exactly one winner and exactly one loser — AC 2, as a list of faults.
 *
 * Faults rather than a boolean so a failure says WHICH way it failed. Two
 * winners is the defect the epic is about (two open runs, every item carried
 * twice); two losers means nothing finished at all, which is a different and
 * equally reportable fault.
 */
export function raceFaults(outcomes) {
  const faults = []
  const won = outcomes.filter((outcome) => outcome.ok)
  const lost = outcomes.filter((outcome) => !outcome.ok)

  if (outcomes.length !== 2) faults.push(`a race needs exactly 2 callers, got ${outcomes.length}`)
  if (won.length !== 1) faults.push(`${won.length} calls succeeded, expected exactly 1`)
  if (lost.length !== 1) faults.push(`${lost.length} calls were refused, expected exactly 1`)
  if (won.length === 1 && !won[0].value?.id) faults.push('the winning call returned no new run')

  return faults
}

/**
 * Client-side timings for the pair. **Descriptive only — this decides nothing,
 * and the reason is worth stating rather than leaving as an omission.**
 *
 * A first draft returned `inFlightTogether` here and the report counted it as
 * evidence that the two requests overlapped, described as "necessary but not
 * sufficient". Review found it is **structurally always true**: `attempt()`
 * stamps `startedAt` before invoking its factory, and both calls are made inside
 * one synchronous `Promise.all([...])` block, so no promise can settle before
 * the block ends and `firstSettled > startedTogether` holds on every path a
 * caller can reach. A platform that serialised the two HTTP requests end to end
 * — the one world this script exists to rule out — would have produced the flag
 * as `true` for every repetition, and the run would have printed it as a
 * positive finding. Its unit test was a control over inputs the live script
 * cannot generate, which is exactly why the vacuity read as covered
 * (cairn: `prove-an-instrument-could-have-shown-the-opposite`).
 *
 * It could have been made honest with a `fetch` hook stamping the real dispatch
 * — and it would still never be false, because the two requests are issued
 * back to back either way. So it is gone rather than repaired, and the WITNESS
 * is the sole evidence of concurrency. The numbers below stay because durations
 * are worth reading; none of them is a claim.
 */
export function overlapOf(a, b) {
  const startedTogether = Math.max(a.startedAt, b.startedAt)
  const firstSettled = Math.min(a.settledAt, b.settledAt)
  return {
    dispatchGapMs: round(Math.abs(a.startedAt - b.startedAt)),
    settleGapMs: round(Math.abs(a.settledAt - b.settledAt)),
    overlapMs: round(firstSettled - startedTogether),
  }
}

/**
 * AC 3, over what a client can read back afterwards — as faults, one per broken
 * clause, so a failure names the clause rather than the state.
 *
 * `originalIds` is the set read BEFORE the race (AC 1's confirmation), which is
 * what makes "no item carried twice" checkable at all: without it, three items
 * on the new run each pointing at *something* is satisfied by three copies of
 * one original.
 */
export function readBackFaults({ runs, itemsByRun, originalIds, winningRunId }) {
  const faults = []
  const open = runs.filter((run) => run.closed_at === null)
  const closed = runs.filter((run) => run.closed_at !== null)

  if (runs.length !== 2) faults.push(`the list has ${runs.length} runs, expected 2`)
  if (open.length !== 1) faults.push(`${open.length} runs are open, expected exactly 1`)
  if (closed.length !== 1) faults.push(`${closed.length} runs are closed, expected exactly 1`)
  if (open.length === 1 && winningRunId && open[0].id !== winningRunId) {
    faults.push('the open run is not the run the winning call returned')
  }
  if (closed.length === 1 && !closed[0].closed_by_member_id) {
    faults.push('the closed run records no closer')
  }
  if (faults.length > 0) return faults

  const carried = itemsByRun.get(open[0].id) ?? []
  const originals = itemsByRun.get(closed[0].id) ?? []

  if (carried.length !== originalIds.length) {
    faults.push(`the new run holds ${carried.length} items, expected ${originalIds.length}`)
  }
  if (originals.length !== originalIds.length) {
    faults.push(`the closed run holds ${originals.length} items, expected ${originalIds.length}`)
  }

  const originalSet = new Set(originalIds)
  if (originals.some((item) => !originalSet.has(item.id))) {
    faults.push('the closed run holds an item that was not in the fixture')
  }
  if (originals.some((item) => item.purchased_at !== null)) {
    faults.push('an item on the closed run is marked bought, and none was bought')
  }
  if (carried.some((item) => originalSet.has(item.id))) {
    faults.push('an original item MOVED to the new run instead of being copied')
  }
  if (carried.some((item) => !item.carried_from_item_id)) {
    faults.push('an item on the new run has no carried_from_item_id')
  }

  // The clause that needs the before-read: each original carried exactly once.
  const sources = carried.map((item) => item.carried_from_item_id)
  for (const id of originalIds) {
    const times = sources.filter((source) => source === id).length
    if (times !== 1) faults.push(`original ${id} was carried ${times} times, expected exactly 1`)
  }
  const strays = sources.filter((source) => source && !originalSet.has(source))
  if (strays.length > 0) faults.push(`${strays.length} carried items point outside the fixture`)

  return faults
}

/**
 * The recorded second case: a purchase racing a finish on the same run.
 *
 * One invariant, and it holds whichever side commits first — every item on the
 * closed run is EITHER bought there OR carried forward exactly once. Both is the
 * household buying a thing twice; neither is the thing being lost. Written this
 * way rather than as "the purchase wins" or "the finish wins" on purpose: which
 * one wins is a fact about timing and is recorded, not asserted.
 */
export function purchaseRaceFaults({ closedItems, carriedItems, originalIds }) {
  const faults = []
  const originalSet = new Set(originalIds)
  const sources = carriedItems.map((item) => item.carried_from_item_id)

  if (closedItems.length !== originalIds.length) {
    faults.push(`the closed run holds ${closedItems.length} items, expected ${originalIds.length}`)
  }
  if (carriedItems.some((item) => !item.carried_from_item_id)) {
    faults.push('an item on the new run has no carried_from_item_id')
  }
  if (sources.some((source) => source && !originalSet.has(source))) {
    faults.push('a carried item points outside the fixture')
  }

  for (const item of closedItems) {
    const times = sources.filter((source) => source === item.id).length
    const bought = item.purchased_at !== null
    if (bought && times > 0) {
      faults.push(`${item.name} is bought on the closed run AND carried forward — bought twice`)
    }
    if (!bought && times !== 1) {
      faults.push(`unbought ${item.name} was carried ${times} times, expected exactly 1`)
    }
  }

  return faults
}

/**
 * What the `pg_stat_activity` samples saw — the decisive evidence, or its
 * absence, never a hedge between the two.
 *
 * **The verdict is decided PER SAMPLE, and that is the whole correctness of it.**
 * A first draft reduced the samples to two scalars — a max of the backend count
 * over all samples, and a sum of the lock waits over all samples — and ANDed
 * them. That reads fine and is wrong: nothing then required the two-backend
 * instant and the lock wait to be the SAME instant, or the waiting backend to be
 * one of the two counted, so the decisive sentence could be assembled from two
 * observations neither of which showed both. `witnessVerdict([[{pid:1},{pid:2}],
 * [{pid:3, wait_event_type:'Lock'}]])` returned a full WITNESSED under it. Found
 * by review, 2026-09-06.
 *
 * So `witnessed` is true only where ONE sample holds two distinct backends and a
 * lock wait among them. `mostBackends` and `lockWaits` survive as descriptive
 * counts for the report and decide nothing.
 *
 * **Non-active rows are ignored here as well as in the query.** Postgres keeps
 * `query` as the LAST statement of an idle backend, so a pooled connection that
 * served an earlier finish still matches the sampler's `ilike` minutes later.
 * The SQL filters on `state = 'active'`; this filters again, so the function's
 * claim is true of whatever it is handed rather than true only of what today's
 * query sends it.
 *
 * The match is `wait_event_type === 'Lock'` and deliberately NOT the narrower
 * `wait_event === 'transactionid'`: a caller blocked on a row lock can wait on
 * `tuple` as well, and narrowing to the value this project happened to produce
 * would turn a legitimate variant into a miss. The observed values are reported
 * instead, so the record says what was seen rather than what was assumed.
 */
export function witnessVerdict(samples) {
  let mostBackends = 0
  let lockWaits = 0
  let witnessedIn = -1
  const waitEvents = new Set()

  samples.forEach((sample, index) => {
    const active = (sample ?? []).filter((row) => row.state === 'active')
    const pids = new Set(active.map((row) => row.pid))
    const waiting = active.filter((row) => row.wait_event_type === 'Lock')
    for (const row of waiting) waitEvents.add(row.wait_event ?? 'unknown')

    mostBackends = Math.max(mostBackends, pids.size)
    lockWaits += waiting.length
    if (witnessedIn < 0 && pids.size >= 2 && waiting.length > 0) witnessedIn = index
  })

  return {
    mostBackends,
    lockWaits,
    waitEvents: [...waitEvents],
    witnessedIn,
    witnessed: witnessedIn >= 0,
    concurrent: mostBackends >= 2,
    sawLockWait: lockWaits > 0,
  }
}

/**
 * Which witness attempt STANDS, and why — the fault-kind rule.
 *
 * The loop that calls this used to report the LAST attempt's faults, which meant
 * a machine-caused failure on the final attempt could fail the whole proof while
 * two clean attempts sat unused. The obvious repair — "take the last clean
 * attempt" — would have been worse, and this is the part worth reading twice:
 * `witnessOnce`'s faults mix two kinds that must never be traded for one another.
 *
 *   * **machine** — no caller committed. A carry killed by `statement_timeout`,
 *     a transport failure: nothing was measured, the RPC is not implicated, and
 *     retrying is exactly right. Reporting it as a proof failure would make the
 *     verdict a function of how busy a shared CPU was.
 *   * **defect** — a caller committed and something is wrong anyway. `2 calls
 *     succeeded` is the epic's own nightmare: two open runs, every item carried
 *     twice. **This must always reach the report, from whichever attempt saw
 *     it**, and preferring an earlier clean attempt would silently discard the
 *     one result this whole script exists to catch.
 *
 * So a defect attempt wins outright, then a witnessed clean one, then any clean
 * one, then the last attempt whatever it was.
 */
export function selectWitness(attempts) {
  if (attempts.length === 0) return { standing: null, reason: 'no attempt ran' }

  const defect = attempts.find((attempt) => attempt.kind === 'defect')
  if (defect) return { standing: defect, reason: 'an attempt observed the RPC misbehaving' }

  const witnessed = attempts.find((attempt) => attempt.kind === 'clean' && attempt.witnessed)
  if (witnessed) return { standing: witnessed, reason: 'a clean attempt caught the lock wait' }

  const clean = attempts.find((attempt) => attempt.kind === 'clean')
  if (clean) return { standing: clean, reason: 'a clean attempt the sampler did not catch' }

  return {
    standing: attempts[attempts.length - 1],
    reason: 'every attempt was denied by the machine — nothing was measured',
  }
}

/**
 * Which of the two kinds an attempt's faults are — the input to `selectWitness`.
 *
 * The discriminator is whether ANYTHING committed. Exactly one winner is the
 * precondition for judging any of the rest: with no winner nothing ran, and with
 * two the thing the epic protects has already failed.
 */
export function attemptKind(faults, winners) {
  if (faults.length === 0) return 'clean'
  return winners === 0 ? 'machine' : 'defect'
}

/**
 * The loser took neither documented refusal path — a fault, not a footnote.
 *
 * AC 2 is about the REASON the second caller is refused, so a repetition whose
 * loser never reached the lock is not a repetition. The reachable instance is
 * this script's own hazard rather than a dropped socket: the loser is the caller
 * parked on `for update`, so a slow winner gets it cancelled with SQLSTATE 57014
 * — `refusalPath` returns 'other', the read-back is perfectly healthy, and
 * without this the run counts it toward AC 2's ten and exits 0.
 */
export function pathFaults(path, message) {
  if (path === 'guard' || path === 'index') return []
  if (path === null) return ['no caller was refused, so there was no race to read a path from']
  return [`the loser was refused by neither the guard nor the index (${path}): ${message}`]
}

/**
 * The witness run's own shape — extracted so it can be made to fail.
 *
 * It lived inline in `witnessOnce`, where mutating it reddened nothing while
 * three separate sentences in this repo claimed every judgement here is a pure
 * function under test. That claim is what made the gap invisible.
 */
export function witnessFaults({ runs, carried, kept, loaded }) {
  const faults = []
  if (runs !== 2) faults.push(`the witness list has ${runs} runs, expected 2`)
  if (carried !== loaded) faults.push(`${carried} items carried forward, expected ${loaded}`)
  if (kept !== loaded) faults.push(`the closed run kept ${kept} items, expected ${loaded}`)
  return faults
}

/**
 * AC 5's residue check, extracted for the same reason.
 *
 * This is the one that was silent: `report.cleanup` was stored and never
 * printed, so a version of this comparison that could not fire would leave
 * "deleted, and the absence read back" as the only output — a sentence about an
 * absence nobody checked.
 */
export function cleanupFaults(left) {
  const remaining = Object.entries(left ?? {}).filter(([, count]) => count !== 0)
  if (remaining.length === 0) return []
  return [`cleanup left rows behind: ${remaining.map(([name, n]) => `${n} ${name}`).join(', ')}`]
}

/** One decimal place, so a table of milliseconds stays readable. */
function round(value) {
  return Math.round(value * 10) / 10
}

// ---------------------------------------------------------------------------
// The live half.
// ---------------------------------------------------------------------------

/** A fresh client per caller, so no two ever share a session or a token. */
function newClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Call the RPC and come back with an outcome rather than a rejection.
 *
 * This is what lets AC 2's single `Promise.all` hold BOTH answers: the losing
 * call is expected to be refused, and a bare `Promise.all` over two rejecting
 * promises would discard the winner's new run along with it. Both promises are
 * created before either is awaited, which is the property that matters — the
 * two requests are in flight together, and `startedAt` records when each went.
 */
function attempt(promiseFactory) {
  const startedAt = performance.now()
  return promiseFactory()
    .then((value) => ({ ok: true, value, startedAt, settledAt: performance.now() }))
    .catch((error) => ({ ok: false, error, startedAt, settledAt: performance.now() }))
}

/** Run one statement, refusing loudly rather than returning an empty result. */
async function sql({ ref, token }, statement, what) {
  const result = await runQuery({ ref, token, sql: statement })
  if (!result.ok) {
    throw new Refusal(`${what} failed.\n\n${explainHttpFailure(result.status, result.error)}`)
  }
  return result.rows ?? []
}

/** The items of one run, keyed by run id, from a client read. */
function indexByRun(items) {
  const byRun = new Map()
  for (const item of items) {
    if (!byRun.has(item.run_id)) byRun.set(item.run_id, [])
    byRun.get(item.run_id).push(item)
  }
  return byRun
}

/**
 * Every run and item of one list, read as the CLIENT sees them.
 *
 * `readShopping` returns only the OPEN run by design (that is what the Shop tab
 * draws), and this needs the closed one too, so the two reads are made here
 * against the same granted columns. Both go through the same policies a phone
 * does — the read-back is what a household would see, not a catalog view of it.
 */
async function readRuns(client, listId) {
  const { data, error } = await client
    .from('shopping_runs')
    .select('id, list_id, household_id, opened_at, closed_at, closed_by_member_id')
    .eq('list_id', listId)
    .order('opened_at', { ascending: true })
  if (error) throw new Error(`reading the list's runs: ${error.message}`)
  return data ?? []
}

/**
 * How many items are on one run, WITHOUT reading them.
 *
 * PostgREST caps a read at `db-max-rows` — 1,000 on this project — so the
 * witness run's twenty thousand rows cannot be counted by reading them: the
 * array comes back truncated, with no error and no gap in the response to make
 * the truncation visible. `head: true` sends the query and no rows at all, and
 * the count arrives in the `Content-Range` header. The ten repetitions carry
 * three items each and would never have noticed the cap.
 */
async function countItems(client, runId) {
  const { count, error } = await client
    .from('shopping_items')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
  if (error) throw new Error(`counting the run's items: ${error.message}`)
  return count ?? 0
}

async function readList(client, listId) {
  const runs = await readRuns(client, listId)
  const runIds = (runs ?? []).map((run) => run.id)
  if (runIds.length === 0) return { runs: [], itemsByRun: new Map() }

  const { data: items, error: itemsError } = await client
    .from('shopping_items')
    .select(
      'id, run_id, household_id, name, note, added_by_member_id, added_at, ' +
        'purchased_at, purchased_by_member_id, carried_from_item_id',
    )
    .in('run_id', runIds)
    .order('added_at', { ascending: true })
    .order('id', { ascending: true })
  if (itemsError) throw new Error(`reading the list's items: ${itemsError.message}`)

  return { runs: runs ?? [], itemsByRun: indexByRun(items ?? []) }
}

/**
 * One fixture: a list, its first open run, and three unpurchased items.
 *
 * `create_shopping_list` returns the LIST and opens the run in the same
 * transaction without returning it, so the run is read back rather than
 * assumed — `readList` names the open one by `closed_at is null`, which is the
 * predicate the whole schema uses and never "the latest opened_at".
 */
async function seedFixture(client, householdId, name) {
  const list = await createList(client, householdId, name)
  const { runs } = await readList(client, list.id)
  const open = runs.find((run) => run.closed_at === null)
  if (!open) throw new Error(`the new list ${list.id} came back with no open run`)
  for (const itemName of FIXTURE_ITEMS) {
    await addItem(client, open.id, itemName)
  }
  return { list, runId: open.id }
}

/**
 * AC 1's confirmation read: the fixture really is one list with one open run
 * holding exactly three unpurchased items, checked BEFORE the race.
 *
 * Not ceremony. The read-back afterwards asks whether each original was carried
 * exactly once, and it can only ask that against a set somebody wrote down
 * first — a fixture believed rather than read gives the later check nothing to
 * compare with, and "three items came back" is satisfied by three copies of one.
 *
 * Exported for the reason the pure half above is: it returns `[]` on every live
 * run, so nothing in a live run can tell it from a version that returns `[]`
 * unconditionally. The states it must refuse are built in the test file.
 */
export function fixtureFaults({ lists, runs, items }, listId) {
  const faults = []
  const mine = lists.filter((list) => list.id === listId)
  if (mine.length !== 1) faults.push(`${mine.length} lists match the fixture, expected 1`)
  const open = runs.filter((run) => run.list_id === listId)
  if (open.length !== 1) faults.push(`${open.length} open runs on the fixture list, expected 1`)
  if (open.length === 1) {
    const onRun = items.filter((item) => item.run_id === open[0].id)
    if (onRun.length !== FIXTURE_ITEMS.length) {
      faults.push(`the run holds ${onRun.length} items, expected ${FIXTURE_ITEMS.length}`)
    }
    if (onRun.some((item) => item.purchased_at !== null)) {
      faults.push('an item was already bought before the race')
    }
    if (onRun.some((item) => item.carried_from_item_id !== null)) {
      faults.push('a fixture item is already a carried copy')
    }
  }
  return faults
}

export async function main(env) {
  const fileEnv = (() => {
    try {
      return parseEnvFile(readEnvLocal())
    } catch {
      return {}
    }
  })()

  const url = resolveSupabaseUrl(env, readEnvLocal)
  const anonKey = env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || ''
  const email = env.TASKR_TEST_EMAIL || fileEnv.TASKR_TEST_EMAIL || ''
  const password = env.TASKR_TEST_PASSWORD || fileEnv.TASKR_TEST_PASSWORD || ''

  if (!url || !anonKey) {
    throw new Refusal(
      'This proof runs against the LIVE project, and there is nothing to point it at.\n\n' +
        'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (gitignored).\n' +
        'Nothing was sent and nothing was changed.',
    )
  }
  if (!email || !password) {
    throw new Refusal(
      'This proof needs the seeded account — the same one `npm run test:rls` and\n' +
        '`npm run check:live` sign in as, behind TASKR_TEST_EMAIL / TASKR_TEST_PASSWORD\n' +
        'in .env.local. It cannot make one: the project has `mailer_autoconfirm: false`,\n' +
        'so a client signUp() returns a null session until somebody clicks a link.\n' +
        'See src/test/rls.integration.test.js for how to create it once, by hand.\n\n' +
        'Nothing was sent and nothing was changed.',
    )
  }

  const ref = projectRefFrom(url)
  const token = requireAccessToken(resolveAccessToken(env, readEnvLocal))
  const admin = { ref, token }

  // The token proven ALIVE before the first write, not at cleanup time. A dead
  // token found in the `finally` leaves a household nothing here can delete —
  // and an expired personal access token is well-formed, so no shape check
  // above can see it (management-api.mjs's `explainHttpFailure` says so).
  await sql(admin, 'select 1 as alive;', 'the Management API preflight')
  console.log('the Management API token is alive — cleanup is reachable\n')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const one = newClient(url, anonKey)
  const two = newClient(url, anonKey)

  for (const [label, client] of [['caller one', one], ['caller two', two]]) {
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) {
      throw new Refusal(
        `the seeded account could not sign in as ${label}: ${error.message}\n\n` +
          'Check TASKR_TEST_EMAIL / TASKR_TEST_PASSWORD in .env.local. If the message\n' +
          'mentions confirmation, the account was created without "Auto Confirm User".',
      )
    }
  }
  console.log('two independent authenticated clients, both on the seeded account\n')

  const household = await one.rpc('create_household', {
    household_name: `TEST 356 ${stamp} finish race`,
    organizer_name: 'Placeholder Organizer',
    household_timezone: 'Pacific/Auckland',
  })
  if (household.error) throw new Error(`creating the fixture household: ${household.error.message}`)
  const householdId = household.data.id
  console.log(`fixture household ${householdId}\n`)

  const report = {
    householdId,
    stamp,
    repetitions: [],
    purchaseRaces: [],
    witness: null,
    faults: [],
  }

  try {
    await runRepetitions({ one, two, householdId, report })
    await runPurchaseRaces({ one, two, householdId, report })
    await runWitness({ one, two, admin, householdId, report })
  } finally {
    await cleanUp({ admin, householdId, report })
    await Promise.all([one.auth.signOut(), two.auth.signOut()])
  }

  printReport(report)

  if (report.faults.length > 0) {
    throw new Refusal(
      `${report.faults.length} fault(s) — the proof did NOT hold:\n\n` +
        report.faults.map((fault) => `  - ${fault}`).join('\n'),
    )
  }
}

/** AC 2, AC 3 and AC 4: the race, ten times, against a fresh fixture each time. */
async function runRepetitions({ one, two, householdId, report }) {
  console.log(`${REPETITIONS} repetitions, a fresh fixture each\n`)

  for (let index = 1; index <= REPETITIONS; index += 1) {
    const { list, runId } = await seedFixture(one, householdId, `race ${index}`)

    // AC 1: the state confirmed by a read before the race, and the ids written
    // down — the read-back afterwards is only meaningful against these. The
    // read goes through `readShopping`, the app's own, so what is confirmed is
    // what the Shop tab would draw rather than a catalog view of it.
    const before = await readShopping(one, householdId)
    const scoped = {
      lists: before.lists.filter((row) => row.id === list.id),
      runs: before.runs.filter((row) => row.list_id === list.id),
      items: before.items.filter((item) => item.run_id === runId),
    }
    const seedFault = fixtureFaults(scoped, list.id)
    if (seedFault.length > 0) {
      report.faults.push(`repetition ${index} fixture: ${seedFault.join('; ')}`)
      continue
    }
    const originalIds = scoped.items.map((item) => item.id)

    // The race. Both promises are created here, before either is awaited.
    const outcomes = await Promise.all([
      attempt(() => finishRun(one, runId)),
      attempt(() => finishRun(two, runId)),
    ])

    const faults = raceFaults(outcomes)
    const winner = outcomes.find((outcome) => outcome.ok)
    const loser = outcomes.find((outcome) => !outcome.ok)
    const overlap = overlapOf(outcomes[0], outcomes[1])

    // AC 2 is about the REASON the loser was refused, so a loser that never
    // reached the lock is not a repetition — see `pathFaults`.
    faults.push(
      ...pathFaults(loser ? refusalPath(loser.error) : null, loser?.error?.message ?? ''),
    )

    const after = await readList(one, list.id)
    faults.push(
      ...readBackFaults({
        runs: after.runs,
        itemsByRun: after.itemsByRun,
        originalIds,
        winningRunId: winner?.value?.id ?? null,
      }),
    )

    report.repetitions.push({
      index,
      faults,
      won: outcomes.filter((outcome) => outcome.ok).length,
      lost: outcomes.filter((outcome) => !outcome.ok).length,
      path: loser ? refusalPath(loser.error) : null,
      message: loser ? (loser.error?.cause?.message ?? loser.error?.message ?? '') : '',
      winnerMs: winner ? round(winner.settledAt - winner.startedAt) : null,
      loserMs: loser ? round(loser.settledAt - loser.startedAt) : null,
      runs: after.runs.length,
      openRunItems: winner?.value?.id ? (after.itemsByRun.get(winner.value.id) ?? []).length : 0,
      closedRunItems: after.runs
        .filter((run) => run.closed_at !== null)
        .reduce((total, run) => total + (after.itemsByRun.get(run.id) ?? []).length, 0),
      ...overlap,
    })
    for (const fault of faults) report.faults.push(`repetition ${index}: ${fault}`)
  }
}

/** The recorded second case: `purchase_shopping_item` against `finish_shopping_run`. */
async function runPurchaseRaces({ one, two, householdId, report }) {
  console.log(`\n${PURCHASE_REPETITIONS} purchase-versus-finish repetitions (recorded, not an AC)\n`)

  for (let index = 1; index <= PURCHASE_REPETITIONS; index += 1) {
    const { list, runId } = await seedFixture(one, householdId, `tick race ${index}`)
    const before = await readList(one, list.id)
    const items = before.itemsByRun.get(runId) ?? []
    if (items.length !== FIXTURE_ITEMS.length) {
      report.faults.push(`tick race ${index}: fixture holds ${items.length} items`)
      continue
    }
    const originalIds = items.map((item) => item.id)
    const target = items[0]

    const outcomes = await Promise.all([
      attempt(() => finishRun(one, runId)),
      attempt(() => purchaseItem(two, target.id)),
    ])
    const [finish, purchase] = outcomes
    const overlap = overlapOf(finish, purchase)

    const faults = []
    if (!finish.ok) faults.push(`the finish was refused: ${finish.error?.message ?? ''}`)

    const after = await readList(one, list.id)
    const closedRun = after.runs.find((run) => run.closed_at !== null)
    const openRun = after.runs.find((run) => run.closed_at === null)
    if (!closedRun || !openRun) {
      faults.push(`expected one closed and one open run, got ${after.runs.length} runs`)
    } else {
      faults.push(
        ...purchaseRaceFaults({
          closedItems: after.itemsByRun.get(closedRun.id) ?? [],
          carriedItems: after.itemsByRun.get(openRun.id) ?? [],
          originalIds,
        }),
      )
    }

    report.purchaseRaces.push({
      index,
      faults,
      purchaseWon: purchase.ok,
      purchaseMessage: purchase.ok ? '' : (purchase.error?.cause?.message ?? purchase.error?.message ?? ''),
      carried: openRun ? (after.itemsByRun.get(openRun.id) ?? []).length : 0,
      bought: closedRun
        ? (after.itemsByRun.get(closedRun.id) ?? []).filter((item) => item.purchased_at !== null).length
        : 0,
      ...overlap,
    })
    for (const fault of faults) report.faults.push(`tick race ${index}: ${fault}`)
  }
}

/**
 * The witness — two backends in `finish_shopping_run` at one instant, one of
 * them waiting on a lock.
 *
 * The fixture is bulk-loaded so the carry lasts longer than a Management API
 * round trip; without that the race is over before the first sample is sent and
 * a miss would say nothing about whether the interleaving happened.
 */
async function runWitness({ one, two, admin, householdId, report }) {
  console.log(
    `\nthe witness: up to ${WITNESS_ATTEMPTS} races over ${WITNESS_ITEMS} items, ` +
      'sampled from pg_stat_activity\n',
  )

  report.witnessAttempts = []
  for (let attemptNumber = 1; attemptNumber <= WITNESS_ATTEMPTS; attemptNumber += 1) {
    const outcome = await witnessOnce({ one, two, admin, householdId, attemptNumber })
    report.witnessAttempts.push(outcome)
    console.log(
      `  attempt ${attemptNumber}: ${outcome.kind}, ${outcome.faults.length} fault(s), ` +
        `${outcome.mostBackends} active backend(s) in one sample, ${outcome.lockWaits} lock wait(s)` +
        (outcome.samplesFailed ? `, ${outcome.samplesFailed} sample(s) FAILED` : ''),
    )
    // A defect stops the loop at once — it is the finding, and racing again
    // would only add attempts after the thing this script exists to catch. A
    // witnessed clean attempt also stops it: a further race could replace
    // evidence with less of it. Anything else is retried.
    if (outcome.kind === 'defect') break
    if (outcome.kind === 'clean' && outcome.witnessed) break
  }

  const { standing, reason } = selectWitness(report.witnessAttempts)
  report.witness = standing
  report.witnessReason = reason

  // Only a DEFECT attempt contributes faults. An attempt the machine killed
  // mid-carry is a fact about the project's `statement_timeout`, not about the
  // RPC — reporting it as a proof failure would make the verdict a function of
  // how busy the shared CPU was. The inverse matters more: an attempt that saw
  // the RPC misbehave is reported from whichever attempt saw it, so a real
  // two-winner observation can never be superseded by a clean retry.
  if (standing?.kind === 'defect') {
    for (const fault of standing.faults) report.faults.push(`witness: ${fault}`)
  }
}

/** Wait, so the samples can be dispatched across the race instead of after it. */
function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function witnessOnce({ one, two, admin, householdId, attemptNumber }) {
  const list = await createList(one, householdId, `witness ${attemptNumber}`)
  const before = await readList(one, list.id)
  const runId = before.runs[0].id

  await sql(
    admin,
    `insert into public.shopping_items (run_id, household_id, name, added_at)
     select '${runId}'::uuid, '${householdId}'::uuid, 'bulk ' || g, now()
     from generate_series(1, ${WITNESS_ITEMS}) as g;`,
    'bulk-loading the witness run',
  )
  const [{ count: loaded }] = await sql(
    admin,
    `select count(*)::int as count from public.shopping_items where run_id = '${runId}'::uuid;`,
    'counting the witness run',
  )

  // The samples ride alongside the race rather than after it: both are started
  // here, and only then awaited.
  const racing = Promise.all([
    attempt(() => finishRun(one, runId)),
    attempt(() => finishRun(two, runId)),
  ])
  // A sample that fails must never take the race down with it — the race has
  // already written by then, and losing its result would leave the fixture in a
  // state nothing read. A failed sample is an empty sample, which the verdict
  // then counts as evidence of nothing rather than as evidence of absence.
  //
  // `query not ilike '%pg_stat_activity%'` excludes the sampler's own siblings:
  // this statement names the function it is hunting for, so without it a second
  // in-flight sample would be counted as a backend running the RPC — a guard
  // reading its own text as its subject (cairn:
  // `a-guard-that-reads-source-must-survive-its-own-docs`).
  //
  // Dispatched in parallel on a stagger, not in sequence: a sequential
  // sampler's resolution is its own round trip, and a race shorter than that is
  // invisible however many samples follow it.
  //
  // `state = 'active'` is load-bearing, not tidiness. Postgres keeps `query` as
  // the LAST statement a backend ran, so every pooled connection that served one
  // of the fifteen earlier finishes still matches the `ilike` while sitting
  // idle — without this predicate those stale rows count as backends "in" the
  // function and the concurrency half of the verdict can be satisfied by
  // connections doing nothing at all. `witnessVerdict` filters again, so the
  // property holds of the function and not merely of today's query.
  const sampling = Promise.all(
    Array.from({ length: WITNESS_SAMPLES }, async (_unused, index) => {
      await pause(index * WITNESS_SAMPLE_STAGGER_MS)
      try {
        const rows = await sql(
          admin,
          `select pid, state, wait_event_type, wait_event, usename
             from pg_stat_activity
             where query ilike '%finish_shopping_run%'
               and query not ilike '%pg_stat_activity%'
               and state = 'active'
               and pid <> pg_backend_pid();`,
          'sampling pg_stat_activity',
        )
        return { rows, failed: false }
      } catch (error) {
        // Counted, never swallowed into an empty result: "the sampler never
        // asked" and "the sampler asked and saw nothing" are different facts,
        // and only the second says anything about the race. Collapsing them
        // would let three attempts burn on non-answers while the report read
        // NOT WITNESSED as though the race had been too fast.
        return { rows: [], failed: true, message: error?.message ?? String(error) }
      }
    }),
  )

  const [outcomes, samples] = await Promise.all([racing, sampling])
  const winner = outcomes.find((outcome) => outcome.ok)
  const loser = outcomes.find((outcome) => !outcome.ok)
  const faults = raceFaults(outcomes)

  // Counted, never read. `readList` would cap at PostgREST's `db-max-rows` and
  // report a number that looks like a lost-items defect — *measured* on the
  // first run of this script: 475 of 20,000, because the cap applies to the
  // combined read of both runs. The ten repetitions carry three items each and
  // could never have shown it.
  const runs = await readRuns(one, list.id)
  const openRun = runs.find((run) => run.closed_at === null)
  const closedRun = runs.find((run) => run.closed_at !== null)
  const carried = openRun ? await countItems(one, openRun.id) : 0
  const kept = closedRun ? await countItems(one, closedRun.id) : 0
  faults.push(...witnessFaults({ runs: runs.length, carried, kept, loaded }))
  faults.push(...pathFaults(loser ? refusalPath(loser.error) : null, loser?.error?.message ?? ''))

  const taken = samples.filter((sample) => !sample.failed)
  const winners = outcomes.filter((outcome) => outcome.ok).length

  return {
    attemptNumber,
    items: loaded,
    kept,
    faults,
    // Which KIND of failure this was, which is what decides whether the attempt
    // stands — see `selectWitness`. A machine-killed attempt is retried; an
    // attempt that saw the RPC misbehave is reported from wherever it happened.
    kind: attemptKind(faults, winners),
    path: loser ? refusalPath(loser.error) : null,
    // The messages, not just the path. *Measured*: at 20,000 items both callers
    // came back refused because the winner was killed by `statement_timeout`
    // mid-carry, and without the sentence that reads as the RPC misbehaving.
    winnerMessage: winner ? '' : (outcomes[0].error?.message ?? ''),
    loserMessage: loser ? (loser.error?.cause?.message ?? loser.error?.message ?? '') : '',
    winnerMs: winner ? round(winner.settledAt - winner.startedAt) : null,
    loserMs: loser ? round(loser.settledAt - loser.startedAt) : null,
    carried,
    samples: taken.map((sample) => sample.rows.length),
    samplesFailed: samples.length - taken.length,
    rows: taken.flatMap((sample) => sample.rows),
    ...overlapOf(outcomes[0], outcomes[1]),
    ...witnessVerdict(samples.map((sample) => sample.rows)),
  }
}

/**
 * AC 5 — delete the fixture and PROVE it is gone.
 *
 * One delete, because everything cascades from `households`. The verification is
 * a separate read rather than the delete's own row count: a statement that
 * reports success is not the same claim as an absence, and cairn's
 * `a-rehearsal-is-verified-after-its-cleanup` is exactly this shape.
 */
async function cleanUp({ admin, householdId, report }) {
  try {
    await sql(
      admin,
      `delete from public.households where id = '${householdId}'::uuid;`,
      'deleting the fixture household',
    )
    const [left] = await sql(
      admin,
      `select
         (select count(*)::int from public.households      where id = '${householdId}'::uuid) as households,
         (select count(*)::int from public.members         where household_id = '${householdId}'::uuid) as members,
         (select count(*)::int from public.shopping_lists  where household_id = '${householdId}'::uuid) as lists,
         (select count(*)::int from public.shopping_runs   where household_id = '${householdId}'::uuid) as runs,
         (select count(*)::int from public.shopping_items  where household_id = '${householdId}'::uuid) as items;`,
      'verifying the fixture is gone',
    )
    report.cleanup = left
    const faults = cleanupFaults(left)
    report.faults.push(...faults)
    // The counts are PRINTED, not merely stored. They were stored and never
    // shown, so a residue check that could not fire would have left the line
    // below — a sentence asserting an absence nobody looked at — as the only
    // output of this whole step.
    console.log(
      `\nfixture household ${householdId} deleted; read back ` +
        Object.entries(left)
          .map(([name, count]) => `${count} ${name}`)
          .join(', ') +
        (faults.length === 0 ? ' — the absence confirmed\n' : ' — ROWS SURVIVED\n'),
    )
  } catch (error) {
    report.faults.push(
      `CLEANUP FAILED for household ${householdId} — delete it by hand: ${error?.message ?? error}`,
    )
  }
}

function printReport(report) {
  console.log('\n── the race, per repetition ' + '─'.repeat(44))
  console.log('  #   won  lost  path   winner   loser  overlap  runs  new  closed  faults')
  for (const row of report.repetitions) {
    console.log(
      `  ${String(row.index).padStart(2)}${String(row.won).padStart(5)}${String(row.lost).padStart(6)}  ${(row.path ?? '—').padEnd(6)}` +
        `${String(row.winnerMs).padStart(7)}ms${String(row.loserMs).padStart(7)}ms` +
        `${String(row.overlapMs).padStart(8)}ms${String(row.runs).padStart(6)}` +
        `${String(row.openRunItems).padStart(5)}${String(row.closedRunItems).padStart(8)}` +
        `${String(row.faults.length).padStart(8)}`,
    )
  }
  const guard = report.repetitions.filter((row) => row.path === 'guard').length
  const index = report.repetitions.filter((row) => row.path === 'index').length
  const other = report.repetitions.length - guard - index
  console.log(
    `\n  ${report.repetitions.length} repetitions: ` +
      `${guard} refused by the RPC's guard, ${index} by the unique index, ` +
      `${other} by neither`,
  )
  // The remainder is NAMED rather than left to subtraction. A loser refused by
  // neither path never reached the lock, so counting it toward AC 2 would be
  // counting a repetition that did not happen; it is also a fault, so the run
  // cannot end green on one.
  if (other > 0) {
    console.log(
      `  ${other} repetition(s) were refused by NEITHER documented path — see the faults;\n` +
        '  the likeliest cause is the loser being cancelled (57014) behind a slow winner,\n' +
        '  which means the guard was never reached and that repetition proves nothing.',
    )
  }
  console.log(
    '  (the overlap column is a timing note, NOT evidence of concurrency — it cannot\n' +
      '  be false by construction; the witness below is the only concurrency evidence)',
  )
  if (index > 0) {
    console.log(
      '  THE INDEX PATH WAS TAKEN — #357 must map SQLSTATE 23505 to the same copy\n' +
        "  as 'run already closed' (this story's AC 2 says so in as many words).",
    )
  }

  console.log('\n── a purchase racing a finish (recorded, not an AC) ' + '─'.repeat(21))
  for (const row of report.purchaseRaces) {
    console.log(
      `  ${String(row.index).padStart(2)}  purchase ${row.purchaseWon ? 'committed' : 'refused  '}` +
        `  carried ${row.carried}  bought-on-closed ${row.bought}` +
        `  faults ${row.faults.length}` +
        (row.purchaseMessage ? `  (${row.purchaseMessage})` : ''),
    )
  }

  const witness = report.witness
  if (witness) {
    console.log('\n── the witness ' + '─'.repeat(57))
    console.log(
      `  attempt ${witness.attemptNumber} of ${report.witnessAttempts.length} run ` +
        `(at most ${WITNESS_ATTEMPTS}) stands — ${report.witnessReason}`,
    )
    if (report.witnessAttempts.length > 1) {
      console.log(
        '  every attempt: ' +
          report.witnessAttempts
            .map((a) => `#${a.attemptNumber} ${a.kind}${a.witnessed ? '/witnessed' : ''}`)
            .join(', '),
      )
    }
    console.log(
      `  ${witness.items} items on the run, ${witness.carried} carried forward, ` +
        `${witness.kept} kept on the closed run`,
    )
    console.log(`  winner ${witness.winnerMs}ms, loser ${witness.loserMs}ms, refused by the ${witness.path}`)
    if (witness.loserMessage) console.log(`  the loser was told: ${witness.loserMessage}`)
    if (witness.winnerMessage) console.log(`  the WINNER failed too: ${witness.winnerMessage}`)
    console.log(
      `  ${WITNESS_SAMPLES} samples of pg_stat_activity: ${witness.samples.length} taken ` +
        `(${witness.samples.join(', ')} row(s))` +
        (witness.samplesFailed ? `, ${witness.samplesFailed} FAILED` : ', 0 failed'),
    )
    console.log(
      `  most ACTIVE backends in finish_shopping_run in ONE sample: ${witness.mostBackends}; ` +
        `lock waits seen: ${witness.lockWaits}` +
        (witness.waitEvents.length ? ` (${witness.waitEvents.join(', ')})` : ''),
    )
    for (const row of witness.rows) {
      console.log(`    pid ${row.pid} ${row.state} ${row.wait_event_type ?? '—'}/${row.wait_event ?? '—'} as ${row.usename}`)
    }
    if (witness.witnessed) {
      console.log(
        `  WITNESSED, in sample ${witness.witnessedIn + 1}: two ACTIVE backends in the\n` +
          '  function in that ONE sample, with a lock wait among them. That is the\n' +
          '  interleaving pglite cannot produce, read out of the server.',
      )
    } else if (witness.samples.length === 0) {
      console.log(
        '  NOT MEASURED: every sample FAILED, so the apparatus never asked. This says\n' +
          '  nothing whatever about the race — fix the Management API access and re-run.',
      )
    } else {
      console.log(
        '  NOT WITNESSED: the sampler asked and did not catch two active backends and a\n' +
          '  lock wait in one sample. The outcome above still held; what is missing is the\n' +
          '  server-side proof that the two transactions were open together, and a miss is\n' +
          '  reported as a miss. Raising WITNESS_ITEMS or the stagger is the next move.',
      )
    }
  }

  console.log(
    `\n${report.faults.length === 0 ? 'NO FAULTS' : `${report.faults.length} FAULT(S)`} ` +
      `across ${report.repetitions.length} finish races, ${report.purchaseRaces.length} tick races ` +
      'and the witness.\n',
  )
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

if (isMain) {
  try {
    await main(process.env)
  } catch (error) {
    // `process.exitCode`, never `process.exit()` — cairn's
    // `node-process-exit-after-fetch`: on Windows/Node 24 an exit after a fetch
    // to a remote host aborts inside libuv and replaces the code with one a
    // shell reports as 127.
    console.error(`\n${error instanceof Refusal ? error.message : (error?.stack ?? error)}\n`)
    process.exitCode = 1
  }
}
