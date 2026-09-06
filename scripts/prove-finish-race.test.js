// The judgement half of `prove-finish-race.mjs`, exercised against states that
// must FAIL — #356.
//
// WHY THIS FILE EXISTS AT ALL
//
// The script's whole value is a verdict on the live project, and a verdict is
// worth exactly what its checker is. `readBackFaults` and `purchaseRaceFaults`
// run ten and five times against a healthy database and return `[]` every time;
// a version of either that returned `[]` unconditionally would produce the same
// run, the same table and the same green sentence. Nothing in a live run can
// tell the two apart, because the live run never presents a broken state — the
// database will not build one.
//
// So the broken states are built here, by hand, and each one names the clause it
// breaks. The healthy fixture is asserted clean FIRST in every block, so a fault
// case that fires for some unrelated reason is caught rather than counted as the
// checker working. This is `prove-an-instrument-could-have-shown-the-opposite`
// applied to the instrument rather than to its subject.
//
// Nothing here touches a network, a project or a credential: the script's live
// half is not imported by importing these functions, and this file runs in CI
// like every other test, which is the point of putting the judgements in pure
// functions in the first place.

import { describe, expect, it } from 'vitest'

import {
  FIXTURE_ITEMS,
  GUARD_SQLSTATE,
  PURCHASE_REPETITIONS,
  REPETITIONS,
  UNIQUE_VIOLATION_SQLSTATE,
  WITNESS_ITEMS,
  attemptKind,
  cleanupFaults,
  fixtureFaults,
  overlapOf,
  pathFaults,
  purchaseRaceFaults,
  raceFaults,
  readBackFaults,
  refusalPath,
  selectWitness,
  witnessFaults,
  witnessVerdict,
} from './prove-finish-race.mjs'

/** The three fixture items, as the ids a before-read would have written down. */
const ORIGINAL_IDS = ['o1', 'o2', 'o3']

/** The shape supabase-js hands back through shopping.js's `unwrap`. */
function refusal(message, code) {
  const error = new Error(`finishing the run: ${message}`)
  error.cause = { code, message }
  return error
}

/**
 * The state a correct finish leaves behind: two runs, the originals still on the
 * closed one, a copy of each on the open one pointing back at it.
 *
 * Built by a function rather than written out once so each fault case below can
 * break exactly one clause of it and leave the rest correct — a hand-edited
 * second copy would drift and the failures would stop being attributable.
 */
function healthy(overrides = {}) {
  const runs = [
    { id: 'closed', list_id: 'l', closed_at: '2026-09-06T10:00:00Z', closed_by_member_id: 'm1' },
    { id: 'open', list_id: 'l', closed_at: null, closed_by_member_id: null },
  ]
  const itemsByRun = new Map([
    ['closed', ORIGINAL_IDS.map((id) => ({ id, run_id: 'closed', name: id, purchased_at: null, carried_from_item_id: null }))],
    ['open', ORIGINAL_IDS.map((id) => ({ id: `c-${id}`, run_id: 'open', name: id, purchased_at: null, carried_from_item_id: id }))],
  ])
  return { runs, itemsByRun, originalIds: ORIGINAL_IDS, winningRunId: 'open', ...overrides }
}

/** The same, as the two flat lists `purchaseRaceFaults` takes. */
function tickHealthy({ boughtIndex = null } = {}) {
  const closedItems = ORIGINAL_IDS.map((id) => ({
    id,
    name: id,
    purchased_at: null,
  }))
  if (boughtIndex !== null) closedItems[boughtIndex].purchased_at = '2026-09-06T10:00:00Z'
  const carriedItems = closedItems
    .filter((item) => item.purchased_at === null)
    .map((item) => ({ id: `c-${item.id}`, carried_from_item_id: item.id }))
  return { closedItems, carriedItems, originalIds: ORIGINAL_IDS }
}

describe('#356 — the constants the script and its report share', () => {
  it('are the numbers the acceptance criteria name', () => {
    expect(REPETITIONS).toBe(10)
    expect(FIXTURE_ITEMS).toHaveLength(3)
    expect(PURCHASE_REPETITIONS).toBeGreaterThan(0)
    // Big enough that the carry outlasts a Management API round trip; the
    // witness cannot sample a race that is over before the first sample lands.
    expect(WITNESS_ITEMS).toBeGreaterThan(1000)
  })
})

