import { useCallback, useEffect, useState } from 'react'
import { buildInfo } from './buildInfo.js'
import { hasSupabaseConfig } from './lib/supabase.js'
import {
  addMember,
  claimMember,
  claimMemberWithPin,
  createHousehold,
  currentDeviceId,
  currentHousehold,
  ensureSession,
  findClaimedMember,
  joinHousehold,
  listMembers,
  removeMember,
  setMemberPin,
  updateMember,
} from './lib/household.js'
import {
  addChore,
  completeChore,
  listChores,
  removeChore,
  uncompleteChore,
  updateChore,
} from './lib/chores.js'
import Chores from './components/Chores.jsx'
import Onboarding from './components/Onboarding.jsx'
import Roster from './components/Roster.jsx'

// Story #5: the household roster, joinable from family phones.
//
// The screen is a function of one question — has this device joined a household?
// — and that question is answered by the SERVER on every load, never by
// localStorage. AC 3 asks that the roster survive a force-close, a reinstall and
// a backend restart, and a locally cached roster would make a passing check
// indistinguishable from a device that merely remembered. What IS held locally
// is the Supabase auth session, which is the credential, not the data; that is
// what makes AC 5's "stays joined days later" true without re-entering the code.

export default function App() {
  const [status, setStatus] = useState('loading')
  const [household, setHousehold] = useState(null)
  const [members, setMembers] = useState([])
  const [chores, setChores] = useState([])
  const [deviceId, setDeviceId] = useState(null)
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
    setDeviceId(await currentDeviceId())
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
        await ensureSession()
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

  const handleCreate = useCallback(
    (name, organizer) => mutate(() => createHousehold(name, organizer)),
    [mutate],
  )
  const handleJoin = useCallback((code) => mutate(() => joinHousehold(code)), [mutate])
  const handleAdd = useCallback((person) => mutate(() => addMember(person)), [mutate])
  const handleSave = useCallback((id, patch) => mutate(() => updateMember(id, patch)), [mutate])
  const handleRemove = useCallback((id) => mutate(() => removeMember(id)), [mutate])
  const handleClaim = useCallback((id) => mutate(() => claimMember(id)), [mutate])
  const handleRefresh = useCallback(() => mutate(async () => {}), [mutate])
  const handleSetPin = useCallback((id, pin) => mutate(() => setMemberPin(id, pin)), [mutate])
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
  // The other half of the credential (#63). `claimMember` refuses anyone holding
  // a PIN outright, so without this a member the organizer had given a PIN to
  // could not get onto their own phone at all — and `set_member_pin` releases
  // whatever phone they were on, so setting one locked them out.
  const handleSignIn = useCallback(
    (id, pin) => mutate(() => claimMemberWithPin(id, pin)),
    [mutate],
  )

  const me = findClaimedMember(members, deviceId)

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
        <Onboarding onCreate={handleCreate} onJoin={handleJoin} busy={busy} />
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
          onClaim={handleClaim}
          onSetPin={handleSetPin}
          onSignIn={handleSignIn}
          onRefresh={handleRefresh}
        />
      ) : null}

      {status === 'joined' && household ? (
        <Chores
          chores={chores}
          busy={busy}
          error={error}
          onAdd={handleAddChore}
          onSave={handleSaveChore}
          onRemove={handleRemoveChore}
          onComplete={handleCompleteChore}
          onUncomplete={handleUncompleteChore}
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
