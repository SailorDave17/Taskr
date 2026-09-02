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
  provisionMember,
  removeMember,
  resetMemberCredential,
  signIn,
  signOut,
  signUpOrganizer,
  updateMember,
} from './lib/household.js'
import {
  addChore,
  addChores,
  assignChore,
  catchUpRepeats,
  completeChore,
  formatSkippedNotice,
  listChores,
  listRepeatExceptions,
  localTodayIn,
  recordActualMinutes,
  removeChore,
  skipRepeatOccurrence,
  unassignChore,
  uncompleteChore,
  updateChore,
} from './lib/chores.js'
import {
  baselineMoved,
  capacitiesFor,
  clearCapacity,
  listCapacity,
  periodStartFor,
  setCapacity,
} from './lib/capacity.js'
import { allowMember, excludeMember, listExclusions } from './lib/exclusions.js'
import { reassignHousehold } from './lib/reassign.js'
import {
  announcementFrom,
  dismissFairnessNote,
  readSplitSeen,
  splitSnapshot,
  writeSplitSeen,
} from './lib/announce.js'
import {
  completeConnect,
  listCalendarConnections,
  readConsentReturn,
  startConnect,
} from './lib/calendar.js'
import Announcement from './components/Announcement.jsx'
import Chores from './components/Chores.jsx'
import Done from './components/Done.jsx'
import Onboarding from './components/Onboarding.jsx'
import Roster from './components/Roster.jsx'
import Split from './components/Split.jsx'

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

/**
 * The four surfaces, in the order they are offered — #47 criterion 11, plus
 * #302's Done.
 *
 * The split is FIRST and is the default view, per the charter's grooming
 * decision of 2026-08-06. `Who` rather than `Roster` because that is the
 * question a person is asking; the heading behind it still reads "Who is in the
 * household". `Done` is LAST: it is history, and the chore tab's own "N done
 * this week" line is the way most people will reach it.
 */
