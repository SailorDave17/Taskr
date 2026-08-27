// Row-level security, exercised over the wire against the REAL Supabase project
// — migrated to per-member sign-in by #88.
//
// WHAT THIS FILE IS FOR, AND WHY NOTHING ELSE CAN DO IT
//
// `src/test/migrations.pglite.test.js` proves the same rules against a real
// Postgres and is faster, cheaper and runs in CI. What it structurally cannot
// say is whether SUPABASE agrees: it builds its own database, so it can never
// see the live project diverge from `supabase/migrations/`. This file is the
// only instrument in the repo that can. That gap is not hypothetical — #91 is
// an open, measured instance of it, and the next section says why this suite
// cannot detect that particular one either.
//
// ── WHAT #88 CHANGED ───────────────────────────────────────────────────────
//
// This suite used to talk to the model `0007_per_member_auth.sql` retired: a
// DEVICE signed in anonymously, joined with a shared code, and later proved
// which person it was acting as. `household_devices` was the row every policy
// asked about. `join_household`, `claim_member`, `claim_member_with_pin`,
// `set_member_pin`, `has_pin`, `pin_hash` and `join_code` are all gone, so the
// old file failed at setup against a migrated project — correctly, and
// uselessly.
//
// Under the new model a PERSON signs in as themselves, `members.claimed_by` is
// the sole membership predicate, and `public.current_household_ids()` resolves
// it. The rules did not change; only the answer to "is the caller in this
// household" did. A test asserts the retired names are gone rather than a reader
// checking — in `support/retiredVocabulary.test.js`, which CI runs; see *the
// vocabulary* below for why it is there and not here.
//
// ── FIRST RAN GREEN 2026-08-21 — 31 of 31, every test executing ────────────
//
// #127 ran it. It failed in `beforeAll`, creating the SECOND household:
//
//     23505 duplicate key value violates unique constraint
//           "members_claimed_by_key"
//
// That is a fact about the SCHEMA, not about this file. `members_claimed_by_key`
// is 0001's, written when `claimed_by` meant a device session; 0007 re-pointed
// the column at a person's stable auth identity and left the index alone, so it
// had come to mean "one person belongs to at most one household, ever". The
// shape below — one organizer in both households — cannot be built under it, and
// neither can anything else that puts a person in two places.
//
// `0009_membership_is_per_household.sql` rescopes both that index and
// `members_email_key` to be per household. It was pasted 2026-08-21, and this
// suite went green on the next run — 31 of 31, no skips, both cross-household
// directions refusing. THIS SUITE IS THE ONLY THING THAT CAN CONFIRM 0009 IS
// APPLIED: `check:live` reads tables, columns, RPCs and the Edge Function, not
// indexes, so it is blind to that migration and stays green either way.
//
// Everything below was written by reading the migrations and the function
// source, and the first green run changed exactly one claim — the cost of a run,
// corrected at the foot of this header. Nothing else needed touching, which is
// the case FOR shipping a suite unrun: the reasoning was sound and the one thing
// it could not reach was reachable only by executing.
//
// ── HOW THE ONE BLOCKER GOT PAST REVIEW ────────────────────────────────────
//
// #88 shipped this file unrun, deliberately, with the owner's decision recorded
// on the issue, and it named three blockers. All three were discharged by
// 2026-08-21 — the live project on `0007`, the Edge Function deployed, the
// pre-confirmed account created. A FOURTH then appeared on first execution, and
// it could only ever have appeared that way.
//
// It is worth being precise about why, because the blocker list was not sloppy.
// `members_claimed_by_key` is declared in 0001 with a comment explaining it, and
// 0007 CITES IT APPROVINGLY on the way past. Nothing contradicts anything; there
// is no stale sentence to catch and no inconsistency to grep for. What changed
// was the meaning of the column underneath a constraint nobody re-read. Review
// cannot reach that, and neither can any check in this repo — only running it.
//
// So the case for shipping a suite unrun stands, and is stronger than #88 put
// it: the reasoning was sound everywhere reading could reach, and the single
// place it was wrong is the single place only execution could go.
//
// What HAS been measured, on 2026-08-21 against the live project, is only what
// the next section says: the auth settings, the address validation, the send
// rate limit, and that `0007` is applied (the five retired RPCs answer
// `PGRST202`, `create_household` resolves at three arguments and not four,
// `household_devices` answers `PGRST205`).
//
// ── WHY THIS SUITE NEEDS A SEEDED ACCOUNT, WHICH IS NEW ────────────────────
//
// It cannot create its own organizer, and that is a property of the project
// rather than an inconvenience. *Measured 2026-08-21* against the live project:
//
//     GET /auth/v1/settings  ->  "mailer_autoconfirm": false
//
// So a client `signUp()` returns `data.session === null` until somebody opens
// an inbox and clicks a link. No automated suite can do that, on any machine,
// for any runner — this is not a limitation of the session that wrote it.
// `src/lib/household.js` already says the same thing about the app's own signup
// path: null session, "not something this app can work around".
//
// Two smaller measurements from the same probe, both of which would otherwise
// have been diagnosed as bugs in this file:
//
//   - `@example.com` and `@taskr.invalid` are REJECTED by GoTrue's address
//     validation (`email_address_invalid`). The Edge Function's synthetic
//     `<id>@taskr.invalid` addresses work only because `auth.admin.createUser`
//     bypasses that validation — the client path could never mint one.
//   - a signup that IS accepted answers `over_email_send_rate_limit` on the
//     free tier's shared SMTP, so even with confirmation off, a suite that
//     signs up twice per run would throttle itself within a few runs.
//
// The design below is immune to both: it sends NO email and calls `signUp` NOT
// AT ALL. One pre-confirmed account signs in, and every other identity in the
// run is minted by the Edge Function, which confirms at creation because a
// synthetic address has no inbox to confirm through.
//
// ── THE SHAPE, WHICH IS WHERE THE INTERESTING PART IS ──────────────────────
//
// One seeded account, two households, and two provisioned members:
//
//     organizer (seeded)  ──creates──>  H1 "inside"   ──provisions──> insider
//                         ──creates──>  H2 "outside"  ──provisions──> outsider
//
// The organizer is in BOTH, so they are the positive control and never the
// subject of a refusal. `insider` and `outsider` are each in exactly one, so
// every cross-household claim is tested in BOTH DIRECTIONS by two people who
// are genuinely signed in — which the old file could only approximate with a
// device that had not joined yet.
//
// It also means the suite never needs a second credential: `outsider` is a
// stranger to H1 in every way that matters to a policy, and the Edge Function
// made them.
//
// ── WHAT THIS SUITE IS STILL BLIND TO, STATED RATHER THAN DISCOVERED ───────
//
// It runs against the live project, so it sees the live project's grants — and
// #91 is precisely a grant that exists there and in NO migration
// (`authenticated` has no SELECT on `households`; the hosted project inherited
// it from a creation-time default that a rebuilt project does not get). Every
// `households` read below therefore SUCCEEDS here and would fail outright on a
// database built from `supabase/migrations/`. This file cannot detect that, and
// neither can the pglite suite, for opposite reasons. #91 owns it.
//
// ── COST OF A RUN ─── #88 AC 4 ─────────────────────────────────────────────
//
// MEASURED 2026-08-21 across two consecutive green runs, correcting the figure
// #88 reasoned. Each run leaves, on the live project: two households named
// `TEST 88 <timestamp> …`, FIVE member rows, and two auth users (the two
// provisioned members). The seeded account is reused and never multiplies.
//
// Five, not the four #88 predicted. The fifth is `Not Yet Provisioned`, and the
// reason the count was wrong is worth more than the count: it is created by a
// TEST BODY rather than by `beforeAll`, so a cost derived by reading setup could
// not see it. Anything that counts residue must count what the assertions create,
// not only what the fixture does.
//
// New since 0009, and unbounded: the seeded organizer now holds a member row in
// EVERY household this suite has ever made, growing by two per run. Before 0009
// that was impossible — one global claim — so the accumulation is a genuine
// consequence of the fix rather than an oversight. It costs nothing but rows.
//
// They are LEFT rather than cleaned up, and that is the same deliberate choice
// the previous version documented: there is no client-reachable way to delete a
// household — see `0001` — so tidying is a manual statement in the Supabase SQL
// editor, and a suite that could delete households would need a capability the
// app itself is designed not to have. `docs/access-model.md` carries the
// statement. Two auth users per run is strictly better than the three anonymous
// users the old file left, and unlike those they are identifiable: every
// address is `<members.id>@taskr.invalid` under a household whose name begins
// `TEST 88`.
//
// ── WHY IT IS NOT IN CI ────────────────────────────────────────────────────
//
// It needs credentials and a network, which the CI gate deliberately has
// neither of, and a suite that silently SKIPS when its configuration is absent
// passes vacuously — the exact failure `docs/ci-gate.md` exists to prevent. So
// every precondition below is a `throw`, never a skip. Run it with
// `npm run test:rls`.

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSecretKey } from '../lib/keyShape.js'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const seedEmail = process.env.TASKR_TEST_EMAIL
const seedPassword = process.env.TASKR_TEST_PASSWORD

