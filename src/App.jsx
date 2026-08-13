import { useCallback, useEffect, useState } from 'react'
import { buildInfo } from './buildInfo.js'
import { hasSupabaseConfig } from './lib/supabase.js'
import {
  addMember,
  createHousehold,
  currentHousehold,
  currentSession,
  currentUserId,
  findClaimedMember,
  listMembers,
  removeMember,
  signIn,
  signOut,
  signUpOrganizer,
  updateMember,
} from './lib/household.js'
import {
  addChore,
  assignChore,
  completeChore,
  listChores,
  removeChore,
  unassignChore,
  uncompleteChore,
  updateChore,
} from './lib/chores.js'
import {
  capacitiesFor,
  clearCapacity,
  listCapacity,
  periodStartFor,
  setCapacity,
} from './lib/capacity.js'
import Chores from './components/Chores.jsx'
import Onboarding from './components/Onboarding.jsx'
import Roster from './components/Roster.jsx'

// Story #5: the household roster, on family phones.
//
// The screen is a function of one question — WHO is signed in, and do they
// belong to a household? — and that question is answered by the SERVER on every
// load, never by localStorage. AC 3 asks that the roster survive a force-close,
// a reinstall and a backend restart, and a locally cached roster would make a
// passing check indistinguishable from a device that merely remembered. What IS
// held locally is the Supabase auth session, which is the credential, not the
// data; that is what makes "still signed in days later" true without retyping
// anything.
//
// #62 changed what that session IS. It used to be an anonymous DEVICE identity,
// minted on boot so the app always had one, with a separate step to say which
// person the device was acting as. Now it is the person: one identity, acquired
// deliberately, and no state in which somebody is signed in as nobody.

