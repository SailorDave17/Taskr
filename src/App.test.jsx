import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The shell's own assertions (heading, fairness rule, build stamp) survive from
// #4 unchanged — they are what makes a deploy observable. What changed in #5 is
// everything between: the page is now a function of whether this device has
// joined a household, answered by the server on every load.
//
// Names are synthetic — see #19.

const backend = { hasSupabaseConfig: true }

const api = {
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
}

// #34. Mocked separately from household.js because it is a separate module, and
// the pure validators are kept real (importActual below) so a test cannot pass
// against a stub that disagrees with the rules the form actually enforces.
const choresApi = {
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
const captureApi = {
  extractCapacity: vi.fn(),
  // #213 — the chore half, stubbed for the same reason: `proposeChores` is
  // pure and has its own tests; what App owes is the WIRING.
  extractChores: vi.fn(),
}

const capacityApi = {
  listCapacity: vi.fn(),
  setCapacity: vi.fn(),
  clearCapacity: vi.fn(),
}

// #49 — the whole module is stubbed, including its exported constant: the
// orchestrator reads the server through its own client calls, and this suite's
// getSupabase throws on purpose. What App owes is WHEN it runs, which is
// exactly what a stub records.
const reassignApi = {
  reassignHousehold: vi.fn(),
  planReassignment: vi.fn(),
  REASSIGN_MAX_ATTEMPTS: 3,
}

// #50 — only the two IMPURE seen-marker functions are stubbed. `splitSnapshot`
// and `announcementFrom` stay real for the standing reason: pure, with their
// own tests, and a stub of either could disagree with the arithmetic the bars
// render from — which is the exact disagreement AC 4 forbids.
const announceApi = {
  readSplitSeen: vi.fn(),
  writeSplitSeen: vi.fn(),
  dismissFairnessNote: vi.fn(),
}

// #37 — only the three IMPURE exclusion functions are stubbed. `isExcluded`,
// `excludedMemberIds` and `eligibleMembers` stay real for the reason the
// capacity mock gives: they are pure, they have their own tests, and a stub of
// them could disagree with the single implementation those tests assert.
const exclusionsApi = {
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
const calendarApi = {
  listCalendarConnections: vi.fn(),
  completeConnect: vi.fn(),
  // #96 — the two impure ones. `busyWeekFor` and `busyComputedLabel` stay REAL
  // (importActual below), for the standing reason: pure, own tests, and a stub
  // could disagree with the matching rule the roster depends on — which is the
  // rule AC 1's trigger is built out of.
  listBusyWeeks: vi.fn(),
  fetchBusyWeek: vi.fn(),
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

vi.mock('./lib/supabase.js', () => ({
  get hasSupabaseConfig() {
    return backend.hasSupabaseConfig
  },
  getSupabase: () => {
    throw new Error('App must not reach the client directly; it goes through lib/household.js')
  },
}))

vi.mock('./lib/chores.js', async () => {
  const actual = await vi.importActual('./lib/chores.js')
  return { ...actual, ...choresApi }
})

vi.mock('./lib/capacity.js', async () => {
  const actual = await vi.importActual('./lib/capacity.js')
  return { ...actual, ...capacityApi }
})

vi.mock('./lib/capture.js', async () => {
  const actual = await vi.importActual('./lib/capture.js')
  return { ...actual, ...captureApi }
})

vi.mock('./lib/exclusions.js', async () => {
  const actual = await vi.importActual('./lib/exclusions.js')
  return { ...actual, ...exclusionsApi }
})

vi.mock('./lib/calendar.js', async () => {
  const actual = await vi.importActual('./lib/calendar.js')
  return { ...actual, ...calendarApi }
})

vi.mock('./lib/reassign.js', () => reassignApi)

vi.mock('./lib/announce.js', async () => {
  const actual = await vi.importActual('./lib/announce.js')
  return { ...actual, ...announceApi }
})

vi.mock('./lib/household.js', async () => {
  // findClaimedMember is pure and has its own tests, so the real one is used
  // rather than a stub that could disagree with it.
  const actual = await vi.importActual('./lib/household.js')
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
const shoppingApi = {
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
const SHOPPING_CLIENT = { fake: 'shopping client' }
const EMPTY_SHOPPING = { lists: [], runs: [], items: [] }

vi.mock('./lib/shopping.js', async () => {
  const actual = await vi.importActual('./lib/shopping.js')
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
const realtimeApi = {
  subscribeToHousehold: vi.fn(),
}
vi.mock('./lib/realtime.js', async () => {
  const actual = await vi.importActual('./lib/realtime.js')
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
const invitationsApi = {
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
const invitationFlags = { redeemable: true }
vi.mock('./lib/invitations.js', async () => {
  const actual = await vi.importActual('./lib/invitations.js')
  return {
    ...actual,
    ...invitationsApi,
    get INVITATIONS_REDEEMABLE() {
      return invitationFlags.redeemable
    },
  }
})

const { default: App } = await import('./App.jsx')

// The REAL pure halves, for building #50's expected snapshot the same way
// refresh() does — through the mocked modules these would be the same
// functions, but importActual says so instead of relying on it.
const actualAnnounce = await vi.importActual('./lib/announce.js')
const actualCapacity = await vi.importActual('./lib/capacity.js')

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
const renderApp = async (surface) => {
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
  Object.values(choresApi).forEach((fn) => fn.mockReset())
  Object.values(capacityApi).forEach((fn) => fn.mockReset())
  Object.values(captureApi).forEach((fn) => fn.mockReset())
  Object.values(exclusionsApi).forEach((fn) => fn.mockReset())
  Object.values(calendarApi).forEach((fn) => fn.mockReset())
  calendarApi.listCalendarConnections.mockResolvedValue([])
  calendarApi.completeConnect.mockResolvedValue({ ok: true })
  calendarApi.listBusyWeeks.mockResolvedValue([])
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
  api.signOut.mockResolvedValue(undefined)
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

describe('the shell, unchanged from #4', () => {
  it('renders the product name as the page heading', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { level: 1, name: 'Taskr' })).toBeInTheDocument()
  })

  it('states the fairness rule the charter is built on', async () => {
    await renderApp()
    expect(screen.getByText(/proportional to what each person actually has/i)).toBeInTheDocument()
  })

  it('stamps the running build so a deploy is observable from the browser', async () => {
    await renderApp()
    const stamp = screen.getByTestId('build-commit')
    expect(stamp).toBeInTheDocument()
    expect(stamp.textContent.replace(/^build\s+/, '')).not.toBe('')
  })
})

describe('when the build has no backend', () => {
  it('says so, instead of a network error that reads like an outage', async () => {
    backend.hasSupabaseConfig = false
    await renderApp()

    expect(await screen.findByRole('region', { name: /no backend configured/i })).toBeInTheDocument()
    // And it does not attempt a session read it cannot possibly complete.
    expect(api.currentSession).not.toHaveBeenCalled()
  })
})

describe('when nobody is signed in', () => {
  // #154 — the first screen a session-less person gets is a SIGN-IN screen.
  // Until this story it was two cards of equal weight, "Start a household" on
  // the left, and every returning housemate on a new phone was offered a
  // household they already had. Starting one is now a link under the sign-in
  // form, and the create-account half of it is its own submit.

  const startLink = () => screen.getByRole('button', { name: /start a household/i })

  /** Take the secondary route and fill the organizer's own credential. */
  const fillAccountForm = () => {
    fireEvent.click(startLink())
    fireEvent.change(screen.getByLabelText(/your email/i), {
      target: { value: 'alex@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/your password/i), {
      target: { value: 'longenough' },
    })
  }
  const submitAccount = () =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name: /create account/i })))
  const nameTheHousehold = async () => {
    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /create household/i })),
    )
  }

  it('asks for an email and a password first, and offers to start a household as a link', async () => {
    // AC 1. The household form is NOT on this screen — a person with no
    // session is not shown a household-name box, which is the defect this
    // story is named for.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(startLink()).toHaveClass('button--link')
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
  })

  it('asks the server nothing at all — signed out is a state, not a failure', async () => {
    // #62's reversal. This test used to assert the opposite shape: that the app
    // signed the DEVICE in anonymously BEFORE reading, so boot always ended with
    // an identity. Now there is no identity to mint, and the reads are skipped
    // rather than attempted-and-empty.
    //
    // Skipped deliberately, not incidentally: a signed-out read would be
    // REFUSED since 0017 (#186), and before that it would have succeeded and
    // returned nothing — so "signed out" and "your household disappeared"
    // would render identically, and the second reading is both wrong and the
    // more alarming one.
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(api.currentSession).toHaveBeenCalled()
    expect(api.listHouseholds).not.toHaveBeenCalled()
    expect(api.listMembers).not.toHaveBeenCalled()
  })

  it('creating an account creates no household in the same submit, and says the account needs confirming', async () => {
    // AC 3 and AC 5. `mailer_autoconfirm: false` on the live project means the
    // signup returns no session — the ORDINARY outcome, not a fault — and a
    // household created in the same submit would be created by nobody, since
    // `create_household` claims the organizer's row to `auth.uid()`.
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockResolvedValue({ session: null, needsConfirmation: true })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    fillAccountForm()
    await submitAccount()

    expect(api.signUpOrganizer).toHaveBeenCalledWith({
      email: 'alex@example.com',
      password: 'longenough',
    })
    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirmation-note')).toHaveTextContent(/account exists/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // And NO re-read as `anon`: there is no session to read with, 0017 would
    // refuse it, and the refusal would have been reported over the top of a
    // signup that succeeded. This is why the signup does not go through
    // `mutate`.
    expect(api.listHouseholds).not.toHaveBeenCalled()
    // Back on the sign-in form, which is where the confirmed person goes next.
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
  })

  it('an account that arrives already signed in is offered the household half next, in its own submit', async () => {
    // Confirmation OFF (a local stack, not the live project): `signUp` returns
    // a session, so the app re-reads and finds a person with no household.
    // The household is still a SEPARATE submit — AC 5 holds whichever way the
    // signup came back.
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockResolvedValue({
      session: { user: { id: 'person-a' } },
      needsConfirmation: false,
    })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    fillAccountForm()
    await submitAccount()

    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()

    await nameTheHousehold()

    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
    expect(api.signUpOrganizer).toHaveBeenCalledTimes(1)
  })

  it('a refused signup shows its reason and creates nothing', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signUpOrganizer.mockRejectedValue(new Error('User already registered'))
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    fillAccountForm()
    await submitAccount()

    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i)
  })

  it('signed in with no household is offered the household half, and never the signup again', async () => {
    // AC 4 and AC 6. Account made, household not: two durable steps with no
    // transaction, and since #154 the state every confirmed organizer passes
    // through on the live project. The household form, the signed-in copy and
    // Sign out — and no signup, because calling `signUp` again for an address
    // that now exists is the dead end #62 found.
    api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
    api.listHouseholds.mockResolvedValue([])
    api.currentUserId.mockResolvedValue('person-a')
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })
    expect(screen.getByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()

    await nameTheHousehold()

    expect(api.signUpOrganizer).not.toHaveBeenCalled()
    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
  })

  it('signs an existing member in and shows their household without asking anything further', async () => {
    // AC 2. The sign-in is the whole of it: the re-read after it finds the one
    // household and the person is looking at it — no second screen, nothing
    // typed twice. The fake sign-in flips the fixtures the way a real one
    // flips the server's answers.
    api.currentSession.mockResolvedValue(null)
    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.listHouseholds.mockResolvedValue([{
        id: 'h1',
        name: 'Placeholder Household',
        timezone: 'America/New_York',
      }])
      api.listMembers.mockResolvedValue([
        { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
      ])
      return { user: { id: 'person-a' } }
    })
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^sign in$/i })))

    expect(api.signIn).toHaveBeenCalledWith({ email: 'kid@example.com', password: '4821' })
    // The household's surfaces are up, and nothing onboarding-shaped remains.
    expect(await screen.findByRole('navigation', { name: /household surfaces/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/household name/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
  })
})

describe('#304 — Continue with Google, from the sign-in screen', () => {
  it('AC 1: the control is on the sign-in screen and starts the Google flow through the data layer', async () => {
    api.currentSession.mockResolvedValue(null)
    api.signInWithGoogle.mockResolvedValue(undefined)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /continue with google/i })),
    )

    expect(api.signInWithGoogle).toHaveBeenCalledTimes(1)
    // Not routed through the password path, and no re-read as `anon`: the page
    // is leaving for Google, and a refresh here would be refused by 0017 and
    // painted over a sign-in that is working.
    expect(api.signIn).not.toHaveBeenCalled()
    expect(api.listHouseholds).not.toHaveBeenCalled()
  })

  it('AC 3: a Google account matching nobody lands signed in with no household, and nothing is minted', async () => {
    // What the app does with the session Supabase hands back for a Google
    // address that is nobody's sign-in address: a fresh auth user, no roster
    // row, no household. That is #154's signed-in-with-no-household state,
    // and invitation redemption (#173/#191) is what later attaches it — not
    // this screen, which offers to START one and creates nothing unasked.
    api.currentSession.mockResolvedValue({
      user: { id: 'google-person', app_metadata: { provider: 'google', providers: ['google'] } },
    })
    api.currentUserId.mockResolvedValue('google-person')
    api.listHouseholds.mockResolvedValue([])
    api.listMembers.mockResolvedValue([])
    await renderApp()

    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create household/i })).toBeInTheDocument()
    expect(api.createHousehold).not.toHaveBeenCalled()
    expect(api.addMember).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })
})

describe('when the signed-in person belongs to a household', () => {
  // `timezone` is `not null default 'UTC'` since 0005, so a household row always
  // carries one. #36's load figures resolve capacity for a PERIOD, and
  // periodStartFor refuses to guess a zone rather than silently using the
  // phone's — so a fixture without it is a fixture the database cannot produce.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    ])
  })

  /**
   * A member's name is on screen TWICE since #36 — once in the roster and once
   * in the chore card's load list — so a bare findByText is ambiguous and these
   * queries are scoped to the roster region deliberately. Scoping rather than
   * switching to findAllByText: the claim these tests make is "the ROSTER is
   * showing", and a count of two names anywhere on the page would go on passing
   * if the roster disappeared and the load list rendered the same person twice.
   */
  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('shows the roster rather than the sign-in screen', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(inRoster().getByText('Placeholder One')).toBeInTheDocument()
    // #166 re-aimed this assertion, and the reason is worth keeping. It read
    // `queryByRole('button', { name: /create household/i })` — using the
    // onboarding form's BUTTON LABEL as the way to say "the onboarding screen
    // is not showing". That worked while the label was unique to that screen,
    // and #166 puts a second control with the same words on the roster, where
    // it legitimately belongs. Loosening the query or dropping the assertion
    // would both have been wrong: the property this test is about — a joined
    // person does not see the onboarding screen — is still exactly right and
    // still worth guarding. So it now names that screen by its own identity
    // (`signed-in-note` is rendered only by Onboarding's household card),
    // which no other surface can produce.
    expect(screen.queryByTestId('signed-in-note')).not.toBeInTheDocument()
  })

  // #291 — the SCOPE reaches the data layer, from the control a person presses.
  //
  // This is the reachability half, and it is the half that was missing. The
  // library's `signOut()` defaults to `scope: 'global'`, which the unit test
  // now catches; but a unit test calls the function directly and cannot answer
  // "does the button on the roster pass anything at all?" — cairn's
  // `exported-is-not-reachable`. So these walk from the tab to the tap.
  it('signs out of this device only from the ordinary control', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
  })

  it('signs out everywhere only through the confirmed control', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' })),
    )
    expect(api.signOut).not.toHaveBeenCalled()
    await act(
      async () =>
        void fireEvent.click(screen.getByRole('button', { name: 'Sign out on every device?' })),
    )
    expect(api.signOut).toHaveBeenCalledWith({ everywhere: true })
  })

  // AC 3: the roster is read from the server on load. If it were cached
  // locally, a passing "survives a restart" check would be indistinguishable
  // from a device that merely remembered.
  //
  // #165 AC 4 REWROTE this test, and the rewrite is the criterion. It used to
  // assert that `taskr.household` and `taskr.members` were both absent from
  // storage — two specific KEYS — under a name claiming the app reads "not from
  // storage" at all. #165 makes that name false in the letter and leaves it
  // true in the substance: this device now remembers WHICH household was
  // chosen, and remembers nothing else.
  //
  // The cheap move was to leave the assertions alone. They would have gone on
  // passing, because #165's key is neither of the two they name — and the test
  // would then have been green while its own title described a property the app
  // no longer had. That is the move the criterion forbids by name, so the test
  // is rewritten to the property that SURVIVES: the household row and the
  // roster are never cached, and the only thing on this device is a pointer.
  //
  // #165 AC 5 pins what must not be lost in the rewrite — that the two reads
  // actually happened on this load. The criterion names `api.currentHousehold`;
  // #164 replaced it with `api.listHouseholds`, which is the same read under
  // the name it now has.
  it('reads the household and roster from the server on every load, caching neither', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    // AC 5 — the guarantee this test has always existed for.
    expect(api.listHouseholds).toHaveBeenCalled()
    expect(api.listMembers).toHaveBeenCalled()

    // The property that survives, asserted over EVERYTHING this device stored
    // rather than over two names it might have used. A future story that cached
    // the roster under a third key would pass the old assertions and fails
    // these.
    const stored = Object.fromEntries(
      Object.keys(window.localStorage).map((k) => [k, window.localStorage.getItem(k)]),
    )
    expect(stored['taskr.household']).toBeUndefined()
    expect(stored['taskr.members']).toBeUndefined()
    // Nothing anywhere in storage carries the household's name or a member's:
    // a cache under any key is a cache.
    const everything = Object.values(stored).join(' ')
    expect(everything).not.toContain('Placeholder Household')
    expect(everything).not.toContain('Placeholder One')
  })

  // #165 AC 1's other half, and the reason the test above can be honest about
  // "only the CHOICE is stored": a person who has never switched household has
  // never made a choice, so this device stores nothing at all. Nothing writes
  // on a plain load — which is also what keeps #210's "a reload starts clean"
  // reading `localStorage.length === 0`.
  it('stores nothing at all for somebody who has never chosen a household', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(window.localStorage.length).toBe(0)
  })

  // #159 AC 1 / AC 4 - WHICH household App names, not merely that it read.
  //
  // The mutation pass is what produced these. Every assertion in this file about
  // the reads was `toHaveBeenCalled()` or a call count, so App could have passed
  // the wrong household id, a stale one, or nothing at all and nothing here
  // would have gone red. App is the ONLY place the household is chosen - the
  // data layer takes it as an argument now - so that was the one level at which
  // the story's whole claim was untested.
  it('names the active household on every read that takes one', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(api.listMembers).toHaveBeenCalledWith(household.id)
    expect(choresApi.listChores).toHaveBeenCalledWith(household.id)
  })

  it('scopes the member-keyed reads by the roster it just read, not by everything', async () => {
    // member_capacity, chore_exclusions and calendar_connections withhold
    // household_id and are scoped from the already-scoped MEMBER set (#157 AC
    // 4). That makes the roster read load-bearing for three other reads, and
    // the ORDER in refresh() load-bearing with it - a detail no other test here
    // would notice going wrong.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const memberIds = ['m1']
    expect(exclusionsApi.listExclusions).toHaveBeenCalledWith(memberIds)
    expect(calendarApi.listCalendarConnections).toHaveBeenCalledWith(memberIds)
    const capacityCall = capacityApi.listCapacity.mock.calls.at(-1)
    expect(capacityCall?.[1]).toEqual(memberIds)
  })

  it('marks the person signed in on this phone, from the live auth id', async () => {
    await renderApp('Who')
    expect(await screen.findByText(/· you/)).toBeInTheDocument()
  })

  it('re-reads from the server after a change, rather than patching what it has', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = api.listMembers.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /refresh/i })))

    await waitFor(() => expect(api.listMembers.mock.calls.length).toBeGreaterThan(readsBefore))
  })

  // -------------------------------------------------------------------------
  // #163 — the household is NAMED in the shell, above the tabs, on every
  // surface. The roster card already carried the name on the Who tab; the
  // claim here is the shell's, so every query below is scoped to the shell's
  // own element rather than to "the name appears somewhere", which the Who
  // tab would satisfy with the shell element deleted.
  // -------------------------------------------------------------------------

  const shellName = () => screen.getByText(household.name, { selector: '.shell__household' })

  it('names the household above the tabs on every surface (#163 AC 1, AC 7)', async () => {
    await renderApp()
    // The default surface first — the one with NO roster card, so this is the
    // assertion that reddens when the shell element is removed and nothing
    // else on the page happens to say the name.
    const nav = screen.getByRole('navigation', { name: /household surfaces/i })
    const above = () =>
      Boolean(shellName().compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(above(), 'the name is not above the tab strip on the split').toBe(true)

    for (const surface of ['Chores', 'Who', 'Done', 'Shop']) {
      await act(async () => void fireEvent.click(screen.getByRole('button', { name: surface })))
      expect(above(), `the name is not above the tab strip on ${surface}`).toBe(true)
    }
  })

  it('reads as information, not as a control to pick another household (#163 AC 4)', async () => {
    await renderApp()
    const name = shellName()
    expect(name.tagName).toBe('P')
    expect(name.closest('button, a, [role="button"], [role="combobox"], select')).toBeNull()
    expect(screen.queryByRole('button', { name: household.name })).not.toBeInTheDocument()
  })

  it('shows the edited name after the roster re-reads, with no reload (#163 AC 5)', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(shellName()).toBeInTheDocument()

    // The organizer renamed it on another device; the next read returns the
    // new row. The shell must follow the re-read that every write already
    // triggers — the same refresh() path — rather than remembering the name
    // it booted with.
    const renamed = { ...household, name: 'Placeholder Household Renamed' }
    api.listHouseholds.mockResolvedValue([renamed])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /refresh/i })))

    expect(
      await screen.findByText(renamed.name, { selector: '.shell__household' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(household.name, { selector: '.shell__household' })).not.toBeInTheDocument()
  })
})