// Loud, not skipped. If this file runs at all it must either exercise the
// policies or fail saying why.
if (!url || !anonKey) {
  throw new Error(
    'rls.integration.test.js needs a live Supabase project.\n' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (gitignored) ' +
      'and run `npm run test:rls`.\n' +
      'This test is excluded from `npm test` on purpose: CI has no credentials, and ' +
      'a security test that skips itself is worse than no security test.',
  )
}

// A secret key bypasses RLS, so running this file with one exercises no policy
// at all. It would still go red — the outsider would see everything — but it
// would go red in the shape of "your policies are broken", sending someone to
// rewrite a migration that is fine. Added 2026-08-05, when exactly this key was
// found in the project's own hosting configuration.
if (isSecretKey(anonKey)) {
  throw new Error(
    'rls.integration.test.js was given a SECRET key, so it can prove nothing.\n' +
      'A secret key bypasses row-level security: every assertion below would be ' +
      'testing a client that is exempt from the rules under test.\n' +
      'Use the PUBLISHABLE key (sb_publishable_… , or a legacy JWT whose role is ' +
      '"anon"). See .env.example and docs/access-model.md.\n' +
      'If a secret key has been used in a build, rotate it — fixing the variable ' +
      'does not invalidate what was already published.',
  )
}

// #88. The seeded account, and the instruction for making one — because the
// reason it is needed is not guessable from the failure.
if (!seedEmail || !seedPassword) {
  throw new Error(
    'rls.integration.test.js needs a PRE-CONFIRMED Supabase account to sign in as.\n' +
      '\n' +
      'It cannot make one itself: this project has `mailer_autoconfirm: false`, so a\n' +
      'client signUp() returns a null session until someone clicks a link in an inbox,\n' +
      'and no automated suite can read an inbox. Measured 2026-08-21 against\n' +
      'GET /auth/v1/settings.\n' +
      '\n' +
      'Make one ONCE, in the Supabase dashboard:\n' +
      '  Authentication -> Users -> Add user -> Create new user\n' +
      '  tick "Auto Confirm User"\n' +
      '\n' +
      'Then put it in .env.local (gitignored):\n' +
      '  TASKR_TEST_EMAIL=…\n' +
      '  TASKR_TEST_PASSWORD=…\n' +
      '\n' +
      'Use a throwaway address that belongs to nobody in the household. This account\n' +
      'becomes the organizer of every TEST household the suite creates, so it must not\n' +
      'be a real person: it accumulates households that cannot be deleted from a client.',
  )
}