export default function App() {
  const [status, setStatus] = useState('loading')
  const [household, setHousehold] = useState(null)
  const [members, setMembers] = useState([])
  const [chores, setChores] = useState([])
  // #46 — this week's capacity overrides, and the period they belong to. Both
  // come from refresh() rather than being derived in render: the period depends
  // on the household's timezone, which is only known once the household is read,
  // and the overrides are a server read like every other.
  const [overrides, setOverrides] = useState([])
  const [periodStart, setPeriodStart] = useState(null)
  const [userId, setUserId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  /** Re-read everything this device is allowed to see. */
  const refresh = useCallback(async () => {
    const found = await currentHousehold()
    setHousehold(found)
    setMembers(found ? await listMembers() : [])
    // #34: chores re-read through the same path as members, so the
    // mutate-then-refresh guarantee covers them without a second mechanism.
    setChores(found ? await listChores() : [])
    // #46 — read this week's overrides from the SERVER on every refresh, through
    // the same path as everything else. AC 4 asks that nothing be served from a
    // local cache, and the way to be sure of that is to have no cache: a device
    // that merely remembered would show the same numbers as one that re-read.
    //
    // The period is computed HERE, from the household just read, because
    // periodStartFor needs the household's zone and refuses to guess one. That
    // also makes the ordering explicit — a period from a stale household would
    // file this week's capacity under last week's key.
    const period = found ? periodStartFor(new Date(), found.timezone) : null
    setPeriodStart(period)
    setOverrides(period ? await listCapacity(period) : [])
    setUserId(await currentUserId())
    return found
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      // Not an error, and deliberately not treated as one: a local checkout with
      // no .env.local is a normal state. Saying so beats a network error that
      // reads like the database being down.
      if (!hasSupabaseConfig) {
        if (!cancelled) setStatus('unconfigured')
        return
      }
      try {
        // No session is a normal state now, not one to repair. Under device auth
        // this called `ensureSession()`, which signed the phone in anonymously so
        // that boot always ended with an identity; #62 removes the idea of being
        // signed in as nobody, so a phone with no session gets the sign-in screen
        // and a person decides who they are.
        //
        // The reads are skipped entirely rather than attempted and allowed to
        // come back empty. They would succeed — every policy simply returns
        // nothing to an unauthenticated caller — and "signed out" would be
        // indistinguishable from "your household disappeared", which is the more
        // alarming of the two readings and the wrong one.
        const session = await currentSession()
        if (!session) {
          if (!cancelled) setStatus('onboarding')
          return
        }
        const found = await refresh()
        if (!cancelled) setStatus(found ? 'joined' : 'onboarding')
      } catch (err) {
        if (!cancelled) {
          setError(err.message)
          setStatus('failed')
        }
      }
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [refresh])

  /**
   * Run a mutation, then re-read from the server rather than patching local
   * state from the response. Slower by one round trip and correct by
   * construction: what the next device to load will see is exactly what this
   * device now shows.
   */
  const mutate = useCallback(
    async (action) => {
      setBusy(true)
      setError(null)
      try {
        const result = await action()
        const found = await refresh()
        setStatus(found ? 'joined' : 'onboarding')
        return result
      } catch (err) {
        setError(err.message)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  // Two steps in one action, and the order is load-bearing. `create_household`
  // refuses an unauthenticated caller and claims the organizer's member row to
  // `auth.uid()` in the same statement — so the account has to exist first, and
  // the household created second is already reachable by the person who made it.
  // Reversing them is not merely wrong, it is unrecoverable from the client:
  // a household whose organizer row is unclaimed is visible to nobody.
  //
  // The signup is CONDITIONAL, and that is the repair for a dead end. These are
  // two durable steps with no transaction between them, so the second can fail
  // on its own — and it did more than hypothetically: against a project without
  // 0007 applied, `create_household` fails every time. That left an auth account
  // with no household, on a screen whose only Create button would call `signUp`
  // again for an address that now exists, throw, and never reach the RPC.
  //
  // So when a session already exists, this skips straight to the household. The
  // person who got half-way through is offered the half they are missing rather
  // than the half they already have, and `Onboarding` renders `Sign out` in that
  // state so the other way out exists too.
  const handleCreate = useCallback(
    (name, { organizerName, email, password }) =>
      mutate(async () => {
        if (!userId) await signUpOrganizer({ email, password })
        return createHousehold(name, { organizerName })
      }),
    [mutate, userId],
  )
  const handleSignIn = useCallback(
    (credentials) => mutate(() => signIn(credentials)),
    [mutate],
  )
  const handleSignOut = useCallback(() => mutate(() => signOut()), [mutate])
  const handleAdd = useCallback((person) => mutate(() => addMember(person)), [mutate])
  const handleSave = useCallback((id, patch) => mutate(() => updateMember(id, patch)), [mutate])
  const handleRemove = useCallback((id) => mutate(() => removeMember(id)), [mutate])
  const handleRefresh = useCallback(() => mutate(async () => {}), [mutate])
  // #34 — chores. Each goes through mutate(), which re-reads from the server
  // rather than patching local state from the response: what the next device to
  // load will see is exactly what this device now shows.
  const handleAddChore = useCallback((chore) => mutate(() => addChore(chore)), [mutate])
  const handleSaveChore = useCallback((id, patch) => mutate(() => updateChore(id, patch)), [mutate])
  const handleRemoveChore = useCallback((id) => mutate(() => removeChore(id)), [mutate])
  // #35 — completion goes through an RPC because the SERVER sets the clock, not
  // because of access control. A phone with the wrong date would otherwise move
  // work between weeks.
  const handleCompleteChore = useCallback((id) => mutate(() => completeChore(id)), [mutate])
  const handleUncompleteChore = useCallback((id) => mutate(() => uncompleteChore(id)), [mutate])
  // #36 — assignment goes through an RPC for ACCESS rather than the clock:
  // `assigned_member_id` is absent from the update grant, so this is the only
  // write path there is. Committed and remaining minutes are NOT fetched — they
  // are derived from `chores` and `members` at render time, which is why nothing
  // here has to be kept in step with them.
  const handleAssignChore = useCallback(
    (id, memberId) => mutate(() => assignChore(id, memberId)),
    [mutate],
  )
  const handleUnassignChore = useCallback((id) => mutate(() => unassignChore(id)), [mutate])
  // #46 — set or clear THIS period's capacity. Both take the period from state
  // rather than recomputing it, so the write lands in the same week the screen
  // is showing even if midnight passes mid-session.
  //
  // Nothing here touches a model, a network service or a credential beyond the
  // database (AC 6): the manual road in is the floor the charter requires on day
  // one, and the extraction bet (#57) is an accelerator on top of it, never the
  // only way in. A test asserts that this path imports nothing else.
  const handleSetCapacity = useCallback(
    (memberId, minutes) => {
      if (!periodStart) return Promise.reject(new Error('No week to set capacity for yet.'))
      return mutate(() => setCapacity({ memberId, periodStart, minutes }))
    },
    [mutate, periodStart],
  )
  const handleClearCapacity = useCallback(
    (memberId) => {
      if (!periodStart) return Promise.reject(new Error('No week to clear capacity for yet.'))
      return mutate(() => clearCapacity(memberId, periodStart))
    },
    [mutate, periodStart],
  )

  const me = findClaimedMember(members, userId)

  // #36 — capacity for the load figures, resolved through THE single definition
  // in capacity.js rather than by reading `members.weekly_minutes` here. #44 AC 7
  // makes that a rule and capacity.test.js enforces it with an allowlist.
  //
  // #46 filled in the second argument. It was `[]` when #36 shipped, and that was
  // true rather than a stub — nothing wrote a `member_capacity` row yet. Now the
  // overrides are real and the load figures on the chore screen follow this
  // week automatically, because they always went through `capacitiesFor`.
  const capacities = periodStart ? capacitiesFor(members, overrides, periodStart) : []

  // The organizer is a PERSON, not a session — an anonymous session expires
  // after 30 days idle and returns with a new auth id, so a device is the
  // organizer exactly while it is acting as the organizer's member row. The
  // server decides this independently in is_household_organizer(); this only
  // governs whether the control is offered.
  const isOrganizer = Boolean(me && household && me.id === household.organizer_member_id)

  return (
    <main className="shell">
      <h1 className="shell__title">Taskr</h1>
      <p className="shell__tagline">
        Chores are minutes of work. People are budgets of minutes. The split is
        proportional to what each person actually has.
      </p>

      {status === 'loading' ? (
        <p className="card__body" role="status">
          Loading your household&hellip;
        </p>
      ) : null}

      {status === 'unconfigured' ? (
        <section className="card" aria-labelledby="unconfigured-heading">
          <h2 id="unconfigured-heading" className="card__heading">
            No backend configured
          </h2>
          <p className="card__body">
            This build has no Supabase credentials, so there is nowhere to keep a
            household. Locally that means no <code>.env.local</code>; on a deployment it
            means the environment variables are not set. See{' '}
            <code>docs/deploy-runbook.md</code>.
          </p>
        </section>
      ) : null}

      {status === 'failed' ? (
        <section className="card" aria-labelledby="failed-heading">
          <h2 id="failed-heading" className="card__heading">
            Could not reach the household
          </h2>
          <p className="error" role="alert">
            {error}
          </p>
        </section>
      ) : null}

      {status === 'onboarding' ? (
        <Onboarding
          onCreate={handleCreate}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          // Non-null only when boot found a session, because the signed-out path
          // returns before refresh() runs. Signed in AND on this screen is
          // precisely the half-finished state described above.
          signedIn={Boolean(userId)}
          busy={busy}
        />
      ) : null}

      {status === 'joined' && household ? (
        <Roster
          household={household}
          members={members}
          me={me}
          isOrganizer={isOrganizer}
          busy={busy}
          error={error}
          onAdd={handleAdd}
          onSave={handleSave}
          onRemove={handleRemove}
          onRefresh={handleRefresh}
          onSignOut={handleSignOut}
          overrides={overrides}
          periodStart={periodStart}
          onSetCapacity={handleSetCapacity}
          onClearCapacity={handleClearCapacity}
        />
      ) : null}

      {status === 'joined' && household ? (
        <Chores
          chores={chores}
          members={members}
          capacities={capacities}
          busy={busy}
          error={error}
          onAdd={handleAddChore}
          onSave={handleSaveChore}
          onRemove={handleRemoveChore}
          onComplete={handleCompleteChore}
          onUncomplete={handleUncompleteChore}
          onAssign={handleAssignChore}
          onUnassign={handleUnassignChore}
        />
      ) : null}

      <footer className="shell__footer">
        <span>{buildInfo.name}</span>
        <span aria-hidden="true"> · </span>
        <span>{buildInfo.env}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="build-commit">build {buildInfo.commit}</span>
      </footer>
    </main>
  )
}
