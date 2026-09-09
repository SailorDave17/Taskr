/**
 * Which household this DEVICE last had chosen — #165.
 *
 * ONE value, and it is not household data. `App.jsx` states the discipline this
 * appears to break: nothing the server owns is held locally, because a device
 * that merely remembered would produce a passing "survives a restart" check
 * indistinguishable from one that re-read. That discipline is intact. What is
 * stored here is an id — a POINTER at a row, never the row — so every name,
 * every member and every chore still arrives from the server on every load, and
 * a stale pointer costs a person one tap rather than a wrong screen.
 *
 * THE OWNER'S REASONING, 2026-08-26, recorded in band because a future reader
 * will otherwise read this file as a violation: the credential is already held
 * locally and correctly — Supabase's session lives in this same storage — and a
 * UI preference about which of your own households is showing sits on the
 * credential side of that line, not the data side. The alternative on the table
 * was a deterministic default with no memory at all, and it was rejected for
 * what it costs the person the feature exists for: somebody who mostly uses
 * their second household would re-pick it every morning, forever.
 *
 * EVERY ACCESS IS WRAPPED (#165 AC 8). Private mode, cleared site data and a
 * browser configured to refuse storage all throw on the ACCESSOR itself rather
 * than returning null, so a bare read here would take the whole boot down over a
 * preference. A device that cannot remember gets the deterministic default and
 * says nothing about it, which is the correct degradation: the app works, it
 * just opens where it always does.
 */

/**
 * The key. Deliberately NOT `taskr.household` or `taskr.members` — those two
 * names are asserted absent by App.test.jsx's "reads the household from the
 * server on every load" test, whose subject is the household ROW and the
 * ROSTER. Reusing either would make that test pass or fail for a reason that
 * has nothing to do with what it is about, and picking a non-colliding key to
 * get green is exactly the cheap move #165 AC 4 forbids. This name says what it
 * holds: the choice, not the household.
 */
const KEY = 'taskr.activeHousehold'

/**
 * A uuid, and nothing else, is a household id — #165 AC 3.
 *
 * Shape only. This cannot know whether the id names a household the caller
 * belongs to; `resolveActiveHousehold` answers that against the set the server
 * just returned, and the two checks are deliberately separate because they fail
 * for different reasons and only one of them means the storage was tampered
 * with. What this refuses is a value that was never an id: a truncated write, a
 * different app's key colliding, a person editing devtools.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The storage this device offers, or null where it offers none. */
function storage() {
  try {
    // The ACCESSOR is what throws in a browser configured to block site data,
    // so it is inside the try rather than beside it.
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The household id this device last had chosen, or null.
 *
 * Null covers every failure identically and on purpose: nothing stored, storage
 * unavailable, and a value that is not a uuid all mean "no choice this device
 * can act on", and the caller's answer to all three is the deterministic
 * default. A value that fails the shape check is DISCARDED as it is read (AC 3),
 * so a junk value cannot sit there being re-rejected on every load.
 */
export function readActiveHouseholdChoice() {
  const store = storage()
  if (!store) return null
  let stored = null
  try {
    stored = store.getItem(KEY)
  } catch {
    return null
  }
  if (!stored) return null
  if (!UUID.test(stored)) {
    clearActiveHouseholdChoice()
    return null
  }
  return stored
}

/**
 * Remember a choice — and ONLY a choice.
 *
 * Nothing calls this on a plain load, which is the whole reason #210's "a reload
 * starts clean" test still reads `localStorage.length === 0`: a person who has
 * never switched household has never chosen one, so this device stores nothing
 * and there is nothing to go stale. Writing the resolved default on every boot
 * would have been easier and would have turned a deterministic default into a
 * remembered one the first time anybody opened the app.
 */
export function writeActiveHouseholdChoice(id) {
  if (!id || !UUID.test(id)) return
  const store = storage()
  if (!store) return
  try {
    store.setItem(KEY, id)
  } catch {
    // A full or refused quota is not a reason to fail the switch the person
    // just made. They get the household they asked for; the next load opens on
    // the default.
  }
}

/**
 * Forget the choice — #165 AC 7, and the stale-value half of AC 2.
 *
 * Called on sign-out, because a household id outlives a session otherwise and
 * this is a household app where a shared tablet is likely: the next person to
 * sign in on it would land on a household chosen by somebody else. Also called
 * when a stored id turns out not to name a household the caller belongs to, so
 * a removed membership cannot strand the app on a value it re-rejects forever.
 */
export function clearActiveHouseholdChoice() {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(KEY)
  } catch {
    // Nothing to do and nothing owed: a device that cannot forget also could
    // not have remembered, so there is no value here to leak.
  }
}