describe('#356 AC 1 — the fixture confirmed by a read BEFORE the race', () => {
  /** One list, one open run, three unpurchased items nobody carried. */
  function seeded(overrides = {}) {
    return {
      lists: [{ id: 'l' }],
      runs: [{ id: 'r', list_id: 'l' }],
      items: ORIGINAL_IDS.map((id) => ({
        id,
        run_id: 'r',
        purchased_at: null,
        carried_from_item_id: null,
      })),
      ...overrides,
    }
  }

  it('POSITIVE CONTROL: the seeded fixture is clean', () => {
    expect(fixtureFaults(seeded(), 'l')).toEqual([])
  })

  it('refuses a list that is not there', () => {
    expect(fixtureFaults(seeded({ lists: [] }), 'l').join(' ')).toMatch(/0 lists match/)
  })

  it('refuses a list already carrying two open runs', () => {
    const state = seeded()
    state.runs.push({ id: 'r2', list_id: 'l' })
    expect(fixtureFaults(state, 'l').join(' ')).toMatch(/2 open runs/)
  })

  it('refuses the wrong number of items', () => {
    const state = seeded()
    state.items.pop()
    expect(fixtureFaults(state, 'l').join(' ')).toMatch(/holds 2 items, expected 3/)
  })

  it('refuses a fixture whose item is already bought', () => {
    // AC 1 says three UNPURCHASED items, and it matters: a bought item is not
    // carried forward, so a fixture with one would make the read-back's "three
    // carried" clause fail for a reason that is not the RPC's.
    const state = seeded()
    state.items[0].purchased_at = '2026-09-06T10:00:00Z'
    expect(fixtureFaults(state, 'l').join(' ')).toMatch(/already bought/)
  })

  it('refuses a fixture item that is already a carried copy', () => {
    const state = seeded()
    state.items[0].carried_from_item_id = 'somewhere'
    expect(fixtureFaults(state, 'l').join(' ')).toMatch(/already a carried copy/)
  })
})

describe('#356 AC 2 — which refusal path the loser took', () => {
  it('reads the RPC guard from the sentence the function raises', () => {
    expect(refusalPath(refusal('run already closed', GUARD_SQLSTATE))).toBe('guard')
  })

  it('reads the unique index from SQLSTATE, whatever the message says', () => {
    // The index path is the one AC 2 asks about by name: if it is ever taken,
    // #357's error copy has to map 23505 as well as the sentence. So it is
    // recognised by the CODE, because Postgres's own wording for a unique
    // violation names the index and never says "run already closed".
    const error = refusal(
      'duplicate key value violates unique constraint "shopping_runs_one_open_per_list"',
      UNIQUE_VIOLATION_SQLSTATE,
    )
    expect(refusalPath(error)).toBe('index')
  })

  it('calls anything else "other" rather than guessing', () => {
    expect(refusalPath(refusal('no such run in your household', GUARD_SQLSTATE))).toBe('other')
    expect(refusalPath(refusal('network error', null))).toBe('other')
  })

  it('POSITIVE CONTROL: the three paths are distinguishable, so a constant is not passing', () => {
    const paths = new Set([
      refusalPath(refusal('run already closed', GUARD_SQLSTATE)),
      refusalPath(refusal('duplicate key', UNIQUE_VIOLATION_SQLSTATE)),
      refusalPath(refusal('anything', null)),
    ])
    expect(paths.size).toBe(3)
  })
})

describe('#356 AC 2 — exactly one winner and one loser', () => {
  const won = { ok: true, value: { id: 'open' } }
  const lost = { ok: false, error: refusal('run already closed', GUARD_SQLSTATE) }

  it('POSITIVE CONTROL: the correct outcome is clean', () => {
    expect(raceFaults([won, lost])).toEqual([])
  })

  it('refuses TWO winners — the defect the epic is about', () => {
    // Two open runs and every item carried twice. This is the outcome the whole
    // story exists to rule out, so it is the one fault case that must be
    // impossible to miss.
    expect(raceFaults([won, won]).join(' ')).toMatch(/2 calls succeeded/)
  })

  it('refuses two losers — nothing finished at all', () => {
    expect(raceFaults([lost, lost]).join(' ')).toMatch(/0 calls succeeded/)
  })

  it('refuses a winner that returned no run', () => {
    expect(raceFaults([{ ok: true, value: null }, lost].slice()).join(' ')).toMatch(/no new run/)
  })

  it('refuses a race that was not two calls', () => {
    expect(raceFaults([won]).join(' ')).toMatch(/exactly 2 callers/)
  })
})