describe('when the backend cannot be reached', () => {
  it('shows the reason rather than an empty household', async () => {
    api.currentSession.mockRejectedValue(new Error('Failed to fetch'))
    await renderApp()

    expect(await screen.findByRole('region', { name: /could not reach the household/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/failed to fetch/i)
    // Critically, not the sign-in screen: offering "create a household" against
    // a backend that is refusing would send the organizer round a loop. The
    // distinction is sharper since #62, because a signed-out phone ALSO shows
    // that screen — so an unreachable backend must not be mistaken for one.
    expect(screen.queryByRole('button', { name: /create household/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #160 — who you are, and whether you organise, WITHIN the active household
//
// One person, two households — the state 0009 made representable. person-a
// ORGANIZES household A (their claimed row there is A's organizer_member_id)
// and is a PLAIN MEMBER of household B. `isOrganizer` must be true when A is
// active and false when B is active, asserted in BOTH directions because a
// check that is always false satisfies the negative arm trivially.
//
// These live at the App level because App is the only place `me` and
// `isOrganizer` are derived — findClaimedMember stays REAL here (the
// household.js mock keeps it), so a mutation in the identity layer reddens
// these, not just its unit tests.
// ---------------------------------------------------------------------------

describe('#160 — identity and organizer within the active household', () => {
  const householdA = {
    id: 'household-a',
    name: 'Placeholder Household',
    organizer_member_id: 'm-a1',
    timezone: 'America/New_York',
  }
  const householdB = {
    id: 'household-b',
    name: 'Placeholder Other Household',
    organizer_member_id: 'm-b1',
    timezone: 'America/New_York',
  }
  // In each roster, one row is claimed by person-a. B's roster puts that row
  // FIRST so that in the merged-roster tests below the FOREIGN claimed row is
  // the one an unscoped match would return.
  const rosterA = [
    { id: 'm-a1', household_id: 'household-a', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm-a2', household_id: 'household-a', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' },
  ]
  const rosterB = [
    { id: 'm-b2', household_id: 'household-b', display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm-b1', household_id: 'household-b', display_name: 'Placeholder Other Organizer', weekly_minutes: 200, claimed_by: 'person-b' },
  ]

  beforeEach(() => {
    // Scoped, the way the real listMembers behaves since #159: the roster of
    // the household that was asked for. The merged-roster tests below override
    // this on purpose.
    api.listMembers.mockImplementation(async (id) =>
      id === householdA.id ? rosterA : id === householdB.id ? rosterB : [],
    )
  })

  it('AC 5 / AC 3 positive: with their organized household active, the organizer-only controls are offered', async () => {
    api.listHouseholds.mockResolvedValue([householdA])
    await renderApp('Who')

    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    // Per-row too: giving somebody ELSE a sign-in is the organizer-only act.
    expect(screen.getByTestId('provision-m-a2')).toBeInTheDocument()
  })

  it('AC 4 / AC 3 negative: a plain member of the active household gets no organizer-only control on any row', async () => {
    api.listHouseholds.mockResolvedValue([householdB])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    // The identity RESOLVED — they are somebody here, on their own row. Without
    // this, the absence below would also pass for `me === null`, which is a
    // different and worse state (nobody, rather than not-the-organizer).
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder Three')
    // ...and NO row offers an organizer-only control. Queried across the whole
    // page rather than one named row, because "any row" is the criterion.
    expect(screen.queryByTestId('provisioning-note')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId(/^provision-/)).toHaveLength(0)
  })

  it('AC 2: `me` resolves within the household on screen even off a roster that spans both', async () => {
    // The data-layer regression #159 exists to prevent, handed to the identity
    // layer on purpose: a merged roster with person-a's FOREIGN claimed row
    // first, so an unscoped match returns the wrong member. #159's own tests
    // pin what listMembers returns; this one asserts the identity layer does
    // not LEAN on that. Resolving `me` from the unscoped list is the mutation
    // this must redden (AC 7): unscoped, `me` becomes m-b2, `isOrganizer` goes
    // false, and both assertions below fail.
    api.listMembers.mockImplementation(async () => [...rosterB, ...rosterA])
    api.listHouseholds.mockResolvedValue([householdA])
    await renderApp('Who')

    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder One')
  })

  it('AC 3: the household on screen and the identity come from the SAME read', async () => {
    // The households read answers A, then B, then A… — the two-household coin
    // toss #159 removed from the data layer, made deterministic. Every refresh
    // (boot, and arriving on Who re-reads) must derive the household state AND
    // the roster scope from its OWN single read: a refresh that drew them from
    // two reads pairs one household's roster with the other's identity, `me`
    // resolves to nobody, and the badge below has no row to land on (AC 7's
    // second mutation).
    let calls = 0
    api.listHouseholds.mockImplementation(async () => [++calls % 2 ? householdA : householdB])
    await renderApp('Who')

    // Which household won depends only on how many refreshes ran, so read it
    // off the roster read's own last call rather than assuming the count.
    const lastScoped = api.listMembers.mock.calls.at(-1)[0]
    const expectedRow = lastScoped === householdA.id ? 'Placeholder One' : 'Placeholder Three'
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent(expectedRow)
  })
})

describe('#172 — the invitation card, through App', () => {
  // `person-a` ORGANISES one household and merely BELONGS to the other — #160's
  // shape, and AC 6's whole subject: the control must follow the organizer
  // role in the ACTIVE household, not the person. Reusing #160's names so the
  // #19 vocabulary needs nothing new.
  const HOME = {
    id: 'household-a',
    name: 'Placeholder Household',
    organizer_member_id: 'm-a1',
    timezone: 'America/New_York',
  }
  const AWAY = {
    id: 'household-b',
    name: 'Placeholder Other Household',
    organizer_member_id: 'm-b1',
    timezone: 'America/New_York',
  }
  const rosterHome = [
    { id: 'm-a1', household_id: HOME.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm-a2', household_id: HOME.id, display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' },
  ]
  const rosterAway = [
    { id: 'm-b2', household_id: AWAY.id, display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm-b1', household_id: AWAY.id, display_name: 'Placeholder Other Organizer', weekly_minutes: 200, claimed_by: 'person-b' },
  ]
  const invitationRow = (id) => ({
    id,
    household_id: HOME.id,
    created_by_member_id: 'm-a1',
    created_at: '2026-09-10T19:04:00.000Z',
    expires_at: '2099-09-17T19:04:00.000Z',
    withdrawn_at: null,
    redeemed_at: null,
    redeemed_by_member_id: null,
  })

  const switcher = () => screen.getByRole('combobox', { name: /^household$/i })
  const switchTo = async (id) =>
    act(async () => void fireEvent.change(switcher(), { target: { value: id } }))
  const click = async (element) => act(async () => void fireEvent.click(element))

  beforeEach(() => {
    api.listMembers.mockImplementation(async (id) =>
      id === HOME.id ? rosterHome : id === AWAY.id ? rosterAway : [],
    )
    invitationsApi.mintInvitation.mockResolvedValue({
      code: 'k7m3qp4rwn',
      invitation: { id: 'inv-1', household_id: HOME.id },
    })
  })

  it('AC 1 / AC 3 — reads the organizer’s invitations for the household on screen, and offers the card', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-9')])
    await renderApp('Who')

    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
    expect(invitationsApi.listInvitations).toHaveBeenCalledWith(HOME.id)
    expect(screen.getByTestId('invitation-inv-9')).toBeInTheDocument()
  })

  it('AC 5 — a plain member of the active household gets no card, and App never asks for the rows', async () => {
    api.listHouseholds.mockResolvedValue([AWAY])
    await renderApp('Who')
    // The identity RESOLVED — they are somebody here — so the absence below is
    // "not the organizer" and not "nobody", which is a different state.
    const badge = await screen.findByText(/· you/)
    expect(badge.closest('li')).toHaveTextContent('Placeholder Three')

    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create an invitation code/i })).not.toBeInTheDocument()
    // The read is not made at all. The policy would answer it with nothing, so
    // this is the round trip #351 priced, not the guard — the guard is proven
    // in invitationMint.pglite.test.js through the exact statement.
    expect(invitationsApi.listInvitations).not.toHaveBeenCalled()
  })

  it('AC 6 — the card follows the organizer role in the ACTIVE household, not the person', async () => {
    api.listHouseholds.mockResolvedValue([HOME, AWAY])
    await renderApp('Who')
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()

    await switchTo(AWAY.id)
    // Same person, same session — and in the household they merely belong to,
    // no card and no read on its behalf.
    await waitFor(() => expect(api.listMembers).toHaveBeenCalledWith(AWAY.id))
    await waitFor(() => expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument())
    expect(invitationsApi.listInvitations).not.toHaveBeenCalledWith(AWAY.id)

    await switchTo(HOME.id)
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
  })

  it('AC 2 — minting names the household on screen and the organizer’s own row in it, then shows the code', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')

    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))

    // The ARGUMENTS, not the call: a mint naming the first household by name, or
    // somebody else's member row, is the fault #159 measured on `addMember`.
    expect(invitationsApi.mintInvitation).toHaveBeenCalledWith({
      householdId: HOME.id,
      createdByMemberId: 'm-a1',
    })
    expect(await screen.findByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
    // The code lands together with its row, because it is set after the re-read.
    expect(screen.getByTestId('invitation-inv-1')).toBeInTheDocument()
  })

  it('AC 2 — a refused mint shows the refusal and no code', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')

    invitationsApi.mintInvitation.mockRejectedValue(new Error('creating the invitation: permission denied'))
    await click(screen.getByRole('button', { name: /create an invitation code/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
  })

  it('AC 4 — withdrawing the invitation whose code is on screen takes the code away with it', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    invitationsApi.listInvitations.mockResolvedValue([])
    const item = screen.getByTestId('invitation-inv-1')
    await click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    await click(within(item).getByRole('button', { name: /withdraw this code\?/i }))

    expect(invitationsApi.withdrawInvitation).toHaveBeenCalledWith('inv-1')
    // A withdrawn code is dead; leaving it on screen would invite somebody to
    // read out a code the server now refuses.
    await waitFor(() => expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument())
    expect(screen.queryByTestId('invitation-inv-1')).not.toBeInTheDocument()
  })

  it('AC 4 — withdrawing a DIFFERENT invitation leaves the shown code where it is', async () => {
    // The other direction of the same condition. Without it, a version that
    // cleared the code on ANY withdrawal would pass the test above.
    api.listHouseholds.mockResolvedValue([HOME])
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-2')])
    await renderApp('Who')
    await screen.findByTestId('invitation-inv-2')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1'), invitationRow('inv-2')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    const older = screen.getByTestId('invitation-inv-2')
    await click(within(older).getByRole('button', { name: /withdraw the code created/i }))
    await click(within(older).getByRole('button', { name: /withdraw this code\?/i }))

    expect(invitationsApi.withdrawInvitation).toHaveBeenCalledWith('inv-2')
    await waitFor(() => expect(screen.queryByTestId('invitation-inv-2')).not.toBeInTheDocument())
    expect(screen.getByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
  })

  it('AC 2 — a code minted for one household does not survive a switch, even back to it', async () => {
    // "Even back to it" is the discriminating half. Leaving the other household
    // hides the card by the ROLE gate whatever the state holds, so only coming
    // back shows whether the code was CLEARED or merely out of sight.
    api.listHouseholds.mockResolvedValue([HOME, AWAY])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    await switchTo(AWAY.id)
    await waitFor(() => expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument())
    await switchTo(HOME.id)
    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
  })

  it('AC 2 — the code can be hidden once it has been passed on', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    // Create is hidden while the code is up (design-bar re-measure), so the
    // only route to a second code runs through this button.
    expect(screen.queryByRole('button', { name: /create an invitation code/i })).not.toBeInTheDocument()
    await click(screen.getByRole('button', { name: /hide the code/i }))
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create an invitation code/i })).toBeInTheDocument()
  })

  it('AC 2 — the shown code does not survive signing out and back in on the same device', async () => {
    // #165 AC 7's reason: on a shared tablet the next person to sign in must
    // not find somebody else's invitation code on their screen. The harder case
    // is the one tested — the SAME organizer back into the SAME household — so
    // the role gate would show the card again either way, and only a CLEARED
    // code is absent rather than merely out of sight while signed out.
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    api.signOut.mockImplementation(async () => {
      api.currentUserId.mockResolvedValue(null)
      api.listHouseholds.mockResolvedValue([])
    })
    await click(screen.getByRole('button', { name: /^sign out$/i }))
    await screen.findByRole('button', { name: /^sign in$/i })

    api.signIn.mockImplementation(async () => {
      api.currentUserId.mockResolvedValue('person-a')
      api.listHouseholds.mockResolvedValue([HOME])
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument()
  })

  it('the flag — no card and no read while an invitation cannot yet be redeemed', async () => {
    // Owner decision at the review escalation, 2026-09-10: the card is wired
    // only while this is true. It WAS false from #172 until #173 shipped
    // redemption, so a promotion of develop between them could not put an
    // unspendable code in front of real organizers; the gate stays as the
    // record of that coupling, and this test forces it off to prove it holds.
    invitationFlags.redeemable = false
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    // Positive control: this person IS the organizer here (the note is
    // organizer-only), so the absence below is the flag's and not the role's.
    expect(await screen.findByTestId('provisioning-note')).toBeInTheDocument()
    expect(screen.queryByTestId('invitations-card')).not.toBeInTheDocument()
    expect(invitationsApi.listInvitations).not.toHaveBeenCalled()
  })

  it('review — a mint that commits but whose re-read fails still shows the code', async () => {
    // review-fanout's headline, three lenses: the code used to be read off
    // `mutate`'s return, which a failed re-read never produces, so the only
    // copy was thrown away while its row stayed live.
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    let committed = false
    invitationsApi.mintInvitation.mockImplementation(async () => {
      committed = true
      return { code: 'k7m3qp4rwn', invitation: { id: 'inv-1', household_id: HOME.id } }
    })
    api.listMembers.mockImplementation(async (id) => {
      if (committed) throw new Error('loading the roster: the network went away')
      return id === HOME.id ? rosterHome : []
    })

    await click(screen.getByRole('button', { name: /create an invitation code/i }))

    expect(await screen.findByTestId('minted-code-value')).toHaveTextContent('k7m3qp4rwn')
    // Beside the read's error, which is the honest pair: the code worked, the
    // re-read did not.
    expect(screen.getByRole('alert')).toHaveTextContent(/network went away/i)
  })

  it('review — a withdrawal that commits but whose re-read fails still takes the code away', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    let withdrawn = false
    invitationsApi.withdrawInvitation.mockImplementation(async () => {
      withdrawn = true
    })
    api.listMembers.mockImplementation(async (id) => {
      if (withdrawn) throw new Error('loading the roster: the network went away')
      return id === HOME.id ? rosterHome : []
    })
    const item = screen.getByTestId('invitation-inv-1')
    await click(within(item).getByRole('button', { name: /withdraw the code created/i }))
    await click(within(item).getByRole('button', { name: /withdraw this code\?/i }))

    expect(invitationsApi.withdrawInvitation).toHaveBeenCalledWith('inv-1')
    await waitFor(() => expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/network went away/i)
  })

  it('review — a code withdrawn from another device leaves this screen on the next refresh', async () => {
    api.listHouseholds.mockResolvedValue([HOME])
    await renderApp('Who')
    await screen.findByTestId('invitations-card')
    invitationsApi.listInvitations.mockResolvedValue([invitationRow('inv-1')])
    await click(screen.getByRole('button', { name: /create an invitation code/i }))
    await screen.findByTestId('minted-code-value')

    // The organizer's tablet withdrew it; this phone learns on its next read.
    invitationsApi.listInvitations.mockResolvedValue([])
    const roster = screen.getByRole('region', { name: /who is in the household/i })
    await click(within(roster).getByRole('button', { name: /^refresh$/i }))

    await waitFor(() => expect(screen.queryByTestId('minted-code')).not.toBeInTheDocument())
    // Nothing on THIS device withdrew anything.
    expect(invitationsApi.withdrawInvitation).not.toHaveBeenCalled()
  })

  it('review — switching between two households you organise never shows the first one’s codes under the second', async () => {
    const OTHER = {
      id: 'household-c',
      name: 'Placeholder Other Household',
      organizer_member_id: 'm-c1',
      timezone: 'America/New_York',
    }
    const rosterOther = [
      { id: 'm-c1', household_id: OTHER.id, display_name: 'Placeholder One', weekly_minutes: 90, claimed_by: 'person-a' },
      { id: 'm-c2', household_id: OTHER.id, display_name: 'Placeholder Two', weekly_minutes: 30, claimed_by: null },
    ]
    api.listHouseholds.mockResolvedValue([HOME, OTHER])
    api.listMembers.mockImplementation(async (id) =>
      id === HOME.id ? rosterHome : id === OTHER.id ? rosterOther : [],
    )
    // OTHER's invitation read never settles — the window the finding is about,
    // held open so the test can look inside it.
    invitationsApi.listInvitations.mockImplementation((id) =>
      id === HOME.id ? Promise.resolve([invitationRow('inv-9')]) : new Promise(() => {}),
    )
    await renderApp('Who')
    expect(await screen.findByTestId('invitation-inv-9')).toBeInTheDocument()

    await switchTo(OTHER.id)
    await waitFor(() => expect(invitationsApi.listInvitations).toHaveBeenCalledWith(OTHER.id))

    // OTHER's card, because this person organises OTHER too — and none of
    // HOME's codes under it.
    expect(screen.getByTestId('invitations-card')).toBeInTheDocument()
    expect(screen.queryByTestId('invitation-inv-9')).not.toBeInTheDocument()
  })
})

describe('#247 — a removal that succeeds while its auth half does not', () => {
  // The two-facts warning is composed in lib/household.js and TESTED there;
  // what only this level can see is App's handleRemove — that the warning is
  // surfaced at all, and surfaced AFTER the refresh, so the screen never says
  // "removed" over a roster still listing the person. Deleting the `.then`
  // that sets it must turn this red.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    organizer_member_id: 'm1',
    timezone: 'America/New_York',
  }
  const me = { id: 'm1', household_id: 'h1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }
  const target = { id: 'm2', household_id: 'h1', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: 'person-b' }

  it('shows the two-facts warning over a roster the person is already gone from', async () => {
    const warning =
      'Placeholder Two was removed from the household, but their sign-in was ' +
      'NOT deleted: This function is not configured. That account can still ' +
      'sign in until it is deleted.'
    let removed = false
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockImplementation(async () => (removed ? [me] : [me, target]))
    api.removeMember.mockImplementation(async () => {
      removed = true
      return { warning }
    })

    await renderApp('Who')
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /^Remove Placeholder Two$/ })),
    )
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /Remove Placeholder Two\?/ })),
    )

    expect(api.removeMember).toHaveBeenCalledWith('m2')
    // Both facts on screen…
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Placeholder Two was removed/)
    expect(alert).toHaveTextContent(/sign-in was NOT deleted/)
    // …and the roster agrees with the first of them: the person is gone.
    const roster = within(screen.getByRole('region', { name: /who is in the household/i }))
    expect(roster.queryByText('Placeholder Two')).not.toBeInTheDocument()
  })

  it('POSITIVE CONTROL: a removal with nothing to warn about shows no alert', async () => {
    // Without this, the assertions above could be satisfied by an App that
    // shows every removal as a warning — the state most removals end in is
    // silence, and silence has to be shown reachable.
    let removed = false
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockImplementation(async () => (removed ? [me] : [me, target]))
    api.removeMember.mockImplementation(async () => {
      removed = true
      return { warning: null }
    })

    await renderApp('Who')
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /^Remove Placeholder Two$/ })),
    )
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /Remove Placeholder Two\?/ })),
    )

    const roster = within(screen.getByRole('region', { name: /who is in the household/i }))
    expect(roster.queryByText('Placeholder Two')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #34 AC 6 — the screen re-reads from the server rather than patching state
//
// These live at the App level rather than in Chores.test.jsx on purpose: the
// re-read is App's `mutate()`, and a component test of Chores.jsx cannot see
// it. Deleting the `setChores(found ? await listChores() : [])` line from
// refresh() must turn something red, and this is that something.
// ---------------------------------------------------------------------------

describe('chores — the write path and the re-read', () => {
  // `timezone` is `not null default 'UTC'` since 0005, so a household row always
  // carries one. #36's load figures resolve capacity for a PERIOD, and
  // periodStartFor refuses to guess a zone rather than silently using the
  // phone's — so a fixture without it is a fixture the database cannot produce.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const chore = {
    id: 'c1',
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([chore])
  })

  const addChoreThroughTheForm = async () => {
    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))
  }

  it('reads the chores from the server on load', async () => {
    await renderApp()
    expect(await screen.findByText('Placeholder Chore')).toBeInTheDocument()
    expect(choresApi.listChores).toHaveBeenCalled()
  })

  it('AC 6: re-reads the chores from the server after an add, rather than patching local state', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    await addChoreThroughTheForm()

    // #159 AC 4 - App passes the household it is SHOWING. That argument is the
    // whole story at this level: without it the write went wherever an unordered
    // read pointed, which with two households need not be the one on screen.
    expect(choresApi.addChore).toHaveBeenCalledWith({
      title: 'Dishes',
      expectedMinutes: '20',
      dueOn: '2026-08-10',
      repeatKind: 'none',
      repeatWeekdays: [],
      repeatMonthday: '',
      householdId: household.id,
    })
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Order matters: a re-read issued BEFORE the write would return the old list
    // and look identical in a call count.
    expect(choresApi.addChore.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('#220: the batch confirm goes through addChores with the household on screen, then re-reads', async () => {
    choresApi.addChores.mockResolvedValue([{ ok: true }])
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /add several at once/i })),
    )
    fireEvent.change(screen.getByLabelText(/title for chore 1/i), {
      target: { value: 'sweep the porch' },
    })
    fireEvent.change(screen.getByLabelText(/expected minutes for chore 1/i), {
      target: { value: '15' },
    })
    fireEvent.change(screen.getByLabelText(/due date for chore 1/i), {
      target: { value: '2026-08-10' },
    })

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /add these chores/i })),
    )

    // #159 AC 4's rule, applied to the new write: the household THIS SCREEN is
    // showing travels with the rows, in the second argument the data layer
    // spreads last so no row can override it.
    expect(choresApi.addChores).toHaveBeenCalledWith(
      [{ title: 'sweep the porch', expectedMinutes: '15', dueOn: '2026-08-10' }],
      { householdId: household.id },
    )
    // One mutate() around the whole pass: a single re-read, issued after it.
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(choresApi.addChores.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('AC 6: re-reads after an edit', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /edit placeholder chore/i })))
    fireEvent.change(screen.getByLabelText(/name for placeholder chore/i), {
      target: { value: 'Dishes and counters' },
    })

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

    expect(choresApi.updateChore).toHaveBeenCalled()
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 6: re-reads after a delete', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /remove placeholder chore/i })))

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /remove placeholder chore\?/i })))

    expect(choresApi.removeChore).toHaveBeenCalledWith('c1')
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('#305: "Didn’t happen" goes through missChore with the chore on screen, then re-reads', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /say placeholder chore did not happen/i })),
    )

    expect(choresApi.missChore).toHaveBeenCalledWith('c1')
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Written before it is re-read, as every other write here is.
    expect(choresApi.missChore.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('#305: "Put it back" on the Done tab goes through unmissChore, then re-reads', async () => {
    choresApi.listChores.mockResolvedValue([{ ...chore, missed_at: '2026-08-25T09:00:00Z' }])
    await renderApp('Done')
    const back = await screen.findByRole('button', {
      name: /put placeholder chore back on the list — it was marked not done/i,
    })

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(back))

    expect(choresApi.unmissChore).toHaveBeenCalledWith('c1')
    expect(choresApi.missChore).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 6: the write goes through lib/chores.js, never the Supabase client directly', async () => {
    // The supabase.js mock at the top of this file throws if App reaches it, so
    // a component calling the client directly fails here rather than silently
    // working. This asserts the positive half: the data layer WAS used.
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')
    await addChoreThroughTheForm()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
  })

  it('does not go to the server at all when the form value is one the database would refuse', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))

    expect(choresApi.addChore).not.toHaveBeenCalled()
    // Assert OUR sentence, not merely the absence of a call. Measured
    // 2026-08-08: with noValidate removed this test stayed green, because the
    // browser's own constraint validation also blocks the submit — so the
    // absence was produced by a neighbour and the test did not discriminate.
    expect(screen.getByRole('alert')).toHaveTextContent(/at least a minute/i)
  })
})

// ---------------------------------------------------------------------------
// #46 — setting this week's capacity by hand.
//
// The write path and the re-read, from App's side. What the CONTROL looks like
// is Roster.test.jsx's; what the data layer sends is capacity.io.test.js's.
// ---------------------------------------------------------------------------

// #47 criterion 11 — the three surfaces, and moving between them.
//
// At the level only App can answer. The component tests cover what each surface
// DRAWS; these cover the three things that are App's alone:
//
//   which surface opens, the re-read on arrival, and that a round trip costs
//   neither a page load nor a re-authentication.
//
// The route ENUMERATION — that every view the state machine can hold is offered
// by the tab strip — is in gate.test.js, which can see the file this one has
// mocked away.
describe('moving between surfaces — #47 criterion 11', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
    ])
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  /**
   * jsdom's own `location.assign` is unimplemented, so calling it emits a
   * jsdomError rather than doing anything — which means "was the browser
   * navigated?" cannot be asked of the real one. Replaced for this describe,
   * and restored after, exactly as the calendar describe does.
   */
  let realLocation
  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search: '', assign: vi.fn() },
    })
  })
  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
  })

  it('opens on the split — the charter decision of 2026-08-06', async () => {
    // "The load surface opens by default, with the roster reachable from it."
    // The thing judged at arm's length has to be the thing on screen.
    await renderApp()
    expect(screen.getByRole('region', { name: /the split/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /who is in the household/i })).not.toBeInTheDocument()
  })

  it('reaches the roster from the split, and the split from the roster', async () => {
    await renderApp()
    await tab('Who')
    expect(screen.getByRole('region', { name: /who is in the household/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /the split/i })).not.toBeInTheDocument()

    await tab('Split')
    expect(screen.getByRole('region', { name: /the split/i })).toBeInTheDocument()
  })

  it('re-reads the household from the server on arrival, rather than showing what it cached', async () => {
    // The criterion, in the form that would actually bite: another phone edits
    // the roster while this one is looking at the split. Arriving on the roster
    // must show the edit, and it only can if arrival performs a read.
    api.listMembers.mockResolvedValueOnce([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
    ])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
    ])

    await renderApp()
    await tab('Who')

    expect(screen.getByText('Placeholder Two')).toBeInTheDocument()
  })

  it('POSITIVE CONTROL: the second person is genuinely absent from the first read', async () => {
    // Without this the assertion above passes against an app that never
    // re-reads, provided the fixture happened to contain both people all along
    // — which is what an unarmed mock would do.
    api.listMembers.mockResolvedValueOnce([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
    ])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60 },
    ])

    await renderApp()
    expect(screen.queryByText('Placeholder Two')).not.toBeInTheDocument()
  })

  it('reads every surface’s data on arrival, not only the roster', async () => {
    // The split divides capacity and the chore screen lists chores, so a read
    // that fetched members alone would leave two of the three surfaces stale.
    // `refresh()` is one call for all of it, and this pins that arrival uses it
    // rather than something narrower.
    await renderApp()
    const before = {
      members: api.listMembers.mock.calls.length,
      chores: choresApi.listChores.mock.calls.length,
      capacity: capacityApi.listCapacity.mock.calls.length,
    }

    await tab('Chores')

    expect(api.listMembers.mock.calls.length).toBeGreaterThan(before.members)
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before.chores)
    expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(before.capacity)
  })

  it('costs no page load and no re-authentication', async () => {
    // "without a full page reload and without re-entering a join code". There
    // is no join code any more — #62 replaced it with per-person sign-in — so
    // the surviving claim is that a round trip never returns anybody to the
    // onboarding screen, and never navigates the browser.
    await renderApp()
    await tab('Who')
    await tab('Chores')
    await tab('Split')

    expect(globalThis.location.assign).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(api.signIn).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: /the split/i })).toBeInTheDocument()
  })

  it('marks the surface you are on, so the tabs are not five identical buttons', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Who' })).not.toHaveAttribute('aria-current')

    await tab('Who')
    expect(screen.getByRole('button', { name: 'Who' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Split' })).not.toHaveAttribute('aria-current')

    // #302 AC 4 — the fourth tab is marked the same way.
    await tab('Done')
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Who' })).not.toHaveAttribute('aria-current')

    // #353 — and the fifth.
    await tab('Shop')
    expect(screen.getByRole('button', { name: 'Shop' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Done' })).not.toHaveAttribute('aria-current')
  })

  it('#353 AC 2: arriving on Shop re-reads everything, and the shopping read names the household on screen AFTER the roster read', async () => {
    await renderApp()
    const before = {
      members: api.listMembers.mock.calls.length,
      chores: choresApi.listChores.mock.calls.length,
      capacity: capacityApi.listCapacity.mock.calls.length,
      shopping: shoppingApi.readShopping.mock.calls.length,
    }

    await tab('Shop')

    expect(screen.getByRole('region', { name: 'Shop' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /the split/i })).not.toBeInTheDocument()
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(before.members)
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before.chores)
    expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(before.capacity)
    expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(before.shopping)
    // WHICH household — #159's rule — and the client App was handed. The
    // three reads inside are shopping.io.test.js's; what only this level can
    // see is that App named `found.id` and nothing else.
    expect(shoppingApi.readShopping).toHaveBeenLastCalledWith(SHOPPING_CLIENT, household.id)
    // After the roster read of the same refresh, the order the issue names.
    const rosterOrder = api.listMembers.mock.invocationCallOrder.at(-1)
    const shoppingOrder = shoppingApi.readShopping.mock.invocationCallOrder.at(-1)
    expect(shoppingOrder).toBeGreaterThan(rosterOrder)
  })

  it('#302 AC 4: arriving on Done re-reads everything, as every other tab does', async () => {
    await renderApp()
    const before = {
      members: api.listMembers.mock.calls.length,
      chores: choresApi.listChores.mock.calls.length,
      capacity: capacityApi.listCapacity.mock.calls.length,
    }

    await tab('Done')

    expect(screen.getByRole('region', { name: 'Done' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /the split/i })).not.toBeInTheDocument()
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(before.members)
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before.chores)
    expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(before.capacity)
  })

  it('#302 AC 1: the chore tab’s "done this week" line leads to Done, re-reading on the way', async () => {
    // One finished just now, so it falls in whatever capacity week App derives
    // from the real clock, and one outstanding. The chore tab must show the
    // outstanding one, count the finished one on its line, and not render it.
    choresApi.listChores.mockResolvedValue([
      {
        id: 'c1',
        household_id: 'h1',
        title: 'Placeholder Chore',
        expected_minutes: 20,
        due_on: '2026-08-10',
        completed_at: null,
        completed_by_member_id: null,
      },
      {
        id: 'c2',
        household_id: 'h1',
        title: 'Placeholder Other Chore',
        expected_minutes: 30,
        due_on: '2026-08-10',
        completed_at: new Date().toISOString(),
        completed_by_member_id: 'm1',
      },
    ])
    await renderApp('Chores')
    expect(screen.getByText('Placeholder Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Other Chore')).not.toBeInTheDocument()
    expect(screen.getByTestId('done-this-week')).toHaveTextContent(/done this week/)

    const before = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByTestId('done-this-week')))

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
    // Through goTo, not a bare setView: the arrival re-read (criterion 11)
    // holds for this route onto the surface as it does for the tab.
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(before)
  })

  it('offers no surfaces at all until there is a household to look at', async () => {
    // A tab strip above the sign-in screen is three buttons that lead nowhere.
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    expect(screen.queryByRole('button', { name: 'Split' })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #353 — the Shop tab: the write path, the re-read, and WHICH household.
//
// What the surface DRAWS is Shopping.test.jsx's. These cover what only App can
// answer: that the create, add and remove go through the data layer and are
// followed by a re-read; that a refused write reaches the strip and patches
// nothing; and that the household on screen is the one the read names.
// ---------------------------------------------------------------------------
describe('#353 — the Shop tab, from App', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
  }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const list = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const run = {
    id: 'r1',
    list_id: 'l1',
    household_id: 'h1',
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  }
  const milk = {
    id: 'i1',
    run_id: 'r1',
    household_id: 'h1',
    name: 'Milk',
    note: null,
    added_by_member_id: 'm2',
    added_at: '2026-09-05T01:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  }
  const emptyList = { lists: [list], runs: [run], items: [] }
  const withMilk = { lists: [list], runs: [run], items: [milk] }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  const shop = () => screen.getByRole('region', { name: 'Shop' })

  it('AC 3: with no list, opening the tab writes nothing; Create goes through createList in the household on screen, then re-reads', async () => {
    await renderApp('Shop')
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('Groceries')
    expect(shoppingApi.createList).not.toHaveBeenCalled()

    // The next read returns the list the tap made, with its empty open run.
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/create list/i)

    expect(shoppingApi.createList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.createList).toHaveBeenCalledWith(SHOPPING_CLIENT, household.id, 'Groceries')
    // Written, then re-read — the full refresh, not a patch from the answer.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.createList.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )
    expect(api.listMembers.mock.calls.length).toBeGreaterThan(1)
    // And the screen is what the re-read said: the list, empty, above its form.
    expect(screen.queryByLabelText(/^list name$/i)).not.toBeInTheDocument()
    const empty = within(shop()).getByText(/nothing to buy yet/i)
    const form = screen.getByLabelText(/^item$/i).closest('form')
    expect(empty.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('AC 4: adding an item goes through addItem with the run, the name and null for an omitted note, re-reads, clears the form, and names the adder from the roster', async () => {
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    await renderApp('Shop')
    expect(within(shop()).getByText(/nothing to buy yet/i)).toBeInTheDocument()

    shoppingApi.readShopping.mockResolvedValue(withMilk)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await tab(/add item/i)

    expect(shoppingApi.addItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.addItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'r1', 'Milk', null)
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.addItem.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )
    // The item is on screen from the RE-READ (its adder is m2, which the form
    // never knew), the form is clear, and the adder is the roster's word.
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('added by Robin')
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 4: an empty item name is refused with a sentence before any call', async () => {
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/add item/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(shoppingApi.addItem).not.toHaveBeenCalled()
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
  })

  it('AC 5: Remove goes through removeItem with the item, then re-reads, and the item is gone', async () => {
    shoppingApi.readShopping.mockResolvedValue(withMilk)
    await renderApp('Shop')
    expect(within(shop()).getByText('Milk')).toBeInTheDocument()

    shoppingApi.readShopping.mockResolvedValue(emptyList)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/remove milk/i)

    expect(shoppingApi.removeItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.removeItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(within(shop()).queryByText('Milk')).not.toBeInTheDocument()
    expect(within(shop()).getByText(/nothing to buy yet/i)).toBeInTheDocument()
  })

  it('AC 5: bought on another phone between render and tap — the delete affects nothing, the re-read shows it bought, and no error is shown', async () => {
    shoppingApi.readShopping.mockResolvedValue(withMilk)
    await renderApp('Shop')
    expect(within(shop()).getByRole('button', { name: /remove milk/i })).toBeInTheDocument()

    // The policy admits only an unbought item, so the delete resolves having
    // touched zero rows — which is what a resolved `removeItem` IS here — and
    // the re-read returns the row with the other phone's stamp on it.
    shoppingApi.readShopping.mockResolvedValue({
      ...withMilk,
      items: [{ ...milk, purchased_at: '2026-09-05T02:00:00Z', purchased_by_member_id: 'm1' }],
    })
    await tab(/remove milk/i)

    expect(shoppingApi.removeItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent(/bought/)
    expect(within(row).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 6: a refused add reaches the strip outside the list, and nothing local is patched', async () => {
    shoppingApi.readShopping.mockResolvedValue(emptyList)
    await renderApp('Shop')
    shoppingApi.addItem.mockRejectedValue(new Error('adding the item: run already closed'))
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await tab(/add item/i)

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('adding the item: run already closed')
    expect(alert.closest('ul, li, form')).toBeNull()
    // No re-read followed a failed write, the item is not on the list, and the
    // form still holds what was typed — the two-arm handler patched nothing.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(within(shop()).queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^item$/i)).toHaveValue('Milk')
    expect(within(shop()).getByText(/nothing to buy yet/i)).toBeInTheDocument()
  })

  it('AC 7: with the seeded person in two households, the Shop tab shows only the ACTIVE household’s lists and items', async () => {
    // The #160 fixture shape: person-a holds a member row in both, and each
    // household has its own list with its own item. The fake scopes by the
    // household id it is handed — so an App that named the wrong household,
    // or none, draws the wrong list or nothing.
    const householdA = { id: 'household-a', name: 'Placeholder Household', timezone: 'America/New_York' }
    const householdB = { id: 'household-b', name: 'Placeholder Other Household', timezone: 'America/New_York' }
    const shopA = {
      lists: [{ ...list, id: 'la', household_id: 'household-a', name: 'Groceries' }],
      runs: [{ ...run, id: 'ra', list_id: 'la', household_id: 'household-a' }],
      items: [{ ...milk, id: 'ia', run_id: 'ra', household_id: 'household-a', name: 'Milk' }],
    }
    const shopB = {
      lists: [{ ...list, id: 'lb', household_id: 'household-b', name: 'Hardware' }],
      runs: [{ ...run, id: 'rb', list_id: 'lb', household_id: 'household-b' }],
      items: [{ ...milk, id: 'ib', run_id: 'rb', household_id: 'household-b', name: 'Bread' }],
    }
    api.listMembers.mockImplementation(async (id) =>
      id === householdA.id
        ? [{ id: 'm-a1', household_id: 'household-a', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }]
        : id === householdB.id
          ? [{ id: 'm-b1', household_id: 'household-b', display_name: 'Placeholder Three', weekly_minutes: 120, claimed_by: 'person-a' }]
          : [],
    )
    shoppingApi.readShopping.mockImplementation(async (_client, id) =>
      id === householdA.id ? shopA : id === householdB.id ? shopB : EMPTY_SHOPPING,
    )

    api.listHouseholds.mockResolvedValue([householdA])
    await renderApp('Shop')
    expect(within(shop()).getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    expect(within(shop()).getByText('Milk')).toBeInTheDocument()
    expect(within(shop()).queryByText('Bread')).not.toBeInTheDocument()
    expect(within(shop()).queryByText('Hardware')).not.toBeInTheDocument()

    // The active household changes; the next re-read (arriving on the tab
    // again) must draw B's list and nothing of A's.
    api.listHouseholds.mockResolvedValue([householdB])
    await tab('Shop')
    expect(within(shop()).getByRole('heading', { level: 3 })).toHaveTextContent('Hardware')
    expect(within(shop()).getByText('Bread')).toBeInTheDocument()
    expect(within(shop()).queryByText('Milk')).not.toBeInTheDocument()
    expect(within(shop()).queryByText('Groceries')).not.toBeInTheDocument()
    expect(shoppingApi.readShopping).toHaveBeenLastCalledWith(SHOPPING_CLIENT, householdB.id)
  })

  it('AC 8 (#35 AC 9): nothing on the surface counts, ranks or scores who added what', async () => {
    shoppingApi.readShopping.mockResolvedValue({
      ...withMilk,
      items: [milk, { ...milk, id: 'i2', name: 'Eggs' }, { ...milk, id: 'i3', name: 'Bread', added_by_member_id: 'm1' }],
    })
    await renderApp('Shop')
    const text = shop().textContent
    expect(text).not.toMatch(/streak|rank|score|points|leaderboard|best|winner|most/i)
    expect(text).not.toMatch(/\b\d+\s+(items?|added|by)\b/i)
    expect(shop()).not.toHaveTextContent(/m1|m2/)
  })
})

// ---------------------------------------------------------------------------
// #355 — the tick, from App: which RPC, with which item, and what the screen
// does with the answer.
//
// This is the story's own re-read decision made visible. Every other write on
// this surface goes through `mutate()` and re-reads everything; the tick does
// not, because #351 measured that route at 6.5 s on Slow 4G against a 1 s bar.
// So the assertions here are in two halves: the happy path must NOT re-read
// (one round trip, the RPC's own row) and the refusal path MUST (the one
// moment this phone knows its picture is stale).
// ---------------------------------------------------------------------------
describe('#355 — the tick, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const list = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const run = {
    id: 'r1',
    list_id: 'l1',
    household_id: 'h1',
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  }
  const milk = {
    id: 'i1',
    run_id: 'r1',
    household_id: 'h1',
    name: 'Milk',
    note: null,
    added_by_member_id: 'm2',
    added_at: '2026-09-05T01:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  }
  const eggs = { ...milk, id: 'i2', name: 'Eggs', added_at: '2026-09-05T02:00:00Z' }
  /** What `purchase_shopping_item` returns: the same row, stamped. */
  const milkBought = {
    ...milk,
    purchased_at: '2026-09-05T05:00:00Z',
    purchased_by_member_id: 'm1',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue({ lists: [list], runs: [run], items: [milk, eggs] })
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  const shop = () => screen.getByRole('region', { name: 'Shop' })
  const rowNames = () =>
    Array.from(shop().querySelectorAll('.shopping-item__name')).map((node) => node.textContent)

  it('AC 8 + AC 9: a tick sends purchaseItem with THAT item id, and the RPC’s own row is the re-read — one round trip, no readShopping', async () => {
    await renderApp('Shop')
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    shoppingApi.purchaseItem.mockResolvedValue(milkBought)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    const rosterReadsBefore = api.listMembers.mock.calls.length

    await tab(/mark milk bought/i)

    // The RPC, named, with the item — not the run, not the first row on screen.
    expect(shoppingApi.purchaseItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.purchaseItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    // ONE round trip. The owner's decision at this story's pickup: a full
    // refresh per tick measured 6.5 s at Slow 4G against a 1 s bar.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(api.listMembers.mock.calls.length).toBe(rosterReadsBefore)
    // And the screen is what the RPC answered: the row sank below Eggs and
    // carries the stamp the SERVER wrote (m1, 05:00 UTC → 1:00 AM in New York),
    // neither of which this phone knew before the call.
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('bought by Placeholder · 1:00 AM')
    expect(row).toHaveClass('shopping-item--bought')
    expect(within(shop()).getByText('1 left to buy')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 8 + AC 4: untick sends unpurchaseItem with that item, and the cleared row it returns goes back into added order', async () => {
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [run],
      items: [milkBought, eggs],
    })
    await renderApp('Shop')
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
    shoppingApi.unpurchaseItem.mockResolvedValue(milk)
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    const boughtRow = within(shop()).getByText('Milk').closest('li')
    await act(async () =>
      void fireEvent.click(within(boughtRow).getByRole('button', { name: /not bought after all/i })),
    )

    expect(shoppingApi.unpurchaseItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.unpurchaseItem).toHaveBeenCalledWith(SHOPPING_CLIENT, 'i1')
    expect(shoppingApi.purchaseItem).not.toHaveBeenCalled()
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    // Milk was added before Eggs, so it goes back ABOVE it, and the stamp is
    // gone because the row the server returned has no stamp on it.
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    expect(within(shop()).getByText('Milk').closest('li')).not.toHaveTextContent(/bought by/)
    expect(within(shop()).getByText('2 left to buy')).toBeInTheDocument()
  })

  it('AC 8: another phone got there first — the refusal reaches the strip OUTSIDE the list, and the full re-read shows their stamp with the row in the bought half', async () => {
    await renderApp('Shop')
    shoppingApi.purchaseItem.mockRejectedValue(
      new Error('marking it bought: item already bought'),
    )
    // What the full re-read returns: the OTHER phone's stamp (m2, Robin), which
    // this phone could not have invented from its own tap.
    const theirs = { ...milk, purchased_at: '2026-09-05T04:30:00Z', purchased_by_member_id: 'm2' }
    shoppingApi.readShopping.mockResolvedValue({ lists: [list], runs: [run], items: [theirs, eggs] })
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/mark milk bought/i)

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('marking it bought: item already bought')
    expect(alert.closest('ul, li')).toBeNull()
    // The refusal is the one moment the picture is known to be stale, so THIS
    // path re-reads everything — the opposite of the happy path above.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    const row = within(shop()).getByText('Milk').closest('li')
    expect(row).toHaveTextContent('bought by Robin · 12:30 AM')
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
    // The refusal's own sentence is still what is on screen after the re-read.
    expect(within(shop()).getByRole('alert')).toHaveTextContent('item already bought')
  })

  it('AC 7: a second tap while the first tick is in flight sends nothing', async () => {
    await renderApp('Shop')
    let finish
    shoppingApi.purchaseItem.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )

    await tab(/mark milk bought/i)
    // In flight: every control on the surface is disabled, which is what makes
    // the second tap impossible rather than merely unlikely.
    expect(screen.getByRole('button', { name: /mark eggs bought/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove milk/i })).toBeDisabled()
    await tab(/mark eggs bought/i)
    expect(shoppingApi.purchaseItem).toHaveBeenCalledTimes(1)

    await act(async () => finish(milkBought))
    expect(screen.getByRole('button', { name: /mark eggs bought/i })).not.toBeDisabled()
    expect(rowNames()).toEqual(['Eggs', 'Milk'])
  })
})

// ---------------------------------------------------------------------------
// #357 — finishing the run, from App: which RPC with which argument, that it
// goes through `mutate()` (unlike the tick above), and what the screen shows
// after the re-read.
//
// The confirm itself is Shopping.test.jsx's. What only this level can answer is
// that the write is followed by a FULL re-read and that the screen is then the
// server's answer — a DIFFERENT run, carrying the items that were not bought —
// rather than anything this phone patched. The refusal half is the mirror: the
// one rejection `0033` is built to raise means another phone finished first, so
// the picture is stale and this path re-reads too.
// ---------------------------------------------------------------------------
describe('#357 — finishing a run, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const list = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const run = {
    id: 'r1',
    list_id: 'l1',
    household_id: 'h1',
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  }
  const milk = {
    id: 'i1',
    run_id: 'r1',
    household_id: 'h1',
    name: 'Milk',
    note: null,
    added_by_member_id: 'm2',
    added_at: '2026-09-05T01:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  }
  const eggs = { ...milk, id: 'i2', name: 'Eggs', added_at: '2026-09-05T02:00:00Z' }
  /** Bought on this trip, so it stays on the run being closed. */
  const boughtBread = {
    ...milk,
    id: 'i3',
    name: 'Bread',
    added_at: '2026-09-05T03:00:00Z',
    purchased_at: '2026-09-05T04:00:00Z',
    purchased_by_member_id: 'm1',
  }

  /** What `finish_shopping_run` returns and opens: the list's NEXT run. */
  const nextRun = { ...run, id: 'r2', opened_at: '2026-09-05T06:00:00Z' }
  /**
   * What the re-read then finds on it — `0033`'s copies. New ids, the
   * ORIGINAL's adder and `added_at` (which is why they are at the top), the
   * purchase columns null, and `carried_from_item_id` pointing back.
   */
  const carriedMilk = { ...milk, id: 'i4', run_id: 'r2', carried_from_item_id: 'i1' }
  const carriedEggs = { ...eggs, id: 'i5', run_id: 'r2', carried_from_item_id: 'i2' }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [run],
      items: [milk, eggs, boughtBread],
    })
  })

  const tab = (name) =>
    act(async () => void fireEvent.click(screen.getByRole('button', { name })))

  const shop = () => screen.getByRole('region', { name: 'Shop' })
  const rowNames = () =>
    Array.from(shop().querySelectorAll('.shopping-item__name')).map((node) => node.textContent)

  /** Open the confirm and take the confirming tap. */
  const finishTheRun = async () => {
    await tab(/done shopping/i)
    await tab(/^finish$/i)
  }

  it('AC 1: the first tap calls no RPC at all — the io fake records zero calls', async () => {
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/done shopping/i)

    expect(shoppingApi.finishRun).not.toHaveBeenCalled()
    // Not the read either: a question is not a round trip.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(within(shop()).getByText(/2 items not bought will carry over/)).toBeInTheDocument()
  })

  it('AC 3: the confirming tap sends finishRun with the run on screen, once, then re-reads — and the screen is the NEW run', async () => {
    await renderApp('Shop')
    expect(rowNames()).toEqual(['Milk', 'Eggs', 'Bread'])
    shoppingApi.finishRun.mockResolvedValue(nextRun)
    // The re-read the server's answer produces: the next run, holding only the
    // two that were not bought.
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [nextRun],
      items: [carriedMilk, carriedEggs],
    })
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await finishTheRun()

    expect(shoppingApi.finishRun).toHaveBeenCalledTimes(1)
    // The RUN, and the client — never the list id, which is what a second
    // phone resolving afresh would have closed.
    expect(shoppingApi.finishRun).toHaveBeenCalledWith(SHOPPING_CLIENT, 'r1')
    // Through mutate(): written, THEN re-read. Unlike the tick, which does not.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.finishRun.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )

    // The two unbought items carried, on top, unpurchased and marked; the
    // bought one is gone with the run it was bought on. #359 is where that run
    // becomes readable again — this tab does not fetch it.
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    for (const name of ['Milk', 'Eggs']) {
      const row = within(shop()).getByText(name).closest('li')
      expect(row).toHaveTextContent('from last run')
      expect(row).not.toHaveClass('shopping-item--bought')
      expect(row).not.toHaveTextContent(/bought by/)
    }
    expect(within(shop()).queryByText('Bread')).not.toBeInTheDocument()
    expect(within(shop()).getByText('2 left to buy')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The confirm is gone with the run it was about, and the tab offers the
    // next trip's control against the new run.
    expect(screen.queryByText(/carry over to the next list/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /done shopping/i })).toBeInTheDocument()
  })

  it('AC 5: another phone finished first — the refusal reaches the strip OUTSIDE the list, and the re-read shows THEIR run', async () => {
    await renderApp('Shop')
    shoppingApi.finishRun.mockRejectedValue(
      new Error('finishing the run: run already closed'),
    )
    // What the re-read finds: the run the OTHER phone opened, with the items
    // it carried — neither of which this phone could have invented.
    shoppingApi.readShopping.mockResolvedValue({
      lists: [list],
      runs: [nextRun],
      items: [carriedMilk, carriedEggs],
    })
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await finishTheRun()

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('finishing the run: run already closed')
    // Outside the list, like every other refused write on this surface.
    expect(alert.closest('ul, li')).toBeNull()
    // `mutate()` does not re-read after a failure; this path does, because a
    // refusal here means the run on screen no longer exists.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(rowNames()).toEqual(['Milk', 'Eggs'])
    expect(within(shop()).getByText('Milk').closest('li')).toHaveTextContent('from last run')
    // The refusal's own sentence is still what is on screen after the re-read.
    expect(within(shop()).getByRole('alert')).toHaveTextContent('run already closed')
  })

  it('AC 5: any other rejection leaves the run open with its items intact, and patches nothing', async () => {
    await renderApp('Shop')
    shoppingApi.finishRun.mockRejectedValue(new Error('finishing the run: not authenticated'))
    // The server state did not move, so the re-read returns what was there.
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await finishTheRun()

    expect(within(shop()).getByRole('alert')).toHaveTextContent('not authenticated')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Same run, same three rows, same order, and the bought one still bought.
    expect(rowNames()).toEqual(['Milk', 'Eggs', 'Bread'])
    expect(within(shop()).getByText('Bread').closest('li')).toHaveClass('shopping-item--bought')
    expect(within(shop()).getByText('2 left to buy')).toBeInTheDocument()
    // Nothing was marked as carried: a client that patched a finish locally
    // would have had to invent the copies.
    expect(shop()).not.toHaveTextContent(/from last run/)
  })

  it('AC 5: a re-read that itself fails leaves the refusal on screen rather than replacing it', async () => {
    await renderApp('Shop')
    shoppingApi.finishRun.mockRejectedValue(
      new Error('finishing the run: run already closed'),
    )
    shoppingApi.readShopping.mockRejectedValue(new Error('loading shopping lists: network down'))

    await finishTheRun()

    // The refusal explains what happened; a complaint about a read the person
    // did not ask for would replace the answer with a symptom.
    expect(within(shop()).getByRole('alert')).toHaveTextContent('run already closed')
    expect(screen.queryByText(/network down/)).not.toBeInTheDocument()
  })

  it('AC 1 + AC 7: every control on the surface is disabled while the finish is in flight', async () => {
    await renderApp('Shop')
    let settle
    shoppingApi.finishRun.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )

    await finishTheRun()
    expect(screen.getByRole('button', { name: /mark milk bought/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^finish$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /keep shopping/i })).toBeDisabled()
    // A second confirming tap while the first is in flight sends nothing.
    await tab(/^finish$/i)
    expect(shoppingApi.finishRun).toHaveBeenCalledTimes(1)

    await act(async () => settle(nextRun))
  })
})