const SURFACES = [
  { key: 'split', label: 'Split' },
  { key: 'chores', label: 'Chores' },
  { key: 'who', label: 'Who' },
  { key: 'done', label: 'Done' },
]

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
  // #37 — who cannot do what. Server state like everything else here, and
  // deliberately NOT derived into a per-chore map in this file: the screen folds
  // over the rows where it needs them, so there is one representation and no
  // second copy to fall out of step with the first.
  const [exclusions, setExclusions] = useState([])
  // #105 — which dates the household's repeats will NOT generate. Server state
  // like the exclusions above, and the same one-representation rule: the chore
  // screen folds over the rows to decide what to offer and what to say.
  const [repeatExceptions, setRepeatExceptions] = useState([])
  // #95 — who in this household has connected a Google Calendar. Server state
  // like everything else here, read through the same refresh. The rows carry no
  // credential: the refresh token is in `calendar_tokens`, which this client is
  // granted nothing on, so there is no version of this read that could leak one.
  const [connections, setConnections] = useState([])
  const [userId, setUserId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // #53 AC 4 — the catch-up pass skipped occurrences older than the bound and
  // the household is told rather than left to wonder. Transient and on the
  // device whose open performed the skip (owner decision, 2026-08-24): the
  // other phones did not trigger it, and a persistent household-wide notice is
  // a notifications table this story deliberately does not build.
  const [notice, setNotice] = useState(null)
  // #50 — the re-balance this member has not yet been told about, or null. Set
  // by refresh() when the seen-marker says a re-balance landed since this
  // member last looked AND minutes actually moved against what they were
  // shown; cleared only by the dismiss button. refresh() never clears it — a
  // tab switch after the statement appears must not eat the event.
  const [announcement, setAnnouncement] = useState(null)
  // #59 — has THIS member dismissed the note saying what the fairness number
  // does not count? Server state, per member (owner decision at pickup), read
  // from the same seen-marker row the announcement uses. `false` until a read
  // says otherwise, which fails toward the note STANDING — the honest
  // direction: an acknowledgement shown twice costs a tap, one silently
  // hidden costs the charter's ambition 4.
  const [fairnessNoteDismissed, setFairnessNoteDismissed] = useState(false)
  // #47 criterion 11 — which surface is on screen. `useState`, not a router and
  // not a state library: this app has neither, adding one to move between three
  // views would be the largest dependency in the repo, and the URL is already
  // spoken for — Google returns a calendar consent to the app ROOT with a
  // `?code=`, and the PWA's scope is `/`.
  //
  // THE SPLIT OPENS BY DEFAULT. That is the charter's grooming decision of
  // 2026-08-06 ("the load surface opens by default, with the roster reachable
  // from it"), and it is the whole reason the tabs exist rather than a stack:
  // the thing judged at arm's length has to be the thing on screen.
  const [view, setView] = useState('split')

  /** Re-read everything this device is allowed to see. */
  const refresh = useCallback(async () => {
    const found = await currentHousehold()
    setHousehold(found)
    // #159 — every read below names the household it means. `found.id` is the
    // ONE place that id enters this function, so a switcher later changes which
    // household `currentHousehold()` returns and nothing here has to move.
    //
    // The roster is read FIRST and is not merely one read among several: the
    // three tables that withhold `household_id` (member_capacity,
    // chore_exclusions, calendar_connections) are scoped by the member set
    // rather than by a household id, so `roster` below is the scope for all
    // three. That ordering is load-bearing, not incidental.
    const roster = found ? await listMembers(found.id) : []
    setMembers(roster)
    const memberIds = roster.map((m) => m.id)
    // #34: chores re-read through the same path as members, so the
    // mutate-then-refresh guarantee covers them without a second mechanism.
    const choreRows = found ? await listChores(found.id) : []
    setChores(choreRows)
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
    const overrideRows = period ? await listCapacity(period, memberIds) : []
    setOverrides(overrideRows)
    // #37 AC 9 — read from the server on every refresh, through the same path as
    // everything else, so a device holds no exclusion state of its own. What
    // another phone recorded is on this screen after the next mutation for the
    // same reason the roster is: there is no cache to be stale.
    setExclusions(found ? await listExclusions(memberIds) : [])
    // #105 — the skipped dates, read on every refresh like the exclusions
    // above. Scoped by the ANCHOR ids out of the chores just read, because only
    // an anchor can carry an exception and `household_id` is deliberately not
    // in this table's select grant (0025's reasoning).
    const anchorIds = choreRows
      .filter((c) => c.repeat_kind && c.repeat_kind !== 'none')
      .map((c) => c.id)
    setRepeatExceptions(found && anchorIds.length ? await listRepeatExceptions(anchorIds) : [])
    // #95 AC 5 — "Calendar connected" is derived from a SERVER read on every
    // refresh, exactly like the roster. A locally remembered flag would show
    // connected on the phone that pressed the button and nothing on the phone
    // that reloads, which is the shape of "it worked for me" that this app's
    // whole read-through-the-server discipline exists to avoid.
    setConnections(found ? await listCalendarConnections(memberIds) : [])
    const uid = await currentUserId()
    setUserId(uid)

    // #50 — is this member owed a statement about a re-balance they have not
    // seen? Checked on EVERY refresh rather than only at boot, deliberately: a
    // re-balance another phone applies mid-session must arrive as an event on
    // this one too (AC 1 is the floor, not the ceiling), and — the sharper
    // direction — a refresh that silently recorded the new state as seen
    // without showing the statement would eat the event for good.
    //
    // The snapshot advances on every refresh, announcement or not, so "since
    // you last looked" means since this member's last look rather than since
    // some older anchor — which is what nets a two-step change to one move
    // (AC 5) and keeps a week of ordinary chore churn out of the statement.
    //
    // Its own try/catch, and the failure is REPORTED rather than swallowed or
    // rethrown: swallowed, a live project missing the 0020 paste would look
    // healthy while every announcement silently died (a red nobody can see is
    // how a paste stays forgotten — #53's reasoning); rethrown, it would fail
    // the mutation this refresh follows, which did succeed.
    if (found && period) {
      try {
        const me = findClaimedMember(roster, uid, found.id)
        if (me) {
          const current = splitSnapshot({
            capacities: capacitiesFor(roster, overrideRows, period),
            chores: choreRows,
          })
          const seen = await readSplitSeen(me.id)
          // #59 — one read serves both: the row that carries what this member
          // was last shown also carries whether they dismissed the fairness
          // note. No row yet means never dismissed, which is exactly what a
          // first look should see.
          setFairnessNoteDismissed(Boolean(seen?.fairness_note_dismissed))
          const news = announcementFrom({
            seen,
            current,
            lastRebalance: found.last_rebalance ?? null,
          })
          if (news) setAnnouncement(news)
          const marker = found.last_rebalance?.applied_at ?? null
          // Skip the write when nothing moved and nothing new was seen — a tab
          // switch is not a fact worth a round trip. String comparison is only
          // an optimisation: a false mismatch costs one harmless re-write.
          const unchanged =
            seen &&
            seen.seen_rebalance_at === marker &&
            JSON.stringify(seen.snapshot) === JSON.stringify(current)
          if (!unchanged) {
            await writeSplitSeen({ memberId: me.id, snapshot: current, seenRebalanceAt: marker })
          }
        }
      } catch (err) {
        setError(err.message)
      }
    }

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
        // come back empty, so that "signed out" is never indistinguishable from
        // "your household disappeared" — the more alarming of the two
        // readings and the wrong one.
        //
        // This paragraph used to add "they would succeed — every policy simply
        // returns nothing to an unauthenticated caller". That was true when it was
        // written and `0017` (#186) falsifies it: `anon` held SELECT on
        // `households` by inherited platform default and now holds nothing, so the
        // read would be REFUSED rather than empty. Nothing here changes — the
        // reads were already skipped — but that clause was a claim about the
        // grant layer, and the grant layer moved.
        const session = await currentSession()
        if (!session) {
          if (!cancelled) setStatus('onboarding')
          return
        }

        // #95 — Google sends the member back to the app ROOT with `?code=`, so
        // the return is an ordinary boot that happens to carry two query
        // parameters. There is no router here and the PWA scope is `/`; a
        // dedicated path would need a rewrite rule at Vercel and would behave
        // identically once it got here (owner decision at pickup).
        //
        // Handled BEFORE the read, and the ordering is the point: `refresh()`
        // is what puts "Calendar connected" on the screen, so completing the
        // exchange afterwards would leave the member looking at the state they
        // just changed. It is also why the URL is stripped here rather than in
        // a later effect — a reload holding a spent code would ask Google to
        // exchange it twice and be refused, which reads as the connection
        // having failed.
        const consent = readConsentReturn(globalThis.location?.search)
        let consentComplaint = null
        if (consent) {
          try {
            if (consent.error) {
              // Google's own word for it. `access_denied` is the member
              // pressing Cancel, which is not a fault and must not be reported
              // as one — but it does have to say SOMETHING, or a cancel looks
              // exactly like a button that does nothing.
              throw new Error(
                consent.error === 'access_denied'
                  ? 'That calendar was not connected — Google was told no.'
                  : `Google could not complete that connection: ${consent.error}`,
              )
            }
            await completeConnect(consent)
          } catch (err) {
            consentComplaint = err.message
          }
          // Whatever happened, the code is spent and must not survive a reload.
          const { pathname } = globalThis.location
          globalThis.history?.replaceState?.(null, '', pathname)
        }

        // #53 — create any missed occurrences of repeating chores BEFORE the
        // first read, so the list this person is about to see already carries
        // them: running it after refresh() would show a week with holes in it
        // for one load. "Opens the app" is this boot, and the server owns the
        // clock — the call sends nothing time-shaped.
        //
        // A failure here must not cost anyone their household: against a live
        // project that has not had 0012 pasted yet this call fails on every
        // open, and the right degradation is the ordinary error strip over a
        // working app, not the boot-failure card. It is reported rather than
        // swallowed — a red that nobody can see is how a paste stays forgotten.
        let catchUpComplaint = null
        let skippedNotice = null
        try {
          const caughtUp = await catchUpRepeats()
          skippedNotice = formatSkippedNotice(caughtUp.skipped)
        } catch (err) {
          catchUpComplaint = err.message
        }

        const found = await refresh()
        if (!cancelled) {
          setStatus(found ? 'joined' : 'onboarding')
          if (skippedNotice) setNotice(skippedNotice)
          // The consent complaint wins the strip: it answers the thing the
          // person just did, where the catch-up is housekeeping they did not.
          if (consentComplaint) setError(consentComplaint)
          else if (catchUpComplaint) setError(catchUpComplaint)
        }
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
  // #159 AC 4 — every write names the household THIS SCREEN IS SHOWING, taken
  // from the `household` state that `refresh()` set, rather than re-resolving it
  // inside the data layer. Re-resolving was the defect: it went through the same
  // unordered read, so with two households a person could be added to one while
  // the roster on screen showed the other, and no artefact would disagree.
  const handleAdd = useCallback(
    (person) => mutate(() => addMember({ ...person, householdId: household?.id })),
    [mutate, household],
  )
  // #49 — a baseline edit is a capacity change (owner decision at pickup,
  // extending the grooming decision's "on capacity change" to the roster's
  // weekly_minutes), so the re-assignment runs before the refresh the same way
  // it does for a weekly override. Gated on the value actually MOVING: the
  // roster's save always sends `weeklyMinutes`, and a name-only edit must not
  // overwrite `last_rebalance` with a run nothing prompted.
  const handleSave = useCallback(
    (id, patch) =>
      mutate(async () => {
        const moved = baselineMoved(
          members.find((m) => m.id === id),
          patch.weeklyMinutes,
        )
        const saved = await updateMember(id, patch)
        if (moved) await reassignHousehold({ householdId: household?.id })
        return saved
      }),
    [mutate, members, household],
  )
  // #247 — a removal can succeed while its auth half does not: the person is
  // gone and their sign-in survived, two separate facts. The warning is set
  // AFTER mutate() resolves, i.e. after the refresh, so the screen never shows
  // the person still listed under a message saying they were removed — and the
  // removal itself is never reported as a failure, which would invite a retry.
  const handleRemove = useCallback(
    (id) =>
      mutate(() => removeMember(id)).then((result) => {
        if (result?.warning) setError(result.warning)
        return result
      }),
    [mutate],
  )
  // #87 - give somebody a sign-in, or replace one they forgot. Routed through
  // mutate() like every other write, so the roster re-reads from the server and
  // the row's "Signed in" state comes from `claimed_by` rather than from an
  // optimistic local guess about whether the Edge Function succeeded.
  const handleProvision = useCallback(
    (memberId, password, isReset) =>
      mutate(() =>
        isReset
          ? resetMemberCredential({ memberId, password })
          : provisionMember({ memberId, password }),
      ),
    [mutate],
  )
  const handleRefresh = useCallback(() => mutate(async () => {}), [mutate])
  /**
   * Move to another surface — #47 criterion 11.
   *
   * The re-read is the criterion, not a nicety: "the household is re-read from
   * the server on arrival rather than passed as cached state". Arriving on the
   * roster from the split has to show what another phone did in between, and a
   * view swap over state this device already holds would show what it held when
   * it booted. It is the same `mutate` every write goes through, so arrival and
   * mutation cannot drift into two different ideas of what "current" means.
   *
   * The view changes FIRST and the read follows. A person who taps Who must not
   * wait on a round trip to see the tab respond, and if the read fails they get
   * the error strip over the surface they asked for rather than being held on
   * the one they were leaving. The rejection is swallowed here for that reason
   * alone: `mutate` has already put the message on screen.
   */
  const goTo = useCallback(
    (next) => {
      setView(next)
      handleRefresh().catch(() => {})
    },
    [handleRefresh],
  )
  // #95 — begin a calendar connection. Deliberately NOT routed through
  // `mutate()`, unlike every other action on this screen, and the difference is
  // real rather than an oversight: nothing is written here. The browser leaves
  // for Google, and the write happens in the Edge Function when it comes back —
  // so a `mutate()` would set `busy`, re-read the server and clear it, all
  // describing a change that has not happened yet.
  //
  // The failure it CAN have is a build with no `VITE_GOOGLE_CLIENT_ID`, and that
  // is why the action is offered rather than hidden: a member who is shown
  // nothing has no way to discover that the household's app is missing a
  // setting, whereas one who presses it reads the sentence that names the
  // variable. #95 AC 1 requires the action to be shown to a real-email member,
  // and says nothing about the app being configured.
  const handleConnectCalendar = useCallback(() => {
    setError(null)
    try {
      // #161 — the household THIS SCREEN IS SHOWING travels with the consent
      // state, so the connection lands where the member was standing when they
      // pressed it. Same `household` state every other write on this screen
      // takes its id from (#159 AC 4), and the same one a switcher will change.
      globalThis.location.assign(startConnect({ householdId: household?.id }))
    } catch (err) {
      setError(err.message)
    }
  }, [household])
  // #34 — chores. Each goes through mutate(), which re-reads from the server
  // rather than patching local state from the response: what the next device to
  // load will see is exactly what this device now shows.
  const handleAddChore = useCallback(
    (chore) => mutate(() => addChore({ ...chore, householdId: household?.id })),
    [mutate, household],
  )
  // #220 — the batch confirm. One mutate() around the whole pass, so the
  // refresh runs once after every row has been attempted and shows exactly the
  // rows that landed. addChores reports per-row outcomes instead of throwing,
  // so a refused row does not stop mutate() from refreshing — the screen shows
  // the saved chores while the panel keeps the rest.
  const handleAddChores = useCallback(
    (rows) => mutate(() => addChores(rows, { householdId: household?.id })),
    [mutate, household],
  )
  const handleSaveChore = useCallback((id, patch) => mutate(() => updateChore(id, patch)), [mutate])
  const handleRemoveChore = useCallback((id) => mutate(() => removeChore(id)), [mutate])
  // #35 — completion goes through an RPC because the SERVER sets the clock, not
  // because of access control. A phone with the wrong date would otherwise move
  // work between weeks.
  const handleCompleteChore = useCallback((id) => mutate(() => completeChore(id)), [mutate])
  const handleUncompleteChore = useCallback((id) => mutate(() => uncompleteChore(id)), [mutate])
  // #12 — adjusting an actual is a plain column-granted update, unlike the two
  // above; completion already seeded the honest default, this says otherwise.
  const handleRecordActual = useCallback(
    (id, minutes) => mutate(() => recordActualMinutes(id, minutes)),
    [mutate],
  )
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
  // #37 — the two exclusion writes, and they are handed to the chore screen and
  // to nothing else. That is AC 3 as a wiring decision rather than a promise: a
  // household reaches this from a chore already on the list and from nowhere
  // else, so there is no route to hand to onboarding or to the roster in the
  // first place. gate.test.js checks it rather than trusting this paragraph.
  //
  // The chore element is named here in words only, with no angle brackets and
  // no quoted pattern. gate.test.js finds that element by matching its opening
  // tag through to the first self-closing tag after it, over the RAW SOURCE with
  // comments left in — so any comment that spells the tag hijacks the match and
  // the guard then inspects whatever element comes next.
  //
  // Measured twice while writing this story: first by a comment naming the tag,
  // then by the comment written to warn about it, which quoted the pattern and
  // so contained the tag again. That is cairn's
  // `a-guard-that-reads-source-must-survive-its-own-docs`, arriving from a note
  // about the hazard rather than from the hazard — and the second time is the
  // one worth recording, because knowing the rule is what produced the breach.
  const handleExcludeMember = useCallback(
    (choreId, memberId) => mutate(() => excludeMember(choreId, memberId, household?.id)),
    [mutate, household],
  )
  const handleAllowMember = useCallback(
    (choreId, memberId) => mutate(() => allowMember(choreId, memberId)),
    [mutate],
  )
  // #105 — skip one occurrence of a repeat. An RPC for access rather than the
  // clock: the exception table has no client write privilege at all, and the
  // ratified retroactivity rule (uncompleted instance goes, completed stays)
  // is applied inside the function where no caller can take half of it.
  const handleSkipOccurrence = useCallback(
    (choreId, date) => mutate(() => skipRepeatOccurrence(choreId, date)),
    [mutate],
  )
  // #46 — set or clear THIS period's capacity. Both take the period from state
  // rather than recomputing it, so the write lands in the same week the screen
  // is showing even if midnight passes mid-session.
  //
  // Nothing here touches a model, a network service or a credential beyond the
  // database (AC 6): the manual road in is the floor the charter requires on day
  // one, and the extraction bet (#57) is an accelerator on top of it, never the
  // only way in. A test asserts that this path imports nothing else.
  // #49 — the capacity write is what the grooming decision named as the
  // trigger: the household's assignments follow it with nobody pressing an
  // assign button and nobody asked to approve. `reassignHousehold` re-reads
  // everything fresh, computes with the real allocator and applies through the
  // one transactional RPC; `mutate()`'s refresh then shows the stored result,
  // so what this device shows is what the next device to load will see.
  const handleSetCapacity = useCallback(
    (memberId, minutes) => {
      if (!periodStart) return Promise.reject(new Error('No week to set capacity for yet.'))
      return mutate(async () => {
        const saved = await setCapacity({ memberId, periodStart, minutes, householdId: household?.id })
        await reassignHousehold({ householdId: household?.id })
        return saved
      })
    },
    [mutate, periodStart, household],
  )
  const handleClearCapacity = useCallback(
    (memberId) => {
      if (!periodStart) return Promise.reject(new Error('No week to clear capacity for yet.'))
      return mutate(async () => {
        await clearCapacity(memberId, periodStart)
        await reassignHousehold({ householdId: household?.id })
      })
    },
    [mutate, periodStart, household],
  )

  // #160 — resolved WITHIN the household on screen. `household?.id` is the
  // same state object `isOrganizer` compares against below, so who-you-are and
  // what-you-organise cannot be answered about two different households. The
  // roster is already scoped (#159), but the identity layer must not lean on
  // that: with a claimed row in two households, an unscoped match returns
  // whichever row the list happens to put first.
  const me = findClaimedMember(members, userId, household?.id)

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
  //
  // #160 — `me` above is resolved within THIS household, so this comparison
  // can no longer pair one household's member row with another household's
  // organizer id. Both sides come from the same `household` state, set by the
  // single currentHousehold() read in refresh().
  const isOrganizer = Boolean(me && household && me.id === household.organizer_member_id)

  // #59 — record the dismissal against THIS member, then re-read like every
  // other write, so what this phone shows is what the seen-marker row now
  // says rather than an optimistic local flip. `me` is resolved within the
  // household on screen (#160), so the dismissal cannot land on another
  // household's row; with no claimed row the write refuses with a sentence
  // rather than guessing whose dismissal it was.
  const myMemberId = me?.id
  const handleDismissFairnessNote = useCallback(
    () => mutate(() => dismissFairnessNote(myMemberId)),
    [mutate, myMemberId],
  )

  return (
    <main className="shell">
      <h1 className="shell__title">Taskr</h1>
      <p className="shell__tagline">
        Chores are minutes of work. People are budgets of minutes. The split is
        proportional to what each person actually has.
      </p>

      {/* #53 AC 4 — what the catch-up pass declined to pile onto the week.
          role="status", never role="alert": nothing is wrong, and the .error
          palette stays reserved for faults. */}
      {status === 'joined' && notice ? (
        <p className="shell__notice" role="status">
          {notice}
        </p>
      ) : null}

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

      {/* #50 — the re-balance, announced. ABOVE the tabs and outside every
          surface, because it is an event about the household rather than a
          feature of any one view: whichever tab the member is on when it
          lands, the statement is in front of them. It stays until dismissed
          (refresh never clears it) and is not shown again after that — the
          seen-marker advanced when it was shown. */}
      {status === 'joined' && household && announcement ? (
        <Announcement
          announcement={announcement}
          members={members}
          onDismiss={() => setAnnouncement(null)}
        />
      ) : null}

      {/* #47 criterion 11 — the surfaces, and the only way between them (four
          since #302; the chore tab's done line is a second way to one of them).
          A `nav` with buttons rather than links, because there is nothing to
          link TO: one document, no router, and an anchor with no href is worse
          for assistive tech than a button that says what it does.

          The current tab is marked with `aria-current` and styled off that
          attribute rather than off a second class name. One state, in the place
          a screen reader already reads it — and gate.test.js's stylesheet check
          only sees static `className` strings, so a conditional class here
          would be a class nothing checks. */}
      {status === 'joined' && household ? (
        <nav className="tabs" aria-label="Household surfaces">
          {SURFACES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className="tab"
              aria-current={view === key ? 'page' : undefined}
              onClick={() => goTo(key)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {status === 'joined' && household && view === 'split' ? (
        <Split
          members={members}
          chores={chores}
          capacities={capacities}
          exclusions={exclusions}
          lastRebalance={household?.last_rebalance ?? null}
          error={error}
          fairnessNoteDismissed={fairnessNoteDismissed}
          onDismissFairnessNote={handleDismissFairnessNote}
        />
      ) : null}

      {status === 'joined' && household && view === 'who' ? (
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
          onProvision={handleProvision}
          onRefresh={handleRefresh}
          onSignOut={handleSignOut}
          overrides={overrides}
          periodStart={periodStart}
          onSetCapacity={handleSetCapacity}
          onClearCapacity={handleClearCapacity}
          connections={connections}
          onConnectCalendar={handleConnectCalendar}
        />
      ) : null}

      {status === 'joined' && household && view === 'chores' ? (
        <Chores
          chores={chores}
          members={members}
          exclusions={exclusions}
          repeatExceptions={repeatExceptions}
          todayIso={household ? localTodayIn(household.timezone) : null}
          timezone={household.timezone}
          periodStart={periodStart}
          busy={busy}
          error={error}
          onAdd={handleAddChore}
          onAddMany={handleAddChores}
          onSave={handleSaveChore}
          onRemove={handleRemoveChore}
          onComplete={handleCompleteChore}
          onUncomplete={handleUncompleteChore}
          onAssign={handleAssignChore}
          onUnassign={handleUnassignChore}
          onExclude={handleExcludeMember}
          onAllow={handleAllowMember}
          onSkip={handleSkipOccurrence}
          onRecordActual={handleRecordActual}
          // #302 AC 1 — the "N done this week" line is a second way onto the
          // Done tab, and it arrives the same way the tab does: through goTo,
          // so the re-read criterion 11 requires of every arrival holds here.
          onShowDone={() => goTo('done')}
        />
      ) : null}

      {/* #302 — completed work, by capacity week. Same rows, same handlers as
          the chore list (a done row still offers "Not done after all" and
          "Took"); it needs no add form and no complete handler of its own, but
          ChoreRow takes the full set, so the full set is passed. */}
      {status === 'joined' && household && view === 'done' ? (
        <Done
          chores={chores}
          members={members}
          exclusions={exclusions}
          repeatExceptions={repeatExceptions}
          todayIso={household ? localTodayIn(household.timezone) : null}
          timezone={household.timezone}
          busy={busy}
          error={error}
          onSave={handleSaveChore}
          onRemove={handleRemoveChore}
          onComplete={handleCompleteChore}
          onUncomplete={handleUncompleteChore}
          onAssign={handleAssignChore}
          onUnassign={handleUnassignChore}
          onExclude={handleExcludeMember}
          onAllow={handleAllowMember}
          onSkip={handleSkipOccurrence}
          onRecordActual={handleRecordActual}
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