describe('#356 — the client-side timings, which decide NOTHING', () => {
  // `overlapOf` used to return `inFlightTogether`, offered as necessary-but-not-
  // sufficient evidence of concurrency. Review found it structurally always true
  // — `attempt()` stamps `startedAt` before its factory runs and both calls are
  // made in one synchronous block — so the flag was a positive claim that could
  // not be false, including in the serialised world it existed to rule out. It
  // is gone rather than repaired; these tests pin the ARITHMETIC only, and the
  // absence of a verdict field is itself asserted below.
  it('reports the three gaps, and no verdict of any kind', () => {
    const overlap = overlapOf({ startedAt: 0, settledAt: 100 }, { startedAt: 1, settledAt: 103 })
    expect(overlap).toEqual({ dispatchGapMs: 1, settleGapMs: 3, overlapMs: 99 })
  })

  it('does NOT export a concurrency flag — the witness is the only evidence', () => {
    // A regression guard on the correction rather than on the code: re-adding
    // `inFlightTogether` would restore a field that cannot be false, and the
    // README and the epic write-up were both edited to stop quoting it.
    const overlap = overlapOf({ startedAt: 0, settledAt: 100 }, { startedAt: 120, settledAt: 160 })
    expect(overlap).not.toHaveProperty('inFlightTogether')
    expect(overlap.overlapMs).toBe(-20)
  })
})

describe('#356 AC 2 — a loser refused by neither documented path is a fault', () => {
  it('POSITIVE CONTROL: the two documented paths are clean', () => {
    expect(pathFaults('guard', 'run already closed')).toEqual([])
    expect(pathFaults('index', 'duplicate key')).toEqual([])
  })

  it('refuses a loser cancelled behind a slow winner — the reachable 57014 case', () => {
    // The instance this exists for, and it is this script's own hazard rather
    // than a dropped socket: the loser is the caller parked on `for update`, so
    // a winner slow enough to hit statement_timeout gets the LOSER cancelled
    // with 57014. The read-back is then perfectly healthy and the guard was
    // never reached — a repetition that proves nothing, counted toward ten.
    const faults = pathFaults('other', 'canceling statement due to statement timeout')
    expect(faults.join(' ')).toMatch(/neither the guard nor the index/)
    expect(faults.join(' ')).toMatch(/statement timeout/)
  })

  it('refuses a race in which nobody was refused at all', () => {
    expect(pathFaults(null, '').join(' ')).toMatch(/no caller was refused/)
  })
})

describe('#356 AC 3 — what a client reads back, clause by clause', () => {
  it('POSITIVE CONTROL: the correct post-race state is clean', () => {
    expect(readBackFaults(healthy())).toEqual([])
  })

  it('refuses a list left with two OPEN runs', () => {
    const state = healthy()
    state.runs[0].closed_at = null
    expect(readBackFaults(state).join(' ')).toMatch(/2 runs are open/)
  })

  it('refuses a third run', () => {
    const state = healthy()
    state.runs.push({ id: 'extra', list_id: 'l', closed_at: null, closed_by_member_id: null })
    expect(readBackFaults(state).join(' ')).toMatch(/3 runs, expected 2/)
  })

  it('refuses an open run that is not the one the winning call returned', () => {
    expect(readBackFaults(healthy({ winningRunId: 'somewhere-else' })).join(' ')).toMatch(
      /not the run the winning call returned/,
    )
  })

  it('refuses a close with no closer', () => {
    const state = healthy()
    state.runs[0].closed_by_member_id = null
    expect(readBackFaults(state).join(' ')).toMatch(/records no closer/)
  })

  it('refuses AN ITEM CARRIED TWICE — the "nothing duplicated" half', () => {
    // Three copies on the new run, two of them pointing at the same original.
    // The counts still read 3 and 3, which is why the before-read's ids are what
    // this clause is checked against and not the length of the list.
    const state = healthy()
    state.itemsByRun.get('open')[1].carried_from_item_id = 'o1'
    const faults = readBackFaults(state).join(' ')
    expect(faults).toMatch(/original o1 was carried 2 times/)
    expect(faults).toMatch(/original o2 was carried 0 times/)
  })

  it('refuses an item that was MOVED rather than copied', () => {
    const state = healthy()
    state.itemsByRun.get('open')[0].id = 'o1'
    expect(readBackFaults(state).join(' ')).toMatch(/MOVED to the new run/)
  })

  it('refuses a carried item with no origin', () => {
    const state = healthy()
    state.itemsByRun.get('open')[2].carried_from_item_id = null
    expect(readBackFaults(state).join(' ')).toMatch(/no carried_from_item_id/)
  })

  it('refuses a carried item pointing outside the fixture', () => {
    const state = healthy()
    state.itemsByRun.get('open')[2].carried_from_item_id = 'somebody-elses-item'
    expect(readBackFaults(state).join(' ')).toMatch(/point outside the fixture/)
  })

  it('refuses a LOST item — two carried where three were unbought', () => {
    const state = healthy()
    state.itemsByRun.get('open').pop()
    expect(readBackFaults(state).join(' ')).toMatch(/holds 2 items, expected 3/)
  })

  it('refuses an original that vanished from the closed run', () => {
    const state = healthy()
    state.itemsByRun.get('closed').pop()
    expect(readBackFaults(state).join(' ')).toMatch(/closed run holds 2 items/)
  })

  it('refuses a purchase nobody made', () => {
    const state = healthy()
    state.itemsByRun.get('closed')[0].purchased_at = '2026-09-06T10:00:00Z'
    expect(readBackFaults(state).join(' ')).toMatch(/marked bought, and none was bought/)
  })
})