describe('capacity — this week, set by hand (#46)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'device-a' },
    ])
  })

  /**
   * An override for WHATEVER week the app asks about.
   *
   * Deliberately not a hard-coded date. The period is computed from today and
   * the household's zone, so a literal is right for a few days and then silently
   * stops matching — the row comes back, `capacitiesFor` filters it out, and the
   * test fails for a reason that has nothing to do with the code. Measured:
   * the first version of this file pinned 2026-08-10 while the app computed
   * 2026-08-03, and the mismatch is what exposed the roster matching on
   * member_id alone.
   */
  const overrideThisWeek = (minutes) =>
    capacityApi.listCapacity.mockImplementation((period) =>
      Promise.resolve([
        { id: 'c1', member_id: 'm1', period_start: period, minutes, source: 'manual' },
      ]),
    )

  const openTheWeekEditor = async () => {
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set this week for placeholder one/i })),
    )
  }

  const saveMinutes = async (value) => {
    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))
  }

  it('reads this week’s overrides from the server on load', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(capacityApi.listCapacity).toHaveBeenCalled()
    // The period is a MONDAY, derived from the household's own zone. A period
    // key computed from the phone's zone would file two members of one household
    // under different weeks.
    const period = capacityApi.listCapacity.mock.calls[0][0]
    expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${period}T00:00:00Z`).getUTCDay(), 'the period must start on a Monday').toBe(1)
  })

  it('AC 4: re-reads from the SERVER after the write, rather than patching local state', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await saveMinutes('120')

    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', minutes: '120' }),
    )
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Order matters: a re-read issued BEFORE the write returns the old list and
    // is indistinguishable from a correct one in a call count alone.
    expect(capacityApi.setCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      capacityApi.listCapacity.mock.invocationCallOrder[readsBefore],
    )
  })

  it('AC 4: the write names the same period the screen was showing', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    const readPeriod = capacityApi.listCapacity.mock.calls[0][0]

    await openTheWeekEditor()
    await saveMinutes('120')

    // If these could differ, capacity would be filed into a week the household
    // is not looking at — every number stays plausible and the split responds to
    // the wrong week, which is the failure #44 AC 7 already calls invisible.
    expect(capacityApi.setCapacity.mock.calls[0][0].periodStart).toBe(readPeriod)
  })

  it('clearing an override goes through the data layer and re-reads too', async () => {
    overrideThisWeek(120)
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await act(async () =>
      void fireEvent.click(
        screen.getByRole('button', { name: /use the usual weekly minutes for placeholder one/i }),
      ),
    )

    expect(capacityApi.clearCapacity).toHaveBeenCalledWith('m1', expect.any(String))
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 6: the write goes through lib/capacity.js, never the Supabase client directly', async () => {
    // getSupabase throws in this file's mock, so reaching for it is a failure
    // rather than a silent bypass. The flow completing is the assertion.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await openTheWeekEditor()
    await saveMinutes('120')
    expect(capacityApi.setCapacity).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC 6: the manual path depends on nothing but the data layer', () => {
    // The charter's fallback principle, as a check rather than a promise: manual
    // entry must work on day one and the extraction bet (#210) is an accelerator
    // on top of it, never the only road in. If capacity.js ever grows a model
    // client, an HTTP call or a second credential, the floor has quietly become
    // the ceiling — and by then the story that would notice is the one that
    // added it.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    // './household.js' left this list with #159: capacity.js no longer
    // resolves a household for itself, the caller names it. Still asserted
    // EXACTLY rather than loosened to `toContain`, because the property is
    // that nothing NEW may appear here.
    expect(imports.sort()).toEqual(['./supabase.js'])

    // Named separately from the import list, because these arrive without an
    // import statement and the list above would not see them.
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(/)
    expect(source).not.toMatch(/openai|anthropic|api[_-]?key|Bearer /i)
  })


  // -------------------------------------------------------------------------
  // The integration this story actually delivers, and it was protected by a
  // regex alone until this test existed.
  //
  // *Measured while mutating*: changing App to `capacitiesFor(members, [], …)` —
  // the exact line #36 shipped and #46 replaced — reddened ONE assertion, and it
  // was the static grep in gate.test.js. Nothing behavioural noticed that the
  // load figures had stopped following this week, because every number on screen
  // stayed plausible. That is the failure mode #44 already calls invisible, and
  // a grep is a poor last line against it: it fails the moment the code is
  // written a different way rather than a wrong way.
  // -------------------------------------------------------------------------

  it('the split surface’s figures follow THIS WEEK, not the baseline', async () => {
    // The subject of this test moved from the chore screen to the split surface
    // in #47. The CLAIM is unchanged and is the one #46 exists for: what gets
    // divided is this week's capacity, not the stored baseline.
    overrideThisWeek(120)
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    // Baseline 300, this week 120, nothing assigned. "180 min left" would mean
    // the override reached the roster and not the allocator's input — which is
    // precisely the half-wired state this story exists to end.
    const row = screen.getByTestId('split-m1')
    expect(row).toHaveTextContent('0 of 120 min')
    expect(row).toHaveTextContent('120 min left')
    expect(row, 'the baseline must not be what the split divides').not.toHaveTextContent(
      '300 min left',
    )
  })

  it('POSITIVE CONTROL: with no override the same screen shows the baseline', async () => {
    // Without this, the assertion above passes identically if the figures were
    // broken in some other way that happened to yield 120 — and it pins that
    // the difference is the OVERRIDE rather than anything else on screen.
    capacityApi.listCapacity.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getByTestId('split-m1')).toHaveTextContent('300 min left')
  })

  it('AC 6: POSITIVE CONTROL — the import scan sees the imports that are there', () => {
    // Without this the assertion above passes identically if the regex stops
    // matching, which is how an empty result reads as a clean bill of health.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capacity.js'), 'utf8')
    // Was `toBeGreaterThan(1)`: capacity.js had two imports and #159 removed
    // one of them. The control's job is to prove the regex MATCHES, so the
    // threshold is the one that still means that.
    expect([...source.matchAll(/from\s+'([^']+)'/g)].length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // #49 — the assignments follow a capacity change on their own. What App owes
  // is WHEN the re-assignment runs and for WHICH household; what it does is
  // reassign.io.test.js's subject, and what the database enforces is
  // reassignment.pglite.test.js's.
  // -------------------------------------------------------------------------

  it('#49 AC 2: setting this week’s capacity re-assigns, nobody pressing an assign button', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await saveMinutes('120')

    // The household on screen, AFTER the write that changed it, BEFORE the
    // refresh — so the re-read that follows shows the stored result rather
    // than racing it.
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
    expect(capacityApi.setCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      reassignApi.reassignHousehold.mock.invocationCallOrder[0],
    )
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(reassignApi.reassignHousehold.mock.invocationCallOrder[0]).toBeLessThan(
      capacityApi.listCapacity.mock.invocationCallOrder[readsBefore],
    )
  })

  it('#49: clearing an override re-assigns too — a week back to normal is a capacity change', async () => {
    overrideThisWeek(120)
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await openTheWeekEditor()
    await act(async () =>
      void fireEvent.click(
        screen.getByRole('button', { name: /use the usual weekly minutes for placeholder one/i }),
      ),
    )

    expect(capacityApi.clearCapacity).toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
  })

  it('#49: a baseline edit that MOVES the minutes re-assigns; a name-only save does not', async () => {
    // Owner decision at pickup: a weekly_minutes edit is a capacity change.
    // The roster's save always sends the minutes field, so the discriminator
    // is whether the value moved — a name fix must not overwrite
    // `last_rebalance` with a run nothing prompted.
    api.updateMember.mockResolvedValue({})
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^edit$/i })))
    fireEvent.change(screen.getByLabelText(/name for placeholder one/i), {
      target: { value: 'placeholder renamed' },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))
    expect(api.updateMember).toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^edit$/i })))
    fireEvent.change(screen.getByLabelText(/weekly minutes for/i), {
      target: { value: '150' },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
  })

  it('#49 AC 7: the stored verdict reaches the split surface from the household row', async () => {
    api.listHouseholds.mockResolvedValue([{
      ...household,
      last_rebalance: {
        contested: true,
        level: true,
        reason: null,
        boundByBudget: true,
        jobsMoved: 2,
        minutesMoved: 90,
        changeBudgetMinutes: 120,
        applied_at: '2026-08-27T12:00:00Z',
      },
    }])
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    // Rendered from the STORED verdict — no allocator call could produce this
    // sentence here, because nothing on this screen knows what the last run's
    // budget did.
    expect(screen.getByTestId('rebalance-note')).toHaveTextContent(/moved 90 min/)
    expect(screen.getByTestId('rebalance-note')).toHaveTextContent(/change/)
  })
})

// #50 — the re-balance announced as an event, at the level only App can answer:
// WHEN the statement appears, when it must not, and what advances the marker
// that makes it an event seen once. The wording itself is Announcement.test.jsx's
// subject; the arithmetic is announce.test.js's. `splitSnapshot` and
// `announcementFrom` are REAL here (the mock spreads the actual module), so
// these tests exercise the same pipeline a phone would.
describe('#50 — a re-balance is announced as an event', () => {
  const APPLIED_AT = '2026-08-27T18:00:00+00:00'

  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
    last_rebalance: {
      contested: true,
      level: true,
      reason: null,
      boundByBudget: false,
      jobsMoved: 1,
      minutesMoved: 90,
      changeBudgetMinutes: 120,
      applied_at: APPLIED_AT,
    },
  }

  const members = [
    { id: 'm1', household_id: 'h1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', household_id: 'h1', display_name: 'Placeholder Two', weekly_minutes: 300, claimed_by: null },
  ]

  // The state NOW: both chores on Placeholder Two. What this member was last
  // shown (the seen fixture below): c1 on Placeholder One, whose week was then
  // 420 min — so the re-balance reads as 120 min less room and 90 min moved.
  const chores = [
    { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
    { id: 'c2', title: 'Placeholder Other Chore', expected_minutes: 50, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
  ]

  const seenEarlier = {
    member_id: 'm1',
    snapshot: {
      members: [
        { id: 'm1', minutes: 90, capacityMinutes: 420 },
        { id: 'm2', minutes: 50, capacityMinutes: 300 },
      ],
    },
    seen_rebalance_at: '2026-08-27T09:00:00+00:00',
  }

  /** The snapshot refresh() computes for these fixtures, built the same way. */
  const currentSnapshot = () =>
    actualAnnounce.splitSnapshot({
      capacities: actualCapacity.capacitiesFor(
        members,
        [],
        actualCapacity.periodStartFor(new Date(), household.timezone),
      ),
      chores,
    })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(members)
    choresApi.listChores.mockResolvedValue(chores)
  })

  it('AC 1: opening the app on a re-balance this member has not seen shows the statement', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenEarlier)
    await renderApp()

    const region = await screen.findByTestId('rebalance-announcement')
    expect(region).toHaveTextContent('Placeholder One’s week has 120 min less room')
    expect(region).toHaveTextContent('90 min of chores moved off Placeholder One’s list')
    expect(region).toHaveTextContent('Placeholder Two picked up 90 min')
  })

  it('advances the seen-marker to this re-balance when the statement is shown', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenEarlier)
    await renderApp()
    await screen.findByTestId('rebalance-announcement')

    expect(announceApi.writeSplitSeen).toHaveBeenCalledWith({
      memberId: 'm1',
      snapshot: currentSnapshot(),
      seenRebalanceAt: APPLIED_AT,
    })
  })

  it('AC 7: opened again with no further change, the statement is not shown a second time', async () => {
    // The row the write above left behind: marker at the re-balance, snapshot
    // at what the member was shown. The same open now announces nothing — and
    // writes nothing, because there is nothing new to record.
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: currentSnapshot(),
      seen_rebalance_at: APPLIED_AT,
    })
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
    expect(announceApi.writeSplitSeen).not.toHaveBeenCalled()
  })

  it('dismissing hides the statement, and a later refresh does not resurrect it', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenEarlier)
    await renderApp()
    await screen.findByTestId('rebalance-announcement')

    // The marker has advanced on the server by now; later reads see it.
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: currentSnapshot(),
      seen_rebalance_at: APPLIED_AT,
    })

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /got it/i })))
    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()

    // A tab switch re-reads everything (#47 criterion 11); the event must not
    // come back with it.
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
  })

  it('a first look announces nothing and records the baseline the next statement diffs against', async () => {
    announceApi.readSplitSeen.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
    expect(announceApi.writeSplitSeen).toHaveBeenCalledWith({
      memberId: 'm1',
      snapshot: currentSnapshot(),
      seenRebalanceAt: APPLIED_AT,
    })
  })
})

// #59 — the fairness note's dismissal, at the level only App can answer: WHOSE
// dismissal the write records, and that the standing/dismissed state comes from
// the SERVER's seen-marker row rather than from a local flag. The wording and
// the on-demand toggle are Split.test.jsx's subject.
describe('#59 — the fairness note is dismissed per member, on the server', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  const members = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null },
  ]

  const seenRow = (dismissed) => ({
    member_id: 'm1',
    snapshot: { members: [] },
    seen_rebalance_at: null,
    fairness_note_dismissed: dismissed,
  })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(members)
  })

  it('stands when this member has never dismissed it', async () => {
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getByTestId('fairness-note')).toHaveTextContent(/does not count/i)
  })

  it('does not stand when the server says this member dismissed it', async () => {
    announceApi.readSplitSeen.mockResolvedValue(seenRow(true))
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.queryByTestId('fairness-note')).toBeNull()
    expect(screen.getByRole('button', { name: /what the split counts/i })).toBeInTheDocument()
  })

  it('dismissing records THIS member and re-reads, after which the note stops standing', async () => {
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    // The server accepts the dismissal; the re-read that follows reports it.
    // Armed by changing the mock, not `mockResolvedValueOnce` — the read count
    // is refresh()'s business, not this test's (#37's lesson).
    announceApi.readSplitSeen.mockResolvedValue(seenRow(true))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /noted/i })))

    // The ARGUMENT, not just the call: the layer that chooses whose dismissal
    // this is is exactly the layer nothing else asserts about.
    expect(announceApi.dismissFairnessNote).toHaveBeenCalledWith('m1')
    expect(screen.queryByTestId('fairness-note')).toBeNull()
    expect(screen.getByRole('button', { name: /what the split counts/i })).toBeInTheDocument()
  })
})

// #37 — who cannot do a chore, at the level only App can answer.
//
// The component tests cover what the screen DRAWS; these cover the two things
// that are App's alone and that a component test cannot see, because the
// component only calls the handler it is given:
//
//   AC 9 — the exclusions come from the SERVER on every refresh, and a write is
//          followed by a re-read rather than by patching what is already here.
//   AC 3 — the write path exists at all, and reaches a person through the chore
//          screen. The route ENUMERATION is in gate.test.js, which can see the
//          files this one has mocked away.
describe('exclusions — the write path and the re-read (#37)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  const members = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 60, claimed_by: null },
  ]

  const chore = {
    id: 'c1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
    completed_at: null,
    completed_by_member_id: null,
    assigned_member_id: null,
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(members)
    choresApi.listChores.mockResolvedValue([chore])
  })

  const onScreen = () => screen.findByRole('region', { name: /what needs doing/i })

  const markUnable = async (memberId) => {
    fireEvent.change(screen.getByLabelText(/mark someone as unable to do placeholder chore/i), {
      target: { value: memberId },
    })
    await act(async () => {})
  }

  it('AC 9: reads the exclusions from the server on load', async () => {
    await renderApp('Chores')
    await onScreen()
    expect(exclusionsApi.listExclusions).toHaveBeenCalled()
  })

  it('AC 9: re-reads from the SERVER after a write, rather than patching local state', async () => {
    await renderApp('Chores')
    await onScreen()

    const readsBefore = exclusionsApi.listExclusions.mock.calls.length
    await markUnable('m2')

    // #159 AC 4 - the third argument is the household on screen.
    expect(exclusionsApi.excludeMember).toHaveBeenCalledWith('c1', 'm2', household.id)
    await waitFor(() =>
      expect(exclusionsApi.listExclusions.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 9: what another device recorded is on this screen after the re-read', async () => {
    // The whole point of re-reading rather than patching: the row this device
    // did not write arrives anyway, because the state is the server's. Asserted
    // through the RENDERED sentence, not through the mock, since a call count
    // says nothing about whether the answer reached the screen.
    // Armed by CHANGING the mock between the two assertions rather than by
    // `mockResolvedValueOnce`. The "once" form counted reads implicitly, and
    // #47 added one — arriving on a surface re-reads — so it landed on the
    // wrong read and the row was on screen before the write. This form says
    // what it means: nothing, then another device records something, then the
    // next read this device performs must show it.
    exclusionsApi.listExclusions.mockResolvedValue([])

    await renderApp('Chores')
    await onScreen()
    expect(screen.queryByText(/placeholder one cannot do this/i)).not.toBeInTheDocument()

    exclusionsApi.listExclusions.mockResolvedValue([
      { id: 'x1', chore_id: 'c1', member_id: 'm1' },
    ])
    await markUnable('m2')
    await waitFor(() =>
      expect(screen.getByText(/placeholder one cannot do this/i)).toBeInTheDocument(),
    )
  })

  it('undoing one goes through the data layer and re-reads too', async () => {
    exclusionsApi.listExclusions.mockResolvedValue([
      { id: 'x1', chore_id: 'c1', member_id: 'm2' },
    ])
    await renderApp('Chores')
    await onScreen()

    const readsBefore = exclusionsApi.listExclusions.mock.calls.length
    await act(async () =>
      void fireEvent.click(
        screen.getByRole('button', {
          name: /let placeholder two do placeholder chore again/i,
        }),
      ),
    )

    expect(exclusionsApi.allowMember).toHaveBeenCalledWith('c1', 'm2')
    await waitFor(() =>
      expect(exclusionsApi.listExclusions.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('the write goes through lib/exclusions.js, never the Supabase client directly', async () => {
    // getSupabase() throws in this file's mock, so a component reaching past the
    // data layer fails loudly here rather than shipping.
    await renderApp('Chores')
    await onScreen()
    await markUnable('m2')
    expect(screen.queryByText(/must not reach the client directly/i)).not.toBeInTheDocument()
  })

  it('a failed write reports itself and leaves the screen usable', async () => {
    exclusionsApi.excludeMember.mockRejectedValue(
      new Error('That person is already marked as unable to do this chore.'),
    )
    await renderApp('Chores')
    await onScreen()
    await markUnable('m2')

    // Scoped to the chore card. App hands the same `error` to the roster too, so
    // an unscoped query finds two nodes and fails on the count rather than on
    // the claim — and the claim is that the message lands BESIDE the control
    // that caused it, which is the repair #34 made for exactly this.
    const card = await onScreen()
    expect(await within(card).findByText(/already marked as unable/i)).toBeInTheDocument()
    // And the control is not left disabled — `mutate` clears busy in a finally,
    // so a refusal must not end with a screen nobody can use.
    expect(
      screen.getByLabelText(/mark someone as unable to do placeholder chore/i),
    ).not.toBeDisabled()
  })

  it('reads nothing when there is no household, rather than asking for another one’s rows', async () => {
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /start a household/i })
    expect(exclusionsApi.listExclusions).not.toHaveBeenCalled()
  })
})

// #95 — the calendar connection, at the level only App can answer.
//
// The component tests cover what the roster DRAWS. These cover the three things
// that belong to App and that a component test structurally cannot see:
//
//   AC 5 — the connections come from the SERVER on load, through the same
//          refresh as everything else.
//   AC 6 — Google fails, and the member is told, on an app that still works.
//   AC 3 — pressing Connect actually leaves for a Google consent URL asking for
//          the free/busy scope. `startConnect` is left REAL in this file's mock
//          precisely so this is the URL the app would really send somebody to,
//          rather than one a stub agreed to.
describe('connecting a calendar (#95)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }

  let assign
  let replaceState
  let realLocation
  let realHistory

  /**
   * Replace `location` and `history` for one test.
   *
   * jsdom's own `location.assign` is unimplemented and its `href` is not
   * writable, so a real navigation would emit a jsdomError rather than doing
   * anything — and the query string has to be on the URL BEFORE App boots, which
   * cannot be arranged with the real one either.
   */
  const atUrl = (search = '', hash = '') => {
    assign = vi.fn()
    replaceState = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      // `hash` since #304: the implicit flow's error channel is the fragment.
      value: { origin: 'https://taskr.example.test', pathname: '/', search, hash, assign },
    })
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      writable: true,
      value: { replaceState },
    })
  }

  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    realHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    globalThis.sessionStorage?.clear?.()
    atUrl('')
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
    if (realHistory) Object.defineProperty(globalThis, 'history', realHistory)
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('AC 5: reads the connections from the server on load and draws them', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([
      { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' },
    ])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.listCalendarConnections).toHaveBeenCalled()
    expect(inRoster().getByText(/calendar connected/i)).toBeInTheDocument()
  })

  it('AC 3: pressing Connect leaves for Google, asking for free/busy alone', async () => {
    // End to end through the REAL `startConnect`, so this is the URL a member
    // would actually be sent to. A stub here would assert that the app calls a
    // function, which is a fact about this test file.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(async () =>
      void fireEvent.click(inRoster().getByRole('button', { name: /connect google calendar/i })),
    )

    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.freebusy')
    // Built from where the app is running, so a preview and the custom domain
    // each ask for themselves rather than for a hard-coded host.
    expect(url.searchParams.get('redirect_uri')).toBe('https://taskr.example.test/')
  })

  it('completes the exchange when Google sends the member back, then cleans the URL', async () => {
    calendarApi.completeConnect.mockResolvedValue({ ok: true })
    atUrl('?code=the-code&state=the-state')
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(calendarApi.completeConnect).toHaveBeenCalledWith({
      code: 'the-code',
      error: null,
      state: 'the-state',
    })
    // A spent code must not survive a reload: exchanging it twice is refused by
    // Google, and that refusal reads as the connection having failed.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('reads the roster AFTER the exchange, or the screen shows the state it just changed', async () => {
    // The ordering, asserted rather than implied. `refresh()` is what puts
    // "Calendar connected" on screen, so completing afterwards would leave a
    // member who has just connected looking at a Connect button.
    const order = []
    calendarApi.completeConnect.mockImplementation(async () => {
      order.push('exchange')
      return { ok: true }
    })
    calendarApi.listCalendarConnections.mockImplementation(async () => {
      order.push('read')
      return []
    })
    atUrl('?code=the-code&state=the-state')
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })

    expect(order.indexOf('exchange')).toBeLessThan(order.indexOf('read'))
  })

  it('AC 6: says so when the exchange fails, on an app that still works', async () => {
    // The failure state AC 6 asks for. "No token row exists" is the Edge
    // Function's half and is proven in handler.test.js — nothing this side can
    // observe a table it is granted nothing on.
    calendarApi.completeConnect.mockRejectedValue(
      new Error('Google refused the connection: invalid_grant'),
    )
    atUrl('?code=spent&state=the-state')
    await renderApp()

    // Still loaded: a failed connection is not a failed app, and rendering the
    // boot-failure card here would hide a working household behind one refused
    // OAuth code.
    //
    // Asserted on the surface the person LANDS on, which since #47 is the split
    // rather than the roster. Deliberately not navigated: arriving on another
    // surface performs a successful re-read, and `mutate` clears the error strip
    // when it does — correct behaviour, and it would take the evidence with it.
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(
      /invalid_grant/,
    )
    expect(replaceState).toHaveBeenCalled()
  })

  it('AC 6: treats a refusal at Google as a failure state, without calling the function', async () => {
    // Pressing Cancel comes back as an error parameter with no code at all.
    // There is nothing to exchange, so the function must not be called — and the
    // member must still be told something, or a cancel is indistinguishable from
    // a button that did nothing.
    atUrl('?error=access_denied&state=the-state')
    await renderApp()
    await screen.findByRole('region', { name: /the split/i })

    expect(calendarApi.completeConnect).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(
      /was not connected/i,
    )
  })

  it('POSITIVE CONTROL: an ordinary load exchanges nothing and shows no complaint', async () => {
    // Without this, every assertion above is satisfied by an App that calls
    // `completeConnect` never — and by one that reports an error on every load.
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.completeConnect).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(replaceState).not.toHaveBeenCalled()
  })

  describe('#304 AC 4 — the root is shared with the Google sign-in, and the calendar’s `state` tells them apart', () => {
    // Every shape below lands on the same URL the calendar consent does.
    // Google echoes the calendar's own `state` on every calendar return and
    // Supabase's returns never carry one — so a query WITHOUT a state is not the
    // calendar's, whatever else it carries, and is never sent to
    // `calendar-connect`. The app exchanges no code at all under the implicit
    // flow (gate.test.js asserts the word is absent), so the other half of the
    // criterion — a calendar code never handed to the exchange — has nothing
    // to reach.

    it('a code with no state is nobody’s: not sent to calendar-connect, and nothing is said', async () => {
      atUrl('?code=orphan-code')
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })

      expect(calendarApi.completeConnect).not.toHaveBeenCalled()
      expect(screen.queryAllByRole('alert')).toEqual([])
    })

    it('a Supabase sign-in error in the query (no state) is a sign-in failure, not a calendar one', async () => {
      // GoTrue's bad-flow-state redirect, as probed live 2026-09-04. Before
      // #304 this read as "Google could not complete that connection", which
      // sent a person to the calendar to fix a sign-in.
      api.currentSession.mockResolvedValue(null)
      atUrl('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired')
      await renderApp()
      await screen.findByRole('button', { name: /^sign in$/i })

      expect(calendarApi.completeConnect).not.toHaveBeenCalled()
      const note = screen.getByTestId('sign-in-return')
      expect(note).toHaveTextContent(/took too long or was already used/i)
      expect(note).not.toHaveTextContent(/calendar|connection/i)
      // Spent, and stripped so a reload does not announce it twice.
      expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    })

    it('AC 5: a Google refusal in the fragment names the organizer on the sign-in screen', async () => {
      // The implicit flow's error channel. The consent screen is in Testing, so
      // an account the organizer has not registered is refused by Google; the
      // sentence says who can fix that and does not blame a password nobody
      // typed. The SHAPE here is GoTrue's documented one, not a measured
      // refusal — the provider is not enabled on the live project yet, so the
      // live half of AC 5 is the confirmation story's.
      api.currentSession.mockResolvedValue(null)
      atUrl('', '#error=access_denied&error_description=The+user+denied+access')
      await renderApp()
      await screen.findByRole('button', { name: /^sign in$/i })

      const note = screen.getByTestId('sign-in-return')
      expect(note).toHaveTextContent(/has not been opened to your account/i)
      expect(note).toHaveTextContent(/organizer/i)
      expect(note).not.toHaveTextContent(/did not match/i)
      expect(calendarApi.completeConnect).not.toHaveBeenCalled()
      expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    })

    it('the calendar’s own return — a code WITH a state — still reaches calendar-connect and only it', async () => {
      // The other side of the discriminator, so the three tests above cannot be
      // satisfied by an App that ignores every query string.
      atUrl('?code=the-code&state=the-state')
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })

      expect(calendarApi.completeConnect).toHaveBeenCalledWith({
        code: 'the-code',
        error: null,
        state: 'the-state',
      })
      expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    })

    it('a fresh attempt clears the notice about the last one', async () => {
      api.currentSession.mockResolvedValue(null)
      atUrl('', '#error=access_denied')
      await renderApp()
      await screen.findByTestId('sign-in-return')

      await act(async () =>
        void fireEvent.click(screen.getByRole('button', { name: /continue with google/i })),
      )
      expect(api.signInWithGoogle).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('sign-in-return')).not.toBeInTheDocument()
    })
  })
})

describe('#53 — the boot-time catch-up pass', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([])
  })

  it('runs BEFORE the first read, so a created occurrence is in the first list a person sees', async () => {
    await renderApp('Chores')
    await screen.findByRole('region', { name: /what needs doing/i })

    expect(choresApi.catchUpRepeats).toHaveBeenCalledTimes(1)
    // Order is the claim, not the call: catch-up after the read would show a
    // week with holes in it until the next mutation happened to refresh.
    expect(choresApi.catchUpRepeats.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[0],
    )
  })

  it('tells the household when occurrences older than the bound were skipped — AC 4', async () => {
    choresApi.catchUpRepeats.mockResolvedValue({ created: 2, skipped: 3 })
    await renderApp()

    // The REAL formatSkippedNotice words this (the mock keeps pure functions
    // real), so the sentence asserted is the sentence a person reads.
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(
      '3 repeat occurrences older than the catch-up window were skipped rather than piled onto this week.',
    )
    // Told, not alarmed: nothing failed, so the error surface stays empty.
    expect(screen.queryAllByRole('alert')).toEqual([])
  })

  it('says nothing when nothing was skipped', async () => {
    await renderApp('Chores')
    await screen.findByRole('region', { name: /what needs doing/i })
    expect(screen.queryByText(/skipped rather than piled/i)).not.toBeInTheDocument()
  })

  it('a failing pass costs the error strip, never the household', async () => {
    // The live shape of this failure: 0012 not yet pasted, so the RPC is
    // unknown to the project. Boot must degrade to a working app with the
    // failure REPORTED — a red nobody can see is how a paste stays forgotten,
    // and a boot-failure card would hide a working household behind it.
    choresApi.catchUpRepeats.mockRejectedValue(
      new Error('catching up repeats: function public.catch_up_repeats does not exist'),
    )
    await renderApp()

    // The split surface, for the reason the calendar failure above records: a
    // person lands here, and navigating elsewhere would re-read successfully
    // and clear the strip this test is about.
    await screen.findByRole('region', { name: /the split/i })
    expect(screen.getAllByRole('alert').map((el) => el.textContent).join(' ')).toMatch(
      /catching up repeats/i,
    )
  })
})

// ---------------------------------------------------------------------------
// #12 — the actual-minutes write and its re-read. At the App level for the
// standing reason: the wiring from the done row's control to the data layer,
// and the mutate() re-read after it, are both invisible to Chores.test.jsx —
// its handlers are spies, so handing the control the WRONG handler (say,
// onComplete) would leave every component test green.
// ---------------------------------------------------------------------------

describe('#12 — adjusting how long a chore took', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const doneChore = {
    id: 'c1',
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
    completed_at: '2026-08-10T15:00:00Z',
    completed_by_member_id: 'm1',
    actual_minutes: 20,
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([])
    choresApi.listChores.mockResolvedValue([doneChore])
  })

  it('saves the adjusted value through the data layer, then re-reads from the server', async () => {
    // On the Done tab since #302 — a completed row no longer renders on the
    // chore tab. The subject (the write, then the re-read) is unchanged; only
    // the arrangement moved with the row.
    await renderApp('Done')
    await screen.findByText('Placeholder Chore')

    const readsBefore = choresApi.listChores.mock.calls.length
    fireEvent.change(screen.getByLabelText('Minutes Placeholder Chore actually took'), {
      target: { value: '35' },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

    // The argument, not merely the call: a handler wired to the wrong id or a
    // string value would round-trip green through a bare toHaveBeenCalled.
    expect(choresApi.recordActualMinutes).toHaveBeenCalledWith('c1', 35)
    await waitFor(() =>
      expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(choresApi.recordActualMinutes.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })
})

describe('#284 — dealing out the work nobody has, from the split', () => {
  // The state #52's driven setup run stalled in: two people with minutes,
  // every chore entered, nothing assigned, and the household on its FIRST
  // screen. Two chores stand in for thirteen.
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const nobodyHas = [
    {
      id: 'c1',
      household_id: 'h1',
      title: 'Placeholder Chore',
      expected_minutes: 60,
      due_on: '2026-08-10',
      assigned_member_id: null,
    },
    {
      id: 'c2',
      household_id: 'h1',
      title: 'Placeholder Other Chore',
      expected_minutes: 45,
      due_on: '2026-08-10',
      assigned_member_id: null,
    },
  ]

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([
      { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 200, claimed_by: 'person-a' },
      { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 240 },
    ])
    choresApi.listChores.mockResolvedValue(nobodyHas)
  })

  const pressDealOut = async () => {
    await act(async () =>
      void fireEvent.click(await screen.findByRole('button', { name: /deal these out/i })),
    )
  }

  it('AC 1: the action runs the stored re-assignment for the household on screen, then re-reads', async () => {
    await renderApp()
    const readsBefore = choresApi.listChores.mock.calls.length
    await pressDealOut()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' })
    // Re-read from the server after the run, never patched from the response:
    // what the next device to load will see is what this one now shows.
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore)
    expect(reassignApi.reassignHousehold.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
  })

  it('AC 3: one press on the first screen — no capacity write, no per-chore assignment, no tab', async () => {
    // `renderApp()` with no surface: the split is where a joined household
    // lands (the 2026-08-06 decision), so the route is reachable with no
    // navigation at all. Nothing that a capacity edit or a Who dropdown would
    // reach is touched — the side door #52 named stays shut.
    await renderApp()
    await pressDealOut()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(capacityApi.clearCapacity).not.toHaveBeenCalled()
    expect(api.updateMember).not.toHaveBeenCalled()
    expect(choresApi.updateChore).not.toHaveBeenCalled()
  })

  it('AC 2: it is the one run a capacity change makes — no planner of its own', async () => {
    // The manual pin (#49 AC 4) is a property of `reassignHousehold`, so the
    // claim at this level is that App reached THAT and built no second path:
    // `planReassignment` is stubbed too and must stay untouched.
    await renderApp()
    await pressDealOut()
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    expect(reassignApi.planReassignment).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL: with every chore held, the split offers no such action', async () => {
    choresApi.listChores.mockResolvedValue(
      nobodyHas.map((c, i) => ({ ...c, assigned_member_id: i ? 'm2' : 'm1', assigned_source: 'manual' })),
    )
    await renderApp()
    await screen.findByTestId('split-verdict')
    expect(screen.queryByRole('button', { name: /deal these out/i })).toBeNull()
  })

  it('is disabled while the run is in flight — the tabs and this control alike', async () => {
    let finish
    reassignApi.reassignHousehold.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await renderApp()
    const button = await screen.findByRole('button', { name: /deal these out/i })
    await act(async () => void fireEvent.click(button))
    expect(button).toBeDisabled()
    await act(async () => void finish({ applied: 2, assignments_version: 1 }))
    expect(screen.getByRole('button', { name: /deal these out/i })).not.toBeDisabled()
  })

  it('a refused run reports itself on the split and leaves the control usable', async () => {
    reassignApi.reassignHousehold.mockRejectedValue(
      new Error('applying the re-assignment: the household moved'),
    )
    await renderApp()
    await pressDealOut()
    expect(await screen.findByRole('alert')).toHaveTextContent(/the household moved/i)
    expect(screen.getByRole('button', { name: /deal these out/i })).not.toBeDisabled()
  })
})

// #96 — the calendar's suggested busy minutes, at the level only App can answer.
//
// Roster.test.jsx covers what the readout DRAWS. Everything here is about the
// TRIGGER, which is the criterion with a boundary in it: AC 1 says the fetch
// happens when there is no derived row and does NOT happen when there is, and
// the two invocation-count assertions are what make that a fact rather than a
// preference. #98's refresh story owns the other side of the same boundary, so
// its counterpart tests will assert the mirror image — a row existing is
// precisely where this story stops.
describe('calendar-suggested busy minutes (#96)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = {
    id: 'c1',
    member_id: 'm1',
    scope: 'freebusy',
    connected_at: '2026-08-24T00:00:00Z',
  }
  /** A Monday. Every test that matters re-derives the week through the app's own
   * `periodStartFor`; this is only the fixture's default key. */
  const WEEK = '2026-09-07'
  const busyRow = {
    id: 'b1',
    member_id: 'm1',
    period_start: WEEK,
    busy_minutes: 320,
    event_count: 6,
    // Read NOW, not on a fixed date. This was '2026-09-08T14:00:00Z' until #98
    // — a date in the future when written — and #98 makes a row older than
    // twelve hours a TRIGGER, so on the evening of 2026-09-09 this fixture
    // would have aged across the bound and turned "does NOT fetch when a row
    // exists" into one call, on a diff that touched nothing. Every test in
    // this block is about a row EXISTING; none is about its age, and a fresh
    // timestamp is the only value that keeps it that way indefinitely.
    computed_at: new Date().toISOString(),
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('AC 1: fetches ONCE when a connected member has no row for this week', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    // The week is the app's OWN arithmetic: `periodStartFor` is real here (only
    // the impure capacity functions are stubbed), so this asserts the household
    // zone reached it rather than asserting a constant against itself.
    const [call] = calendarApi.fetchBusyWeek.mock.calls
    expect(call[0].householdId).toBe('h1')
    expect(call[0].periodStart).toBe(
      actualCapacity.periodStartFor(new Date(), household.timezone),
    )
  })

  it('AC 1: does NOT fetch when a row for this week already exists', async () => {
    // The disjoint half. Staleness — how OLD that row is — belongs entirely to
    // #98, and this story has no clause about it to get wrong. A trigger that
    // also fired on an old row would make the two stories' invocation counts
    // impossible to tell apart, which is what the criterion's wording guards.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks.mockResolvedValue([{ ...busyRow, period_start: week }])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not fetch on a screen that shows no capacity', async () => {
    // "When the capacity screen opens" is the whole clause. The app boots on the
    // split, and spending a member's Google credential for a figure that is not
    // on screen is exactly what the wording refuses.
    await renderApp()
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not fetch for a member who has connected nothing', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not fetch on a HOUSEMATE connection', async () => {
    // Owner decision, 2026-09-04: this device reads the signed-in member's own
    // calendar. A trigger keyed on "somebody in this household is connected"
    // would spend a housemate's credential on this person's app-open.
    calendarApi.listCalendarConnections.mockResolvedValue([{ ...connection, member_id: 'm2' }])
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: stays at one call when the screen is left and re-opened', async () => {
    // "Once for that week" outlives a tab switch. Each visit re-runs the effect
    // and the guard is what makes the second one silent — a guard written after
    // the await would let a re-render during the round trip start a second call.
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 4: draws the figure the server hands back, after the fetch', async () => {
    // Re-read rather than trusting the function's answer: what the next device
    // to load will see is exactly what this one now shows.
    // TWO empty reads, not one: `renderApp('Who')` refreshes at boot AND for
    // the tab, so a single `mockResolvedValueOnce([])` let the tab-switch
    // refresh hand back the row and this test passed without the effect's own
    // re-read ever being observed (review-fanout, 2026-09-04, second pass). The
    // third read is the effect's, and it is the only one that returns the row.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...busyRow, period_start: week }])
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')
    expect(calendarApi.listBusyWeeks).toHaveBeenCalledTimes(3)
  })

  it('AC 5: a calendar that cannot be read costs the suggestion and nothing else', async () => {
    calendarApi.fetchBusyWeek.mockRejectedValue(
      new Error('That calendar connection is no longer valid. Connect it again.'),
    )
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/no longer valid/),
    )
    // The app still works. This is the assertion that separates a handled
    // failure from a swallowed one: the roster is on screen and the manual
    // control is still there to use.
    expect(
      inRoster().getByRole('button', { name: /set this week for placeholder one/i }),
    ).toBeEnabled()
  })

  it('AC 5: does not retry the same week after a failure', async () => {
    // Weak on its own, and said so: the complaint render changes none of the
    // effect's dependencies, so the effect neither re-runs nor cleans up and
    // this is one call BY CONSTRUCTION. The witness that actually reaches the
    // guard is the tab-switch test directly below (review-fanout, 2026-09-04,
    // second pass: this test's first comment claimed the opposite).
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/))
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 5: still does not retry after leaving the screen and coming back', async () => {
    // The one that reaches the guard: leaving Who changes `view`, coming back
    // re-runs the effect, and only the key kept in `askedForBusy` stands
    // between that and a second Edge Function call for a week Google already
    // refused. *Measured by the refuter*: with the once-after-failure half of
    // the guard deleted, this reads "called 2 times"; every other #96 test
    // stayed green.
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/)
  })

  it('AC 5: a derived table that is not there yet does not take the app down', async () => {
    // `0030` is unapplied on the live project until somebody pastes it, and an
    // unguarded read of a missing table would fail the whole refresh — taking
    // the roster, the chores and the manual capacity path with it. This is the
    // largest instance of "the manual path is untouched".
    calendarApi.listBusyWeeks.mockRejectedValue(
      new Error('loading calendar busy minutes: relation does not exist'),
    )
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(
      inRoster().getByRole('button', { name: /set this week for placeholder one/i }),
    ).toBeEnabled()
  })

  it('reads this week figures from the server on every refresh', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    expect(calendarApi.listBusyWeeks).toHaveBeenCalledWith(week, ['m1', 'm2'])
  })

  it('asks for nothing at all when this device has joined no household', async () => {
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('region', { name: /start a household/i })
    expect(calendarApi.listBusyWeeks).not.toHaveBeenCalled()
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // review-fanout, 2026-09-04 — the four the first suite could not see
  // -------------------------------------------------------------------------
  //
  // Every mock above returns the SAME reference on every call, so `useState`
  // bails out of the re-render and no dependency identity ever moves. The real
  // `refresh()` decodes fresh objects from the network every time, and the
  // first trigger effect keyed on those objects: `goTo('who')` started a
  // refresh in the same breath as the fetch, the refresh replaced `household`,
  // `members`, `connections` and `busyWeeks`, the cleanup ran, `cancelled` went
  // true, and the fetch's answer was dropped on both branches with the guard
  // then refusing a retry. Green throughout. These return fresh copies, which
  // is the one thing that lets the suite disagree with the mocks' author.
  describe('with mocks that return fresh references, as the network does', () => {
    const fresh = () => {
      api.listHouseholds.mockImplementation(async () => [{ ...household }])
      api.listMembers.mockImplementation(async () => [{ ...me }, { ...housemate }])
      calendarApi.listCalendarConnections.mockImplementation(async () => [{ ...connection }])
      calendarApi.listBusyWeeks.mockImplementation(async () => [])
    }

    it('AC 4: a fetch that finishes AFTER the refresh still puts the figure on screen', async () => {
      fresh()
      let finish
      calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })
      // The refresh goTo started has settled by now, with fresh identities
      // throughout; the fetch is still in flight. This is the ordering the
      // Edge Function's two Google round trips make the LIKELY one.
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
      const week = actualCapacity.periodStartFor(new Date(), household.timezone)
      calendarApi.listBusyWeeks.mockImplementation(async () => [{ ...busyRow, period_start: week }])
      await act(async () => finish({ ok: true }))
      await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    })

    it('AC 5: a fetch that FAILS after the refresh still puts the sentence on screen', async () => {
      fresh()
      let fail
      calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((_, reject) => (fail = reject)))
      await renderApp('Who')
      await screen.findByRole('region', { name: /who is in the household/i })
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
      await act(async () => fail(new Error('Could not reach Google. Try again in a moment.')))
      await waitFor(() =>
        expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/),
      )
      // And still once. The failure is recorded, not retried into a loop.
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    })

    it('a refresh that changes nothing this trigger decides by does not re-ask', async () => {
      // Held at one call by TWO guards at once — the value-keyed dependencies
      // and the key in `askedForBusy` — so deleting either alone leaves this
      // green. The dependencies are witnessed on their own by the two
      // late-settling tests above (a fetch that outlives the refresh lands
      // only if the refresh did not tear the effect down); this one is the
      // end-to-end statement, not a proof of either guard.
      fresh()
      await renderApp('Who')
      await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
      // Three more refreshes, each decoding fresh objects. Same ids, same
      // connection, still no row — so the trigger has nothing new to say.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
      }
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    })
  })

  it('AC 5: a figure that was on screen SURVIVES a later read failure, with the sentence under it', async () => {
    // The state the criterion actually describes — the last derived figure,
    // its date, and a notice — and the first version could not reach it: the
    // fetch fires only when there is no row, and the refresh path threw the
    // rows away on a failed read. Now the row stays and the sentence joins it.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks
      .mockResolvedValueOnce([{ ...busyRow, period_start: week }])
      .mockRejectedValue(new Error('loading calendar busy minutes: permission denied'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/permission denied/)
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('a read complaint clears once the table reads again', async () => {
    // Set by the refresh path and, until this, cleared by nothing a member who
    // already has a figure could ever reach — so one transient failure left a
    // contradiction under a perfectly good figure for the rest of the session.
    // A CONNECTED member (the describe's default), because the read notice is
    // shown only to one — see the test after this. Their fetch resolves so the
    // only complaint standing is the read's.
    calendarApi.fetchBusyWeek.mockResolvedValue({ ok: true })
    // Rejecting on EVERY read until told otherwise, because `renderApp('Who')`
    // refreshes twice — once at boot and once for the tab — and a single
    // rejection would be cleared by the second before anything could be seen.
    calendarApi.listBusyWeeks.mockRejectedValue(
      new Error('loading calendar busy minutes: permission denied'),
    )
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toBeInTheDocument())
    calendarApi.listBusyWeeks.mockResolvedValue([])
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().queryByTestId('busy-complaint')).not.toBeInTheDocument()
  })

  it('shows the read notice only to a member who has connected a calendar', async () => {
    // Owner decision, 2026-09-04: a failed read of the busy table means
    // something only to somebody whose figure would have been there. Without
    // this, every member reads a PostgREST sentence under their minutes for the
    // whole window between the merge and `0030` being applied, on a row that
    // has nothing to do with calendars.
    calendarApi.listCalendarConnections.mockResolvedValue([])
    calendarApi.listBusyWeeks.mockRejectedValue(
      new Error('loading calendar busy minutes: relation does not exist'),
    )
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(inRoster().queryByTestId('busy-complaint')).not.toBeInTheDocument()
    // POSITIVE CONTROL in the same test: connect them and the same failure is
    // on screen — so the absence above is the gate, not a mock returning nothing.
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    calendarApi.fetchBusyWeek.mockResolvedValue({ ok: true })
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/does not exist/))
  })

  it('a fetch complaint clears only when a figure for this week actually arrives', async () => {
    // Not when the table merely reads fine: a table that reads says nothing
    // about whether Google answered. The two failures were one state variable
    // once, and the read's success wiped the fetch's sentence (review-fanout,
    // 2026-09-04).
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/Google/))
    // A refresh whose read succeeds but brings no row: the sentence stands.
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/Google/)
    // A refresh that brings the row — another device fetched it — clears it.
    const week = actualCapacity.periodStartFor(new Date(), household.timezone)
    calendarApi.listBusyWeeks.mockResolvedValue([{ ...busyRow, period_start: week }])
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    expect(inRoster().queryByTestId('busy-complaint')).not.toBeInTheDocument()
    expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument()
  })
})

// #98 — the busy figure refreshes itself on app open when it is stale. The
// mirror of the #96 block above, and written to stay disjoint from it: that
// block proves the fetch fires on NO row and never on a row; this one proves it
// fires on a STALE row and never on a fresh one, on the APP opening rather than
// the capacity screen, and once a session. `isBusyWeekStale` is real here — the
// bound and its boundary are calendar.test.js's — so every row below is aged
// against the actual clock rather than against a stubbed answer.
describe('busy figure refreshes itself on app open (#98)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = {
    id: 'c1',
    member_id: 'm1',
    scope: 'freebusy',
    connected_at: '2026-08-24T00:00:00Z',
  }
  const HOUR = 60 * 60 * 1000
  /** This week, by the app's own arithmetic in the household's zone. */
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  /** A derived row for `me`, read `msAgo` before now. */
  const rowReadAgo = (msAgo, extra = {}) => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: 320,
    event_count: 6,
    computed_at: new Date(Date.now() - msAgo).toISOString(),
    ...extra,
  })
  // Thirteen hours and eleven — an hour either side of the twelve-hour bound,
  // so a slow run cannot walk a fixture across it. The boundary itself is
  // pinned with an injected clock in calendar.test.js, not sampled here.
  const staleRow = (extra) => rowReadAgo(13 * HOUR, extra)
  const freshRow = (extra) => rowReadAgo(11 * HOUR, extra)

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  it('AC 1: a row older than the bound is refreshed when the APP opens — on the split, before any tab', async () => {
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp()
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    const [call] = calendarApi.fetchBusyWeek.mock.calls
    expect(call[0]).toEqual({ householdId: 'h1', periodStart: week() })
    // The capacity screen was never opened, so #96's trigger — which keys on
    // that screen — cannot have been the caller. "When the app opens" is the
    // whole of this criterion's clause, and the split is where the app opens.
    expect(
      screen.queryByRole('region', { name: /who is in the household/i }),
    ).not.toBeInTheDocument()
  })

  it('AC 2: a row fresher than the bound is left alone, across repeated opens', async () => {
    // The rate bound, as the criterion asks for it: three opens, zero calls.
    // Each open is a fresh mount — a phone opening the app three times in a
    // morning — and each one draws the figure it already has.
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow()])
    for (let open = 0; open < 3; open += 1) {
      await renderApp('Who')
      await waitFor(() =>
        expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy'),
      )
      cleanup()
    }
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1/AC 2: the bound is the ROW’S age, so a row that never freshens costs one call per open and never a loop', async () => {
    // The other half of the rate statement. A member whose Google keeps
    // refusing keeps a stale row; each open asks once — bounded by the key —
    // and a session never asks twice. Three opens, three calls, not thirty.
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    for (let open = 0; open < 3; open += 1) {
      await renderApp()
      await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(open + 1))
      // Settle anything the mount left in flight before counting the next open.
      await act(async () => {})
      expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(open + 1)
      cleanup()
    }
  })

  it('AC 1: once a session — refreshes, tab switches and re-renders do not ask again', async () => {
    // Fresh references throughout, as the network hands them back, so this is
    // the version of the claim that can disagree with the mocks' author: the
    // trigger keys on the timestamp as a VALUE, and a refresh that decodes the
    // same row into a new object leaves it alone. The row stays stale on every
    // re-read (the mock never freshens it), so nothing the effect decides by
    // ever moves and this is one call BY CONSTRUCTION — the value-keyed
    // dependency list is what it witnesses. The session KEY is witnessed
    // separately, by the roster-change test at the end of this block, which is
    // the one that makes a dependency move after a failure.
    api.listHouseholds.mockImplementation(async () => [{ ...household }])
    api.listMembers.mockImplementation(async () => [{ ...me }, { ...housemate }])
    calendarApi.listCalendarConnections.mockImplementation(async () => [{ ...connection }])
    const row = staleRow()
    calendarApi.listBusyWeeks.mockImplementation(async () => [{ ...row }])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 3; i += 1) {
      await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    }
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    // Exactly one, with the capacity screen open the whole time: #96's trigger
    // saw a row and did nothing, which is the disjointness both stories claim.
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 1: does not refresh for a member who has connected nothing, however old the row', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([])
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy'),
    )
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 1: does not refresh a HOUSEMATE’s stale row', async () => {
    // Owner decision on #96, inherited: this device reads the signed-in
    // member's own calendar. My row is fresh; the housemate's is a day old and
    // is theirs to refresh when they open their own app.
    calendarApi.listBusyWeeks.mockResolvedValue([
      freshRow(),
      staleRow({ id: 'b2', member_id: 'm2', busy_minutes: 90 }),
    ])
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getAllByText(/calendar suggests:/i)).toHaveLength(2))
    expect(calendarApi.fetchBusyWeek).not.toHaveBeenCalled()
  })

  it('AC 3: a refresh that lands while the capacity screen is open updates the figure in place', async () => {
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    // The stale figure is on screen and the refresh is in flight — started at
    // boot, before the tab was pressed. Both refreshes goTo started have
    // settled by now with the same stale row, so what lands next lands late.
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy'),
    )
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    calendarApi.listBusyWeeks.mockResolvedValue([rowReadAgo(0, { busy_minutes: 400, event_count: 7 })])
    await act(async () => finish({ ok: true }))
    // No reload, no refresh button, no tab: the promise settled and the screen
    // followed. The date beside it is the new read's.
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('400 min busy'),
    )
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent(/· read /)
    // And the fresh row did not re-arm the trigger: still one call.
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 4: a refresh that fails leaves the stale figure and its date on screen, and interrupts nothing', async () => {
    calendarApi.fetchBusyWeek.mockRejectedValue(
      new Error('Could not reach Google. Try again in a moment.'),
    )
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/),
    )
    // The figure the member had, with the date it was read — not zeroed, not
    // cleared, not replaced by the sentence.
    const figure = inRoster().getByText(/calendar suggests:/i)
    expect(figure).toHaveTextContent('320 min busy')
    expect(figure).toHaveTextContent(/· read /)
    // "No error interrupts the session": nothing is in the app's error strip,
    // no alert is on the page, and the manual path is there to use. The one
    // sentence that appears is a polite status beside the figure, which is
    // #96 AC 5's surface reused rather than a new one.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not reach the household/i)).not.toBeInTheDocument()
    expect(
      inRoster().getByRole('button', { name: /set this week for placeholder one/i }),
    ).toBeEnabled()
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
  })

  it('AC 4: a failed refresh is not asked again when the roster changes underneath it', async () => {
    // The witness that reaches the session KEY rather than the dependency list.
    // After a failure the row is unchanged, so no dependency moves and the
    // effect is silent by construction — until something it decides by DOES
    // move. A housemate joining changes the member set the re-read names; the
    // effect re-runs, the row is still stale, and only the key stands between
    // that and a second call for a week Google just refused.
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/),
    )
    api.listMembers.mockResolvedValue([
      me,
      housemate,
      { id: 'm3', display_name: 'Placeholder Three', weekly_minutes: 60, claimed_by: null },
    ])
    await act(async () => void fireEvent.click(inRoster().getByRole('button', { name: /^refresh$/i })))
    await waitFor(() => expect(inRoster().getByText('Placeholder Three')).toBeInTheDocument())
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)
    expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/)
  })
})

// #106 — a refreshed suggestion applies itself within the bound. The DECISION
// is capacity.autoApply.test.js's (the bound, the floor, the boundary), the
// ROW is calendarAutoApply.pglite.test.js's and the MARK is Roster.test.jsx's.
// What App owes is the wiring only it can prove: that the write happens at the
// seam a landed read passes through, with the word and the previous figure,
// against the override the SERVER holds rather than the one the screen had;
// that the re-assignment and the re-read follow; that a refused decision
// writes nothing and leaves "Use this" standing; and that the cause reaches
// #50's statement. `autoApplyDecision` and `calendarSuggestion` are REAL here
// (the capacity mock spreads the actual module), so a decision the pure suite
// proves is the decision these tests exercise.
describe('a refreshed suggestion applies itself within the bound (#106)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  // 300 usual. With a confirmed 100 standing, a read of 260 busy suggests 40:
  // a move of 60, inside the bound. A read of 30 busy suggests 270: a move of
  // 170, outside it. With NO row, a read of 90 busy suggests 210: a move of 90
  // from the baseline, inside.
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 300,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' }
  const HOUR = 60 * 60 * 1000
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  const rowReadAgo = (msAgo, busy) => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: busy,
    event_count: 4,
    computed_at: new Date(Date.now() - msAgo).toISOString(),
  })
  const staleRow = (busy = 200) => rowReadAgo(13 * HOUR, busy)
  const freshRow = (busy) => rowReadAgo(0, busy)
  const override = (minutes, source, previous = null) => ({
    id: 'o1',
    member_id: 'm1',
    period_start: week(),
    minutes,
    note: null,
    source,
    previous_minutes: previous,
    created_at: '2026-09-07T00:00:00Z',
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  /**
   * Boot with a stale row so #98's refresh fires, hold the fetch, then let it
   * land with `busy` — the #98 AC 3 shape. Returns once the fetch has settled
   * and everything it started has too.
   */
  async function refreshLandsWith(busy, { surface } = {}) {
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp(surface)
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(busy)])
    await act(async () => finish({ ok: true }))
    await act(async () => {})
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
  })

  it('AC 2: a refresh within the bound writes the week with source calendar_auto and the figure it replaced', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    await refreshLandsWith(260)
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    expect(capacityApi.setCapacity).toHaveBeenCalledWith({
      memberId: 'm1',
      periodStart: week(),
      minutes: 40,
      source: 'calendar_auto',
      previousMinutes: 100,
      householdId: 'h1',
    })
  })

  it('AC 2: the write is followed by the same re-assignment a tap causes, then a re-read', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    await refreshLandsWith(260)
    await waitFor(() => expect(reassignApi.reassignHousehold).toHaveBeenCalledWith({ householdId: 'h1' }))
    // Ordered: the row lands, THEN the re-assignment reads it, THEN the screen
    // re-reads what the re-assignment stored — a re-assignment before the
    // write would divide by last week's figure. All three legs by CALL ORDER:
    // the first draft compared the read count against a number captured
    // before the render, which the boot's own read exceeded whatever happened
    // after the write (review-fanout, 2026-09-08 — an assertion that could not
    // fail on any mutation).
    const setAt = capacityApi.setCapacity.mock.invocationCallOrder[0]
    const reassignAt = reassignApi.reassignHousehold.mock.invocationCallOrder[0]
    expect(setAt).toBeLessThan(reassignAt)
    await waitFor(() =>
      expect(api.listHouseholds.mock.invocationCallOrder.some((n) => n > reassignAt)).toBe(true),
    )
  })

  it('AC 2: decides against the BASELINE the server holds too — a housemate’s edit during the round trip is the baseline used', async () => {
    // No override. Booted at 300 usual; during the fetch a housemate saved the
    // baseline as 200 on another device. The read lands at 120 busy: from the
    // fresh 200 the suggestion is 80 (a move of 120, inside); from the stale
    // 300 it would have been 180. The write must carry the fresh pair.
    capacityApi.listCapacity.mockResolvedValue([])
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow()])
    await renderApp()
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    api.listMembers.mockResolvedValue([{ ...me, weekly_minutes: 200 }, housemate])
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(120)])
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    expect(capacityApi.setCapacity.mock.calls[0][0]).toMatchObject({
      minutes: 80,
      previousMinutes: 200,
      source: 'calendar_auto',
    })
  })

  it('the trigger’s refusal (a person won the race) is quiet: no error strip, no re-assignment, a re-read', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    const refusal = new Error('saving this week’s capacity: an automatic calendar figure cannot replace a figure a person set (manual)')
    refusal.cause = { code: 'TA106', message: 'refused' }
    capacityApi.setCapacity.mockRejectedValue(refusal)
    await refreshLandsWith(260)
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    const setAt = capacityApi.setCapacity.mock.invocationCallOrder[0]
    await waitFor(() =>
      expect(api.listHouseholds.mock.invocationCallOrder.some((n) => n > setAt)).toBe(true),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('AC 2: decides against the override the SERVER holds, re-read at the moment the figure lands', async () => {
    // The screen booted with a confirmed 100; a housemate typed 100 during
    // the round trip. The re-read sees `manual`, and the floor refuses.
    capacityApi.listCapacity.mockResolvedValueOnce([override(100, 'calendar')])
    capacityApi.listCapacity.mockResolvedValue([override(100, 'manual')])
    await refreshLandsWith(260)
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    // And the re-read was scoped to this member and this week.
    const mine = capacityApi.listCapacity.mock.calls.filter(([, ids]) => ids.length === 1 && ids[0] === 'm1')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine[0][0]).toBe(week())
  })

  it('AC 2: fires on #96’s FIRST read of a week too, from the baseline — the seam is shared', async () => {
    // No row and no override: opening the roster asks (#96), the read lands
    // at 90 busy, the baseline 300 becomes 210 — a move of 90, inside.
    capacityApi.listCapacity.mockResolvedValue([])
    let finish
    calendarApi.fetchBusyWeek.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    calendarApi.listBusyWeeks.mockResolvedValue([])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(90)])
    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    expect(capacityApi.setCapacity.mock.calls[0][0]).toMatchObject({
      minutes: 210,
      source: 'calendar_auto',
      previousMinutes: 300,
    })
  })

  it('AC 3: a refresh outside the bound writes nothing, and the readout only proposes', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    await refreshLandsWith(30, { surface: 'Who' })
    await waitFor(() =>
      expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('30 min busy'),
    )
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
    // Exactly as in the confirm story: the tap is there, and it is the way in.
    expect(
      inRoster().getByRole('button', { name: /use the calendar’s figure for placeholder one/i }),
    ).toBeEnabled()
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 100 min')
  })

  it('the manual floor: a refresh within the bound over a TYPED week writes nothing', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'manual')])
    await refreshLandsWith(260)
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('a refresh that confirms the figure already there writes nothing and re-assigns nothing', async () => {
    // Confirmed at 40, the calendar still says 260 busy → 40. No row, no run,
    // no event (#50 AC 8, inherited).
    capacityApi.listCapacity.mockResolvedValue([override(40, 'calendar')])
    await refreshLandsWith(260)
    await act(async () => {})
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('a failed refresh writes nothing — there is no new figure to apply', async () => {
    // The stale row suggests 40 against a confirmed 100 — a move of 60,
    // INSIDE the bound — so a build that reached the decision on the stale
    // figure after the failed fetch WOULD write, and only the early return
    // discharges the assertion. The first draft's stale row suggested exactly
    // the standing figure, so the no-change rule discharged it instead
    // (review-fanout, 2026-09-08; prove-tests shape 9).
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    calendarApi.fetchBusyWeek.mockRejectedValue(new Error('Could not reach Google.'))
    calendarApi.listBusyWeeks.mockResolvedValue([staleRow(260)])
    await renderApp('Who')
    await waitFor(() => expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/reach Google/))
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
  })

  it('AC 4: after the write the roster shows the week as set automatically, with the figure it replaced', async () => {
    // A fake that MODELS the write: every read returns the confirmed row
    // until setCapacity has been called, and the automatic row after — so the
    // re-read after the write returns what the database now holds whatever
    // number of refreshes the boot and the tab press happen to run.
    capacityApi.listCapacity.mockImplementation(async () =>
      capacityApi.setCapacity.mock.calls.length > 0
        ? [override(40, 'calendar_auto', 100)]
        : [override(100, 'calendar')],
    )
    await refreshLandsWith(260, { surface: 'Who' })
    await waitFor(() => expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(inRoster().getByTestId('week-auto-m1')).toHaveTextContent(
        /set from calendar automatically \(was 100 min\)/,
      ),
    )
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 40 min')
  })

  it('a write that fails lands on the error strip rather than vanishing', async () => {
    capacityApi.listCapacity.mockResolvedValue([override(100, 'calendar')])
    capacityApi.setCapacity.mockRejectedValue(new Error('saving this week’s capacity: refused'))
    await refreshLandsWith(260)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/refused/))
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('AC 2: the change is announced with its cause — the statement says the week was set from their calendar', async () => {
    // The seen-marker says this member last saw Placeholder One at 100 with
    // c1; the re-balance moved c1 to Placeholder Two and the override rows
    // now carry `calendar_auto`. The whole #50 pipeline is real here; what is
    // new is the `sources` App passes it.
    const APPLIED_AT = new Date().toISOString()
    api.listHouseholds.mockResolvedValue([{
      ...household,
      last_rebalance: {
        contested: true,
        level: true,
        reason: null,
        boundByBudget: false,
        jobsMoved: 1,
        minutesMoved: 90,
        changeBudgetMinutes: 120,
        applied_at: APPLIED_AT,
      },
    }])
    choresApi.listChores.mockResolvedValue([
      { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
    ])
    capacityApi.listCapacity.mockResolvedValue([override(40, 'calendar_auto', 100)])
    calendarApi.listBusyWeeks.mockResolvedValue([freshRow(260)])
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: {
        members: [
          { id: 'm1', minutes: 90, capacityMinutes: 100 },
          { id: 'm2', minutes: 0, capacityMinutes: 300 },
        ],
      },
      seen_rebalance_at: '2026-08-27T09:00:00+00:00',
    })
    await renderApp()
    const news = await screen.findByTestId('rebalance-announcement')
    expect(news).toHaveTextContent('Placeholder One’s week has 60 min less room (set from their calendar)')
    expect(news).toHaveTextContent('90 min of chores moved off Placeholder One’s list')
  })
})

/
// #210 — the capture flow, wired. What App owes is three things the roster
// cannot prove on its own: that a description reaches lib/capture.js with the
// household ON SCREEN and this member (and NOT the Supabase client); that it
// is not a mutation — nothing re-reads and nothing is written until a submit;
// and that the one submit carries the source through the same setCapacity a
// typed figure uses, once, followed by the same re-assignment and re-read.
// #99 — disconnecting, from App.
//
// The DELETIONS are the Edge Function's and are proven against a fake client in
// supabase/functions/calendar-disconnect/handler.test.js; the CONTROL is the
// roster's and is proven in Roster.test.jsx. What is left, and what this file
// owes, is the wiring: which household travels with the call, that the screen
// re-reads the server rather than patching itself, and what a member is told
// afterwards.
describe('disconnecting a calendar (#99)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const connection = {
    id: 'c1',
    member_id: 'm1',
    scope: 'freebusy',
    connected_at: '2026-08-24T00:00:00Z',
  }
  /** This week, by the app's own arithmetic in the household's zone. */
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  const busyRow = () => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: 320,
    event_count: 6,
    // NOW, so the row is never stale — #98's refresh trigger keys on age, and a
    // fixture that aged across the bound mid-run would add a fetch this block
    // says nothing about. The same reason #96's fixture reads the clock.
    computed_at: new Date().toISOString(),
  })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    calendarApi.listBusyWeeks.mockResolvedValue([busyRow()])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

  /**
   * What the SERVER says once the three rows are gone.
   *
   * The point of driving it this way rather than asserting on local state: AC 2
   * says the connect action returns when the capacity screen RE-RENDERS, and the
   * only honest way to produce that is to change what the reads answer and let
   * `mutate()`'s refresh find it — which is what the running app does.
   */
  const serverForgets = () => {
    calendarApi.listCalendarConnections.mockResolvedValue([])
    calendarApi.listBusyWeeks.mockResolvedValue([])
  }

  /** Both taps of the house confirm idiom. */
  const disconnect = async () => {
    await act(
      async () => void fireEvent.click(inRoster().getByRole('button', { name: /^disconnect$/i })),
    )
    await act(
      async () =>
        void fireEvent.click(
          inRoster().getByRole('button', { name: /disconnect google calendar\?/i }),
        ),
    )
  }

  it('AC 1: names the household on screen, and nothing about who', async () => {
    // The function acts on the CALLER'S own member row, so a member id here
    // would be a value the server must ignore — `completeConnect` and
    // `fetchBusyWeek` send none for the same reason.
    await renderApp('Who')
    await disconnect()
    expect(calendarApi.disconnectCalendar).toHaveBeenCalledTimes(1)
    expect(calendarApi.disconnectCalendar).toHaveBeenCalledWith({ householdId: 'h1' })
  })

  it('AC 2: the connect action returns and the suggestion goes with the rows', async () => {
    await renderApp('Who')
    // The before state, so the after state is a CHANGE rather than an
    // arrangement that could never have shown either one.
    expect(inRoster().getByText(/calendar connected/i)).toBeInTheDocument()
    expect(inRoster().getByText(/calendar suggests:/i)).toHaveTextContent('320 min busy')

    serverForgets()
    await disconnect()

    expect(
      inRoster().getByRole('button', { name: /connect google calendar/i }),
    ).toBeInTheDocument()
    expect(inRoster().queryByText(/calendar connected/i)).not.toBeInTheDocument()
    expect(inRoster().queryByText(/calendar suggests:/i)).not.toBeInTheDocument()
  })

  it('AC 2: re-reads the server rather than patching what is on screen', async () => {
    // `mutate()`'s refresh is what produces the state above. Asserting the
    // re-read is what separates "the screen changed" from "the screen changed
    // because the server said so" — a locally patched roster would satisfy
    // every assertion in the test above and show a connected calendar again on
    // the next reload.
    await renderApp('Who')
    const readsBefore = calendarApi.listCalendarConnections.mock.calls.length
    serverForgets()
    await disconnect()
    expect(calendarApi.listCalendarConnections.mock.calls.length).toBeGreaterThan(readsBefore)
  })

  it('AC 3: the confirmed capacity row is not touched, and the week still reads from it', async () => {
    // An accepted figure is the member's own whatever produced it. The write
    // path this story owns can only delete calendar rows, so the assertion is
    // that a `calendar`-sourced override outlives the disconnect on screen —
    // and that nothing in App reached for the capacity writers.
    capacityApi.listCapacity.mockResolvedValue([
      { id: 'cap1', member_id: 'm1', period_start: week(), minutes: 90, source: 'calendar' },
    ])
    await renderApp('Who')
    serverForgets()
    await disconnect()
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 90 min')
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent(/set from calendar/i)
    expect(capacityApi.clearCapacity).not.toHaveBeenCalled()
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
  })

  it('AC 4: says so when Google could not confirm the revocation', async () => {
    calendarApi.disconnectCalendar.mockResolvedValue({ ok: true, memberId: 'm1', revoked: false })
    await renderApp('Who')
    serverForgets()
    await disconnect()
    // The sentence is `revokeNoteFor`'s, left REAL in this file's mock, so this
    // is the wording a member would actually read.
    expect(inRoster().getByTestId('calendar-note')).toHaveTextContent(/google may still list/i)
  })

  it('AC 4: says nothing when Google accepted it', async () => {
    await renderApp('Who')
    serverForgets()
    await disconnect()
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('AC 4: says nothing when there was no credential to revoke', async () => {
    // `null` is not `false`. A member who never had a grant outstanding must
    // not be told Google may still hold one.
    calendarApi.disconnectCalendar.mockResolvedValue({ ok: true, memberId: 'm1', revoked: null })
    await renderApp('Who')
    serverForgets()
    await disconnect()
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('a refused disconnect shows the function’s sentence and leaves the connection alone', async () => {
    calendarApi.disconnectCalendar.mockRejectedValue(
      new Error('Could not finish disconnecting that calendar. Part of it was removed.'),
    )
    await renderApp('Who')
    await disconnect()
    expect(screen.getByRole('alert')).toHaveTextContent(/Part of it was removed/)
    // Still connected, because the reads still say so — and still offering the
    // control, which is the repair the sentence asks for.
    expect(inRoster().getByText(/calendar connected/i)).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-note')).not.toBeInTheDocument()
  })

  it('clears the calendar complaint, which now describes a calendar the member does not have', async () => {
    // #99's review, test-vacuity: `setBusyFetchComplaint(null)` in
    // `handleDisconnectCalendar` was defended by nothing, because every other
    // case in this block mocks `fetchBusyWeek` resolved and a complaint can
    // only arise when it REJECTS. So the sentence a member is left looking at
    // is the thing to arrange first.
    //
    // The sentence itself is the Edge Function's own, read off the failure by
    // `fetchBusyWeek` — "no longer valid. Connect it again." under a row with
    // no calendar at all is true of nothing.
    calendarApi.listBusyWeeks.mockResolvedValue([])
    calendarApi.fetchBusyWeek.mockRejectedValue(
      new Error('That calendar connection is no longer valid. Connect it again.'),
    )
    await renderApp('Who')
    await waitFor(() =>
      expect(inRoster().getByTestId('busy-complaint')).toHaveTextContent(/no longer valid/i),
    )

    serverForgets()
    await disconnect()

    expect(screen.queryByTestId('busy-complaint')).not.toBeInTheDocument()
  })

  it('lets a member connect again in the same session and still get a figure', async () => {
    // #96's trigger is once per (member, week) PER SESSION, and #98's refresh
    // keeps a second such set. Neither knew about a disconnect until this
    // story: without clearing them, re-connecting would find the key already
    // present, fetch nothing, and leave the member looking at a connected
    // calendar with no figure until they reloaded. Forgetting what was read
    // includes forgetting that it was asked for.
    calendarApi.listBusyWeeks.mockResolvedValue([])
    await renderApp('Who')
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1))

    calendarApi.listCalendarConnections.mockResolvedValue([])
    await disconnect()
    expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(1)

    // The calendar comes back — a second consent, landing on the next read.
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    await waitFor(() => expect(calendarApi.fetchBusyWeek).toHaveBeenCalledTimes(2))
  })
})

describe('capacity — described in plain language (#210)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }
  const PROPOSAL = { outcome: 'proposal', minutes: 180, derivedFrom: { who: 'me', minutes: 180 } }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    captureApi.extractCapacity.mockResolvedValue(PROPOSAL)
  })

  const openTheWeekEditor = async () =>
    act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set this week for placeholder one/i })),
    )

  const describeWeek = async (text) => {
    fireEvent.change(screen.getByLabelText(/describe this week for placeholder one/i), {
      target: { value: text },
    })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /work out the minutes/i })))
  }

  const saveProposed = () =>
    act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /save the proposed figure for placeholder one/i })),
    )

  const save = () => act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

  const onTheRoster = async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
  }

  it('asks through lib/capture.js with the household on screen and this member, and writes nothing', async () => {
    await onTheRoster()
    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')

    expect(captureApi.extractCapacity).toHaveBeenCalledTimes(1)
    expect(captureApi.extractCapacity).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        text: 'I have three hours this week',
        member: expect.objectContaining({ id: 'm1' }),
        members: [expect.objectContaining({ id: 'm1' })],
      }),
    )
    expect(screen.getByTestId('proposal-m1')).toHaveTextContent('180 min')
    expect(screen.getByLabelText(/minutes this week for placeholder one/i)).toHaveValue(180)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
    // Not a mutation: a proposal is not a change, so nothing re-reads after it.
    expect(capacityApi.listCapacity.mock.calls.length).toBe(readsBefore)
  })

  it('AC 9: one tap on the proposal writes capacity ONCE, with source extraction, then re-assigns and re-reads', async () => {
    await onTheRoster()
    const readsBefore = capacityApi.listCapacity.mock.calls.length
    const readPeriod = capacityApi.listCapacity.mock.calls[0][0]
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your description/i)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()

    await saveProposed()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith({
      memberId: 'm1',
      periodStart: readPeriod,
      minutes: '180',
      source: 'extraction',
      householdId: 'h1',
    })
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('a typed figure still goes through the same call, with source manual', async () => {
    await onTheRoster()
    await openTheWeekEditor()
    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value: '120' },
    })
    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', minutes: '120', source: 'manual' }),
    )
  })

  it('AC 3: leaving for another surface after a proposal writes nothing', async () => {
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Split' })))
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
  })

  it('AC 3: a reload starts clean — nothing was kept on the device to apply later', async () => {
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    // Nothing persisted: a proposal lives in component state and nowhere else.
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)

    cleanup()
    await onTheRoster()
    await openTheWeekEditor()
    expect(screen.getByLabelText(/minutes this week for placeholder one/i)).toHaveValue(300)
    expect(screen.queryByTestId('capture-proposal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('week-source-m1')).not.toBeInTheDocument()
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
  })

  it('AC 2: when the service cannot answer, the same flow saves a typed figure as manual', async () => {
    captureApi.extractCapacity.mockResolvedValue({
      outcome: 'failed',
      sentence: 'The extraction service could not answer: Failed to send a request to the Edge Function',
    })
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    expect(screen.getByTestId('capture-failure')).toHaveTextContent(/could not answer/)
    expect(screen.queryByRole('alert'), 'a failed proposal is not an app error').not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value: '90' },
    })
    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ minutes: '90', source: 'manual' }),
    )
  })

  it('the proposer never touches the Supabase client from App — it goes through lib/capture.js', async () => {
    // getSupabase throws in this file's mock, so the flow completing to a
    // proposal on screen is the assertion.
    await onTheRoster()
    await openTheWeekEditor()
    await describeWeek('I have three hours this week')
    expect(screen.getByTestId('proposal-m1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// #213 — the chore capture flow, wired. What App owes, as for #210: that a
// description reaches lib/capture.js with the household ON SCREEN, today on
// the household's calendar and the person typing (and NOT the Supabase
// client); that asking is not a mutation — nothing re-reads and nothing is
// written; and that confirming goes through the same addChores a typed batch
// uses, with the household on screen and `source: 'extraction'` on every row,
// followed by the same re-read.
describe('chores — described in plain language (#213)', () => {
  const household = {
    id: 'h1',
    name: 'Placeholder Household',
    join_code: 'ABCD2345',
    timezone: 'America/New_York',
  }
  const me = { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' }
  const chore = { id: 'c1', household_id: 'h1', title: 'Placeholder Chore', expected_minutes: 20, due_on: '2026-08-10' }
  const PROPOSAL = {
    outcome: 'proposal',
    rows: [
      {
        key: 'proposed-1',
        title: 'mow the grass',
        minutes: '45',
        dueOn: '2026-08-29',
        problem: null,
        note: 'Read as “mow the grass”, 45 min, due “Saturday”.',
        derivedFrom: { title: 'mow the grass', expectedMinutes: 45, dueDate: 'Saturday', repeat: null, assignee: null },
      },
    ],
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    choresApi.listChores.mockResolvedValue([chore])
    captureApi.extractChores.mockResolvedValue(PROPOSAL)
  })

  const onTheChores = async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')
  }

  const describeChores = async (text) => {
    fireEvent.change(screen.getByLabelText(/what needs doing this week/i), { target: { value: text } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /work out the chores/i })))
  }

  it('asks through lib/capture.js with the household on screen, today on its calendar and the person typing — and writes nothing', async () => {
    await onTheChores()
    const readsBefore = choresApi.listChores.mock.calls.length
    await describeChores('takes about 45 min to mow the grass')

    expect(captureApi.extractChores).toHaveBeenCalledTimes(1)
    expect(captureApi.extractChores).toHaveBeenCalledWith({
      householdId: 'h1',
      text: 'takes about 45 min to mow the grass',
      // Today in America/New_York, as `localTodayIn` says it — the same call
      // the tab's skip picker is handed, never the phone's zone.
      todayIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      speaker: 'Placeholder One',
    })
    // The proposal is on screen, editable, and NOTHING has been written or
    // re-read: a proposal is not a mutation.
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('mow the grass')
    expect(choresApi.addChores).not.toHaveBeenCalled()
    expect(choresApi.addChore).not.toHaveBeenCalled()
    expect(choresApi.listChores.mock.calls.length).toBe(readsBefore)
  })

  it('confirming goes through addChores with the household on screen and source extraction on every row, then re-reads', async () => {
    choresApi.addChores.mockResolvedValue([{ ok: true, chore: { id: 'n1' } }])
    await onTheChores()
    await describeChores('takes about 45 min to mow the grass')

    const readsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add these chores/i })))

    expect(choresApi.addChores).toHaveBeenCalledTimes(1)
    expect(choresApi.addChores).toHaveBeenCalledWith(
      [{ title: 'mow the grass', expectedMinutes: '45', dueOn: '2026-08-29', source: 'extraction' }],
      { householdId: household.id },
    )
    await waitFor(() => expect(choresApi.listChores.mock.calls.length).toBeGreaterThan(readsBefore))
    expect(choresApi.addChores.mock.invocationCallOrder[0]).toBeLessThan(
      choresApi.listChores.mock.invocationCallOrder[readsBefore],
    )
    // Everything landed, so the list is gone.
    expect(screen.queryByLabelText(/title for chore 1/i)).not.toBeInTheDocument()
  })

  it('AC 6: when the endpoint fails, the typed form is the road in, and it is the SAME add path', async () => {
    captureApi.extractChores.mockResolvedValue({ outcome: 'failed', sentence: 'The extraction service could not answer.' })
    await onTheChores()
    await describeChores('takes about 45 min to mow the grass')

    expect(screen.getByTestId('capture-failure')).toHaveTextContent(/could not answer/)
    expect(screen.getByLabelText(/^chore$/i)).toHaveFocus()
    expect(choresApi.addChores).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))
    expect(choresApi.addChore).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dishes', expectedMinutes: '20', dueOn: '2026-08-10', householdId: 'h1' }),
    )
  })

  it('the proposer never touches the Supabase client from App — it goes through lib/capture.js', async () => {
    // getSupabase throws in this file's mock, so the flow completing to a
    // proposal on screen is the assertion — #210's shape.
    await onTheChores()
    await describeChores('takes about 45 min to mow the grass')
    expect(screen.getByLabelText(/title for chore 1/i)).toHaveValue('mow the grass')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('applying the calendar suggestion to the week (#97)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const connection = { id: 'c1', member_id: 'm1', scope: 'freebusy', connected_at: '2026-08-24T00:00:00Z' }
  const week = () => actualCapacity.periodStartFor(new Date(), household.timezone)
  // 120 usual, 45 busy: a prefill of 75. Read NOW for #98's reason — a fixed
  // timestamp ages across the refresh bound and turns a row that EXISTS into
  // a fetch on a diff that touched nothing.
  const busyRow = () => ({
    id: 'b1',
    member_id: 'm1',
    period_start: week(),
    busy_minutes: 45,
    event_count: 3,
    computed_at: new Date().toISOString(),
  })

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    calendarApi.listCalendarConnections.mockResolvedValue([connection])
    calendarApi.listBusyWeeks.mockResolvedValue([busyRow()])
  })

  const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))
  const onTheRoster = async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    await waitFor(() => expect(inRoster().getByText(/calendar suggests:/i)).toBeInTheDocument())
  }
  const useIt = () =>
    act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /use the calendar’s figure for placeholder one/i })),
    )
  const save = () => act(async () => void fireEvent.click(screen.getByRole('button', { name: /^save$/i })))

  it('AC 1 / AC 2: the tap prefills 75 and writes nothing; Save writes ONCE with source calendar, re-assigns and re-reads', async () => {
    await onTheRoster()
    const readsBefore = capacityApi.listCapacity.mock.calls.length
    await useIt()
    expect(screen.getByLabelText(/minutes this week for placeholder one/i)).toHaveValue(75)
    expect(screen.getByTestId('week-source-m1')).toHaveTextContent(/from your calendar/i)
    expect(capacityApi.setCapacity).not.toHaveBeenCalled()
    expect(reassignApi.reassignHousehold).not.toHaveBeenCalled()
    // A prefill is not a change: nothing re-reads after it.
    expect(capacityApi.listCapacity.mock.calls.length).toBe(readsBefore)

    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith({
      memberId: 'm1',
      periodStart: week(),
      minutes: '75',
      source: 'calendar',
      householdId: 'h1',
    })
    expect(reassignApi.reassignHousehold).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(capacityApi.listCapacity.mock.calls.length).toBeGreaterThan(readsBefore),
    )
  })

  it('AC 2: a figure edited before Save goes through the same call as manual', async () => {
    await onTheRoster()
    await useIt()
    fireEvent.change(screen.getByLabelText(/minutes this week for placeholder one/i), {
      target: { value: '60' },
    })
    await save()
    expect(capacityApi.setCapacity).toHaveBeenCalledTimes(1)
    expect(capacityApi.setCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm1', minutes: '60', source: 'manual' }),
    )
  })

  it('AC 6: after the re-read the roster shows the week as set from the calendar', async () => {
    await onTheRoster()
    await useIt()
    // What the server will hand back once the write lands — the re-read after
    // `mutate()` is what puts the provenance on screen, not the tap.
    capacityApi.listCapacity.mockResolvedValue([
      { id: 'o1', member_id: 'm1', period_start: week(), minutes: 75, note: null, source: 'calendar' },
    ])
    await save()
    await waitFor(() => expect(inRoster().getByTestId('week-m1')).toHaveTextContent('This week: 75 min'))
    expect(inRoster().getByTestId('week-m1')).toHaveTextContent(/set from calendar/i)
  })

  it('the tap touches no calendar read — the figure is already on the device', async () => {
    // Taking the suggestion is arithmetic on a row already read. It must not
    // spend a Google call: #96 fetches when there is no row and #98 when the
    // row is stale, and this is neither.
    await onTheRoster()
    const fetches = calendarApi.fetchBusyWeek.mock.calls.length
    await useIt()
    await save()
    expect(calendarApi.fetchBusyWeek.mock.calls.length).toBe(fetches)
  })
})

// ---------------------------------------------------------------------------
// #358 — several named lists, from App.
//
// What the surface DRAWS is Shopping.test.jsx's, and which SQLSTATE the
// database raises is shopping.pglite.test.js's. These cover what only App can
// answer: that the two list writes go through the data layer with the right
// arguments and are followed by a re-read, that a refused one reaches the strip
// and patches nothing, and — the criterion no other level can reach — that the
// chosen list survives a tab switch and falls back when it names nothing.
// ---------------------------------------------------------------------------
describe('#358 — several named lists, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const other = { id: 'h2', name: 'Placeholder Other Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const groceries = {
    id: 'l1',
    household_id: 'h1',
    name: 'Groceries',
    created_at: '2026-09-05T00:00:00Z',
  }
  const hardware = {
    id: 'l2',
    household_id: 'h1',
    name: 'Hardware',
    created_at: '2026-09-06T00:00:00Z',
  }
  const runOf = (list, id) => ({
    id,
    list_id: list.id,
    household_id: list.household_id,
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  })
  const runA = runOf(groceries, 'r1')
  const runB = runOf(hardware, 'r2')
  // Read order is `created_at`, so the read hands them over oldest-first and
  // App is what sorts by name. Kept that way on purpose: a fixture already in
  // name order could not tell the ordering from the read.
  /**
   * One item per list, so a test can ask WHICH LIST WAS DRAWN and not only
   * which button is pressed. The picker's pressed state comes from the
   * preference; the rows come from the list on screen, and the mutation that
   * drew the wrong list moved the rows while leaving the button alone.
   */
  const item = (id, runId, name) => ({
    id,
    run_id: runId,
    household_id: 'h1',
    name,
    note: null,
    added_by_member_id: 'm1',
    added_at: '2026-09-06T10:00:00Z',
    purchased_at: null,
    purchased_by_member_id: null,
    carried_from_item_id: null,
  })
  const twoLists = {
    lists: [groceries, hardware],
    runs: [runA, runB],
    items: [item('i1', 'r1', 'Milk'), item('i2', 'r2', 'Bread')],
  }
  const oneList = { lists: [groceries], runs: [runA], items: [item('i1', 'r1', 'Milk')] }
  /** The item names on screen, top to bottom — the list the tab actually drew. */
  const rowsOnScreen = () =>
    Array.from(document.querySelectorAll('.shopping-item__name')).map((n) => n.textContent)

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue(twoLists)
  })

  const tab = (name) => act(async () => void fireEvent.click(screen.getByRole('button', { name })))
  const picker = () =>
    Array.from(
      screen.getByRole('group', { name: /which list/i }).querySelectorAll('button'),
    ).map((b) => [b.querySelector('.shopping-picker__name').textContent, b.getAttribute('aria-pressed')])
  /**
   * The list on screen. With a picker up the heading stands down (the owner's
   * call at the design pass), so the pressed button is what names it; with one
   * list there is no picker and the heading is the name.
   */
  const heading = () => {
    const group = screen.queryByRole('group', { name: /which list/i })
    if (!group) return screen.getByRole('heading', { level: 3 }).textContent
    return group
      .querySelector('button[aria-pressed="true"]')
      .querySelector('.shopping-picker__name').textContent
  }
  /** Tap a picker button by its list NAME — its accessible name carries the count too. */
  const choose = (name) =>
    act(async () =>
      void fireEvent.click(
        Array.from(
          screen.getByRole('group', { name: /which list/i }).querySelectorAll('button'),
        ).find((b) => b.querySelector('.shopping-picker__name').textContent === name),
      ),
    )

  it('AC 1: orders the picker by NAME, whatever order the read returned', async () => {
    // Both of the read's own orders point the other way: `created_at` ascending
    // AND the id tie-break `orderShoppingLists` falls back on. The ids agreed
    // with the names in the first draft, and a mutation deleting the name
    // comparison outright still produced this expectation from the tie-break.
    const early = { ...hardware, id: 'la', created_at: '2026-09-01T00:00:00Z' }
    const late = { ...groceries, id: 'lb' }
    shoppingApi.readShopping.mockResolvedValue({
      lists: [early, late],
      runs: [runOf(early, 'r1'), runOf(late, 'r2')],
      items: [],
    })
    await renderApp('Shop')
    expect(picker().map(([name]) => name)).toEqual(['Groceries', 'Hardware'])
  })

  it('AC 1: creates the list through the data layer, re-reads, and lands the picker on the NEW one', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneList)
    await renderApp('Shop')
    expect(heading()).toBe('Groceries')

    // The write returns the row it made; the next read holds both lists.
    shoppingApi.createList.mockResolvedValue(hardware)
    shoppingApi.readShopping.mockResolvedValue(twoLists)
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/new list/i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'Hardware' } })
    await tab(/create list/i)

    expect(shoppingApi.createList).toHaveBeenCalledWith(SHOPPING_CLIENT, household.id, 'Hardware')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // The write is before the read, which is what makes the id resolvable.
    expect(shoppingApi.createList.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder[readsBefore],
    )
    // Second by name, and it is the one on screen — a list somebody just named
    // is the list they want to be looking at.
    await waitFor(() => expect(heading()).toBe('Hardware'))
    expect(picker()).toEqual([
      ['Groceries', 'false'],
      ['Hardware', 'true'],
    ])
  })

  it('AC 4: renames through the data layer with the list id, then re-reads', async () => {
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    shoppingApi.readShopping.mockResolvedValue({
      ...twoLists,
      lists: [{ ...groceries, name: 'Bakery' }, hardware],
    })

    await tab(/^rename /i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'Bakery' } })
    await tab(/save name/i)

    expect(shoppingApi.renameList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.renameList).toHaveBeenCalledWith(SHOPPING_CLIENT, 'l1', 'Bakery')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // The heading comes from the RE-READ, not from the field: the id did not
    // move, so the same list is on screen under its new name.
    await waitFor(() => expect(heading()).toBe('Bakery'))
  })

  it('AC 5: a refused rename puts the data layer’s sentence on the strip and changes nothing on screen', async () => {
    // WHICH sentence is shopping.js's, keyed on SQLSTATE 23505 and proved in
    // shopping.io.test.js; what only this level can say is that the refusal
    // reaches the strip and that nothing on the screen moved with it.
    shoppingApi.renameList.mockRejectedValue(
      new Error('You already have a list called Hardware.'),
    )
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/^rename /i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'Hardware' } })
    await tab(/save name/i)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You already have a list called Hardware.'),
    )
    // No re-read: `mutate()` re-reads only what it wrote, and nothing was
    // written. The editor is still open with the name that was refused.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(screen.getByLabelText(/^list name$/i)).toHaveValue('Hardware')
    expect(picker().map(([name]) => name)).toEqual(['Groceries', 'Hardware'])
  })

  it('AC 5: a refused create leaves the household on the list it had', async () => {
    shoppingApi.createList.mockRejectedValue(new Error('You already have a list called Hardware.'))
    await renderApp('Shop')

    await tab(/new list/i)
    fireEvent.change(screen.getByLabelText(/^list name$/i), { target: { value: 'HARDWARE' } })
    await tab(/create list/i)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You already have a list called Hardware.'),
    )
    expect(heading()).toBe('Groceries')
    expect(picker()).toEqual([
      ['Groceries', 'true'],
      ['Hardware', 'false'],
    ])
  })

  it('AC 3: finishing names the chosen list’s run, and the other list comes back untouched', async () => {
    shoppingApi.finishRun.mockResolvedValue({ ...runB, id: 'r3' })
    await renderApp('Shop')
    await choose('Hardware')

    // The re-read after the finish: Hardware on a NEW run with nothing on it,
    // and Groceries exactly as it was — same run, same item.
    const fresh = { ...runB, id: 'r3' }
    shoppingApi.readShopping.mockResolvedValue({
      lists: [groceries, hardware],
      runs: [runA, fresh],
      items: [item('i1', 'r1', 'Milk')],
    })
    await tab(/done shopping/i)
    await tab(/^finish$/i)

    // The RUN, never the list — 0033's whole design, and what the fake records.
    expect(shoppingApi.finishRun).toHaveBeenCalledTimes(1)
    expect(shoppingApi.finishRun).toHaveBeenCalledWith(SHOPPING_CLIENT, 'r2')

    // And the other list is untouched by it: switch back and its row is there.
    await waitFor(() => expect(heading()).toBe('Hardware'))
    expect(rowsOnScreen()).toEqual([])
    await choose('Groceries')
    expect(rowsOnScreen()).toEqual(['Milk'])
  })

  it('AC 6: the chosen list survives a visit to another tab, in the same session', async () => {
    await renderApp('Shop')
    expect(heading()).toBe('Groceries')
    await choose('Hardware')
    expect(heading()).toBe('Hardware')

    // The component unmounts on the way out and mounts again on the way back —
    // which is the whole reason the choice is not held inside it.
    await tab('Chores')
    expect(screen.queryByRole('region', { name: 'Shop' })).not.toBeInTheDocument()
    await tab('Shop')
    expect(heading()).toBe('Hardware')
    expect(picker()).toEqual([
      ['Groceries', 'false'],
      ['Hardware', 'true'],
    ])
    // The BODY, not only the button: the rows on screen are the chosen list's.
    expect(rowsOnScreen()).toEqual(['Bread'])
  })

  it('AC 6: nothing is written for a choice — not to the server, not to storage', async () => {
    const wrote = []
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((...args) => void wrote.push(args))
    try {
      await renderApp('Shop')
      const reads = shoppingApi.readShopping.mock.calls.length
      await choose('Hardware')
      expect(heading()).toBe('Hardware')
      expect(shoppingApi.readShopping.mock.calls.length).toBe(reads)
      expect(wrote).toEqual([])
      for (const fn of [shoppingApi.createList, shoppingApi.renameList, shoppingApi.addItem]) {
        expect(fn).not.toHaveBeenCalled()
      }
    } finally {
      spy.mockRestore()
    }
  })

  it('AC 6: a list that is gone after a re-read falls back to the first by name', async () => {
    await renderApp('Shop')
    await choose('Hardware')
    expect(heading()).toBe('Hardware')

    // Another phone removed the list this one was looking at. The next re-read
    // — here the one an add drags behind it — no longer holds l2.
    shoppingApi.readShopping.mockResolvedValue(oneList)
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Milk' } })
    await tab(/add item/i)

    await waitFor(() => expect(heading()).toBe('Groceries'))
    expect(screen.queryByRole('group', { name: /which list/i })).not.toBeInTheDocument()
  })

  it('AC 6: the active household changing resets the choice to that household’s first list', async () => {
    await renderApp('Shop')
    await choose('Hardware')
    expect(heading()).toBe('Hardware')

    // The household on screen changes under the choice. Its lists are other
    // rows entirely, so the preference names nothing — one rule, three causes.
    const bakery = { id: 'l9', household_id: 'h2', name: 'Bakery', created_at: '2026-09-06T00:00:00Z' }
    api.listHouseholds.mockResolvedValue([other])
    shoppingApi.readShopping.mockResolvedValue({
      lists: [bakery],
      runs: [runOf(bakery, 'r9')],
      items: [],
    })
    await tab('Chores')
    await tab('Shop')

    await waitFor(() => expect(heading()).toBe('Bakery'))
  })
})

// ---------------------------------------------------------------------------
// #359 AC 4 — the history read, and the discipline it deliberately departs from.
//
// Every other read on this surface runs on arrival; this one runs when the Past
// runs disclosure is opened, because history is unbounded. Only App can answer
// either half — what the disclosure DRAWS is Shopping.test.jsx's, and which
// filters the read sends is shopping.io.test.js's.
// ---------------------------------------------------------------------------
describe('#359 — past runs, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Robin', weekly_minutes: 60, claimed_by: null },
  ]
  const groceries = { id: 'l1', household_id: 'h1', name: 'Groceries', created_at: '2026-09-05T00:00:00Z' }
  const hardware = { id: 'l2', household_id: 'h1', name: 'Hardware', created_at: '2026-09-06T00:00:00Z' }
  const openRun = (list, id) => ({
    id,
    list_id: list.id,
    household_id: 'h1',
    opened_at: '2026-09-06T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  })
  const item = (id, runId, name, purchased = null) => ({
    id,
    run_id: runId,
    household_id: 'h1',
    name,
    note: null,
    added_by_member_id: 'm1',
    added_at: '2026-09-06T10:00:00Z',
    purchased_at: purchased,
    purchased_by_member_id: purchased ? 'm2' : null,
    carried_from_item_id: null,
  })
  const oneList = {
    lists: [groceries],
    runs: [openRun(groceries, 'r-open')],
    items: [item('i1', 'r-open', 'Milk')],
  }
  const twoLists = {
    lists: [groceries, hardware],
    runs: [openRun(groceries, 'r-open'), openRun(hardware, 'r-open-2')],
    items: [item('i1', 'r-open', 'Milk'), item('i2', 'r-open-2', 'Bread')],
  }
  /** One finished trip on the Groceries list: one bought, one carried forward. */
  const finished = {
    runs: [
      {
        id: 'r-closed',
        list_id: 'l1',
        household_id: 'h1',
        opened_at: '2026-09-04T00:00:00Z',
        closed_at: '2026-09-05T22:00:00Z',
        closed_by_member_id: 'm2',
      },
    ],
    items: [item('p1', 'r-closed', 'Eggs', '2026-09-05T21:02:00Z'), item('p2', 'r-closed', 'Butter')],
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue(oneList)
  })

  const tab = (name) => act(async () => void fireEvent.click(screen.getByRole('button', { name })))
  /**
   * Open the disclosure with a real tap, then let the platform's own `toggle`
   * arrive — jsdom queues it as a task, so a microtask-only flush reads zero
   * toggles and the read looks as though it never fired. The measurement behind
   * that sentence is in Shopping.test.jsx's own helper.
   */
  const openPast = async () => {
    fireEvent.click(screen.getByText('Past runs'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const history = () => screen.getByText('Past runs').closest('details')

  it('does NOT read the history on arrival, on a re-arrival, or on a write — only on the disclosure', async () => {
    await renderApp('Shop')
    expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(0)
    expect(shoppingApi.readClosedRuns).not.toHaveBeenCalled()

    // A second arrival, which is a full re-read of everything else.
    await tab('Chores')
    await tab('Shop')
    expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(1)
    expect(shoppingApi.readClosedRuns).not.toHaveBeenCalled()

    // And a write, which drags a re-read behind it through mutate().
    fireEvent.change(screen.getByLabelText(/^item$/i), { target: { value: 'Bread' } })
    await tab(/add item/i)
    expect(shoppingApi.addItem).toHaveBeenCalledTimes(1)
    expect(shoppingApi.readClosedRuns).not.toHaveBeenCalled()
  })

  it('reads it when the disclosure opens, naming the list on screen and its client', async () => {
    shoppingApi.readClosedRuns.mockResolvedValue(finished)
    await renderApp('Shop')
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await openPast()

    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(1)
    // The LIST, as an array of one — the read filters `.in('list_id', …)`, and
    // the household's other lists are not what somebody just asked about.
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledWith(SHOPPING_CLIENT, ['l1'])
    // It is a read: nothing goes through mutate(), so nothing else is re-read.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)

    // And what came back is on the screen, with the roster resolved and the
    // household's zone applied — 21:02 UTC is 5:02 PM in New York.
    expect(within(history()).getByRole('heading', { level: 4 })).toHaveTextContent(
      'Finished Sep 5, 2026 by Robin',
    )
    expect(within(history()).getByText('Eggs').closest('li')).toHaveTextContent(
      'bought by Robin · 5:02 PM',
    )
    expect(within(history()).getByText('Butter').closest('li')).toHaveTextContent('carried over')
  })

  it('reads the list the picker is on, not the household’s first', async () => {
    shoppingApi.readShopping.mockResolvedValue(twoLists)
    await renderApp('Shop')
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Hardware/ })))
    await openPast()
    expect(shoppingApi.readClosedRuns).toHaveBeenLastCalledWith(SHOPPING_CLIENT, ['l2'])
  })

  it('a refused history read reports itself on the strip and shows no rows', async () => {
    shoppingApi.readClosedRuns.mockRejectedValue(
      new Error('loading finished runs: permission denied'),
    )
    await renderApp('Shop')
    await openPast()

    expect(
      within(screen.getByRole('region', { name: 'Shop' })).getByRole('alert'),
    ).toHaveTextContent(/loading finished runs: permission denied/)
    // Not "reading…" forever, and not the last answer either: a failure clears
    // the rows rather than leaving somebody looking at a history nothing here
    // can vouch for.
    expect(screen.queryByText(/reading the finished runs/i)).not.toBeInTheDocument()
    expect(within(history()).queryByRole('heading', { level: 4 })).not.toBeInTheDocument()
  })

  it('finishing a run closes the disclosure, so nobody reads a history from before the trip ended', async () => {
    await renderApp('Shop')
    await openPast()
    expect(history()).toHaveAttribute('open')
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(1)

    // One list draws ONE finish control. This is the assertion that caught the
    // duplicate React key — `PastRuns` and `FinishRun` are siblings, and while
    // both were keyed on the run id React rendered three of them.
    expect(document.querySelectorAll('.shopping-finish')).toHaveLength(1)

    // The trip ends: the RPC returns the new run and the re-read shows it.
    const nextRun = openRun(groceries, 'r-next')
    shoppingApi.finishRun.mockResolvedValue(nextRun)
    shoppingApi.readShopping.mockResolvedValue({ lists: [groceries], runs: [nextRun], items: [] })
    await tab(/done shopping/i)
    await tab(/^finish$/i)

    // Keyed on the open run, so a new run remounts it closed — and the run that
    // just closed is now part of the history, which the next open re-reads.
    await waitFor(() => expect(history()).not.toHaveAttribute('open'))
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(1)
    await openPast()
    expect(shoppingApi.readClosedRuns).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// #360 — putting a list away, from App.
//
// The half only App can answer: that both writes go through `mutate()` (write,
// then a full re-read), and that the list the picker shows follows the read
// rather than a second copy of it. What the tab DRAWS for an archived list is
// Shopping.test.jsx's, what the module sends is shopping.io.test.js's, and what
// the database refuses is archive-shopping-list.pglite.test.js's.
//
// The fallback is the interesting one and it is asserted nowhere else:
// archiving the list on screen leaves `shoppingListId` naming a list the
// visible set no longer holds, and `resolveSelectedListId` is what turns that
// into "the first active list by name" rather than an empty tab.
// ---------------------------------------------------------------------------
describe('#360 — archiving a list, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const groceries = {
    id: 'l1',
    household_id: 'h1',
    name: 'Groceries',
    created_at: '2026-09-05T00:00:00Z',
    archived_at: null,
  }
  const hardware = {
    id: 'l2',
    household_id: 'h1',
    name: 'Hardware',
    created_at: '2026-09-06T00:00:00Z',
    archived_at: null,
  }
  const AWAY = '2026-09-06T12:00:00Z'
  const openRunOf = (list, id) => ({
    id,
    list_id: list.id,
    household_id: list.household_id,
    opened_at: '2026-09-05T00:00:00Z',
    closed_at: null,
    closed_by_member_id: null,
  })
  const runA = openRunOf(groceries, 'r1')
  const runB = openRunOf(hardware, 'r2')
  // Both runs are EMPTY, which is not a convenience: `0035` refuses an archive
  // while the open run holds anything, so a fixture with items on the list
  // being archived would be a state the database cannot produce.
  const twoLists = { lists: [groceries, hardware], runs: [runA, runB], items: [] }
  /** The same household after Hardware has been put away. */
  const oneAway = {
    lists: [groceries, { ...hardware, archived_at: AWAY }],
    runs: [runA, runB],
    items: [],
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    shoppingApi.readShopping.mockResolvedValue(twoLists)
  })

  const tab = (name) => act(async () => void fireEvent.click(screen.getByRole('button', { name })))
  const shop = () => screen.getByRole('region', { name: 'Shop' })
  const pickerNames = () => {
    const group = screen.queryByRole('group', { name: /which list/i })
    if (!group) return null
    return Array.from(group.querySelectorAll('.shopping-picker__name')).map((n) => n.textContent)
  }

  it('AC 3: Archive goes through archiveList with the list on screen, then re-reads', async () => {
    await renderApp('Shop')
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
    // Onto the SECOND list, so the id this asserts is the one on screen rather
    // than the first by name — which is what the tab lands on and what a
    // handler passing the wrong thing would most likely send.
    await tab(/^hardware/i)

    shoppingApi.readShopping.mockResolvedValue(oneAway)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/^archive hardware$/i)

    expect(shoppingApi.archiveList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.archiveList).toHaveBeenCalledWith(SHOPPING_CLIENT, 'l2')
    // Through mutate(): written, THEN re-read. The write is what changes which
    // lists exist, so a screen that did not re-read would be showing the answer
    // from before the tap.
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    expect(shoppingApi.archiveList.mock.invocationCallOrder[0]).toBeLessThan(
      shoppingApi.readShopping.mock.invocationCallOrder.at(-1),
    )
  })

  it('AC 3: the archived list leaves the picker, and the tab falls back to the first active list', async () => {
    await renderApp('Shop')
    // Stand on Hardware, so the list being archived is the one on screen —
    // the only case where the fallback has anything to do.
    await tab(/^hardware/i)
    expect(screen.getByRole('button', { name: /^archive hardware$/i })).toBeInTheDocument()

    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await tab(/^archive hardware$/i)

    // One visible list, so #358's one-button rule takes the picker away and the
    // heading carries the name again.
    await waitFor(() => expect(pickerNames()).toBeNull())
    expect(within(shop()).getByRole('heading', { level: 3 })).toHaveTextContent('Groceries')
    expect(within(shop()).queryByText(/put away/i)).not.toBeInTheDocument()
    // And the way back is offered, with the count.
    expect(screen.getByRole('button', { name: 'Show archived (1)' })).toBeInTheDocument()
  })

  it('AC 3: revealing the archived lists puts them back in the picker and lets one be chosen', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await renderApp('Shop')
    expect(pickerNames()).toBeNull()

    await tab('Show archived (1)')
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
    // Nothing was written to reveal them — it is a view change.
    expect(shoppingApi.archiveList).not.toHaveBeenCalled()
    expect(shoppingApi.unarchiveList).not.toHaveBeenCalled()

    await tab(/^hardware/i)
    expect(within(shop()).getByText(/put away/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive Hardware' })).toBeInTheDocument()
    // An archived list on screen offers none of the working controls.
    expect(within(shop()).queryByLabelText(/^item$/i)).not.toBeInTheDocument()
  })

  it('AC 3: Unarchive goes through unarchiveList, re-reads, and the list comes back working', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await renderApp('Shop')
    await tab('Show archived (1)')
    await tab(/^hardware/i)

    shoppingApi.readShopping.mockResolvedValue(twoLists)
    const readsBefore = shoppingApi.readShopping.mock.calls.length
    await tab(/^unarchive hardware$/i)

    expect(shoppingApi.unarchiveList).toHaveBeenCalledTimes(1)
    expect(shoppingApi.unarchiveList).toHaveBeenCalledWith(SHOPPING_CLIENT, 'l2')
    await waitFor(() =>
      expect(shoppingApi.readShopping.mock.calls.length).toBeGreaterThan(readsBefore),
    )
    // Still the list on screen — it was in the visible set under both settings
    // of the toggle — and it works again.
    expect(within(shop()).queryByText(/put away/i)).not.toBeInTheDocument()
    expect(within(shop()).getByLabelText(/^item$/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument()
  })

  it('the toggle survives a tab switch, because which list this phone is looking at is not a fact about the household', async () => {
    shoppingApi.readShopping.mockResolvedValue(oneAway)
    await renderApp('Shop')
    await tab('Show archived (1)')
    await tab(/^hardware/i)
    expect(within(shop()).getByText(/put away/i)).toBeInTheDocument()

    // `Shopping` unmounts on a tab switch, so a toggle held inside it would
    // last exactly as long as the person stayed on the screen.
    await tab(/^chores$/i)
    await tab(/^shop$/i)
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
    expect(within(shop()).getByText(/put away/i)).toBeInTheDocument()
  })

  it('AC 3: a refused archive reaches the strip outside the list, and nothing is re-read', async () => {
    await renderApp('Shop')
    await tab(/^hardware/i)
    shoppingApi.archiveList.mockRejectedValue(
      new Error('archiving the list: finish or clear this run first'),
    )
    const readsBefore = shoppingApi.readShopping.mock.calls.length

    await tab(/^archive hardware$/i)

    const alert = within(shop()).getByRole('alert')
    expect(alert).toHaveTextContent('archiving the list: finish or clear this run first')
    expect(alert.closest('ul, li, form')).toBeNull()
    // `mutate()` does not re-read after a failed write, and the picker is
    // exactly where it was.
    expect(shoppingApi.readShopping.mock.calls.length).toBe(readsBefore)
    expect(pickerNames()).toEqual(['Groceries', 'Hardware'])
  })

  it('a household whose only list is archived is not told it has none', async () => {
    shoppingApi.readShopping.mockResolvedValue({
      lists: [{ ...groceries, archived_at: AWAY }],
      runs: [runA],
      items: [],
    })
    await renderApp('Shop')
    expect(within(shop()).queryByText(/no shopping list yet/i)).not.toBeInTheDocument()
    expect(within(shop()).getByText(/every list is put away/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show archived (1)' })).toBeInTheDocument()
  })
})

// #342 — the REAL debounce constant, through the same importActual the mock
// spreads, so the wait below is the app's and not a number copied here.
const actualRealtime = await vi.importActual('./lib/realtime.js')

describe('#342 — the app updates itself when the household changes', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const roster = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
    { id: 'm2', display_name: 'Placeholder Two', weekly_minutes: 90, claimed_by: null },
  ]
  const chore = {
    id: 'c1',
    household_id: 'h1',
    title: 'Placeholder Chore',
    expected_minutes: 20,
    due_on: '2026-08-10',
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue(roster)
    choresApi.listChores.mockResolvedValue([chore])
    // jsdom reports the page as visible only when told to; the handler reads
    // this property, so it is pinned per test and removed after.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })
  afterEach(() => {
    delete document.visibilityState
  })

  /** The arguments of the most recent channel App opened. */
  const channel = () => realtimeApi.subscribeToHousehold.mock.calls.at(-1)[0]
  /** The `close` of the n-th channel App opened. */
  const closeOf = (n) => realtimeApi.subscribeToHousehold.mock.results[n].value.close
  /** How many full reads have run — `listHouseholds` is `refresh()`'s first call. */
  const reads = () => api.listHouseholds.mock.calls.length
  const joined = () => screen.findByRole('button', { name: 'Chores' })
  const pause = (ms) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

  it('AC 2: opens ONE channel on the household on screen, scoped by its roster, once joined', async () => {
    await renderApp()
    await joined()
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
    // The household and the member ids travel — the server filters on them.
    expect(channel()).toMatchObject({ householdId: 'h1', memberIds: ['m1', 'm2'] })
    expect(typeof channel().onChange).toBe('function')
    expect(typeof channel().onReconnect).toBe('function')
  })

  it('opens no channel for a person who is signed out, nor for one with no household yet', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(realtimeApi.subscribeToHousehold).not.toHaveBeenCalled()
    cleanup()
    api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
    api.listHouseholds.mockResolvedValue([])
    await renderApp()
    await screen.findByRole('button', { name: /create household/i })
    expect(realtimeApi.subscribeToHousehold).not.toHaveBeenCalled()
  })

  it('AC 2: a change another phone made is a full re-read, with nobody pressing anything', async () => {
    await renderApp()
    await joined()
    const before = reads()
    const chorReadsBefore = choresApi.listChores.mock.calls.length
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    // The whole of refresh(), not a patch from the payload: the chores were
    // re-read too, and the payload carried none of them.
    await waitFor(() => expect(choresApi.listChores.mock.calls.length).toBe(chorReadsBefore + 1))
  })

  it('AC 3: a re-join after a drop is a re-read — the catch-up for what was missed', async () => {
    await renderApp()
    await joined()
    const before = reads()
    await act(async () => void channel().onReconnect())
    await waitFor(() => expect(reads()).toBe(before + 1))
  })

  it('AC 5: an own write followed by its echoes is TWO reads, never one per echo', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')
    // Hold the write's own re-read open, so the echoes land while it is in flight.
    let release
    api.listHouseholds.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([household])
        }),
    )
    const before = reads()
    fireEvent.change(screen.getByLabelText(/^chore$/i), { target: { value: 'Dishes' } })
    fireEvent.change(screen.getByLabelText(/expected minutes/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/^due$/i), { target: { value: '2026-08-10' } })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /add chore/i })))
    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    // Three echoes — the insert on `chores`, say, seen through three bindings
    // or three phones' worth of the same second — while the write's read runs.
    await act(async () => {
      channel().onChange({ eventType: 'INSERT', table: 'chores' })
      channel().onChange({ eventType: 'INSERT', table: 'chores' })
      channel().onChange({ eventType: 'INSERT', table: 'chores' })
    })
    // Nothing ran concurrently with the read in flight.
    expect(reads()).toBe(before + 1)
    await act(async () => void release())
    // Exactly one more, for all three.
    await waitFor(() => expect(reads()).toBe(before + 2))
    await pause(30)
    expect(reads()).toBe(before + 2)
  })

  it('AC 5: an echo that lands AFTER the write has re-read is a read of its own', async () => {
    await renderApp()
    await joined()
    const before = reads()
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(before + 2))
  })

  it('AC 1: the tab coming back is ONE read, however many focus events it fires', async () => {
    await renderApp()
    await joined()
    const before = reads()
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })
    // Debounced: nothing has run yet.
    expect(reads()).toBe(before)
    await waitFor(() => expect(reads()).toBe(before + 1))
    await pause(actualRealtime.REFRESH_DEBOUNCE_MS * 2)
    expect(reads()).toBe(before + 1)
  })

  it('AC 1: a focus event on the sign-in screen reads nothing', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await pause(actualRealtime.REFRESH_DEBOUNCE_MS * 2)
    expect(api.listHouseholds).not.toHaveBeenCalled()
  })

  it('closes the channel on sign-out, and opens none for the screen that follows', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
    const close = closeOf(0)
    expect(close).not.toHaveBeenCalled()
    // After the sign-out the server has no household for nobody.
    api.listHouseholds.mockResolvedValue([])
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(api.signOut).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
  })

  it('a household switch closes the old channel and opens one on the new household', async () => {
    await renderApp()
    await joined()
    const close = closeOf(0)
    // #164 built the switcher, and this test deliberately does NOT use it: the
    // subject here is the READ coming back different, which is what a Realtime
    // echo produces and what a switch also produces. Driving it through the
    // read keeps this about the channel rather than about the control.
    api.listHouseholds.mockResolvedValue([{ ...household, id: 'h2' }])
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'households' }))
    await waitFor(() => expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(2))
    expect(close).toHaveBeenCalledTimes(1)
    expect(channel()).toMatchObject({ householdId: 'h2', memberIds: ['m1', 'm2'] })
  })

  it('a roster change re-scopes the channel to the new member set, and a re-read that changes nothing does not', async () => {
    await renderApp()
    await joined()
    // A re-read returning the same ids: refresh() hands back new objects, and
    // the channel must not be torn down for them.
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    await waitFor(() => expect(reads()).toBe(2))
    expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(1)
    expect(closeOf(0)).not.toHaveBeenCalled()
    // A member joins on another phone.
    api.listMembers.mockResolvedValue([
      ...roster,
      { id: 'm3', display_name: 'Placeholder Three', weekly_minutes: 60, claimed_by: null },
    ])
    await act(async () => void channel().onChange({ eventType: 'INSERT', table: 'members' }))
    await waitFor(() => expect(realtimeApi.subscribeToHousehold).toHaveBeenCalledTimes(2))
    expect(closeOf(0)).toHaveBeenCalledTimes(1)
    expect(channel().memberIds).toEqual(['m1', 'm2', 'm3'])
  })

  it('a failed background read lands on the error strip and takes nothing else down', async () => {
    await renderApp()
    await joined()
    api.listHouseholds.mockRejectedValueOnce(new Error('the network went away for a moment'))
    await act(async () => void channel().onChange({ eventType: 'UPDATE', table: 'chores' }))
    expect(await screen.findByText(/the network went away for a moment/)).toBeInTheDocument()
    // Still the joined shell, still listening.
    expect(screen.getByRole('button', { name: 'Chores' })).toBeInTheDocument()
    expect(closeOf(0)).not.toHaveBeenCalled()
  })
})

// #101 — importing a calendar event as a chore, at the level only App can
// answer: the WIRING. Chores.test.jsx covers what the section DRAWS and which
// handler a tap reaches; everything here is about what App does with that —
// which read fills the "already imported" marks, which write the confirm
// reaches and in what order, and what happens on the phone that loses the race.
describe('importing a calendar event as a chore (#101)', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }
  const housemate = {
    id: 'm2',
    display_name: 'Placeholder Two',
    weekly_minutes: 300,
    claimed_by: 'person-b',
    email: 'placeholder.two@example.test',
  }
  const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'
  const READONLY = 'https://www.googleapis.com/auth/calendar.readonly'
  const narrow = { id: 'c1', member_id: 'm1', scope: FREEBUSY, connected_at: '2026-08-24T00:00:00Z' }
  const widened = { ...narrow, scope: `${FREEBUSY} ${READONLY}` }
  const event = {
    id: 'evt-1',
    title: 'Placeholder Event',
    start: '2026-09-10T17:00:00.000Z',
    end: '2026-09-10T18:30:00.000Z',
    allDay: false,
    durationMinutes: 90,
    dueOn: '2026-09-10',
  }

  let assign
  let realLocation

  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    assign = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search: '', hash: '', assign },
    })
    globalThis.sessionStorage?.clear?.()
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me, housemate])
    calendarApi.listCalendarConnections.mockResolvedValue([widened])
    calendarApi.fetchCalendarEvents.mockResolvedValue({ ok: true, events: [event] })
    choresApi.addChore.mockResolvedValue({ id: 'c-new', title: 'Placeholder Event' })
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
  })

  const inChores = () => within(screen.getByRole('region', { name: /what needs doing/i }))
  const openImport = () =>
    act(
      async () =>
        void fireEvent.click(inChores().getByRole('button', { name: /import from calendar/i })),
    )
  const pickEvent = () =>
    act(
      async () =>
        void fireEvent.click(inChores().getByRole('button', { name: /import placeholder event/i })),
    )
  const submitAdd = () =>
    act(async () => void fireEvent.click(inChores().getByRole('button', { name: /add chore/i })))

  it('reads the import ledger BY HOUSEHOLD on every refresh, like every other row', async () => {
    await renderApp('Chores')
    expect(calendarApi.listCalendarImports).toHaveBeenCalledWith('h1')
  })

  it('offers the import on the Chores tab to a member whose OWN calendar is connected', async () => {
    await renderApp('Chores')
    expect(inChores().getByRole('button', { name: /import from calendar/i })).toBeInTheDocument()
  })

  it('offers nothing when only a housemate is connected — their calendar is not this phone’s to read', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([{ ...widened, member_id: 'm2' }])
    await renderApp('Chores')
    expect(inChores().queryByRole('button', { name: /import from calendar/i })).not.toBeInTheDocument()
  })

  it('AC 1: a free/busy-only connection gets the consent step, and Allow leaves for Google with the readonly scope ADDED', async () => {
    calendarApi.listCalendarConnections.mockResolvedValue([narrow])
    await renderApp('Chores')
    await openImport()
    expect(inChores().getByTestId('import-consent')).toBeInTheDocument()
    // Nothing was asked of the Edge Function: the row already says the scope
    // is too narrow, and a call would only be refused.
    expect(calendarApi.fetchCalendarEvents).not.toHaveBeenCalled()

    await act(
      async () =>
        void fireEvent.click(inChores().getByRole('button', { name: /allow reading events/i })),
    )
    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0])
    // `startConnect` is REAL here, so this is the URL the app would send.
    expect(url.searchParams.get('scope')).toBe(READONLY)
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('prompt')).toBe('consent')
    // The household on screen travels with the state, so the widened token
    // lands on the connection the member was looking at (#161's rule).
    expect(globalThis.sessionStorage.getItem('taskr.calendar.consent-household')).toBe('h1')
  })

  it('AC 2: opening the section asks the function for THIS household and THIS week, and lists what came back', async () => {
    await renderApp('Chores')
    await openImport()
    await waitFor(() => expect(calendarApi.fetchCalendarEvents).toHaveBeenCalledTimes(1))
    const [call] = calendarApi.fetchCalendarEvents.mock.calls
    expect(call[0].householdId).toBe('h1')
    expect(call[0].periodStart).toBe(actualCapacity.periodStartFor(new Date(), household.timezone))
    expect(await inChores().findByText('Placeholder Event')).toBeInTheDocument()
    // Listing wrote nothing: no addChore, no ledger row.
    expect(choresApi.addChore).not.toHaveBeenCalled()
    expect(calendarApi.recordCalendarImport).not.toHaveBeenCalled()
  })

  it('AC 3 / AC 4: Use prefills the form, and Add writes the chore through addChore with source calendar, THEN the ledger row naming it', async () => {
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    await pickEvent()

    // The prefill is the data layer's, shown in the form the member already knows.
    expect(inChores().getByLabelText(/^chore$/i)).toHaveValue('Placeholder Event')
    expect(inChores().getByLabelText(/expected minutes/i)).toHaveValue(90)
    expect(inChores().getByLabelText(/^due$/i)).toHaveValue('2026-09-10')
    expect(inChores().getByTestId('import-source')).toHaveTextContent(/from your calendar/i)
    // Nothing written by picking.
    expect(choresApi.addChore).not.toHaveBeenCalled()

    // The member edits the minutes — editable before save is the criterion —
    // and confirms with the ordinary Add.
    fireEvent.change(inChores().getByLabelText(/expected minutes/i), { target: { value: '60' } })
    await submitAdd()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    expect(choresApi.addChore).toHaveBeenCalledWith({
      title: 'Placeholder Event',
      expectedMinutes: '60',
      dueOn: '2026-09-10',
      repeatKind: 'none',
      repeatWeekdays: [],
      repeatMonthday: '',
      source: 'calendar',
      householdId: 'h1',
    })
    expect(calendarApi.recordCalendarImport).toHaveBeenCalledWith({
      householdId: 'h1',
      memberId: 'm1',
      calendarEventId: 'evt-1',
      choreId: 'c-new',
    })
    // ORDER: the chore first, then the row naming it — the ledger needs the id
    // the write returned, and this is what makes the race resolve the way
    // 0038's header says.
    expect(choresApi.addChore.mock.invocationCallOrder[0]).toBeLessThan(
      calendarApi.recordCalendarImport.mock.invocationCallOrder[0],
    )
    // No second write path: addChores was never touched.
    expect(choresApi.addChores).not.toHaveBeenCalled()
    // And the screen re-read, like every other write.
    expect(choresApi.listChores.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('AC 5: already-imported events are marked from the ledger and offer no Use', async () => {
    calendarApi.listCalendarImports.mockResolvedValue([
      { id: 'i1', household_id: 'h1', member_id: 'm2', calendar_event_id: 'evt-1', chore_id: 'c9' },
    ])
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    expect(inChores().getByTestId('imported-evt-1')).toHaveTextContent(/already imported/i)
    expect(
      inChores().queryByRole('button', { name: /import placeholder event/i }),
    ).not.toBeInTheDocument()
  })

  it('AC 5: on the phone that LOSES the race, the ledger’s refusal removes the chore just created and says so', async () => {
    const refused = new Error('That event is already on the list as a chore.')
    refused.alreadyImported = true
    calendarApi.recordCalendarImport.mockRejectedValue(refused)
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    await pickEvent()
    await submitAdd()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    expect(choresApi.removeChore).toHaveBeenCalledWith('c-new')
    expect(await inChores().findByText(/already on the list as a chore/i)).toBeInTheDocument()
  })

  it('a ledger failure for any OTHER reason leaves the chore standing — the household still wants it', async () => {
    calendarApi.recordCalendarImport.mockRejectedValue(
      new Error('recording the import: the network went away'),
    )
    await renderApp('Chores')
    await openImport()
    await inChores().findByText('Placeholder Event')
    await pickEvent()
    await submitAdd()

    expect(choresApi.addChore).toHaveBeenCalledTimes(1)
    expect(choresApi.removeChore).not.toHaveBeenCalled()
    expect(await inChores().findByText(/the network went away/i)).toBeInTheDocument()
  })

  it('a stale connection row: the function’s own scope refusal lands as the consent step, not as an outage', async () => {
    const refused = new Error(
      'This calendar is connected for free/busy only. Allow Taskr to read events to import one.',
    )
    refused.needsScope = true
    calendarApi.fetchCalendarEvents.mockRejectedValue(refused)
    await renderApp('Chores')
    await openImport()
    expect(await inChores().findByTestId('import-consent')).toBeInTheDocument()
    expect(inChores().getByRole('button', { name: /allow reading events/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// #164 / #165 / #166 — more than one household on one device.
//
// The three stories ship together because each is only observable through the
// next: a switcher with nothing to switch to, a remembered choice with no way
// to make one, and a second household nobody can reach. Names are synthetic —
// see #19.
//
// EVERY assertion here is about a RE-READ, not about local state. #164 AC 2
// says so in as many words ("asserted as a re-read of the five data-layer
// calls, not as a local state change"), and it is the criterion the obvious
// implementation fails: filtering data this device already holds would put the
// right household on screen and show its chores as of whenever the app last
// looked.
// ---------------------------------------------------------------------------

const HOUSEHOLD_ONE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Placeholder Household',
  timezone: 'America/New_York',
  organizer_member_id: 'm1',
  created_at: '2026-01-01T00:00:00Z',
}
const HOUSEHOLD_TWO = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Placeholder Other Household',
  timezone: 'America/New_York',
  organizer_member_id: 'm9',
  created_at: '2026-02-01T00:00:00Z',
}

describe('#164 — holding more than one household and moving between them', () => {
  // The person is `person-a`, and they are the ORGANIZER of the second
  // household and an ordinary member of the first. That asymmetry is AC 5's
  // subject: organizer controls must follow the household, not the person.
  const inOne = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-b' },
    { id: 'm2', display_name: 'Placeholder Everywhere', weekly_minutes: 60, claimed_by: 'person-a' },
  ]
  // TWO members, and the second one is load-bearing: self-removal is forbidden
  // (0007's `members_delete_same_household` carries `claimed_by is distinct
  // from auth.uid()`), so a household where the organizer is the only member
  // offers no Remove control at all — and AC 5's assertion would then be
  // reading the household size rather than who organises it.
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Everywhere', weekly_minutes: 90, claimed_by: 'person-a' },
    { id: 'm10', display_name: 'Placeholder Two', weekly_minutes: 30, claimed_by: null },
  ]

  /** Answer every scoped read according to which household was asked for. */
  const scopedByHousehold = () => {
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOUSEHOLD_TWO.id
        ? [{ id: 'c9', title: 'Placeholder Other Chore', expected_minutes: 15, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }]
        : [{ id: 'c1', title: 'Placeholder Chore', expected_minutes: 30, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }],
    )
  }

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
    scopedByHousehold()
  })

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })
  const switchTo = async (id) =>
    act(async () => void fireEvent.change(switcher(), { target: { value: id } }))

  // AC 1 — the name becomes a control listing every household, in the
  // deterministic order. Asserted through App rather than only in the
  // component's own file, because what is on trial here is that App HANDS it
  // the whole list: a version passing `[household]` renders a control the
  // component test would still pass.
  it('AC 1: the shell names every household this person belongs to, in order', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(Array.from(switcher().options).map((o) => o.textContent)).toEqual([
      'Placeholder Household',
      'Placeholder Other Household',
    ])
  })

  // AC 3 — and it is asserted as the PREVIOUS story's element, not merely as
  // the absence of a control, so a version that rendered nothing at all would
  // fail. #163's screen has to be intact for everybody who has one household.
  it('AC 3: a person in exactly one household is offered no control, and sees #163 name', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    await renderApp()
    await screen.findByText('Placeholder Household')

    expect(screen.queryByRole('combobox', { name: 'Household' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell__household')).toHaveTextContent('Placeholder Household')
  })

  // AC 4 — no stored choice, so the app opens on the deterministic default the
  // owner chose: OLDEST by created_at. The fixture's second household is the
  // NEWER one, so a version defaulting to most-recently-joined fails here.
  it('AC 4: with no choice stored, the app opens on the oldest household', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(switcher()).toHaveValue(HOUSEHOLD_ONE.id)
    expect(api.listMembers).toHaveBeenCalledWith(HOUSEHOLD_ONE.id)
    expect(api.listMembers).not.toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 2 — THE criterion. Every scoped read runs again, against the newly
  // chosen household, and the five named in the story are asserted by the id
  // they were given rather than by a call count.
  it('AC 2: choosing another household RE-READS every surface against it', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    // The reads that have happened so far all name household one.
    expect(api.listMembers).not.toHaveBeenCalledWith(HOUSEHOLD_TWO.id)

    await switchTo(HOUSEHOLD_TWO.id)

    // The reads that take a HOUSEHOLD ID, each asked about the new one.
    expect(api.listMembers).toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
    expect(choresApi.listChores).toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
    expect(shoppingApi.readShopping).toHaveBeenCalledWith(SHOPPING_CLIENT, HOUSEHOLD_TWO.id)
    expect(calendarApi.listCalendarImports).toHaveBeenCalledWith(HOUSEHOLD_TWO.id)
    // The reads that take the MEMBER SET rather than a household id (0025's
    // reasoning), asserted through the roster that scopes them. `listCapacity`
    // is here because an earlier version of this comment NAMED it among the
    // three and asserted only the other two — a comment vouching for an
    // assertion that did not exist, found by review-fanout. It is the read that
    // decides whose minutes the split is drawn from, so leaving it unasserted
    // while claiming it was covered is the worst of the three.
    expect(exclusionsApi.listExclusions).toHaveBeenLastCalledWith(inTwo.map((m) => m.id))
    expect(calendarApi.listCalendarConnections).toHaveBeenLastCalledWith(inTwo.map((m) => m.id))
    expect(capacityApi.listCapacity).toHaveBeenLastCalledWith(
      expect.anything(),
      inTwo.map((m) => m.id),
    )
    // STILL UNASSERTED, and said out loud rather than left to be assumed:
    // `listRepeatExceptions` (its scope is the ANCHOR ids out of the chores
    // just read, so it is covered transitively by `listChores` above) and
    // `listBusyWeeks`. Neither is claimed by this test. The PERIOD half of
    // `listCapacity` is also not discriminated here and cannot be with this
    // fixture: both households carry `America/New_York`, so a period computed
    // from the stale household is byte-identical — separating it needs two
    // timezones, which is a different test than this one.
  })

  it('AC 2: and it happens without a page reload or a sign-out', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    await switchTo(HOUSEHOLD_TWO.id)

    expect(api.signOut).not.toHaveBeenCalled()
    // Still the same mounted app: the switcher is the control it was, now
    // showing the other household.
    expect(switcher()).toHaveValue(HOUSEHOLD_TWO.id)
  })

  // AC 5 — `me` and `isOrganizer` resolve WITHIN the newly active household.
  // The fixture is built so the two answers differ: `person-a` organises
  // household two and merely belongs to household one, so a version that
  // resolved identity against the wrong household would show organizer
  // controls in the household they do not organise.
  it('AC 5: who you are and what you organise are recomputed in the new household', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /who is in the household/i })
    const inRoster = () => within(screen.getByRole('region', { name: /who is in the household/i }))

    // In household one they are an ordinary member: no Remove control, which
    // #152 gates on isOrganizer. Matched on the control's ACCESSIBLE name,
    // which #152 built as `Remove <member>` so that a row's control names the
    // person it acts on — a bare /^remove$/ matches nothing here and would have
    // passed this assertion for the wrong reason.
    expect(inRoster().queryByRole('button', { name: /^remove /i })).not.toBeInTheDocument()

    await switchTo(HOUSEHOLD_TWO.id)
    await screen.findByText('Placeholder Everywhere')

    // In household two they organise, so the organizer control appears.
    expect(inRoster().getAllByRole('button', { name: /^remove /i }).length).toBeGreaterThan(0)
  })

  // AC 6 — the surface is where they are, not what they are looking at.
  it('AC 6: somebody on the Chores surface stays there, showing the other household chores', async () => {
    await renderApp('Chores')
    await screen.findByText('Placeholder Chore')

    await switchTo(HOUSEHOLD_TWO.id)

    // Still the Chores surface…
    expect(screen.getByRole('button', { name: 'Chores' })).toHaveAttribute('aria-current', 'page')
    // …and it is the other household's chore list.
    expect(await screen.findByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
  })

  // AC 8's end-to-end half. The re-read is what this asserts, and the mutation
  // that removes it is recorded in the story comment.
  it('AC 8: switching is asserted end to end — the other household roster is on screen', async () => {
    await renderApp('Who')
    await screen.findByText('Placeholder One')

    await switchTo(HOUSEHOLD_TWO.id)

    expect(await screen.findByText('Placeholder Everywhere')).toBeInTheDocument()
    // Household one's other member is gone, which is the half that proves the
    // roster was replaced rather than added to.
    expect(screen.queryByText('Placeholder One')).not.toBeInTheDocument()
  })
})