/** A stamp that sorts, and that a human can find in the dashboard. */
const RUN = new Date().toISOString().replace(/[:.]/g, '-')

/** A Monday. 0005's check constraint refuses any other weekday outright. */
const CAPACITY_PERIOD = '2026-08-10'

// The zone the creating account claims, deliberately NOT the runner's own — a
// value that happens to match the machine proves nothing about whether the
// argument arrived.
const HOUSEHOLD_TZ = 'Pacific/Auckland'

// Every read names its columns, and that is load-bearing rather than tidy.
// 0007 revokes select on `members` wholesale and re-grants per column, so
// `select('*')` fails with 42501 for EVERY caller — including one legitimately
// in the household. An assertion written against `data ?? []` would then hold
// whether or not the row-level policy did anything, which is the defect #61
// found in the previous version of this file.
//
// With the columns named, a refusal by the GRANT is impossible, so an empty
// array can only mean the ROW-LEVEL POLICY refused — the one thing this file
// exists to measure. Kept identical to MEMBER_COLUMNS in src/lib/household.js.
//
// `household_id` is absent, and its absence is 0007's doing: the column left
// the readable set so that `select('*')` keeps failing outright once `pin_hash`
// was dropped. A client learns which household it is in from `households`.
const MEMBER_COLUMNS = 'id, display_name, weekly_minutes, claimed_by, email, created_at'
const CAPACITY_COLUMNS = 'id, member_id, period_start, minutes, note, source, created_at'
// Widened by 0012 (#53): the three repeat columns joined the readable set, so
// this suite is RED against the live project until 0012 is pasted — the same
// deliberate window docs/access-model.md records for every migration.
const CHORE_COLUMNS =
  'id, title, expected_minutes, due_on, created_at, completed_at, completed_by_member_id, assigned_member_id, repeat_kind, repeat_weekdays, generated_from'
const HOUSEHOLD_COLUMNS = 'id, name, timezone, organizer_member_id, created_at'

/** A fresh client per person, so no two ever share a session. */
function newClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Fail with the response body, which is where the useful sentence lives. */
async function describeFunctionError(error) {
  const body = await error?.context?.json?.().catch(() => null)
  return body?.error ? `${error.message} :: ${body.error}` : (error?.message ?? 'unknown')
}