describe('#356 — a purchase racing a finish, the recorded second case', () => {
  it('POSITIVE CONTROL: the finish-wins ordering is clean', () => {
    // The tick was refused with `run already closed`, so nothing is bought and
    // all three are carried.
    expect(purchaseRaceFaults(tickHealthy())).toEqual([])
  })

  it('POSITIVE CONTROL: the purchase-wins ordering is clean too', () => {
    // The tick committed first, the carry saw it and skipped that row: one
    // bought on the closed run, two carried. Both orderings are correct, which
    // is why the invariant is written per item and not as "who won".
    expect(purchaseRaceFaults(tickHealthy({ boughtIndex: 0 }))).toEqual([])
  })

  it('refuses an item BOUGHT on the closed run AND carried forward', () => {
    // The household buys it twice. This is the exact outcome `0033`'s key-share
    // clause on the three item writers exists to make unreachable, and the one
    // this second case is measuring.
    const state = tickHealthy({ boughtIndex: 0 })
    state.carriedItems.push({ id: 'c-o1', carried_from_item_id: 'o1' })
    expect(purchaseRaceFaults(state).join(' ')).toMatch(/bought on the closed run AND carried/)
  })

  it('refuses an unbought item that was carried nowhere', () => {
    const state = tickHealthy()
    state.carriedItems.pop()
    expect(purchaseRaceFaults(state).join(' ')).toMatch(/unbought o3 was carried 0 times/)
  })

  it('refuses an unbought item carried twice', () => {
    const state = tickHealthy()
    state.carriedItems.push({ id: 'c2-o1', carried_from_item_id: 'o1' })
    expect(purchaseRaceFaults(state).join(' ')).toMatch(/unbought o1 was carried 2 times/)
  })

  it('refuses a carried item pointing outside the fixture', () => {
    const state = tickHealthy()
    state.carriedItems[0].carried_from_item_id = 'elsewhere'
    expect(purchaseRaceFaults(state).join(' ')).toMatch(/points outside the fixture/)
  })

  // The two clauses below had NO fault fixture until the #356 review measured it:
  // deleting either reddened 0 of 40. They are load-bearing precisely because
  // this checker deliberately omits a carried-COUNT check (the count depends on
  // which side of the race won), so these two carry the whole "nothing appeared,
  // nothing was lost" half of the invariant on their own.

  it('refuses a stray item on the new run with NO origin', () => {
    // Every other clause is blind to it: the `source &&` guard short-circuits
    // the outside-the-fixture check, the per-item loop iterates closed items
    // only, and the counts are all as expected. This clause is the sole detector.
    const state = tickHealthy()
    state.carriedItems.push({ id: 'x', carried_from_item_id: null })
    expect(purchaseRaceFaults(state).join(' ')).toMatch(/no carried_from_item_id/)
  })

  it('refuses an original that vanished from the closed run', () => {
    // Also sole-detector: the per-item loop iterates only the SURVIVING closed
    // items, so a lost original is never examined, and its copy on the new run
    // still points inside originalSet.
    const state = tickHealthy()
    state.closedItems.pop()
    expect(purchaseRaceFaults(state).join(' ')).toMatch(/the closed run holds 2 items, expected 3/)
  })
})

