import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildInfo } from './buildInfo.js'
import { reportHref, reportScreen } from './lib/reportProblem.js'
import { hasSupabaseConfig } from './lib/supabase.js'
import { attachVisibilityRefresh, createReadQueue, subscribeToHousehold } from './lib/realtime.js'
import {
  addMember,
  createHousehold,
  currentSession,
  currentUserId,
  describeSignInReturn,
  findClaimedMember,
  listHouseholds,
  inviteMember,
  listMembers,
  provisionMember,
  readAuthCallback,
  readSignInReturn,
  removeMember,
  resetMemberCredential,
  resolveActiveHousehold,
  sendPasswordReset,
  setOwnPassword,
  signIn,
  signInWithGoogle,
  signOut,
  signUpOrganizer,
  updateMember,
  // #430 — deleting and restoring a household.
  GRACE_PERIOD_DAYS,
  householdDeletionStatus,
  requestHouseholdDeletion,
  restoreHousehold,
} from './lib/household.js'
import {
  clearActiveHouseholdChoice,
  readActiveHouseholdChoice,
  writeActiveHouseholdChoice,
} from './lib/activeHousehold.js'
import {
  addChore,
  addChores,
  assignChore,
  catchUpRepeats,
  completeChore,
  formatSkippedNotice,
  listChores,
  missChore,
  listRepeatExceptions,
  localTodayIn,
  recordActualMinutes,
  removeChore,
  skipRepeatOccurrence,
  unassignChore,
  uncompleteChore,
  unmissChore,
  updateChore,
} from './lib/chores.js'
import {
  AUTO_APPLY_REFUSED_CODE,
  autoApplyDecision,
  baselineMoved,
  calendarSuggestion,
  capacitiesFor,
  clearCapacity,
  listCapacity,
  periodStartFor,
  setCapacity,
} from './lib/capacity.js'
import { allowMember, excludeMember, listExclusions } from './lib/exclusions.js'
import { extractCapacity, extractChores } from './lib/capture.js'
import { reassignHousehold } from './lib/reassign.js'
import {
  announcementFrom,
  automaticCauseSources,
  dismissFairnessNote,
  readSplitSeen,
  splitSnapshot,
  writeSplitSeen,
} from './lib/announce.js'
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  busyWeekFor,
  completeConnect,
  connectionFor,
  disconnectCalendar,
  fetchBusyWeek,
  fetchCalendarEvents,
  isBusyWeekStale,
  isRealEmailMember,
  listBusyWeeks,
  listCalendarConnections,
  listCalendarImports,
  readConsentReturn,
  recordCalendarImport,
  revokeNoteFor,
  startConnect,
} from './lib/calendar.js'
import {
  addItem,
  archiveList,
  createList,
  finishRun,
  orderShoppingLists,
  partitionShoppingLists,
  purchaseItem,
  readClosedRuns,
  readShopping,
  removeItem,
  renameList,
  replaceShoppingItem,
  resolveSelectedListId,
  shoppingClient,
  unarchiveList,
  unpurchaseItem,
} from './lib/shopping.js'
import {
  INVITATIONS_REDEEMABLE,
  listInvitations,
  mintInvitation,
  outstandingInvitations,
  redeemInvitation,
  withdrawInvitation,
} from './lib/invitations.js'
import {
  clearPendingInvitation,
  readPendingInvitation,
  writePendingInvitation,
} from './lib/pendingInvitation.js'
import Announcement from './components/Announcement.jsx'
import Chores from './components/Chores.jsx'
import Done from './components/Done.jsx'
import HouseholdSwitcher from './components/HouseholdSwitcher.jsx'
import ChoosePassword from './components/ChoosePassword.jsx'
import Onboarding, { ENTRY, entryStateFor } from './components/Onboarding.jsx'
import PendingDeletion from './components/PendingDeletion.jsx'
import Roster from './components/Roster.jsx'
import Shopping from './components/Shopping.jsx'
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
// #165 AC 6 — A SECOND THING IS HELD LOCALLY NOW, and this paragraph is where a
// reader will come looking to decide whether that is a violation. It is not,
// and the owner's reasoning of 2026-08-26 is why: what
// `src/lib/activeHousehold.js` stores is the ID of the household this device
// last had CHOSEN — a pointer at a row, never the row. Every name, every member
// and every chore still arrives from the server on every load, so the paragraph
// above is untouched in substance; a stale pointer costs one tap rather than a
// wrong screen, and `resolveActiveHousehold` discards one that no longer names
// a household the caller belongs to. The line this sits on is the CREDENTIAL
// side of the discipline, not the data side: the auth session is already held
// here and correctly, and a UI preference about which of your own households is
// showing belongs beside it. The alternative on the table was a deterministic
// default with no memory at all, rejected for what it costs the person the
// feature exists for — somebody who mostly uses their second household would
// re-pick it every morning, forever. The module's own docblock carries the
// rest; this is the pointer from the discipline to its one exception.
//
// #62 changed what that session IS. It used to be an anonymous DEVICE identity,
// minted on boot so the app always had one, with a separate step to say which
// person the device was acting as. Now it is the person: one identity, acquired
// deliberately, and no state in which somebody is signed in as nobody.

/**
 * The five surfaces, in the order they are offered — #47 criterion 11, plus
 * #302's Done and #353's Shop.
 *
 * The split is FIRST and is the default view, per the charter's grooming
 * decision of 2026-08-06. `Who` rather than `Roster` because that is the
 * question a person is asking; the heading behind it still reads "Who is in the
 * household". `Done` comes after the working tabs: it is history, and the chore
 * tab's own "N done this week" line is the way most people will reach it.
 * `Shop` is LAST because it is the one surface with no fairness arithmetic
 * behind it (charter, 2026-09-05) — the four before it are one argument about
 * minutes, and this one is a list. Five one-word labels fit a 360px row only
 * at the tighter `.tab` padding #350 measured; index.css carries the numbers.
 */
const SURFACES = [
  { key: 'split', label: 'Split' },
  { key: 'chores', label: 'Chores' },
  { key: 'who', label: 'Who' },
  { key: 'done', label: 'Done' },
  { key: 'shop', label: 'Shop' },
]

/** No lists, no runs, no items — what a household reads before its first list. */
const EMPTY_SHOPPING = { lists: [], runs: [], items: [] }

/**
 * #359 — nobody has asked for the history yet, which is where every arrival on
 * the Shop tab starts.
 *
 * `loaded` is not `runs.length === 0`, and that is the whole reason this is an
 * object rather than an array: *nothing asked for*, *reading it now* and *this
 * list has never been finished* are three different sentences on a screen and
 * one empty array underneath.
 */
const NO_PAST_RUNS = { loading: false, loaded: false, runs: [], items: [] }