describe('row-level security under per-member sign-in, exercised over the wire', () => {
  const organizer = newClient()
  const insider = newClient()
  const outsider = newClient()

  /** H1 — the household the refusals below are about. */
  let inside
  /** H2 — a household the insider must never see. */
  let outside

  let organizerInside
  let insiderMember
  let outsiderMember
  let insiderAuthId
  let outsiderAuthId
  let capacityId
  let choreId

  /** Add a member and give them a sign-in, exactly as the app does. */
  async function provision(client, householdId, displayName, password) {
    const { data: member, error: addError } = await client
      .from('members')
      .insert({ household_id: householdId, display_name: displayName })
      .select(MEMBER_COLUMNS)
      .single()
    expect(addError, `adding ${displayName} failed: ${addError?.message}`).toBeNull()

    // A brand new member row is inert until this call: no `claimed_by`, so
    // `current_household_ids()` returns nothing for them and every policy
    // denies. Asserting it here is what makes the sign-in below meaningful.
    expect(member.claimed_by, 'a new member must have no sign-in yet').toBeNull()
    expect(member.email, 'a member with no real address keeps email NULL').toBeNull()

    const { data, error } = await client.functions.invoke('provision-member', {
      body: { action: 'provision', memberId: member.id, password },
    })
    if (error) {
      throw new Error(
        `provisioning ${displayName} failed: ${await describeFunctionError(error)}\n` +
          'If this says the function was not reached, it may not be deployed to this ' +
          'project — `npm run deploy:function`, and see docs/deploy-runbook.md.',
      )
    }
    return { member, provision: data }
  }

  beforeAll(async () => {
    // 1. The one account that already exists. `signInWithPassword`, never
    //    `signUp` — see the header.
    const { data: session, error: signInError } = await organizer.auth.signInWithPassword({
      email: seedEmail,
      password: seedPassword,
    })
    if (signInError) {
      throw new Error(
        `the seeded account could not sign in: ${signInError.message}\n` +
          'Check TASKR_TEST_EMAIL / TASKR_TEST_PASSWORD in .env.local. If the message ' +
          'mentions confirmation, the account was created without "Auto Confirm User".',
      )
    }
    expect(session.user?.id, 'signing in produced no user').toBeTruthy()

    // 2. Two households, both organized by that account.
    const { data: h1, error: h1Error } = await organizer.rpc('create_household', {
      household_name: `TEST 88 ${RUN} inside`,
      organizer_name: 'Placeholder Organizer',
      household_timezone: HOUSEHOLD_TZ,
    })
    expect(
      h1Error,
      `create_household failed: ${h1Error?.message}` +
        (/function|schema cache|not find/i.test(h1Error?.message ?? '')
          ? ' — 0007 takes this from four arguments to three and drops the PIN. ' +
            'A "could not find the function" here means the live project is behind 0007.'
          : ''),
    ).toBeNull()
    inside = h1

    const { data: h2, error: h2Error } = await organizer.rpc('create_household', {
      household_name: `TEST 88 ${RUN} outside`,
      organizer_name: 'Placeholder Organizer',
      household_timezone: 'UTC',
    })
    expect(h2Error, `creating the second household failed: ${h2Error?.message}`).toBeNull()
    outside = h2

    // 3. The organizer's own row in H1, which `create_household` claimed for
    //    them in the same statement.
    const { data: roster, error: rosterError } = await organizer
      .from('members')
      .select(MEMBER_COLUMNS)
      .eq('claimed_by', session.user.id)
    expect(rosterError, `reading own rows failed: ${rosterError?.message}`).toBeNull()
    organizerInside = roster.find((m) => m.id === inside.organizer_member_id)
    expect(organizerInside, 'the organizer has no member row in the household they made').toBeTruthy()

    // 4. One person in each household, each with a real sign-in.
    const insiderResult = await provision(organizer, inside.id, 'Placeholder One', `in-${RUN}`)
    insiderMember = insiderResult.member
    insiderAuthId = insiderResult.provision.claimedBy
    expect(
      insiderResult.provision.email,
      'the function must derive the synthetic address from members.id',
    ).toBe(`${insiderMember.id}@taskr.invalid`)

    const outsiderResult = await provision(organizer, outside.id, 'Placeholder Two', `out-${RUN}`)
    outsiderMember = outsiderResult.member
    outsiderAuthId = outsiderResult.provision.claimedBy

    // 5. Something real in H1 for the outsider to fail to see. Seeded here
    //    rather than inside a test, because an empty read against an empty
    //    table is satisfied by a database that never stored anything.
    const { data: seededCapacity, error: capacityError } = await organizer
      .from('member_capacity')
      .insert({
        household_id: inside.id,
        member_id: insiderMember.id,
        period_start: CAPACITY_PERIOD,
        minutes: 90,
        note: 'seeded by the live suite',
      })
      .select(CAPACITY_COLUMNS)
      .single()
    expect(capacityError, `seeding a capacity override failed: ${capacityError?.message}`).toBeNull()
    capacityId = seededCapacity.id

    const { data: seededChore, error: choreError } = await organizer
      .from('chores')
      .insert({
        household_id: inside.id,
        title: 'Seeded by the live suite',
        expected_minutes: 30,
        due_on: CAPACITY_PERIOD,
      })
      .select(CHORE_COLUMNS)
      .single()
    expect(choreError, `seeding a chore failed: ${choreError?.message}`).toBeNull()
    choreId = seededChore.id

    // 6. Both provisioned people sign in as themselves, over the wire.
    const { error: insiderSignIn } = await insider.auth.signInWithPassword({
      email: insiderResult.provision.email,
      password: `in-${RUN}`,
    })
    expect(insiderSignIn, `the insider could not sign in: ${insiderSignIn?.message}`).toBeNull()

    const { error: outsiderSignIn } = await outsider.auth.signInWithPassword({
      email: outsiderResult.provision.email,
      password: `out-${RUN}`,
    })
    expect(outsiderSignIn, `the outsider could not sign in: ${outsiderSignIn?.message}`).toBeNull()
  }, 60_000)

  afterAll(async () => {
    await Promise.all([
      organizer.auth.signOut(),
      insider.auth.signOut(),
      outsider.auth.signOut(),
    ])
  })

  // ── the positive controls ────────────────────────────────────────────────
  //
  // Without these, every refusal below is satisfied by a project that returns
  // nothing to anybody — a typo in a table name included — and the suite reads
  // as proof of security.

  describe('POSITIVE CONTROLS: the household is real and its organizer can see it', () => {
    it('both households exist and the organizer is in both', async () => {
      expect(inside?.id).toBeTruthy()
      expect(outside?.id).toBeTruthy()
      expect(inside.id).not.toBe(outside.id)

      const { data, error } = await organizer.rpc('current_household_ids')
      expect(error, `current_household_ids failed: ${error?.message}`).toBeNull()
      expect(data).toContain(inside.id)
      expect(data).toContain(outside.id)
    })

    it('the organizer reads the roster, the week and the work', async () => {
      const [{ data: members }, { data: capacity }, { data: chores }] = await Promise.all([
        organizer.from('members').select(MEMBER_COLUMNS).eq('id', insiderMember.id),
        organizer.from('member_capacity').select(CAPACITY_COLUMNS).eq('id', capacityId),
        organizer.from('chores').select(CHORE_COLUMNS).eq('id', choreId),
      ])
      expect(members).toHaveLength(1)
      expect(capacity).toHaveLength(1)
      expect(capacity[0].minutes).toBe(90)
      expect(chores).toHaveLength(1)
    })

    it('carries the timezone the creating account sent, not the default', async () => {
      // Asserting against HOUSEHOLD_TZ rather than "is not null" is the point:
      // the column defaults to 'UTC', so a call whose argument was silently
      // dropped would still produce a non-null value and read as success.
      const { data, error } = await organizer
        .from('households')
        .select(HOUSEHOLD_COLUMNS)
        .eq('id', inside.id)
        .single()
      expect(error, `reading the household back failed: ${error?.message}`).toBeNull()
      expect(data.timezone).toBe(HOUSEHOLD_TZ)
    })
  })

  // ── the vocabulary ─── #88 AC 2 ─────────────────────────────────────────
  //
  // The assertion that this suite no longer names anything 0007 dropped lives
  // in `support/retiredVocabulary.test.js`, NOT here — deliberately, and the
  // reason is the same one the header gives for refusing to skip.
  //
  // It is a question about SOURCE TEXT. It needs no network, no project and no
  // credentials, so putting it in this file would make a check that CI can run
  // depend on credentials CI does not have — and it would then only ever run on
  // a machine that could already run everything else. A guard is worth what it
  // is wired into: over there it gates every push, and the failure it catches
  // (a merge reintroducing a retired call) is one a reviewer would otherwise
  // meet as a confusing setup error against a live project.

  // ── identity ─── #88 AC 3 ───────────────────────────────────────────────

  describe('a member the Edge Function provisioned is a real person to the database', () => {
    it('signs in as themselves, and auth.uid() is the id the function wrote', async () => {
      const { data, error } = await insider.auth.getUser()
      expect(error, `the insider has no session: ${error?.message}`).toBeNull()
      // Not "is not null": the claim is that this session IS the identity the
      // function attached to that member row, and any signed-in user would
      // satisfy a null check.
      expect(data.user.id).toBe(insiderAuthId)
      expect(data.user.email).toBe(`${insiderMember.id}@taskr.invalid`)
    })

    it('their member row is the one that carries their auth id', async () => {
      const { data, error } = await insider
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('claimed_by', insiderAuthId)
      expect(error, `reading own member row failed: ${error?.message}`).toBeNull()
      expect(data.map((m) => m.id)).toEqual([insiderMember.id])
    })

    it('membership resolves to exactly the one household they are in', async () => {
      const { data, error } = await insider.rpc('current_household_ids')
      expect(error, `current_household_ids failed: ${error?.message}`).toBeNull()
      expect(data).toEqual([inside.id])
    })

    it('and they can do ordinary household work — the definer functions survived 0007', async () => {
      // `complete_chore` and its three siblings are `security definer` functions
      // whose bodies used to JOIN `household_devices`. A plpgsql body resolves
      // its tables when it RUNS, so dropping that table left them syntactically
      // fine and broken at the first call. 0007 re-points them; nothing but a
      // real call can say whether the live project got that.
      const { error } = await insider.rpc('complete_chore', { chore_id: choreId })
      expect(error, `complete_chore failed: ${error?.message}`).toBeNull()

      const { data } = await insider.from('chores').select(CHORE_COLUMNS).eq('id', choreId).single()
      expect(data.completed_at).not.toBeNull()
      // The chore records WHO, resolved through `acting_member` — which reads
      // `members.claimed_by`, the column this whole story makes stable.
      expect(data.completed_by_member_id).toBe(insiderMember.id)

      const { error: undoError } = await insider.rpc('uncomplete_chore', { chore_id: choreId })
      expect(undoError, `uncomplete_chore failed: ${undoError?.message}`).toBeNull()
    })
  })

  // ── the refusals, in both directions ─── #88 AC 3 ───────────────────────

  describe('somebody signed in to a DIFFERENT household', () => {
    it('is genuinely signed in — so an empty read below is a refusal, not a logged-out client', async () => {
      const { data, error } = await outsider.auth.getUser()
      expect(error).toBeNull()
      expect(data.user.id).toBe(outsiderAuthId)

      const { data: own } = await outsider.rpc('current_household_ids')
      expect(own).toEqual([outside.id])
    })

    it('sees no household of ours, even knowing its id', async () => {
      const { data, error } = await outsider
        .from('households')
        .select(HOUSEHOLD_COLUMNS)
        .eq('id', inside.id)
      expect(error, `expected a clean empty read, got ${error?.code}`).toBeNull()
      expect(data).toEqual([])
    })

    it('sees no members of it', async () => {
      // `error` must be null for the empty set to mean anything. A permission
      // error would also produce no rows, and would prove nothing about RLS.
      const { data, error } = await outsider
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('id', insiderMember.id)
      expect(error, `expected a clean empty read, got ${error?.code}`).toBeNull()
      expect(data).toEqual([])
    })

    it('cannot insert a member into a household it knows the id of', async () => {
      const { error } = await outsider
        .from('members')
        .insert({ household_id: inside.id, display_name: 'Intruder', weekly_minutes: 60 })
      expect(error, 'RLS should have refused the insert').not.toBeNull()
      // Name the MECHANISM, not just "something failed". Every refusal in this
      // file is 42501, so the code alone cannot tell a row-level policy from a
      // missing column grant — only the message can. If this ever became a
      // grant refusal instead, the rule this test is named for would have
      // quietly stopped being exercised.
      expect(error.message).toMatch(/row-level security/i)
    })

    it('cannot edit or remove somebody else’s member row', async () => {
      // `weekly_minutes` IS inside 0007's update grant, so the grant permits
      // this write and the ROW-LEVEL POLICY is what must refuse it. Naming the
      // columns on the returning read removes the grant as an explanation.
      const { data: updated, error: updateError } = await outsider
        .from('members')
        .update({ weekly_minutes: 9999 })
        .eq('id', insiderMember.id)
        .select(MEMBER_COLUMNS)
      expect(updateError, `expected a permitted read of a refused write, got ${updateError?.code}`)
        .toBeNull()
      expect(updated).toEqual([])

      const { data: deleted, error: deleteError } = await outsider
        .from('members')
        .delete()
        .eq('id', insiderMember.id)
        .select(MEMBER_COLUMNS)
      expect(deleteError, `expected a permitted read of a refused delete, got ${deleteError?.code}`)
        .toBeNull()
      expect(deleted).toEqual([])

      // The independent check a grant cannot fake: read the row back as
      // somebody who may, and confirm nothing moved.
      const { data: still, error: stillError } = await organizer
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('id', insiderMember.id)
        .single()
      expect(stillError, `reading the row back failed: ${stillError?.message}`).toBeNull()
      expect(still.weekly_minutes).toBe(insiderMember.weekly_minutes)
    })

    it('sees no capacity override, though one exists', async () => {
      const { data, error } = await outsider
        .from('member_capacity')
        .select(CAPACITY_COLUMNS)
        .eq('id', capacityId)
      expect(error, `expected a clean empty read, got ${error?.code}`).toBeNull()
      expect(data).toEqual([])
    })

    it('cannot file a capacity override into a household it knows the id of', async () => {
      const { error } = await outsider.from('member_capacity').insert({
        household_id: inside.id,
        member_id: insiderMember.id,
        period_start: CAPACITY_PERIOD,
        minutes: 5,
      })
      expect(error, 'RLS should have refused the insert').not.toBeNull()
      expect(error.message).toMatch(/row-level security/i)
    })

    it('cannot change or delete somebody else’s week', async () => {
      const { data: updated, error: updateError } = await outsider
        .from('member_capacity')
        .update({ minutes: 1 })
        .eq('id', capacityId)
        .select(CAPACITY_COLUMNS)
      expect(updateError, `expected a permitted read of a refused write, got ${updateError?.code}`)
        .toBeNull()
      expect(updated).toEqual([])

      const { data: still } = await organizer
        .from('member_capacity')
        .select(CAPACITY_COLUMNS)
        .eq('id', capacityId)
        .single()
      expect(still.minutes).toBe(90)
    })

    it('sees no chore of ours, and cannot complete one', async () => {
      const { data, error } = await outsider.from('chores').select(CHORE_COLUMNS).eq('id', choreId)
      expect(error, `expected a clean empty read, got ${error?.code}`).toBeNull()
      expect(data).toEqual([])

      // The definer function refuses on its own predicate, not on RLS, and
      // deliberately will not say WHICH of "no such chore" or "not your
      // household" was hit.
      const { error: completeError } = await outsider.rpc('complete_chore', { chore_id: choreId })
      expect(completeError, 'completing another household’s chore should be refused').not.toBeNull()
      expect(completeError.message).toMatch(/no such chore in your household/i)
    })
  })

  describe('and the refusal runs the other way too', () => {
    // The direction the old suite could not test at all: it had one household,
    // so "a member of A cannot see B" had no B to be a member of.
    it('the insider sees nothing of the other household', async () => {
      const { data: households } = await insider
        .from('households')
        .select(HOUSEHOLD_COLUMNS)
        .eq('id', outside.id)
      expect(households).toEqual([])

      const { data: members } = await insider
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('id', outsiderMember.id)
      expect(members).toEqual([])
    })

    it('the insider’s unfiltered reads contain their household and nothing else', async () => {
      // The strongest form, and the one a per-id filter cannot make: ask for
      // EVERYTHING and check what comes back. The live project holds real
      // households belonging to real people, so this is also the assertion that
      // would notice a policy dropped entirely.
      const { data, error } = await insider.from('households').select(HOUSEHOLD_COLUMNS)
      expect(error, `expected a clean read, got ${error?.code}`).toBeNull()
      expect(data.map((h) => h.id)).toEqual([inside.id])
    })
  })

  // ── the column grants, measured where they can be measured wrong ────────
  //
  // These use the organizer, who is legitimately in the household, so RLS
  // permits every row touched. What refuses is the GRANT, and that distinction
  // is the whole point: 0002 exists because a correct RPC guard was bypassed by
  // a direct UPDATE against the live project, and that was found by measuring
  // Supabase rather than a harness.

  describe('the column grants hold against Supabase itself', () => {
    /** A grant refusal, not a policy one. 42501 alone cannot tell them apart. */
    function expectGrantRefusal(error, what) {
      expect(error, `${what} should have been refused`).not.toBeNull()
      expect(error.message).toMatch(/permission denied|column/i)
      // The discriminating half. Without it this passes on a row-level refusal,
      // which would mean the column grant was never exercised at all.
      expect(
        error.message,
        `${what} was refused by RLS, not by the grant — the grant is what this test is named for`,
      ).not.toMatch(/row-level security/i)
    }

    it('POSITIVE CONTROL: the organizer CAN correct the minutes and the note', async () => {
      // Without this every refusal below is satisfied by a table nobody can
      // write at all, and the suite would read as proof the grants are right.
      const { data, error } = await organizer
        .from('member_capacity')
        .update({ minutes: 45, note: 'corrected by the live suite' })
        .eq('id', capacityId)
        .select(CAPACITY_COLUMNS)
        .single()
      expect(error, `the permitted update was refused: ${error?.message}`).toBeNull()
      expect(data.minutes).toBe(45)
    })

    it('claimed_by is not client-writable, so nobody can become somebody else', async () => {
      // #87 AC 5, asserted against Supabase rather than the harness. This is
      // the single most consequential grant in the schema under 0007: with it,
      // any member could attach themselves to any row in their household and
      // BECOME that person. It is absent from the client update grant on
      // purpose and written only by the Edge Function running as service_role.
      const { error } = await organizer
        .from('members')
        .update({ claimed_by: outsiderAuthId })
        .eq('id', insiderMember.id)
      expectGrantRefusal(error, 'writing claimed_by')

      const { data: still } = await organizer
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('id', insiderMember.id)
        .single()
      expect(still.claimed_by).toBe(insiderAuthId)
    })

    // #159 REWROTE THIS, and it is the third of the three sites #157 named by
    // line. Its title said BOTH halves of a claim that has now gone false
    // together: `household_id` cannot be read on members, AND therefore
    // `select('*')` fails outright. 0014 grants the column, so neither half
    // holds — deliberately, because a client that cannot name a household
    // cannot filter by one and #157 measured that nothing reaches around that.
    //
    // The old comment was right about the STAKES and they are why this is
    // rewritten rather than deleted: every empty-read assertion in this file
    // would go vacuous if row scoping silently stopped working. What actually
    // guaranteed those assertions was never the wildcard refusal — it was the
    // RLS PREDICATE, and that is untouched by a column grant. So the surviving
    // property is asserted directly, against the thing that could really break.
    it('household_id is readable now, and the RLS predicate still scopes the rows', async () => {
      // Half one: the grant landed. A client can name the household it means.
      const { data: rows, error } = await organizer.from('members').select('id, household_id')
      expect(error, 'household_id should be readable after 0014').toBeNull()
      expect(rows.length).toBeGreaterThan(0)

      // Half two, and this is the one carrying the weight. Reading the column
      // does not widen WHICH ROWS come back: every row still belongs to a
      // household this caller is in, so no outsider row is reachable even with
      // the wildcard now permitted.
      const { data: wild, error: wildError } = await organizer.from('members').select('*')
      expect(wildError, 'select(*) is permitted after 0014 — that is the recorded cost').toBeNull()
      const households = new Set(wild.map((r) => r.household_id))
      expect(households.has(inside.id)).toBe(true)
      expect(households.has(outside.id)).toBe(false)
    })

    it('cannot backdate a capacity row by writing created_at at insert time', async () => {
      const { error } = await organizer.from('member_capacity').insert({
        household_id: inside.id,
        member_id: insiderMember.id,
        period_start: '2026-08-17',
        minutes: 10,
        created_at: '2020-01-01T00:00:00Z',
      })
      expectGrantRefusal(error, 'writing created_at')
    })

    it('cannot move an override to another person or another week', async () => {
      const { error: person } = await organizer
        .from('member_capacity')
        .update({ member_id: organizerInside.id })
        .eq('id', capacityId)
      expectGrantRefusal(person, 'writing member_id')

      const { error: week } = await organizer
        .from('member_capacity')
        .update({ period_start: '2026-08-03' })
        .eq('id', capacityId)
      expectGrantRefusal(week, 'writing period_start')
    })

    it('refuses a period that is not a Monday', async () => {
      const { error } = await organizer.from('member_capacity').insert({
        household_id: inside.id,
        member_id: insiderMember.id,
        period_start: '2026-08-11',
        minutes: 30,
      })
      expect(error, 'a Tuesday period should have been refused').not.toBeNull()
      expect(error.message).toMatch(/period_is_monday|check constraint/i)
    })

    it('cannot reassign the organizer', async () => {
      // 0005 gives households its first UPDATE policy. Without the matching
      // column grant that policy would let any member make themselves organizer
      // — 0002's measured hole, reopened.
      const { error } = await organizer
        .from('households')
        .update({ organizer_member_id: insiderMember.id })
        .eq('id', inside.id)
      expectGrantRefusal(error, 'writing organizer_member_id')
    })

    it('but the household timezone IS correctable by a member', async () => {
      const { data, error } = await organizer
        .from('households')
        .update({ timezone: 'Europe/London' })
        .eq('id', inside.id)
        .select(HOUSEHOLD_COLUMNS)
        .single()
      expect(error, `the permitted update was refused: ${error?.message}`).toBeNull()
      expect(data.timezone).toBe('Europe/London')
    })

    it('and a zone Postgres does not know is refused at write time', async () => {
      const { error } = await organizer
        .from('households')
        .update({ timezone: 'Mars/Olympus' })
        .eq('id', inside.id)
      expect(error, 'an unknown zone should have been refused').not.toBeNull()
      expect(error.message).toMatch(/not a known timezone/i)
    })
  })

  // ── the rule 0007 added, which nothing before it had ────────────────────

  describe('a signed-in member cannot delete themselves out of their own household', () => {
    // 0007's delete policy carries one clause the others do not, and it is not
    // a tightening for its own sake. Under device auth, removing your own
    // member row was survivable because `household_devices` carried membership
    // independently. With `claimed_by` as the SOLE predicate, "remove me from
    // the roster" silently became "lock myself out forever" — and
    // `households.organizer_member_id` is `on delete set null`, so an organizer
    // doing it leaves the household with no organizer and visible to nobody.
    // Not recoverable from any client.
    it('the delete is refused and the row survives', async () => {
      const { data: deleted, error } = await insider
        .from('members')
        .delete()
        .eq('id', insiderMember.id)
        .select(MEMBER_COLUMNS)
      expect(error, `expected a permitted read of a refused delete, got ${error?.code}`).toBeNull()
      expect(deleted, 'a member deleted their own row — 0007’s guard is not on this project').toEqual([])

      const { data: still } = await organizer
        .from('members')
        .select(MEMBER_COLUMNS)
        .eq('id', insiderMember.id)
      expect(still).toHaveLength(1)
    })

    it('POSITIVE CONTROL: but they CAN remove somebody else in the household', async () => {
      // Without this the assertion above is satisfied by a project where the
      // delete policy is missing entirely and nobody can delete anything —
      // which looks identical from outside and is a different, worse bug.
      const { data: spare, error: addError } = await organizer
        .from('members')
        .insert({ household_id: inside.id, display_name: 'Spare' })
        .select(MEMBER_COLUMNS)
        .single()
      expect(addError, `seeding a removable member failed: ${addError?.message}`).toBeNull()

      const { data: removed, error } = await insider
        .from('members')
        .delete()
        .eq('id', spare.id)
        .select(MEMBER_COLUMNS)
      expect(error, `the permitted delete was refused: ${error?.message}`).toBeNull()
      expect(removed.map((m) => m.id)).toEqual([spare.id])
    })
  })

  // ── the Edge Function's own authorization, over the wire ────────────────

  describe('provisioning refuses a caller who is not the organizer', () => {
    it('a member of the household cannot provision anybody', async () => {
      // The function checks `is_household_organizer` THROUGH THE CALLER, so
      // this is a database answer rather than one the function decided.
      const { data: spare, error: addError } = await organizer
        .from('members')
        .insert({ household_id: inside.id, display_name: 'Not Yet Provisioned' })
        .select(MEMBER_COLUMNS)
        .single()
      expect(addError, `seeding failed: ${addError?.message}`).toBeNull()

      const { error } = await insider.functions.invoke('provision-member', {
        body: { action: 'provision', memberId: spare.id, password: `nope-${RUN}` },
      })
      expect(error, 'a non-organizer provisioned a sign-in').not.toBeNull()
      expect(await describeFunctionError(error)).toMatch(/only the household organizer/i)
    })

    it('and nobody can provision into a household they are not in', async () => {
      // The caller-scoped read is what refuses this: RLS scopes `members` to
      // the caller's household, so a member id from anywhere else is simply not
      // found. The refusal is deliberately indistinguishable from "no such
      // person", so this endpoint cannot be used to probe for valid ids.
      const { error } = await outsider.functions.invoke('provision-member', {
        body: { action: 'provision', memberId: insiderMember.id, password: `nope-${RUN}` },
      })
      expect(error, 'a stranger provisioned into our household').not.toBeNull()
      expect(await describeFunctionError(error)).toMatch(/no such person|not signed in|organizer/i)
    })
  })
})