describe('#356 — the witness verdict, which must be able to say NOT SEEN', () => {
  /** One backend, described the way pg_stat_activity describes one. */
  function backend(pid, { state = 'active', type = null, event = null } = {}) {
    return { pid, state, wait_event_type: type, wait_event: event, usename: 'authenticator' }
  }

  it('reports the interleaving when ONE sample holds both halves', () => {
    const samples = [
      [backend(11), backend(12, { type: 'Lock', event: 'transactionid' })],
      [],
    ]
    expect(witnessVerdict(samples)).toMatchObject({
      mostBackends: 2,
      lockWaits: 1,
      witnessedIn: 0,
      witnessed: true,
      waitEvents: ['transactionid'],
    })
  })

  it('REFUSES a verdict assembled from two DIFFERENT samples', () => {
    // The high finding from the #356 review. The first version reduced the
    // samples to a max and a sum and ANDed them, so this input returned a full
    // WITNESSED — two backends in sample 0, a lock wait in sample 1, and the
    // waiting pid in neither of the counted pair. Nothing required the two
    // halves to be the same instant.
    const samples = [
      [backend(11), backend(12)],
      [backend(13, { type: 'Lock', event: 'transactionid' })],
    ]
    const verdict = witnessVerdict(samples)
    expect(verdict.witnessed).toBe(false)
    // The descriptive counts still report what was seen; they just decide nothing.
    expect(verdict.concurrent).toBe(true)
    expect(verdict.sawLockWait).toBe(true)
  })

  it('IGNORES an idle backend whose LAST query was the function', () => {
    // Postgres keeps `query` as the last statement of an idle backend, and this
    // phase runs after fifteen earlier finishes — so pooled connections doing
    // nothing at all match the sampler's ilike. Without this filter the
    // concurrency half is satisfiable by backends that are not running anything.
    const samples = [
      [
        backend(11, { type: 'Lock', event: 'transactionid' }),
        backend(12, { state: 'idle', type: 'Client', event: 'ClientRead' }),
        backend(13, { state: 'idle', type: 'Client', event: 'ClientRead' }),
      ],
    ]
    const verdict = witnessVerdict(samples)
    expect(verdict.mostBackends).toBe(1)
    expect(verdict.witnessed).toBe(false)
  })

  it('reports NOT SEEN when the sampler only ever caught one backend', () => {
    const verdict = witnessVerdict([[backend(11)], []])
    expect(verdict.witnessed).toBe(false)
    expect(verdict.concurrent).toBe(false)
    expect(verdict.sawLockWait).toBe(false)
  })

  it('reports NOT SEEN for an empty sample set, rather than nothing at all', () => {
    expect(witnessVerdict([[], [], []])).toMatchObject({
      mostBackends: 0,
      witnessed: false,
      concurrent: false,
      sawLockWait: false,
    })
  })

  it('counts two backends with no lock wait as unwitnessed', () => {
    // Both active, neither blocked — an overlap with the MECHANISM not caught.
    // Separated on purpose: the story's claim is about the lock.
    const verdict = witnessVerdict([[backend(11), backend(12, { type: 'Client', event: 'ClientRead' })]])
    expect(verdict.concurrent).toBe(true)
    expect(verdict.witnessed).toBe(false)
  })

  it('matches any Lock wait, not only transactionid, and records which', () => {
    // A row lock can be waited on as `tuple` as well. Narrowing to the value
    // this project happened to produce would turn a legitimate variant into a
    // miss, so the event is REPORTED rather than required.
    const verdict = witnessVerdict([[backend(11), backend(12, { type: 'Lock', event: 'tuple' })]])
    expect(verdict.witnessed).toBe(true)
    expect(verdict.waitEvents).toEqual(['tuple'])
  })
})

