// The shared harness for App's tests. Until #553 this was the top of one
// 10,584-line `App.test.jsx`, which vitest ran in a single worker; the file is
// now split by surface (`src/App.<surface>.test.jsx`) and this is its setup,
// moved: the fakes for every data-layer module App imports, the `vi.mock`
// calls that install them, the one `beforeEach` that resets them to the
// ordinary answers, `renderApp`, and the fixtures more than one surface uses.
//
// Import it FIRST in every App test file. Its `vi.mock` calls are hoisted
// within this module and registered when it is evaluated, which happens once
// per test file, so a module the test file imports AHEAD of it is loaded
// before they exist. That fails silently rather than loudly: measured on #553,
// `listChores` imported ahead of this module was the REAL function while App,
// imported here afterwards, got the fake — a test asserting on one while the
// app calls the other, with nothing red.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #540 — the release version the footer and the report must both name, read
// from the file `npm version` moves rather than from buildInfo, so the footer
// test compares the page against its source and not against itself.
export const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

// The shell's own assertions (heading, fairness rule, build stamp) survive from
// #4 unchanged — they are what makes a deploy observable. What changed in #5 is
// everything between: the page is now a function of whether this device has
// joined a household, answered by the server on every load.
//
// Names are synthetic — see #19.

export const backend = { hasSupabaseConfig: true }

export const api = {
  currentSession: vi.fn(),
  listHouseholds: vi.fn(),
  listMembers: vi.fn(),
  currentUserId: vi.fn(),
  createHousehold: vi.fn(),
  signIn: vi.fn(),
  // #304. Stubbed because the real one navigates the browser; readSignInReturn
  // and describeSignInReturn stay REAL (importActual below) because they are
  // pure and the sentence a person reads should be the one the app words.
  signInWithGoogle: vi.fn(),
  signUpOrganizer: vi.fn(),
  signOut: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn(),
  // #341 — the three impure halves of the invitation path. `readAuthCallback`
  // is NOT here: it is pure, it reads the location this file already controls,
  // and stubbing it would make the ordering test below assert a stub's call
  // order instead of the app's behaviour.
  inviteMember: vi.fn(),
  sendPasswordReset: vi.fn(),
  setOwnPassword: vi.fn(),
  // #430 — deleting a household. Defaults that change nothing, so every test
  // that is not about deletion renders exactly what it did before: nobody has
  // a household pending deletion.
  householdDeletionStatus: vi.fn(async () => []),
  requestHouseholdDeletion: vi.fn(async () => ({})),
  // #431
  leaveHousehold: vi.fn(async () => ({ accountDeleted: false, warning: null })),
  // #432 — deleting your own sign-in. The default answers as the function
  // does on success; tests about a refusal override it.
  deleteAccount: vi.fn(async () => ({ deleted: true, revokeFailed: false })),
  transferHousehold: vi.fn(async () => ({})),
  restoreHousehold: vi.fn(async () => ({})),
  // #440 — whether the local session is gone (a null session AND no error),
  // and the SIGNED_OUT listener. Stubbed: both talk to the auth client.
  sessionIsGone: vi.fn(),
  onSignedOut: vi.fn(),
}

// #440 — the SIGNED_OUT listeners App subscribed, one per mounted instance,
// so a test can fire the event the way auth-js would; and the unsubscribe each
// subscription hands back, which a remount's cleanup must call.
export let signedOutListeners = []
export const unsubscribeSignedOut = vi.fn()

// #34. Mocked separately from household.js because it is a separate module, and
// the pure validators are kept real (importActual below) so a test cannot pass
// against a stub that disagrees with the rules the form actually enforces.
export const choresApi = {
  listChores: vi.fn(),
  addChore: vi.fn(),
  // #220 — the batch pass. Stubbed for the same reason addChore is: the real
  // one loops over addChore, and at this level the claim is the WIRING — the
  // household on screen travels with the rows.
  addChores: vi.fn(),
  updateChore: vi.fn(),
  removeChore: vi.fn(),
  // #53 — the boot-time catch-up pass. formatSkippedNotice stays REAL
  // (importActual below): it is pure, has its own tests, and the notice a
  // person reads should be the sentence the app actually words, not a stub's.
  catchUpRepeats: vi.fn(),
  // #12 — adjusting an actual. The derivations (actualsSummary,
  // estimateSuggestion, normalizeActualMinutes) stay real for the standing
  // reason: pure, own tests, and a stub could disagree with the boundary the
  // suggestion sits on.
  recordActualMinutes: vi.fn(),
  // #305 — the third state's writer and its undo, stubbed like completion.
  missChore: vi.fn(),
  unmissChore: vi.fn(),
}