describe('#165 — remembering which household was last chosen on this device', () => {
  const inOne = [
    { id: 'm1', display_name: 'Placeholder One', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Everywhere', weekly_minutes: 90, claimed_by: 'person-a' },
  ]

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
  })

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })

  // AC 1 — the whole point. `cleanup()` between the two renders is this suite's
  // way of closing and reopening the app: the component tree is destroyed, so
  // anything that survives did so through storage rather than through React.
  it('AC 1: the household chosen before the app closed is active when it reopens', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HOUSEHOLD_TWO.id } }),
    )
    expect(switcher()).toHaveValue(HOUSEHOLD_TWO.id)

    cleanup()
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(switcher()).toHaveValue(HOUSEHOLD_TWO.id)
    // And the reads on THIS load named it — the choice reached the data layer,
    // rather than only the control.
    expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 2 — a membership that has gone. The stored id names a household the
  // person no longer belongs to, so the read no longer returns it.
  it('AC 2: a stored household outside the membership set is discarded, silently', async () => {
    window.localStorage.setItem('taskr.activeHousehold', HOUSEHOLD_TWO.id)
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])

    await renderApp()
    await screen.findByText('Placeholder Household')

    // The deterministic default, and no error anywhere on screen.
    expect(api.listMembers).toHaveBeenCalledWith(HOUSEHOLD_ONE.id)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // DISCARDED, not merely ignored: the dead id is gone from storage, so it
    // is not re-rejected on every load for the life of the device.
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBeNull()
  })

  // AC 3 — a value that was never a household id at all.
  //
  // WHAT THIS TEST CANNOT SEPARATE, measured rather than assumed: mutating the
  // uuid pattern to accept everything leaves it GREEN. With the check gone the
  // junk reaches `resolveActiveHousehold`, is not in the membership set, and
  // falls back to the same default — then App's own discard clears the same
  // key. Two different mechanisms, one observable, and at this level there is
  // no fixture that tells them apart, because a value that is not a uuid can
  // never name a household either way. So this asserts the OUTCOME the
  // criterion asks for, and the shape check itself is discriminated in
  // `activeHousehold.test.js`, where the same mutation reddens 7. Said out loud
  // because a reader counting this as coverage of the check would be wrong.
  it('AC 3: a stored value that is not a uuid is discarded and the default is used', async () => {
    window.localStorage.setItem('taskr.activeHousehold', 'not-a-uuid')

    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })

    expect(switcher()).toHaveValue(HOUSEHOLD_ONE.id)
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // AC 7 — a shared tablet must not select a household for the next person.
  it('AC 7: signing out forgets the household this device had chosen', async () => {
    await renderApp()
    await screen.findByRole('combobox', { name: 'Household' })
    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HOUSEHOLD_TWO.id } }),
    )
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(HOUSEHOLD_TWO.id)

    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Who' })))
    await screen.findByRole('region', { name: /who is in the household/i })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))

    expect(api.signOut).toHaveBeenCalledWith({ everywhere: false })
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBeNull()
  })

  // AC 8 — private mode. The accessor itself throws, which is what a browser
  // set to block site data actually does; the app must render on the default
  // rather than failing to boot.
  it('AC 8: a device whose storage throws still opens, on the deterministic default', async () => {
    // A getter on the global, NOT a Proxy — measured: a Proxy's `get` trap does
    // not fire when `globalThis.localStorage` is read, so the proxy form left
    // the accessor guard unexecuted. `activeHousehold.test.js` carries the
    // measurement.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      await renderApp()
      await screen.findByRole('combobox', { name: 'Household' })

      expect(switcher()).toHaveValue(HOUSEHOLD_ONE.id)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      // And a switch still works — it just is not remembered.
      await act(
        async () => void fireEvent.change(switcher(), { target: { value: HOUSEHOLD_TWO.id } }),
      )
      expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete globalThis.localStorage
    }
  })
})