describe('#356 — which witness attempt stands, by fault KIND', () => {
  const clean = { attemptNumber: 1, kind: 'clean', faults: [], witnessed: false }
  const witnessed = { attemptNumber: 2, kind: 'clean', faults: [], witnessed: true }
  const machine = { attemptNumber: 3, kind: 'machine', faults: ['0 calls succeeded'] }
  const defect = { attemptNumber: 3, kind: 'defect', faults: ['2 calls succeeded, expected exactly 1'] }

  it('classifies no-winner as the MACHINE and two-winners as a DEFECT', () => {
    // The discriminator is whether anything committed. With no winner nothing
    // ran; with two, the thing the epic protects has already failed.
    expect(attemptKind([], 1)).toBe('clean')
    expect(attemptKind(['0 calls succeeded'], 0)).toBe('machine')
    expect(attemptKind(['2 calls succeeded'], 2)).toBe('defect')
    expect(attemptKind(['an item was carried twice'], 1)).toBe('defect')
  })

  it('lets a DEFECT stand over any number of clean attempts', () => {
    // The correction that matters most. "Take the last clean attempt" would
    // have discarded a genuine two-winner observation — two open runs, every
    // item carried twice — which is the one result this script exists to catch.
    expect(selectWitness([clean, witnessed, defect]).standing).toBe(defect)
  })

  it('does NOT let a machine-killed attempt supersede a clean one', () => {
    // The defect as found: the last attempt's faults were pushed, so a carry
    // killed by statement_timeout on attempt 3 failed the whole proof while two
    // clean attempts sat unused.
    const { standing, reason } = selectWitness([clean, witnessed, machine])
    expect(standing).toBe(witnessed)
    expect(reason).toMatch(/caught the lock wait/)
  })

  it('prefers a witnessed clean attempt over an unwitnessed one', () => {
    expect(selectWitness([clean, witnessed]).standing).toBe(witnessed)
  })

  it('falls back to a clean-but-unwitnessed attempt', () => {
    expect(selectWitness([machine, clean]).standing).toBe(clean)
  })

  it('says plainly when every attempt was denied by the machine', () => {
    const { standing, reason } = selectWitness([machine, machine])
    expect(standing).toBe(machine)
    expect(reason).toMatch(/nothing was measured/)
  })

  it('handles no attempts at all rather than throwing', () => {
    expect(selectWitness([]).standing).toBeNull()
  })
})

describe('#356 — the two judgements that used to be inline and untested', () => {
  it('POSITIVE CONTROL: a correct witness run is clean', () => {
    expect(witnessFaults({ runs: 2, carried: 8000, kept: 8000, loaded: 8000 })).toEqual([])
  })

  it('refuses a witness list that never got its second run', () => {
    expect(witnessFaults({ runs: 1, carried: 0, kept: 0, loaded: 8000 }).join(' ')).toMatch(
      /has 1 runs, expected 2/,
    )
  })

  it('refuses a carry that lost items', () => {
    expect(witnessFaults({ runs: 2, carried: 475, kept: 8000, loaded: 8000 }).join(' ')).toMatch(
      /475 items carried forward, expected 8000/,
    )
  })

  it('refuses a closed run that lost its originals', () => {
    expect(witnessFaults({ runs: 2, carried: 8000, kept: 0, loaded: 8000 }).join(' ')).toMatch(
      /closed run kept 0 items/,
    )
  })

  it('POSITIVE CONTROL: an empty cleanup read-back is clean', () => {
    expect(cleanupFaults({ households: 0, members: 0, lists: 0, runs: 0, items: 0 })).toEqual([])
  })

  it('refuses residue in EACH of the five columns', () => {
    // AC 5's whole claim is an absence, and this was the silent one: the counts
    // were stored and never printed, so a comparison that could not fire would
    // have left "the absence read back" as the only output.
    for (const column of ['households', 'members', 'lists', 'runs', 'items']) {
      const left = { households: 0, members: 0, lists: 0, runs: 0, items: 0, [column]: 3 }
      expect(cleanupFaults(left).join(' '), `${column} residue not reported`).toMatch(
        new RegExp(`3 ${column}`),
      )
    }
  })

  it('names every surviving column at once, not just the first', () => {
    const faults = cleanupFaults({ households: 1, members: 2, lists: 0, runs: 0, items: 9 })
    expect(faults.join(' ')).toMatch(/1 households/)
    expect(faults.join(' ')).toMatch(/2 members/)
    expect(faults.join(' ')).toMatch(/9 items/)
  })
})