// #46 — only the three IMPURE capacity functions are stubbed. periodStartFor,
// effectiveCapacity and capacitiesFor stay real, because they are pure, have
// their own tests, and a stub of them could disagree with the single
// implementation capacity.test.js asserts exists. Same reasoning the household
// mock gives for leaving findClaimedMember alone.
// #210 — only the IMPURE capture function is stubbed. `proposeCapacity` and
// the outcome vocabulary stay real (importActual below) for the standing
// reason: pure, own tests, and a stub could disagree with the classification
// the roster renders from.
export const captureApi = {
  extractCapacity: vi.fn(),
  // #213 — the chore half, stubbed for the same reason: `proposeChores` is
  // pure and has its own tests; what App owes is the WIRING.
  extractChores: vi.fn(),
}

export const capacityApi = {
  listCapacity: vi.fn(),
  setCapacity: vi.fn(),
  clearCapacity: vi.fn(),
}

// #49 — the whole module is stubbed, including its exported constant: the
// orchestrator reads the server through its own client calls, and this suite's
// getSupabase throws on purpose. What App owes is WHEN it runs, which is
// exactly what a stub records.
export const reassignApi = {
  reassignHousehold: vi.fn(),
  planReassignment: vi.fn(),
  REASSIGN_MAX_ATTEMPTS: 3,
}

// #50 — only the two IMPURE seen-marker functions are stubbed. `splitSnapshot`
// and `announcementFrom` stay real for the standing reason: pure, with their
// own tests, and a stub of either could disagree with the arithmetic the bars
// render from — which is the exact disagreement AC 4 forbids.
export const announceApi = {
  readSplitSeen: vi.fn(),
  writeSplitSeen: vi.fn(),
  dismissFairnessNote: vi.fn(),
}

// #37 — only the three IMPURE exclusion functions are stubbed. `isExcluded`,
// `excludedMemberIds` and `eligibleMembers` stay real for the reason the
// capacity mock gives: they are pure, they have their own tests, and a stub of
// them could disagree with the single implementation those tests assert.
export const exclusionsApi = {
  listExclusions: vi.fn(),
  excludeMember: vi.fn(),
  allowMember: vi.fn(),
}

// #95 — the same treatment again: only the two IMPURE calendar functions are
// stubbed. `consentUrl`, `readConsentReturn`, `isRealEmailMember`,
// `connectionFor` and `startConnect` stay real, because they are pure (or, in
// `startConnect`'s case, pure over an injected `sessionStorage`) and a stub of
// them could disagree with the scope, the parameters and the discriminator that
// `calendar.test.js` asserts. `startConnect` staying real is what makes the
// consent URL these tests read the one the app would actually send somebody to.
export const calendarApi = {
  listCalendarConnections: vi.fn(),
  completeConnect: vi.fn(),
  // #96 — the two impure ones. `busyWeekFor` and `busyComputedLabel` stay REAL
  // (importActual below), for the standing reason: pure, own tests, and a stub
  // could disagree with the matching rule the roster depends on — which is the
  // rule AC 1's trigger is built out of.
  listBusyWeeks: vi.fn(),
  fetchBusyWeek: vi.fn(),
  // #480 — the prior weeks' read. `weeklyHistory` and `suggestCapacity` stay
  // REAL for the standing reason: pure, own tests, and a stub could disagree
  // with the figure the roster draws. What App owes is ONE read per refresh
  // and a first paint that does not wait for it.
  listBusyHistory: vi.fn(),
  // #99 — the impure one. `revokeNoteFor` stays REAL (importActual below) for
  // the standing reason: it is pure, it has its own tests, and the sentence a
  // member reads about Google should be the one the app words rather than a
  // stub's — this file's claim is the WIRING.
  disconnectCalendar: vi.fn(),
  // #101 — the three impure ones. `hasEventReadScope`, `eventChorePrefill`,
  // `importedEventIds` and `startConnect` stay REAL for the standing reason —
  // pure (or pure over an injected storage), own tests — so the consent URL
  // these tests read is the one the app would send somebody to, and the
  // prefill the form shows is the one the data layer computes. The fakes
  // RECORD THEIR ARGUMENTS: `recordCalendarImport` is asserted with the chore
  // id `addChore` returned, because a fake recording only the call could not
  // tell a ledger row naming the chore from one naming nothing.
  listCalendarImports: vi.fn(),
  fetchCalendarEvents: vi.fn(),
  recordCalendarImport: vi.fn(),
}