describe('#166 — starting another household without signing out', () => {
  const inOne = [
    { id: 'm1', display_name: 'Placeholder Everywhere', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Everywhere', weekly_minutes: 120, claimed_by: 'person-a' },
  ]

  const inCard = () => within(screen.getByRole('region', { name: /start another household/i }))

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOUSEHOLD_TWO.id
        ? [{ id: 'c9', title: 'Placeholder Other Chore', expected_minutes: 15, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }]
        : [{ id: 'c1', title: 'Placeholder Chore', expected_minutes: 30, due_on: '2026-08-10', completed_at: null, completed_by_member_id: null, assigned_member_id: null, actual_minutes: null }],
    )
    // The write succeeds and the read that follows sees both households — the
    // ordinary shape of `mutate()`, and the reason the fixture cannot simply
    // return a static list.
    api.createHousehold.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE, HOUSEHOLD_TWO])
      return HOUSEHOLD_TWO
    })
  })

  const startAnother = async (name = 'Placeholder Other Household') => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /start another household/i })
    fireEvent.change(inCard().getByLabelText(/household name/i), { target: { value: name } })
    await act(
      async () => void fireEvent.click(inCard().getByRole('button', { name: 'Create household' })),
    )
  }

  // The hole the story exists to fill, stated as the state BEFORE the change:
  // `createHousehold` had one call site and it was behind onboarding.
  it('AC 1: a person already in a household is offered a way to start another', async () => {
    await renderApp('Who')
    expect(
      await screen.findByRole('region', { name: /start another household/i }),
    ).toBeInTheDocument()
  })

  it('AC 1: their own name is prefilled from the household they are already in', async () => {
    await renderApp('Who')
    await screen.findByRole('region', { name: /start another household/i })
    expect(inCard().getByLabelText(/your name in it/i)).toHaveValue('Placeholder Everywhere')
  })

  it('AC 1: creating one names it, with this person as its organizer', async () => {
    await startAnother()

    expect(api.createHousehold).toHaveBeenCalledTimes(1)
    expect(api.createHousehold).toHaveBeenCalledWith('Placeholder Other Household', {
      organizerName: 'Placeholder Everywhere',
    })
  })

  // AC 1's second half and the one the ordering makes easy to get wrong: the
  // new household sorts LAST by created_at, so the deterministic default would
  // take the person straight back to the household they started from.
  it('AC 1: and the new household becomes the active one', async () => {
    await startAnother()

    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
    expect(api.listMembers).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 6 — the switcher now lists two, and the active one is the new one.
  it('AC 6: the switcher lists both households, with the new one active', async () => {
    await startAnother()

    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(Array.from(switcher.options).map((o) => o.textContent)).toEqual([
      'Placeholder Household',
      'Placeholder Other Household',
    ])
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
  })

  // AC 5 — a reload must not silently return them to the first household.
  it('AC 5: the stored choice is updated, so a reload does not go back', async () => {
    await startAnother()
    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(HOUSEHOLD_TWO.id)

    cleanup()
    await renderApp()
    const switcher = await screen.findByRole('combobox', { name: 'Household' })
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
  })

  // AC 3 — the new household's surfaces show its data ALONE.
  it('AC 3: every surface shows the new household data, and not the first', async () => {
    await startAnother()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))

    expect(await screen.findByText('Placeholder Other Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Chore')).not.toBeInTheDocument()
    expect(choresApi.listChores).toHaveBeenLastCalledWith(HOUSEHOLD_TWO.id)
  })

  // AC 4 — THE ROUND TRIP, and the criterion says why it is separate: "a
  // one-way test cannot tell scoping from a coincidence of ordering". A version
  // that showed the newest household's data for every read would pass AC 3 and
  // fail here.
  it('AC 4: switching back shows the first household data alone', async () => {
    await startAnother()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Chores' })))
    await screen.findByText('Placeholder Other Chore')

    await act(
      async () =>
        void fireEvent.change(screen.getByRole('combobox', { name: 'Household' }), {
          target: { value: HOUSEHOLD_ONE.id },
        }),
    )

    expect(await screen.findByText('Placeholder Chore')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder Other Chore')).not.toBeInTheDocument()
    expect(choresApi.listChores).toHaveBeenLastCalledWith(HOUSEHOLD_ONE.id)
  })

  // AC 7 — the existing onboarding path is untouched. A person in NO household
  // gets #154's screen, and the roster's card cannot be involved because there
  // is no roster.
  it('AC 7: somebody in no household still gets the onboarding path, unchanged', async () => {
    api.listHouseholds.mockResolvedValue([])
    await renderApp()

    expect(await screen.findByTestId('signed-in-note')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Start a household', level: 2 }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: /start another household/i }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/household name/i), { target: { value: 'Ours' } })
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alex' } })
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: 'Create household' })),
    )

    expect(api.createHousehold).toHaveBeenCalledWith('Ours', { organizerName: 'Alex' })
  })
})