export default function App() {
  const [status, setStatus] = useState('loading')
  const [household, setHousehold] = useState(null)
  // #164 — EVERY household this person belongs to, in `listHouseholds()`'s
  // order, held beside the active one because the shell needs the count to
  // decide whether a switcher exists at all (AC 3) and the list to populate it.
  // Server state like everything else on this screen: it is re-read on every
  // refresh, so a household somebody was added to on another phone appears in
  // the switcher after the next read rather than after a reload.
  const [households, setHouseholds] = useState([])
  // #164/#165 — which household this person has CHOSEN, as distinct from which
  // one is showing. A ref rather than state, and the distinction is the point:
  // nothing renders from this. What renders is `household`, resolved from it by
  // `refresh()` and set as ordinary state, so the screen always draws the
  // household the last read actually resolved rather than the one this device
  // asked for. The two differ exactly when a stored choice is no longer in the
  // membership set, and the screen must show the second.
  //
  // It is a ref because `refresh` is memoised on `[]` — see the comment at its
  // head — and because every write here is followed by a read that must SEE it,
  // in the same turn, before React has re-rendered.
  //
  // Seeded from this device's remembered choice (#165 AC 1). `readActive…`
  // returns null when there is nothing stored, when storage is unavailable, and
  // when the stored value is not a uuid — all three meaning "no choice", which
  // is what `resolveActiveHousehold` turns into the deterministic default.
  const activeIdRef = useRef(readActiveHouseholdChoice())
  // #164/#166 — how many times a household has been CHOSEN in this session.
  //
  // Bumped by every deliberate act that sets `activeIdRef`, and read by
  // `refresh()` before its first await. It exists so a read can tell whether
  // its own snapshot is older than the choice it is about to judge: without it,
  // a read already in flight when a household is created wipes the choice that
  // creation just made, because a brand-new id and a revoked membership look
  // identical to `resolveActiveHousehold`. A counter, not a timestamp — two
  // choices inside one clock tick must be two epochs.
  const choiceEpochRef = useRef(0)
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
  // #353 — the household's shopping lists, the open run of each, and the items
  // on those runs. Server state read through the same refresh as everything
  // else, held in the read's own shape rather than folded into a per-list tree
  // here: the Shop tab does the folding where it draws, so there is one
  // representation and no second copy to fall out of step with the first.
  const [shopping, setShopping] = useState(EMPTY_SHOPPING)
  // #359 — the FINISHED runs of the list whose Past runs disclosure was last
  // opened, and nothing before that. Deliberately not part of `shopping` above
  // and deliberately not filled by `refresh()`: history is unbounded, so it is
  // read when somebody opens the disclosure and never on a tab arrival. See
  // `readClosedRuns`'s docblock for what that costs.
  const [pastRuns, setPastRuns] = useState(NO_PAST_RUNS)
  // #95 — who in this household has connected a Google Calendar. Server state
  // like everything else here, read through the same refresh. The rows carry no
  // credential: the refresh token is in `calendar_tokens`, which this client is
  // granted nothing on, so there is no version of this read that could leak one.
  const [connections, setConnections] = useState([])
  // #172 — the organizer's outstanding invitations, read on every refresh like
  // every other row here, and EMPTY for anybody who does not organise the
  // household on screen (the read is not even made for them — see refresh()).
  const [invitations, setInvitations] = useState([])
  // #172 AC 2 — the one copy of a freshly minted code that exists anywhere.
  // `0040` stores a digest, so this is not a cache of something the server
  // could re-send: lose it and the code is gone. Held WITH the invitation's id,
  // so withdrawing that same invitation takes a dead code off the screen rather
  // than leaving it standing beside the list that no longer carries it.
  // Cleared on a household switch and on sign-out, and never written anywhere
  // that outlives this render tree.
  const [minted, setMinted] = useState(null)
  // #101 — which calendar events this household has already imported, as the
  // ledger rows `0038` keeps: an event id and the chore it became, per row, and
  // nothing out of anybody's calendar. Server state through the same refresh,
  // read by household, so a second phone's import shows as "already imported"
  // on this one at the next read.
  const [calendarImports, setCalendarImports] = useState([])
  // #99 AC 4 — the one thing a disconnect can leave unsaid: Taskr let go and
  // could not tell whether Google did. Held here rather than in the roster row
  // because the row it belongs to has just changed shape — the connection is
  // gone by the time this is drawn, so state inside `CalendarControl` would
  // have to survive the very re-render the disconnect causes. Null on every
  // other outcome; `revokeNoteFor` in calendar.js owns which outcome that is.
  const [calendarRevokeNote, setCalendarRevokeNote] = useState(null)
  // #96 — this week's calendar-derived busy minutes, one row per member who has
  // one. Server state read through the same refresh as everything else, and the
  // rows carry nothing out of anybody's calendar: `0030`'s column list is the
  // whole minimization decision, so the most this state could ever hold is an
  // integer, a count and a timestamp.
  const [busyWeeks, setBusyWeeks] = useState([])
  // #96 AC 5 — why the figure on screen is the one it is. Separate from `error`
  // because a calendar Google would not answer must not read as the app being
  // broken: the manual capacity path is untouched, the last derived figure is
  // still shown, and this is the sentence that says so beside it.
  //
  // TWO of them, because two different things can fail and one state cannot
  // hold both honestly. The first version had one, and its two writers fought:
  // `refresh()` clearing it on a successful READ of the table wiped the sentence
  // the Edge Function's FAILURE had just put there, since a table that reads
  // fine says nothing about whether Google answered. Each writer now owns its
  // own, and the roster is handed whichever is standing — the fetch's first,
  // because it is the one about this member's own calendar.
  const [busyReadComplaint, setBusyReadComplaint] = useState(null)
  const [busyFetchComplaint, setBusyFetchComplaint] = useState(null)
  // #96 AC 1 — which (member, week) pairs this session has already asked about.
  // A ref rather than state, and set BEFORE the call rather than after: the
  // criterion is "once for that week", and a guard written after the await
  // would let a re-render during the round trip start a second one. It also
  // makes a failure quiet rather than a loop — a week that could not be read
  // is not asked again until the app is reloaded, which is the one moment a
  // person has done something that might have fixed it.
  const askedForBusy = useRef(new Set())
  // #98 AC 1 — which (member, week) pairs this session has already REFRESHED.
  // A second set rather than a second use of the first, because the two
  // triggers are disjoint by rule (no row → #96, a stale row → #98) and a
  // shared key would let one story's guard silence the other's: a week #96
  // fetched at boot and #98 found stale after twelve hours open is two
  // legitimate calls, not one. Same discipline as `askedForBusy` otherwise —
  // set before the call, kept for the session whatever the answer.
  const refreshedBusy = useRef(new Set())
  const [userId, setUserId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // #304 — the reason a sign-in did not complete, read off the URL at boot and
  // shown on the sign-in screen. Separate from `error` because that strip is not
  // rendered while a person is signed out, and this is a sentence for exactly
  // that person.
  const [signInNotice, setSignInNotice] = useState(null)
  // #341 — the kind of auth link this boot arrived on (`invite` or `recovery`),
  // or null. Held in state rather than re-read at render time BECAUSE IT CANNOT
  // BE RE-READ: the fragment it comes from is consumed by the Supabase client at
  // construction and by the URL strip below, so the boot's reading is the only
  // one there will ever be. A render that went back to `location.hash` would
  // find nothing and drop the person straight into the app with no password.
  const [authCallback, setAuthCallback] = useState(null)
  // #173 — is this device holding an invitation code for somebody not yet
  // signed in? A BOOLEAN, never the code: the code lives in storage
  // (`pendingInvitation.js`) until the boot that applies it, and the screen
  // only needs to know whether to say so. Read once, lazily, so a person who
  // came back from their inbox to the sign-in screen is told the code is
  // still here before they type anything.
  const [heldInvitation, setHeldInvitation] = useState(() =>
    Boolean(readPendingInvitation()),
  )
  // #173 — the held invitation this signed-in boot found, waiting for ONE tap.
  // `{ code, name }` or null. Owner decision at the review round's escalation
  // (2026-09-11): a code held while signed OUT was applied to whichever account
  // signed in next on the device — on a shared tablet, somebody else's — so the
  // boot asks "Join as <name>?" and redeems only on the tap. "Not me" forgets
  // the code. AC 4's "without being re-typed" holds: nothing is typed again.
  const [pendingJoin, setPendingJoin] = useState(null)
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
  // not a state library: this app has neither, adding one to move between the
  // views would be the largest dependency in the repo, and the URL is already
  // spoken for — Google returns a calendar consent to the app ROOT with a
  // `?code=`, and the PWA's scope is `/`.
  //
  // THE SPLIT OPENS BY DEFAULT. That is the charter's grooming decision of
  // 2026-08-06 ("the load surface opens by default, with the roster reachable
  // from it"), and it is the whole reason the tabs exist rather than a stack:
  // the thing judged at arm's length has to be the thing on screen.
  const [view, setView] = useState('split')
  // #430 — households this person organizes that are pending deletion: what
  // the restore banner shows. Read once at boot and after each delete or
  // restore, not on every refresh (#351 priced a round trip at 562 ms).
  const [pendingDeletions, setPendingDeletions] = useState([])
  // #358 — which shopping list the Shop tab is showing, held HERE and beside
  // `view` for the reason the tab strip is here: `Shopping` unmounts the moment
  // another tab is chosen, so a choice held inside it would last exactly as
  // long as the person stayed on the screen. It is a preference and not a fact
  // about the household — nothing is written to the server and nothing to
  // browser storage — and it is deliberately not reconciled by an effect: the
  // resolution below runs at render, so no frame is ever drawn against a list
  // id the current read does not hold.
  const [shoppingListId, setShoppingListId] = useState(null)
  // #360 — whether the Shop tab is also drawing the lists that were put away.
  // Held here for exactly `shoppingListId`'s reason and with exactly its
  // consequences: it is a preference about what this phone is looking at, not a
  // fact about the household, and it has to outlive `Shopping` unmounting on a
  // tab switch — otherwise a person who went to look at an archived list and
  // glanced at Chores would come back to the picker having forgotten. It is
  // also what decides which lists `resolveSelectedListId` may choose from, so
  // it belongs beside that resolution rather than inside the component that
  // reads its answer.
  const [showArchivedLists, setShowArchivedLists] = useState(false)

  /** Re-read everything this device is allowed to see. */
  const refresh = useCallback(async () => {
    // #164 — ONE read, then a pure resolution. `listHouseholds()` is the round
    // trip `currentHousehold()` used to make internally, so this costs the same
    // eleven round trips #351 priced; what changed is that the array is kept
    // rather than discarded after taking `[0]`, because the shell needs it to
    // offer the switcher at all.
    //
    // THE CHOICE COMES FROM A REF, not from state, and that is load-bearing.
    // `refresh` is memoised on `[]` so that `reads`, `requestRefresh` and the
    // boot effect below are stable for the life of the component; putting the
    // active id in the dependency array would rebuild that chain on every
    // switch and re-run boot. The ref is written before every call that must
    // see the new value, so a switch's own re-read resolves against the
    // household the person just picked rather than the one they left.
    // Named `all`, not `households`: the state above is also called
    // `households`, and a local shadowing it here would make the two impossible
    // to tell apart in a function whose whole subject is which of them is
    // current. This one is the FRESH read; the state is what the last read set.
    // THE EPOCH IS READ BEFORE THE AWAIT, and it is what makes the discard
    // below safe. Found by review-fanout, and it defeated #166's own AC 1 and
    // AC 5: a background read (a focus event, a Realtime echo) suspended HERE
    // when somebody creates a household comes back holding a list from before
    // it existed. `resolveActiveHousehold` then cannot find the brand-new id,
    // which is indistinguishable from "you were removed from that household" —
    // so the discard fired, cleared the ref and wiped the stored choice, and
    // the person who had just created a household was returned to their first
    // one with nothing remembered. The read is not wrong; it is just OLDER than
    // the choice, and only a counter can tell those apart.
    const epoch = choiceEpochRef.current
    const all = await listHouseholds()
    const found = resolveActiveHousehold(all, activeIdRef.current)
    // #165 AC 2 — a stored choice that is no longer in the membership set is
    // DISCARDED here, not merely ignored. `resolveActiveHousehold` has already
    // fallen back to the default, so nothing on screen depends on this; what it
    // prevents is a dead id sitting in storage being re-rejected on every load
    // for the rest of the device's life. Silent, per the criterion: a removed
    // membership is not this person's error to be told about.
    //
    // Guarded on the epoch: if anybody chose a household while this read was in
    // flight, this read's list predates that choice and has no standing to
    // judge it. The queue runs a fresh read for the chooser regardless
    // (`createReadQueue` resolves a queued request from a read that STARTED
    // after it asked), so skipping here costs nothing and the correct
    // resolution arrives a moment later.
    if (
      choiceEpochRef.current === epoch &&
      activeIdRef.current &&
      found?.id !== activeIdRef.current
    ) {
      activeIdRef.current = found?.id ?? null
      clearActiveHouseholdChoice()
    }
    // #159 — every read below names the household it means. `found.id` is the
    // ONE place that id enters this function, so the switcher above changes
    // which household is resolved and nothing here has to move.
    //
    // The roster is read FIRST and is not merely one read among several: the
    // three tables that withhold `household_id` (member_capacity,
    // chore_exclusions, calendar_connections) are scoped by the member set
    // rather than by a household id, so `roster` below is the scope for all
    // three. That ordering is load-bearing, not incidental.
    const roster = found ? await listMembers(found.id) : []
    // THE NAME AND THE ROSTER LAND TOGETHER, and the pairing is the fix rather
    // than the tidiness. `setHousehold` used to sit above this read, so a
    // switch put household B's NAME on the shell while B's roster was still a
    // round trip away — and `findClaimedMember(members, userId, household.id)`
    // pairs B's id against A's rows, which resolves `me` to null and takes
    // #152's organizer controls off the screen until the read settles. The
    // docblock on `chooseHousehold` says `me` is right "by construction"; that
    // was true only after settle until these three setters were paired.
    // Also found by review-fanout. The remaining reads below still land one at
    // a time — that is `refresh()`'s pre-existing shape and a larger question —
    // but the identity triple is now atomic.
    setHouseholds(all)
    setHousehold(found)
    setMembers(roster)
    const memberIds = roster.map((m) => m.id)
    // #34: chores re-read through the same path as members, so the
    // mutate-then-refresh guarantee covers them without a second mechanism.
    const choreRows = found ? await listChores(found.id) : []
    setChores(choreRows)
    // #353 — the shopping reads, scoped by the household just read, through
    // the same path as everything else: arriving on Shop shows what another
    // phone added in between for the same reason arriving on Who shows who
    // joined. `readShopping` is three sequential reads (lists by household,
    // open runs by list, items by run — never an embed filter), so every
    // re-read grew by three round trips the day this landed; #351 priced what
    // a round trip costs, and #355 took the TICK off this path entirely — see
    // `tickItem` below, which is the one write here that does not come through
    // `mutate()` and so never reaches this function.
    setShopping(found ? await readShopping(shoppingClient(), found.id) : EMPTY_SHOPPING)
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
    // #101 — the import ledger, read like every other row here and BY
    // HOUSEHOLD rather than by the member set: a row whose importer has since
    // left the household (`member_id` null) is still an import the list must
    // refuse a second time, and a member-scoped read would drop it.
    setCalendarImports(found ? await listCalendarImports(found.id) : [])
    // #96 — the derived figures, read like every other row here. Its OWN
    // try/catch, and that is not decoration: `0030` is unapplied on the live
    // project until somebody pastes it, and an unguarded read of a missing
    // table would fail this whole refresh — taking the roster, the chores and
    // the manual capacity path down with it. AC 5 says the manual path stays
    // untouched when the calendar half cannot answer, and a table that is not
    // there yet is the largest instance of that. Reported rather than
    // swallowed, for the reason the announcement read below gives: a red
    // nobody can see is how a paste stays forgotten.
    let busyRows = null
    if (found && period) {
      try {
        busyRows = await listBusyWeeks(period, memberIds)
        setBusyWeeks(busyRows)
        // Cleared on a SUCCESSFUL read, which the first version of this did not
        // do — the complaint was set here and cleared nowhere a member who
        // already has a figure could reach, so a transient failure left a
        // sentence standing under a figure that had since been read perfectly
        // well, for the rest of the session. Found by review-fanout, 2026-09-04.
        setBusyReadComplaint(null)
      } catch (err) {
        // The figures are NOT discarded, and that reversal is what makes AC 5
        // reachable at all. Clearing them here meant the only state the
        // criterion describes — the last figure, its date, and a sentence
        // saying the calendar could not be read — could not occur in the
        // running app: this story's fetch fires only when there is no row, so
        // its own failures never coexist with a figure, and the one path that
        // could produce both was throwing the figure away. Keeping them is also
        // what BusyReadout's docblock already claimed happened.
        setBusyReadComplaint(err.message)
      }
    } else {
      setBusyWeeks([])
      setBusyReadComplaint(null)
      setBusyFetchComplaint(null)
    }
    const uid = await currentUserId()
    setUserId(uid)
    // #172 — the organizer's invitations, and ONLY the organizer's. Resolved
    // against the roster and uid just read rather than the render's
    // `isOrganizer`, which is the previous refresh's answer — the same reason
    // the busy-fetch block below resolves `mine` here.
    //
    // NOT READ AT ALL for anybody else, and that is a choice about cost rather
    // than about safety. `invitations_select_organizer` would answer a member's
    // read with nothing, so reading unconditionally would be harmless — and
    // would cost every member who can never see the list one round trip per
    // refresh, which #351 priced at 562 ms on Slow 4G. The policy is still the
    // guard (`invitationMint.pglite.test.js` proves it through this exact
    // statement); this only stops asking a question whose answer is known.
    const mineHere = found ? findClaimedMember(roster, uid, found.id) : null
    const organizesHere = Boolean(mineHere && found && mineHere.id === found.organizer_member_id)
    // Not read at all while no code can be redeemed (`INVITATIONS_REDEEMABLE`,
    // false from #172 until #173 shipped redemption) — there is no card to
    // show it on. The gate stays, and the reason is in the constant's docstring.
    const invitationRows =
      organizesHere && INVITATIONS_REDEEMABLE ? await listInvitations(found.id) : []
    setInvitations(invitationRows)
    // RECONCILE THE SHOWN CODE WITH WHAT THE SERVER JUST SAID — review finding.
    // A code withdrawn from the organizer's other device, or redeemed, used to
    // stay on this screen after the next background refresh, Share still
    // sending it, because nothing compared `minted` with the list. A fresh mint
    // is safe from this: `handleMintInvitation` sets the code AFTER its own
    // re-read, which already carries the new row.
    const stillOutstanding = new Set(outstandingInvitations(invitationRows).map((row) => row.id))
    setMinted((shown) => (shown && !stillOutstanding.has(shown.id) ? null : shown))
    // #96 — the FETCH's complaint clears only once a figure for THIS member and
    // THIS week has actually arrived, from another device or a reload: "the
    // calendar could not be read" stops being true the moment a read of it is
    // on the screen, and not before, whatever the table says. Resolved against
    // the roster just read and the uid just fetched, not the render's `me`,
    // which is the previous refresh's answer.
    //
    // A FRESH figure, since #98 — not merely a figure. #96 wrote "a row
    // exists" here, and that was the same test as "a read has arrived" while
    // the only fetch was the no-row one: a complaint could never be standing
    // beside a row. #98's refresh fires precisely when a row exists and is
    // stale, so under the old test the very next refresh() — the tab press
    // that shows the roster — read the same stale row back and wiped the
    // sentence that said why it was still stale (measured: both #98 AC 4
    // tests found no complaint on screen). A row younger than the bound is
    // one somebody's read produced after the failure, and that is what makes
    // the sentence false; the same stale row read again makes it truer.
    if (busyRows && period) {
      const mine = findClaimedMember(roster, uid, found.id)
      const arrived = mine ? busyWeekFor(busyRows, mine.id, period) : null
      if (arrived && !isBusyWeekStale(arrived)) setBusyFetchComplaint(null)
    }

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
          // #106 — which changes the cause sentence may call the calendar's:
          // an automatic row whose recorded previous figure is the figure THIS
          // member was last shown, so the net delta is that write's alone. The
          // rule and its reason are `automaticCauseSources`'s.
          const sources = automaticCauseSources({
            seen,
            overrides: overrideRows.filter((row) => row.period_start === period),
          })
          const news = announcementFrom({
            seen,
            current,
            lastRebalance: found.last_rebalance ?? null,
            sources,
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

  // #342 — EVERY read goes through one queue: one in flight at a time, and a
  // request that lands while one is running schedules exactly one more. Until
  // this story `refresh()` had one caller class — this device's own writes —
  // and two writes never overlapped. Now a write's own re-read, the Realtime
  // echo of that write arriving a moment later, and a focus event can all ask
  // within the same second, and without the queue each would run the full
  // eleven-round-trip read concurrently. The queue is what AC 5 names: an
  // own write followed by its echo is two reads, not three, and any number of
  // echoes during one read is still two. `refresh` itself is unchanged; this
  // is the only place it is called.
  const reads = useMemo(() => createReadQueue(refresh), [refresh])
  const requestRefresh = useCallback(() => reads.request(), [reads])

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
        // #304 — a sign-in that did not complete comes back to this root with
        // its reason on the URL: in the fragment for a provider refusal or an
        // expired confirmation link, in the query — with no `state`, which is
        // how it is told from the calendar's return below — for GoTrue's
        // bad-flow-state redirects. Read BEFORE `currentSession()`: that call
        // constructs the client, and the client reads the URL once, at
        // construction, to pick up a SUCCESSFUL return's `#access_token` — so
        // the URL has to be intact when it looks. Stripped AFTER, for the same
        // reason, and so that a reload does not announce a spent failure twice.
        const signInReturn = readSignInReturn(globalThis.location)
        // #341 — read in the SAME breath and for the same reason, which the
        // paragraph above spells out: the client reads the URL once, at
        // construction, and `currentSession()` is what constructs it. An invite
        // link's `type=invite` rides in the same fragment as the `#access_token`
        // the client is about to swallow, so a read placed after this line finds
        // an empty hash — and the person lands in the app signed in, with no
        // password of their own and nothing on screen to say so. That failure is
        // silent and looks exactly like success, which is why the ordering is
        // asserted by a test rather than left to this comment.
        const callback = readAuthCallback(globalThis.location)
        const session = await currentSession()
        if (signInReturn || callback) {
          const { pathname } = globalThis.location
          globalThis.history?.replaceState?.(null, '', pathname)
        }
        const signInComplaint = signInReturn ? describeSignInReturn(signInReturn) : null
        if (entryStateFor({ session, household: null }) === ENTRY.SIGNED_OUT) {
          if (!cancelled) {
            setSignInNotice(signInComplaint)
            setStatus('onboarding')
          }
          return
        }

        // #341 AC 2 — an invitation was followed and the session is real, so ask
        // for a password before anything else. Set AFTER the signed-out branch
        // above, deliberately: a link whose token was rejected leaves no session,
        // and showing a password screen for a session that does not exist would
        // fail on the write with a sentence about the write. The sign-in screen
        // plus the link's own expiry sentence is the honest state there.
        //
        // The read continues underneath rather than stopping here — the household
        // load runs as normal, so dismissing this screen lands them in their
        // household rather than on a second loading pass.
        if (callback && !cancelled) setAuthCallback(callback)

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

        const found = await requestRefresh()
        // #430 — the restore banner's boot-time read. A failure here must not
        // keep anybody out of their household, so it reads as "none pending".
        const pending = await Promise.resolve()
          .then(() => householdDeletionStatus())
          .then((rows) => (Array.isArray(rows) ? rows : []))
          .catch(() => [])
        if (!cancelled) {
          setPendingDeletions(pending)
          // #154 — the entry decision has ONE implementation, beside the screen
          // it picks, and its three branches are proven in Onboarding.test.jsx.
          setStatus(
            entryStateFor({ session, household: found }) === ENTRY.JOINED ? 'joined' : 'onboarding',
          )
          if (skippedNotice) setNotice(skippedNotice)
          // The consent complaint wins the strip: it answers the thing the
          // person just did, where the catch-up is housekeeping they did not.
          if (consentComplaint) setError(consentComplaint)
          else if (signInComplaint) setError(signInComplaint)
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
  }, [requestRefresh])

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
        const found = await requestRefresh()
        setStatus(found ? 'joined' : 'onboarding')
        return result
      } catch (err) {
        setError(err.message)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [requestRefresh],
  )

  // #154 — ONE step, and the account is no longer part of it. Until this story
  // the organizer's signup and `create_household` ran inside one submit, and
  // the pair could only ever work on a project with email confirmation OFF:
  // with it on — which the live project has, `mailer_autoconfirm: false`,
  // measured 2026-08-26 — `signUp` returns no session, so the RPC that
  // followed ran unauthenticated and was refused, leaving an account with no
  // household on every first signup.
  //
  // The order is still load-bearing: `create_household` refuses an
  // unauthenticated caller and claims the organizer's member row to
  // `auth.uid()` in the same statement, so the account has to exist first.
  // It is now enforced by the SCREEN rather than by a sequence inside a
  // closure — `Onboarding` renders the household form only to a signed-in
  // person — so there is no path that reaches this without a session, and no
  // path that performs both writes in one submit (AC 5). `email` and
  // `password` are deliberately no longer accepted here; a caller passing them
  // would be asking for the old shape back.
  const handleCreate = useCallback(
    (name, { organizerName }) => mutate(() => createHousehold(name, { organizerName })),
    [mutate],
  )

  /**
   * Start another household from inside one — #166.
   *
   * `create_household` already works for a caller who has a household: it
   * claims the organizer's member row to `auth.uid()` in the same statement,
   * and `rls.integration.test.js`'s own fixture has been creating two
   * households per run over the wire since `0009`. So the server half of this
   * story was done before the story existed, and what was missing was that
   * `createHousehold` had exactly ONE call site, behind `status === 'onboarding'`
   * — a person could acquire a second household only by being provisioned into
   * it, never by making one.
   *
   * THE NEW HOUSEHOLD BECOMES ACTIVE (AC 1) and the choice is stored (AC 5),
   * and the ordering is the whole of it: `createHousehold` returns the
   * household row, so the id is in hand BEFORE `mutate`'s re-read runs. Setting
   * the ref inside the action is what makes that re-read resolve to the new
   * household. Without it the person would create a household and be left
   * looking at their first one — `listHouseholds()` orders by `created_at`, so
   * a brand-new household sorts LAST and the default would take them straight
   * back to where they started.
   */
  const handleCreateAnotherHousehold = useCallback(
    (name, { organizerName }) =>
      mutate(async () => {
        const created = await createHousehold(name, { organizerName })
        if (created?.id) {
          activeIdRef.current = created.id
          choiceEpochRef.current += 1
          writeActiveHouseholdChoice(created.id)
          setAnnouncement(null)
          setCalendarRevokeNote(null)
        }
        return created
      }),
    [mutate],
  )

  /**
   * Redeem an invitation code and land in the household it names — #173.
   *
   * ONE HANDLER FOR ALL THREE ENTRY POINTS: the no-household card, the
   * roster's join-another card, and the held code applied at boot below. The
   * function is the only route that can create a member row in a household
   * the caller is not yet in (`0040`; AC 6), and `redeemInvitation` issues
   * that one statement and nothing else.
   *
   * THE JOINED HOUSEHOLD BECOMES ACTIVE (AC 1's "the app switches to it", and
   * AC 7's "the newly joined one is active") — `handleCreateAnotherHousehold`'s
   * shape exactly, and for its reason: the function returns the member row,
   * whose `household_id` is in hand BEFORE `mutate`'s re-read runs, and the
   * re-read then resolves against a set that has just grown by one household
   * sorting LAST by `created_at`. Without the ref the person would join and be
   * left looking at the household they were already in. Both households are
   * in the switcher because `listHouseholds()` returns everything the person
   * belongs to and the switcher renders that list unfiltered.
   *
   * THE NAME IS WRITTEN AFTER THE JOIN, AND A FAILED RENAME DOES NOT UNDO IT.
   * `redeem_invitation` creates the row as `New member` (`0040` has no name to
   * write; #191's rule is that the recipient names themselves), so the join
   * forms ask for the name and this renames the row through the ordinary
   * `updateMember` grant — the same statement the person's own Edit control
   * issues. Owner decision at the design pass, 2026-09-11: the prototype
   * showed the person arriving under a placeholder they then had to find and
   * edit. If the rename is refused the join has still happened, and throwing
   * here would make `mutate` skip the re-read and leave the person on the
   * screen they came from while a member of a household it does not show —
   * so the complaint is held and reported AFTER the re-read, over the
   * household they did join.
   *
   * The held copy is cleared on EVERY outcome, including a refusal: a refused
   * code re-tried on every boot is a loop the person cannot leave, and the
   * refusal is on screen, so the next attempt is theirs to make. Cleared
   * BEFORE the call rather than after, so a refresh mid-call cannot find it
   * and try again. `setHeldInvitation` follows, so the sign-in note stops
   * promising a code that is gone.
   *
   * SCROLLED TO THE TOP once the join has landed (owner decision at the same
   * design pass): from the roster's join-another card the person is ~2,300px
   * down the page, and after the re-read they were left there, looking at the
   * NEW household's "Start another household" card with nothing in view saying
   * they had moved — the switcher naming the new household is at the top.
   * Guarded, because jsdom has no layout; asserted as a scroll request.
   */
  const handleJoinHousehold = useCallback(
    async (code, { name } = {}) => {
      let renameComplaint = null
      const joined = await mutate(async () => {
        clearPendingInvitation()
        setHeldInvitation(false)
        const member = await redeemInvitation(code)
        if (member?.household_id) {
          const chosen = String(name ?? '').trim()
          if (chosen) {
            try {
              await updateMember(member.id, { displayName: chosen })
            } catch (err) {
              renameComplaint = `You are in, but your name could not be saved (${err.message}). Edit it from your row on the Who tab.`
            }
          }
          activeIdRef.current = member.household_id
          choiceEpochRef.current += 1
          writeActiveHouseholdChoice(member.household_id)
          // The old household's notices do not come with it — the switch
          // path's rule (`chooseHousehold`), and the same four states.
          setAnnouncement(null)
          setCalendarRevokeNote(null)
          setMinted(null)
          setInvitations([])
        }
        return member
      })
      if (joined?.household_id) globalThis.scrollTo?.({ top: 0 })
      if (renameComplaint) setError(renameComplaint)
      return joined
    },
    [mutate],
  )

  /**
   * Keep an invitation for a person who is signed out — #173 AC 4, the first
   * half: the code, and the name they will join under.
   *
   * NOT through `mutate`: there is no session, so the re-read would run as
   * `anon` — refused since `0017` — and paint a refusal over a code that was
   * kept perfectly well (the `handleSignUp` reason). A blank code or name is
   * refused with a sentence about the field.
   */
  const handleHoldInvitation = useCallback(async (code, { name } = {}) => {
    if (!String(code ?? '').trim()) throw new Error('Type the invitation code first.')
    if (!String(name ?? '').trim()) throw new Error('Type the name you want to be called.')
    if (!writePendingInvitation({ code, name })) {
      throw new Error(
        'This browser cannot keep the code — sign in first, then type it on the next screen.',
      )
    }
    setHeldInvitation(true)
  }, [])

  // #173 AC 4 — apply the code this device was holding, on the first boot
  // that has a session. THE CARRYING MECHANISM IS `localStorage`, read by
  // `readPendingInvitation` — so a reader can tell this from an accident:
  // the code got here because `handleHoldInvitation` wrote it before the
  // person left for their inbox, and NOT through the confirmation link, the
  // URL, or the auth user's metadata (the two rejected routes, and why, are
  // in `pendingInvitation.js`). What it guarantees is per browser: the same
  // browser applies the code without it being re-typed; a confirmation link
  // opened in a different browser finds nothing here and shows the join form
  // instead — AC 5, asserted in both directions in `App.test.jsx`.
  //
  // Keyed on `userId`, which `refresh()` sets from the session on every boot
  // and after every sign-in, so one effect covers the returning-from-inbox
  // boot, a plain sign-in with a code held, and a signup on a project with
  // confirmation off — AND on the read having SETTLED, which is the review's
  // finding: `refresh()` sets `userId` mid-way and goes on to read the split
  // marker and write the seen snapshot, so an effect fired on `userId` alone
  // started the redemption while the sign-in's own refresh was still running.
  // For a member of one household holding a code for another, that first
  // refresh could write the old household's announcement AFTER the join had
  // cleared it, and the old household's screen was actionable for one round
  // trip. `busy` is true for the whole of a `mutate` (sign-in, sign-up with a
  // session) and `status` is `loading` for the whole of the boot, so waiting
  // on both is waiting for whichever read set the id to finish. A boot that
  // FAILED after setting the id (an organizer whose invitations read alone
  // refused — review finding) offers nothing: the strip is carrying the boot's
  // own reason and a redemption's refusal would replace it.
  //
  // It does NOT redeem. It puts the held invitation in front of the person as
  // a one-tap confirmation (`pendingJoin`), because the account that signed in
  // is not necessarily the one that held the code — see the state's comment.
  useEffect(() => {
    if (!userId || busy || status === 'loading' || status === 'failed') return
    const carried = readPendingInvitation()
    if (!carried) return
    setPendingJoin(carried)
  }, [userId, busy, status])

  // The tap. Redeems what the boot found, under the held name; the redemption
  // clears the store and the sign-in note, and this clears the card.
  const handleConfirmPendingJoin = useCallback(() => {
    const held = pendingJoin
    setPendingJoin(null)
    if (!held) return Promise.resolve(null)
    return handleJoinHousehold(held.code, { name: held.name }).catch(() => {
      // Reported by `mutate` onto the error strip; the join form is there for
      // the next attempt.
    })
  }, [pendingJoin, handleJoinHousehold])

  // "Not me." Forgets the code without spending it, so whoever held it can
  // type it again on their own device; nothing is redeemed and nothing moves.
  const handleDeclinePendingJoin = useCallback(() => {
    clearPendingInvitation()
    setHeldInvitation(false)
    setPendingJoin(null)
  }, [])

  // #173 — the held note follows the store. `heldInvitation` is read once at
  // mount; another tab on the same device can redeem, be refused on, or sign
  // out and clear the same key (review finding), and this tab would go on
  // promising a code that is gone. A `storage` event fires in every OTHER tab
  // when the key changes, so re-read on it. `key === null` is a cleared store.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== null && event.key !== 'taskr.pendingInvitation') return
      setHeldInvitation(Boolean(readPendingInvitation()))
    }
    globalThis.addEventListener?.('storage', onStorage)
    return () => globalThis.removeEventListener?.('storage', onStorage)
  }, [])
  // #154 — the organizer's own account, on its own. NOT through `mutate`, and
  // the reason is the grant layer: `mutate` re-reads the household after every
  // action, and after a signup that needs email confirmation there is no
  // session, so that read would run as `anon` — which 0017 (#186) stripped of
  // every privilege — and be REFUSED, with the refusal then reported over the
  // top of a signup that succeeded. So the re-read happens only when a session
  // came back (confirmation off, which no live project here has), and
  // otherwise the result is handed to the screen, which says what to do next.
  const handleSignUp = useCallback(
    async (credentials) => {
      setBusy(true)
      setError(null)
      try {
        const result = await signUpOrganizer(credentials)
        if (result.session) {
          const found = await requestRefresh()
          setStatus(found ? 'joined' : 'onboarding')
        }
        return result
      } catch (err) {
        setError(err.message)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [requestRefresh],
  )
  // #430 — the restore banner's list. Read at boot, after a delete or a
  // restore (the household it names is no longer in the list mutate reads),
  // and after a sign-in, since the banner belongs to whoever is signed in.
  const refreshPendingDeletions = useCallback(
    () =>
      Promise.resolve()
        .then(() => householdDeletionStatus())
        .then((rows) => setPendingDeletions(Array.isArray(rows) ? rows : []))
        .catch(() => {}),
    [],
  )
  const handleSignIn = useCallback(
    (credentials) => {
      // #304 — a fresh attempt answers the notice about the last one.
      setSignInNotice(null)
      return mutate(() => signIn(credentials)).then((result) =>
        refreshPendingDeletions().then(() => result),
      )
    },
    [mutate, refreshPendingDeletions],
  )
  // #304 — leaves the page. NOT through `mutate`: a successful start is a
  // navigation to Google, and the re-read `mutate` runs afterwards would go out
  // as `anon` — refused since 0017 (#186) — with the refusal painted over a
  // sign-in that is working. Busy is released in `finally` for the failure
  // case; on success the page is gone before anybody reads the flag.
  const handleSignInWithGoogle = useCallback(async () => {
    setBusy(true)
    setError(null)
    setSignInNotice(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setBusy(false)
    }
  }, [])
  // #291 — two scopes, one handler. The ordinary control ends this device's
  // session and nothing else; `everywhere` revokes every session for the
  // account, which is the lost-or-stolen-device answer and the only reason the
  // library's `global` default is still reachable at all. The scope is decided
  // by the control the person pressed, never by an unstated default.
  const handleSignOut = useCallback(
    (options) =>
      mutate(async () => {
        const result = await signOut(options)
        // #165 AC 7 — the remembered household does not outlive the session
        // that chose it. This is a household app and a shared tablet is the
        // likely case: without this, the next person to sign in on it lands on
        // a household somebody else picked, and every read they make is scoped
        // to it. Cleared AFTER the sign-out succeeds, so a refused sign-out
        // does not cost this device a preference it still needs.
        //
        // The ref goes with it, because `mutate` re-reads immediately below and
        // a stale id would resolve against the next session's membership set.
        activeIdRef.current = null
        choiceEpochRef.current += 1
        clearActiveHouseholdChoice()
        // #172 — the shown code does not outlive the session that minted it,
        // for #165 AC 7's reason: on a shared tablet the next person to sign in
        // must not find somebody else's invitation code on their screen.
        setMinted(null)
        // #173 — and a code HELD for redemption does not outlive it either, for
        // the same tablet: the next person to sign in on this device must not
        // be joined to a household by a code somebody else typed.
        clearPendingInvitation()
        setHeldInvitation(false)
        // #430 — and the restore banner does not either: it names the last
        // person's household and its purge date, and the next person to sign
        // in on this tablet must not find it on their screen (#430 review).
        setPendingDeletions([])
        return result
      }),
    [mutate],
  )
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
  // #430 — delete and restore a household. Both through mutate, so the list
  // is re-read and the shell lands on onboarding when the last household
  // goes; then the banner's status is re-read (refreshPendingDeletions, above
  // handleSignIn), because the household it names is no longer in that list.
  const handleDeleteHousehold = useCallback(
    (id) => mutate(() => requestHouseholdDeletion(id)).then(refreshPendingDeletions),
    [mutate, refreshPendingDeletions],
  )
  const handleRestoreHousehold = useCallback(
    (id) => mutate(() => restoreHousehold(id)).then(refreshPendingDeletions),
    [mutate, refreshPendingDeletions],
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
  /**
   * Email somebody an invitation instead of choosing their password — #341 AC 1.
   *
   * Beside `handleProvision` rather than folded into it, because the two are no
   * longer variants of one act. Provision takes a credential the organizer typed
   * and reaches the roster's own screen; this takes nothing, and what it changes
   * is in somebody else's inbox.
   */
  const handleInvite = useCallback(
    (memberId) => mutate(() => inviteMember({ memberId })),
    [mutate],
  )

  /**
   * Email a member a link to set a new password — #341, owner decision at pickup.
   *
   * Takes the MEMBER rather than an id, because the address is what GoTrue is
   * given and it is on the row. Nothing is re-read afterwards and `mutate` still
   * wraps it for the busy flag and the error strip: what changed is in an inbox,
   * so a re-read would show the same roster and imply something on screen had
   * moved.
   */
  const handleSendReset = useCallback(
    (member) => mutate(() => sendPasswordReset(member.email)),
    [mutate],
  )

  /**
   * Finish an invitation or a recovery by setting a password — #341 AC 2.
   *
   * `mutate()` is not used, and the difference is the point: every other write in
   * this file re-reads the household afterwards, and there is no household on
   * screen here — the shell is not rendered at all. What has to happen after the
   * write is that this screen goes away, which is what clearing `authCallback`
   * does; boot has already loaded the household underneath, so what they land on
   * is their household rather than a second loading pass.
   *
   * The error is deliberately left set when the write fails: the screen stays,
   * because a password that was not set is a person who cannot sign in again if
   * they leave.
   */
  const handleChoosePassword = useCallback(
    async (password) => {
      setBusy(true)
      setError(null)
      try {
        await setOwnPassword(password)
        setAuthCallback(null)
      } catch (err) {
        setError(err.message)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [setBusy, setError],
  )

  const handleRefresh = useCallback(() => mutate(async () => {}), [mutate])

  /**
   * Show another household — #164 AC 2, and the only place a person makes the
   * choice.
   *
   * The re-read is the criterion, not a nicety: "every surface RE-READS against
   * it — asserted as a re-read of the five data-layer calls, not as a local
   * state change". So this does NOT filter data this device already holds; it
   * goes back to the server through the same `mutate()` every write uses, and
   * what appears is what the next device to load would see. Filtering locally
   * would have been faster and would have shown the other household's chores as
   * of whenever this device last read them.
   *
   * `view` is untouched (AC 6). Somebody on the Chores surface who switches
   * household is still on the Chores surface, now showing the other household's
   * chores — the surface is where they are, not what they are looking at, and
   * moving them would answer a question they did not ask.
   *
   * `me` and `isOrganizer` need nothing here (AC 5): both are derived at render
   * from `members` and `household?.id`, so the re-read recomputes them inside
   * the newly active household by construction rather than by a step somebody
   * has to remember to add.
   */
  const chooseHousehold = useCallback(
    (id) => {
      // The ref FIRST — `refresh()` reads it, and the read below starts before
      // React has re-rendered with the state beside it. The epoch goes with it,
      // always: a read already in flight must not judge this choice.
      activeIdRef.current = id
      choiceEpochRef.current += 1
      // #165 AC 1 — a CHOICE is what gets remembered, and this is the only
      // place a person makes one. Nothing writes on a plain load, so a device
      // whose owner has never switched household stores nothing at all.
      writeActiveHouseholdChoice(id)
      // THE OLD HOUSEHOLD'S NOTICES DO NOT COME WITH IT. Found by
      // review-fanout. Both of these are written by a `refresh()` and cleared
      // only by the control that answers them, so neither had anything on the
      // switch path: a re-balance announcement about household A stood over
      // household B's surfaces, read against B's member names — and pressing
      // "Got it" there SPENT it, because `writeSplitSeen` had already advanced
      // A's seen marker in the refresh that produced it, so `announcementFrom`
      // can never derive it again. The calendar note is the same shape: a
      // sentence about letting go of a connection in A, standing over B, where
      // the connection is per member-and-household and still live.
      setAnnouncement(null)
      setCalendarRevokeNote(null)
      // #172 — a code minted for household A is A's. Left standing it would be
      // read out as an invitation to B, whose roster is now on screen under it.
      setMinted(null)
      // And A's LIST, for the same reason — review finding. B's roster and its
      // organizer answer land a moment before B's invitations are read, so for
      // that window (and for good, if a read in between fails) A's outstanding
      // codes sat under B's "Waiting to be used", withdrawable there.
      setInvitations([])
      return handleRefresh().catch(() => {})
    },
    [handleRefresh],
  )
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
  // #99 — the way back out, and unlike Connect above it DOES go through
  // `mutate()`: three rows are deleted server-side and the screen has to re-read
  // to show it. That is the whole of AC 2 — `refresh()` re-reads
  // `calendar_connections` and `calendar_busy`, so the Connect action returns
  // and the suggestion goes with the rows it was derived from. Nothing is
  // patched locally, for the reason every other write here re-reads: what the
  // next device to load will see is exactly what this one now shows.
  const handleDisconnectCalendar = useCallback(async () => {
    setCalendarRevokeNote(null)
    const result = await mutate(() => disconnectCalendar({ householdId: household?.id }))
    // Set AFTER the refresh, so the sentence lands on the screen the disconnect
    // produced rather than on the one it replaced. A failed disconnect throws
    // out of `mutate()` before reaching here, which is correct: there is nothing
    // to say about Google when Taskr has not let go.
    setCalendarRevokeNote(revokeNoteFor(result))
    // The last derived figure's complaint is about a calendar this member no
    // longer has, so it goes with it — a sentence saying "that calendar
    // connection is no longer valid, connect it again" under a row with no
    // calendar is true of nothing.
    setBusyFetchComplaint(null)
    // #96's and #98's once-per-session guards, cleared. Forgetting what was read
    // includes forgetting that it was asked for: without this, connecting again
    // in the same session would find the key already present and fetch nothing,
    // so the member would sit looking at a connected calendar with no figure
    // until they reloaded. Every key in both sets is this member's own by
    // construction — both effects build it from `myMemberId`.
    askedForBusy.current.clear()
    refreshedBusy.current.clear()
    return result
  }, [mutate, household])
  const handleConnectCalendar = useCallback(() => {
    setError(null)
    // A fresh attempt clears the note the last disconnect left: it describes a
    // connection that is being replaced.
    setCalendarRevokeNote(null)
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
  // #305 — "didn't happen" goes through an RPC for the same clock reason:
  // `missed_at` decides which week the Done surface files the row under.
  const handleMissChore = useCallback((id) => mutate(() => missChore(id)), [mutate])
  const handleUnmissChore = useCallback((id) => mutate(() => unmissChore(id)), [mutate])
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
  // one, and the extraction bet (#210) is an accelerator on top of it, never the
  // only way in. A test asserts that this path imports nothing else.
  // #49 — the capacity write is what the grooming decision named as the
  // trigger: the household's assignments follow it with nobody pressing an
  // assign button and nobody asked to approve. `reassignHousehold` re-reads
  // everything fresh, computes with the real allocator and applies through the
  // one transactional RPC; `mutate()`'s refresh then shows the stored result,
  // so what this device shows is what the next device to load will see.
  //
  // #210 — `source` is the one thing a proposed figure adds to this call.
  // 'manual' when typed, 'extraction' when the member took a description's
  // proposal (edited or not), 'calendar' when they took the calendar's figure
  // UNEDITED (#97 — an edited one is manual; the roster decides which, this
  // passes it on) — and the SAME `setCapacity`, the same re-assignment, the
  // same re-read for all of them.
  // That is AC 9's one write path, and the reason the roster is handed one
  // handler rather than one per proposer.
  const handleSetCapacity = useCallback(
    (memberId, minutes, source = 'manual') => {
      if (!periodStart) return Promise.reject(new Error('No week to set capacity for yet.'))
      return mutate(async () => {
        const saved = await setCapacity({
          memberId,
          periodStart,
          minutes,
          source,
          householdId: household?.id,
        })
        await reassignHousehold({ householdId: household?.id })
        return saved
      })
    },
    [mutate, periodStart, household],
  )
  // #210 — ask the extraction endpoint what a sentence means. Deliberately NOT
  // routed through `mutate()`, and the difference is the whole of AC 1 and
  // AC 3: nothing is written here. A proposal is a number on screen that the
  // member has not agreed to, so there is no change to re-read and no `busy`
  // to set over the rest of the roster — the shell carries its own pending
  // state for the one row that asked. The write, if it comes, is
  // `handleSetCapacity` above, with the source saying where the figure came
  // from. The household is the one THIS SCREEN is showing (#159's rule), and
  // the roster travels with the request so the attribution can tell "Robin
  // has two hours" typed on somebody else's row from a figure for that row.
  const handleProposeCapacity = useCallback(
    (member, text) => extractCapacity({ householdId: household?.id, text, member, members }),
    [household, members],
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
  // #284 — deal out the work nobody has. The SAME run the two capacity
  // handlers above make, with no write of its own in front of it: at setup
  // every capacity edit lands before any chore exists, so the trigger #49
  // wired never fires and the split's needs-attention area was a dead end
  // (measured on #52). `reassignHousehold` re-reads everything, computes with
  // the real allocator, pins what was placed by hand, and stores through the
  // one transactional RPC; `mutate()`'s refresh then shows the stored result.
  const handleDealOut = useCallback(
    () => mutate(() => reassignHousehold({ householdId: household?.id })),
    [mutate, household],
  )
  // #353 — the Shop tab's mutate() writes, each re-reading so the list this
  // phone shows after the write is the list every other phone reads. The list
  // is created in the household THIS SCREEN is showing (#159 AC 4's rule); an
  // item names its run and a removal names its item, and the household is the
  // database's to check. The client is handed in rather than reached for
  // inside the module — shopping.js takes it as a parameter so its io test can
  // hand in a fake — and `shoppingClient()` is the same `getSupabase()` every
  // other data-layer module reads.
  //
  // #358 — a list somebody just named is the list they want to be looking at,
  // so the created row's id becomes the choice. It is set AFTER `mutate()`
  // resolves, which is after the re-read, so the id it names is one the current
  // read holds; setting it before would be a choice `resolveSelectedListId`
  // would immediately discard as naming nothing. A refused create — a duplicate
  // name — rejects here and moves the choice nowhere.
  const handleCreateShoppingList = useCallback(
    (name) =>
      mutate(() => createList(shoppingClient(), household?.id, name)).then((made) => {
        if (made?.id) setShoppingListId(made.id)
        return made
      }),
    [mutate, household],
  )
  // #358 — the one direct write the client holds on `shopping_lists` (0032's
  // `update (name)`), through `mutate()` like every other write on this tab.
  // The id does not change, so the choice above needs no help: the heading
  // re-reads with the new name under the same id.
  const handleRenameShoppingList = useCallback(
    (listId, name) => mutate(() => renameList(shoppingClient(), listId, name)),
    [mutate],
  )
  // #360 — put a list away, and bring it back. Both through `mutate()` like
  // every other write on this tab bar the tick: what changes is not one row on
  // screen but which lists the picker draws, so the full re-read is the point
  // rather than a cost.
  //
  // NEITHER TOUCHES `shoppingListId`, and both cases are already answered by
  // the resolution below. Archiving the list on screen leaves the preference
  // naming a list the visible set no longer holds, which is exactly what
  // `resolveSelectedListId`'s fallback is for — the picker moves to the first
  // active list by name, the same as it does for a removed list or a household
  // change. Unarchiving names a list that is in the visible set under either
  // setting of the toggle, so the person keeps looking at what they just
  // brought back. Writing the preference here would be a second rule saying
  // what that one rule already says.
  const handleArchiveShoppingList = useCallback(
    (listId) => mutate(() => archiveList(shoppingClient(), listId)),
    [mutate],
  )
  const handleUnarchiveShoppingList = useCallback(
    (listId) => mutate(() => unarchiveList(shoppingClient(), listId)),
    [mutate],
  )
  const handleAddShoppingItem = useCallback(
    (runId, name, note) => mutate(() => addItem(shoppingClient(), runId, name, note)),
    [mutate],
  )
  // #368 — an RPC since `0034`, and no longer a delete this client may issue
  // at all. It was a plain delete under a policy, which refused a bought item
  // or a closed run by matching zero rows; what a policy cannot do is take the
  // RUN's lock, so a remove racing a finish deleted the original out of the
  // closed run's record. The function takes `for key share` on the run first,
  // like every other writer since `0033`, and REFUSES BY NAME — so if another
  // phone bought the item between this one's read and its tap, the person now
  // reads "item already bought" on the strip instead of watching nothing
  // happen. The database decided, as before; what changed is that it says so.
  const handleRemoveShoppingItem = useCallback(
    (itemId) => mutate(() => removeItem(shoppingClient(), itemId)),
    [mutate],
  )

  // #357 — the end of the trip. Through `mutate()` like the three above and
  // deliberately NOT like the tick: a finish happens once a trip rather than
  // once an aisle, so the round trips a full refresh costs are affordable
  // here, and what the screen must show afterwards is not one row but a
  // different RUN — the new one, with the carried items on it. The RPC returns
  // that run and this ignores it: the items are what the screen draws, and
  // they come from the read.
  //
  // The argument is the RUN THIS SCREEN IS SHOWING, never the list. That is
  // `0033`'s whole design and the reason the second phone in a two-phone race
  // is refused instead of closing the run the first one just opened.
  //
  // A REFUSAL RE-READS, the same shape as the tick's refusal path and for the
  // same reason: `mutate()` leaves the screen alone when the write fails, and
  // the one refusal this RPC is built to raise — `run already closed` — means
  // another phone finished first, so the run on screen no longer exists and
  // the picture is known to be stale. #356 measured which refusal actually
  // arrives: 40 of 40 races took the RPC's own sentence and none the unique
  // index, so there is one refusal path to think about here and not two. The
  // re-read is unconditional anyway, because a client cannot tell the stale
  // case from the rest by reading a message, and re-reading after a failure
  // costs a refresh on a path that has already failed.
  //
  // The read's own error is swallowed for `tickItem`'s reason: the refusal
  // above is the sentence that explains what happened, and a complaint about a
  // read the person did not ask for would replace the answer with a symptom.
  //
  // One difference from `tickItem` worth stating rather than leaving to be
  // found: `mutate()` clears `busy` in its own `finally`, which runs BEFORE
  // this catch, so the controls are live during the recovery read where
  // `tickItem` keeps them disabled. A second Finish in that window names the
  // same run, is refused by `0033` for the same reason, and re-reads again —
  // so the window costs a round trip and can produce no second close. It is
  // left as it is because closing it means not using `mutate()`, and an
  // untested copy of `mutate()` here would be the worse trade.
  const handleFinishShoppingRun = useCallback(
    (runId) =>
      mutate(() => finishRun(shoppingClient(), runId)).catch(async (err) => {
        try {
          const found = await requestRefresh()
          setStatus(found ? 'joined' : 'onboarding')
        } catch {
          // Deliberately swallowed — see above.
        }
        throw err
      }),
    [mutate, requestRefresh],
  )

  // #359 — the history read, and the ONE read on this screen that `refresh()`
  // does not perform.
  //
  // Every other read here runs on arrival because what it returns is bounded by
  // the week the household is having; closed runs grow by one per trip forever,
  // so a tab press would get slower every week whether or not anybody ever looks
  // back. The trigger is the disclosure opening, which is the moment somebody
  // asked — and it fires again on every re-open, because a person asking twice
  // wants the current answer rather than the one this device happened to keep.
  //
  // NOT through `mutate()`: nothing is written, so there is no re-read to
  // follow and no reason to disable the tab's controls while it runs. The
  // pending state is the disclosure's own sentence.
  //
  // A REFUSAL clears the rows rather than leaving the last list's history under
  // this list's name, and reports itself on the error strip like every other
  // refusal on this surface. It rethrows so the caller's rejection arm runs; the
  // component supplies both arms for the reason every other write there does.
  const handleOpenPastRuns = useCallback((listId) => {
    setPastRuns({ ...NO_PAST_RUNS, loading: true })
    return readClosedRuns(shoppingClient(), [listId]).then(
      ({ runs, items }) => {
        setPastRuns({ loading: false, loaded: true, runs, items })
      },
      (err) => {
        setPastRuns(NO_PAST_RUNS)
        setError(err.message)
        throw err
      },
    )
  }, [])

  // #355 — the tick, and the ONE write on this screen that does not re-read
  // everything. `mutate()` is write-then-full-refresh by design, and here that
  // design is too expensive to keep: #351 measured a full refresh per tick at
  // 6.5 s at Slow 4G against the 1 s bar a person taps at, because a refresh
  // costs eleven round trips of which the shopping reads are three. One round
  // trip measured 0.585 s. The owner took the one-round-trip route at this
  // story's pickup (2026-09-05), and `0032`'s RPCs already return the whole
  // stamped row, so no migration was needed to get it.
  //
  // What the departure costs, stated rather than hidden: another phone's ticks
  // are not picked up by this one until the next re-read. When this was
  // written that meant the next arrival on the tab, which is what the epic's
  // decision 3 — re-read on open, no Realtime — said about every other row on
  // this surface; since #342 reversed decision 3, the other phone's tick is a
  // `shopping_items` change on the household channel and arrives as a
  // background re-read within seconds. The tick itself still does not re-read.
  //
  // The refusal path IS the full re-read, and it is not a consolation prize: a
  // refusal ("item already bought") is the one moment this phone knows its
  // picture is stale, so the cheap path runs while the picture is good and the
  // expensive one runs exactly when it is not. The refusal's own sentence stays
  // on screen — `refresh()` never writes `error` — and a re-read that itself
  // fails leaves that sentence standing rather than replacing it with a second
  // complaint about a read the person did not ask for.
  const tickItem = useCallback(
    async (action) => {
      setBusy(true)
      setError(null)
      try {
        const row = await action()
        setShopping((current) => ({
          ...current,
          items: replaceShoppingItem(current.items, row),
        }))
        return row
      } catch (err) {
        setError(err.message)
        try {
          const found = await requestRefresh()
          setStatus(found ? 'joined' : 'onboarding')
        } catch {
          // Deliberately swallowed. The refusal above is the sentence that
          // explains what happened; a read error on top of it would replace
          // the answer with a symptom.
        }
        throw err
      } finally {
        setBusy(false)
      }
    },
    [requestRefresh],
  )
  const handlePurchaseShoppingItem = useCallback(
    (itemId) => tickItem(() => purchaseItem(shoppingClient(), itemId)),
    [tickItem],
  )
  const handleUnpurchaseShoppingItem = useCallback(
    (itemId) => tickItem(() => unpurchaseItem(shoppingClient(), itemId)),
    [tickItem],
  )

  // #358 — the lists in the order the Shop tab draws them, and which one it is
  // showing. Both are DERIVED at render from the read and the preference above,
  // for the reason every other fold on this screen is: there is one
  // representation of the read and no second copy to fall out of step with it.
  //
  // `resolveSelectedListId` is what makes AC 6's three fallbacks one rule — a
  // household change, a list that is gone after a re-read, and an arrival with
  // no choice yet are all "the preference names nothing on screen", and all
  // land on the first list by name. The preference itself is left alone rather
  // than corrected in state: a person who switches household and switches back
  // finds the list they were on, and nothing had to remember to write it.
  //
  // #360 — the split is applied AFTER the ordering and never instead of it, so
  // there is one ordering rule and the archived half arrives in the same order
  // it would be drawn in. `visibleShoppingLists` is what the tab draws and what
  // the resolution chooses from, which is what makes archiving the list on
  // screen fall back rather than leave the tab pointing at nothing: an archived
  // list is, to that resolution, a list the read no longer shows.
  const shoppingLists = orderShoppingLists(shopping.lists)
  const { active: activeShoppingLists, archived: archivedShoppingLists } =
    partitionShoppingLists(shoppingLists)
  const visibleShoppingLists = showArchivedLists ? shoppingLists : activeShoppingLists
  const selectedShoppingListId = resolveSelectedListId(visibleShoppingLists, shoppingListId)

  // #160 — resolved WITHIN the household on screen. `household?.id` is the
  // same state object `isOrganizer` compares against below, so who-you-are and
  // what-you-organise cannot be answered about two different households. The
  // roster is already scoped (#159), but the identity layer must not lean on
  // that: with a claimed row in two households, an unscoped match returns
  // whichever row the list happens to put first.
  const me = findClaimedMember(members, userId, household?.id)

  // #96 AC 1 — THE trigger, and the only one this story owns.
  //
  // "A connected member with no derived row for the current week, when the
  // capacity screen opens." Each clause below is one of those words, and the
  // boundary is drawn deliberately hard against #98's refresh story: no row
  // means this fetches, a row existing means this does NOTHING, and how old
  // that row is belongs entirely to #98. The two invocation-count tests are
  // disjoint by construction rather than by care — there is no staleness test
  // here to get wrong, because there is no staleness clause.
  //
  // `view === 'who'` is what "opens" means: the app boots on the split, and the
  // capacity control lives on the roster. Booting straight into a Google call
  // on a screen that shows no capacity would spend a member's credential for a
  // figure nobody asked to see.
  //
  // The member is `me` — resolved within the household on screen (#160) — for
  // the owner decision at pickup, 2026-09-04: this reads the CALLER'S OWN
  // calendar and nobody else's. A housemate's figure arrives when they open
  // their own app.
  //
  // THE DEPENDENCIES ARE VALUES, NOT OBJECTS, and the first version of this got
  // that wrong in a way every test passed over. `goTo('who')` starts a
  // `refresh()` in the same breath as it sets the view, and `refresh()` replaces
  // `household`, `members`, `connections` and `busyWeeks` with freshly decoded
  // objects — new identities, same contents. With those objects in the dep
  // array the cleanup ran before the Edge Function answered, `cancelled` went
  // true, the result was dropped on BOTH branches, and `askedForBusy` then
  // refused a retry for the rest of the session. The suite could not see it
  // because every mock returns the same reference each call, so React bailed
  // out of the re-render and no identity ever moved (review-fanout,
  // 2026-09-04: `a-fake-cannot-disagree-with-its-author`). So the effect keys
  // on the ids and booleans it actually decides by, and a refresh that changes
  // nothing it cares about leaves it alone.
  const householdId = household?.id
  const myMemberId = me?.id

  // #172 — mint an invitation for the household ON SCREEN, recorded against
  // this person's own member row IN IT. Both ids come from state `refresh()`
  // set, never re-resolved in the data layer: #159 measured a write landing in
  // the other household when it re-resolved. `invitations_insert_organizer`
  // refuses any other pairing regardless.
  //
  // The code arrives AFTER `mutate`'s re-read, so it lands on screen together
  // with the new row in the list rather than a round trip ahead of it.
  //
  // HELD OUTSIDE THE ACTION, and that is review-fanout's headline, found by
  // three lenses. The first version read the code off `mutate`'s return, and
  // `mutate` rethrows when any unguarded read in the re-read fails — so an
  // insert that COMMITTED followed by a flaky read threw the only copy of the
  // code away while its row stayed live: AC 2's "shown once" became "shown
  // zero times", under an error strip naming the read. Now a committed mint is
  // shown whether or not the re-read worked, beside that read's error if it
  // did not. A REFUSED mint leaves `made` null and shows nothing, correctly.
  const handleMintInvitation = useCallback(async () => {
    let made = null
    try {
      await mutate(async () => {
        made = await mintInvitation({ householdId: household?.id, createdByMemberId: myMemberId })
        return made
      })
    } catch {
      // `mutate` has set the error strip — for a refused mint, or for a
      // re-read that failed after the insert committed.
    }
    if (made) setMinted({ code: made.code, id: made.invitation?.id ?? null })
  }, [mutate, household, myMemberId])

  // #172 AC 4 — withdraw, then re-read. If the invitation withdrawn is the one
  // whose code is still on screen, that code is dead the moment the stamp
  // lands, so it leaves with the row rather than standing there looking usable.
  //
  // Cleared INSIDE the action, the moment the withdrawal resolves — review
  // finding. It used to be cleared in a `.then` after `mutate`, which a failed
  // re-read skips: the stamp committed, the code died, and it stayed on screen
  // with Share still sending it.
  const handleWithdrawInvitation = useCallback(
    (id) =>
      mutate(async () => {
        await withdrawInvitation(id)
        setMinted((shown) => (shown?.id === id ? null : shown))
      }).catch(() => {}),
    [mutate],
  )

  const handleDismissMintedCode = useCallback(() => setMinted(null), [])
  // #213 — ask the extraction endpoint what a chore description means. NOT
  // through `mutate()`, for #210's reason: a proposal is a list on screen the
  // member has not agreed to, so nothing is written, nothing re-reads, and
  // `busy` stays off the rest of the tab. The write, if it comes, is
  // `handleAddChores` above with `source: 'extraction'` on every row — the
  // same loop over `addChore` a typed batch takes. Today is the household's
  // (the same `localTodayIn` the tab's skip picker is handed), because a
  // stated "tomorrow" resolves against the household's calendar and never
  // the phone's; the speaker is the person typing, so "I'll do the bins"
  // names somebody the endpoint can attribute. Declared here rather than
  // beside the other chore handlers because it closes over `me`.
  const myName = me?.display_name
  const handleProposeChores = useCallback(
    (text) =>
      extractChores({
        householdId,
        text,
        todayIso: household ? localTodayIn(household.timezone) : undefined,
        speaker: myName,
      }),
    [householdId, household, myName],
  )
  const myConnection = myMemberId ? connectionFor(connections, myMemberId) : null
  const isConnected = Boolean(myConnection)

  // #101 — the three handlers behind "Import from calendar" on the Chores tab.
  //
  // Listing is NOT routed through `mutate()`, for #210's reason: nothing is
  // written by reading a week of events, so there is no change to re-read and
  // no `busy` to set over the tab — the import section carries its own pending
  // state. The household and the week are the ones THIS SCREEN is showing
  // (#159's rule); who it is about is `auth.uid()` off the JWT, so the body
  // names no member and there is no version of this call that reads a
  // housemate's calendar.
  const handleFetchCalendarEvents = useCallback(
    () => fetchCalendarEvents({ householdId, periodStart }),
    [householdId, periodStart],
  )
  // The incremental consent — AC 1. The SAME flow `handleConnectCalendar`
  // starts, with the wider scope named: same state token, same household in
  // storage, same return through `completeConnect`, so `calendar-connect`
  // upserts the token and the connection row with what Google now grants and
  // the import section reads the widened scope off the row. Not through
  // `mutate()` either — the browser leaves for Google and the write happens
  // in the Edge Function when it comes back.
  const handleWidenCalendarConsent = useCallback(() => {
    setError(null)
    setCalendarRevokeNote(null)
    try {
      globalThis.location.assign(
        startConnect({ householdId: household?.id, scope: GOOGLE_CALENDAR_READONLY_SCOPE }),
      )
    } catch (err) {
      setError(err.message)
    }
  }, [household])
  // The import itself — AC 3, AC 4, AC 5. ONE `mutate()`, TWO writes, in this
  // order: the chore through the same `addChore` a typed chore uses, with
  // `source: 'calendar'` the one thing this adds to a typed call; then the
  // ledger row naming the event id and the chore it became. The order is the
  // whole of how two phones importing the same event in the same second
  // resolve — `0038`'s unique constraint refuses the SECOND ledger insert, and
  // that refusal alone (`alreadyImported`, never a network failure) removes the
  // chore this device just created, because a chore that landed with a ledger
  // row that could not be written for any other reason is one the household
  // still wants. The refusal's sentence then reaches the error strip through
  // `mutate()` like any other refused write, which is AC 5's "shown as already
  // imported" on the phone that lost.
  const handleImportEvent = useCallback(
    (chore, calendarEventId) =>
      mutate(async () => {
        const saved = await addChore({ ...chore, source: 'calendar', householdId: household?.id })
        try {
          await recordCalendarImport({
            householdId: household?.id,
            memberId: myMemberId,
            calendarEventId,
            choreId: saved?.id,
          })
        } catch (err) {
          if (err?.alreadyImported && saved?.id) await removeChore(saved.id)
          throw err
        }
        return saved
      }),
    [mutate, household, myMemberId],
  )
  const myBusyWeek =
    myMemberId && periodStart ? busyWeekFor(busyWeeks, myMemberId, periodStart) : null
  const hasBusyRow = Boolean(myBusyWeek)
  // #98 — the one VALUE the refresh trigger decides by. A string off the row,
  // not the row: `refresh()` hands back a fresh object every time with the same
  // timestamp in it, and keying on the object would re-run the effect on every
  // mutation for the same reason the first version of the trigger below broke.
  const myBusyComputedAt = myBusyWeek?.computed_at ?? null
  // A stable array while its members are the same ids, so the re-read below can
  // name the household without the effect re-running on every refresh.
  const memberIdsKey = members.map((m) => m.id).join(',')
  const memberIds = useMemo(() => (memberIdsKey ? memberIdsKey.split(',') : []), [memberIdsKey])

  // #342 — a read nobody pressed a button for. Through the same queue as every
  // other read, so it coalesces with a write's own re-read; its failure lands
  // on the error strip rather than being swallowed (a red nobody can see is how
  // a fault stays unfound) and rather than being thrown, since nothing is
  // awaiting it. `busy` is deliberately NOT set: a re-read another phone caused
  // must not grey out the controls under this person's thumb.
  const readInBackground = useCallback(() => {
    requestRefresh().catch((err) => setError(err.message))
  }, [requestRefresh])

  // #342 AC 1 — the phone that was in a pocket. When the tab becomes visible
  // again or the window regains focus, re-read — debounced inside the helper,
  // so the pair of events a return to the tab fires is one read. Only while
  // JOINED: a person on the sign-in screen has nothing to re-read, and the
  // onboarding screens make their own reads.
  useEffect(() => {
    if (status !== 'joined') return undefined
    return attachVisibilityRefresh(readInBackground)
  }, [status, readInBackground])

  // #342 AC 2 and AC 3 — the phone on the counter. One Realtime channel for
  // the household on screen, filtered to it on the server; every change it
  // lets through is a re-read, and a re-join after a drop is a re-read too,
  // because that is the catch-up for whatever was missed while the socket was
  // down. Keyed on the household ID and the roster's ids (the member-scoped
  // tables are filtered by them), never on the objects `refresh()` replaces
  // every time — the same lesson the busy-week effect below records. Closed by
  // the cleanup on sign-out (status leaves `joined`) and on a household switch
  // (`householdId` changes), which is the whole of "opened on join and closed
  // on sign-out or household switch".
  useEffect(() => {
    // The household id alone decides it: `refresh()` sets it and `joined`
    // together, and a sign-out clears it in the same read that leaves `joined`.
    if (!householdId) return undefined
    const live = subscribeToHousehold({
      householdId,
      memberIds,
      onChange: readInBackground,
      onReconnect: readInBackground,
    })
    return () => {
      live.close()
    }
  }, [householdId, memberIds, readInBackground])

  // What happens AFTER either trigger decides to ask — one function, because
  // #96's first read and #98's refresh differ only in WHEN, and two copies of
  // the what-happens-next is exactly the drift a shared seam exists to stop.
  //
  // NO CANCELLATION, and neither caller has a cleanup — the second review-fanout
  // pass on #96 reversed both. A `cancelled` flag dropped the answer whenever a
  // concurrent `refresh()` tore the effect down mid-flight; and releasing the
  // guard key on teardown let a tab switch inside the round trip start a SECOND
  // Edge Function call for the same week — two token exchanges and two Google
  // reads — while the test named "once for that week" stayed green.
  //
  // So a settled answer LANDS whenever it settles: `setBusyWeeks` re-reads by
  // the week the call was about, and `refresh()` will overwrite either state on
  // the next load if the household on screen has moved on. React 18 tolerates
  // a state write after unmount, and App never unmounts. The member gets the
  // figure on the visit it arrived, once.
  const readMyBusyWeek = useCallback(
    async ({ householdId, periodStart, memberIds, myMemberId }) => {
      try {
        await fetchBusyWeek({ householdId, periodStart })
      } catch (err) {
        // #96 AC 5 and #98 AC 4, the same sentence: nothing is cleared. The last
        // derived figure — if there is one — stays on screen with its date, and
        // the function's own sentence goes beside it. Not `setError`: that strip
        // is for the app being broken, and a calendar Google would not answer is
        // a fact about the calendar, with the manual path untouched underneath.
        setBusyFetchComplaint(err.message)
        return
      }
      setBusyFetchComplaint(null)
      // Re-read rather than trusting the response body, for the reason every
      // write on this screen re-reads: what the next device to load will see is
      // exactly what this one now shows. The function's own answer would be a
      // second representation of the row it just wrote. This re-read is also the
      // whole of #98 AC 3 — the roster draws `busyWeeks`, so a figure that lands
      // while the capacity screen is open is on it at the next render, and there
      // is no reload to ask for because there is no cache to invalidate.
      //
      // In its OWN try, because a failure here is a failure of the TABLE, not of
      // Google, and the two complaints are cleared by different things — a read
      // failure filed under the fetch's complaint would outlive the next
      // successful read, which is what one version of this did.
      let rows
      try {
        rows = await listBusyWeeks(periodStart, memberIds)
        setBusyWeeks(rows)
        setBusyReadComplaint(null)
      } catch (err) {
        setBusyReadComplaint(err.message)
        return
      }

      // #106 — the one write on this screen nobody pressed a button for. A
      // suggestion that lands within `AUTO_APPLY_BOUND_MINUTES` of the week's
      // current figure is written as this member's capacity with the word
      // `calendar_auto` and the figure it replaced, then re-assigned exactly as
      // a tap would be (#49), then re-read so what this phone shows is what
      // the next one loads (and so #50's announcement fires for THIS member
      // too). Whether to write is `autoApplyDecision`'s alone — the bound, the
      // manual floor and the no-change rule live there, with their tests.
      //
      // BOTH INPUTS ARE RE-READ FROM THE SERVER, not taken from the screen: the
      // fetch above took seconds, and a housemate's typed figure landing in
      // between must be seen and respected by the floor rule, while a baseline
      // edit landing in between must be the baseline the figure is computed
      // from (review-fanout, 2026-09-08: the first draft read the roster off a
      // ref of the latest render, which is current to within a Realtime echo
      // and no better). The window that survives the re-read — the one round
      // trip between it and the write — is the trigger's (`0039`,
      // `member_capacity_automatic_never_overtypes`), and its refusal is read
      // as a PERSON having won, below.
      //
      // Deliberately NOT through `mutate()`: that sets `busy` over every
      // control, and a write the person did not ask for must not grey out the
      // one under their thumb — #342's reasoning for its background reads,
      // applied to a background write. Its failure lands on the error strip,
      // through `setError`, because a write that failed is the app being
      // broken and a red nobody can see is how a fault stays unfound; the two
      // calendar complaints above are for a CALENDAR that would not answer.
      try {
        const member = (await listMembers(householdId)).find((m) => m.id === myMemberId)
        if (!member) return
        const arrived = busyWeekFor(rows, member.id, periodStart)
        const override =
          (await listCapacity(periodStart, [member.id])).find((row) => row.member_id === member.id) ??
          null
        const decision = autoApplyDecision({
          member,
          override,
          suggestion: calendarSuggestion(member, arrived),
        })
        if (!decision.apply) return
        try {
          await setCapacity({
            memberId: member.id,
            periodStart,
            minutes: decision.to,
            source: 'calendar_auto',
            previousMinutes: decision.from,
            householdId,
          })
        } catch (err) {
          // The trigger refused because a person's figure landed in the one
          // round trip between the re-read and this write. Nothing is wrong —
          // the manual floor held, server-side — so nothing is announced and
          // nothing is re-assigned; the re-read shows the figure that won.
          if (err?.cause?.code === AUTO_APPLY_REFUSED_CODE) {
            await requestRefresh()
            return
          }
          throw err
        }
        await reassignHousehold({ householdId })
        await requestRefresh()
      } catch (err) {
        setError(err.message)
      }
    },
    [requestRefresh],
  )

  useEffect(() => {
    if (status !== 'joined' || view !== 'who') return
    if (!householdId || !periodStart || !myMemberId) return
    if (!isConnected || hasBusyRow) return

    const key = `${myMemberId}:${periodStart}`
    if (askedForBusy.current.has(key)) return
    askedForBusy.current.add(key)

    readMyBusyWeek({ householdId, periodStart, memberIds, myMemberId })
  }, [
    status,
    view,
    householdId,
    periodStart,
    myMemberId,
    isConnected,
    hasBusyRow,
    memberIds,
    readMyBusyWeek,
  ])

  // #98 AC 1 — THE OTHER trigger, and the mirror of the one above.
  //
  // "A connected member whose derived row is older than the staleness bound,
  // when the app opens." Where #96 fires on NO row, this fires on a row that
  // exists and is stale — `hasBusyRow` is in both guards with opposite signs,
  // which is what keeps the two invocation-count suites disjoint by
  // construction rather than by care. How old is `isBusyWeekStale`'s question
  // and nobody else's; the constant is `BUSY_STALE_AFTER_HOURS` in calendar.js.
  //
  // "When the app opens" and NOT "when the capacity screen opens" — this reads
  // `status` and not `view`, deliberately, and the difference from #96 is the
  // difference between the two criteria. #96 declined to spend a credential at
  // boot for a figure nobody had asked to see; here the member has a figure
  // already, the week it describes is the week the split reacts to, and the
  // criterion after this one asks that a refresh landing while the capacity
  // screen is open update it in place — a sentence that only means something
  // if the refresh was started somewhere else. So the split is where it
  // starts. What it can cost is bounded by the constant and by the key below.
  //
  // The dependencies are values, for the reason the effect above learnt the
  // hard way: `myBusyComputedAt` is the timestamp as a string, so a refresh
  // that hands back the same row in a new object leaves this alone, and a
  // refresh that hands back a NEWER row re-runs it into the early return.
  // Age is judged at the moment the effect runs, against the real clock: on a
  // phone that is the app open, and on a device left open past the bound it
  // is the first thing that re-renders — a completed chore, a tab — which is
  // the same person asking the same question a little later.
  useEffect(() => {
    if (status !== 'joined') return
    if (!householdId || !periodStart || !myMemberId) return
    if (!isConnected || !hasBusyRow) return
    if (!isBusyWeekStale({ computed_at: myBusyComputedAt })) return

    const key = `${myMemberId}:${periodStart}`
    if (refreshedBusy.current.has(key)) return
    refreshedBusy.current.add(key)

    readMyBusyWeek({ householdId, periodStart, memberIds, myMemberId })
  }, [
    status,
    householdId,
    periodStart,
    myMemberId,
    isConnected,
    hasBusyRow,
    myBusyComputedAt,
    memberIds,
    readMyBusyWeek,
  ])

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
  // single listHouseholds() read in refresh(), resolved by
  // resolveActiveHousehold() (#164).
  const isOrganizer = Boolean(me && household && me.id === household.organizer_member_id)

  // #59 — record the dismissal against THIS member, then re-read like every
  // other write, so what this phone shows is what the seen-marker row now
  // says rather than an optimistic local flip. `me` is resolved within the
  // household on screen (#160), so the dismissal cannot land on another
  // household's row; with no claimed row the write refuses with a sentence
  // rather than guessing whose dismissal it was. `myMemberId` is declared
  // above, beside the calendar trigger that also keys on it.
  const handleDismissFairnessNote = useCallback(
    () => mutate(() => dismissFairnessNote(myMemberId)),
    [mutate, myMemberId],
  )

  // #341 AC 2 — the invitation and recovery landing, returned BEFORE the shell
  // rather than rendered inside it.
  //
  // Early-returned deliberately, and the alternative is worth naming because it
  // is the obvious one: adding `&& !authCallback` to the render conditions
  // below. There are more than a dozen of them, every future surface adds
  // another, and a single one forgotten renders a household's chores to somebody
  // who has not finished setting up their account. The screen has one job, and a
  // return is the only way to say "and nothing else" once.
  //
  // The shell's title and tagline go with it. Somebody who has just clicked a
  // link in their email does not need the product pitch; they need the one field
  // that finishes what they started.
  if (authCallback) {
    return (
      <main className="shell">
        <ChoosePassword
          type={authCallback.type}
          busy={busy}
          onChoose={handleChoosePassword}
        />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    )
  }

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

      {/* #173 — the held invitation, as one tap. Rendered for a person with no
          household AND for a member of another household alike, above whatever
          else the screen shows, because in both cases the question is the same
          and the code was typed before anybody signed in. `role="status"` on the
          note rather than `alert`: nothing is wrong. Only existing classes.
          Gated on `pendingJoin` ALONE: the effect that sets it is the one place
          that decides when an offer is made (a settled, non-failed boot with a
          session), and a second condition here made that guard dead — measured,
          removing it reddened nothing until this line stopped repeating it. */}
      {pendingJoin ? (
        <section className="card" aria-labelledby="held-invitation-heading" data-testid="held-invitation-confirm">
          <h2 id="held-invitation-heading" className="card__heading">
            Join with the code on this device?
          </h2>
          <p className="card__body" role="status">
            This device is holding an invitation code, entered as{' '}
            <strong>{pendingJoin.name}</strong> before anybody signed in. Join
            that household under that name, or say it is not you and the code
            is forgotten so whoever typed it can use it on their own phone.
          </p>
          <div className="row">
            <button
              className="button"
              type="button"
              onClick={handleConfirmPendingJoin}
              disabled={busy}
            >
              Join as {pendingJoin.name}
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={handleDeclinePendingJoin}
              disabled={busy}
            >
              Not me
            </button>
          </div>
        </section>
      ) : null}

      {/* #430 — the way back from deleting a household, ABOVE onboarding and
          the tabs alike: deleting your only household lands you on
          onboarding, and undoing it is the one thing you might want next. */}
      {(status === 'joined' || status === 'onboarding') && pendingDeletions.length ? (
        <PendingDeletion
          pending={pendingDeletions}
          onRestore={handleRestoreHousehold}
          busy={busy}
        />
      ) : null}

      {status === 'onboarding' ? (
        <Onboarding
          onCreate={handleCreate}
          onSignUp={handleSignUp}
          onSignIn={handleSignIn}
          onSignInWithGoogle={handleSignInWithGoogle}
          onSignOut={handleSignOut}
          // #173 — the invited person's two halves: hold a code while signed
          // out, redeem one while signed in with no household.
          onJoin={handleJoinHousehold}
          onHoldInvitation={handleHoldInvitation}
          heldInvitation={heldInvitation}
          // #173 — a held code refused at boot is reported by `mutate` onto
          // this, and no form on that screen submitted it, so the screen has
          // to be handed it.
          error={error}
          signInNotice={signInNotice}
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

      {/* #47 criterion 11 — the surfaces, and the only way between them (five
          since #353; the chore tab's done line is a second way to one of them).
          A `nav` with buttons rather than links, because there is nothing to
          link TO: one document, no router, and an anchor with no href is worse
          for assistive tech than a button that says what it does.

          The current tab is marked with `aria-current` and styled off that
          attribute rather than off a second class name. One state, in the place
          a screen reader already reads it — and gate.test.js's stylesheet check
          only sees static `className` strings, so a conditional class here
          would be a class nothing checks. */}
      {/* #163 — WHICH household the data on screen belongs to, named directly
          above the surfaces it scopes and on every one of them. Under one
          household it is still a paragraph, not a button and not a heading:
          the name is information, and nothing here may suggest there is
          another to pick (#163 AC 4). #164 is the switcher #163 said would
          "attach here later with no layout change", and it kept that promise
          by REPLACING the paragraph for somebody in two households rather
          than sitting beside it — the tab strip below has no width to share.
          Both cases live in `HouseholdSwitcher`, so there is one place that
          decides which is drawn.

          The read site, for #163 AC 2: `household.name` arrives through the
          single listHouseholds() read in refresh() (#164 — it was
          currentHousehold() until then, and the `select('*')` moved with it),
          which is `select('*')` on
          `households`, and `name` is already in 0013:95's column grant
          (`select (id, name, created_at, organizer_member_id, timezone)`), so
          NO new grant ships with this story. The guard for a later column
          being added and not granted — which would refuse that `select('*')`
          outright rather than drop a field — is grants.pglite.test.js's
          "grants select on EVERY column of households". */}
      {status === 'joined' && household ? (
        <HouseholdSwitcher
          households={households}
          activeId={household.id}
          onChoose={chooseHousehold}
          busy={busy}
        />
      ) : null}

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
          onDealOut={handleDealOut}
          busy={busy}
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
          onInvite={handleInvite}
          onSendReset={handleSendReset}
          onRefresh={handleRefresh}
          onSignOut={handleSignOut}
          // #430 — the organizer's "Delete this household".
          onDeleteHousehold={handleDeleteHousehold}
          deletionGraceDays={GRACE_PERIOD_DAYS}
          // #166 — the affordance that did not exist. Owner decision at pickup:
          // its own card on this surface rather than an entry inside the
          // switcher or a second control on the shell row, because the shell
          // row already fits five tabs into 263.2px at exactly 8px of padding
          // and this is household administration, which is what the Who tab is.
          onCreateHousehold={handleCreateAnotherHousehold}
          // #173 — the other half of that pair: join a second household with a
          // code, from inside the first. Same surface, same reason.
          onJoinHousehold={handleJoinHousehold}
          // #172 — the invitation card. Roster shows it only to the organizer of
          // the household on screen; `invitations` is already empty for anybody
          // else because refresh() never asks on their behalf.
          invitations={invitations}
          mintedCode={minted?.code ?? null}
          // Unwired while no code can be redeemed (`INVITATIONS_REDEEMABLE`, false
          // from #172 until #173 shipped redemption) — Roster's optional-wiring
          // gate then renders no card at all, whoever is looking and whatever
          // gets promoted to `release`. The gate stays for the constant's reason.
          onMintInvitation={INVITATIONS_REDEEMABLE ? handleMintInvitation : null}
          onWithdrawInvitation={handleWithdrawInvitation}
          onDismissMintedCode={handleDismissMintedCode}
          overrides={overrides}
          periodStart={periodStart}
          onSetCapacity={handleSetCapacity}
          onClearCapacity={handleClearCapacity}
          onProposeCapacity={handleProposeCapacity}
          connections={connections}
          onConnectCalendar={handleConnectCalendar}
          onDisconnectCalendar={handleDisconnectCalendar}
          calendarRevokeNote={calendarRevokeNote}
          busyWeeks={busyWeeks}
          // The READ complaint only reaches a member who has connected a
          // calendar (owner decision, 2026-09-04, at the second review pass): a
          // failed read of the busy table only means something to somebody whose
          // figure would have been there. Otherwise every member would read a
          // PostgREST sentence under their minutes for the whole window between
          // this merging and `0030` being applied, on a row that has nothing to
          // do with calendars. The FETCH complaint is about this member's own
          // calendar by construction, so it needs no such gate.
          busyComplaint={busyFetchComplaint ?? (isConnected ? busyReadComplaint : null)}
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
          onPropose={handleProposeChores}
          // #101 — the import control mounts for the signed-in member's OWN
          // connection only, and only where they could have consented at all
          // (a real address; the PIN discriminator `0007` established). A
          // housemate's connection is not this phone's to import from.
          calendarConnection={me && isRealEmailMember(me) ? myConnection : null}
          calendarImports={calendarImports}
          onFetchCalendarEvents={handleFetchCalendarEvents}
          onWidenCalendarConsent={handleWidenCalendarConsent}
          onImportEvent={handleImportEvent}
          onSave={handleSaveChore}
          onRemove={handleRemoveChore}
          onComplete={handleCompleteChore}
          onUncomplete={handleUncompleteChore}
          onMiss={handleMissChore}
          onUnmiss={handleUnmissChore}
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
          onMiss={handleMissChore}
          onUnmiss={handleUnmissChore}
          onAssign={handleAssignChore}
          onUnassign={handleUnassignChore}
          onExclude={handleExcludeMember}
          onAllow={handleAllowMember}
          onSkip={handleSkipOccurrence}
          onRecordActual={handleRecordActual}
        />
      ) : null}

      {/* #353 — the household's shopping list. The roster is what the surface
          resolves "added by" against, and `error` is the same strip every
          other surface renders for a refused write.

          #355 — the timezone is the household's, because a bought stamp is a
          time of day a person reads ("bought by Robin · 4:02 PM") and every
          other date on this app is spelled in the household's zone. */}
      {status === 'joined' && household && view === 'shop' ? (
        <Shopping
          lists={visibleShoppingLists}
          archivedCount={archivedShoppingLists.length}
          showArchived={showArchivedLists}
          onShowArchived={setShowArchivedLists}
          runs={shopping.runs}
          items={shopping.items}
          members={members}
          timezone={household.timezone}
          busy={busy}
          error={error}
          selectedListId={selectedShoppingListId}
          onSelectList={setShoppingListId}
          onCreateList={handleCreateShoppingList}
          onRenameList={handleRenameShoppingList}
          onArchiveList={handleArchiveShoppingList}
          onUnarchiveList={handleUnarchiveShoppingList}
          onAddItem={handleAddShoppingItem}
          onRemoveItem={handleRemoveShoppingItem}
          onPurchaseItem={handlePurchaseShoppingItem}
          onUnpurchaseItem={handleUnpurchaseShoppingItem}
          onFinishRun={handleFinishShoppingRun}
          past={pastRuns}
          onOpenPastRuns={handleOpenPastRuns}
        />
      ) : null}

      <footer className="shell__footer">
        {/* #425 — a mailto the person reads and sends themselves; see
            lib/reportProblem.js for why its fields are an allowlist. */}
        <a
          className="shell__report"
          href={reportHref({
            build: buildInfo.commit,
            environment: buildInfo.env,
            screen: reportScreen({ status, view, surfaces: SURFACES }),
            browser: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
          })}
        >
          Report a problem
        </a>
        <span>{buildInfo.name}</span>
        <span aria-hidden="true"> · </span>
        <span>{buildInfo.env}</span>
        <span aria-hidden="true"> · </span>
        <span data-testid="build-commit">build {buildInfo.commit}</span>
      </footer>
    </main>
  )
}