// Set BEFORE `calendar.js` is imported, because it reads `import.meta.env` once
// at module scope — the same shape as `supabase.js`. Without it `startConnect`
// refuses (correctly: an unconfigured build cannot build a consent URL) and the
// AC 3 test below would assert that nothing happened, which is a true statement
// about a build nobody ships.
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '1234567890-placeholder.apps.googleusercontent.com')

vi.mock('../../lib/supabase.js', () => ({
  get hasSupabaseConfig() {
    return backend.hasSupabaseConfig
  },
  getSupabase: () => {
    throw new Error('App must not reach the client directly; it goes through lib/household.js')
  },
}))

vi.mock('../../lib/chores.js', async () => {
  const actual = await vi.importActual('../../lib/chores.js')
  return { ...actual, ...choresApi }
})

vi.mock('../../lib/capacity.js', async () => {
  const actual = await vi.importActual('../../lib/capacity.js')
  return { ...actual, ...capacityApi }
})

vi.mock('../../lib/capture.js', async () => {
  const actual = await vi.importActual('../../lib/capture.js')
  return { ...actual, ...captureApi }
})

vi.mock('../../lib/exclusions.js', async () => {
  const actual = await vi.importActual('../../lib/exclusions.js')
  return { ...actual, ...exclusionsApi }
})

vi.mock('../../lib/calendar.js', async () => {
  const actual = await vi.importActual('../../lib/calendar.js')
  return { ...actual, ...calendarApi }
})

vi.mock('../../lib/reassign.js', () => reassignApi)

vi.mock('../../lib/announce.js', async () => {
  const actual = await vi.importActual('../../lib/announce.js')
  return { ...actual, ...announceApi }
})

// #339 — the provider-switch read. Stubbed because the real one fetches; the
// default (set in beforeEach) is ON, the live project's answer since #330, so
// every test that is not about the switch — #304's included — runs exactly as
// it did before this story.
export const authSettingsApi = {
  readGoogleSignIn: vi.fn(),
}
vi.mock('../../lib/authSettings.js', () => authSettingsApi)

// #458 — who has accepted their invitation. Only the READ is stubbed; the pure
// `signInStateFor` and `nextExpiry` stay real, because the roster calls them
// and a stub could disagree with them. The default is an empty answer, which
// reads every claimed fixture as signed in — what those fixtures meant before
// #458 — so no other test changes.
export const signInStateApi = {
  listSignInStates: vi.fn(),
}
vi.mock('../../lib/signInState.js', async () => {
  const actual = await vi.importActual('../../lib/signInState.js')
  return { ...actual, ...signInStateApi }
})

vi.mock('../../lib/household.js', async () => {
  // findClaimedMember is pure and has its own tests, so the real one is used
  // rather than a stub that could disagree with it.
  const actual = await vi.importActual('../../lib/household.js')
  return { ...actual, ...api }
})

// #353 — only the IMPURE shopping functions are stubbed, plus the client
// accessor, which would otherwise reach the supabase.js mock above and throw.
// `normalizeName` and `firstNameOf` stay REAL (importActual below) for the
// standing reason: pure, own tests, and the sentence a person reads when a
// name is empty should be the one the data layer words. The fakes RECORD THE
// ARGUMENTS — `readShopping` is asserted with the household it was handed and
// `addItem` with its run, name and note — because a fake that only records
// the call cannot tell a scoped read from an unscoped one (cairn's
// `a-fake-that-drops-an-argument-makes-two-behaviours-one`).
//
// #355 — `purchaseItem` and `unpurchaseItem` join them, and their fakes are
// the story's whole instrument: the tick does NOT re-read, so what proves it
// worked is the RETURN VALUE reaching the screen. A fake that only recorded
// the call could not tell the one-round-trip route from the old full-refresh
// one, nor a tick of the right item from a tick of the first item on screen.
// `orderShoppingItems`, `replaceShoppingItem` and `purchasedLabel` stay REAL,
// like the other pure helpers.
//
// #357 — `finishRun` joins them, and its fake carries the run id for the same
// argument reason: the RPC takes the run THIS SCREEN is showing, and a fake
// that only recorded the call could not tell that from one passing the list.
//
// #358 — `renameList` joins them, carrying the list id and the name, and
// `createList`'s fake starts RETURNING the row it made: App reads the created
// list's id to move the picker onto it, so a fake resolving `undefined` could
// not tell "the new list is on screen" from "the first list by name is".
// #359 — `readClosedRuns` joins them, and its fake carries the LIST IDS for the
// argument reason above: the history read is the one read on this surface that
// `refresh()` does not perform, and a fake that only recorded the call could not
// tell "asked for the list on screen" from "asked for the household's history"
// — nor tell either from a read that fired on arrival, which is the criterion.
export const shoppingApi = {
  readShopping: vi.fn(),
  readClosedRuns: vi.fn(),
  createList: vi.fn(),
  renameList: vi.fn(),
  // #360 — both carry the LIST ID for the argument reason above: an archive
  // names the list this tab is showing, and a fake recording only the call
  // could not tell that from one passing the household or the run.
  archiveList: vi.fn(),
  unarchiveList: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  purchaseItem: vi.fn(),
  unpurchaseItem: vi.fn(),
  finishRun: vi.fn(),
  shoppingClient: vi.fn(),
}
/** The object App hands to every shopping call, so the tests can see it did. */
export const SHOPPING_CLIENT = { fake: 'shopping client' }
export const EMPTY_SHOPPING = { lists: [], runs: [], items: [] }