// ---------------------------------------------------------------------------
// The review-fanout fixes, each with the test that makes it fail to remove.
//
// The first mutation pass on these three fixes reddened ZERO. That was
// PREDICTED — none of the three is observable from a test that only asserts
// after a switch has settled — and a predicted zero is still a zero: three
// corrections would have shipped that nothing could hold in place. These are
// the arrangements that observe them.
// ---------------------------------------------------------------------------

describe('#164/#166 — the review fan-out’s three, held in place', () => {
  const HH_A = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Placeholder Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm1',
    created_at: '2026-01-01T00:00:00Z',
    last_rebalance: {
      contested: true,
      level: true,
      reason: null,
      boundByBudget: false,
      jobsMoved: 1,
      minutesMoved: 90,
      changeBudgetMinutes: 120,
      applied_at: '2026-08-27T18:00:00+00:00',
    },
  }
  const HH_B = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Placeholder Other Household',
    timezone: 'America/New_York',
    organizer_member_id: 'm9',
    created_at: '2026-02-01T00:00:00Z',
    last_rebalance: null,
  }
  const inA = [
    { id: 'm1', household_id: HH_A.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
    { id: 'm2', household_id: HH_A.id, display_name: 'Placeholder Two', weekly_minutes: 300, claimed_by: null },
  ]
  const inB = [
    { id: 'm9', household_id: HH_B.id, display_name: 'Placeholder Everywhere', weekly_minutes: 200, claimed_by: 'person-a' },
  ]
  const choresA = [
    { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
    { id: 'c2', title: 'Placeholder Other Chore', expected_minutes: 50, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
  ]

  const switcher = () => screen.getByRole('combobox', { name: 'Household' })
  // The #342 block's helper, which is scoped to that describe. Redeclared here
  // rather than hoisted, because hoisting it would touch a block this story has
  // no business editing.
  const pause = (ms) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

  beforeEach(() => {
    api.listHouseholds.mockResolvedValue([HH_A, HH_B])
    api.listMembers.mockImplementation(async (id) => (id === HH_B.id ? inB : inA))
    choresApi.listChores.mockImplementation(async (id) => (id === HH_B.id ? [] : choresA))
  })

  // FINDING 6 — the announcement belongs to the household that produced it.
  //
  // Without the clear, household A's re-balance statement stands over B's
  // surfaces, read against B's member names — and pressing "Got it" there
  // SPENDS it, because `writeSplitSeen` advanced A's marker in the refresh that
  // produced it, so `announcementFrom` can never derive it again.
  it('an announcement about the old household does not follow the switch', async () => {
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: {
        members: [
          { id: 'm1', minutes: 90, capacityMinutes: 420 },
          { id: 'm2', minutes: 50, capacityMinutes: 300 },
        ],
      },
      seen_rebalance_at: '2026-08-27T09:00:00+00:00',
    })
    await renderApp()
    // The precondition: it really is on screen before the switch. Without this
    // the assertion below passes on a page that never had one.
    await screen.findByTestId('rebalance-announcement')

    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HH_B.id } }),
    )

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
  })

  // FINDING 1/5 — the name and the data land together.
  //
  // `setHousehold` used to sit above the roster read, so a switch whose roster
  // read FAILS left household B's name on the shell over household A's people.
  // With the two paired, a failed roster read leaves the whole screen on A and
  // puts the reason on the error strip — one household, coherently, plus a
  // sentence saying what went wrong.
  it('a switch whose roster read fails leaves the shell on the household it can still show', async () => {
    await renderApp('Who')
    await screen.findByText('Placeholder One')

    api.listMembers.mockRejectedValueOnce(new Error('the network went away for a moment'))
    await act(
      async () => void fireEvent.change(switcher(), { target: { value: HH_B.id } }),
    )

    // The name must not have moved ahead of the people underneath it.
    expect(switcher()).toHaveValue(HH_A.id)
    expect(screen.getByText('Placeholder One')).toBeInTheDocument()
    expect(await screen.findByText(/the network went away/i)).toBeInTheDocument()
  })

  // FINDING 2 — a read older than the choice may not overrule it.
  //
  // The arrangement is the whole test: hold a background read open at its FIRST
  // await, create a household while it is suspended, then release it. Its list
  // predates the new household, so without the epoch guard its discard branch
  // fires, clears the ref and wipes the stored choice — and #166 AC 1 and AC 5
  // are both defeated by a read that did nothing wrong except start earlier.
  it('a read that started before the new household cannot wipe the choice', async () => {
    const created = {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Mutant Household',
      timezone: 'America/New_York',
      organizer_member_id: 'm99',
      created_at: '2026-03-01T00:00:00Z',
      last_rebalance: null,
    }
    api.listMembers.mockImplementation(async (id) =>
      id === created.id
        ? [{ id: 'm99', household_id: created.id, display_name: 'Placeholder Everywhere', weekly_minutes: 0, claimed_by: 'person-a' }]
        : id === HH_B.id
          ? inB
          : inA,
    )
    api.createHousehold.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([HH_A, HH_B, created])
      return created
    })

    await renderApp('Who')
    await screen.findByRole('region', { name: /start another household/i })

    // Hold the NEXT households read open — this is the background read that
    // will come back holding a list from before the household exists.
    let release
    let started = false
    api.listHouseholds.mockImplementationOnce(() => {
      started = true
      return new Promise((resolve) => {
        release = () => resolve([HH_A, HH_B])
      })
    })
    // Start it, and leave it suspended. `attachVisibilityRefresh` DEBOUNCES by
    // REFRESH_DEBOUNCE_MS, so a focus event only SCHEDULES the read — without
    // waiting past the debounce the hanging mock is consumed by the create's
    // own re-read instead, which starts after the choice and is therefore
    // entitled to judge it. The arrangement is the test: the read has to have
    // begun before the choice for the epoch to mean anything.
    act(() => void window.dispatchEvent(new Event('focus')))
    await pause(actualRealtime.REFRESH_DEBOUNCE_MS * 2)
    // POSITIVE CONTROL: if this is false the background read never began and
    // everything below is asserting about a scenario that did not happen.
    expect(started).toBe(true)

    const card = within(screen.getByRole('region', { name: /start another household/i }))
    fireEvent.change(card.getByLabelText(/household name/i), { target: { value: 'Mutant Household' } })
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Create household' }))
    })

    // Now let the stale read finish, after the choice was made.
    await act(async () => {
      release?.()
    })

    expect(window.localStorage.getItem('taskr.activeHousehold')).toBe(created.id)
  })
})