vi.mock('../../lib/shopping.js', async () => {
  const actual = await vi.importActual('../../lib/shopping.js')
  return { ...actual, ...shoppingApi }
})

// #342 — only the IMPURE half is stubbed: `subscribeToHousehold` opens a
// websocket. `attachVisibilityRefresh` and `createReadQueue` stay REAL
// (importActual below) — pure over the DOM and over promises, with their own
// tests in `realtime.test.js` — because what App owes here is the WIRING: when
// the channel opens and closes, what household and roster it is handed, and
// that a change, a re-join or a focus event is a read through the same queue
// as a write. The fake RECORDS ITS ARGUMENTS and hands back a `close` the
// tests can see, for the standing reason (cairn's
// `a-fake-that-drops-an-argument-makes-two-behaviours-one`): a fake that only
// recorded the call could not tell a channel on the household on screen from
// one on the first household by name, nor a channel closed on sign-out from
// one left open.
export const realtimeApi = {
  subscribeToHousehold: vi.fn(),
}
vi.mock('../../lib/realtime.js', async () => {
  const actual = await vi.importActual('../../lib/realtime.js')
  return { ...actual, ...realtimeApi }
})

// #172 — the three IMPURE invitation functions. `outstandingInvitations`,
// `normalizeInvitationCode` and the code generator stay REAL for the standing
// reason: pure, own tests, and the list a person reads should be filtered by the
// rule the data layer uses. The fakes RECORD THEIR ARGUMENTS (cairn's
// `a-fake-that-drops-an-argument-makes-two-behaviours-one`): a mint must name
// the household on screen AND the organizer's own member row in it, and a fake
// that recorded only the call could not tell that from a mint naming the first
// household by name or somebody else's row.
export const invitationsApi = {
  listInvitations: vi.fn(),
  mintInvitation: vi.fn(),
  withdrawInvitation: vi.fn(),
  // #173 — the redeemer's half. Its fake carries the CODE for the argument
  // reason above: what proves the held code was applied is this being called
  // with the code that was held, and a fake that only recorded the call could
  // not tell that from a redemption of whatever was in the field.
  redeemInvitation: vi.fn(),
}
// The redeemable flag ships TRUE since #173 (it was FALSE from #172 until then,
// so that a promotion between the two stories could not put an unspendable
// code in front of organizers). A getter, the idiom the `supabase.js` mock uses
// for `hasSupabaseConfig`: on by default in the shared beforeEach, and the one
// test about the flag turns it OFF to prove the gate still holds.
export const invitationFlags = { redeemable: true }
vi.mock('../../lib/invitations.js', async () => {
  const actual = await vi.importActual('../../lib/invitations.js')
  return {
    ...actual,
    ...invitationsApi,
    get INVITATIONS_REDEEMABLE() {
      return invitationFlags.redeemable
    },
  }
})

export const { default: App } = await import('../../App.jsx')

// The REAL pure halves, for building #50's expected snapshot the same way
// refresh() does — through the mocked modules these would be the same
// functions, but importActual says so instead of relying on it.
export const actualAnnounce = await vi.importActual('../../lib/announce.js')
export const actualCapacity = await vi.importActual('../../lib/capacity.js')

/**
 * Render and let the boot effect settle inside act().
 *
 * App asks the server whether this device has joined before it can decide what
 * to show, so every render resolves at least one promise. Asserting before that
 * lands would be testing the loading state by accident.
 */
/**
 * Render the app and, since #47, optionally walk to the surface under test.
 *
 * The split surface opens by default (the charter's decision of 2026-08-06), so
 * a test whose subject is the roster or the chore screen needs one tap to reach
 * it. Passing the tab's label rather than reaching into state is deliberate: the
 * navigation is itself criterion 11, so a helper that set the view directly
 * would quietly stop covering the thing every one of these tests walks past.
 *
 * Nothing else about the tests below changed. Where one of them now reads
 * `renderApp('Who')`, the assertion underneath it is the one it always had.
 */
export const renderApp = async (surface) => {
  await act(async () => void render(<App />))
  if (surface) {
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: surface })))
  }
}

beforeEach(() => {
  backend.hasSupabaseConfig = true
  // #165 — every test starts on a device that has chosen nothing.
  //
  // There was no reset here before this story because nothing in the app wrote
  // to storage, so there was nothing to leak. #165 makes a switch persist, and
  // the leak is immediate and silent: a test that switches household leaves the
  // choice behind, the NEXT test boots straight into that household, and its
  // fixtures describe one household while its assertions read another. Found
  // exactly that way — three tests that passed alone failed in the full run,
  // and the failures read as app bugs rather than as pollution.
  window.localStorage.clear()
  Object.values(api).forEach((fn) => fn.mockReset())
  authSettingsApi.readGoogleSignIn.mockReset()
  authSettingsApi.readGoogleSignIn.mockResolvedValue(true)
  signInStateApi.listSignInStates.mockReset()
  signInStateApi.listSignInStates.mockResolvedValue([])
  Object.values(choresApi).forEach((fn) => fn.mockReset())
  Object.values(capacityApi).forEach((fn) => fn.mockReset())
  Object.values(captureApi).forEach((fn) => fn.mockReset())
  Object.values(exclusionsApi).forEach((fn) => fn.mockReset())
  Object.values(calendarApi).forEach((fn) => fn.mockReset())
  calendarApi.listCalendarConnections.mockResolvedValue([])
  calendarApi.completeConnect.mockResolvedValue({ ok: true })
  calendarApi.listBusyWeeks.mockResolvedValue([])
  // #480 — no prior weeks read, which with the fixtures' undated members is
  // no history at all; the #480 tests give their members a `created_at`.
  calendarApi.listBusyHistory.mockResolvedValue([])
  calendarApi.fetchBusyWeek.mockResolvedValue({ ok: true })
  calendarApi.disconnectCalendar.mockResolvedValue({ ok: true, memberId: 'm1', revoked: true })
  // #101 — nothing imported yet, which is the ordinary state; the import tests
  // override this.
  calendarApi.listCalendarImports.mockResolvedValue([])
  calendarApi.fetchCalendarEvents.mockResolvedValue({ ok: true, events: [] })
  calendarApi.recordCalendarImport.mockResolvedValue({ id: 'i1' })
  exclusionsApi.listExclusions.mockResolvedValue([])
  exclusionsApi.excludeMember.mockResolvedValue(undefined)
  exclusionsApi.allowMember.mockResolvedValue(undefined)
  capacityApi.listCapacity.mockResolvedValue([])
  capacityApi.setCapacity.mockResolvedValue(undefined)
  capacityApi.clearCapacity.mockResolvedValue(undefined)
  reassignApi.reassignHousehold.mockReset()
  reassignApi.reassignHousehold.mockResolvedValue({ applied: 0, assignments_version: 1 })
  Object.values(announceApi).forEach((fn) => fn.mockReset())
  // No seen-marker row yet — the ordinary first-look state, which announces
  // nothing. Tests about the announcement override this.
  announceApi.readSplitSeen.mockResolvedValue(null)
  announceApi.writeSplitSeen.mockResolvedValue(undefined)
  announceApi.dismissFairnessNote.mockResolvedValue(undefined)
  choresApi.listChores.mockResolvedValue([])
  // #353 — no list yet, which is the ordinary first open of the Shop tab.
  Object.values(shoppingApi).forEach((fn) => fn.mockReset())
  shoppingApi.shoppingClient.mockReturnValue(SHOPPING_CLIENT)
  shoppingApi.readShopping.mockResolvedValue(EMPTY_SHOPPING)
  // #359 — no finished run, which is the ordinary state of a new list. Tests
  // about the history override this.
  shoppingApi.readClosedRuns.mockResolvedValue({ runs: [], items: [] })
  shoppingApi.createList.mockResolvedValue(undefined)
  shoppingApi.renameList.mockResolvedValue(undefined)
  shoppingApi.archiveList.mockResolvedValue(undefined)
  shoppingApi.unarchiveList.mockResolvedValue(undefined)
  shoppingApi.addItem.mockResolvedValue(undefined)
  shoppingApi.removeItem.mockResolvedValue(undefined)
  shoppingApi.purchaseItem.mockResolvedValue(undefined)
  shoppingApi.unpurchaseItem.mockResolvedValue(undefined)
  shoppingApi.finishRun.mockResolvedValue(undefined)
  // Nothing missed and nothing skipped, which is the ordinary open. Tests
  // about the notice and the failure path override this.
  choresApi.catchUpRepeats.mockResolvedValue({ created: 0, skipped: 0 })
  choresApi.addChore.mockResolvedValue(undefined)
  choresApi.addChores.mockResolvedValue([])
  choresApi.updateChore.mockResolvedValue(undefined)
  choresApi.removeChore.mockResolvedValue(undefined)
  choresApi.recordActualMinutes.mockResolvedValue(undefined)
  // A session by default, because most tests are about a signed-in person. The
  // signed-OUT case is now a first-class state rather than a failure, and it has
  // its own describe below.
  api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
  api.listHouseholds.mockResolvedValue([])
  api.listMembers.mockResolvedValue([])
  api.currentUserId.mockResolvedValue('person-a')
  api.signIn.mockResolvedValue({ user: { id: 'person-a' } })
  api.signUpOrganizer.mockResolvedValue({
    session: { user: { id: 'person-a' } },
    needsConfirmation: false,
  })
  // #440 — a sign-out ENDS the session, the way auth-js does: the next
  // `getSession()` finds none. It used to resolve and leave the session in
  // place, which was harmless while a sign-out re-read the household and is
  // not now that it remounts the app: the fresh boot asks `currentSession()`,
  // and a fake that still answers with a session boots the last person back in.
  api.signOut.mockImplementation(async () => {
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
  })
  // #440 — gone exactly when the fake holds no session, the ordinary answer.
  // The offline-past-expiry case (a null session AND an error) is set by the
  // tests about it.
  api.sessionIsGone.mockImplementation(async () => (await api.currentSession()) == null)
  signedOutListeners = []
  api.onSignedOut.mockImplementation((listener) => {
    signedOutListeners.push(listener)
    return unsubscribeSignedOut
  })
  // #430 — nobody has a household pending deletion unless a test says so.
  api.householdDeletionStatus.mockResolvedValue([])
  api.requestHouseholdDeletion.mockResolvedValue({})
  api.restoreHousehold.mockResolvedValue({})
  api.leaveHousehold.mockResolvedValue({ accountDeleted: false, warning: null })
  api.deleteAccount.mockResolvedValue({ deleted: true, revokeFailed: false })
  api.transferHousehold.mockResolvedValue({})
  // #342 — a channel that opens and can be closed, and nothing arrives on it
  // unless a test pushes something through the handlers it recorded.
  realtimeApi.subscribeToHousehold.mockReset()
  realtimeApi.subscribeToHousehold.mockImplementation(() => ({ close: vi.fn() }))
  // #172 — no invitation outstanding, which is the ordinary state. The mint
  // hands back a code from the real alphabet so a test reading it off the screen
  // reads a string the app could actually have produced.
  Object.values(invitationsApi).forEach((fn) => fn.mockReset())
  invitationsApi.listInvitations.mockResolvedValue([])
  invitationsApi.mintInvitation.mockResolvedValue({
    code: 'k7m3qp4rwn',
    invitation: { id: 'inv-1', household_id: 'h1' },
  })
  invitationsApi.withdrawInvitation.mockResolvedValue(undefined)
  invitationFlags.redeemable = true
})

afterEach(() => {
  vi.clearAllMocks()
})

// #342 — the REAL debounce constant, through the same importActual the mock
// spreads, so the wait below is the app's and not a number copied here.
export const actualRealtime = await vi.importActual('../../lib/realtime.js')

export const HOUSEHOLD_ONE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Placeholder Household',
  timezone: 'America/New_York',
  organizer_member_id: 'm1',
  created_at: '2026-01-01T00:00:00Z',
}
export const HOUSEHOLD_TWO = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Placeholder Other Household',
  timezone: 'America/New_York',
  organizer_member_id: 'm9',
  created_at: '2026-02-01T00:00:00Z',
}