// #341 — following an invitation, at the level only App can answer.
//
// The component test covers what `ChoosePassword` DRAWS. These cover the three
// things that belong to App and that a component test structurally cannot see:
// that the fragment is read at all, that it is read EARLY ENOUGH, and that the
// household shell does not render behind the screen.
//
// THE SECOND ONE IS THE WHOLE REASON THIS BLOCK EXISTS, and it needs a word
// about the fake. `createClient` runs with `detectSessionInUrl` at its default
// of true, so supabase-js reads the URL once, at construction, and CLEARS the
// fragment — and `currentSession()` is the call that constructs it. A read
// placed after that line finds an empty hash, the password screen never appears,
// and the person lands in the app signed in with no password of their own.
// Silent, plausible, and indistinguishable from success.
//
// A test that merely rendered with a fragment would pass either way here,
// because `currentSession` is a stub and a stub constructs nothing. So the stub
// REPRODUCES THE PLATFORM'S BEHAVIOUR: it clears the hash when it is called.
// That is the difference between asserting the app's ordering and asserting the
// fake's (cairn's `a-fake-cannot-disagree-with-its-author`).
describe('#341 — following an invitation, from App', () => {
  const household = { id: 'h1', name: 'Placeholder Household', timezone: 'America/New_York' }
  const me = {
    id: 'm1',
    display_name: 'Placeholder One',
    weekly_minutes: 120,
    claimed_by: 'person-a',
    email: 'placeholder.one@example.test',
  }

  let replaceState
  let realLocation
  let realHistory

  /** A completed auth link: a token in the fragment, and the type that says why. */
  const TOKEN = 'access_token=t&refresh_token=r&expires_in=3600&token_type=bearer'

  const atFragment = (hash) => {
    replaceState = vi.fn()
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://taskr.example.test', pathname: '/', search: '', hash },
    })
    Object.defineProperty(globalThis, 'history', {
      configurable: true,
      writable: true,
      value: { replaceState },
    })
  }

  beforeEach(() => {
    realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    realHistory = Object.getOwnPropertyDescriptor(globalThis, 'history')
    api.listHouseholds.mockResolvedValue([household])
    api.listMembers.mockResolvedValue([me])
    api.setOwnPassword.mockResolvedValue(undefined)
    atFragment('')
  })

  afterEach(() => {
    if (realLocation) Object.defineProperty(globalThis, 'location', realLocation)
    if (realHistory) Object.defineProperty(globalThis, 'history', realHistory)
  })

  it('POSITIVE CONTROL: with no fragment the ordinary shell renders', async () => {
    // Without this, every "the password screen is shown" assertion below passes
    // just as well against an app that shows it always — and every "the shell is
    // not rendered" assertion passes against an app that renders nothing at all.
    await renderApp()
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('shows Choose your password when an invitation link is followed', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()

    expect(
      await screen.findByRole('heading', { name: /choose your password/i }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('choose-password-input')).toBeInTheDocument()
  })

  it('renders nothing of the household behind it — one screen, one job', async () => {
    // AC 2 asks for "one field, one button". Asserted as the ABSENCE of the
    // shell rather than the presence of the field, because the failure this
    // guards is a household's data rendering to somebody who has not finished
    // setting up their account — and that failure is invisible to any assertion
    // about the field.
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    expect(screen.queryByRole('button', { name: 'Who' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Chores' })).not.toBeInTheDocument()
    expect(screen.queryByText(household.name)).not.toBeInTheDocument()
  })

  it('reads the fragment BEFORE the client can consume it', async () => {
    // The hazard, reproduced. See this block's docblock: the stub clears the
    // hash exactly as supabase-js does at construction, so moving the read below
    // `currentSession()` makes this test — and only this test — go red.
    atFragment(`#${TOKEN}&type=invite`)
    api.currentSession.mockImplementation(async () => {
      globalThis.location.hash = ''
      return { user: { id: 'person-a' } }
    })

    await renderApp()
    expect(
      await screen.findByRole('heading', { name: /choose your password/i }),
    ).toBeInTheDocument()
  })

  it('strips the token off the URL, so a reload does not replay it', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('sets the password and lands them in their household', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).toHaveBeenCalledWith('a-good-password')
    // The screen goes, and what is underneath is their household — not a second
    // loading pass, because boot loaded it while this screen was up.
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
  })

  it('keeps the screen up when the write fails, and says so', async () => {
    // A password that was not set is a person who cannot sign in again once they
    // leave. Dismissing the screen on a failure would strand them with no way
    // back and nothing on screen to say why.
    atFragment(`#${TOKEN}&type=invite`)
    api.setOwnPassword.mockRejectedValue(new Error('Could not set that password: nope'))
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    fireEvent.change(screen.getByTestId('choose-password-input'), {
      target: { value: 'a-good-password' },
    })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(screen.getByRole('heading', { name: /choose your password/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not set that password/i)
  })

  it('refuses a short password before the round trip', async () => {
    atFragment(`#${TOKEN}&type=invite`)
    await renderApp()
    await screen.findByRole('heading', { name: /choose your password/i })

    fireEvent.change(screen.getByTestId('choose-password-input'), { target: { value: 'abc' } })
    await act(async () =>
      void fireEvent.click(screen.getByRole('button', { name: /set my password/i })),
    )

    expect(api.setOwnPassword).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 6 characters/i)
  })

  it('an EXPIRED invitation goes to the sign-in screen, not to the password screen', async () => {
    // The trap this exists for: an expired link carries `type=invite` too,
    // alongside an error and NO token. Reading `type` alone would show a
    // password screen for a session that does not exist, and the write would
    // then fail with a sentence about the write rather than about the link.
    atFragment(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=invite',
    )
    api.currentSession.mockResolvedValue(null)

    await renderApp()
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('does not show the password screen when the link left no session', async () => {
    // The other half of the same rule, with a token that GoTrue rejected: there
    // is nothing to set a password ON, so the sign-in screen is the honest state.
    atFragment(`#${TOKEN}&type=invite`)
    api.currentSession.mockResolvedValue(null)

    await renderApp()
    expect(await screen.findByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('a recovery link lands on the same screen, in its own words', async () => {
    // AC 2's "build it once and both types route to it", asserted as the two
    // headings differing — if the copy were shared, this and the invite test
    // above would both pass against a screen that could not tell them apart.
    atFragment(`#${TOKEN}&type=recovery`)
    await renderApp()

    expect(
      await screen.findByRole('heading', { name: /choose a new password/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })

  it('ignores a fragment whose type is neither', async () => {
    // A Google sign-in return carries a token and no `type` this screen owns.
    // Treating any token as an arrival would put a password screen in front of
    // every OAuth sign-in.
    atFragment(`#${TOKEN}`)
    await renderApp()

    expect(await screen.findByRole('button', { name: 'Who' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose your password/i })).not.toBeInTheDocument()
  })
})

describe('#173 — redeeming an invitation code, from App', () => {
  const PENDING_KEY = 'taskr.pendingInvitation'
  const CHOICE_KEY = 'taskr.activeHousehold'
  const alone = [
    { id: 'm1', display_name: 'Placeholder Everywhere', weekly_minutes: 120, claimed_by: 'person-a' },
  ]
  const joinedRow = { id: 'm9', household_id: HOUSEHOLD_TWO.id, display_name: 'New member' }
  const inTwo = [
    { id: 'm9', display_name: 'Placeholder Three', weekly_minutes: 0, claimed_by: 'person-a' },
    { id: 'm10', display_name: 'Placeholder Other Organizer', weekly_minutes: 30, claimed_by: 'person-b' },
  ]
  const UNUSABLE =
    'That code cannot be used — it may have expired, been withdrawn, or already been used. Ask whoever gave it to you for a fresh one.'

  const click = async (element) => act(async () => void fireEvent.click(element))
  const codeField = (scope = screen) => scope.getByLabelText(/invitation code/i)
  const nameField = (scope = screen) => scope.getByLabelText(/join as/i)
  const joinButton = (scope = screen) => scope.getByRole('button', { name: /join household/i })
  const fillJoin = (scope = screen, code = 'k7m3qp4rwn', name = 'Placeholder Three') => {
    fireEvent.change(codeField(scope), { target: { value: code } })
    fireEvent.change(nameField(scope), { target: { value: name } })
  }
  /** What `pendingInvitation.js` writes — the shape the boot reads. */
  const hold = (code = 'k7m3qp4rwn', name = 'Placeholder Three') =>
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ code, name }))

  /** The write succeeds and the read that follows sees the new household — `mutate()`'s shape. */
  const redemptionJoins = (from = []) =>
    invitationsApi.redeemInvitation.mockImplementation(async () => {
      api.listHouseholds.mockResolvedValue([...from, HOUSEHOLD_TWO])
      return joinedRow
    })

  let scrollTo

  beforeEach(() => {
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : alone))
    api.updateMember.mockResolvedValue({})
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    scrollTo.mockRestore()
  })

  // -------------------------------------------------------------------------
  // AC 1 — signed in, no household: the join card
  // -------------------------------------------------------------------------

  it('AC 1: a signed-in person with no household is offered the join card beside the household form', async () => {
    await renderApp()
    expect(await screen.findByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start a household' })).toBeInTheDocument()
  })

  it('AC 1: entering a code creates the member row through the function and the app switches to that household', async () => {
    redemptionJoins()
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledWith('k7m3qp4rwn')
    // The shell, on the household the code named — and no client insert.
    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(api.addMember).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: /join with a code/i })).not.toBeInTheDocument()
  })

  it('AC 1: the joined household is the one this device now remembers', async () => {
    redemptionJoins()
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())
    await screen.findByText('Placeholder Other Household')

    expect(window.localStorage.getItem(CHOICE_KEY)).toBe(HOUSEHOLD_TWO.id)
  })

  // -------------------------------------------------------------------------
  // The name — #191 AC 2's half that sits on this surface
  // -------------------------------------------------------------------------

  it('renames the row the function created to the name the person chose, after the join', async () => {
    redemptionJoins()
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin(screen, 'k7m3qp4rwn', ' Placeholder Three ')
    await click(joinButton())
    await screen.findByText('Placeholder Other Household')

    expect(api.updateMember).toHaveBeenCalledTimes(1)
    expect(api.updateMember).toHaveBeenCalledWith('m9', { displayName: 'Placeholder Three' })
    // ORDER: the join first, then the rename — the row has to exist to be renamed.
    expect(invitationsApi.redeemInvitation.mock.invocationCallOrder[0]).toBeLessThan(
      api.updateMember.mock.invocationCallOrder[0],
    )
  })

  it('a refused rename does not undo the join — the person lands in the household and is told', async () => {
    redemptionJoins()
    api.updateMember.mockRejectedValue(new Error('saving the change: permission denied'))
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/your name could not be saved/i)
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe(HOUSEHOLD_TWO.id)
  })

  // -------------------------------------------------------------------------
  // AC 2 and AC 3 — refusals
  // -------------------------------------------------------------------------

  it('AC 2: an existing member is refused with a sentence saying the code was not spent, and stays where they were', async () => {
    invitationsApi.redeemInvitation.mockRejectedValue(
      new Error('You are already in that household, so the code was left unused.'),
    )
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/left unused/)
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    // The code stays in the field beside the sentence that refused it, and
    // nothing was renamed.
    expect(codeField()).toHaveValue('k7m3qp4rwn')
    expect(api.updateMember).not.toHaveBeenCalled()
  })

  it('AC 3: an unusable code is refused with the one sentence, naming no household', async () => {
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp()
    await screen.findByRole('heading', { name: /join with a code/i })
    fillJoin()
    await click(joinButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/cannot be used/)
    expect(alert).not.toHaveTextContent(/Placeholder/)
    expect(alert).not.toHaveTextContent(HOUSEHOLD_TWO.id)
  })

  // -------------------------------------------------------------------------
  // AC 4 — the code survives the leave-for-inbox round trip, on this device
  // -------------------------------------------------------------------------

  it('AC 4: signed out, the join link takes the code and the name FIRST and keeps them on this device', async () => {
    api.currentSession.mockResolvedValue(null)
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    await click(screen.getByRole('button', { name: /join a household/i }))

    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    fireEvent.change(codeField(), { target: { value: '  K7M3QP4RWN\t' } })
    fireEvent.change(nameField(), { target: { value: ' Placeholder Three ' } })
    await click(screen.getByRole('button', { name: /keep this code/i }))

    // Normalised into storage, and nothing redeemed — there is no session.
    expect(JSON.parse(window.localStorage.getItem(PENDING_KEY))).toEqual({
      code: 'k7m3qp4rwn',
      name: 'Placeholder Three',
    })
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    // Back on the sign-in card, which says the code is held.
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.getByTestId('held-invitation-note')).toHaveTextContent(/saved on this device/i)
  })

  it('AC 4: a held code is applied on sign-in without being re-typed, under the held name, then forgotten', async () => {
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    hold()
    redemptionJoins()
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(screen.getByTestId('held-invitation-note')).toBeInTheDocument()

    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    // ONE tap, naming the held name, and nothing typed again (AC 4's letter).
    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))

    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledWith('k7m3qp4rwn')
    expect(api.updateMember).toHaveBeenCalledWith('m9', { displayName: 'Placeholder Three' })
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
  })

  it('AC 4: the confirmation link opened in THIS browser offers the held code at boot, one tap applies it', async () => {
    // Back from the inbox: the client picked the session up off the URL, the
    // person has no household yet, and this device is still holding the code.
    // The offer, not a silent apply — the account that signed in is not
    // necessarily the one that held the code (review escalation, 2026-09-11).
    hold()
    redemptionJoins()
    await renderApp()

    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(confirm).toHaveTextContent(/Placeholder Three/)
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))

    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledWith('k7m3qp4rwn')
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(screen.queryByRole('heading', { name: /join with a code/i })).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // AC 5 — what the mechanism guarantees in a DIFFERENT browser
  // -------------------------------------------------------------------------

  it('AC 5: the confirmation link opened in a DIFFERENT browser finds no code — nothing is redeemed and the join form is shown', async () => {
    // The mechanism is `localStorage` on the device that entered the code
    // (pendingInvitation.js), so another browser holds nothing. The guarantee
    // is that the person is shown the join form and types the code again —
    // asserted here rather than left to the happy path above.
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    await renderApp()

    expect(await screen.findByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    // And typing it there works exactly as if it had been carried.
    redemptionJoins()
    fillJoin()
    await click(joinButton())
    expect(await screen.findByText('Placeholder Other Household')).toBeInTheDocument()
  })

  it('a held code that is refused is forgotten, so a boot cannot loop on it', async () => {
    hold()
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp()
    const confirm = await screen.findByTestId('held-invitation-confirm')
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be used/)
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    // The join form is there for the next attempt, which is theirs to make.
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
  })

  it('a held code does not outlive the session on a shared tablet — sign-out forgets it', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    await renderApp('Who')
    await screen.findByRole('region', { name: /join another household/i })
    // Left behind by somebody else on this device, after this boot's read.
    hold()

    api.signOut.mockImplementation(async () => {
      api.currentUserId.mockResolvedValue(null)
      api.listHouseholds.mockResolvedValue([])
    })
    await click(screen.getByRole('button', { name: /^sign out$/i }))
    await screen.findByRole('button', { name: /^sign in$/i })

    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // AC 7 — a second household, from inside the first
  // -------------------------------------------------------------------------

  it('AC 7: a person already in a household is offered a way to join another', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    await renderApp('Who')
    expect(
      await screen.findByRole('region', { name: /join another household/i }),
    ).toBeInTheDocument()
  })

  it('AC 7: after joining, the switcher lists both and the newly joined one is active', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    redemptionJoins([HOUSEHOLD_ONE])
    await renderApp('Who')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    await click(joinButton(card))

    const switcher = await screen.findByRole('combobox', { name: /^household$/i })
    expect(within(switcher).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Placeholder Household',
      'Placeholder Other Household',
    ])
    expect(switcher).toHaveValue(HOUSEHOLD_TWO.id)
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe(HOUSEHOLD_TWO.id)
  })

  it('AC 7: the join scrolls to the top, where the switcher names the new household', async () => {
    // Owner decision at the design pass, 2026-09-11: from the roster card the
    // person was ~2,300px down and, after the re-read, still there — looking
    // at the NEW household's "Start another household" card with nothing in
    // view saying they had moved. jsdom has no layout, so the scroll is
    // asserted as a request.
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    redemptionJoins([HOUSEHOLD_ONE])
    await renderApp('Who')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    expect(scrollTo).not.toHaveBeenCalled()
    await click(joinButton(card))
    await screen.findByRole('combobox', { name: /^household$/i })

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('a refused join scrolls nowhere — the sentence is beside the control', async () => {
    api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp('Who')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    await click(joinButton(card))
    await screen.findByText(/cannot be used/)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('AC 7: the first household’s notices do not come along — the switch path’s rule', async () => {
    // A re-balance announcement about household ONE must not stand over TWO's
    // surfaces after the join, for exactly `chooseHousehold`'s reason (#164's
    // finding 6, whose fixture this is): a refresh never clears it, so only
    // the join path can. The precondition below is what keeps this from
    // passing on a page that never had one.
    const rebalanced = {
      ...HOUSEHOLD_ONE,
      last_rebalance: {
        contested: true,
        level: true,
        reason: null,
        boundByBudget: false,
        jobsMoved: 1,
        minutesMoved: 90,
        changeBudgetMinutes: 120,
        applied_at: '2026-08-27T18:00:00+00:00',
      },
    }
    const inOne = [
      { id: 'm1', household_id: rebalanced.id, display_name: 'Placeholder One', weekly_minutes: 300, claimed_by: 'person-a' },
      { id: 'm2', household_id: rebalanced.id, display_name: 'Placeholder Two', weekly_minutes: 300, claimed_by: null },
    ]
    api.listHouseholds.mockResolvedValue([rebalanced])
    api.listMembers.mockImplementation(async (id) => (id === HOUSEHOLD_TWO.id ? inTwo : inOne))
    choresApi.listChores.mockImplementation(async (id) =>
      id === HOUSEHOLD_TWO.id
        ? []
        : [
            { id: 'c1', title: 'Placeholder Chore', expected_minutes: 90, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
            { id: 'c2', title: 'Placeholder Other Chore', expected_minutes: 50, due_on: null, completed_at: null, completed_by_member_id: null, assigned_member_id: 'm2', actual_minutes: null },
          ],
    )
    announceApi.readSplitSeen.mockResolvedValue({
      member_id: 'm1',
      snapshot: {
        members: [
          { id: 'm1', minutes: 90, capacityMinutes: 420 },
          { id: 'm2', minutes: 50, capacityMinutes: 300 },
        ],
      },
      seen_rebalance_at: '2026-08-27T09:00:00+00:00',
    })
    redemptionJoins([rebalanced])
    await renderApp('Who')
    // The precondition: the announcement really is on screen before the join.
    await screen.findByTestId('rebalance-announcement')
    const card = within(await screen.findByRole('region', { name: /join another household/i }))
    fillJoin(card)
    await click(joinButton(card))
    await screen.findByRole('combobox', { name: /^household$/i })

    expect(screen.queryByTestId('rebalance-announcement')).toBeNull()
  })

  // -------------------------------------------------------------------------
  // The review round's three behaviour findings
  // -------------------------------------------------------------------------

  it('a refusal on the strip is answered by the person’s next join attempt on the no-household screen', async () => {
    // Review finding: App's error prop has no setter on the screen, so a
    // refusal stayed under the form after the person moved on. What THIS test
    // exercises: a signed-in join refused (the strip shows), then a second
    // attempt submitted — the old sentence must be gone before the new call
    // resolves. The signed-out move-between-views case, and a NEW App
    // sentence showing after the old one was answered, are the Onboarding
    // component tests' (`Onboarding.test.jsx`, the latch describe).
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    hold()
    invitationsApi.redeemInvitation.mockRejectedValue(new Error(UNUSABLE))
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      return { user: { id: 'person-a' } }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))
    // The held code is offered, taken, and refused; the person is on the
    // no-household screen with the strip.
    await click(await screen.findByRole('button', { name: /^join as placeholder three$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be used/)

    // Their next act — typing and trying again — answers the old sentence
    // before the new call resolves.
    invitationsApi.redeemInvitation.mockImplementation(() => new Promise(() => {}))
    fillJoin()
    await click(joinButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a held code is offered only after the sign-in’s own refresh has settled', async () => {
    // Review finding: keyed on `userId` alone, the effect fired mid-refresh
    // and the redemption ran while the sign-in's read of household ONE was
    // still writing ONE's seen marker. The split-seen read is held open here;
    // nothing may be offered, let alone redeemed, until it resolves.
    let release
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    api.listHouseholds.mockResolvedValue([])
    hold()
    redemptionJoins([HOUSEHOLD_ONE])
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })

    api.signIn.mockImplementation(async () => {
      api.currentSession.mockResolvedValue({ user: { id: 'person-a' } })
      api.currentUserId.mockResolvedValue('person-a')
      api.listHouseholds.mockResolvedValue([HOUSEHOLD_ONE])
      return { user: { id: 'person-a' } }
    })
    announceApi.readSplitSeen.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve(null) }),
    )
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'kid@example.com' } })
    fireEvent.change(screen.getByLabelText(/password or pin/i), { target: { value: '4821' } })
    await click(screen.getByRole('button', { name: /^sign in$/i }))

    // The sign-in's refresh is parked on the seen-marker read, with the id set.
    expect(api.currentUserId).toHaveBeenCalled()
    expect(release).toBeTypeOf('function')
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()

    await act(async () => release())
    // Settled: the member of ONE is now offered the code — above ONE's shell.
    const confirm = await screen.findByTestId('held-invitation-confirm')
    expect(confirm).toHaveTextContent(/Placeholder Three/)
    expect(screen.getByText('Placeholder Household')).toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    await click(within(confirm).getByRole('button', { name: /^join as placeholder three$/i }))
    await waitFor(() => expect(invitationsApi.redeemInvitation).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('combobox', { name: /^household$/i })).toHaveValue(HOUSEHOLD_TWO.id)
  })

  it('Not me forgets the held code without spending it, and leaves the join form', async () => {
    // The shared-tablet ordering the sign-out clear does not cover (review
    // escalation, owner decision 2026-09-11): B held a code and left for the
    // inbox; A signs in first. A must be able to decline, and the code must
    // not be redeemed on A's account.
    hold()
    await renderApp()
    const confirm = await screen.findByTestId('held-invitation-confirm')
    await click(within(confirm).getByRole('button', { name: /^not me$/i }))

    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(PENDING_KEY)).toBeNull()
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /join with a code/i })).toBeInTheDocument()
    expect(api.updateMember).not.toHaveBeenCalled()
  })

  it('a boot that FAILED after setting the session offers nothing, and keeps its own reason', async () => {
    // Review finding: the effect ran after a boot whose refresh threw past
    // `setUserId` — an organizer whose invitations read alone refused — and a
    // redemption's refusal replaced the boot's sentence. `listInvitations` is
    // the one uncaught read after the id is set, and it runs only for the
    // organizer of an existing household.
    const organised = { ...HOUSEHOLD_ONE, organizer_member_id: 'm1' }
    api.listHouseholds.mockResolvedValue([organised])
    invitationsApi.listInvitations.mockRejectedValue(new Error('loading the invitations: the network went away'))
    hold()
    await renderApp()

    expect(await screen.findByRole('alert')).toHaveTextContent(/the network went away/)
    expect(screen.queryByTestId('held-invitation-confirm')).not.toBeInTheDocument()
    expect(invitationsApi.redeemInvitation).not.toHaveBeenCalled()
    // The code is still held for a boot that succeeds.
    expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull()
  })

  it('the held note follows the store when another tab changes it', async () => {
    // Review finding: `heldInvitation` was a mount-time snapshot. Another tab
    // redeeming, being refused on, or signing out clears the same key, and
    // this tab kept promising a code that was gone.
    api.currentSession.mockResolvedValue(null)
    api.currentUserId.mockResolvedValue(null)
    hold()
    await renderApp()
    await screen.findByRole('button', { name: /^sign in$/i })
    expect(screen.getByTestId('held-invitation-note')).toBeInTheDocument()

    window.localStorage.removeItem(PENDING_KEY)
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: PENDING_KEY, newValue: null }))
    })
    expect(screen.queryByTestId('held-invitation-note')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /join a household/i })).toBeInTheDocument()

    // And the other direction: a code held in another tab shows here.
    hold()
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: PENDING_KEY, newValue: 'x' }))
    })
    expect(screen.getByTestId('held-invitation-note')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // AC 10 — the organizer's card is back
  // -------------------------------------------------------------------------

  it('AC 10: with redemption shipped the organizer’s invitation card renders again', async () => {
    // The flag is read through the module, not through the test's getter, so
    // this is the real constant: TRUE since this story.
    const real = await vi.importActual('./lib/invitations.js')
    expect(real.INVITATIONS_REDEEMABLE).toBe(true)
  })
})
